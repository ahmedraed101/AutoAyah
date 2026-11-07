import { createHash } from "node:crypto";
import type { VideoConfig } from "@autoayah/core";
import type { CacheStore } from "@autoayah/data";
import {
  BACKGROUND_KEYWORDS,
  ProviderError,
  detectPeopleInImage,
  detectorStatus,
  searchProvider,
  stockProviders,
  type ProviderKeys,
  type SearchResult,
  type StockProvider,
} from "@autoayah/media";
import type { Db, LibraryMediaRow } from "./db/index.js";

export type MediaKind = "image" | "video";
export type LibraryItem = SearchResult & { checked: boolean };
export type LoadMoreResult = { added: LibraryItem[]; unchecked: number; limited: StockProvider[]; exhausted: boolean };

const DETECT_CONCURRENCY = 4;
const MAX_PAGE = 50;
/** Provider API calls one "load more" may spend, so a click stays well inside free-tier quotas. */
const CALLS_PER_LOAD = 6;
const TARGET_NEW = 12;
const COOLDOWN_MS = 15 * 60_000;
/** Unsplash's API terms require hotlinking its search previews, so only the other providers' previews are cached. */
const KEEP_PREVIEW: ReadonlySet<string> = new Set(["pexels", "pixabay"]);
const STOCK: ReadonlySet<string> = new Set(["pexels", "unsplash", "pixabay"]);
/** Hosts the stock providers serve files from (Pexels videos can come from Vimeo). */
const STOCK_HOSTS = ["pexels.com", "vimeo.com", "unsplash.com", "pixabay.com"];

function isStockFileUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && STOCK_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export const PREVIEW_ROUTE = "/media/previews";
export const BACKGROUND_ROUTE = "/media/backgrounds";

const mediaId = (r: SearchResult) => `${r.provider}:${r.type}:${r.id}`;
const hashOf = (id: string) => createHash("sha1").update(id).digest("hex").slice(0, 20);
export const previewKey = (hash: string) => `bgprev:${hash}`;
export const backgroundKey = (hash: string) => `bg:${hash}`;

type Segment = VideoConfig["backgrounds"][number];
const backgroundHash = (seg: Pick<Segment, "type" | "media">) => hashOf(`${seg.media!.provider}:${seg.type}:${seg.media!.id}`);

/**
 * Background media found so far, kept across sessions: every image is fetched and person-checked once,
 * and "load more" walks a keyword list page by page so no provider request is ever repeated.
 * Previews and chosen full-size files live in the shared cache, so the Downloads page can manage them.
 */
export class MediaLibrary {
  private readonly cooldownUntil = new Map<StockProvider, number>();
  private readonly busy = new Map<MediaKind, Promise<unknown>>();
  private readonly fetching = new Map<string, Promise<string>>();

  constructor(
    private readonly db: Db,
    private readonly cache: CacheStore,
  ) {}

  /** Clears the found list (the Downloads page deleted the previews it shows). */
  forget() {
    this.db.clearLibraryMedia();
  }

