import type { ResolvedClip, StyleConfig, Timeline, VideoConfig } from "@autoayah/core";

export type CompositionProps = {
  timeline: Timeline;
  config: VideoConfig;
  surahName: string;
  tafsirName?: string;
  translationName?: string;
  /** Shown above the first ayah when the clip starts at ayah 1. */
  basmala?: string;
  mushafPages?: ResolvedClip["mushafPages"];
  /** Prefix for server-relative asset paths (/media, /uploads, /ambience). Empty in the browser preview. */
  assetBaseUrl?: string;
  /** Render only these frames of the timeline, in order (silent). */
  frameMap?: number[];
};

export type ThemeColors = StyleConfig;
