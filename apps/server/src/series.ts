import { randomUUID } from "node:crypto";
import {
  MediaRefSchema,
  SeriesConfigSchema,
  SeriesInputSchema,
  SeriesSchema,
  VideoConfigSchema,
  coverBackground,
  seriesUnits,
  unitJuz,
  unitsToQueue,
  type Job,
  type QuranDivisions,
  type Series,
  type SeriesInput,
  type SeriesUnit,
  type SeriesUnitView,
  type UnitSelect,
  type Upload,
  type UploadInput,
  type VideoConfig,
} from "@autoayah/core";
import type { Db, JobRow, SeriesRow } from "./db/index.js";
import type { MediaLibrary } from "./media-library.js";

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    parentId: row.parent_id,
    configHash: row.config_hash,
    config: JSON.parse(row.config_json) as VideoConfig,
    status: row.status as Job["status"],
    progress: row.progress,
    outputUrl: row.output_url,
    outputPaths: row.output_paths_json ? (JSON.parse(row.output_paths_json) as string[]) : undefined,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function toUpload(row: { job_id: string; platform: string; url: string | null; uploaded_at: string }): Upload {
  return { jobId: row.job_id, platform: row.platform as Upload["platform"], url: row.url, uploadedAt: row.uploaded_at };
}

/** Turns a saved setup into one render job per surah, page, quarter or chunk, and reads them back for the tracker. */
export class SeriesService {
  private divisionsPromise: Promise<QuranDivisions> | null = null;

  constructor(
    private db: Db,
    private media: MediaLibrary,
    private divisions: () => Promise<QuranDivisions>,
    private createJob: (config: VideoConfig) => Job,
  ) {}

  private loadDivisions() {
    this.divisionsPromise ??= this.divisions().catch((error: unknown) => {
      this.divisionsPromise = null;
      throw error;
    });
    return this.divisionsPromise;
  }

