import { createWriteStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import archiver from "archiver";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import multer from "multer";
import { ZodError, z } from "zod";
import { VideoConfigSchema, clipAyahCount, clipSegments, renderFileName, type Job, type VideoConfig } from "@autoayah/core";
import {
  createFsCache,
  createResolver,
  ensureDataDirs,
  entryMatches,
  evictLru,
  pinningCache,
  summarizeLibrary,
  testQfConnection,
} from "@autoayah/data";
import {
  BUNDLED_AMBIENCE,
  detectPeopleInImage,
  detectorStatus,
  ensureAmbienceFiles,
  searchMedia,
  trackUnsplashDownload,
  warmDetector,
  type SearchResult,
} from "@autoayah/media";
import { authMiddleware, authStatus, loginHandler } from "./auth.js";
import { openDb } from "./db/index.js";
import { DownloadManager, DownloadRequestSchema } from "./downloads.js";
import { LEGACY_DEFAULT_SECRET, loadEnv } from "./env.js";
import { mountMcp } from "./mcp.js";
import { openApiSpec } from "./openapi.js";
import { isTerminal, RenderQueue } from "./queue.js";
import { buildProps, renderJob } from "./render.js";
import { DbStore, type ApiKeys } from "./stores.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = loadEnv();
ensureDataDirs(env.dataDir);
mkdirSync(env.outDir, { recursive: true });

const db = openDb(env.dbPath);
const store = new DbStore(db, env.APP_SECRET);
if (!env.secretFromEnv) store.migrateSecret(LEGACY_DEFAULT_SECRET);
// Verdicts recorded while the detector was unavailable were never checked; drop them so they get re-checked.
db.deleteVerdictsByMethod("unchecked");
const cache = createFsCache(env.dataDir);

if (env.APP_MODE === "hosted" && !env.APP_PASSWORD) {
  console.warn("[autoayah] APP_MODE=hosted without APP_PASSWORD: anyone who can reach this server can render videos.");
}

const ambienceDir = path.join(env.dataDir, "ambience");
ensureAmbienceFiles(ambienceDir);
for (const legacy of ["rain", "wind", "ocean", "forest"].map((id) => path.join(ambienceDir, `${id}.mp3`))) {
  if (existsSync(legacy) && statSync(legacy).size === 0) rmSync(legacy);
}
warmDetector();

function qfCreds() {
  const keys = store.getKeys();
  const clientId = keys.qfClientId ?? env.QF_CLIENT_ID;
  const clientSecret = keys.qfClientSecret ?? env.QF_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, env: env.QF_ENV };
}

function resolver() {
  return createResolver({ cache, qf: qfCreds(), dataDir: env.dataDir });
}

const downloads = new DownloadManager(() => createResolver({ cache: pinningCache(cache), qf: qfCreds(), dataDir: env.dataDir }));

const LibraryTargetSchema = z.object({
  type: z.enum(["recitation", "mushaf", "tafsir", "translation", "text", "imports", "app"]),
  id: z.string().min(1).max(300),
  surah: z.number().int().min(1).max(114).optional(),
});

const limits = { maxSeconds: env.MAX_VIDEO_SECONDS };
const assetBaseUrl = `http://127.0.0.1:${env.PORT}`;

const templatesEntry = path.resolve(__dirname, "../../../packages/templates/src/remotion/index.tsx");

function checkRange(config: VideoConfig) {
  if (env.MAX_AYAT_PER_VIDEO && clipAyahCount(config) > env.MAX_AYAT_PER_VIDEO) {
    throw new Error(`This server allows at most ${env.MAX_AYAT_PER_VIDEO} ayat per video`);
  }
}

async function preview(config: VideoConfig, draft = false) {
  checkRange(config);
  return buildProps(config, resolver(), limits, draft);
}

function createJob(config: VideoConfig): Job {
  checkRange(config);
  if (env.RENDER_LIMIT_PER_DAY) {
    const dayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
    if (queue.countSince(dayStart) >= env.RENDER_LIMIT_PER_DAY) throw new Error("Daily render limit reached");
  }
  return queue.enqueue(config);
}

