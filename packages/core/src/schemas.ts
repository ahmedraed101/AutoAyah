import { z } from "zod";

export const AspectRatioSchema = z.enum(["9:16", "16:9", "1:1", "4:5"]);
export const VideoModeSchema = z.enum(["ayah", "ayahTafsir", "mushafPage", "mushafWords", "wordHighlight"]);

/** Modes drawn on the scanned Mushaf page. */
export function isMushafMode(mode: string): mode is "mushafPage" | "mushafWords" {
  return mode === "mushafPage" || mode === "mushafWords";
}
export const TimingModeSchema = z.enum(["continuous", "reading"]);
export const ReadingSpeedSchema = z.enum(["fast", "slow", "verySlow"]);
export const ExportFormatSchema = z.enum(["mp4", "webm", "png", "srt", "batch"]);
export const BackgroundTypeSchema = z.enum(["color", "gradient", "image", "video"]);

/** Absolute http(s) URL, or a server-relative path such as /uploads/x.jpg. */
export const MediaUrlSchema = z
  .string()
  .refine((u) => /^https?:\/\//i.test(u) || /^\/(?!\/)/.test(u), "Must be an http(s) URL or a /path on this server");

export const MediaRefSchema = z.object({
  provider: z.enum(["pexels", "unsplash", "pixabay", "upload", "url", "bundled"]),
  id: z.string(),
  url: MediaUrlSchema.optional(),
  previewUrl: z.string().optional(),
  attribution: z.string().optional(),
  photographer: z.string().optional(),
  photographerUrl: z.string().optional(),
  downloadLocation: z.string().optional(),
  /** Seconds — lets background videos loop seamlessly. */
  duration: z.number().positive().optional(),
});

export const BackgroundSegmentSchema = z.object({
  type: BackgroundTypeSchema,
  fromAyah: z.number().int().positive(),
  toAyah: z.number().int().positive(),
  color: z.string().optional(),
  gradient: z.tuple([z.string(), z.string()]).optional(),
  media: MediaRefSchema.optional(),
});

export const AudioConfigSchema = z.object({
  recitationVolume: z.number().min(0).max(1).default(1),
  ambienceId: z.string().nullable().default(null),
  ambienceVolume: z.number().min(0).max(1).default(0.25),
  backgroundVideoSound: z.boolean().default(false),
  backgroundVideoVolume: z.number().min(0).max(1).default(0.15),
  fadeInSeconds: z.number().min(0).default(0.3),
  fadeOutSeconds: z.number().min(0).default(0.5),
});

export const StyleConfigSchema = z.object({
  template: z.string().default("classic"),
  theme: z.enum(["light", "dark"]).default("light"),
  primaryColor: z.string().default("#3f7d4e"),
  accentColor: z.string().default("#b8935f"),
  backgroundColor: z.string().default("#ffffff"),
  cardColor: z.string().default("#f9f2e4"),
  textColor: z.string().default("#111111"),
  fontSize: z.number().min(20).max(200).default(64),
  tajweed: z.boolean().default(true),
  showWatermark: z.boolean().default(true),
  watermarkText: z.string().default("AutoAyah"),
  /** Mushaf modes: paper and ink of the scanned page ("auto" follows the light/dark theme). */
  mushafPaper: z.enum(["auto", "ivory", "white", "sepia", "mint", "night"]).default("auto"),
  /** Mushaf modes: frame drawn around the page. */
  mushafFrame: z.enum(["classic", "ornate", "simple", "card", "none"]).default("classic"),
});

export const TimingConfigSchema = z.object({
  mode: TimingModeSchema.default("continuous"),
  readingSpeed: ReadingSpeedSchema.default("slow"),
  ayahOverrides: z
    .record(z.string(), z.object({ holdSeconds: z.number().min(0).optional() }))
    .default({}),
});

export const VideoConfigSchema = z
  .object({
    aspectRatio: AspectRatioSchema.default("9:16"),
    surah: z.number().int().min(1).max(114),
    from: z.number().int().positive(),
    to: z.number().int().positive(),
    reciter: z.string().regex(/^[\w.-]+$/, "Invalid reciter id"),
    tafsir: z.string().nullable().default(null),
    translation: z.string().nullable().default(null),
    mode: VideoModeSchema.default("ayah"),
    timing: TimingConfigSchema.default({}),
    style: StyleConfigSchema.default({}),
    backgrounds: z.array(BackgroundSegmentSchema).default([]),
    audio: AudioConfigSchema.default({}),
    export: ExportFormatSchema.default("mp4"),
    pngFrame: z.number().int().min(0).optional(),
  })
  .refine((c) => c.from <= c.to, { message: "`from` must be less than or equal to `to`", path: ["to"] });

export type VideoConfig = z.infer<typeof VideoConfigSchema>;
export type AudioConfig = z.infer<typeof AudioConfigSchema>;
export type StyleConfig = z.infer<typeof StyleConfigSchema>;
export type TimingConfig = z.infer<typeof TimingConfigSchema>;
export type BackgroundSegment = z.infer<typeof BackgroundSegmentSchema>;
export type MediaRef = z.infer<typeof MediaRefSchema>;
export type VideoMode = z.infer<typeof VideoModeSchema>;
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  config: VideoConfigSchema,
});