  /** Downloads a chosen stock background once and returns its local URL. */
  keep(seg: Pick<Segment, "type" | "media">): Promise<string> {
    const m = seg.media;
    if (!m?.url || !STOCK.has(m.provider) || !isStockFileUrl(m.url)) return Promise.reject(new Error("Only stock media can be saved"));
    const hash = backgroundHash(seg);
    const url = `${BACKGROUND_ROUTE}/${hash}`;
    const pending = this.fetching.get(hash);
    if (pending) return pending;
    const run = (async () => {
      if (await this.cache.get(backgroundKey(hash))) return url;
      const file = await download(m.url!, 300_000);
      if (!file || !/^(image|video)\//.test(file.type)) throw new Error("Could not download the background");
      await this.cache.writeFile(backgroundKey(hash), "background", m.provider, file.data, true, {
        contentType: file.type,
        attribution: m.attribution,
        url: m.url,
      });
      return url;
    })().finally(() => this.fetching.delete(hash));
    this.fetching.set(hash, run);
    return run;
  }

  /**
   * Points stock backgrounds at their saved copies. Renders wait for missing ones to download; previews
   * keep the remote URL meanwhile and save it in the background.
   */
  async localize(config: VideoConfig, wait: boolean): Promise<VideoConfig> {
    const backgrounds = await Promise.all(
      config.backgrounds.map(async (seg) => {
        if (!seg.media?.url || !STOCK.has(seg.media.provider)) return seg;
        const withUrl = (url: string) => ({ ...seg, media: { ...seg.media!, url } });
        if (await this.cache.get(backgroundKey(backgroundHash(seg)))) return withUrl(`${BACKGROUND_ROUTE}/${backgroundHash(seg)}`);
        const saving = this.keep(seg);
        if (!wait) {
          saving.catch(() => undefined);
          return seg;
        }
        return saving.then(withUrl, () => seg);
      }),
    );
    return { ...config, backgrounds };
  }

  async list(kind: MediaKind): Promise<LibraryItem[]> {
    await this.recheck(kind);
    return this.db.listLibraryMedia(kind).map((row) => this.toItem(row));
  }

  loadMore(kind: MediaKind, keys: ProviderKeys): Promise<LoadMoreResult> {
    const run = (this.busy.get(kind) ?? Promise.resolve()).catch(() => undefined).then(() => this.fetchMore(kind, keys));
    this.busy.set(kind, run);
    return run;
  }

  /** Person-checks results (verdicts are cached) and stores the people-free ones in the library. */
  async admit(results: SearchResult[], kind: MediaKind): Promise<{ items: LibraryItem[]; unchecked: number }> {
    const out: (LibraryItem | null)[] = new Array(results.length).fill(null);
    let next = 0;
    let unchecked = 0;
    const worker = async () => {
      while (next < results.length) {
        const i = next++;
        const r = results[i]!;
        const id = mediaId(r);
        const stored = this.db.getLibraryMedia(id);
        if (stored) {
          out[i] = this.toItem(stored);
          continue;
        }
        const verdict = this.db.getVerdict(id);
        if (verdict?.has_person) continue;
        const preview = r.previewUrl ? await download(r.previewUrl) : undefined;
        let checked = Boolean(verdict);
        if (!verdict && preview) {
          const result = await detectPeopleInImage(preview.data).catch(() => undefined);
          if (result && result.method !== "unchecked") {
            this.db.insertVerdict({
              id,
              provider: r.provider,
              media_id: r.id,
              has_person: result.hasPerson ? 1 : 0,
              confidence: result.confidence,
              method: result.method,
              created_at: new Date().toISOString(),
            });
            if (result.hasPerson) continue;
            checked = true;
          }
        }
        if (!checked) unchecked++;
        const previewFile = preview && KEEP_PREVIEW.has(r.provider) ? await this.savePreview(id, r.provider, preview) : null;
        const row: LibraryMediaRow = {
          id,
          kind,
          item_json: JSON.stringify(r),
          preview_file: previewFile,
          checked: checked ? 1 : 0,
          created_at: new Date().toISOString(),
        };
        this.db.insertLibraryMedia(row);
        out[i] = this.toItem(row);
      }
    };
    await Promise.all(Array.from({ length: DETECT_CONCURRENCY }, worker));
    return { items: out.filter((x): x is LibraryItem => x !== null), unchecked };
  }

  private async fetchMore(kind: MediaKind, keys: ProviderKeys): Promise<LoadMoreResult> {
    const providers = stockProviders(keys, kind);
    if (!providers.length) {
      throw new Error(
        kind === "video" && keys.unsplash
          ? "Unsplash has no videos. Add a Pexels or Pixabay key in Settings for video backgrounds."
          : "Add at least one stock media API key in Settings",
      );
    }
    const cooling = () => providers.filter((p) => (this.cooldownUntil.get(p) ?? 0) > Date.now());
    if (cooling().length === providers.length) {
      const wait = Math.ceil((Math.min(...providers.map((p) => this.cooldownUntil.get(p)!)) - Date.now()) / 60_000);
      throw new Error(`Stock media providers hit their rate limit. Try again in about ${wait} min.`);
    }

    const keywords = BACKGROUND_KEYWORDS[kind];
    const rotationKey = `rotation:${kind}`;
    let rotation = this.db.getCursor(rotationKey)?.next_page ?? 0;
    const added: LibraryItem[] = [];
    const errors: string[] = [];
    let unchecked = 0;
    let calls = 0;
    let pending = false;

    for (let tried = 0; tried < keywords.length && added.length < TARGET_NEW && calls < CALLS_PER_LOAD; tried++) {
      const keyword = keywords[rotation % keywords.length]!;
      rotation++;
      const ready = providers.filter((p) => !cooling().includes(p));
      const jobs = ready.flatMap((p) => {
        const key = `${p}:${kind}:${keyword}`;
        const cursor = this.db.getCursor(key);
        return cursor?.done ? [] : [{ p, key, page: cursor?.next_page ?? 1 }];
      });
      if (!jobs.length) continue;
      pending = true;
      calls += jobs.length;
      const settled = await Promise.allSettled(jobs.map((j) => searchProvider(j.p, keys[j.p]!, keyword, kind, j.page)));
      const found: SearchResult[] = [];
      settled.forEach((s, i) => {
        const j = jobs[i]!;
        if (s.status === "fulfilled") {
          this.db.setCursor({ key: j.key, next_page: j.page + 1, done: !s.value.hasMore || j.page >= MAX_PAGE ? 1 : 0 });
          found.push(...s.value.results);
        } else if (s.reason instanceof ProviderError && s.reason.limited) {
          this.cooldownUntil.set(j.p, Date.now() + COOLDOWN_MS);
        } else {
          errors.push((s.reason as Error).message);
        }
      });
      const seen = new Set<string>();
      const fresh = found.filter((r) => {
        const id = mediaId(r);
        if (seen.has(id) || this.db.hasLibraryMedia(id)) return false;
        seen.add(id);
        return true;
      });
      const admitted = await this.admit(fresh, kind);
      added.push(...admitted.items);
      unchecked += admitted.unchecked;
    }
    this.db.setCursor({ key: rotationKey, next_page: rotation % keywords.length, done: 0 });

    const limited = cooling();
    if (!added.length && errors.length) throw new Error(errors.join("; "));
    if (!added.length && limited.length === providers.length) {
      throw new Error("Stock media providers hit their rate limit. Try again in about 15 min.");
    }
    return { added, unchecked, limited, exhausted: !pending && !limited.length };
  }

  /** Items stored while the detector was still loading get checked from their saved preview once it is ready. */
  private async recheck(kind: MediaKind) {
    if (!detectorStatus().ready) return;
    for (const row of this.db.listLibraryMedia(kind).filter((r) => !r.checked)) {
      const item = JSON.parse(row.item_json) as SearchResult;
      const saved = row.preview_file ? await this.cache.readFile(previewKey(row.preview_file)) : null;
      const data = saved ?? (item.previewUrl ? (await download(item.previewUrl))?.data : undefined);
      if (!data) continue;
      const result = await detectPeopleInImage(data).catch(() => undefined);
      if (!result || result.method === "unchecked") continue;
      if (result.hasPerson) this.db.deleteLibraryMedia(row.id);
      else this.db.markLibraryMediaChecked(row.id);
    }
  }

  private async savePreview(id: string, provider: string, preview: { data: Buffer; type: string }): Promise<string> {
    const hash = hashOf(id);
    await this.cache.writeFile(previewKey(hash), "background", provider, preview.data, true, { contentType: preview.type });
    return hash;
  }

  private toItem(row: LibraryMediaRow): LibraryItem {
    const item = JSON.parse(row.item_json) as SearchResult;
    return {
      ...item,
      previewUrl: row.preview_file ? `${PREVIEW_ROUTE}/${row.preview_file}` : item.previewUrl,
      checked: Boolean(row.checked),
    };
  }
}

async function download(url: string, timeoutMs = 15_000): Promise<{ data: Buffer; type: string } | undefined> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return undefined;
    return { data: Buffer.from(await res.arrayBuffer()), type: (res.headers.get("content-type") ?? "").split(";")[0]!.trim() };
  } catch {
    return undefined;
  }
}
