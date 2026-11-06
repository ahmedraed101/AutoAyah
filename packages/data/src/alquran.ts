const API = "https://api.alquran.cloud/v1";

export type SurahMeta = { number: number; name: string; englishName: string; numberOfAyahs: number };
export type EditionAyah = { numberInSurah: number; text: string; page?: number };
export type Edition = {
  name: string; // surah name in this API
  edition: { identifier: string; name?: string; englishName?: string };
  ayahs: EditionAyah[];
};
export type PageAyah = { surah: number; numberInSurah: number; text: string };

async function fetchJson<T>(url: string, attempts = 3): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) return (await res.json()) as T;
      lastError = new Error(`AlQuran.cloud ${url} failed: ${res.status}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) {
      lastError = e as Error;
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** i));
  }
  throw lastError ?? new Error(`AlQuran.cloud ${url} failed`);
}

export async function fetchSurahList(): Promise<SurahMeta[]> {
  const { data } = await fetchJson<{ data: SurahMeta[] }>(`${API}/surah`);
  return data.map(({ number, name, englishName, numberOfAyahs }) => ({ number, name, englishName, numberOfAyahs }));
}

type Ref = { surah: number; ayah: number };

/** Where each juz, hizb quarter, page and manzil starts. */
export async function fetchDivisionStarts(): Promise<{ juz: Ref[]; rub: Ref[]; page: Ref[]; manzil: Ref[] }> {
  const { data } = await fetchJson<{
    data: Record<"juzs" | "hizbQuarters" | "pages" | "manzils", { references: Ref[] }>;
  }>(`${API}/meta`);
  const refs = (k: keyof typeof data) => data[k].references.map(({ surah, ayah }) => ({ surah, ayah }));
  return { juz: refs("juzs"), rub: refs("hizbQuarters"), page: refs("pages"), manzil: refs("manzils") };
}

export async function fetchSurahEditions(surah: number, editions: string[]): Promise<Edition[]> {
  const ids = editions.filter(Boolean).map(encodeURIComponent).join(",");
  const { data } = await fetchJson<{ data: Edition[] | Edition }>(`${API}/surah/${surah}/editions/${ids}`);
  return Array.isArray(data) ? data : [data];
}

export async function fetchPage(page: number): Promise<PageAyah[]> {
  const { data } = await fetchJson<{
    data: { ayahs: { numberInSurah: number; text: string; surah: { number: number } }[] };
  }>(`${API}/page/${page}/quran-uthmani`);
  return data.ayahs.map((a) => ({ surah: a.surah.number, numberInSurah: a.numberInSurah, text: a.text }));
}

export const TAJWEED_EDITION = "quran-tajweed";

export const PUBLIC_TAFSIRS = [
  { id: "ar.muyassar", name: "التفسير الميسر", language: "ar", source: "alquran" },
  { id: "ar.jalalayn", name: "تفسير الجلالين", language: "ar", source: "alquran" },
  { id: "ar.qurtubi", name: "تفسير القرطبي", language: "ar", source: "alquran" },
  { id: "ar.baghawi", name: "تفسير البغوي", language: "ar", source: "alquran" },
  { id: "ar.waseet", name: "التفسير الوسيط", language: "ar", source: "alquran" },
  { id: "ar.miqbas", name: "تنوير المقباس", language: "ar", source: "alquran" },
];

export const PUBLIC_TRANSLATIONS = [
  { id: "en.sahih", name: "Saheeh International", language: "en", source: "alquran" },
  { id: "en.pickthall", name: "Pickthall", language: "en", source: "alquran" },
  { id: "fr.hamidullah", name: "Hamidullah", language: "fr", source: "alquran" },
  { id: "id.indonesian", name: "Indonesian", language: "id", source: "alquran" },
  { id: "tr.diyanet", name: "Diyanet", language: "tr", source: "alquran" },
  { id: "ur.jalandhry", name: "Jalandhry", language: "ur", source: "alquran" },
];
