import { describe, expect, it } from "vitest";
import { VideoConfigSchema } from "./schemas.js";
import { buildTimeline, paginateTafsir } from "./timing.js";
import type { ResolvedClip } from "./schemas.js";

const clip: ResolvedClip = {
  surah: 1,
  surahName: "الفاتحة",
  ayat: [
    {
      number: 1,
      text: "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ",
      tafsir: "أبدأ قراءة القرآن باسم الله مستعينا به",
      audioUrl: "https://example.com/1.mp3",
      audioSeconds: 4,
    },
    {
      number: 2,
      text: "ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ",
      tafsir: "جميع أنواع المحامد ثابتة لله وحده",
      audioUrl: "https://example.com/2.mp3",
      audioSeconds: 3,
    },
  ],
};

describe("paginateTafsir", () => {
  it("keeps short text as one page", () => {
    expect(paginateTafsir("short")).toEqual(["short"]);
  });

  it("splits long text", () => {
    const long = Array.from({ length: 80 }, () => "كلمة").join(" ");
    const pages = paginateTafsir(long, 40);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.join(" ").replace(/\s+/g, " ")).toContain("كلمة");
  });
});

describe("buildTimeline", () => {
  it("continuous uses audio durations", () => {
    const config = VideoConfigSchema.parse({
      surah: 1,
      from: 1,
      to: 2,
      reciter: "Alafasy_128kbps",
      mode: "ayah",
      timing: { mode: "continuous" },
    });
    const tl = buildTimeline(config, clip);
    expect(tl.slides).toHaveLength(2);
    expect(tl.slides[0]!.durationInSeconds).toBeCloseTo(4.4, 1);
    expect(tl.totalFrames).toBeGreaterThan(0);
  });

  it("reading mode can extend beyond audio", () => {
    const longTafsir = Array.from({ length: 100 }, () => "كلمة").join(" ");
    const longClip: ResolvedClip = {
      ...clip,
      ayat: [{ ...clip.ayat[0]!, tafsir: longTafsir, audioSeconds: 2 }],
    };
    const config = VideoConfigSchema.parse({
      surah: 1,
      from: 1,
      to: 1,
      reciter: "Alafasy_128kbps",
      mode: "ayahTafsir",
      timing: { mode: "reading", readingSpeed: "verySlow" },
    });
    const tl = buildTimeline(config, longClip);
    expect(tl.slides[0]!.durationInSeconds).toBeGreaterThan(2.5);
  });

  it("ayah override wins", () => {
    const config = VideoConfigSchema.parse({
      surah: 1,
      from: 1,
      to: 1,
      reciter: "Alafasy_128kbps",
      mode: "ayah",
      timing: { mode: "continuous", ayahOverrides: { "1": { holdSeconds: 12 } } },
    });
    const tl = buildTimeline(config, { ...clip, ayat: [clip.ayat[0]!] });
    expect(tl.slides[0]!.durationInSeconds).toBeCloseTo(12, 0);
  });
});
