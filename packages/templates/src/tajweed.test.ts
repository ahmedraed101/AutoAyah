import { describe, expect, it } from "vitest";
import { parseTajweed, TAJWEED_COLORS } from "./tajweed";

describe("parseTajweed", () => {
  it("splits markup into plain and colored segments without losing text", () => {
    const markup = "بِسْمِ [h:1[ٱ][l[ل]لَّهِ [n[ـٰ]";
    const segments = parseTajweed(markup);
    expect(segments.map((s) => s.text).join("")).toBe("بِسْمِ ٱللَّهِ ـٰ");
    expect(segments[1]).toEqual({ text: "ٱ", color: TAJWEED_COLORS.h });
    expect(segments[2]).toEqual({ text: "ل", color: TAJWEED_COLORS.l });
    expect(segments[0]!.color).toBeUndefined();
  });

  it("returns plain text unchanged", () => {
    expect(parseTajweed("الحمد لله")).toEqual([{ text: "الحمد لله" }]);
  });
});
