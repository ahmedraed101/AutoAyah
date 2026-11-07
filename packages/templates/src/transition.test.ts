import { describe, expect, it } from "vitest";
import { VideoConfigSchema, type Slide, type Timeline } from "@autoayah/core";
import { layoutSpans, slideStateAt } from "./remotion/frames";

const slide = (n: number, startFrame: number): Slide => ({
  ayah: { number: n, text: "قل هو الله أحد", audioUrl: "", audioSeconds: 2 },
  startFrame,
  durationInFrames: 60,
  durationInSeconds: 2,
  tafsirPages: [],
  backgroundIndex: 0,
});

const timeline = { slides: [slide(1, 0), slide(2, 60)], fps: 30, width: 1080, height: 1920, totalFrames: 120 } as Timeline;

const spans = (transition?: string) => {
  const config = VideoConfigSchema.parse({ surah: 112, from: 1, to: 2, reciter: "r", style: transition ? { transition } : {} });
  return layoutSpans({ timeline, config });
};

describe("span transitions", () => {
  it("default to a fade that settles between transitions", () => {
    const [first, second] = spans();
    expect(first!.transition).toBe("fade");
    expect(slideStateAt(first!, 30, 30)).toMatchObject({ enter: 1, shift: 0 });
    const leaving = slideStateAt(first!, 55, 30);
    expect(leaving.enter).toBeLessThan(1);
    expect(leaving.shift).toBeGreaterThan(0);
    const entering = slideStateAt(second!, 62, 30);
    expect(entering.enter).toBeLessThan(1);
    expect(entering.shift).toBeLessThan(0);
  });

  it("never fades the opening or closing frame", () => {
    const [first, second] = spans("slide");
    expect(slideStateAt(first!, 0, 30)).toMatchObject({ enter: 1, shift: 0 });
    expect(slideStateAt(second!, 119, 30)).toMatchObject({ enter: 1, shift: 0 });
  });

  it("cuts straight across with no transition", () => {
    const [first, second] = spans("none");
    expect(slideStateAt(first!, 59, 30)).toMatchObject({ enter: 1, shift: 0 });
    expect(slideStateAt(second!, 60, 30)).toMatchObject({ enter: 1, shift: 0 });
  });
});
