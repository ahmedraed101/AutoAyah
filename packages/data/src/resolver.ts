import {
  DEFAULT_RECITERS,
  EMPTY_CAPABILITIES,
  clipSegments,
  divisionsFromStarts,
  facingPage,
  isMushafMode,
  isMushafSpread,
  mergeCapabilities,
  type Capabilities,
  type MushafLine,
  type QuranDivisions,
  type ResolvedAyah,
  type ResolvedClip,
  type VideoConfig,
  type WordTiming,
} from "@autoayah/core";
import {
  fetchDivisionStarts,
  fetchSurahEditions,
  fetchSurahList,
  PUBLIC_TAFSIRS,
  PUBLIC_TRANSLATIONS,
  TAJWEED_EDITION,
  type SurahMeta,
} from "./alquran.js";
import { bufferDurationSeconds, everyayahUrl, fetchAudioBuffer, listEveryayahReciters, localAudioPath } from "./everyayah.js";
import { fetchMushafPage } from "./mushaf.js";
import { ayahBoxes, fetchAyahInfoDb, fetchMushafImage, pngSize, wordBoxes } from "./mushaf-images.js";
import { sliceMp3 } from "./mp3.js";
import {
  contentClient,
  fetchChapterAudio,
  fetchTafsirChapter,
  fetchTranslationChapter,
  fetchVerseAudio,
  listChapterReciters,
  listTafsirs,
  listTranslations,
  listVerseRecitations,
  type QcRecitation,
  type QcResource,
} from "./quran-com.js";
import type { LibraryNames } from "./library.js";
import type { CacheKind, CacheStore, ResolveOptions, Resolver } from "./types.js";

const QURAN_EDITION = "quran-uthmani";
const AUDIO_CONCURRENCY = 6;
const CATALOG_TTL_MS = 7 * 24 * 3600_000;

/** Reciter ids: "qdc-<id>" per-ayah recitations, "qdcch-<id>" whole-surah recitations, anything else is an everyayah folder. */
export function parseReciter(id: string): { kind: "verse" | "chapter"; qcId: number } | { kind: "everyayah"; qcId?: number } {
  const m = id.match(/^(qdc|qdcch)-(\d+)$/);
  if (m) return { kind: m[1] === "qdc" ? "verse" : "chapter", qcId: Number(m[2]) };
  return { kind: "everyayah", qcId: DEFAULT_RECITERS.find((r) => r.id === id)?.qfRecitationId };
}

/** Tafsir / translation ids "qc-<id>" come from the Quran.com catalog; others are AlQuran.cloud editions. */
const qcResourceId = (id: string | null | undefined) => {
  const m = id?.match(/^qc-(\d+)$/);
  return m ? Number(m[1]) : null;
};

const styleLabel = (style?: string | null) => (style && style !== "Murattal" ? ` (${style})` : "");

