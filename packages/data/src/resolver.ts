import {
  DEFAULT_RECITERS,
  EMPTY_CAPABILITIES,
  mergeCapabilities,
  type Capabilities,
  type MushafLine,
  type ResolvedAyah,
  type ResolvedClip,
  type VideoConfig,
  type WordTiming,
} from "@autoayah/core";
import {
  fetchSurahEditions,
  fetchSurahList,
  PUBLIC_TAFSIRS,
  PUBLIC_TRANSLATIONS,
  TAJWEED_EDITION,
  type SurahMeta,
} from "./alquran.js";
import { bufferDurationSeconds, everyayahUrl, fetchAudioBuffer, listEveryayahReciters, localAudioPath } from "./everyayah.js";
import { fetchMushafPage } from "./mushaf.js";
import { ayahBoxes, fetchAyahInfoDb, fetchMushafImage, pngSize } from "./mushaf-images.js";
import { fetchQfChapterAudio } from "./qf.js";
import type { CacheKind, CacheStore, ResolveOptions, Resolver } from "./types.js";

const QURAN_EDITION = "quran-uthmani";
const AUDIO_CONCURRENCY = 6;

type CachedAyah = { n: number; text: string; page?: number };
type CachedEdition = { title?: string; ayahs: CachedAyah[] };

/** Waqf / annotation marks that the source text separates with spaces (e.g. "ٱلْأَسْوَاقِ ۙ"). */
const MARK_ONLY = /^[\u06D6-\u06ED\u08F0-\u08FF\u200C\u200D]+$/;

export function splitWords(text: string): string[] {
  const words: string[] = [];
  for (const token of text.trim().split(/\s+/).filter(Boolean)) {
    if (MARK_ONLY.test(token) && words.length) words[words.length - 1] += ` ${token}`;
    else words.push(token);
  }
  return words;
}

const stripDiacritics = (s: string) => s.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640\uFEFF]/g, "").replace(/ٱ/g, "ا");

/**
 * AlQuran.cloud's Uthmani text prefixes ayah 1 of every surah (except 1 and 9) with the Basmala,
 * while everyayah audio for that ayah does not include it. Split it off so text and audio match.
 */
