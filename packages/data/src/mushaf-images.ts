import { inflateRawSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";

/**
 * Scanned Madani Mushaf pages (Quran Android / quran.app public files) and the matching
 * "ayahinfo" database, which gives every glyph's bounding box on the images of the same width.
 * Each width is laid out on its own (not a plain rescale), so boxes must come from the matching database.
 */
const BASE = "https://files.quran.app/hafs/madani";
export const MUSHAF_IMAGE_WIDTH = 1024;
export const MUSHAF_HD_WIDTH = 1920;
const ayahInfoUrl = (width: number) => `${BASE}/databases/ayahinfo/ayahinfo_${width}.zip`;

/** [x, y, width, height] in image pixels. */
export type AyahBox = [number, number, number, number];

async function download(url: string, attempts = 3): Promise<Buffer> {
  let lastError: Error | undefined;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      lastError = new Error(`${url} failed: ${res.status}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) {
      lastError = e as Error;
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** i));
  }
  throw lastError ?? new Error(`${url} failed`);
}

export function mushafImageUrl(page: number, width: number = MUSHAF_IMAGE_WIDTH): string {
  return `${BASE}/width_${width}/page${String(page).padStart(3, "0")}.png`;
}

export function pngSize(png: Buffer): { width: number; height: number } {
  if (png.readUInt32BE(12) !== 0x49484452) throw new Error("Not a PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

export async function fetchMushafImage(page: number, width: number = MUSHAF_IMAGE_WIDTH): Promise<Buffer> {
  return download(mushafImageUrl(page, width));
}

/** Extract the first .db file from a zip (stored or deflated) without extra dependencies. */
function unzipFirstDb(zip: Buffer): Buffer {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("Invalid zip");
  const entries = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < entries; i++) {
    const method = zip.readUInt16LE(p + 10);
    const compressed = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
    if (name.endsWith(".db")) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + compressed);
      return method === 0 ? Buffer.from(data) : inflateRawSync(data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error("ayahinfo database not found in zip");
}

export async function fetchAyahInfoDb(width: number = MUSHAF_IMAGE_WIDTH): Promise<Buffer> {
  return unzipFirstDb(await download(ayahInfoUrl(width)));
}

const dbs = new Map<string, DatabaseSync>();

function openDb(dbPath: string): DatabaseSync {
  let db = dbs.get(dbPath);
  if (!db) {
    db = new DatabaseSync(dbPath, { readOnly: true });
    dbs.set(dbPath, db);
  }
  return db;
}

/** Waqf signs are separate small glyphs drawn above the line (≈20px tall, a few px wide at 1024px). */
const isPauseMark = (w: number, h: number, scale: number) => h < 26 * scale && w < 20 * scale;

/**
 * Per-word boxes in reading order, keyed "surah:ayah". Pause marks and the ayah-end medallion are
 * dropped; `wordCounts` trims leading glyphs such as the ۞ hizb-quarter sign.
 */
export function wordBoxes(
  dbPath: string,
  page: number,
  wordCounts: Record<string, number>,
  imageWidth: number = MUSHAF_IMAGE_WIDTH,
): Record<string, AyahBox[]> {
  const scale = imageWidth / MUSHAF_IMAGE_WIDTH;
  const rows = openDb(dbPath)
    .prepare(
      `SELECT sura_number s, ayah_number a, min_x x0, max_x x1, min_y y0, max_y y1
       FROM glyphs WHERE page_number = ? ORDER BY sura_number, ayah_number, position`,
    )
    .all(page) as { s: number; a: number; x0: number; x1: number; y0: number; y1: number }[];
  const glyphs: Record<string, AyahBox[]> = {};
  for (const r of rows) {
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    if (isPauseMark(w, h, scale)) continue;
    (glyphs[`${r.s}:${r.a}`] ??= []).push([Math.min(r.x0, r.x1), r.y0, Math.abs(w), h]);
  }
  const out: Record<string, AyahBox[]> = {};
  for (const [key, boxes] of Object.entries(glyphs)) {
    const words = boxes.slice(0, -1);
    const expected = wordCounts[key];
    out[key] = expected && words.length > expected ? words.slice(words.length - expected) : words;
  }
  return out;
}

/** Per-ayah boxes (one per line the ayah touches) for a page, keyed "surah:ayah". */
export function ayahBoxes(dbPath: string, page: number): Record<string, AyahBox[]> {
  const rows = openDb(dbPath)
    .prepare(
      `SELECT sura_number s, ayah_number a, line_number l,
              MIN(min_x) x0, MAX(max_x) x1, MIN(min_y) y0, MAX(max_y) y1
       FROM glyphs WHERE page_number = ? GROUP BY sura_number, ayah_number, line_number
       ORDER BY sura_number, ayah_number, line_number`,
    )
    .all(page) as { s: number; a: number; x0: number; x1: number; y0: number; y1: number }[];
  const out: Record<string, AyahBox[]> = {};
  for (const r of rows) (out[`${r.s}:${r.a}`] ??= []).push([r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0]);
  return out;
}
