import { z } from "zod";

export const AspectRatioSchema = z.enum(["9:16", "16:9", "1:1", "4:5"]);
export const VideoModeSchema = z.enum(["ayah", "ayahTafsir", "mushafPage", "mushafWords", "wordHighlight"]);

/** Modes drawn on the scanned Mushaf page. */
export function isMushafMode(mode: string): mode is "mushafPage" | "mushafWords" {
  return mode === "mushafPage" || mode === "mushafWords";
}

/** Wide Mushaf videos without tafsir show the open book: the page and the one facing it. */
export function isMushafSpread(c: { mode: string; aspectRatio?: string; tafsir?: string | null; translation?: string | null }): boolean {
  return isMushafMode(c.mode) && c.aspectRatio === "16:9" && !c.tafsir && !c.translation;
}

/** In the Madani Mushaf odd pages sit on the right and pair with the next even page. */
export function facingPage(page: number): number {
  return page % 2 ? page + 1 : page - 1;
}
export const RangeKindSchema = z.enum(["surah", "juz", "hizb", "rub", "page", "manzil"]);
export type RangeKind = z.infer<typeof RangeKindSchema>;

export const TimingModeSchema = z.enum(["continuous", "reading"]);
export const ReadingSpeedSchema = z.enum(["fast", "slow", "verySlow"]);
export const ExportFormatSchema = z.enum(["mp4", "webm", "png", "srt", "batch"]);
export const BackgroundTypeSchema = z.enum(["color", "gradient", "image", "video"]);
export const TransitionSchema = z.enum(["fade", "slide", "rise", "zoom", "blur", "none"]);
export type Transition = z.infer<typeof TransitionSchema>;

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
  /** Largest tafsir text size (px on a 1080 canvas); long tafsir splits into more pages as it grows. */
  tafsirFontSize: z.number().min(24).max(96).default(60),
  /** Largest translation text size in Mushaf page mode (px on a 1080 canvas); the single-ayah page sizes it itself. */
  translationFontSize: z.number().min(20).max(80).default(40),
  tajweed: z.boolean().default(true),
  showWatermark: z.boolean().default(true),
  watermarkText: z.string().default("AutoAyah"),
  /** Draw a translucent panel behind the content when the background is a photo or video. */
  mediaPanel: z.boolean().default(true),
  /** Panel fill when over media: auto follows the light/dark theme (white / near-black). */
  mediaPanelColor: z.enum(["auto", "white", "black"]).default("auto"),
  /** Panel opacity when over media (0 = invisible, 1 = solid). */
  mediaPanelOpacity: z.number().min(0).max(1).default(0.9),
  /** Mushaf modes: paper and ink of the scanned page ("auto" follows the light/dark theme). */
  mushafPaper: z.enum(["auto", "ivory", "white", "sepia", "mint", "night"]).default("auto"),
  /** Mushaf modes: frame drawn around the page. */
  mushafFrame: z.enum(["classic", "ornate", "simple", "card", "none"]).default("classic"),
  /** How one ayah (or Mushaf page) hands over to the next. */
  transition: TransitionSchema.default("fade"),
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
    /** Last surah when the clip runs across surahs (e.g. a juz); null means the clip ends in `surah`. */
    toSurah: z.number().int().min(1).max(114).nullable().default(null),
    /** Last ayah, in `toSurah` when set, otherwise in `surah`. */
    to: z.number().int().positive(),
    /** The named division this range was picked from, for labels only. */
    range: z.object({ kind: RangeKindSchema, n: z.number().int().positive() }).nullable().default(null),
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
  .refine((c) => (c.toSurah ?? c.surah) > c.surah || ((c.toSurah ?? c.surah) === c.surah && c.from <= c.to), {
    message: "The range must end at or after where it starts",
    path: ["to"],
  });

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
  /** Surah of this ayah (clips can span surahs). */
  surah: z.number().int().optional(),
  /** Basmala shown before this ayah when it opens a surah. */
  basmala: z.string().optional(),
  text: z.string(),
  /** AlQuran.cloud tajweed markup, e.g. "[h:1[ٱ]". */
  tajweed: z.string().optional(),
  words: z.array(z.string()).optional(),
  tafsir: z.string().optional(),
  translation: z.string().optional(),
  audioUrl: z.string(),
  audioSeconds: z.number(),
  /** Played from one continuous cut of the surah recording (`url`), starting `offsetMs` into it. */
  run: z.object({ url: z.string(), offsetMs: z.number().min(0) }).optional(),
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
  /** Arabic names of every surah in the clip, by number. */
  surahNames: z.record(z.string(), z.string()).optional(),
  ayat: z.array(ResolvedAyahSchema),
  mushafPages: z.array(MushafPageSchema).optional(),
  /** Text-only clip: no audio or word timings, ayah lengths are estimates. */
  draft: z.boolean().optional(),
  /** Silence added after each ayah; 0 when the ayat are back-to-back cuts of one continuous recording. */
  audioGapSeconds: z.number().min(0).optional(),
});

export type ResolvedClip = z.infer<typeof ResolvedClipSchema>;
