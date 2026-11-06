import type { MushafLine } from "@autoayah/core";

/** Real Madani (15-line) Mushaf page layout from the public quran.com API — no key needed. */
const API = "https://api.quran.com/api/v4";
export const MUSHAF_LINES = 15;

type ApiWord = { char_type_name: "word" | "end" | string; line_number: number; text_uthmani?: string; text?: string };
type ApiVerse = { verse_key: string; words: ApiWord[] };

type MushafWord = Extract<MushafLine, { kind: "ayah" }>["words"][number];

async function fetchJson<T>(url: string, attempts = 3): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) return (await res.json()) as T;
      lastError = new Error(`quran.com ${url} failed: ${res.status}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) {
      lastError = e as Error;
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** i));
  }
  throw lastError ?? new Error(`quran.com ${url} failed`);
}

const parseKey = (key: string) => key.split(":").map(Number) as [number, number];

/**
 * Fetch a page and rebuild its 15 lines. Lines with no words are surah headers and Basmala lines;
 * `ayahCount(surah)` lets us tell when a page ends with the header of the next surah.
 */
export async function fetchMushafPage(page: number, ayahCount: (surah: number) => number): Promise<MushafLine[]> {
  const data = await fetchJson<{ verses: ApiVerse[] }>(
    `${API}/verses/by_page/${page}?words=true&word_fields=line_number,text_uthmani&per_page=50`,
  );
  const verses = data.verses ?? [];
  if (!verses.length) throw new Error(`Mushaf page ${page} has no verses`);

  const byLine = new Map<number, MushafWord[]>();
  const firstVerseOnLine = new Map<number, string>();
  for (const v of verses) {
    const [, ayah] = parseKey(v.verse_key);
    for (const w of v.words) {
      const words = byLine.get(w.line_number) ?? [];
      if (!words.length) firstVerseOnLine.set(w.line_number, v.verse_key);
      words.push(
        w.char_type_name === "end"
          ? { verseKey: v.verse_key, text: "", ayahEnd: ayah }
          : { verseKey: v.verse_key, text: w.text_uthmani ?? w.text ?? "" },
      );
      byLine.set(w.line_number, words);
    }
  }

  const used = [...byLine.keys()].sort((a, b) => a - b);
  // Pages 1 and 2 (Al-Fatiha, start of Al-Baqarah) are short decorated pages, not 15 lines.
  const total = page <= 2 ? (used[used.length - 1] ?? 0) : Math.max(MUSHAF_LINES, used[used.length - 1] ?? 0);
  const lines: MushafLine[] = [];
  // Assign header lines that sit right before a surah's first ayah (title, then Basmala except surahs 1 and 9).
  const headerFor = new Map<number, MushafLine>();
  for (const ln of used) {
    const [surah, ayah] = parseKey(firstVerseOnLine.get(ln)!);
    if (ayah !== 1) continue;
    let slot = ln - 1;
    if (surah !== 1 && surah !== 9 && slot >= 1 && !byLine.has(slot)) headerFor.set(slot--, { line: 0, kind: "basmala", surah });
    if (slot >= 1 && !byLine.has(slot)) headerFor.set(slot, { line: 0, kind: "surah", surah });
  }
  // Trailing empty lines: the next surah's header starts at the bottom of this page.
  const [lastSurah, lastAyah] = parseKey(verses[verses.length - 1]!.verse_key);
  const lastUsed = used[used.length - 1] ?? 0;
  if (lastAyah === ayahCount(lastSurah) && lastSurah < 114 && lastUsed < total) {
    headerFor.set(lastUsed + 1, { line: 0, kind: "surah", surah: lastSurah + 1 });
    if (lastUsed + 2 <= total && lastSurah + 1 !== 9) headerFor.set(lastUsed + 2, { line: 0, kind: "basmala", surah: lastSurah + 1 });
  }

  for (let ln = 1; ln <= total; ln++) {
    const words = byLine.get(ln);
    if (words) lines.push({ line: ln, kind: "ayah", words });
    else {
      const header = headerFor.get(ln);
      if (header) lines.push({ ...header, line: ln });
    }
  }
  return lines;
}
