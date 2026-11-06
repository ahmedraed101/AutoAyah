import { isMushafMode, type Slide } from "@autoayah/core";
import type { CompositionProps } from "../types";

export const PAGE_FADE_FRAMES = 8;
export const SLIDE_FADE_FRAMES = 6;

type MushafPage = NonNullable<CompositionProps["mushafPages"]>[number];

const letters = (w: string) => w.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\s]/g, "").length || 1;
const ramp = (local: number, frames: number) => (frames ? Math.min(1, Math.max(0, local / frames)) : 1);

/**
 * Word index being recited: real timings when available, otherwise estimated from word length
 * (`widths` overrides the per-word weights, e.g. glyph widths on the Mushaf scan).
 */
export function wordIndexAt(slide: Slide, localFrame: number, fps: number, widths?: number[]): number {
  const ms = (localFrame / fps) * 1000;
  const timings = slide.ayah.wordTimings;
  if (timings?.length) {
    const hit = timings.find((t) => ms >= t.startMs && ms < t.endMs);
    if (hit) return hit.index - 1;
    const before = timings.filter((t) => t.endMs <= ms);
    return before.length ? before[before.length - 1]!.index - 1 : -1;
  }
  const weights = widths?.length ? widths : (slide.ayah.words ?? []).map(letters);
  if (!weights.length || !slide.ayah.audioSeconds) return -1;
  const total = weights.reduce((a, b) => a + b, 0);
  const progress = ms / (slide.ayah.audioSeconds * 1000);
  if (progress >= 1) return weights.length - 1;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i]! / total;
    if (progress < acc) return i;
  }
  return weights.length - 1;
}

/** Tafsir pages share the slide time in proportion to their length, with a short cross-fade. */
function tafsirPageAt(slide: Slide, localFrame: number): { index: number; opacity: number } {
  const pages = slide.tafsirPages;
  if (pages.length <= 1) return { index: 0, opacity: 1 };
  const total = pages.reduce((s, p) => s + p.length, 0);
  let start = 0;
  for (let i = 0; i < pages.length; i++) {
    const len = Math.round((pages[i]!.length / total) * slide.durationInFrames);
    const end = i === pages.length - 1 ? slide.durationInFrames : start + len;
    if (localFrame < end) {
      const fadeIn = i === 0 ? 1 : Math.min(1, (localFrame - start) / PAGE_FADE_FRAMES);
      const fadeOut = i === pages.length - 1 ? 1 : Math.min(1, (end - localFrame) / PAGE_FADE_FRAMES);
      return { index: i, opacity: Math.max(0, Math.min(fadeIn, fadeOut)) };
    }
    start = end;
  }
  return { index: pages.length - 1, opacity: 1 };
}

export type PageSpan = { slides: { slide: Slide; index: number }[]; from: number; duration: number };

/** Mushaf mode keeps one page mounted across its ayat; other modes get one span per slide. */
function pageSpans(slides: Slide[], groupByPage: boolean): PageSpan[] {
  const spans: PageSpan[] = [];
  slides.forEach((slide, index) => {
    const last = spans[spans.length - 1];
    if (groupByPage && last && last.slides[0]!.slide.ayah.page === slide.ayah.page) {
      last.slides.push({ slide, index });
      last.duration += slide.durationInFrames;
    } else {
      spans.push({ slides: [{ slide, index }], from: slide.startFrame, duration: slide.durationInFrames });
    }
  });
  return spans;
}

export type LayoutSpan = { span: PageSpan; mode: string; page?: MushafPage };

/** The slide spans the composition mounts, with the mode each one is drawn in. */
export function layoutSpans(props: Pick<CompositionProps, "timeline" | "config" | "mushafPages">): LayoutSpan[] {
  const mushaf = isMushafMode(props.config.mode);
  return pageSpans(props.timeline.slides, mushaf).map((span) => {
    const page = props.mushafPages?.find((p) => p.page === span.slides[0]!.slide.ayah.page);
    return { span, page, mode: mushaf && !page ? "ayahTafsir" : props.config.mode };
  });
}

/** Everything that decides what a frame of a span looks like. */
export type SlideState = {
  slide: Slide;
  index: number;
  local: number;
  highlightedWordIndex: number;
  tafsirPageIndex: number;
  tafsirOpacity: number;
  /** Opacity of the whole slide (fade-in). */
  enter: number;
};

export function slideStateAt({ span, mode, page }: LayoutSpan, frame: number, fps: number, surah: number): SlideState {
  const { slide, index } = [...span.slides].reverse().find((s) => s.slide.startFrame <= frame) ?? span.slides[0]!;
  const local = frame - slide.startFrame;
  const grouped = span.slides.length > 1 || isMushafMode(mode);
  const pageWords = page?.words?.[`${surah}:${slide.ayah.number}`];
  const highlightedWordIndex =
    mode === "wordHighlight"
      ? wordIndexAt(slide, local, fps)
      : mode === "mushafWords"
        ? wordIndexAt(slide, local, fps, pageWords?.map((b) => b[2]))
        : -1;
  const tafsir = tafsirPageAt(slide, local);
  const tafsirEnter = ramp(local, grouped && index > 0 ? PAGE_FADE_FRAMES : 0);
  return {
    slide,
    index,
    local,
    highlightedWordIndex,
    tafsirPageIndex: tafsir.index,
    tafsirOpacity: tafsir.opacity * tafsirEnter,
    enter: ramp(local, index === 0 || grouped ? 0 : SLIDE_FADE_FRAMES),
  };
}

/**
 * One key per frame; frames with equal keys render identical pixels, so a render only needs one of them.
 * Returns null when something moves every frame (video backgrounds).
 */
export function frameKeys(props: CompositionProps): string[] | null {
  if (props.config.backgrounds.some((b) => b.type === "video")) return null;
  const { fps, totalFrames } = props.timeline;
  const keys = Array.from({ length: totalFrames }, () => "-");
  layoutSpans(props).forEach((layout, si) => {
    const end = Math.min(totalFrames, layout.span.from + layout.span.duration);
    for (let f = layout.span.from; f < end; f++) {
      const s = slideStateAt(layout, f, fps, props.config.surah);
      keys[f] = `${si}|${s.index}|${s.highlightedWordIndex}|${s.tafsirPageIndex}|${s.tafsirOpacity.toFixed(4)}|${s.enter.toFixed(4)}`;
    }
  });
  return keys;
}
