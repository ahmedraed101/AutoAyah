import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Secret used by earlier versions when APP_SECRET was unset; kept only to migrate stored keys. */
export const LEGACY_DEFAULT_SECRET = "dev-secret-change-me-in-production-32b";

const optionalNumber = z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().positive().optional());

const EnvSchema = z.object({
  APP_MODE: z.enum(["self_hosted", "hosted"]).default("self_hosted"),
  APP_PASSWORD: z.string().optional().transform((v) => v || undefined),
  APP_SECRET: z.string().optional().transform((v) => v || undefined),
  PORT: z.coerce.number().default(3737),
  PUBLIC_URL: z.string().default("http://localhost:3737"),
  DATA_DIR: z.string().default("./data"),
  MAX_CONCURRENT_RENDERS: z.coerce.number().int().min(1).default(1),
  RENDER_LIMIT_PER_DAY: optionalNumber,
  MAX_VIDEO_SECONDS: optionalNumber,
  MAX_AYAT_PER_VIDEO: optionalNumber,
  VIDEO_RETENTION_HOURS: optionalNumber,
  CACHE_MAX_GB: optionalNumber,
  QF_CLIENT_ID: z.string().optional(),
  QF_CLIENT_SECRET: z.string().optional(),
  QF_ENV: z.enum(["prelive", "production"]).default("prelive"),
  STORAGE: z.enum(["local", "s3"]).default("local"),
});

export type Env = Omit<z.infer<typeof EnvSchema>, "APP_SECRET"> & {
  APP_SECRET: string;
  /** True when APP_SECRET came from the environment rather than the generated secret file. */
  secretFromEnv: boolean;
  dataDir: string;
  outDir: string;
  dbPath: string;
  storageMode: "db" | "browser";
  showDownloads: boolean;
};

/** Read (or create once) a random secret stored in the data dir. */
function persistedSecret(dataDir: string): string {
  const file = path.join(dataDir, ".secret");
  if (existsSync(file)) {
    const value = readFileSync(file, "utf8").trim();
    if (value) return value;
  }
  mkdirSync(dataDir, { recursive: true });
  const value = randomBytes(32).toString("base64url");
  writeFileSync(file, value, { mode: 0o600 });
  return value;
}

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.parse(raw);
  // Monorepo root: apps/server/src (or dist) -> ../../..
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const dataDir = path.isAbsolute(parsed.DATA_DIR)
    ? path.normalize(parsed.DATA_DIR)
    : path.resolve(root, parsed.DATA_DIR.replace(/^\.\//, ""));
  return {
    ...parsed,
    APP_SECRET: parsed.APP_SECRET ?? persistedSecret(dataDir),
    secretFromEnv: Boolean(parsed.APP_SECRET),
    dataDir,
    outDir: path.join(dataDir, "out"),
    dbPath: path.join(dataDir, "autoayah.db"),
    storageMode: parsed.APP_MODE === "hosted" ? "browser" : "db",
    showDownloads: parsed.APP_MODE === "self_hosted",
  };
}
