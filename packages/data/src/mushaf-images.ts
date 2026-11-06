import { inflateRawSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";

/**
 * Scanned Madani Mushaf pages (Quran Android / quran.app public files) and the matching
 * "ayahinfo" database, which gives every glyph's bounding box on those 1024px-wide images.
 */
const BASE = "https://files.quran.app/hafs/madani";
export const MUSHAF_IMAGE_WIDTH = 1024;
const AYAHINFO_URL = `${BASE}/databases/ayahinfo/ayahinfo_1024.zip`;

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

export function mushafImageUrl(page: number): string {
  return `${BASE}/width_${MUSHAF_IMAGE_WIDTH}/page${String(page).padStart(3, "0")}.png`;
}

export function pngSize(png: Buffer): { width: number; height: number } {
  if (png.readUInt32BE(12) !== 0x49484452) throw new Error("Not a PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

export async function fetchMushafImage(page: number): Promise<Buffer> {
  return download(mushafImageUrl(page));
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

export async function fetchAyahInfoDb(): Promise<Buffer> {
  return unzipFirstDb(await download(AYAHINFO_URL));
}

const dbs = new Map<string, DatabaseSync>();

/** Per-ayah boxes (one per line the ayah touches) for a page, keyed "surah:ayah". */
export function ayahBoxes(dbPath: string, page: number): Record<string, AyahBox[]> {
  let db = dbs.get(dbPath);
  if (!db) {
    db = new DatabaseSync(dbPath, { readOnly: true });
    dbs.set(dbPath, db);
  }
  const rows = db
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