const queue = new RenderQueue(db, env.MAX_CONCURRENT_RENDERS, async (job, onProgress, signal) => {
  const common = { resolver: resolver(), outDir: env.outDir, entryPoint: templatesEntry, assetBaseUrl, limits, signal };
  if (job.config.export !== "batch") return renderJob(job, { ...common, onProgress });

  const ayat = clipSegments(job.config).flatMap((s) => Array.from({ length: s.to - s.from + 1 }, (_, i) => [s.surah, s.from + i] as const));
  // Per-ayah videos go to a private folder so they never clash with (or delete) standalone renders of the same ayah.
  const workDir = path.join(env.outDir, `.batch-${job.id}`);
  try {
    const paths: string[] = [];
    for (const [i, [surah, a]] of ayat.entries()) {
      if (signal.aborted) throw new Error("cancelled");
      const childConfig: VideoConfig = { ...job.config, surah, from: a, toSurah: null, to: a, range: null, export: "mp4" };
      const result = await renderJob(
        { ...job, id: `${job.id}-${surah}-${a}`, config: childConfig },
        { ...common, outDir: workDir, onProgress: (p) => onProgress((i + p) / ayat.length) },
      );
      paths.push(...result.paths);
    }
    const zipName = renderFileName(job.config);
    const zipPath = path.join(env.outDir, zipName);
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 1 } });
      output.on("close", () => resolve());
      output.on("error", reject);
      archive.on("error", reject);
      archive.pipe(output);
      for (const p of paths) archive.file(p, { name: path.basename(p) });
      void archive.finalize();
    });
    return { url: `/out/${zipName}`, paths: [zipPath] };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

queue.recover();

if (env.VIDEO_RETENTION_HOURS) {
  const hours = env.VIDEO_RETENTION_HOURS;
  queue.cleanupOlderThan(hours);
  setInterval(() => queue.cleanupOlderThan(hours), 3600_000).unref();
}
if (env.CACHE_MAX_GB) {
  const maxBytes = env.CACHE_MAX_GB * 1024 ** 3;
  setInterval(() => void evictLru(cache, maxBytes), 600_000).unref();
}

const app = express();
app.set("trust proxy", "loopback");
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(authMiddleware(env));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^(image|video)\//.test(file.mimetype)),
});

function errorMessage(e: unknown): string {
  if (e instanceof ZodError) return e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
  return (e as Error).message ?? String(e);
}

const handle =
  (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response) =>
    fn(req, res).catch((e: unknown) => {
      console.error(req.method, req.url, e);
      if (!res.headersSent) res.status(400).json({ error: errorMessage(e) });
    });

const notFound = (res: express.Response) => void res.status(404).json({ error: "not found" });

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/auth/status", authStatus(env));
app.post("/api/auth/login", loginHandler(env));
app.get("/openapi.json", (_req, res) => res.json(openApiSpec(env.PUBLIC_URL)));

app.get(
  "/api/config",
  handle(async (_req, res) => {
    res.json({
      appMode: env.APP_MODE,
      storageMode: env.storageMode,
      showDownloads: env.showDownloads,
      hasPassword: Boolean(env.APP_PASSWORD),
      qfConnected: Boolean(qfCreds()),
      publicUrl: env.PUBLIC_URL,
      capabilities: await resolver().capabilities(),
      limits: {
        maxAyatPerVideo: env.MAX_AYAT_PER_VIDEO ?? null,
        maxVideoSeconds: env.MAX_VIDEO_SECONDS ?? null,
        renderLimitPerDay: env.RENDER_LIMIT_PER_DAY ?? null,
      },
      peopleDetector: detectorStatus(),
    });
  }),
);

app.get("/api/surahs", handle(async (_req, res) => res.json(await resolver().getSurahs())));
app.get("/api/reciters", handle(async (_req, res) => res.json(await resolver().getReciters())));
app.get("/api/divisions", handle(async (_req, res) => res.json(await resolver().getDivisions())));
app.get("/api/tafsirs", handle(async (_req, res) => res.json(await resolver().getTafsirs())));
app.get("/api/translations", handle(async (_req, res) => res.json(await resolver().getTranslations())));

app.post(
  "/api/preview",
  handle(async (req, res) => res.json(await preview(VideoConfigSchema.parse(req.body), req.query.draft === "1"))),
);

