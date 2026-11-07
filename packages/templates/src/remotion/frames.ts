import { isMushafMode, isMushafSpread, needsWordTimings, type Slide, type Timeline } from "@autoayah/core";
import type { CompositionProps } from "../types";

export const PAGE_FADE_FRAMES = 8;
/** Each slide fades out and the next fades in over this many frames; the fade-out sits in the reciter's pause after the last word. */
export const SLIDE_FADE_FRAMES = 10;

/** First frame where a slide is fully faded in: where to land when jumping to an ayah. */
export const restFrame = (slide: { startFrame: number; durationInFrames: number }) =>
  Math.min(slide.startFrame + Math.max(PAGE_FADE_FRAMES, SLIDE_FADE_FRAMES), slide.startFrame + slide.durationInFrames - 1);

type MushafPage = NonNullable<CompositionProps["mushafPages"]>[number];

const ramp = (local: number, frames: number) => (frames ? Math.min(1, Math.max(0, local / frames)) : 1);
const smooth = (t: number) => t * t * (3 - 2 * t);
/** Eased 0→1 over `frames` from the start of an interval and 1→0 over `frames` before its end. */
const fadeInOut = (local: number, duration: number, fadeIn: boolean, fadeOut: boolean) => {
  const frames = Math.max(1, Math.min(SLIDE_FADE_FRAMES, Math.floor(duration / 3)));
  const inT = fadeIn ? ramp(local, frames) : 1;
  const outT = fadeOut ? ramp(duration - local, frames) : 1;
  return smooth(Math.min(inT, outT));
};

