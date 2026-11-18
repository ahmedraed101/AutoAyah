import { z } from "zod";
import { MediaRefSchema, VideoConfigSchema, type Job, type RangeKind, type VideoConfig } from "./schemas.js";
import { ayahCount, divisionRange, surahRange, type AyahRef, type QuranDivisions } from "./ranges.js";

/** YouTube and TikTok lead; the rest are available on every video. */
export const PLATFORMS = [
  { id: "youtube", label: "YouTube" },
  { id: "tiktok", label: "TikTok" },
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "x", label: "X" },
  { id: "snapchat", label: "Snapchat" },
  { id: "threads", label: "Threads" },
  { id: "telegram", label: "Telegram" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "pinterest", label: "Pinterest" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "other", label: "Other" },
] as const;

export const PlatformIdSchema = z.enum([
  "youtube",
  "tiktok",
  "instagram",
  "facebook",
  "x",
  "snapchat",
  "threads",
  "telegram",
  "whatsapp",
  "pinterest",
  "linkedin",
  "other",
]);
export type PlatformId = z.infer<typeof PlatformIdSchema>;

export const SeriesUnitKindSchema = z.enum(["surah", "juz", "hizb", "rub", "page", "manzil", "chunk"]);
export type SeriesUnitKind = z.infer<typeof SeriesUnitKindSchema>;

const MediaKindSchema = z.enum(["image", "video"]);

/** How a series picks the background of each video. `template` keeps the settings form's backgrounds. */
export const BackgroundPlanSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("template") }),
  z.object({ mode: z.literal("single"), type: MediaKindSchema, media: MediaRefSchema }),
  z.object({
    mode: z.literal("list"),
    items: z.array(z.object({ type: MediaKindSchema, media: MediaRefSchema })).min(1).max(40),
  }),
  z.object({ mode: z.literal("random"), kind: MediaKindSchema }),
]);
export type BackgroundPlan = z.infer<typeof BackgroundPlanSchema>;

const seriesFields = {
  unitKind: SeriesUnitKindSchema,
  /** Ayat per video when `unitKind` is `chunk` (1–50). */
  chunkSize: z.number().int().min(1).max(50).optional(),
  /** Surahs to split when `unitKind` is `chunk`. */
  chunkSurahs: z.array(z.number().int().min(1).max(114)).max(114).optional(),
  template: VideoConfigSchema,
  backgrounds: BackgroundPlanSchema.default({ mode: "template" }),
  platforms: z.array(PlatformIdSchema).max(PLATFORMS.length).default(["youtube", "tiktok"]),
};

const chunkReady = (s: { unitKind: string; chunkSize?: number; chunkSurahs?: number[] }) =>
  s.unitKind !== "chunk" || ((s.chunkSize ?? 0) >= 1 && (s.chunkSurahs?.length ?? 0) >= 1);

export const SeriesConfigSchema = z.object(seriesFields).refine(chunkReady, {
  message: "Choose the surahs and how many ayat each video covers",
  path: ["chunkSurahs"],
});
export type SeriesConfig = z.infer<typeof SeriesConfigSchema>;

export const SeriesInputSchema = z
  .object({ name: z.string().trim().min(1).max(120), ...seriesFields })
  .refine(chunkReady, { message: "Choose the surahs and how many ayat each video covers", path: ["chunkSurahs"] });
export type SeriesInput = z.infer<typeof SeriesInputSchema>;

export const SeriesSchema = z
  .object({
    id: z.string(),
    name: z.string().trim().min(1).max(120),
    ...seriesFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .refine(chunkReady, { message: "Choose the surahs and how many ayat each video covers", path: ["chunkSurahs"] });
export type Series = z.infer<typeof SeriesSchema>;

export const UploadSchema = z.object({
  jobId: z.string(),
  platform: PlatformIdSchema,
  url: z.string().nullable(),
  uploadedAt: z.string(),
});
export type Upload = z.infer<typeof UploadSchema>;

export const UploadInputSchema = z.object({
  jobId: z.string().min(1),
  platform: PlatformIdSchema,
  url: z.union([z.string().trim().url().max(2000), z.literal(""), z.null()]).optional(),
});
export type UploadInput = z.infer<typeof UploadInputSchema>;

/** Which units a run should consider. Indexes in `range` are 1-based positions in `seriesUnits` order. */
export const UnitSelectSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all") }),
  z.object({ type: z.literal("range"), from: z.number().int().positive().max(10000), to: z.number().int().positive().max(10000) }),
  z.object({ type: z.literal("keys"), keys: z.array(z.string().min(1)).min(1).max(2000) }),
  z.object({ type: z.literal("nextN"), n: z.number().int().min(1).max(2000) }),
]);
export type UnitSelect = z.infer<typeof UnitSelectSchema>;

