import { describe, expect, it } from "vitest";
import { VideoConfigSchema } from "./schemas.js";
import { hashConfig } from "./hash.js";
import { paginateTafsir } from "./timing.js";

const base = { surah: 25, from: 7, to: 8, reciter: "Alafasy_128kbps" };

describe("VideoConfigSchema", () => {
  it("rejects a reversed ayah range", () => {
    expect(VideoConfigSchema.safeParse({ ...base, from: 9, to: 8 }).success).toBe(false);
  });

  it("rejects reciter ids that could escape a path", () => {
    expect(VideoConfigSchema.safeParse({ ...base, reciter: "../etc" }).success).toBe(false);
  });

  it("defaults to the light tajweed design", () => {
    const c = VideoConfigSchema.parse(base);
    expect(c.style.theme).toBe("light");
    expect(c.style.tajweed).toBe(true);
  });

  it("accepts local media paths", () => {
    const c = VideoConfigSchema.safeParse({
      ...base,
      backgrounds: [{ type: "image", fromAyah: 7, toAyah: 8, media: { provider: "upload", id: "x", url: "/uploads/x.jpg" } }],
    });
    expect(c.success).toBe(true);
  });
});

describe("hashConfig", () => {
  it("produces a 64-bit hex digest", () => {
    expect(hashConfig(VideoConfigSchema.parse(base))).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("paginateTafsir", () => {
  it("keeps short text on one page", () => {
    expect(paginateTafsir("نص قصير.", 240)).toEqual(["نص قصير."]);
  });

  it("prefers breaking after a sentence end", () => {
    const first = "وقال المشركون ما لهذا الذي يزعم أنه رسول يأكل الطعام ويمشي في الأسواق لطلب الرزق؟";
    const second = "هلا أرسل الله معه ملكًا يشهد بصدقه ويعينه على تبليغ رسالته ويكون له نذيرًا.";
    const pages = paginateTafsir(`${first} ${second}`, 100);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toBe(first);
    expect(pages[1]).toBe(second);
  });

  it("never drops words", () => {
    const text = Array.from({ length: 300 }, (_, i) => `كلمة${i}`).join(" ");
    expect(paginateTafsir(text, 120).join(" ")).toBe(text);
  });
});