/** Quran.com tafsirs already offered through AlQuran.cloud (Muyassar, Qurtubi, Al-Wasit, Baghawi). */
const QC_TAFSIRS_ON_ALQURAN = new Set([16, 90, 93, 94, 926]);
/** The catalog's Arabic-locale names for these use Persian/Urdu spelling. */
const QC_TAFSIR_NAMES_AR: Record<number, string> = { 14: "تفسير ابن كثير", 15: "تفسير الطبري", 91: "تفسير السعدي" };
/** Whole-surah recordings that duplicate a per-ayah recitation or repeat each ayah for children. */
const SKIP_CHAPTER_RECITER = (r: QcRecitation) => /streaming/i.test(r.name) || /kids/i.test(`${r.name} ${r.style ?? ""}`);

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

  let divisionsMemo: Promise<QuranDivisions> | null = null;
  const getDivisions = () => {
    divisionsMemo ??= cachedJson(cache, "divisions:v1", "ayah_text", "alquran", fetchDivisionStarts)
      .then((s) => {
        const rub = divisionsFromStarts(s.rub);
        return {
          juz: divisionsFromStarts(s.juz),
          hizb: rub.flatMap((q, i) => (i % 4 ? [] : [{ n: i / 4 + 1, start: q.start, end: rub[i + 3]!.end }])),
          rub,
          page: divisionsFromStarts(s.page),
          manzil: divisionsFromStarts(s.manzil),
        };
      })
      .catch((e) => {
        divisionsMemo = null;
        throw e;
      });
    return divisionsMemo;
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

  const content = contentClient(qf);

  async function catalog<T>(key: string, load: () => Promise<T>): Promise<T> {
    const entry = await cache.get(key);
    if (entry && Date.now() - Date.parse(entry.createdAt) > CATALOG_TTL_MS) await cache.remove(key);
    return cachedJson(cache, key, "other", "quran.com", load);
  }

  const verseRecitations = () => catalog("qc:recitations:v1", () => listVerseRecitations(content)).catch((): QcRecitation[] => []);
  const chapterReciters = () => catalog("qc:chapter-reciters:v1", () => listChapterReciters(content)).catch((): QcRecitation[] => []);
  const qcTafsirs = () => catalog("qc:tafsirs:v2", () => listTafsirs(content)).catch((): QcResource[] => []);
  const qcTranslations = () => catalog("qc:translations:v1", () => listTranslations(content)).catch((): QcResource[] => []);

  const verseAudio = (recitationId: number, surah: number) =>
    cachedJson(cache, `qc:verse-audio:v1:${recitationId}:${surah}`, "word_timings", "quran.com", () =>
      fetchVerseAudio(content, recitationId, surah),
    );
  const chapterAudio = (reciterId: number, surah: number) =>
    cachedJson(cache, `qc:chapter-audio:v1:${reciterId}:${surah}`, "word_timings", "quran.com", () =>
      fetchChapterAudio(content, reciterId, surah),
    );

  /** Download (once) the source audio for one ayah, whatever kind of reciter it is. */
  async function downloadAyahAudio(reciter: string, surah: number, ayah: number): Promise<{ data: Buffer; url: string; source: string }> {
    const r = parseReciter(reciter);
    if (r.kind === "everyayah") {
      const url = everyayahUrl(reciter, surah, ayah);
      return { data: await fetchAudioBuffer(url), url, source: "everyayah" };
    }
    if (r.kind === "verse") {
      const file = (await verseAudio(r.qcId, surah)).find((f) => f.verseKey === `${surah}:${ayah}`);
      if (!file) throw new Error(`No audio for ${surah}:${ayah} from this reciter`);
      return { data: await fetchAudioBuffer(file.url), url: file.url, source: "quran.com" };
    }
    const chapter = await chapterAudio(r.qcId, surah);
    const ts = chapter.timestamps.find((t) => t.verse_key === `${surah}:${ayah}`);
    if (!ts) throw new Error(`No audio for ${surah}:${ayah} from this reciter`);
    const fileKey = `audio-chapter:${reciter}:${surah}`;
    let whole = await cache.readFile(fileKey);
    if (!whole) {
      whole = await fetchAudioBuffer(chapter.audioUrl);
      await cache.writeFile(fileKey, "audio", "quran.com", whole, false, { url: chapter.audioUrl });
    }
    return { data: sliceMp3(whole, ts.timestamp_from, ts.timestamp_to), url: chapter.audioUrl, source: "quran.com" };
  }

  async function getAudio(reciter: string, surah: number, ayah: number): Promise<{ data: Buffer; seconds: number }> {
    const key = `audio:${reciter}:${surah}:${ayah}`;
    const hit = await cache.readFile(key);
    if (hit) {
      const entry = await cache.get(key);
      const seconds = Number(entry?.meta?.duration) || (await bufferDurationSeconds(hit));
      return { data: hit, seconds };
    }
    const { data, url, source } = await downloadAyahAudio(reciter, surah, ayah);
    const seconds = await bufferDurationSeconds(data);
    await cache.writeFile(key, "audio", source, data, false, { duration: seconds, url });
    return { data, seconds };
  }

  const toTimings = (segments: [number, number, number][], offset = 0): WordTiming[] =>
    segments
      .map((s) => s.map(Number) as [number, number, number])
      .filter(([index]) => index > 0)
      .map(([index, start, end]) => ({ index, text: "", startMs: start - offset, endMs: end - offset }));

  async function wordTimings(config: Pick<VideoConfig, "surah" | "from" | "to" | "reciter">): Promise<Map<number, WordTiming[]>> {
    const out = new Map<number, WordTiming[]>();
    const r = parseReciter(config.reciter);
    if (r.qcId == null) return out;
    const inRange = (key: string) => {
      const n = Number(key.split(":")[1]);
      return n >= config.from && n <= config.to ? n : null;
    };
    try {
      if (r.kind === "chapter") {
        // Segments are absolute within the surah file; each ayah clip starts at its timestamp_from.
        for (const ts of (await chapterAudio(r.qcId, config.surah)).timestamps) {
          const n = inRange(ts.verse_key);
          if (n != null && ts.segments?.length) out.set(n, toTimings(ts.segments, ts.timestamp_from));
        }
      } else {
        for (const f of await verseAudio(r.qcId, config.surah)) {
          const n = inRange(f.verseKey);
          if (n != null && f.segments.length) out.set(n, toTimings(f.segments));
        }
      }
    } catch {
      /* optional — the template estimates timings instead */
    }
    return out;
  }

  /** Quran.com tafsir / translation text for a whole surah, cached per resource. */
  const qcTafsirText = (id: number, surah: number) =>
    cachedJson(cache, `qc:tafsir:v1:${id}:${surah}`, "tafsir", "quran.com", () => fetchTafsirChapter(content, id, surah));
  const qcTranslationText = (id: number, surah: number) =>
    cachedJson(cache, `qc:translation:v1:${id}:${surah}`, "translation", "quran.com", () => fetchTranslationChapter(content, id, surah));

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

  async function mushafLayout(page: number) {
    const surahs = await getSurahs();
    const ayahCount = (n: number) => surahs.find((s) => s.number === n)?.numberOfAyahs ?? 0;
    return cachedJson<MushafLine[]>(cache, `mushaf:v2:${page}`, "mushaf_layout", "quran.com", () => fetchMushafPage(page, ayahCount));
  }

  async function pageScan(page: number, lines: MushafLine[]) {
    try {
      const [{ width, height }, dbPath] = await Promise.all([getMushafImage(page), getAyahInfoPath()]);
      const wordCounts: Record<string, number> = {};
      for (const line of lines) {
        if (line.kind !== "ayah") continue;
        for (const w of line.words) if (!w.ayahEnd) wordCounts[w.verseKey] = (wordCounts[w.verseKey] ?? 0) + 1;
      }
      return {
        image: { url: `/media/mushaf/${page}.png`, width, height },
        boxes: ayahBoxes(dbPath, page),
        words: wordBoxes(dbPath, page, wordCounts),
      };
    } catch (e) {
      console.warn(`[mushaf] page ${page} scan unavailable, using text layout:`, (e as Error).message);
      return {};
    }
  }

  async function capabilities(): Promise<Capabilities> {
    const imports = await cache.list({ kind: "qul_import" });
    const hasQul = imports.length > 0;
    const hasQf = Boolean(qf?.clientId && qf.clientSecret);
    const [recitations, tafsirs] = await Promise.all([verseRecitations(), qcTafsirs()]);
    return mergeCapabilities(EMPTY_CAPABILITIES, {
      // Word segments, page layout and the tafsir catalog come from Quran.com (QF first when keys are set).
      wordTimings: recitations.length > 0 || hasQf || imports.some((i) => i.meta?.hasWordTimings),
      mushafLayout: true,
      fullTafsirCatalog: tafsirs.length > 0 || hasQf || hasQul,
      translations: true,
    });
  }

  async function getReciters() {
    const [verse, chapter] = await Promise.all([verseRecitations(), chapterReciters()]);
    const verseNames = new Set(verse.map((r) => `${r.name}|${r.style ?? ""}`.toLowerCase()));
    return [
      ...verse.map((r) => ({
        id: `qdc-${r.id}`,
        name: `${r.name}${styleLabel(r.style)}`,
        nameAr: r.nameAr ? `${r.nameAr}${styleLabel(r.style)}` : undefined,
        source: "quran.com",
        hasWordTimings: true,
      })),
      // Whole-surah recordings only for reciters that have no per-ayah recitation.
      ...chapter
        .filter((r) => !verse.some((v) => v.id === r.id) && !verseNames.has(`${r.name}|${r.style ?? ""}`.toLowerCase()) && !SKIP_CHAPTER_RECITER(r))
        .map((r) => ({
          id: `qdcch-${r.id}`,
          name: `${r.name}${styleLabel(r.style)}`,
          nameAr: r.nameAr ? `${r.nameAr}${styleLabel(r.style)}` : undefined,
          source: "quran.com",
          hasWordTimings: true,
        })),
      // everyayah folders that are the same recording as a Quran.com recitation stay valid ids but aren't listed twice.
      ...listEveryayahReciters()
        .filter((r) => !verse.some((v) => v.id === parseReciter(r.id).qcId))
        .map((r) => ({ ...r, name: `${r.name} · everyayah` })),
    ];
  }

  async function getTafsirs() {
    const extra = (await cache.list({ kind: "tafsir" }))
      .filter((e) => e.source === "qul")
      .map((e) => ({
        id: e.key,
        name: String(e.meta?.name ?? e.key),
        language: String(e.meta?.language ?? "ar"),
        source: e.source,
      }));
    const qc = (await qcTafsirs())
      .filter((t) => !QC_TAFSIRS_ON_ALQURAN.has(t.id))
      .map((t) => ({ id: `qc-${t.id}`, name: QC_TAFSIR_NAMES_AR[t.id] ?? t.name, language: t.language, source: "quran.com" }));
    return [...PUBLIC_TAFSIRS, ...qc, ...extra];
  }

  async function getTranslations() {
    const known = new Set(PUBLIC_TRANSLATIONS.map((t) => t.name.toLowerCase()));
    const qc = (await qcTranslations())
      .filter((t) => !known.has(t.name.toLowerCase()))
      .map((t) => ({ id: `qc-${t.id}`, name: t.name, language: t.language, source: "quran.com" }));
    return [...PUBLIC_TRANSLATIONS, ...qc];
  }

  async function libraryNames(): Promise<LibraryNames> {
    const [verse, chapter, tafsirs, translations] = await Promise.all([verseRecitations(), chapterReciters(), qcTafsirs(), qcTranslations()]);
    const named = (r: QcRecitation) => ({ name: `${r.name}${styleLabel(r.style)}`, nameAr: r.nameAr ? `${r.nameAr}${styleLabel(r.style)}` : undefined });
    const reciters: LibraryNames["reciters"] = {};
    for (const r of chapter) reciters[`qdcch-${r.id}`] = named(r);
    for (const r of verse) reciters[`qdc-${r.id}`] = named(r);
    for (const r of DEFAULT_RECITERS) {
      const twin = verse.find((v) => v.id === r.qfRecitationId);
      reciters[r.id] = { name: r.name, nameAr: twin?.nameAr ? named(twin).nameAr : undefined };
    }
    const resources = (list: { id: string; name: string; language?: string }[]) => Object.fromEntries(list.map((t) => [t.id, t]));
    const qulTafsirs = (await cache.list({ kind: "tafsir" }))
      .filter((e) => e.source === "qul")
      .map((e) => ({ id: e.key, name: String(e.meta?.name ?? e.key), language: String(e.meta?.language ?? "ar") }));
    return {
      reciters,
      tafsirs: resources([
        ...PUBLIC_TAFSIRS,
        ...tafsirs.map((t) => ({ id: `qc-${t.id}`, name: QC_TAFSIR_NAMES_AR[t.id] ?? t.name, language: t.language })),
        ...qulTafsirs,
      ]),
      translations: resources([...PUBLIC_TRANSLATIONS, ...translations.map((t) => ({ id: `qc-${t.id}`, name: t.name, language: t.language }))]),
    };
  }

  return {
    getSurahs,
    getReciters,
    getTafsirs,
    getTranslations,
    capabilities,
    getAudio,
    getMushafImage,
    libraryNames,
    async prefetchSurahText(surah) {
      await getEditions(surah, [QURAN_EDITION, TAJWEED_EDITION]);
    },
    async prefetchRecitationIndex(reciter, surah) {
      const r = parseReciter(reciter);
      if (r.qcId == null) return;
      if (r.kind === "chapter") await chapterAudio(r.qcId, surah);
      else await verseAudio(r.qcId, surah);
    },
    async prefetchEdition(kind, id, surah) {
      const qcId = qcResourceId(id);
      if (qcId == null) await getEditions(surah, [id]);
      else if (kind === "tafsir") await qcTafsirText(qcId, surah);
      else await qcTranslationText(qcId, surah);
    },
    async mushafPagesOf(surah) {
      const ayahs = (await getEditions(surah, [QURAN_EDITION])).get(QURAN_EDITION)?.ayahs ?? [];
      return [...new Set(ayahs.map((a) => a.page).filter((p): p is number => p != null))];
    },
    async prefetchMushafPage(page) {
      await Promise.all([mushafLayout(page), getMushafImage(page), getAyahInfoPath(), getEditions(1, [QURAN_EDITION])]);
    },
    async importQulFile(filename, data, kind: CacheKind) {
      const key = `qul:${filename}`;
      return cache.writeFile(key, kind === "other" ? "qul_import" : kind, "qul", data, true, {
        filename,
        hasWordTimings: /segment|timing/i.test(filename),
        hasMushafLayout: /mushaf|layout|page/i.test(filename),
      });
    },
    getDivisions,
    async resolveClip(config): Promise<ResolvedClip> {
      const surahs = await getSurahs();
      const meta = surahs.find((s) => s.number === config.surah);
      if (!meta) throw new Error(`Surah ${config.surah} not found`);
      const segments = clipSegments(config);
      for (const seg of segments) {
        const count = surahs.find((s) => s.number === seg.surah)?.numberOfAyahs ?? 0;
        if (seg.from < 1 || seg.to < seg.from || seg.to > count) {
          throw new Error(`Ayah range must be within 1-${count} for surah ${seg.surah}`);
        }
      }

      const wantTajweed = config.style?.tajweed !== false && config.mode !== "wordHighlight";
      const ids = [QURAN_EDITION];
      if (wantTajweed) ids.push(TAJWEED_EDITION);
      const qcTafsir = qcResourceId(config.tafsir);
      const qcTranslation = qcResourceId(config.translation);
      if (config.tafsir && qcTafsir == null) ids.push(config.tafsir);
      if (config.translation && qcTranslation == null) ids.push(config.translation);
      const wantTimings = config.mode === "wordHighlight" || config.mode === "mushafWords";
      const fromRecord = (rec: Record<number, string> | null) =>
        new Map(Object.entries(rec ?? {}).map(([n, text]) => [Number(n), { n: Number(n), text }]));

      // One surah at a time keeps audio downloads bounded on long (juz-sized) clips.
      const parts: { editions: Map<string, CachedEdition>; ayat: ResolvedAyah[] }[] = [];
      for (const seg of segments) {
        const [editions, qcTafsirMap, qcTranslationMap] = await Promise.all([
          getEditions(seg.surah, ids),
          qcTafsir != null ? qcTafsirText(qcTafsir, seg.surah) : null,
          qcTranslation != null ? qcTranslationText(qcTranslation, seg.surah) : null,
        ]);
        const inRange = (n: number) => n >= seg.from && n <= seg.to;
        const byNumber = (id: string | null) =>
          new Map((id ? (editions.get(id)?.ayahs ?? []) : []).filter((a) => inRange(a.n)).map((a) => [a.n, a]));
        const quran = [...byNumber(QURAN_EDITION).values()];
        const tajweed = byNumber(wantTajweed ? TAJWEED_EDITION : null);
        const tafsir = qcTafsir != null ? fromRecord(qcTafsirMap) : byNumber(config.tafsir);
        const translation = qcTranslation != null ? fromRecord(qcTranslationMap) : byNumber(config.translation);
        const timings = wantTimings
          ? await wordTimings({ ...seg, reciter: config.reciter })
          : new Map<number, WordTiming[]>();

        const ayat: ResolvedAyah[] = await mapLimit(quran, AUDIO_CONCURRENCY, async (a) => {
          const split = splitBasmala(seg.surah, a.n, a.text);
          const { seconds } = await getAudio(config.reciter, seg.surah, a.n);
          return {
            number: a.n,
            surah: seg.surah,
            basmala: split.basmala,
            text: split.text,
            tajweed: tajweed.get(a.n)?.text,
            words: splitWords(split.text),
            tafsir: tafsir.get(a.n)?.text,
            translation: translation.get(a.n)?.text,
            audioUrl: localAudioPath(config.reciter, seg.surah, a.n),
            audioSeconds: seconds,
            wordTimings: timings.get(a.n),
            page: isMushafMode(config.mode) ? a.page : undefined,
          };
        });
        parts.push({ editions, ayat });
      }
      const ayat = parts.flatMap((p) => p.ayat);
      const basmala = ayat[0]?.basmala;

      const titleOf = (id: string | null, catalog: { id: string; name: string }[]) =>
        id ? (catalog.find((t) => t.id === id)?.name ?? parts[0]?.editions.get(id)?.title ?? id) : undefined;
      const qcCatalog = (list: QcResource[]) => list.map((r) => ({ id: `qc-${r.id}`, name: r.name }));
      const [tafsirCatalog, translationCatalog] = await Promise.all([
        qcTafsir != null ? getTafsirs() : PUBLIC_TAFSIRS,
        qcTranslation != null ? qcTranslations().then(qcCatalog) : PUBLIC_TRANSLATIONS,
      ]);

      let mushafPages: ResolvedClip["mushafPages"];
      if (isMushafMode(config.mode)) {
        const own = ayat.map((a) => a.page).filter((p): p is number => p != null);
        const spread = isMushafSpread(config) ? own.map(facingPage).filter((p) => p >= 1 && p <= 604) : [];
        const pages = [...new Set([...own, ...spread])];
        // The Basmala line comes from Al-Fatiha 1:1 — fetched, never typed in.
        const fatiha = (await getEditions(1, [QURAN_EDITION])).get(QURAN_EDITION)?.ayahs.find((a) => a.n === 1)?.text;
        mushafPages = await Promise.all(
          pages.map(async (page) => {
            const lines = await mushafLayout(page);
            const surahNames: Record<string, string> = {};
            const nameOf = (n: number) => surahs.find((s) => s.number === n)?.name ?? "";
            for (const line of lines) {
              if (line.kind !== "ayah") surahNames[line.surah] = nameOf(line.surah);
              else for (const w of line.words) surahNames[w.verseKey.split(":")[0]!] ??= nameOf(Number(w.verseKey.split(":")[0]));
            }
            return { page, lines, surahNames, basmala: fatiha, ...(await pageScan(page, lines)) };
          }),
        );
      }

      return {
        surah: config.surah,
        surahName: meta.name,
        surahNameEn: meta.englishName,
        tafsirName: titleOf(config.tafsir, tafsirCatalog),
        translationName: titleOf(config.translation, translationCatalog),
        basmala,
        surahNames: Object.fromEntries(segments.map((s) => [String(s.surah), surahs.find((x) => x.number === s.surah)?.name ?? ""])),
        ayat,
        mushafPages,
      };
    },
  };
}

export type ClipConfig = Pick<VideoConfig, "surah" | "from" | "to" | "reciter" | "tafsir" | "translation" | "mode">;
