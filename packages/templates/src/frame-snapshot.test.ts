import { describe, expect, it } from "vitest";
import { paginateTafsir, toArabicDigits } from "@autoayah/core";

/** Frame snapshot helpers — full Remotion frame capture is covered by render smoke. */
describe("template helpers", () => {
  it("arabic digits", () => {
    expect(toArabicDigits(7)).toBe("٧");
  });

  it("tafsir pages for long text", () => {
    const pages = paginateTafsir("أ ".repeat(200), 40);
    expect(pages.length).toBeGreaterThan(1);
  });
});
