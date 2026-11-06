import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import express from "express";
import { parseBuffer } from "music-metadata";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { FPS, type Ayah, type ClipProps } from "../video/types";

const PORT = Number(process.env.PORT ?? 3737);
const OUT_DIR = path.resolve("out");
const API = "https://api.alquran.cloud/v1";
const PADDING_SECONDS = 0.7;
const TAFSIR_WORDS_PER_SECOND = 3;

const RECITERS = [
  { id: "Alafasy_128kbps", name: "Mishary Alafasy" },
  { id: "Husary_128kbps", name: "Mahmoud Khalil Al-Husary" },
  { id: "Minshawy_Murattal_128kbps", name: "Mohamed Siddiq Al-Minshawi" },
  { id: "Abdul_Basit_Murattal_192kbps", name: "Abdul Basit (Murattal)" },
  { id: "Maher_AlMuaiqly_64kbps", name: "Maher Al-Muaiqly" },
  { id: "Ghamadi_40kbps", name: "Saad Al-Ghamdi" },
];

const TAFSIRS = [
  { id: "ar.muyassar", name: "التفسير الميسر" },
  { id: "ar.jalalayn", name: "تفسير الجلالين" },
  { id: "ar.qurtubi", name: "تفسير القرطبي" },
  { id: "ar.baghawi", name: "تفسير البغوي" },
  { id: "ar.waseet", name: "التفسير الوسيط" },
  { id: "ar.miqbas", name: "تنوير المقباس" },
];

type Surah = { number: number; name: string; englishName: string; numberOfAyahs: number };
type ClipParams = { surah: number; from: number; to: number; reciter: string; tafsir?: string };
type Job = { status: "rendering" | "done" | "error"; progress: number; url?: string; error?: string };

class BadRequest extends Error {}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

let surahsPromise: Promise<Surah[]> | undefined;
function getSurahs(): Promise<Surah[]> {
  surahsPromise ??= fetchJson<{ data: Surah[] }>(`${API}/surah`)
    .then((j) => j.data.map(({ number, name, englishName, numberOfAyahs }) => ({ number, name, englishName, numberOfAyahs })))
    .catch((e) => {
      surahsPromise = undefined;
      throw e;
    });
  return surahsPromise;
}

async function parseParams(q: Record<string, unknown>): Promise<ClipParams> {
  const surah = Number(q.surah);
  const from = Number(q.from);
  const to = Number(q.to ?? q.from);
  const reciter = String(q.reciter ?? RECITERS[0].id);
  const tafsir = q.tafsir ? String(q.tafsir) : undefined;
  const meta = (await getSurahs()).find((s) => s.number === surah);
  if (!meta) throw new BadRequest("invalid surah");
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > meta.numberOfAyahs)
    throw new BadRequest(`ayah range must be within 1-${meta.numberOfAyahs}`);
  if (!RECITERS.some((r) => r.id === reciter)) throw new BadRequest("invalid reciter");
  if (tafsir && !TAFSIRS.some((t) => t.id === tafsir)) throw new BadRequest("invalid tafsir");
  return { surah, from, to, reciter, tafsir };
}

const pad3 = (n: number) => String(n).padStart(3, "0");

async function audioDuration(url: string): Promise<number> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`audio ${url} failed: ${res.status}`);
  const meta = await parseBuffer(new Uint8Array(await res.arrayBuffer()), { mimeType: "audio/mpeg" }, { duration: true });
  return meta.format.duration ?? 0;
}

type EditionAyah = { numberInSurah: number; text: string };
type Edition = { name: string; edition: { identifier: string }; ayahs: EditionAyah[] };

async function getClip(p: ClipParams): Promise<ClipProps> {
  const editions = ["quran-uthmani", p.tafsir].filter(Boolean).join(",");
  const { data } = await fetchJson<{ data: Edition[] }>(`${API}/surah/${p.surah}/editions/${editions}`);
  const [quran, tafsir] = data;
  const ayat = await Promise.all(
    quran.ayahs
      .filter((a) => a.numberInSurah >= p.from && a.numberInSurah <= p.to)
      .map(async (a): Promise<Ayah> => {
        const audioUrl = `https://everyayah.com/data/${p.reciter}/${pad3(p.surah)}${pad3(a.numberInSurah)}.mp3`;
        const tafsirText = tafsir?.ayahs.find((t) => t.numberInSurah === a.numberInSurah)?.text;
        const audioSeconds = await audioDuration(audioUrl);
        const readingSeconds = tafsirText ? tafsirText.split(/\s+/).length / TAFSIR_WORDS_PER_SECOND : 0;
        const durationInSeconds = Math.max(audioSeconds, readingSeconds) + PADDING_SECONDS;
        return {
          number: a.numberInSurah,
          text: a.text,
          tafsir: tafsirText,
          audioUrl,
          durationInSeconds,
          durationInFrames: Math.ceil(durationInSeconds * FPS),
        };
      }),
  );
  return { surahName: quran.name, tafsirName: TAFSIRS.find((t) => t.id === p.tafsir)?.name, ayat };
}

const jobs = new Map<string, Job>();

mkdirSync(OUT_DIR, { recursive: true });
const serveUrlPromise = ensureBrowser().then(() =>
  bundle({ entryPoint: path.resolve("src/video/index.tsx") }),
);
serveUrlPromise.then(() => console.log("Remotion bundle ready"), (e) => console.error("Bundle failed", e));

async function render(id: string, props: ClipProps) {
  const job = jobs.get(id)!;
  const serveUrl = await serveUrlPromise;
  const composition = await selectComposition({ serveUrl, id: "Clip", inputProps: props });
  await renderMedia({
    serveUrl,
    composition,
    inputProps: props,
    codec: "h264",
    outputLocation: path.join(OUT_DIR, `${id}.mp4`),
    onProgress: ({ progress }) => {
      job.progress = progress;
    },
  });
  Object.assign(job, { status: "done", progress: 1, url: `/out/${id}.mp4` });
}

const app = express();
app.use(express.json());

const handle =
  (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response) =>
    fn(req, res).catch((e: Error) => {
      if (!(e instanceof BadRequest)) console.error(req.method, req.url, e);
      res.status(e instanceof BadRequest ? 400 : 502).json({ error: e.message });
    });

app.get("/api/surahs", handle(async (_req, res) => res.json(await getSurahs())));
app.get("/api/reciters", (_req, res) => res.json(RECITERS));
app.get("/api/tafsirs", (_req, res) => res.json(TAFSIRS));
app.get("/api/clip", handle(async (req, res) => res.json(await getClip(await parseParams(req.query)))));

app.post(
  "/api/render",
  handle(async (req, res) => {
    const params = await parseParams(req.body ?? {});
    const id = randomUUID();
    jobs.set(id, { status: "rendering", progress: 0 });
    getClip(params)
      .then((props) => render(id, props))
      .catch((e: Error) => {
        console.error("render", id, e);
        Object.assign(jobs.get(id)!, { status: "error", error: e.message });
      });
    res.json({ id });
  }),
);

app.get("/api/render/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return void res.status(404).json({ error: "not found" });
  res.json(job);
});

app.use("/out", express.static(OUT_DIR));
app.use(express.static(path.resolve("dist/web")));

app.listen(PORT, () => console.log(`AutoAyah on http://localhost:${PORT}`));
