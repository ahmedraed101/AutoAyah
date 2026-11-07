/**
 * mp3quran.net: whole-surah recordings with per-ayah start/end times (no word timings).
 * A "read" is one reciter's recording in one rewaya; its id is also the moshaf id in the reciters catalog.
 */
const API = "https://www.mp3quran.net/api/v3";

const pad3 = (n: number) => String(n).padStart(3, "0");

async function mq<T>(path: string, attempts = 3): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${API}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
      if (res.ok) return (await res.json()) as T;
      lastError = new Error(`mp3quran ${path} failed: ${res.status}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) {
      lastError = e as Error;
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * 2 ** i));
  }
  throw lastError ?? new Error(`mp3quran ${path} failed`);
}

export type Mp3qRead = {
  id: number;
  name: string;
  nameAr: string;
  mujawwad: boolean;
  folderUrl: string;
  /** Surahs with audio, from the moshaf entry; null when the reciters catalog didn't list this read. */
  surahs: number[] | null;
};

type RawRead = { id: number; name: string; rewaya: string; folder_url: string };
type RawReciter = { name: string; moshaf: { id: number; server: string; surah_list: string }[] };

/** Our text is Hafs 'an 'Asim, so only Hafs recordings (murattal or the mujawwad mushaf) can be paired with it. */
const HAFS_MURATTAL = "حفص عن عاصم";
const HAFS_MUJAWWAD = "المصحف المجود";
const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

export function hafsReads(reads: RawRead[], reciters: RawReciter[]): Mp3qRead[] {
  const moshaf = new Map(reciters.flatMap((r) => r.moshaf.map((m) => [m.id, { ...m, reciter: tidy(r.name) }] as const)));
  return reads.flatMap((r) => {
    const rewaya = tidy(r.rewaya);
    if (rewaya !== HAFS_MURATTAL && rewaya !== HAFS_MUJAWWAD) return [];
    const m = moshaf.get(r.id);
    const known = m && m.server === r.folder_url;
    return [
      {
        id: r.id,
        name: (known && m.reciter) || tidy(r.name),
        nameAr: tidy(r.name),
        mujawwad: rewaya === HAFS_MUJAWWAD,
        folderUrl: r.folder_url,
        surahs: known ? m.surah_list.split(",").map(Number).filter(Boolean) : null,
      },
    ];
  });
}

export async function listMp3qReads(): Promise<Mp3qRead[]> {
  const [reads, reciters] = await Promise.all([
    mq<RawRead[]>("/ayat_timing/reads"),
    mq<{ reciters: RawReciter[] }>("/reciters?language=eng"),
  ]);
  return hafsReads(reads, reciters.reciters);
}

/** Surahs that have ayah timings for a read. */
export async function fetchMp3qSoar(readId: number): Promise<number[]> {
  return (await mq<{ id: number }[]>(`/ayat_timing/soar?read=${readId}`)).map((s) => s.id);
}

export type Mp3qTiming = { ayah: number; start_time: number; end_time: number };

export async function fetchMp3qTiming(readId: number, surah: number): Promise<Mp3qTiming[]> {
  const rows = await mq<Mp3qTiming[]>(`/ayat_timing?surah=${surah}&read=${readId}`);
  const out = rows.map((r) => ({ ayah: Number(r.ayah), start_time: Number(r.start_time), end_time: Number(r.end_time) }));
  if (!out.some((r) => r.ayah >= 1)) throw new Error(`mp3quran has no ayah timings for read ${readId} surah ${surah}`);
  return out;
}

export const mp3qAudioUrl = (read: Pick<Mp3qRead, "folderUrl">, surah: number) => `${read.folderUrl}${pad3(surah)}.mp3`;

/**
 * Where ayat `from`–`to` sit in the surah file, or null unless every one has a usable span.
 * Ayah 0 (isti'adha / basmala lead-in) is never part of a run: the basmala is drawn, not played, like Quran.com's files.
 */
export function mp3qSpans(rows: Mp3qTiming[], from: number, to: number): Map<number, { fromMs: number; toMs: number }> | null {
  const spans = new Map<number, { fromMs: number; toMs: number }>();
  for (const r of rows) {
    if (r.ayah >= from && r.ayah <= to && r.ayah >= 1 && r.end_time > r.start_time) spans.set(r.ayah, { fromMs: r.start_time, toMs: r.end_time });
  }
  return spans.size === to - from + 1 ? spans : null;
}