export function splitBasmala(surah: number, ayah: number, text: string): { basmala?: string; text: string } {
  if (ayah !== 1 || surah === 1 || surah === 9) return { text };
  const words = text.replace(/^\uFEFF/, "").trim().split(/\s+/);
  const head = words.slice(0, 4).map(stripDiacritics);
  if (head[0] === "بسم" && head[1] === "الله" && head[2]?.includes("رحمن") && head[3]?.includes("رحيم")) {
    return { basmala: words.slice(0, 4).join(" "), text: words.slice(4).join(" ") };
  }
  return { text };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function cachedJson<T>(cache: CacheStore, key: string, kind: CacheKind, source: string, load: () => Promise<T>): Promise<T> {
  const hit = await cache.readFile(key);
  if (hit) {
    try {
      return JSON.parse(hit.toString("utf8")) as T;
    } catch {
      /* corrupt entry — refetch */
    }
  }
  const value = await load();
  await cache.writeFile(key, kind, source, Buffer.from(JSON.stringify(value)));
  return value;
}

export function createResolver(opts: ResolveOptions): Resolver {
  const { cache, qf } = opts;
  let surahsMemo: Promise<SurahMeta[]> | null = null;

  const getSurahs = () => {
    surahsMemo ??= cachedJson(cache, "surahs:v1", "ayah_text", "alquran", fetchSurahList).catch((e) => {
      surahsMemo = null;
      throw e;
    });
    return surahsMemo;
  };

  /** Whole-surah editions cached individually, so any ayah range is served locally afterwards. */
  async function getEditions(surah: number, ids: string[]): Promise<Map<string, CachedEdition>> {
    const result = new Map<string, CachedEdition>();
    const missing: string[] = [];
    for (const id of ids) {
      const hit = await cache.readFile(`edition:v1:${surah}:${id}`);
      if (hit) result.set(id, JSON.parse(hit.toString("utf8")) as CachedEdition);
      else missing.push(id);
    }
    if (missing.length) {
      const fetched = await fetchSurahEditions(surah, missing);
      for (const ed of fetched) {
        const id = ed.edition.identifier;
        const value: CachedEdition = {
          title: ed.edition.name || ed.edition.englishName,
          ayahs: ed.ayahs.map((a) => ({ n: a.numberInSurah, text: a.text, page: a.page })),
        };
        const kind: CacheKind = id.startsWith("quran") ? "ayah_text" : PUBLIC_TRANSLATIONS.some((t) => t.id === id) ? "translation" : "tafsir";
        await cache.writeFile(`edition:v1:${surah}:${id}`, kind, "alquran", Buffer.from(JSON.stringify(value)));
        result.set(id, value);
      }
    }
    return result;
  }

  async function getAudio(reciter: string, surah: number, ayah: number): Promise<{ data: Buffer; seconds: number }> {
    const key = `audio:${reciter}:${surah}:${ayah}`;
    const hit = await cache.readFile(key);
    if (hit) {
      const entry = await cache.get(key);
      const seconds = Number(entry?.meta?.duration) || (await bufferDurationSeconds(hit));
      return { data: hit, seconds };
    }
    const url = everyayahUrl(reciter, surah, ayah);
    const data = await fetchAudioBuffer(url);
    const seconds = await bufferDurationSeconds(data);
    await cache.writeFile(key, "audio", "everyayah", data, false, { duration: seconds, url });
    return { data, seconds };
  }

  async function wordTimings(config: Pick<VideoConfig, "surah" | "from" | "to" | "reciter">): Promise<Map<number, WordTiming[]>> {
    const out = new Map<number, WordTiming[]>();
    const recitationId = DEFAULT_RECITERS.find((r) => r.id === config.reciter)?.qfRecitationId;
    if (!qf?.clientId || recitationId == null) return out;
    try {
      const audio = await cachedJson(cache, `qf:segments:v1:${recitationId}:${config.surah}`, "word_timings", "qf", async () => {
        const res = await fetchQfChapterAudio(qf, config.surah, recitationId);
        if (!res) throw new Error("no QF audio");
        return res;
      });
      for (const ts of audio.timestamps) {
        const n = Number(ts.verse_key.split(":")[1]);
        if (n < config.from || n > config.to || !ts.segments?.length) continue;
        // Segments are absolute within the chapter file; everyayah files start at the ayah.
        out.set(
          n,
          ts.segments
            .map((seg) => seg.slice(-3) as [number, number, number])
            .filter(([index]) => index > 0)
            .map(([index, start, end]) => ({ index, text: "", startMs: start - ts.timestamp_from, endMs: end - ts.timestamp_from })),
        );
      }
    } catch {
      /* QF optional — template estimates timings instead */
    }
    return out;
  }

  async function getMushafImage(page: number): Promise<{ data: Buffer; width: number; height: number }> {
    const key = `mushafimg:v1:${page}`;
    const hit = await cache.readFile(key);
    const data = hit ?? (await fetchMushafImage(page));
    if (!hit) await cache.writeFile(key, "mushaf_layout", "quran.app", data);
    return { data, ...pngSize(data) };
  }

  let ayahInfoPath: Promise<string> | null = null;
  function getAyahInfoPath(): Promise<string> {
    ayahInfoPath ??= (async () => {
      const key = "mushaf:ayahinfo:1024";
      const existing = await cache.get(key);
      if (existing && (await cache.readFile(key))) return existing.path;
      return (await cache.writeFile(key, "mushaf_layout", "quran.app", await fetchAyahInfoDb(), true)).path;
    })().catch((e) => {
      ayahInfoPath = null;
      throw e;
    });
    return ayahInfoPath;
  }

  async function pageScan(page: number) {
    try {
      const [{ width, height }, dbPath] = await Promise.all([getMushafImage(page), getAyahInfoPath()]);
      return { image: { url: `/media/mushaf/${page}.png`, width, height }, boxes: ayahBoxes(dbPath, page) };
    } catch (e) {
      console.warn(`[mushaf] page ${page} scan unavailable, using text layout:`, (e as Error).message);
      return {};
    }
  }

  async function capabilities(): Promise<Capabilities> {
    const imports = await cache.list({ kind: "qul_import" });
    const hasQul = imports.length > 0;
    const hasQf = Boolean(qf?.clientId && qf.clientSecret);
    return mergeCapabilities(EMPTY_CAPABILITIES, {
      wordTimings: hasQf || imports.some((i) => i.meta?.hasWordTimings),
      // Real 15-line page layout comes from the public quran.com API.
      mushafLayout: true,
      fullTafsirCatalog: hasQf || hasQul,
      translations: true,
    });
  }

  return {
    getSurahs,
    async getReciters() {
      return listEveryayahReciters();
    },
    async getTafsirs() {
      const extra = (await cache.list({ kind: "tafsir" }))
        .filter((e) => e.source !== "alquran")
        .map((e) => ({
          id: e.key,
          name: String(e.meta?.name ?? e.key),
          language: String(e.meta?.language ?? "ar"),
          source: e.source,
        }));
      return [...PUBLIC_TAFSIRS, ...extra];
    },
    async getTranslations() {
      return PUBLIC_TRANSLATIONS;
    },
    capabilities,
    getAudio,
    getMushafImage,
    async importQulFile(filename, data, kind: CacheKind) {
      const key = `qul:${filename}`;
      return cache.writeFile(key, kind === "other" ? "qul_import" : kind, "qul", data, true, {
        filename,
        hasWordTimings: /segment|timing/i.test(filename),
        hasMushafLayout: /mushaf|layout|page/i.test(filename),
      });
    },
    async resolveClip(config): Promise<ResolvedClip> {
      const surahs = await getSurahs();
      const meta = surahs.find((s) => s.number === config.surah);
      if (!meta) throw new Error(`Surah ${config.surah} not found`);
      if (config.from < 1 || config.to < config.from || config.to > meta.numberOfAyahs) {
        throw new Error(`Ayah range must be within 1-${meta.numberOfAyahs} for surah ${config.surah}`);
      }

      const wantTajweed = config.style?.tajweed !== false && config.mode !== "wordHighlight";
      const ids = [QURAN_EDITION];
      if (wantTajweed) ids.push(TAJWEED_EDITION);
      if (config.tafsir) ids.push(config.tafsir);
      if (config.translation) ids.push(config.translation);
      const editions = await getEditions(config.surah, ids);

      const inRange = (n: number) => n >= config.from && n <= config.to;
      const byNumber = (id: string | null) =>
        new Map((id ? (editions.get(id)?.ayahs ?? []) : []).filter((a) => inRange(a.n)).map((a) => [a.n, a]));
      const quran = [...byNumber(QURAN_EDITION).values()];
      const tajweed = byNumber(wantTajweed ? TAJWEED_EDITION : null);
      const tafsir = byNumber(config.tafsir);
      const translation = byNumber(config.translation);
      const titleOf = (id: string | null, catalog: { id: string; name: string }[]) =>
        id ? (catalog.find((t) => t.id === id)?.name ?? editions.get(id)?.title ?? id) : undefined;

      const timings = config.mode === "wordHighlight" ? await wordTimings(config) : new Map<number, WordTiming[]>();

      let basmala: string | undefined;
      const ayat: ResolvedAyah[] = await mapLimit(quran, AUDIO_CONCURRENCY, async (a) => {
        const split = splitBasmala(config.surah, a.n, a.text);
        basmala ??= split.basmala;
        const { seconds } = await getAudio(config.reciter, config.surah, a.n);
        return {
          number: a.n,
          text: split.text,
          tajweed: tajweed.get(a.n)?.text,
          words: splitWords(split.text),
          tafsir: tafsir.get(a.n)?.text,
          translation: translation.get(a.n)?.text,
          audioUrl: localAudioPath(config.reciter, config.surah, a.n),
          audioSeconds: seconds,
          wordTimings: timings.get(a.n),
          page: config.mode === "mushafPage" ? a.page : undefined,
        };
      });

      let mushafPages: ResolvedClip["mushafPages"];
      if (config.mode === "mushafPage") {
        const pages = [...new Set(ayat.map((a) => a.page).filter((p): p is number => p != null))];
        const ayahCount = (n: number) => surahs.find((s) => s.number === n)?.numberOfAyahs ?? 0;
        // The Basmala line comes from Al-Fatiha 1:1 — fetched, never typed in.
        const fatiha = (await getEditions(1, [QURAN_EDITION])).get(QURAN_EDITION)?.ayahs.find((a) => a.n === 1)?.text;
        mushafPages = await Promise.all(
          pages.map(async (page) => {
            const lines = await cachedJson<MushafLine[]>(cache, `mushaf:v2:${page}`, "mushaf_layout", "quran.com", () =>
              fetchMushafPage(page, ayahCount),
            );
            const surahNames: Record<string, string> = {};
            for (const line of lines) {
              if (line.kind !== "ayah") surahNames[line.surah] = surahs.find((s) => s.number === line.surah)?.name ?? "";
            }
            return { page, lines, surahNames, basmala: fatiha, ...(await pageScan(page)) };
          }),
        );
      }

      return {
        surah: config.surah,
        surahName: meta.name,
        surahNameEn: meta.englishName,
        tafsirName: titleOf(config.tafsir, PUBLIC_TAFSIRS),
        translationName: titleOf(config.translation, PUBLIC_TRANSLATIONS),
        basmala: config.from === 1 ? basmala : undefined,
        ayat,
        mushafPages,
      };
    },
  };
}

export type ClipConfig = Pick<VideoConfig, "surah" | "from" | "to" | "reciter" | "tafsir" | "translation" | "mode">;