export type Project = z.infer<typeof ProjectSchema>;

export const JobStatusSchema = z.enum(["queued", "rendering", "done", "failed", "cancelled"]);

export const JobSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable().optional(),
  configHash: z.string(),
  config: VideoConfigSchema,
  status: JobStatusSchema,
  progress: z.number().min(0).max(1).default(0),
  outputUrl: z.string().nullable().optional(),
  outputPaths: z.array(z.string()).optional(),
  error: z.string().nullable().optional(),
  queuePosition: z.number().int().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable().optional(),
  finishedAt: z.string().nullable().optional(),
});

export type Job = z.infer<typeof JobSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const AppConfigSchema = z.object({
  appMode: z.enum(["self_hosted", "hosted"]),
  storageMode: z.enum(["db", "browser"]),
  showDownloads: z.boolean(),
  hasPassword: z.boolean(),
  qfConnected: z.boolean(),
  publicUrl: z.string(),
  capabilities: z.object({
    wordTimings: z.boolean(),
    mushafLayout: z.boolean(),
    fullTafsirCatalog: z.boolean(),
    translations: z.boolean(),
  }),
  limits: z
    .object({
      maxAyatPerVideo: z.number().nullable(),
      maxVideoSeconds: z.number().nullable(),
      renderLimitPerDay: z.number().nullable(),
    })
    .optional(),
  peopleDetector: z.object({ ready: z.boolean(), error: z.string().nullable() }).optional(),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export const WordTimingSchema = z.object({
  index: z.number().int(),
  text: z.string(),
  startMs: z.number(),
  endMs: z.number(),
});

export const ResolvedAyahSchema = z.object({
  number: z.number().int(),
  text: z.string(),
  /** AlQuran.cloud tajweed markup, e.g. "[h:1[ٱ]". */
  tajweed: z.string().optional(),
  words: z.array(z.string()).optional(),
  tafsir: z.string().optional(),
  translation: z.string().optional(),
  audioUrl: z.string(),
  audioSeconds: z.number(),
  wordTimings: z.array(WordTimingSchema).optional(),
  page: z.number().int().optional(),
  lineStart: z.number().int().optional(),
  lineEnd: z.number().int().optional(),
});

export type ResolvedAyah = z.infer<typeof ResolvedAyahSchema>;
export type WordTiming = z.infer<typeof WordTimingSchema>;

/** One physical line of the 15-line Madani Mushaf. */
export const MushafLineSchema = z.discriminatedUnion("kind", [
  z.object({
    line: z.number().int(),
    kind: z.literal("ayah"),
    /** `verseKey` is "surah:ayah" (a page can span two surahs); `ayahEnd` marks the end-of-ayah medallion. */
    words: z.array(z.object({ verseKey: z.string(), text: z.string(), ayahEnd: z.number().int().optional() })),
  }),
  z.object({ line: z.number().int(), kind: z.literal("surah"), surah: z.number().int() }),
  z.object({ line: z.number().int(), kind: z.literal("basmala"), surah: z.number().int() }),
]);

export const MushafPageSchema = z.object({
  page: z.number().int(),
  lines: z.array(MushafLineSchema),
  /** Names for any surah title lines on the page. */
  surahNames: z.record(z.string(), z.string()).default({}),
  basmala: z.string().optional(),
  /** Scanned page image; when present it is shown instead of the rebuilt text lines. */
  image: z.object({ url: z.string(), width: z.number(), height: z.number() }).optional(),
  /** Per-ayah boxes on the image ("surah:ayah" → [x, y, w, h][] in image pixels). */
  boxes: z.record(z.string(), z.array(z.tuple([z.number(), z.number(), z.number(), z.number()]))).optional(),
  /** Per-word boxes in reading order ("surah:ayah" → one [x, y, w, h] per word, ayah-end marker excluded). */
  words: z.record(z.string(), z.array(z.tuple([z.number(), z.number(), z.number(), z.number()]))).optional(),
});

export type MushafLine = z.infer<typeof MushafLineSchema>;
export type MushafPage = z.infer<typeof MushafPageSchema>;

export const ResolvedClipSchema = z.object({
  surah: z.number().int(),
  surahName: z.string(),
  surahNameEn: z.string().optional(),
  tafsirName: z.string().optional(),
  translationName: z.string().optional(),
  /** Basmala split off the start of ayah 1 (shown as a header, not as part of the ayah). */
  basmala: z.string().optional(),
  ayat: z.array(ResolvedAyahSchema),
  mushafPages: z.array(MushafPageSchema).optional(),
});

export type ResolvedClip = z.infer<typeof ResolvedClipSchema>;
