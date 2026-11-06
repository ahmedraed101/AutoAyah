import { qfFetch, type QfWordSegment } from "./qf.js";
import type { QfCredentials } from "./types.js";

/**
 * Quran.com content API. The same paths exist on Quran Foundation under /content/api/v4; QF is tried
 * first when keys are configured, and the public API covers whatever those keys don't (prelive keys
 * only serve Al-Fatiha and Al-Baqarah).
 */
const PUBLIC_API = "https://api.quran.com/api/v4";
const VERSE_AUDIO_BASE = "https://verses.quran.com/";

async function publicFetch<T>(path: string, attempts = 3): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${PUBLIC_API}${path}`, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) return (await res.json()) as T;
      lastError = new Error(`quran.com ${path} failed: ${res.status}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) {
      lastError = e as Error;
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** i));
  }
  throw lastError ?? new Error(`quran.com ${path} failed`);
}

export type ContentClient = {
  /** Single resource: QF first, public API on any QF failure or when QF returns nothing (`isEmpty`). */
  get<T>(path: string, isEmpty?: (value: T) => boolean): Promise<T>;
  /** Catalog: both sources, so prelive keys never shrink the list. */
  both<T>(path: string): Promise<T[]>;
};

export function contentClient(qf?: QfCredentials | null): ContentClient {
  const viaQf = <T>(path: string) => qfFetch<T>(qf!, `/content/api/v4${path}`);
  return {
    async get<T>(path: string, isEmpty?: (value: T) => boolean) {
      if (qf?.clientId) {
        try {
          // Prelive keys answer 200 with no data outside Al-Fatiha and Al-Baqarah.
          const value = await viaQf<T>(path);
          if (!isEmpty?.(value)) return value;
        } catch {
          /* fall through to the public API */
        }
      }
      return publicFetch<T>(path);
    },
    async both<T>(path: string) {
      const results = await Promise.allSettled([publicFetch<T>(path), qf?.clientId ? viaQf<T>(path) : Promise.reject()]);
      const ok = results.filter((r): r is PromiseFulfilledResult<Awaited<T>> => r.status === "fulfilled").map((r) => r.value);
      if (!ok.length) throw (results[0] as PromiseRejectedResult).reason;
      return ok;
    },
  };
}

const uniqueBy = <T>(items: T[], key: (t: T) => string | number) => [...new Map(items.map((i) => [key(i), i])).values()];

