import { fetchAudioRange } from "./everyayah.js";
import { cbrByteRange, cbrLayout, id3Size, sliceCbrChunk, sliceMp3, type CbrLayout } from "./mp3.js";

const HEAD_BYTES = 64 * 1024;

const layouts = new Map<string, Promise<CbrLayout | null>>();

/** Null when the file isn't CBR, or the server ignores Range (the caller then downloads and caches it whole). */
async function remoteLayout(url: string): Promise<CbrLayout | null> {
  const head = await fetchAudioRange(url, 0, HEAD_BYTES - 1);
  if (head.whole) return null;
  const tag = id3Size(head.data);
  if (tag + HEAD_BYTES / 4 <= head.data.length) return cbrLayout(head.data);
  // Large ID3 tag (cover art): read the frames that follow it.
  const after = await fetchAudioRange(url, tag, tag + HEAD_BYTES - 1);
  return after.whole ? null : cbrLayout(after.data, tag);
}

/**
 * Cut [fromMs, toMs) out of a remote MP3, downloading only the bytes it spans.
 * Null when that isn't possible for this file.
 */
export async function fetchMp3Span(url: string, fromMs: number, toMs: number): Promise<Buffer | null> {
  let pending = layouts.get(url);
  if (!pending) {
    pending = remoteLayout(url);
    layouts.set(url, pending);
    pending.catch(() => layouts.delete(url));
  }
  const layout = await pending;
  if (!layout) return null;
  const [start, end] = cbrByteRange(layout, fromMs, toMs);
  const chunk = await fetchAudioRange(url, start, end);
  if (chunk.whole) return sliceMp3(chunk.data, fromMs, toMs);
  return sliceCbrChunk(chunk.data, start, layout, fromMs, toMs);
}
