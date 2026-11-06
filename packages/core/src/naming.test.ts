import { describe, expect, it } from "vitest";
import { VideoConfigSchema } from "./schemas.js";
import { projectName, renderFileName } from "./naming.js";

const base = { surah: 25, from: 7, to: 8, reciter: "Alafasy_128kbps", tafsir: "ar.muyassar", mode: "ayahTafsir" as const };

describe("projectName", () => {
  it("starts with surah_from_to_reciter and lists the main attributes", () => {
    const name = projectName(VideoConfigSchema.parse(base));
    expect(name).toMatch(/^025_007_008_Alafasy_128kbps_ayahTafsir_9x16_ar\.muyassar_continuous_light_tajweed_nobg_[0-9a-f]{8}$/);
  });

  it("ignores the export format so one project covers every format", () => {
    const mp4 = VideoConfigSchema.parse({ ...base, export: "mp4" });
    const png = VideoConfigSchema.parse({ ...base, export: "png", pngFrame: 30 });
    expect(projectName(mp4)).toBe(projectName(png));
  });

  it("changes when any visual attribute changes", () => {
    const a = VideoConfigSchema.parse(base);
    const b = VideoConfigSchema.parse({ ...base, style: { cardColor: "#ffffff" } });
    expect(projectName(a)).not.toBe(projectName(b));
  });
});

describe("renderFileName", () => {
  it("adds the format and still frame", () => {
    expect(renderFileName(VideoConfigSchema.parse(base))).toMatch(/\.mp4$/);
    expect(renderFileName(VideoConfigSchema.parse({ ...base, export: "png", pngFrame: 30 }))).toMatch(/_f30\.png$/);
    expect(renderFileName(VideoConfigSchema.parse({ ...base, export: "batch" }))).toMatch(/\.zip$/);
  });
});
