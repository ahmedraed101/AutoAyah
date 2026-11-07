import { parseReciter } from "./resolver.js";
import type { CacheEntry } from "./types.js";

export type LibraryType = "recitation" | "mushaf" | "tafsir" | "translation" | "text" | "imports" | "app";

/** A group the user can download or delete as a whole; `surah` narrows it to one surah. */
export type LibraryTarget = { type: LibraryType; id: string; surah?: number };

type Slot = LibraryTarget & { ayah?: number; page?: number; wholeSurah?: boolean; timings?: boolean };

export type LibrarySurah = { surah: number; have: number; total: number; bytes: number };

export type LibraryGroup = {
  type: LibraryType;
  id: string;
  name: string;
  nameAr?: string;
  language?: string;
  bytes: number;
  files: number;
  surahs: LibrarySurah[];
  pages: number[];
};

export type LibraryNames = {
  reciters: Record<string, { name: string; nameAr?: string }>;
  tafsirs: Record<string, { name: string; language?: string }>;
  translations: Record<string, { name: string; language?: string }>;
};

export const MUSHAF_PAGES = 604;

export function classifyEntry(e: CacheEntry): Slot {
  const k = e.key;
  let m: RegExpMatchArray | null;
  if ((m = k.match(/^audio:(.+):(\d+):(\d+)$/))) return { type: "recitation", id: m[1]!, surah: +m[2]!, ayah: +m[3]! };
  if ((m = k.match(/^audio-chapter:(.+):(\d+)$/))) return { type: "recitation", id: m[1]!, surah: +m[2]!, wholeSurah: true };
  // A run only serves its own ayah range, so it adds bytes to the surah without counting its ayat as offline.
  if ((m = k.match(/^audio-run:(.+):(\d+):\d+-\d+$/))) return { type: "recitation", id: m[1]!, surah: +m[2]! };
  if ((m = k.match(/^qc:verse-audio:v1:(\d+):(\d+)$/))) return { type: "recitation", id: `qdc-${m[1]}`, surah: +m[2]!, timings: true };
  if ((m = k.match(/^qc:chapter-audio:v1:(\d+):(\d+)$/))) return { type: "recitation", id: `qdcch-${m[1]}`, surah: +m[2]!, timings: true };
  if ((m = k.match(/^mp3q:timing:v1:(\d+):(\d+)$/))) return { type: "recitation", id: `mp3q-${m[1]}`, surah: +m[2]!, timings: true };
  if ((m = k.match(/^edition:v1:(\d+):(.+)$/))) {
    const type = e.kind === "tafsir" ? "tafsir" : e.kind === "translation" ? "translation" : "text";
    return { type, id: type === "text" ? "quran" : m[2]!, surah: +m[1]! };
  }
  if ((m = k.match(/^qc:(tafsir|translation):v1:(\d+):(\d+)$/))) return { type: m[1] as LibraryType, id: `qc-${m[2]}`, surah: +m[3]! };
  if ((m = k.match(/^(?:mushafimg:v1|mushaf:v2|page:v1):(\d+)$/))) return { type: "mushaf", id: "madani", page: +m[1]! };
  if (k.startsWith("mushaf:ayahinfo:")) return { type: "mushaf", id: "madani" };
  if (e.source === "qul") return { type: "imports", id: k };
  return { type: "app", id: "app" };
}

/** Timing files belong to a recitation but are shared by everyayah folders of the same recording, so they never decide what's deleted. */
export function entryMatches(e: CacheEntry, target: LibraryTarget): boolean {
  const slot = classifyEntry(e);
  if (slot.type !== target.type || slot.id !== target.id) return false;
  return target.surah == null || slot.surah === target.surah;
}

export function summarizeLibrary(
  entries: CacheEntry[],
  ayahCounts: Map<number, number>,
  names: LibraryNames,
): LibraryGroup[] {
  const groups = new Map<string, LibraryGroup>();
  const ayatSeen = new Map<string, Set<number>>();
  const wholeSurahs = new Set<string>();
  const timingSlots: { slot: Slot; entry: CacheEntry }[] = [];

  const groupFor = (type: LibraryType, id: string): LibraryGroup => {
    const gk = `${type}|${id}`;
    let g = groups.get(gk);
    if (!g) {
      g = { type, id, name: id, bytes: 0, files: 0, surahs: [], pages: [], ...nameOf(type, id, names) };
      groups.set(gk, g);
    }
    return g;
  };
  const surahRow = (g: LibraryGroup, surah: number): LibrarySurah => {
    let row = g.surahs.find((s) => s.surah === surah);
    if (!row) {
      row = { surah, have: 0, total: g.type === "recitation" ? (ayahCounts.get(surah) ?? 0) : 1, bytes: 0 };
      g.surahs.push(row);
    }
    return row;
  };

  for (const entry of entries) {
    const slot = classifyEntry(entry);
    if (slot.timings) {
      timingSlots.push({ slot, entry });
      continue;
    }
    const g = groupFor(slot.type, slot.id);
    if (slot.type === "imports") g.name = String(entry.meta?.filename ?? entry.key.replace(/^qul:/, ""));
    g.bytes += entry.size;
    g.files++;
    if (slot.page != null && !g.pages.includes(slot.page)) g.pages.push(slot.page);
    if (slot.surah == null) continue;
    const row = surahRow(g, slot.surah);
    row.bytes += entry.size;
    if (slot.type !== "recitation") row.have = 1;
    else if (slot.wholeSurah) wholeSurahs.add(`${slot.id}|${slot.surah}`);
    else if (slot.ayah != null) {
      const key = `${slot.id}|${slot.surah}`;
      const seen = ayatSeen.get(key) ?? new Set<number>();
      seen.add(slot.ayah);
      ayatSeen.set(key, seen);
    }
  }

  for (const g of groups.values()) {
    if (g.type !== "recitation") continue;
    for (const row of g.surahs) {
      const key = `${g.id}|${row.surah}`;
      row.have = wholeSurahs.has(key) ? row.total : Math.min(row.total, ayatSeen.get(key)?.size ?? 0);
    }
  }

  for (const { slot, entry } of timingSlots) {
    const qcId = parseReciter(slot.id).qcId;
    const owner = [...groups.values()].find(
      (g) => g.type === "recitation" && (g.id === slot.id || (qcId != null && parseReciter(g.id).qcId === qcId)) && g.surahs.some((s) => s.surah === slot.surah),
    );
    const g = owner ?? groupFor("app", "app");
    g.bytes += entry.size;
    g.files++;
    if (owner) surahRow(owner, slot.surah!).bytes += entry.size;
  }

  const order: LibraryType[] = ["recitation", "mushaf", "tafsir", "translation", "text", "imports", "app"];
  return [...groups.values()]
    .map((g) => ({ ...g, surahs: g.surahs.sort((a, b) => a.surah - b.surah), pages: g.pages.sort((a, b) => a - b) }))
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.name.localeCompare(b.name));
}

function nameOf(type: LibraryType, id: string, names: LibraryNames): Partial<LibraryGroup> {
  if (type === "recitation") return names.reciters[id] ?? { name: id.replace(/_/g, " ") };
  if (type === "tafsir") return names.tafsirs[id] ?? {};
  if (type === "translation") return names.translations[id] ?? {};
  return {};
}
