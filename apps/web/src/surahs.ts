import { useEffect, useState } from "react";
import { api } from "./api";

export type Surah = { number: number; name: string; englishName: string; numberOfAyahs: number };

let cache: Promise<Surah[]> | undefined;

export function useSurahs() {
  const [surahs, setSurahs] = useState<Surah[]>([]);
  useEffect(() => {
    cache ??= api.surahs().catch((e: unknown) => {
      cache = undefined;
      throw e;
    });
    let live = true;
    cache.then((s) => live && setSurahs(s)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return surahs;
}

export const localDigits = (n: number, lang: string) => (lang === "ar" ? n.toLocaleString("ar-EG") : String(n));