  private toSeries(row: SeriesRow): Series {
    const config = SeriesConfigSchema.parse(JSON.parse(row.config_json));
    return SeriesSchema.parse({
      id: row.id,
      name: row.name,
      ...config,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private configOf(input: SeriesInput) {
    const { name: _name, ...config } = input;
    return config;
  }

  list(): Series[] {
    return this.db.listSeries().map((row) => this.toSeries(row));
  }

  get(id: string): Series | null {
    const row = this.db.getSeries(id);
    return row ? this.toSeries(row) : null;
  }

  create(input: SeriesInput): Series {
    const parsed = SeriesInputSchema.parse(input);
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.insertSeries({
      id,
      name: parsed.name,
      config_json: JSON.stringify(this.configOf(parsed)),
      created_at: now,
      updated_at: now,
    });
    return this.get(id)!;
  }

  update(id: string, input: SeriesInput): Series | null {
    const existing = this.db.getSeries(id);
    if (!existing) return null;
    const parsed = SeriesInputSchema.parse(input);
    this.db.updateSeries({
      id,
      name: parsed.name,
      config_json: JSON.stringify(this.configOf(parsed)),
      created_at: existing.created_at,
      updated_at: new Date().toISOString(),
    });
    return this.get(id);
  }

  remove(id: string): boolean {
    if (!this.db.getSeries(id)) return false;
    this.db.deleteSeries(id);
    return true;
  }

  private async backgroundPool(series: Series): Promise<VideoConfig["backgrounds"] | null> {
    const plan = series.backgrounds;
    if (plan.mode === "template") return null;
    if (plan.mode === "single") return [coverBackground(plan.type, plan.media)];
    if (plan.mode === "list") return plan.items.map((item) => coverBackground(item.type, item.media));
    const items = await this.media.list(plan.kind);
    const pool = items.flatMap((item) => {
      const media = MediaRefSchema.safeParse(item);
      return media.success && (item.type === "image" || item.type === "video") ? [coverBackground(item.type, media.data)] : [];
    });
    if (!pool.length) throw new Error("No backgrounds in the library yet. Load some from the editor, or choose one photo.");
    return pool;
  }

  async units(id: string): Promise<SeriesUnitView[] | null> {
    const series = this.get(id);
    if (!series) return null;
    const divisions = await this.loadDivisions();
    const units = seriesUnits(series.unitKind, divisions, { chunkSize: series.chunkSize, chunkSurahs: series.chunkSurahs });
    const links = this.db.listSeriesItems(id);
    const jobs = new Map(this.db.jobsByIds(links.map((link) => link.job_id)).map((row) => [row.id, toJob(row)]));
    const uploads = new Map<string, Upload[]>();
    for (const row of this.db.listUploads(links.map((link) => link.job_id))) {
      const upload = toUpload(row);
      uploads.set(upload.jobId, [...(uploads.get(upload.jobId) ?? []), upload]);
    }
    const linkByKey = new Map(links.map((link) => [link.unit_key, link]));
    return units.map((unit) => {
      const link = linkByKey.get(unit.key);
      const job = link ? (jobs.get(link.job_id) ?? null) : null;
      return { ...unit, juz: unitJuz(unit, divisions), status: job?.status ?? "none", job, uploads: job ? (uploads.get(job.id) ?? []) : [] };
    });
  }

  async run(id: string, select: UnitSelect, opts: { regenerate?: boolean } = {}): Promise<{ queued: number; skipped: number; error?: string } | null> {
    const series = this.get(id);
    if (!series) return null;
    const divisions = await this.loadDivisions();
    const units = seriesUnits(series.unitKind, divisions, { chunkSize: series.chunkSize, chunkSurahs: series.chunkSurahs });
    const links = this.db.listSeriesItems(id);
    const jobs = new Map(this.db.jobsByIds(links.map((link) => link.job_id)).map((row) => [row.id, toJob(row)]));
    const linkByKey = new Map(links.map((link) => [link.unit_key, link]));
    const statusOf = (unit: SeriesUnit) => {
      const link = linkByKey.get(unit.key);
      return link ? jobs.get(link.job_id)?.status : undefined;
    };
    const picked = unitsToQueue(units, select, statusOf, Boolean(opts.regenerate));
    const pool = await this.backgroundPool(series);
    const indexOf = new Map(units.map((unit, index) => [unit.key, index]));
    let queued = 0;
    for (const unit of picked.queue) {
      try {
        const backgrounds = pool ? [pool[indexOf.get(unit.key)! % pool.length]!] : series.template.backgrounds;
        const config = VideoConfigSchema.parse({
          ...series.template,
          ...unit.range,
          export: series.template.export === "webm" ? "webm" : "mp4",
          pngFrame: undefined,
          backgrounds,
        });
        const job = this.createJob(config);
        this.db.upsertSeriesItem({
          series_id: id,
          unit_key: unit.key,
          job_id: job.id,
          created_at: new Date().toISOString(),
        });
        queued++;
      } catch (error) {
        return { queued, skipped: picked.skipped, error: (error as Error).message };
      }
    }
    return { queued, skipped: picked.skipped };
  }

  setUpload(input: UploadInput): Upload {
    const now = new Date().toISOString();
    const row = { job_id: input.jobId, platform: input.platform, url: input.url ? input.url : null, uploaded_at: now };
    this.db.upsertUpload(row);
    return toUpload(row);
  }

  clearUpload(jobId: string, platform: Upload["platform"]) {
    this.db.deleteUpload(jobId, platform);
  }

  published(): { items: { job: Job; uploads: Upload[] }[] } {
    const rows = this.db.publishedJobs();
    const uploads = new Map<string, Upload[]>();
    for (const row of this.db.listUploads(rows.map((row) => row.id))) {
      const upload = toUpload(row);
      uploads.set(upload.jobId, [...(uploads.get(upload.jobId) ?? []), upload]);
    }
    return { items: rows.map((row) => ({ job: toJob(row), uploads: uploads.get(row.id) ?? [] })) };
  }
}
