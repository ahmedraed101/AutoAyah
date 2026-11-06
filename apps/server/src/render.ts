import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, makeCancelSignal, renderFrames, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { buildTimeline, renderFileName, type Job, type VideoConfig } from "@autoayah/core";
import type { Resolver } from "@autoayah/data";
import type { CompositionProps } from "@autoayah/templates";
import { frameKeys } from "@autoayah/templates/frames";

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
  draft = false,
): Promise<CompositionProps & { warnings: string[] }> {
  const clip = await resolver.resolveClip({ ...config, draft });
  const timeline = buildTimeline(config, clip);
  if (limits.maxSeconds && timeline.totalSeconds > limits.maxSeconds) {
    const message = `Video would be ${Math.ceil(timeline.totalSeconds)}s; this server allows at most ${limits.maxSeconds}s`;
    if (!draft) throw new Error(message);
    timeline.warnings.push(`${message} (estimated before the recitation is fetched)`);
  }
  return {
    timeline,
    config,
    surahName: clip.surahName,
    tafsirName: clip.tafsirName,
    translationName: clip.translationName,
    basmala: clip.basmala,
    surahNames: clip.surahNames,
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
    const keys = hasFfmpeg() ? frameKeys(props) : null;
    const runs = keys ? distinctRuns(keys) : [];
    if (keys && runs.length < keys.length * 0.6) {
      await renderDistinct({ serveUrl, props, runs, file, cancelSignal, signal: opts.signal, concurrency: opts.concurrency, onProgress: opts.onProgress });
      return { url: `/out/${name}`, paths: [file] };
    }
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

let ffmpegChecked: boolean | undefined;
function hasFfmpeg() {
  ffmpegChecked ??= spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
  return ffmpegChecked;
}

/** Consecutive frames with the same key collapse into one run: [first frame, length]. */
function distinctRuns(keys: string[]): [number, number][] {
  const runs: [number, number][] = [];
  keys.forEach((k, f) => {
    const last = runs[runs.length - 1];
    if (last && keys[last[0]] === k) last[1]++;
    else runs.push([f, 1]);
  });
  return runs;
}

/**
 * Most frames repeat the one before (a static page between word or tafsir changes), so only the distinct
 * frames are screenshotted; ffmpeg holds each for its run and mixes the recitation straight from the clips.
 */
async function renderDistinct(o: {
  serveUrl: string;
  props: CompositionProps;
  runs: [number, number][];
  file: string;
  cancelSignal: ReturnType<typeof makeCancelSignal>["cancelSignal"];
  signal: AbortSignal;
  concurrency?: number;
  onProgress: (p: number) => void;
}) {
  const { props, file, runs } = o;
  const { timeline, config } = props;
  const inputProps: CompositionProps = { ...props, frameMap: runs.map(([f]) => f) };
  const composition = await selectComposition({ serveUrl: o.serveUrl, id: compositionId(config.aspectRatio), inputProps });
  const work = mkdtempSync(path.join(os.tmpdir(), "autoayah-"));
  // A screenshot costs roughly as much as encoding 8 output frames.
  const shotShare = runs.length / (runs.length + timeline.totalFrames / 8);
  try {
    await renderFrames({
      serveUrl: o.serveUrl,
      composition,
      inputProps,
      outputDir: work,
      imageFormat: "jpeg",
      jpegQuality: 95,
      concurrency: o.concurrency ?? null,
      cancelSignal: o.cancelSignal,
      onStart: () => undefined,
      onFrameUpdate: (done) => o.onProgress((done / runs.length) * shotShare),
    });
    const frames = readdirSync(work)
      .filter((f) => f.endsWith(".jpeg"))
      .sort();
    if (frames.length !== runs.length) throw new Error(`Expected ${runs.length} frames, got ${frames.length}`);

    const fps = timeline.fps;
    const total = timeline.totalFrames / fps;
    // Each distinct frame is decoded once and held for its run. `framerate` stops the image demuxer from
    // rounding durations to 1/25 s; the repeated last entry plus `-t` keep the final run its full length.
    const entry = (f: string) => `file '${path.join(work, f)}'\noption framerate ${fps}`;
    const list = runs.map(([, len], i) => `${entry(frames[i]!)}\nduration ${(len / fps).toFixed(6)}`);
    list.push(entry(frames[frames.length - 1]!));
    writeFileSync(path.join(work, "frames.txt"), list.join("\n"));

    const asset = (u: string) => (u.startsWith("/") ? `${props.assetBaseUrl ?? ""}${u}` : u);
    const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(work, "frames.txt")];
    const chains: string[] = [];
    const mix: string[] = [];
    const stereo = "aformat=sample_rates=48000:channel_layouts=stereo";
    timeline.slides.forEach((s, i) => {
      args.push("-i", asset(s.ayah.audioUrl));
      const startMs = Math.round((s.startFrame / fps) * 1000);
      chains.push(
        `[${i + 1}:a]atrim=0:${(s.durationInFrames / fps).toFixed(4)},asetpts=PTS-STARTPTS,${stereo},` +
          `volume=${config.audio.recitationVolume},adelay=${startMs}:all=1[a${i}]`,
      );
      mix.push(`[a${i}]`);
    });
    if (config.audio.ambienceId) {
      const idx = timeline.slides.length + 1;
      args.push("-stream_loop", "-1", "-i", asset(`/ambience/${config.audio.ambienceId}.wav`));
      chains.push(`[${idx}:a]atrim=0:${total.toFixed(4)},asetpts=PTS-STARTPTS,${stereo},volume=${config.audio.ambienceVolume}[amb]`);
      mix.push("[amb]");
    }
    const fadeIn = Math.max(1, Math.round(config.audio.fadeInSeconds * fps)) / fps;
    const fadeOut = Math.max(1, Math.round(config.audio.fadeOutSeconds * fps)) / fps;
    chains.push(
      `${mix.join("")}amix=inputs=${mix.length}:normalize=0:dropout_transition=0,apad,atrim=0:${total.toFixed(4)},` +
        `afade=t=in:d=${fadeIn.toFixed(4)},afade=t=out:st=${Math.max(0, total - fadeOut).toFixed(4)}:d=${fadeOut.toFixed(4)}[aout]`,
    );
    const webm = config.export === "webm";
    args.push(
      "-filter_complex",
      chains.join(";"),
      "-map",
      "0:v",
      "-map",
      "[aout]",
      "-vf",
      `format=yuv420p,fps=${fps}`,
      ...(webm
        ? ["-c:v", "libvpx", "-crf", "10", "-b:v", "4M", "-c:a", "libopus", "-b:a", "192k"]
        : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart"]),
      "-t",
      total.toFixed(4),
      file,
    );
    await runFfmpeg(args, o.signal, total, (p) => o.onProgress(shotShare + p * (1 - shotShare)));
    o.onProgress(1);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function runFfmpeg(args: string[], signal: AbortSignal, totalSeconds: number, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", ["-progress", "pipe:1", "-nostats", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    const onAbort = () => child.kill("SIGKILL");
    signal.addEventListener("abort", onAbort);
    child.stdout.on("data", (d: Buffer) => {
      const m = /out_time_us=(\d+)/.exec(d.toString());
      if (m) onProgress(Math.min(1, Number(m[1]) / 1e6 / totalSeconds));
    });
    child.stderr.on("data", (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4000)));
    child.on("error", reject);
    child.on("close", (code) => {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) reject(new Error("cancelled"));
      else if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${code}): ${stderr.trim()}`));
    });
  });
}