export type SeriesUnit = {
  key: string;
  label: string;
  range: Pick<VideoConfig, "surah" | "from" | "to" | "toSurah" | "range">;
};

export type SeriesUnitView = SeriesUnit & {
  juz: number;
  status: "none" | "queued" | "rendering" | "done" | "failed" | "cancelled";
  job: Job | null;
  uploads: Upload[];
};

const DIVISION_KINDS = ["juz", "hizb", "rub", "page", "manzil"] as const;
type DivisionKind = (typeof DIVISION_KINDS)[number];
const isDivisionKind = (kind: SeriesUnitKind): kind is DivisionKind => (DIVISION_KINDS as readonly string[]).includes(kind);

/** One video per surah, division, or slice of ayat, in Mushaf order. */
export function seriesUnits(
  kind: SeriesUnitKind,
  divisions: QuranDivisions,
  opts: { chunkSize?: number; chunkSurahs?: number[] } = {},
): SeriesUnit[] {
  if (kind === "surah") {
    return Array.from({ length: 114 }, (_, i) => {
      const n = i + 1;
      return { key: `surah:${n}`, label: String(n), range: surahRange(n) };
    });
  }
  if (kind === "chunk") {
    const size = Math.max(1, opts.chunkSize ?? 10);
    const surahs = [...new Set(opts.chunkSurahs ?? [])].filter((n) => n >= 1 && n <= 114).sort((a, b) => a - b);
    const out: SeriesUnit[] = [];
    for (const surah of surahs) {
      const total = ayahCount(surah);
      for (let from = 1; from <= total; from += size) {
        const to = Math.min(total, from + size - 1);
        out.push({
          key: `chunk:${surah}:${from}-${to}`,
          label: `${surah}:${from}-${to}`,
          range: { surah, from, toSurah: null, to, range: null },
        });
      }
    }
    return out;
  }
  if (!isDivisionKind(kind)) return [];
  return divisions[kind].map((d) => ({
    key: `${kind}:${d.n}`,
    label: String(d.n),
    range: divisionRange(kind as RangeKind, d),
  }));
}

const atOrAfter = (a: AyahRef, b: AyahRef) => a.surah > b.surah || (a.surah === b.surah && a.ayah >= b.ayah);
const atOrBefore = (a: AyahRef, b: AyahRef) => a.surah < b.surah || (a.surah === b.surah && a.ayah <= b.ayah);

/** Juz that contains the unit's first ayah (1 when the boundaries are missing). */
export function unitJuz(unit: Pick<SeriesUnit, "range">, divisions: QuranDivisions): number {
  const ref = { surah: unit.range.surah, ayah: unit.range.from };
  return divisions.juz.find((d) => atOrAfter(ref, d.start) && atOrBefore(ref, d.end))?.n ?? 1;
}

const BUSY = new Set(["done", "queued", "rendering"]);

/**
 * Units a run will enqueue. Done, queued and rendering units are left alone unless `regenerate` is set.
 * `nextN` always takes the next units that are not already done or in progress.
 */
export function unitsToQueue(
  units: SeriesUnit[],
  select: UnitSelect,
  statusOf: (unit: SeriesUnit) => string | undefined,
  regenerate: boolean,
): { queue: SeriesUnit[]; skipped: number } {
  const blocked = (unit: SeriesUnit) => BUSY.has(statusOf(unit) ?? "");
  let chosen: SeriesUnit[];
  if (select.type === "keys") {
    const want = new Set(select.keys);
    chosen = units.filter((unit) => want.has(unit.key));
  } else if (select.type === "range") {
    const from = Math.min(select.from, select.to);
    const to = Math.max(select.from, select.to);
    chosen = units.filter((_, index) => index + 1 >= from && index + 1 <= to);
  } else if (select.type === "nextN") {
    chosen = units.filter((unit) => !blocked(unit)).slice(0, select.n);
  } else {
    chosen = units;
  }
  if (select.type === "nextN" || regenerate) return { queue: chosen, skipped: 0 };
  const queue = chosen.filter((unit) => !blocked(unit));
  return { queue, skipped: chosen.length - queue.length };
}

/** One segment wide enough for every ayah number (Al-Baqarah has 286). Later surahs keep the last match. */
export function coverBackground(type: "image" | "video", media: z.infer<typeof MediaRefSchema>): VideoConfig["backgrounds"][number] {
  return { type, fromAyah: 1, toAyah: 286, media };
}