app.get("/api/jobs", (req, res) => res.json(queue.list(Math.min(500, Number(req.query.limit) || 50))));
app.post(
  "/api/jobs",
  handle(async (req, res) => {
    const config = VideoConfigSchema.parse(req.body);
    await preview(config); // fail fast on bad ranges / limits before queueing
    res.json(createJob(config));
  }),
);
app.get("/api/jobs/:id", (req, res) => {
  const job = queue.get(req.params.id);
  if (!job) return notFound(res);
  res.json(job);
});
app.delete("/api/jobs/:id", (req, res) => {
  if (!queue.remove(req.params.id)) return notFound(res);
  res.json({ ok: true });
});
app.post("/api/jobs/:id/cancel", (req, res) => {
  const job = queue.cancel(req.params.id);
  if (!job) return notFound(res);
  res.json(job);
});
app.post("/api/jobs/:id/retry", (req, res) => {
  const job = queue.retry(req.params.id);
  if (!job) return notFound(res);
  res.json(job);
});
app.get("/api/jobs/:id/events", (req, res) => {
  const id = req.params.id;
  const current = queue.get(id);
  if (!current) return notFound(res);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);
  const close = () => {
    clearInterval(heartbeat);
    queue.events.off(id, onUpdate);
    res.end();
  };
  const onUpdate = (job: Job | null) => {
    if (!job) return;
    res.write(`data: ${JSON.stringify(job)}\n\n`);
    if (isTerminal(job.status)) close();
  };
  queue.events.on(id, onUpdate);
  req.on("close", close);
  onUpdate(current);
});

// Projects (self-hosted DB)
const requireDbStorage = (res: express.Response) => {
  if (env.storageMode === "db") return true;
  res.status(400).json({ error: "Projects and keys are stored in the browser in hosted mode" });
  return false;
};
app.get("/api/projects", (_req, res) => {
  if (requireDbStorage(res)) res.json(store.listProjects());
});
app.post(
  "/api/projects",
  handle(async (req, res) => {
    if (!requireDbStorage(res)) return;
    const config = VideoConfigSchema.parse(req.body?.config ?? {});
    const id = typeof req.body?.id === "string" && req.body.id ? req.body.id : undefined;
    res.json(store.saveProject({ id, config }));
  }),
);
app.delete("/api/projects/:id", (req, res) => {
  if (!requireDbStorage(res)) return;
  store.deleteProject(req.params.id);
  res.json({ ok: true });
});

// API keys (self-hosted)
const KEY_NAMES = ["pexels", "unsplash", "pixabay", "freesound", "qfClientId", "qfClientSecret"] as const;
app.get("/api/keys", (_req, res) => {
  if (env.storageMode !== "db") return void res.json({ storage: "browser" });
  const keys = store.getKeys();
  res.json({ storage: "db", ...Object.fromEntries(KEY_NAMES.map((k) => [k, Boolean(keys[k])])) });
});
app.put(
  "/api/keys",
  handle(async (req, res) => {
    if (!requireDbStorage(res)) return;
    const next: ApiKeys = { ...store.getKeys() };
    for (const k of KEY_NAMES) {
      const v = req.body?.[k];
      if (typeof v === "string" && v.trim()) next[k] = v.trim();
      if (v === null) delete next[k];
    }
    store.setKeys(next);
    res.json({ ok: true });
  }),
);

app.post(
  "/api/qf/test",
  handle(async (req, res) => {
    const body = req.body as ApiKeys;
    const stored = store.getKeys();
    const creds = {
      clientId: body.qfClientId || stored.qfClientId || env.QF_CLIENT_ID || "",
      clientSecret: body.qfClientSecret || stored.qfClientSecret || env.QF_CLIENT_SECRET || "",
      env: env.QF_ENV,
    };
    if (!creds.clientId || !creds.clientSecret) throw new Error("QF credentials required");
    res.json(await testQfConnection(creds));
  }),
);

