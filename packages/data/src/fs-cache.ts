import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CacheEntry, CacheKind, CacheStore } from "./types.js";

type Index = Record<string, CacheEntry>;

const TOUCH_FLUSH_MS = 5_000;

export function createFsCache(dataDir: string): CacheStore {
  const root = path.join(dataDir, "cache");
  const indexPath = path.join(root, "index.json");
  mkdirSync(root, { recursive: true });

  let index: Index = {};
  if (existsSync(indexPath)) {
    try {
      index = JSON.parse(readFileSync(indexPath, "utf8")) as Index;
    } catch {
      index = {};
    }
  }

  let flushTimer: NodeJS.Timeout | null = null;
  const saveNow = () => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    const tmp = `${indexPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(index));
    renameSync(tmp, indexPath);
  };
  const saveSoon = () => {
    flushTimer ??= setTimeout(saveNow, TOUCH_FLUSH_MS);
    flushTimer.unref?.();
  };
  process.once("exit", () => flushTimer && saveNow());

  const filePath = (key: string, kind: CacheKind) => {
    const hash = createHash("sha1").update(key).digest("hex");
    const dir = path.join(root, kind);
    mkdirSync(dir, { recursive: true });
    return path.join(dir, hash);
  };

  const store: CacheStore = {
    async get(key) {
      return index[key] ?? null;
    },
    async put(entry) {
      const now = new Date().toISOString();
      const full: CacheEntry = { ...entry, createdAt: entry.createdAt ?? now, lastUsed: now };
      index[entry.key] = full;
      saveNow();
      return full;
    },
    async touch(key) {
      const entry = index[key];
      if (!entry) return;
      entry.lastUsed = new Date().toISOString();
      saveSoon();
    },
    async pin(key) {
      const entry = index[key];
      if (!entry || entry.pinned) return;
      entry.pinned = true;
      saveSoon();
    },
    async remove(key) {
      const entry = index[key];
      if (!entry) return;
      try {
        if (existsSync(entry.path)) rmSync(entry.path);
      } catch {
        /* already gone */
      }
      delete index[key];
      saveNow();
    },
    async list(filter) {
      return Object.values(index).filter((e) => !filter?.kind || e.kind === filter.kind);
    },
    async totalBytes() {
      return Object.values(index).reduce((s, e) => s + (e.size || 0), 0);
    },
    async readFile(key) {
      const entry = index[key];
      if (!entry) return null;
      if (!existsSync(entry.path)) {
        delete index[key];
        saveSoon();
        return null;
      }
      await store.touch(key);
      return readFileSync(entry.path);
    },
    async writeFile(key, kind, source, data, pinned = false, meta) {
      const dest = filePath(key, kind);
      writeFileSync(dest, data);
      return store.put({ key, kind, source, path: dest, size: data.length, pinned, meta });
    },
  };
  return store;
}

/** A view of the cache that pins everything read or written through it, for explicit downloads. */
export function pinningCache(cache: CacheStore): CacheStore {
  return {
    ...cache,
    async readFile(key) {
      const hit = await cache.readFile(key);
      if (hit) await cache.pin(key);
      return hit;
    },
    writeFile: (key, kind, source, data, _pinned, meta) => cache.writeFile(key, kind, source, data, true, meta),
  };
}

/** Evict least-recently-used unpinned entries until under maxBytes. */
export async function evictLru(cache: CacheStore, maxBytes: number): Promise<number> {
  let total = await cache.totalBytes();
  if (total <= maxBytes) return 0;
  const entries = (await cache.list()).filter((e) => !e.pinned).sort((a, b) => a.lastUsed.localeCompare(b.lastUsed));
  let removed = 0;
  for (const e of entries) {
    if (total <= maxBytes) break;
    await cache.remove(e.key);
    total -= e.size;
    removed++;
  }
  return removed;
}

export function ensureDataDirs(dataDir: string) {
  for (const sub of ["cache", "uploads", "qul", "out", "ambience"]) {
    mkdirSync(path.join(dataDir, sub), { recursive: true });
  }
}
