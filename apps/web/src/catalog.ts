import { useEffect, useState } from "react";
import { api } from "./api";

export type CatalogEntry = { id: string; name: string; nameAr?: string; language?: string };
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

export const entryName = (list: CatalogEntry[], id: string, lang: string) => {
  const e = list.find((x) => x.id === id);
  return e ? (lang === "ar" && e.nameAr) || e.name : id;
};
