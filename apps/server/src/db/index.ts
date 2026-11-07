import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type JobRow = {
  id: string;
  parent_id: string | null;
  config_hash: string;
  config_json: string;
  status: string;
  progress: number;
  output_url: string | null;
  output_paths_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type ProjectRow = {
  id: string;
  name: string;
  config_json: string;
  created_at: string;
  updated_at: string;
};

export type SecretRow = { key: string; value_enc: string; updated_at: string };
export type VerdictRow = {
  id: string;
  provider: string;
  media_id: string;
  has_person: number;
  confidence: number;
  method: string;
  created_at: string;
};

export class Db {
  readonly raw: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.raw = new DatabaseSync(dbPath);
    this.raw.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        config_hash TEXT NOT NULL,
        config_json TEXT NOT NULL,
        status TEXT NOT NULL,
        progress REAL NOT NULL DEFAULT 0,
        output_url TEXT,
        output_paths_json TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        config_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS secrets (
        key TEXT PRIMARY KEY,
        value_enc TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS media_verdicts (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        media_id TEXT NOT NULL,
        has_person INTEGER NOT NULL,
        confidence REAL NOT NULL,
        method TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS media_library (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        item_json TEXT NOT NULL,
        preview_file TEXT,
        checked INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS media_cursors (
        key TEXT PRIMARY KEY,
        next_page INTEGER NOT NULL,
        done INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);
      CREATE INDEX IF NOT EXISTS jobs_hash_idx ON jobs(config_hash);
      CREATE INDEX IF NOT EXISTS jobs_created_idx ON jobs(created_at);
    `);
  }

  // Jobs
  insertJob(row: JobRow) {
    this.raw
      .prepare(
        `INSERT INTO jobs (id,parent_id,config_hash,config_json,status,progress,output_url,output_paths_json,error,created_at,updated_at,started_at,finished_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        row.id,
        row.parent_id,
        row.config_hash,
        row.config_json,
        row.status,
        row.progress,
        row.output_url,
        row.output_paths_json,
        row.error,
        row.created_at,
        row.updated_at,
        row.started_at,
        row.finished_at,
      );
  }

  getJob(id: string): JobRow | undefined {
    return this.raw.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
  }

  listJobs(limit = 1000): JobRow[] {
    return this.raw.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").all(limit) as JobRow[];
  }

  countJobsSince(isoTime: string): number {
    const row = this.raw.prepare("SELECT COUNT(*) AS n FROM jobs WHERE created_at >= ? AND parent_id IS NULL").get(isoTime) as { n: number };
    return row.n;
  }

  finishedBefore(isoTime: string): JobRow[] {
    return this.raw
      .prepare("SELECT * FROM jobs WHERE finished_at IS NOT NULL AND finished_at < ? AND status IN ('done','failed','cancelled')")
      .all(isoTime) as JobRow[];
  }

  jobsByStatus(status: string): JobRow[] {
    return this.raw.prepare("SELECT * FROM jobs WHERE status = ? ORDER BY created_at").all(status) as JobRow[];
  }

  jobsByHash(hash: string): JobRow[] {
    return this.raw.prepare("SELECT * FROM jobs WHERE config_hash = ?").all(hash) as JobRow[];
  }

  updateJob(id: string, patch: Partial<JobRow>) {
    const keys = Object.keys(patch) as (keyof JobRow)[];
    if (!keys.length) return;
    const sets = keys.map((k) => `${k} = ?`).join(", ");
    this.raw
      .prepare(`UPDATE jobs SET ${sets} WHERE id = ?`)
      .run(...keys.map((k) => patch[k] as string | number | null), id);
  }

  deleteJobs(ids: string[]) {
    const stmt = this.raw.prepare("DELETE FROM jobs WHERE id = ?");
    for (const id of ids) stmt.run(id);
  }

  deleteVerdictsByMethod(method: string) {
    this.raw.prepare("DELETE FROM media_verdicts WHERE method = ?").run(method);
  }

  // Projects
  listProjects(): ProjectRow[] {
    return this.raw.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as ProjectRow[];
  }

  getProject(id: string): ProjectRow | undefined {
    return this.raw.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  }

  upsertProject(row: ProjectRow) {
    this.raw
      .prepare(
        `INSERT INTO projects (id,name,config_json,created_at,updated_at) VALUES (?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, config_json=excluded.config_json, updated_at=excluded.updated_at`,
      )
      .run(row.id, row.name, row.config_json, row.created_at, row.updated_at);
  }

  deleteProject(id: string) {
    this.raw.prepare("DELETE FROM projects WHERE id = ?").run(id);
  }

  // Secrets
  getSecret(key: string): SecretRow | undefined {
    return this.raw.prepare("SELECT * FROM secrets WHERE key = ?").get(key) as SecretRow | undefined;
  }

  upsertSecret(row: SecretRow) {
    this.raw
      .prepare(
        `INSERT INTO secrets (key,value_enc,updated_at) VALUES (?,?,?)
         ON CONFLICT(key) DO UPDATE SET value_enc=excluded.value_enc, updated_at=excluded.updated_at`,
      )
      .run(row.key, row.value_enc, row.updated_at);
  }

  // Verdicts
  getVerdict(id: string): VerdictRow | undefined {
    return this.raw.prepare("SELECT * FROM media_verdicts WHERE id = ?").get(id) as VerdictRow | undefined;
  }

  insertVerdict(row: VerdictRow) {
    this.raw
      .prepare(
        `INSERT OR IGNORE INTO media_verdicts (id,provider,media_id,has_person,confidence,method,created_at) VALUES (?,?,?,?,?,?,?)`,
      )
      .run(row.id, row.provider, row.media_id, row.has_person, row.confidence, row.method, row.created_at);
  }

  // Background media library
  listLibraryMedia(kind: string): LibraryMediaRow[] {
    return this.raw.prepare("SELECT * FROM media_library WHERE kind = ? ORDER BY rowid").all(kind) as LibraryMediaRow[];
  }

  getLibraryMedia(id: string): LibraryMediaRow | undefined {
    return this.raw.prepare("SELECT * FROM media_library WHERE id = ?").get(id) as LibraryMediaRow | undefined;
  }

  hasLibraryMedia(id: string): boolean {
    return Boolean(this.raw.prepare("SELECT 1 FROM media_library WHERE id = ?").get(id));
  }

  insertLibraryMedia(row: LibraryMediaRow) {
    this.raw
      .prepare(`INSERT OR IGNORE INTO media_library (id,kind,item_json,preview_file,checked,created_at) VALUES (?,?,?,?,?,?)`)
      .run(row.id, row.kind, row.item_json, row.preview_file, row.checked, row.created_at);
  }

  markLibraryMediaChecked(id: string) {
    this.raw.prepare("UPDATE media_library SET checked = 1 WHERE id = ?").run(id);
  }

  deleteLibraryMedia(id: string) {
    this.raw.prepare("DELETE FROM media_library WHERE id = ?").run(id);
  }

  clearLibraryMedia() {
    this.raw.prepare("DELETE FROM media_library").run();
  }

  getCursor(key: string): CursorRow | undefined {
    return this.raw.prepare("SELECT * FROM media_cursors WHERE key = ?").get(key) as CursorRow | undefined;
  }

  setCursor(row: CursorRow) {
    this.raw
      .prepare(`INSERT INTO media_cursors (key,next_page,done) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET next_page=excluded.next_page, done=excluded.done`)
      .run(row.key, row.next_page, row.done);
  }
}

export type LibraryMediaRow = {
  id: string;
  kind: string;
  item_json: string;
  preview_file: string | null;
  checked: number;
  created_at: string;
};

export type CursorRow = { key: string; next_page: number; done: number };

export function openDb(dbPath: string) {
  return new Db(dbPath);
}
