import { useEffect, useState } from "react";
import { api } from "./api";

export type CatalogEntry = { id: string; name: string; nameAr?: string; language?: string; hasWordTimings?: boolean };
export type Catalog = { reciters: CatalogEntry[]; tafsirs: CatalogEntry[]; translations: CatalogEntry[] };

const EMPTY: Catalog = { reciters: [], tafsirs: [], translations: [] };
let cache: Promise<Catalog> | undefined;

export function useCatalog() {
  const [catalog, setCatalog] = useState<Catalog>(EMPTY);
  useEffect(() => {
    cache ??= Promise.all([api.reciters(), api.tafsirs(), api.translations()])
      .then(([reciters, tafsirs, translations]) => ({ reciters, tafsirs, translations }))
      .catch((e: unknown) => {
        cache = undefined;
        throw e;
      });
    let live = true;
    cache.then((c) => live && setCatalog(c)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return catalog;
}

export function groupBy<T>(items: T[], key: (item: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  return [...groups];
}

/** Catalogs mix ISO codes ("ar") and English names ("arabic"); show one localized label per language. */
const LANGUAGE_CODES: Record<string, string> = { arabic: "ar", english: "en", urdu: "ur", bengali: "bn", russian: "ru", kurdish: "ku" };
export function languageName(language: string | undefined, uiLang: string): string {
  const raw = (language ?? "").toLowerCase();
  const code = LANGUAGE_CODES[raw] ?? raw;
  try {
    return (code.length <= 3 && new Intl.DisplayNames([uiLang], { type: "language" }).of(code)) || language || "—";
  } catch {
    return language || "—";
  }
}

export const entryName = (list: CatalogEntry[], id: string, lang: string) => {
  const e = list.find((x) => x.id === id);
  return e ? (lang === "ar" && e.nameAr) || e.name : id;
};
