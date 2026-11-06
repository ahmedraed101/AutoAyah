import { describe, expect, it } from "vitest";
import { VideoConfigSchema } from "./schemas.js";
import { projectName } from "./naming.js";
import { SURAH_AYAH_COUNTS, clipAyahCount, clipSegments, divisionRange, divisionsFromStarts, holdOverride, surahRange } from "./ranges.js";

const base = { reciter: "qdc-7", tafsir: "ar.muyassar", mode: "ayah" as const };

describe("clipSegments", () => {
  it("splits a clip that crosses surahs into one range per surah", () => {
    const juz30 = { surah: 78, from: 1, toSurah: 114, to: 6 };
    const segs = clipSegments(juz30);
    expect(segs).toHaveLength(37);
    expect(segs[0]).toEqual({ surah: 78, from: 1, to: 40 });
    expect(segs.at(-1)).toEqual({ surah: 114, from: 1, to: 6 });
    expect(clipAyahCount(juz30)).toBe(564);
  });

  it("keeps single-surah clips as they are", () => {
    expect(clipSegments({ surah: 18, from: 1, to: 10 })).toEqual([{ surah: 18, from: 1, to: 10 }]);
  });
});

describe("divisions", () => {
  it("ends each division just before the next one starts", () => {
    const [first, last] = divisionsFromStarts([
      { surah: 1, ayah: 1 },
      { surah: 2, ayah: 142 },
    ]);
    expect(first).toEqual({ n: 1, start: { surah: 1, ayah: 1 }, end: { surah: 2, ayah: 141 } });
    expect(last?.end).toEqual({ surah: 114, ayah: 6 });
    expect(SURAH_AYAH_COUNTS.reduce((a, b) => a + b)).toBe(6236);
  });

  it("produces configs the schema accepts", () => {
    const juz = VideoConfigSchema.parse({ ...base, ...divisionRange("juz", { n: 1, start: { surah: 1, ayah: 1 }, end: { surah: 2, ayah: 141 } }) });
    expect(juz).toMatchObject({ surah: 1, from: 1, toSurah: 2, to: 141, range: { kind: "juz", n: 1 } });
    expect(projectName(juz)).toMatch(/^juz1_001_001_002_141_/);
    expect(VideoConfigSchema.parse({ ...base, ...surahRange(18) })).toMatchObject({ surah: 18, from: 1, to: 110, toSurah: null });
  });

  it("rejects a range that ends before it starts", () => {
    expect(VideoConfigSchema.safeParse({ ...base, surah: 3, from: 1, toSurah: 2, to: 5 }).success).toBe(false);
  });
});

describe("holdOverride", () => {
  const timing = VideoConfigSchema.parse({ ...base, surah: 1, from: 1, to: 7 }).timing;
  it("reads surah:ayah keys and falls back to legacy ayah keys in the first surah", () => {
    const t = { ...timing, ayahOverrides: { "3": { holdSeconds: 2 }, "2:5": { holdSeconds: 4 } } };
    expect(holdOverride(t, 1, 3, 1)).toBe(2);
    expect(holdOverride(t, 2, 3, 1)).toBeUndefined();
    expect(holdOverride(t, 2, 5, 1)).toBe(4);
  });
});
