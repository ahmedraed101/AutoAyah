import { continueRender, delayRender, staticFile } from "remotion";

export const QURAN_FONT = '"Amiri Quran", "Amiri", "Noto Naskh Arabic", "Segoe UI", Tahoma, sans-serif';
export const UI_FONT = '"Noto Naskh Arabic", "Amiri", "Segoe UI", Tahoma, sans-serif';

let loading: Promise<void> | null = null;

/** Load self-hosted Arabic fonts once (preview + render). Blocks Remotion until ready. */
export function ensureArabicFonts(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  if (loading) return loading;

  const handle = delayRender("Loading Arabic fonts", { timeoutInMilliseconds: 60_000 });
  loading = (async () => {
    try {
      const faces = [
        new FontFace("Amiri Quran", `url(${staticFile("fonts/AmiriQuran-arabic.woff2")})`, { weight: "400", display: "block" }),
        new FontFace("Amiri", `url(${staticFile("fonts/Amiri-arabic-400.woff2")})`, { weight: "400", display: "block" }),
        new FontFace("Amiri", `url(${staticFile("fonts/Amiri-arabic-700.woff2")})`, { weight: "700", display: "block" }),
        new FontFace("Noto Naskh Arabic", `url(${staticFile("fonts/NotoNaskhArabic-arabic.woff2")})`, {
          weight: "400 700",
          display: "block",
          unicodeRange: "U+0600-06FF, U+0750-077F, U+0870-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FEFC",
        }),
        // Punctuation such as ( ) must come from the same font, or bidi mirroring breaks across font runs.
        new FontFace("Noto Naskh Arabic", `url(${staticFile("fonts/NotoNaskhArabic-latin.woff2")})`, {
          weight: "400 700",
          display: "block",
          unicodeRange: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2212, U+2215",
        }),
      ];
      const loaded = await Promise.all(faces.map((f) => f.load()));
      for (const face of loaded) {
        (document.fonts as FontFaceSet & { add(font: FontFace): void }).add(face);
      }
      await document.fonts.ready;
    } catch (e) {
      console.error("Arabic font load failed", e);
    } finally {
      continueRender(handle);
    }
  })();

  return loading;
}
