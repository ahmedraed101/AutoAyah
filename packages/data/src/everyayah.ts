import { parseBuffer } from "music-metadata";
import { DEFAULT_RECITERS } from "@autoayah/core";

const pad3 = (n: number) => String(n).padStart(3, "0");

export function everyayahUrl(reciterId: string, surah: number, ayah: number): string {
  return `https://everyayah.com/data/${reciterId}/${pad3(surah)}${pad3(ayah)}.mp3`;
}

/** Server-relative route that serves the recitation from the local cache (downloading once). */
export function localAudioPath(reciterId: string, surah: number, ayah: number): string {
  return `/media/audio/${reciterId}/${pad3(surah)}${pad3(ayah)}.mp3`;
}

export async function bufferDurationSeconds(buf: Buffer): Promise<number> {
  const meta = await parseBuffer(new Uint8Array(buf), { mimeType: "audio/mpeg" }, { duration: true });
  return meta.format.duration ?? 0;
}

export function listEveryayahReciters() {
  return DEFAULT_RECITERS.map((r) => ({
    id: r.id,
    name: r.name,
    source: "everyayah",
    hasWordTimings: r.qfRecitationId != null,
  }));
}

export async function fetchAudioBuffer(url: string): Promise<Buffer> {
  let lastError: Error | undefined;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      lastError = new Error(`audio ${url} failed: ${res.status}`);
      if (res.status === 404) break;
    } catch (e) {
      lastError = e as Error;
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** i));
  }
  throw lastError ?? new Error(`audio ${url} failed`);
}
