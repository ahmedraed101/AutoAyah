import { describe, expect, it } from "vitest";
import type { Slide } from "@autoayah/core";
import { wordIndexAt } from "./remotion/frames";

const slide = (wordTimings?: Slide["ayah"]["wordTimings"]): Slide => ({
  ayah: { number: 1, text: "قل هو الله أحد", words: ["قل", "هو", "الله", "أحد"], audioUrl: "", audioSeconds: 2, wordTimings },
  startFrame: 0,
  durationInFrames: 60,
  durationInSeconds: 2,
  tafsirPages: [],
  backgroundIndex: 0,
});

describe("wordIndexAt", () => {
  it("follows the reciter's word timings", () => {
    const s = slide([
      { index: 1, text: "", startMs: 0, endMs: 500 },
      { index: 2, text: "", startMs: 500, endMs: 1000 },
    ]);
    expect(wordIndexAt(s, 3, 30)).toBe(0);
    expect(wordIndexAt(s, 20, 30)).toBe(1);
    expect(wordIndexAt(s, 50, 30)).toBe(1);
  });

  it("lights nothing when the ayah has no word timings", () => {
    expect(wordIndexAt(slide(), 30, 30)).toBe(-1);
  });
});
