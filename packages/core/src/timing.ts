import { ASPECT_RATIOS, FPS, READING_SPEEDS, type AspectRatio } from "./constants.js";
import { holdOverride } from "./ranges.js";
import { isMushafMode, type ResolvedAyah, type ResolvedClip, type VideoConfig } from "./schemas.js";

export type Slide = {
  ayah: ResolvedAyah;
  startFrame: number;
  durationInFrames: number;
  durationInSeconds: number;
  tafsirPages: string[];
  backgroundIndex: number;
};

export type Timeline = {
  slides: Slide[];
  totalFrames: number;
  totalSeconds: number;
  width: number;
  height: number;
  fps: number;
  warnings: string[];
};

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** Split long tafsir into pages that fit on a card (~240 chars of Arabic at a readable size). */
export function paginateTafsir(text: string, maxChars = 240): string[] {
  if (!text) return [];
  if (text.length <= maxChars) return [text];
  const parts: string[] = [];
  let remaining = text.trim();
  // Balance page sizes so the last page isn't a short orphan.
  const target = Math.ceil(remaining.length / Math.ceil(remaining.length / maxChars));
  while (remaining.length > maxChars) {
    const window = remaining.slice(0, Math.min(maxChars, Math.round(target * 1.15)) + 1);
    // Prefer ending on a sentence, then a clause, then a word.
    const sentence = Math.max(...[".", "؟", "!", ":"].map((p) => window.lastIndexOf(p)));
    const clause = Math.max(...["،", "؛", ","].map((p) => window.lastIndexOf(p)));
    // A natural break only wins if it keeps pages roughly even; lopsided cards look half-empty.
    let cut =
      sentence >= target * 0.85 ? sentence + 1 : clause >= target * 0.85 ? clause + 1 : window.lastIndexOf(" ");
    if (cut < maxChars * 0.4) cut = window.lastIndexOf(" ") > 0 ? window.lastIndexOf(" ") : maxChars;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

/** Characters of tafsir that fit on one card at a readable size, per canvas shape. */
const TAFSIR_PAGE_CHARS: Record<AspectRatio, number> = { "9:16": 400, "16:9": 380, "1:1": 230, "4:5": 280 };
const MUSHAF_TAFSIR_PAGE_CHARS = 240;

function readingSeconds(tafsir: string | undefined, speed: keyof typeof READING_SPEEDS): number {
  if (!tafsir) return 0;
  const wpm = READING_SPEEDS[speed];
  return (words(tafsir) / wpm) * 60;
}

function ayahDuration(ayah: ResolvedAyah, config: VideoConfig): number {
  const { timing, mode } = config;
  const override = holdOverride(timing, ayah.surah ?? config.surah, ayah.number, config.surah);
  if (override != null) return Math.max(ayah.audioSeconds, override);

  if (timing.mode === "continuous" || mode === "ayah" || mode === "wordHighlight") {
    return ayah.audioSeconds;
  }

  // reading mode with tafsir
  const read = readingSeconds(ayah.tafsir, timing.readingSpeed);
  return Math.max(ayah.audioSeconds, read);
}

export function buildTimeline(config: VideoConfig, clip: ResolvedClip): Timeline {
  const warnings: string[] = [];
  const aspect = ASPECT_RATIOS[config.aspectRatio as AspectRatio] ?? ASPECT_RATIOS["9:16"];
  const slides: Slide[] = [];
  let frame = 0;

  if (isMushafMode(config.mode) && clip.ayat.some((a) => !a.page)) {
    warnings.push("Mushaf page data is missing for some ayat. Those slides use Ayah + Tafsir.");
  }
  if (config.mode === "wordHighlight" || config.mode === "mushafWords") {
    const missing = clip.ayat.filter((a) => !a.wordTimings?.length).length;
    if (missing) {
      warnings.push(`${missing} ayah(s) lack word timings for this reciter. Highlight timing is estimated from word length.`);
    }
  }

  for (const ayah of clip.ayat) {
    const durationInSeconds = Math.max(0.5, ayahDuration(ayah, config) + 0.4);
    const durationInFrames = Math.max(1, Math.ceil(durationInSeconds * FPS));
    const tafsirPages =
      config.mode === "ayahTafsir"
        ? paginateTafsir(ayah.tafsir ?? "", TAFSIR_PAGE_CHARS[config.aspectRatio as AspectRatio] ?? 240)
        : isMushafMode(config.mode)
          ? paginateTafsir(ayah.tafsir ?? "", MUSHAF_TAFSIR_PAGE_CHARS)
          : [];

    // Background segments are numbered within the first surah; later surahs keep the last matching one.
    const inFirstSurah = (ayah.surah ?? config.surah) === config.surah;
    const bgIndex = inFirstSurah
      ? Math.max(0, config.backgrounds.findIndex((b) => ayah.number >= b.fromAyah && ayah.number <= b.toAyah))
      : (slides[slides.length - 1]?.backgroundIndex ?? 0);

    slides.push({
      ayah,
      startFrame: frame,
      durationInFrames,
      durationInSeconds,
      tafsirPages,
      backgroundIndex: bgIndex === -1 ? 0 : bgIndex,
    });
    frame += durationInFrames;
  }

  return {
    slides,
    totalFrames: Math.max(1, frame),
    totalSeconds: frame / FPS,
    width: aspect.width,
    height: aspect.height,
    fps: FPS,
    warnings,
  };
}

export function totalFrames(timeline: Timeline): number {
  return timeline.totalFrames;
}

export function toArabicDigits(n: number): string {
  return String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]!);
}