export function stripHtml(html: string): string {
  return html
    .replace(/<sup[^>]*>.*?<\/sup>/gis, "")
    .replace(/<br\s*\/?>|<\/p>|<\/h\d>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Segments are [word, start, end] (some recitations prefix an index); values may arrive as strings. */
const toSegment = (s: (number | string)[]) => s.slice(-3).map(Number) as QfWordSegment;

// ---------- catalogs ----------

type Named = { name: string; language_name: string };

export type QcRecitation = { id: number; name: string; nameAr?: string; style?: string | null };

export async function listVerseRecitations(client: ContentClient): Promise<QcRecitation[]> {
  const [en, ar] = await Promise.all([
    client.both<{ recitations: { id: number; reciter_name: string; style: string | null }[] }>("/resources/recitations"),
    client.both<{ recitations: { id: number; translated_name?: Named }[] }>("/resources/recitations?language=ar").catch(() => []),
  ]);
  const arNames = new Map(ar.flatMap((r) => r.recitations).map((r) => [r.id, r.translated_name?.name]));
  return uniqueBy(
    en.flatMap((r) => r.recitations),
    (r) => r.id,
  ).map((r) => ({ id: r.id, name: r.reciter_name, nameAr: arNames.get(r.id), style: r.style }));
}

export async function listChapterReciters(client: ContentClient): Promise<QcRecitation[]> {
  const [en, ar] = await Promise.all([
    client.both<{ reciters: { id: number; name: string; style?: { name: string } }[] }>("/resources/chapter_reciters"),
    client.both<{ reciters: { id: number; translated_name?: Named }[] }>("/resources/chapter_reciters?language=ar").catch(() => []),
  ]);
  const arNames = new Map(ar.flatMap((r) => r.reciters).map((r) => [r.id, r.translated_name?.name]));
  return uniqueBy(
    en.flatMap((r) => r.reciters),
    (r) => r.id,
  ).map((r) => ({ id: r.id, name: r.name, nameAr: arNames.get(r.id), style: r.style?.name }));
}

export type QcResource = { id: number; name: string; language: string };

export async function listTafsirs(client: ContentClient): Promise<QcResource[]> {
  const res = await client.both<{ tafsirs: { id: number; name: string; language_name: string; translated_name?: Named }[] }>(
    "/resources/tafsirs?language=ar",
  );
  return uniqueBy(
    res.flatMap((r) => r.tafsirs),
    (t) => t.id,
  ).map((t) => ({
    id: t.id,
    name: (t.language_name.toLowerCase() === "arabic" && t.translated_name?.name) || t.name,
    language: t.language_name,
  }));
}

export async function listTranslations(client: ContentClient): Promise<QcResource[]> {
  const res = await client.both<{ translations: { id: number; name: string; author_name?: string; language_name: string }[] }>(
    "/resources/translations",
  );
  return uniqueBy(
    res.flatMap((r) => r.translations),
    (t) => t.id,
  ).map((t) => ({ id: t.id, name: t.name, language: t.language_name }));
}

// ---------- content ----------

export type VerseAudio = { verseKey: string; url: string; segments: QfWordSegment[] };

/** Per-ayah audio files and their word segments (ms from the start of each file). */
export async function fetchVerseAudio(client: ContentClient, recitationId: number, chapter: number): Promise<VerseAudio[]> {
  const out: VerseAudio[] = [];
  for (let page = 1; ; page++) {
    const data = await client.get<{
      audio_files: { verse_key: string; url: string; segments?: number[][] }[];
      pagination?: { next_page: number | null };
    }>(`/recitations/${recitationId}/by_chapter/${chapter}?fields=segments&per_page=300&page=${page}`, (d) => !d.audio_files?.length);
    for (const f of data.audio_files ?? []) {
      const url = f.url.startsWith("//") ? `https:${f.url}` : /^https?:/.test(f.url) ? f.url : `${VERSE_AUDIO_BASE}${f.url}`;
      out.push({ verseKey: f.verse_key, url, segments: (f.segments ?? []).map(toSegment) });
    }
    if (!data.pagination?.next_page) return out;
  }
}

export type ChapterAudio = {
  audioUrl: string;
  timestamps: { verse_key: string; timestamp_from: number; timestamp_to: number; segments?: QfWordSegment[] }[];
};

/** One file for the whole surah, with per-ayah start/end and word segments in ms from the file start. */
export async function fetchChapterAudio(client: ContentClient, reciterId: number, chapter: number): Promise<ChapterAudio> {
  const data = await client.get<{ audio_file?: ChapterAudio & { audio_url: string } }>(
    `/chapter_recitations/${reciterId}/${chapter}?segments=true`,
    (d) => !d.audio_file?.audio_url,
  );
  if (!data.audio_file?.audio_url) throw new Error(`No surah ${chapter} audio for reciter ${reciterId}`);
  return {
    audioUrl: data.audio_file.audio_url,
    timestamps: (data.audio_file.timestamps ?? []).map((t) => ({ ...t, segments: t.segments?.map(toSegment) })),
  };
}

/** Tafsir text per ayah number. Tafsirs that explain several ayat together repeat that text for each of them. */
export async function fetchTafsirChapter(client: ContentClient, tafsirId: number, chapter: number): Promise<Record<number, string>> {
  const out: Record<number, string> = {};
  let last = "";
  for (let page = 1; ; page++) {
    const data = await client.get<{ tafsirs: { verse_key: string; text: string }[]; pagination?: { next_page: number | null } }>(
      `/tafsirs/${tafsirId}/by_chapter/${chapter}?per_page=50&page=${page}`,
      (d) => !d.tafsirs?.length,
    );
    for (const t of data.tafsirs ?? []) {
      const text = stripHtml(t.text ?? "");
      if (text) last = text;
      out[Number(t.verse_key.split(":")[1])] = text || last;
    }
    if (!data.pagination?.next_page) {
      if (!Object.keys(out).length) throw new Error(`Tafsir ${tafsirId} has no text for surah ${chapter}`);
      return out;
    }
  }
}

export async function fetchTranslationChapter(client: ContentClient, translationId: number, chapter: number): Promise<Record<number, string>> {
  const data = await client.get<{ translations: { verse_key?: string; text: string }[] }>(
    `/quran/translations/${translationId}?chapter_number=${chapter}&fields=verse_key`,
    (d) => !d.translations?.length,
  );
  if (!data.translations?.length) throw new Error(`Translation ${translationId} has no text for surah ${chapter}`);
  const out: Record<number, string> = {};
  data.translations.forEach((t, i) => {
    out[t.verse_key ? Number(t.verse_key.split(":")[1]) : i + 1] = stripHtml(t.text);
  });
  return out;
}
