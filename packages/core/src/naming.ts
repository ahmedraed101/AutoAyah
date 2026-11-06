import { hashConfig } from "./hash.js";
import type { VideoConfig } from "./schemas.js";

const pad = (n: number) => String(n).padStart(3, "0");
const clean = (s: string) => s.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

/** The config minus output-only fields: two configs with the same identity produce the same video. */
export function contentConfig(config: VideoConfig): VideoConfig {
  const { export: _export, pngFrame: _pngFrame, ...rest } = config;
  return { ...rest, export: "mp4" } as VideoConfig;
}

/**
 * Human-readable, deterministic name: `surah_from_to_reciter_<other attributes>_<hash>`.
 * Readable parts cover the main choices; the hash covers everything else (colors, volumes, backgrounds, overrides)
 * so different videos never share a name.
 */
export function projectName(config: VideoConfig): string {
  const bg = config.backgrounds[0];
  const parts = [
    pad(config.surah),
    pad(config.from),
    pad(config.to),
    config.reciter,
    config.mode,
    config.aspectRatio.replace(":", "x"),
    config.tafsir ?? "notafsir",
    config.translation,
    config.timing.mode === "reading" ? `reading-${config.timing.readingSpeed}` : "continuous",
    config.style.theme,
    config.style.tajweed ? "tajweed" : "plain",
    bg ? (bg.media ? `${bg.type}-${bg.media.provider}-${bg.media.id.slice(0, 12)}` : bg.type) : "nobg",
    config.audio.ambienceId ? `ambience-${config.audio.ambienceId}` : null,
    hashConfig(contentConfig(config)).slice(0, 8),
  ];
  return parts
    .filter((p): p is string => Boolean(p))
    .map(clean)
    .join("_");
}

/** File name for a render output, including format (and frame for stills). */
export function renderFileName(config: VideoConfig): string {
  const base = projectName(config);
  switch (config.export) {
    case "png":
      return `${base}_f${config.pngFrame ?? 0}.png`;
    case "webm":
      return `${base}.webm`;
    case "srt":
      return `${base}.srt`;
    case "batch":
      return `${base}.zip`;
    default:
      return `${base}.mp4`;
  }
}
