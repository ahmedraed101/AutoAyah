import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, makeCancelSignal, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { buildTimeline, renderFileName, type Job, type VideoConfig } from "@autoayah/core";
import type { Resolver } from "@autoayah/data";
import type { CompositionProps } from "@autoayah/templates";

let serveUrlPromise: Promise<string> | null = null;

export function getServeUrl(entryPoint: string) {
  const publicDir = path.resolve(path.dirname(entryPoint), "../../public");
  serveUrlPromise ??= ensureBrowser()
    .then(() =>
      bundle({
        entryPoint,
        publicDir,
        webpackOverride: (config) => {
          config.resolve = config.resolve ?? {};
          config.resolve.alias = {
            ...(config.resolve.alias ?? {}),
            "@autoayah/core": path.resolve(path.dirname(entryPoint), "../../../core/dist/index.js"),
          };
          config.resolve.extensions = [".ts", ".tsx", ".js", ".jsx", ".json", ...(config.resolve.extensions ?? [])];
          return config;
        },
      }),
    )
    .catch((e) => {
      serveUrlPromise = null;
      throw e;
    });
  return serveUrlPromise;
}

function compositionId(aspect: string) {
  return `AutoAyah-${aspect.replace(":", "x")}`;
}

function srtTimestamp(seconds: number) {
  const totalMs = Math.round(seconds * 1000);
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export type Limits = { maxSeconds?: number };

export async function buildProps(
  config: VideoConfig,
  resolver: Resolver,
  limits: Limits = {},
): Promise<CompositionProps & { warnings: string[] }> {
  const clip = await resolver.resolveClip(config);
  const timeline = buildTimeline(config, clip);
  if (limits.maxSeconds && timeline.totalSeconds > limits.maxSeconds) {
    throw new Error(`Video would be ${Math.ceil(timeline.totalSeconds)}s; this server allows at most ${limits.maxSeconds}s`);
  }
  return {
    timeline,
    config,
    surahName: clip.surahName,
    tafsirName: clip.tafsirName,
    translationName: clip.translationName,
    basmala: clip.basmala,
    mushafPages: clip.mushafPages,
    warnings: timeline.warnings,
  };
}

export async function renderJob(
  job: Job,
  opts: {
    resolver: Resolver;
    outDir: string;
    entryPoint: string;
    /** Absolute origin the headless browser uses to reach /media, /uploads and /ambience. */
    assetBaseUrl: string;
    limits?: Limits;
    concurrency?: number;
    onProgress: (p: number) => void;
    signal: AbortSignal;
  },
): Promise<{ url: string; paths: string[] }> {
  const config = job.config;
  const { warnings: _warnings, ...base } = await buildProps(config, opts.resolver, opts.limits);
  const props: CompositionProps = { ...base, assetBaseUrl: opts.assetBaseUrl };
  const { timeline } = props;

  mkdirSync(opts.outDir, { recursive: true });
  const name = renderFileName(config);

  if (config.export === "srt") {
    const lines: string[] = [];
    timeline.slides.forEach((slide, i) => {
      const start = slide.startFrame / timeline.fps;
      const end = (slide.startFrame + slide.durationInFrames) / timeline.fps;
      const text = slide.ayah.translation ? `${slide.ayah.text}\n${slide.ayah.translation}` : slide.ayah.text;
      lines.push(`${i + 1}`, `${srtTimestamp(start)} --> ${srtTimestamp(end)}`, text, "");
    });
    const file = path.join(opts.outDir, name);
    writeFileSync(file, lines.join("\n"), "utf8");
    opts.onProgress(1);
    return { url: `/out/${name}`, paths: [file] };
  }

  const serveUrl = await getServeUrl(opts.entryPoint);
  if (opts.signal.aborted) throw new Error("cancelled");
  const composition = await selectComposition({ serveUrl, id: compositionId(config.aspectRatio), inputProps: props });

  if (config.export === "png") {
    const file = path.join(opts.outDir, name);
    await renderStill({
      serveUrl,
      composition,
      inputProps: props,
      output: file,
      frame: Math.min(config.pngFrame ?? 0, composition.durationInFrames - 1),
    });
    opts.onProgress(1);
    return { url: `/out/${name}`, paths: [file] };
  }

  const file = path.join(opts.outDir, name);
  const { cancelSignal, cancel } = makeCancelSignal();
  const onAbort = () => cancel();
  opts.signal.addEventListener("abort", onAbort);
  try {
    await renderMedia({
      serveUrl,
      composition,
      inputProps: props,
      codec: config.export === "webm" ? "vp8" : "h264",
      outputLocation: file,
      cancelSignal,
      concurrency: opts.concurrency ?? null,
      onProgress: ({ progress }) => opts.onProgress(progress),
    });
  } catch (e) {
    rmSync(file, { force: true });
    throw e;
  } finally {
    opts.signal.removeEventListener("abort", onAbort);
  }
  return { url: `/out/${name}`, paths: [file] };
}
