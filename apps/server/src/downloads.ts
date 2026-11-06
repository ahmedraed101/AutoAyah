import { randomUUID } from "node:crypto";
import { z } from "zod";
import { MUSHAF_PAGES, type Resolver } from "@autoayah/data";

export const DownloadRequestSchema = z
  .object({
    type: z.enum(["recitation", "mushaf", "tafsir", "translation"]),
    id: z.string().min(1).max(200).optional(),
    surahFrom: z.number().int().min(1).max(114),
    surahTo: z.number().int().min(1).max(114),
  })
  .refine((r) => r.surahTo >= r.surahFrom, { message: "surahTo must be ≥ surahFrom" })
  .refine((r) => r.type === "mushaf" || r.id, { message: "id is required" });

export type DownloadRequest = z.infer<typeof DownloadRequestSchema>;

export type DownloadTask = DownloadRequest & {
  taskId: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  done: number;
  total: number;
  failed: number;
  error?: string;
  createdAt: string;
};

const CONCURRENCY = 4;
const KEEP_FINISHED = 20;

/** Runs explicit "download for offline" requests one at a time, so they don't compete with each other or with renders. */
export class DownloadManager {
  private tasks: DownloadTask[] = [];
  private controllers = new Map<string, AbortController>();
  private running = false;

  constructor(private resolver: () => Resolver) {}

  list(): DownloadTask[] {
    return this.tasks;
  }

  start(req: DownloadRequest): DownloadTask {
    const same = this.tasks.find(
      (t) => (t.status === "queued" || t.status === "running") && t.type === req.type && t.id === req.id && t.surahFrom === req.surahFrom && t.surahTo === req.surahTo,
    );
    if (same) return same;
    const task: DownloadTask = { ...req, taskId: randomUUID(), status: "queued", done: 0, total: 0, failed: 0, createdAt: new Date().toISOString() };
    this.tasks.unshift(task);
    this.controllers.set(task.taskId, new AbortController());
    void this.pump();
    return task;
  }

  /** Cancels an active task, or forgets a finished one. */
  dismiss(taskId: string): boolean {
    const task = this.tasks.find((t) => t.taskId === taskId);
    if (!task) return false;
    if (task.status === "queued" || task.status === "running") {
      this.controllers.get(taskId)?.abort();
      if (task.status === "queued") {
        task.status = "cancelled";
        this.controllers.delete(taskId);
      }
    } else {
      this.tasks = this.tasks.filter((t) => t !== task);
    }
    return true;
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      for (let task = this.nextQueued(); task; task = this.nextQueued()) await this.run(task);
    } finally {
      this.running = false;
    }
    const finished = this.tasks.filter((t) => t.status !== "queued" && t.status !== "running");
    for (const t of finished.slice(KEEP_FINISHED)) this.tasks = this.tasks.filter((x) => x !== t);
  }

  private nextQueued() {
    return [...this.tasks].reverse().find((t) => t.status === "queued");
  }

  private async run(task: DownloadTask) {
    const signal = this.controllers.get(task.taskId)!.signal;
    task.status = "running";
    const r = this.resolver();
    let lastError: string | undefined;
    const attempt = async (fn: () => Promise<unknown>) => {
      if (signal.aborted) return;
      try {
        await fn();
      } catch (e) {
        task.failed++;
        lastError = (e as Error).message;
      }
      task.done++;
    };
    const surahNumbers = Array.from({ length: task.surahTo - task.surahFrom + 1 }, (_, i) => task.surahFrom + i);

    try {
      if (task.type === "recitation") {
        const counts = new Map((await r.getSurahs()).map((s) => [s.number, s.numberOfAyahs]));
        task.total = surahNumbers.reduce((n, s) => n + (counts.get(s) ?? 0), 0);
        for (const surah of surahNumbers) {
          if (signal.aborted) break;
          await r.prefetchSurahText(surah);
          await r.prefetchRecitationIndex(task.id!, surah).catch(() => undefined);
          const ayat = Array.from({ length: counts.get(surah) ?? 0 }, (_, i) => i + 1);
          await eachLimit(ayat, CONCURRENCY, (ayah) => attempt(() => r.getAudio(task.id!, surah, ayah)));
        }
      } else if (task.type === "mushaf") {
        const whole = task.surahFrom === 1 && task.surahTo === 114;
        let pages: number[];
        if (whole) pages = Array.from({ length: MUSHAF_PAGES }, (_, i) => i + 1);
        else {
          const found = new Set<number>();
          for (const surah of surahNumbers) for (const p of await r.mushafPagesOf(surah)) found.add(p);
          pages = [...found].sort((a, b) => a - b);
        }
        task.total = pages.length;
        await eachLimit(pages, CONCURRENCY, (page) => attempt(() => r.prefetchMushafPage(page)));
      } else {
        task.total = surahNumbers.length;
        await eachLimit(surahNumbers, CONCURRENCY, (surah) => attempt(() => r.prefetchEdition(task.type as "tafsir" | "translation", task.id!, surah)));
      }
      if (signal.aborted) task.status = "cancelled";
      else if (task.total > 0 && task.failed === task.total) {
        task.status = "failed";
        task.error = lastError;
      } else {
        task.status = "done";
        if (task.failed) task.error = lastError;
      }
    } catch (e) {
      task.status = signal.aborted ? "cancelled" : "failed";
      task.error = (e as Error).message;
    } finally {
      this.controllers.delete(task.taskId);
    }
  }
}

async function eachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
