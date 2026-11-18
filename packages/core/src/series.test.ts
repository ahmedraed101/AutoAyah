import { describe, expect, it } from "vitest";
import { VideoConfigSchema } from "./schemas.js";
import { ayahCount, divisionsFromStarts, previousAyah, type AyahRef, type QuranDivisions } from "./ranges.js";
import { seriesUnits, unitJuz, unitsToQueue } from "./series.js";

const base = { reciter: "qdc-7", mode: "ayah" as const };

function refAt(index: number): AyahRef {
  let left = index;
  for (let surah = 1; surah <= 114; surah++) {
    const count = ayahCount(surah);
    if (left < count) return { surah, ayah: left + 1 };
    left -= count;
  }
  return { surah: 114, ayah: ayahCount(114) };
}

/** `parts` contiguous divisions that together cover the Quran. */
function cover(parts: number) {
  return divisionsFromStarts(Array.from({ length: parts }, (_, i) => refAt(Math.floor((i * 6236) / parts))));
}

const divisions: QuranDivisions = {
  juz: cover(30),
  hizb: cover(60),
  rub: cover(240),
  page: cover(604),
  manzil: cover(7),
};

describe("seriesUnits", () => {
  it("lists all 114 surahs, 604 pages and 240 quarters as valid videos", () => {
    const surahs = seriesUnits("surah", divisions);
    const pages = seriesUnits("page", divisions);
    const rubs = seriesUnits("rub", divisions);
    expect(surahs).toHaveLength(114);
    expect(surahs[0]?.key).toBe("surah:1");
    expect(surahs.at(-1)).toMatchObject({ key: "surah:114", range: { surah: 114, from: 1, to: 6, toSurah: null } });
    expect(pages).toHaveLength(604);
    expect(pages[0]?.key).toBe("page:1");
    expect(pages.at(-1)?.key).toBe("page:604");
    expect(rubs).toHaveLength(240);
    const bad = [...surahs, ...pages, ...rubs].filter((unit) => !VideoConfigSchema.safeParse({ ...base, ...unit.range }).success);
    expect(bad.map((unit) => unit.key)).toEqual([]);
  });

  it("splits a surah into chunks and keeps the short last piece", () => {
    const chunks = seriesUnits("chunk", divisions, { chunkSize: 50, chunkSurahs: [2, 112] });
    expect(chunks.filter((c) => c.key.startsWith("chunk:2:")).map((c) => c.key)).toEqual([
      "chunk:2:1-50",
      "chunk:2:51-100",
      "chunk:2:101-150",
      "chunk:2:151-200",
      "chunk:2:201-250",
      "chunk:2:251-286",
    ]);
    expect(chunks.at(-1)?.key).toBe("chunk:112:1-4");
    expect(seriesUnits("chunk", divisions, { chunkSize: 10, chunkSurahs: [108] }).map((c) => c.key)).toEqual(["chunk:108:1-3"]);
    expect(chunks.every((unit) => VideoConfigSchema.safeParse({ ...base, ...unit.range }).success)).toBe(true);
  });

  it("returns no chunks until surahs are chosen", () => {
    expect(seriesUnits("chunk", divisions, { chunkSize: 10 })).toEqual([]);
  });
});

describe("unitJuz", () => {
  it("returns the juz that holds the unit's first ayah", () => {
    const fifth = divisions.juz[4]!;
    const atStart = { range: { surah: fifth.start.surah, from: fifth.start.ayah, to: fifth.start.ayah, toSurah: null, range: null } };
    expect(unitJuz(atStart, divisions)).toBe(5);
    const prev = previousAyah(fifth.start)!;
    expect(unitJuz({ range: { surah: prev.surah, from: prev.ayah, to: prev.ayah, toSurah: null, range: null } }, divisions)).toBe(4);
  });
});

describe("unitsToQueue", () => {
  const units = seriesUnits("surah", divisions);
  const status = new Map(units.map((unit) => [unit.key, unit.key === "surah:1" ? "done" : unit.key === "surah:2" ? "rendering" : "none"]));
  const statusOf = (unit: (typeof units)[number]) => status.get(unit.key);

  it("skips videos that are done or already rendering", () => {
    const picked = unitsToQueue(units, { type: "range", from: 1, to: 3 }, statusOf, false);
    expect(picked.queue.map((unit) => unit.key)).toEqual(["surah:3"]);
    expect(picked.skipped).toBe(2);
  });

  it("leaves a unit alone after its video file was deleted", () => {
    const few = units.slice(0, 3);
    const statusOf = (unit: (typeof few)[number]) => (unit.key === "surah:1" ? "removed" : "none");
    const picked = unitsToQueue(few, { type: "all" }, statusOf, false);
    expect(picked.queue.map((unit) => unit.key)).toEqual(["surah:2", "surah:3"]);
    expect(picked.skipped).toBe(1);
    expect(unitsToQueue(few, { type: "nextN", n: 1 }, statusOf, false).queue.map((unit) => unit.key)).toEqual(["surah:2"]);
    expect(unitsToQueue(few, { type: "keys", keys: ["surah:1"] }, statusOf, true).queue.map((unit) => unit.key)).toEqual(["surah:1"]);
  });

  it("includes them again when regenerating, and nextN walks past them", () => {
    expect(unitsToQueue(units, { type: "range", from: 1, to: 1 }, statusOf, true).queue.map((unit) => unit.key)).toEqual(["surah:1"]);
    expect(unitsToQueue(units, { type: "nextN", n: 2 }, statusOf, false).queue.map((unit) => unit.key)).toEqual(["surah:3", "surah:4"]);
    expect(unitsToQueue(units, { type: "keys", keys: ["surah:2", "surah:9"] }, statusOf, false).queue.map((unit) => unit.key)).toEqual(["surah:9"]);
  });
});
