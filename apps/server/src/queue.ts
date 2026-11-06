import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, rmSync } from "node:fs";
import { hashConfig, stableStringify, type Job, type JobStatus, type VideoConfig } from "@autoayah/core";
import type { Db, JobRow } from "./db/index.js";

function rowToJob(row: JobRow, queuePosition?: number): Job {
  return {
    id: row.id,
    parentId: row.parent_id,
    configHash: row.config_hash,
    config: JSON.parse(row.config_json) as VideoConfig,
    status: row.status as JobStatus,
    progress: row.progress,
    outputUrl: row.output_url,
    outputPaths: row.output_paths_json ? (JSON.parse(row.output_paths_json) as string[]) : undefined,
    error: row.error,
    queuePosition,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

const outputPaths = (row: JobRow): string[] => (row.output_paths_json ? (JSON.parse(row.output_paths_json) as string[]) : []);

export const isTerminal = (status: string) => status === "done" || status === "failed" || status === "cancelled";

export type RenderFn = (job: Job, onProgress: (p: number) => void, signal: AbortSignal) => Promise<{ url: string; paths: string[] }>;

export class RenderQueue {
  readonly events = new EventEmitter();
  private active = 0;
  private abortControllers = new Map<string, AbortController>();
  private lastProgressWrite = new Map<string, number>();

  constructor(
    private db: Db,
    private maxConcurrent: number,
    private renderFn: RenderFn,
  ) {
    this.events.setMaxListeners(0);
  }

  recover() {
    for (const row of this.db.jobsByStatus("rendering")) {
      this.db.updateJob(row.id, { status: "queued", updated_at: new Date().toISOString(), progress: 0 });
    }
    this.pump();
  }

  enqueue(config: VideoConfig, parentId?: string): Job {
    const configHash = hashConfig(config);
    const configJson = stableStringify(config);
    // Never render the same video twice: reuse an identical job that is waiting, running,
    // or finished with its files still on disk.
    const existing = this.db
      .jobsByHash(configHash)
      .find(
        (j) =>
          stableStringify(JSON.parse(j.config_json)) === configJson &&
          (j.status === "queued" ||
            j.status === "rendering" ||
            (j.status === "done" && j.output_url && outputPaths(j).every((p) => existsSync(p)))),
      );
    if (existing && !parentId) return this.get(existing.id)!;

    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.insertJob({
      id,
      parent_id: parentId ?? null,
      config_hash: configHash,
      config_json: JSON.stringify(config),
      status: "queued",
      progress: 0,
      output_url: null,
      output_paths_json: null,
      error: null,
      created_at: now,
      updated_at: now,
      started_at: null,
      finished_at: null,
    });
    this.pump();
    return this.get(id)!;
  }

  get(id: string): Job | null {
    const row = this.db.getJob(id);
    if (!row) return null;
    const pos = row.status === "queued" ? this.db.jobsByStatus("queued").findIndex((j) => j.id === id) : -1;
    return rowToJob(row, pos >= 0 ? pos + 1 : undefined);
  }

  list(limit = 50): Job[] {
    return this.db.listJobs(limit).map((r) => rowToJob(r));
  }

  countSince(isoTime: string): number {
    return this.db.countJobsSince(isoTime);
  }

  cancel(id: string): Job | null {
    const row = this.db.getJob(id);
    if (!row) return null;
    if (row.status === "queued" || row.status === "rendering") {
      const now = new Date().toISOString();
      this.db.updateJob(id, { status: "cancelled", updated_at: now, finished_at: now });
      this.abortControllers.get(id)?.abort();
      this.events.emit(id, this.get(id));
    }
    return this.get(id);
  }

  retry(id: string): Job | null {
    const row = this.db.getJob(id);
    if (!row) return null;
    if (row.status !== "failed" && row.status !== "cancelled") return this.get(id);
    const now = new Date().toISOString();
    this.db.updateJob(id, {
      status: "queued",
      progress: 0,
      error: null,
      updated_at: now,
      started_at: null,
      finished_at: null,
    });
    this.events.emit(id, this.get(id));
    this.pump();
    return this.get(id);
  }

  /** Delete a finished job and its files. */
  remove(id: string): boolean {
    const row = this.db.getJob(id);
    if (!row) return false;
    if (!isTerminal(row.status)) this.cancel(id);
    this.deleteFiles(row);
    this.db.deleteJobs([id]);
    return true;
  }

  private deleteFiles(row: JobRow) {
    // Output names come from the config, so a newer job for the same video may own the same file.
    const shared = new Set(
      this.db
        .jobsByHash(row.config_hash)
        .filter((j) => j.id !== row.id)
        .flatMap(outputPaths),
    );
    for (const p of outputPaths(row)) {
      if (shared.has(p)) continue;
      try {
        rmSync(p, { force: true });
      } catch {
        /* ignore */
      }
    }
  }

  private pump() {
    while (this.active < this.maxConcurrent) {
      const next = this.db.jobsByStatus("queued")[0];
      if (!next) break;
      this.active++;
      const now = new Date().toISOString();
      this.db.updateJob(next.id, { status: "rendering", started_at: now, updated_at: now });
      const job = this.get(next.id)!;
      this.events.emit(job.id, job);
      const ac = new AbortController();
      this.abortControllers.set(next.id, ac);
      void this.run(job, ac.signal).finally(() => {
        this.abortControllers.delete(next.id);
        this.lastProgressWrite.delete(next.id);
        this.active--;
        this.pump();
      });
    }
  }

  private async run(job: Job, signal: AbortSignal) {
    try {
      const result = await this.renderFn(
        job,
        (progress) => {
          // Throttle DB writes; Remotion reports progress on every frame.
          const now = Date.now();
          if (now - (this.lastProgressWrite.get(job.id) ?? 0) < 400 && progress < 1) return;
          this.lastProgressWrite.set(job.id, now);
          this.db.updateJob(job.id, { progress, updated_at: new Date().toISOString() });
          this.events.emit(job.id, this.get(job.id));
        },
        signal,
      );
      if (signal.aborted) {
        for (const p of result.paths) rmSync(p, { force: true });
        return;
      }
      const now = new Date().toISOString();
      this.db.updateJob(job.id, {
        status: "done",
        progress: 1,
        output_url: result.url,
        output_paths_json: JSON.stringify(result.paths),
        error: null,
        updated_at: now,
        finished_at: now,
      });
      this.events.emit(job.id, this.get(job.id));
    } catch (e) {
      if (signal.aborted) return;
      const now = new Date().toISOString();
      console.error(`[render] job ${job.id} failed:`, e);
      this.db.updateJob(job.id, {
        status: "failed",
        error: (e as Error).message,
        updated_at: now,
        finished_at: now,
      });
      this.events.emit(job.id, this.get(job.id));
    }
  }

  /** Remove finished jobs (and their files) older than `hours`. */
  cleanupOlderThan(hours: number) {
    const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();
    const old = this.db.finishedBefore(cutoff);
    // One at a time so the last old job sharing a file still deletes it.
    for (const row of old) {
      this.deleteFiles(row);
      this.db.deleteJobs([row.id]);
    }
    return old.length;
  }
}
