import { useEffect, useState } from "react";
import { endSurah, spansSurahs, type QuranDivision, type QuranDivisions, type VideoConfig } from "@autoayah/core";
import { api } from "./api";

export type Surah = { number: number; name: string; englishName: string; numberOfAyahs: number };

function useCached<T>(load: () => Promise<T>, slot: { p?: Promise<T> }, initial: T) {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    slot.p ??= load().catch((e: unknown) => {
      slot.p = undefined;
      throw e;
    });
    let live = true;
    slot.p.then((v) => live && setValue(v)).catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}

const surahCache: { p?: Promise<Surah[]> } = {};
const divisionCache: { p?: Promise<QuranDivisions> } = {};

export const useSurahs = () => useCached(api.surahs, surahCache, []);
export const useDivisions = () => useCached<QuranDivisions | undefined>(api.divisions, divisionCache, undefined);

export const localDigits = (n: number, lang: string) => (lang === "ar" ? n.toLocaleString("ar-EG") : String(n));

export function surahTitle(surahs: Surah[], n: number, lang: string) {
  const s = surahs.find((x) => x.number === n);
  return lang === "ar" ? (s?.name ?? String(n)) : (s?.englishName ?? `Surah ${n}`);
}

type Range = Pick<VideoConfig, "surah" | "from" | "to"> & { toSurah?: number | null };

/** "Al-Kahf 1–10", or "An-Naba 1 – An-Nas 6" when the clip crosses surahs. */
export function rangeText(c: Range, surahs: Surah[], lang: string) {
  const d = (n: number) => localDigits(n, lang);
  const first = surahTitle(surahs, c.surah, lang);
  if (spansSurahs(c)) return `${first} ${d(c.from)} – ${surahTitle(surahs, endSurah(c), lang)} ${d(c.to)}`;
  return `${first} ${c.from === c.to ? d(c.from) : `${d(c.from)}–${d(c.to)}`}`;
}

/** Picker label: "٢ ـ إِنَّ ٱللَّهَ (البقرة ٢٦–٤٣)", "١ ـ بِسْمِ ٱللَّهِ (الفاتحة ١ إلى البقرة ٢٥)". */
export function divisionLabel(d: QuranDivision, surahs: Surah[], lang: string) {
  const n = (x: number) => localDigits(x, lang);
  const name = (s: number) => (lang === "ar" ? surahTitle(surahs, s, lang).replace(/^سُورَةُ\s+/, "") : surahTitle(surahs, s, lang));
  const { start, end } = d;
  const span =
    start.surah !== end.surah
      ? `${name(start.surah)} ${n(start.ayah)} ${lang === "ar" ? "إلى" : "–"} ${name(end.surah)} ${n(end.ayah)}`
      : `${name(start.surah)} ${start.ayah === end.ayah ? n(start.ayah) : `${n(start.ayah)}–${n(end.ayah)}`}`;
  const head = lang === "ar" ? `${n(d.n)} ـ` : `${d.n}.`;
  return d.opening ? `${head} ${d.opening} (${span})` : `${head} ${span}`;
}