/** Word index being recited, from the reciter's word timings; -1 (nothing lit) when the ayah has none. */
export function wordIndexAt(slide: Slide, localFrame: number, fps: number): number {
  const ms = (localFrame / fps) * 1000;
  const timings = slide.ayah.wordTimings;
  if (!timings?.length) return -1;
  const hit = timings.find((t) => ms >= t.startMs && ms < t.endMs);
  if (hit) return hit.index - 1;
  const before = timings.filter((t) => t.endMs <= ms);
  return before.length ? before[before.length - 1]!.index - 1 : -1;
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

/** Mushaf mode keeps one page (or open spread) mounted across its ayat; other modes get one span per slide. */
function pageSpans(slides: Slide[], groupOf: ((s: Slide) => number | undefined) | null): PageSpan[] {
  const spans: PageSpan[] = [];
  slides.forEach((slide, index) => {
    const last = spans[spans.length - 1];
    if (groupOf && last && groupOf(last.slides[0]!.slide) === groupOf(slide)) {
      last.slides.push({ slide, index });
      last.duration += slide.durationInFrames;
    } else {
      spans.push({ slides: [{ slide, index }], from: slide.startFrame, duration: slide.durationInFrames });
    }
  });
  return spans;
}

export type LayoutSpan = {
  span: PageSpan;
  mode: string;
  spread: boolean;
  pages: MushafPage[];
  /** First / last span of the video: no fade before the opening frame or after the closing one. */
  first: boolean;
  last: boolean;
};

export const pageOf = (layout: LayoutSpan, page: number | undefined) =>
  page == null ? undefined : layout.pages.find((p) => p.page === page);

/** The slide spans the composition mounts, with the mode each one is drawn in. */
export function layoutSpans(props: Pick<CompositionProps, "timeline" | "config" | "mushafPages">): LayoutSpan[] {
  const mushaf = isMushafMode(props.config.mode);
  const spread = isMushafSpread(props.config);
  const pages = props.mushafPages ?? [];
  const groupOf = (s: Slide) => (s.ayah.page == null ? undefined : spread ? Math.ceil(s.ayah.page / 2) : s.ayah.page);
  const spans = pageSpans(props.timeline.slides, mushaf ? groupOf : null);
  return spans.map((span, i) => {
    const layout: LayoutSpan = { span, spread, pages, mode: props.config.mode, first: i === 0, last: i === spans.length - 1 };
    if (mushaf && !pageOf(layout, span.slides[0]!.slide.ayah.page)) layout.mode = "ayahTafsir";
    return layout;
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
  /** Opacity of the whole span: fades in after the previous span and out before the next. */
  enter: number;
};

export function slideStateAt(layout: LayoutSpan, frame: number, fps: number): SlideState {
  const { span, mode } = layout;
  let pos = 0;
  while (pos + 1 < span.slides.length && span.slides[pos + 1]!.slide.startFrame <= frame) pos++;
  const { slide, index } = span.slides[pos]!;
  const local = frame - slide.startFrame;
  const grouped = span.slides.length > 1 || isMushafMode(mode);
  const lastInSpan = pos === span.slides.length - 1;
  const highlightedWordIndex = needsWordTimings(mode) ? wordIndexAt(slide, local, fps) : -1;
  const tafsir = tafsirPageAt(slide, local);
  // Within a Mushaf page the scan stays put; only the tafsir card hands over from one ayah to the next.
  const tafsirSwap = grouped ? fadeInOut(local, slide.durationInFrames, pos > 0, !lastInSpan) : 1;
  return {
    slide,
    index,
    local,
    highlightedWordIndex,
    tafsirPageIndex: tafsir.index,
    tafsirOpacity: tafsir.opacity * tafsirSwap,
    enter: fadeInOut(frame - span.from, span.duration, !layout.first, !layout.last),
  };
}

/** One stretch of recitation audio: `src` played from `trimBeforeMs` for `durationInFrames`, starting at `fromFrame`. */
export type AudioClip = {
  src: string;
  fromFrame: number;
  durationInFrames: number;
  trimBeforeMs: number;
  /** Audio available in `src` from `trimBeforeMs` on. */
  audioSeconds: number;
};

/** A slide held longer than its recitation (hold override, reading time) leaves the rest of the run unplayed. */
const HOLD_TOLERANCE_SECONDS = 0.05;
const CONTIGUOUS_MS = 5;

/**
 * Playback clips for the recitation. Back-to-back ayat cut from one surah recording play as a single clip,
 * so the room tone never breaks between them; a held slide ends its clip where its audio ends.
 */
export function audioClips(timeline: Pick<Timeline, "slides" | "fps">): AudioClip[] {
  const { fps } = timeline;
  const clips: AudioClip[] = [];
  let open: { clip: AudioClip; endMs: number } | null = null;
  for (const s of timeline.slides) {
    const { run, audioUrl, audioSeconds } = s.ayah;
    if (!audioUrl) {
      open = null;
      continue;
    }
    if (!run) {
      clips.push({ src: audioUrl, fromFrame: s.startFrame, durationInFrames: s.durationInFrames, trimBeforeMs: 0, audioSeconds });
      open = null;
      continue;
    }
    const held = s.durationInSeconds > audioSeconds + HOLD_TOLERANCE_SECONDS;
    const end = held ? Math.min(s.startFrame + s.durationInFrames, s.startFrame + Math.max(1, Math.round(audioSeconds * fps))) : s.startFrame + s.durationInFrames;
    if (open && open.clip.src === run.url && Math.abs(open.endMs - run.offsetMs) < CONTIGUOUS_MS) {
      open.clip.durationInFrames = end - open.clip.fromFrame;
      open.clip.audioSeconds += audioSeconds;
    } else {
      const clip = { src: run.url, fromFrame: s.startFrame, durationInFrames: end - s.startFrame, trimBeforeMs: run.offsetMs, audioSeconds };
      clips.push(clip);
      open = { clip, endMs: run.offsetMs };
    }
    open.endMs = run.offsetMs + audioSeconds * 1000;
    if (held) open = null;
  }
  return clips;
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
      const s = slideStateAt(layout, f, fps);
      keys[f] = `${si}|${s.index}|${s.highlightedWordIndex}|${s.tafsirPageIndex}|${s.tafsirOpacity.toFixed(4)}|${s.enter.toFixed(4)}`;
    }
  });
  return keys;
}
