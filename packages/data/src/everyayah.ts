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

/** Path of one continuous stretch of a surah recording, ayat `from`–`to`. */
export function localRunPath(reciterId: string, surah: number, from: number, to: number): string {
  return `/media/audio/${reciterId}/${pad3(surah)}${pad3(from)}-${pad3(to)}.mp3`;
}

/** Bytes [start, end] of `url`; `whole` when the server ignored the Range header and sent the entire file. */
export async function fetchAudioRange(url: string, start: number, end: number): Promise<{ data: Buffer; whole: boolean }> {
  let lastError: Error | undefined;
  for (let i = 0; i < 3; i++) {
    try {
      // Long runs span tens of MB; allow at least 50 kB/s.
      const timeout = Math.max(60_000, (end - start) / 50);
      const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(timeout) });
      if (res.status === 206) {
        const from = /^bytes (\d+)-/.exec(res.headers.get("content-range") ?? "")?.[1];
        if (Number(from) !== start) throw new Error(`audio ${url}: asked for byte ${start}, got ${from ?? "unknown"}`);
        return { data: Buffer.from(await res.arrayBuffer()), whole: false };
      }
      if (res.status === 200) return { data: Buffer.from(await res.arrayBuffer()), whole: true };
      if (res.status === 416) return { data: Buffer.alloc(0), whole: false };
      lastError = new Error(`audio ${url} failed: ${res.status}`);
      if (res.status === 404) break;
    } catch (e) {
      lastError = e as Error;
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** i));
  }
  throw lastError ?? new Error(`audio ${url} failed`);
}

export async function fetchAudioBuffer(url: string, timeoutMs = 60_000): Promise<Buffer> {
  let lastError: Error | undefined;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
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
