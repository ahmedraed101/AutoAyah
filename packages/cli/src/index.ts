#!/usr/bin/env node
import { VideoConfigSchema } from "@autoayah/core";

const base = (process.env.AUTOAYAH_URL ?? "http://localhost:3737").replace(/\/$/, "");
const token = process.env.AUTOAYAH_TOKEN;

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
  return body;
}

function parseRef(ref: string) {
  const m = ref.match(/^(\d{1,3}):(\d{1,3})(?:-(\d{1,3}))?$/);
  if (!m) throw new Error(`Bad reference ${ref}`);
  return { surah: Number(m[1]), from: Number(m[2]), to: Number(m[3] ?? m[2]) };
}

async function doctor() {
  const health = await api("/api/health");
  const config = await api("/api/config");
  console.log("health", health);
  console.log("config", config);
  console.log("OK");
}

async function library(cmd: string) {
  if (cmd === "list") {
    console.log(JSON.stringify(await api("/api/library"), null, 2));
    return;
  }
  throw new Error("Usage: autoayah library list");
}

async function render(args: string[]) {
  const ref = args[0];
  if (!ref) throw new Error("Usage: autoayah render 25:7-10 [--mode ayahTafsir] [--aspect 9:16] [--reciter qdc-7]");
  const { surah, from, to } = parseRef(ref);
  const flags: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i]?.startsWith("--") && args[i + 1]) {
      flags[args[i]!.slice(2)] = args[++i]!;
    }
  }
  const parsed = VideoConfigSchema.safeParse({
    surah,
    from,
    to,
    reciter: flags.reciter ?? "qdc-7",
    mode: flags.mode ?? "ayah",
    aspectRatio: flags.aspect ?? "9:16",
    tafsir: flags.tafsir ?? null,
    translation: flags.translation ?? null,
    export: flags.export ?? "mp4",
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`).join("; "));
  }
  const config = parsed.data;
  const job = (await api("/api/jobs", { method: "POST", body: JSON.stringify(config) })) as {
    id: string;
    status: string;
    outputUrl?: string;
  };
  console.log("job", job.id, job.status);
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    const j = (await api(`/api/jobs/${job.id}`)) as { status: string; progress: number; outputUrl?: string; error?: string };
    process.stdout.write(`\r${j.status} ${Math.round(j.progress * 100)}%   `);
    if (j.status === "done") {
      console.log(`\n${base}${j.outputUrl}`);
      return;
    }
    if (j.status === "failed" || j.status === "cancelled") throw new Error(j.error ?? j.status);
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "doctor") return doctor();
  if (cmd === "library") return library(rest[0] ?? "list");
  if (cmd === "render") return render(rest);
  console.log(`AutoAyah CLI
  autoayah doctor
  autoayah library list
  autoayah render 25:7-10 [--mode ayahTafsir] [--aspect 9:16] [--reciter ID] [--tafsir ar.muyassar]
                         [--translation en.sahih] [--export mp4|webm|png|srt|batch]

AUTOAYAH_URL=${base}
AUTOAYAH_TOKEN  session token from POST /api/auth/login (when APP_PASSWORD is set)`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
