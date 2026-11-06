import type { RangeKind, TimingConfig, VideoConfig } from "./schemas.js";

/** Ayat per surah, 1-114 (6236 in total), from AlQuran.cloud /meta. */
export const SURAH_AYAH_COUNTS = [
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69,
  60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11,
  11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19,
  5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6,
] as const;

export const ayahCount = (surah: number) => SURAH_AYAH_COUNTS[surah - 1] ?? 0;

export type AyahRef = { surah: number; ayah: number };
export type ClipSegment = { surah: number; from: number; to: number };
type RangeConfig = Pick<VideoConfig, "surah" | "from" | "to"> & { toSurah?: number | null };

export const endSurah = (c: RangeConfig) => c.toSurah ?? c.surah;
export const spansSurahs = (c: RangeConfig) => endSurah(c) !== c.surah;

/** The clip split into one ayah range per surah. */
export function clipSegments(c: RangeConfig): ClipSegment[] {
  const last = endSurah(c);
  const out: ClipSegment[] = [];
  for (let s = c.surah; s <= last; s++) {
    out.push({ surah: s, from: s === c.surah ? c.from : 1, to: s === last ? c.to : ayahCount(s) });
  }
  return out;
}

export const clipAyahCount = (c: RangeConfig) => clipSegments(c).reduce((n, s) => n + s.to - s.from + 1, 0);

/** "surah:ayah" — unique across a multi-surah clip. */
export const ayahKey = (surah: number, ayah: number) => `${surah}:${ayah}`;

/** Hold override for an ayah; single-surah projects may still key them by ayah number alone. */
export function holdOverride(timing: TimingConfig, surah: number, ayah: number, clipSurah: number): number | undefined {
  const o = timing.ayahOverrides ?? {};
  return (o[ayahKey(surah, ayah)] ?? (surah === clipSurah ? o[String(ayah)] : undefined))?.holdSeconds;
}

/** The ayah just before `ref`, or null at 1:1. */
export function previousAyah(ref: AyahRef): AyahRef | null {
  if (ref.ayah > 1) return { surah: ref.surah, ayah: ref.ayah - 1 };
  if (ref.surah > 1) return { surah: ref.surah - 1, ayah: ayahCount(ref.surah - 1) };
  return null;
}

export type QuranDivision = { n: number; start: AyahRef; end: AyahRef };
export type QuranDivisions = Record<Exclude<RangeKind, "surah">, QuranDivision[]>;

/** Turns the start of each division into [start, end] ranges (each ends just before the next begins). */
export function divisionsFromStarts(starts: AyahRef[]): QuranDivision[] {
  return starts.map((start, i) => {
    const next = starts[i + 1];
    const end = next ? previousAyah(next)! : { surah: 114, ayah: ayahCount(114) };
    return { n: i + 1, start, end };
  });
}

/** Config fields that select a division. */
export function divisionRange(kind: RangeKind, d: QuranDivision): Pick<VideoConfig, "surah" | "from" | "to" | "toSurah" | "range"> {
  return {
    surah: d.start.surah,
    from: d.start.ayah,
    toSurah: d.end.surah === d.start.surah ? null : d.end.surah,
    to: d.end.ayah,
    range: { kind, n: d.n },
  };
}

export function surahRange(surah: number): Pick<VideoConfig, "surah" | "from" | "to" | "toSurah" | "range"> {
  return { surah, from: 1, toSurah: null, to: ayahCount(surah), range: { kind: "surah", n: surah } };
}
