import { Composition } from "remotion";
import { ASPECT_RATIOS, FPS, VideoConfigSchema } from "@autoayah/core";
import { AutoAyahComposition } from "./Composition";
import type { CompositionProps } from "../types";

const defaultProps: CompositionProps = {
  timeline: {
    slides: [],
    totalFrames: 30,
    totalSeconds: 1,
    width: 1080,
    height: 1920,
    fps: FPS,
    warnings: [],
  },
  config: VideoConfigSchema.parse({ surah: 1, from: 1, to: 1, reciter: "Alafasy_128kbps" }),
  surahName: "سُورَةُ ٱلْفَاتِحَةِ",
};

export const RemotionRoot: React.FC = () => (
  <>
    {(Object.keys(ASPECT_RATIOS) as (keyof typeof ASPECT_RATIOS)[]).map((ratio) => {
      const { width, height } = ASPECT_RATIOS[ratio];
      return (
        <Composition
          key={ratio}
          id={`AutoAyah-${ratio.replace(":", "x")}`}
          component={AutoAyahComposition}
          durationInFrames={30}
          fps={FPS}
          width={width}
          height={height}
          defaultProps={defaultProps}
          calculateMetadata={async ({ props }) => ({
            durationInFrames: Math.max(1, props.frameMap?.length || props.timeline.totalFrames),
            width: props.timeline.width,
            height: props.timeline.height,
            fps: FPS,
          })}
        />
      );
    })}
  </>
);
