import { AbsoluteFill, Audio, Img, Loop, OffthreadVideo, Sequence, Video, interpolate, useCurrentFrame } from "remotion";
import { useEffect, useState, type CSSProperties } from "react";
import { facingPage, type Slide, type Transition } from "@autoayah/core";
import type { CompositionProps } from "../types";
import { BackgroundLayer } from "../Background";
import { AyahTafsirSlide, MushafPageSlide, type SlideProps } from "../slides";
import { ensureArabicFonts } from "../fonts";
import { audioClips, layoutSpans, pageOf, slideStateAt, type LayoutSpan } from "./frames";

export { audioClips, frameKeys, wordIndexAt } from "./frames";

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

export const AutoAyahComposition: React.FC<CompositionProps> = (props) =>
  props.frameMap?.length ? <MappedFrames {...props} frameMap={props.frameMap} /> : <Scene {...props} />;

/** Plays `frameMap[i]` of the full video at frame i (silent; used to render only the distinct frames). */
const MappedFrames: React.FC<CompositionProps & { frameMap: number[] }> = ({ frameMap, ...props }) => {
  const frame = useCurrentFrame();
  const target = frameMap[Math.min(frame, frameMap.length - 1)]!;
  return (
    <Sequence from={frame - target} layout="none">
      <Scene {...props} muted />
    </Sequence>
  );
};

const Scene: React.FC<CompositionProps & { muted?: boolean }> = ({
  timeline,
  config,
  surahName,
  tafsirName,
  translationName,
  basmala,
  surahNames,
  mushafPages,
  assetBaseUrl = "",
  muted,
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

      {layoutSpans({ timeline, config, mushafPages: mushafPages?.map(withAssetUrl(asset)) }).map((layout) => (
        <Sequence key={`slides-${layout.span.from}`} from={layout.span.from} durationInFrames={layout.span.duration}>
          <SpanSlides
            layout={layout}
            surahName={surahName}
            tafsirName={tafsirName}
            translationName={translationName}
            basmala={basmala}
            surahNames={surahNames}
            style={style}
            width={width}
            height={height}
            fps={fps}
            backgrounds={config.backgrounds}
            surah={config.surah}
          />
        </Sequence>
      ))}

      {muted
        ? null
        : audioClips(timeline).map((clip) => (
            <Sequence key={`audio-${clip.fromFrame}`} from={clip.fromFrame} durationInFrames={clip.durationInFrames} premountFor={fps}>
              {/* Premounted a second early so the next clip is loaded and starts on time instead of jumping in late. */}
              <Audio
                src={asset(clip.src)}
                trimBefore={Math.round((clip.trimBeforeMs / 1000) * fps)}
                pauseWhenBuffering
                volume={(f) => audio.recitationVolume * masterVolAt(clip.fromFrame + f) * edgeFade(f, clip.durationInFrames)}
              />
            </Sequence>
          ))}

      {audio.ambienceId && !muted ? (
        <Audio src={asset(`/ambience/${audio.ambienceId}.wav`)} volume={(f) => audio.ambienceVolume * masterVolAt(f)} loop />
      ) : null}
    </AbsoluteFill>
  );
};

/** Softens the first and last frame of each clip so cut points don't click. */
const edgeFade = (f: number, duration: number) => (duration < 4 ? 1 : f === 0 || f === duration - 1 ? 0.5 : 1);

const withAssetUrl =
  (asset: (u: string) => string) =>
  <P extends NonNullable<CompositionProps["mushafPages"]>[number]>(p: P): P =>
    p.image
      ? {
          ...p,
          image: {
            ...p.image,
            url: asset(p.image.url),
            hdUrl: p.image.hdUrl ? asset(p.image.hdUrl) : undefined,
          },
        }
      : p;

type SpanProps = Omit<SlideProps, "slide" | "overMedia" | "mushafPage" | "facingPage"> & {
  layout: LayoutSpan;
  surahNames?: Record<string, string>;
  fps: number;
  backgrounds: CompositionProps["config"]["backgrounds"];
};

const FOLLOW_PAN_SECONDS = 0.6;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function SpanSlides({ layout, backgrounds, basmala, surahNames, fps, ...rest }: SpanProps) {
  const state = slideStateAt(layout, layout.span.from + useCurrentFrame(), fps);
  const { ayah } = state.slide;
  const bg = backgrounds[state.slide.backgroundIndex];
  const surah = ayah.surah ?? rest.surah;
  const pos = layout.span.slides.findIndex((s) => s.index === state.index);
  const prev = pos > 0 ? layout.span.slides[pos - 1] : undefined;
  const samePage = Boolean(prev && prev.slide.ayah.page != null && prev.slide.ayah.page === ayah.page);
  const followMix = samePage ? easeInOut(Math.min(1, state.local / Math.max(1, FOLLOW_PAN_SECONDS * fps))) : 1;
  const props: SlideProps = {
    ...rest,
    surah,
    surahName: (surah != null && surahNames?.[surah]) || rest.surahName,
    mushafPage: pageOf(layout, ayah.page),
    facingPage: layout.spread && ayah.page != null ? pageOf(layout, facingPage(ayah.page)) : undefined,
    slide: state.slide,
    basmala: ayah.basmala ?? (state.index === 0 ? basmala : undefined),
    overMedia: (bg?.type === "image" || bg?.type === "video") && rest.style.mediaPanel !== false,
    highlightedWordIndex: state.highlightedWordIndex,
    tafsirPageIndex: state.tafsirPageIndex,
    tafsirOpacity: state.tafsirOpacity,
    ayahProgress: state.slide.durationInFrames > 0 ? state.local / state.slide.durationInFrames : 0,
    followFrom: samePage ? prev!.slide.ayah.number : undefined,
    followMix,
  };
  const mode = layout.mode;
  // Every ayah view shows the tafsir card when a tafsir is selected.
  const body = mode === "mushafPage" || mode === "mushafWords" ? <MushafPageSlide {...props} /> : <AyahTafsirSlide {...props} />;
  return <AbsoluteFill style={transitionStyle(layout.transition, state, rest.width, rest.height)}>{body}</AbsoluteFill>;
}

/** Slides move the way the Mushaf reads: the next one comes in from the left, the current one leaves to the right. */
function transitionStyle(kind: Transition, { enter, shift }: { enter: number; shift: number }, width: number, height: number): CSSProperties {
  if (kind === "none" || shift === 0) return {};
  switch (kind) {
    case "slide":
      return { transform: `translateX(${shift * width}px)` };
    case "rise":
      return { opacity: enter, transform: `translateY(${-shift * height * 0.08}px)` };
    case "zoom":
      return { opacity: enter, transform: `scale(${1 + shift * 0.08})` };
    case "blur":
      return { opacity: enter, filter: `blur(${Math.abs(shift) * width * 0.02}px)` };
    default:
      return { opacity: enter };
  }
}
