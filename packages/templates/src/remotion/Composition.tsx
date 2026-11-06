import { AbsoluteFill, Audio, Img, Loop, OffthreadVideo, Sequence, Video, interpolate, useCurrentFrame } from "remotion";
import { useEffect, useState } from "react";
import { isMushafMode, type Slide } from "@autoayah/core";
import type { CompositionProps } from "../types";
import { BackgroundLayer } from "../Background";
import { AyahSlide, AyahTafsirSlide, MushafPageSlide, WordHighlightSlide, type SlideProps } from "../slides";
import { ensureArabicFonts } from "../fonts";

const PAGE_FADE_FRAMES = 8;
const SLIDE_FADE_FRAMES = 6;

const letters = (w: string) => w.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\s]/g, "").length || 1;

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

type Span = { backgroundIndex: number; from: number; duration: number };

function backgroundSpans(slides: Slide[]): Span[] {
  const spans: Span[] = [];
  for (const s of slides) {
    const last = spans[spans.length - 1];
    if (last && last.backgroundIndex === s.backgroundIndex) last.duration += s.durationInFrames;
    else spans.push({ backgroundIndex: s.backgroundIndex, from: s.startFrame, duration: s.durationInFrames });
  }
  return spans;
}

export const AutoAyahComposition: React.FC<CompositionProps> = ({
  timeline,
  config,
  surahName,
  tafsirName,
  translationName,
  basmala,
  mushafPages,
  assetBaseUrl = "",
}) => {
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    void ensureArabicFonts().then(() => setFontsReady(true));
  }, []);

  const { slides, width, height, fps, totalFrames } = timeline;
  const style = config.style;
  const audio = config.audio;
  const asset = (u: string) => (u.startsWith("/") ? `${assetBaseUrl}${u}` : u);

  const fadeIn = Math.max(1, Math.round(audio.fadeInSeconds * fps));
  const fadeOut = Math.max(1, Math.round(audio.fadeOutSeconds * fps));
  const masterVolAt = (frame: number) =>
    interpolate(frame, [0, fadeIn, Math.max(fadeIn + 1, totalFrames - fadeOut), totalFrames], [0, 1, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  if (!fontsReady) {
    return <AbsoluteFill style={{ background: style.theme === "dark" ? "#0b0f0c" : style.backgroundColor }} />;
  }

  return (
    <AbsoluteFill style={{ background: style.theme === "dark" ? "#0b0f0c" : style.backgroundColor, width, height, direction: "ltr" }}>
      {backgroundSpans(slides).map((span) => {
        const bg = config.backgrounds[span.backgroundIndex];
        const media = bg?.media?.url ? asset(bg.media.url) : undefined;
        const videoVolume = (f: number) => (audio.backgroundVideoSound ? audio.backgroundVideoVolume * masterVolAt(span.from + f) : 0);
        const videoStyle = { width: "100%", height: "100%", objectFit: "cover" as const };
        const loopFrames = bg?.media?.duration ? Math.max(1, Math.floor(bg.media.duration * fps)) : 0;
        return (
          <Sequence key={`bg-${span.from}`} from={span.from} durationInFrames={span.duration}>
            <BackgroundLayer
              segment={bg}
              style={style}
              width={width}
              height={height}
              imageElement={bg?.type === "image" && media ? <Img src={media} style={videoStyle} /> : undefined}
              videoElement={
                bg?.type === "video" && media ? (
                  loopFrames ? (
                    <Loop durationInFrames={loopFrames}>
                      <OffthreadVideo src={media} muted={!audio.backgroundVideoSound} volume={videoVolume} style={videoStyle} />
                    </Loop>
                  ) : (
                    <Video src={media} loop muted={!audio.backgroundVideoSound} volume={videoVolume} style={videoStyle} />
                  )
                ) : undefined
              }
            />
          </Sequence>
        );
      })}

      {pageSpans(slides, isMushafMode(config.mode)).map((span) => {
        const found = mushafPages?.find((p) => p.page === span.slides[0]!.slide.ayah.page);
        const page = found?.image ? { ...found, image: { ...found.image, url: asset(found.image.url) } } : found;
        const mode = isMushafMode(config.mode) && !page ? "ayahTafsir" : config.mode;
        return (
          <Sequence key={`slides-${span.from}`} from={span.from} durationInFrames={span.duration}>
            <SpanSlides
              span={span}
              mode={mode}
              surahName={surahName}
              tafsirName={tafsirName}
              translationName={translationName}
              basmala={basmala}
              style={style}
              width={width}
              height={height}
              fps={fps}
              backgrounds={config.backgrounds}
              mushafPage={page}
              surah={config.surah}
            />
          </Sequence>
        );
      })}

      {slides.map((slide, i) => (
        <Sequence key={`audio-${slide.ayah.number}-${i}`} from={slide.startFrame} durationInFrames={slide.durationInFrames}>
          <Audio src={asset(slide.ayah.audioUrl)} volume={(f) => audio.recitationVolume * masterVolAt(slide.startFrame + f)} />
        </Sequence>
      ))}

      {audio.ambienceId ? (
        <Audio src={asset(`/ambience/${audio.ambienceId}.wav`)} volume={(f) => audio.ambienceVolume * masterVolAt(f)} loop />
      ) : null}
    </AbsoluteFill>
  );
};

type PageSpan = { slides: { slide: Slide; index: number }[]; from: number; duration: number };

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

type SpanProps = Omit<SlideProps, "slide" | "overMedia"> & {
  span: PageSpan;
  mode: string;
  fps: number;
  backgrounds: CompositionProps["config"]["backgrounds"];
};

function SpanSlides({ span, backgrounds, basmala, ...rest }: SpanProps) {
  const frame = span.from + useCurrentFrame();
  const current = [...span.slides].reverse().find((s) => s.slide.startFrame <= frame) ?? span.slides[0]!;
  const { slide, index } = current;
  const bg = backgrounds[slide.backgroundIndex];
  const grouped = span.slides.length > 1 || isMushafMode(rest.mode);
  return (
    <SlideByMode
      {...rest}
      slide={slide}
      local={frame - slide.startFrame}
      basmala={index === 0 ? basmala : undefined}
      overMedia={bg?.type === "image" || bg?.type === "video"}
      fadeFrames={index === 0 || grouped ? 0 : SLIDE_FADE_FRAMES}
      tafsirFadeFrames={grouped && index > 0 ? PAGE_FADE_FRAMES : 0}
    />
  );
}

function SlideByMode({
  mode,
  fps,
  fadeFrames,
  tafsirFadeFrames,
  local,
  ...rest
}: SlideProps & { mode: string; fps: number; fadeFrames: number; tafsirFadeFrames: number; local: number }) {
  const pageWords = rest.mushafPage?.words?.[`${rest.surah}:${rest.slide.ayah.number}`];
  const highlightedWordIndex =
    mode === "wordHighlight"
      ? wordIndexAt(rest.slide, local, fps)
      : mode === "mushafWords"
        ? wordIndexAt(rest.slide, local, fps, pageWords?.map((b) => b[2]))
        : -1;
  const { index, opacity } = tafsirPageAt(rest.slide, local);
  const tafsirEnter = tafsirFadeFrames ? interpolate(local, [0, tafsirFadeFrames], [0, 1], { extrapolateRight: "clamp" }) : 1;
  const props: SlideProps = { ...rest, highlightedWordIndex, tafsirPageIndex: index, tafsirOpacity: opacity * tafsirEnter };
  const enter = fadeFrames ? interpolate(local, [0, fadeFrames], [0, 1], { extrapolateRight: "clamp" }) : 1;

  const body =
    mode === "ayahTafsir" ? (
      <AyahTafsirSlide {...props} />
    ) : isMushafMode(mode) ? (
      <MushafPageSlide {...props} />
    ) : mode === "wordHighlight" ? (
      <WordHighlightSlide {...props} />
    ) : (
      <AyahSlide {...props} />
    );
  return <AbsoluteFill style={{ opacity: enter }}>{body}</AbsoluteFill>;
}