// Downloads / offline library
app.get(
  "/api/library",
  handle(async (_req, res) => {
    if (!env.showDownloads) return notFound(res);
    const r = resolver();
    const [entries, surahs, names] = await Promise.all([cache.list(), r.getSurahs().catch(() => []), r.libraryNames()]);
    const groups = summarizeLibrary(entries, new Map(surahs.map((s) => [s.number, s.numberOfAyahs])), names);
    res.json({ groups, totalBytes: await cache.totalBytes(), downloads: downloads.list() });
  }),
);
app.post(
  "/api/library/remove",
  handle(async (req, res) => {
    if (!env.showDownloads) return notFound(res);
    const target = LibraryTargetSchema.parse(req.body);
    const doomed = (await cache.list()).filter((e) => entryMatches(e, target));
    for (const e of doomed) await cache.remove(e.key);
    res.json({ removed: doomed.length });
  }),
);
app.post(
  "/api/library/downloads",
  handle(async (req, res) => {
    if (!env.showDownloads) return notFound(res);
    res.json(downloads.start(DownloadRequestSchema.parse(req.body)));
  }),
);
app.delete("/api/library/downloads/:id", (req, res) => {
  if (!env.showDownloads || !downloads.dismiss(req.params.id)) return notFound(res);
  res.json({ ok: true });
});
app.post(
  "/api/library/import",
  multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } }).single("file"),
  handle(async (req, res) => {
    if (!env.showDownloads) return notFound(res);
    if (!req.file) throw new Error("file required");
    res.json(await resolver().importQulFile(path.basename(req.file.originalname), req.file.buffer, "qul_import"));
  }),
);

// Recitation audio, served from the local cache (downloaded once from everyayah).
app.get(
  "/media/audio/:reciter/:file",
  handle(async (req, res) => {
    const reciter = String(req.params.reciter);
    const m = String(req.params.file).match(/^(\d{3})(\d{3})\.mp3$/);
    if (!/^[\w.-]+$/.test(reciter) || !m) return notFound(res);
    const { data } = await resolver().getAudio(reciter, Number(m[1]), Number(m[2]));
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    sendRanged(req, res, data);
  }),
);

/** Browsers can only seek inside media when the server honours Range requests. */
function sendRanged(req: express.Request, res: express.Response, data: Buffer) {
  res.setHeader("Accept-Ranges", "bytes");
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (!range || (!range[1] && !range[2])) return void res.send(data);
  const size = data.length;
  let start = range[1] ? Number(range[1]) : size - Number(range[2]);
  let end = range[1] && range[2] ? Number(range[2]) : size - 1;
  start = Math.max(0, start);
  end = Math.min(end, size - 1);
  if (start > end || start >= size) {
    res.setHeader("Content-Range", `bytes */${size}`);
    return void res.status(416).end();
  }
  res.status(206);
  res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  res.setHeader("Content-Length", String(end - start + 1));
  res.end(data.subarray(start, end + 1));
}

app.get(
  "/media/mushaf/:file",
  handle(async (req, res) => {
    const m = String(req.params.file).match(/^(\d{1,3})\.png$/);
    const page = Number(m?.[1]);
    if (!m || page < 1 || page > 604) return notFound(res);
    const { data } = await resolver().getMushafImage(page);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.send(data);
  }),
);

// Media search — people are filtered by tags, URL slugs and a COCO-SSD person detector.
const DETECT_CONCURRENCY = 4;

async function peopleFree(results: SearchResult[]): Promise<{ results: (SearchResult & { checked: boolean })[]; unchecked: number }> {
  const keep: ((SearchResult & { checked: boolean }) | null)[] = new Array(results.length).fill(null);
  let next = 0;
  let unchecked = 0;
  const worker = async () => {
    while (next < results.length) {
      const i = next++;
      const r = results[i]!;
      const verdictId = `${r.provider}:${r.type}:${r.id}`;
      const cached = db.getVerdict(verdictId);
      if (cached) {
        if (!cached.has_person) keep[i] = { ...r, checked: true };
        continue;
      }
      if (!r.previewUrl) {
        unchecked++;
        keep[i] = { ...r, checked: false };
        continue;
      }
      try {
        const img = await fetch(r.previewUrl, { signal: AbortSignal.timeout(15_000) });
        if (!img.ok) throw new Error(String(img.status));
        const verdict = await detectPeopleInImage(Buffer.from(await img.arrayBuffer()));
        if (verdict.method === "unchecked") {
          unchecked++;
          keep[i] = { ...r, checked: false };
          continue;
        }
        db.insertVerdict({
          id: verdictId,
          provider: r.provider,
          media_id: r.id,
          has_person: verdict.hasPerson ? 1 : 0,
          confidence: verdict.confidence,
          method: verdict.method,
          created_at: new Date().toISOString(),
        });
        if (!verdict.hasPerson) keep[i] = { ...r, checked: true };
      } catch {
        unchecked++;
        keep[i] = { ...r, checked: false };
      }
    }
  };
  await Promise.all(Array.from({ length: DETECT_CONCURRENCY }, worker));
  return { results: keep.filter((r): r is SearchResult & { checked: boolean } => r !== null), unchecked };
}

