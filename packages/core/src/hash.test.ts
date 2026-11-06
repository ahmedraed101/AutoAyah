import { describe, expect, it } from "vitest";
import { VideoConfigSchema } from "./schemas.js";
import { hashConfig } from "./hash.js";

describe("hashConfig", () => {
  it("is stable for equal configs", () => {
    const a = VideoConfigSchema.parse({ surah: 1, from: 1, to: 1, reciter: "Alafasy_128kbps" });
    const b = VideoConfigSchema.parse({ surah: 1, from: 1, to: 1, reciter: "Alafasy_128kbps" });
    expect(hashConfig(a)).toBe(hashConfig(b));
  });

  it("changes when ayah range changes", () => {
    const a = VideoConfigSchema.parse({ surah: 1, from: 1, to: 1, reciter: "Alafasy_128kbps" });
    const b = VideoConfigSchema.parse({ surah: 1, from: 1, to: 2, reciter: "Alafasy_128kbps" });
    expect(hashConfig(a)).not.toBe(hashConfig(b));
  });
});
