import { AbsoluteFill, Audio, Img, Loop, OffthreadVideo, Sequence, Video, interpolate, useCurrentFrame } from "remotion";
import { useEffect, useState } from "react";
import { facingPage, type Slide } from "@autoayah/core";
import type { CompositionProps } from "../types";
import { BackgroundLayer } from "../Background";
import { AyahSlide, AyahTafsirSlide, MushafPageSlide, WordHighlightSlide, type SlideProps } from "../slides";
import { ensureArabicFonts } from "../fonts";
import { layoutSpans, pageOf, slideStateAt, type LayoutSpan } from "./frames";

export { frameKeys, wordIndexAt } from "./frames";

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
        : slides.map((slide, i) =>
            slide.ayah.audioUrl ? (
              <Sequence key={`audio-${slide.ayah.surah ?? ""}-${slide.ayah.number}-${i}`} from={slide.startFrame} durationInFrames={slide.durationInFrames}>
                <Audio src={asset(slide.ayah.audioUrl)} volume={(f) => audio.recitationVolume * masterVolAt(slide.startFrame + f)} />
              </Sequence>
            ) : null,
          )}

      {audio.ambienceId && !muted ? (
        <Audio src={asset(`/ambience/${audio.ambienceId}.wav`)} volume={(f) => audio.ambienceVolume * masterVolAt(f)} loop />
      ) : null}
    </AbsoluteFill>
  );
};

const withAssetUrl =
  (asset: (u: string) => string) =>
  <P extends NonNullable<CompositionProps["mushafPages"]>[number]>(p: P): P =>
    p.image ? { ...p, image: { ...p.image, url: asset(p.image.url) } } : p;

type SpanProps = Omit<SlideProps, "slide" | "overMedia" | "mushafPage" | "facingPage"> & {
  layout: LayoutSpan;
  surahNames?: Record<string, string>;
  fps: number;
  backgrounds: CompositionProps["config"]["backgrounds"];
};

function SpanSlides({ layout, backgrounds, basmala, surahNames, fps, ...rest }: SpanProps) {
  const state = slideStateAt(layout, layout.span.from + useCurrentFrame(), fps, rest.surah ?? 0);
  const { ayah } = state.slide;
  const bg = backgrounds[state.slide.backgroundIndex];
  const surah = ayah.surah ?? rest.surah;
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
  };
  const mode = layout.mode;
  const body =
    mode === "ayahTafsir" ? (
      <AyahTafsirSlide {...props} />
    ) : mode === "mushafPage" || mode === "mushafWords" ? (
      <MushafPageSlide {...props} />
    ) : mode === "wordHighlight" ? (
      <WordHighlightSlide {...props} />
    ) : (
      <AyahSlide {...props} />
    );
  return <AbsoluteFill style={{ opacity: state.enter }}>{body}</AbsoluteFill>;
}