app.post(
  "/api/media/search",
  handle(async (req, res) => {
    const query = String(req.body?.query ?? "nature landscape").slice(0, 100);
    const kind = req.body?.kind === "video" ? "video" : "image";
    const page = Math.min(50, Math.max(1, Math.floor(Number(req.body?.page) || 1)));
    const bodyKeys = (req.body?.keys ?? {}) as ApiKeys;
    const stored = env.storageMode === "db" ? store.getKeys() : {};
    const keys = {
      pexels: bodyKeys.pexels || stored.pexels,
      unsplash: bodyKeys.unsplash || stored.unsplash,
      pixabay: bodyKeys.pixabay || stored.pixabay,
      freesound: bodyKeys.freesound || stored.freesound,
    };
    if (!keys.pexels && !keys.unsplash && !keys.pixabay) throw new Error("Add at least one stock media API key in Settings");
    const found = await searchMedia(keys, query, kind, page);
    const { results, unchecked } = await peopleFree(found.results);
    res.json({ results, unchecked, page, hasMore: found.hasMore && page < 50, detector: detectorStatus(), ambience: BUNDLED_AMBIENCE });
  }),
);

app.post(
  "/api/media/unsplash-download",
  handle(async (req, res) => {
    const loc = String(req.body?.downloadLocation ?? "");
    const key = String(req.body?.accessKey || store.getKeys().unsplash || "");
    if (!loc || !key) throw new Error("downloadLocation and accessKey required");
    await trackUnsplashDownload(loc, key);
    res.json({ ok: true });
  }),
);

app.post(
  "/api/media/upload",
  upload.single("file"),
  handle(async (req, res) => {
    if (!req.file) throw new Error("An image or video file is required");
    const isVideo = req.file.mimetype.startsWith("video/");
    if (!isVideo) {
      const verdict = await detectPeopleInImage(req.file.buffer);
      if (verdict.hasPerson) throw new Error("Upload rejected: people detected in this image");
    }
    const uploads = path.join(env.dataDir, "uploads");
    mkdirSync(uploads, { recursive: true });
    const name = `${Date.now()}-${path.basename(req.file.originalname).replace(/[^\w.-]+/g, "_")}`;
    writeFileSync(path.join(uploads, name), req.file.buffer);
    res.json({ provider: "upload", id: name, type: isVideo ? "video" : "image", url: `/uploads/${name}`, attribution: "User upload" });
  }),
);

mountMcp(app, {
  resolver,
  preview,
  createJob,
  getJob: (id) => queue.get(id),
  publicUrl: env.PUBLIC_URL,
});

app.use("/out", express.static(env.outDir));
app.use("/uploads", express.static(path.join(env.dataDir, "uploads")));
app.use("/ambience", express.static(ambienceDir, { maxAge: "7d" }));
const fontsDir = path.resolve(__dirname, "../../../packages/templates/public/fonts");
if (existsSync(fontsDir)) app.use("/fonts", express.static(fontsDir, { maxAge: "30d" }));

const webDist = path.resolve(__dirname, "../../web/dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api\/|\/out\/|\/mcp|\/openapi|\/uploads|\/ambience|\/fonts|\/media\/).*/, (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
}

app.use("/api", (_req, res) => notFound(res));

app.listen(env.PORT, () => {
  console.log(`AutoAyah on http://localhost:${env.PORT} (${env.APP_MODE}) data=${env.dataDir}`);
});
