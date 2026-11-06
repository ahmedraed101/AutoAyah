import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Player } from "@remotion/player";
import { Clip } from "../video/Clip";
import { FPS, HEIGHT, WIDTH, totalFrames, type ClipProps } from "../video/types";

type Surah = { number: number; name: string; englishName: string; numberOfAyahs: number };
type Option = { id: string; name: string };
type Job = { status: "rendering" | "done" | "error"; progress: number; url?: string; error?: string };

const getJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body as T;
};

function App() {
  const [surahs, setSurahs] = useState<Surah[]>([]);
  const [reciters, setReciters] = useState<Option[]>([]);
  const [tafsirs, setTafsirs] = useState<Option[]>([]);
  const [surah, setSurah] = useState(25);
  const [from, setFrom] = useState(7);
  const [to, setTo] = useState(8);
  const [reciter, setReciter] = useState("Alafasy_128kbps");
  const [tafsir, setTafsir] = useState("ar.muyassar");
  const [clip, setClip] = useState<ClipProps>();
  const [error, setError] = useState<string>();
  const [job, setJob] = useState<Job>();

  useEffect(() => {
    getJson<Surah[]>("/api/surahs").then(setSurahs, (e) => setError(e.message));
    getJson<Option[]>("/api/reciters").then(setReciters);
    getJson<Option[]>("/api/tafsirs").then(setTafsirs);
  }, []);

  const query = new URLSearchParams({ surah: String(surah), from: String(from), to: String(to), reciter, tafsir });

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      setError(undefined);
      getJson<ClipProps>(`/api/clip?${query}`).then(
        (c) => !cancelled && setClip(c),
        (e) => !cancelled && setError(e.message),
      );
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query.toString()]);

  const generate = async () => {
    setJob({ status: "rendering", progress: 0 });
    try {
      const { id } = await getJson<{ id: string }>("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(query)),
      });
      const poll = async () => {
        const j = await getJson<Job>(`/api/render/${id}`);
        setJob(j);
        if (j.status === "rendering") setTimeout(poll, 1000);
      };
      poll();
    } catch (e) {
      setJob({ status: "error", progress: 0, error: (e as Error).message });
    }
  };

  const maxAyah = surahs.find((s) => s.number === surah)?.numberOfAyahs ?? 286;

  return (
    <div>
      <h1>AutoAyah</h1>
      <p>
        <label>
          Surah{" "}
          <select
            value={surah}
            onChange={(e) => {
              setSurah(Number(e.target.value));
              setFrom(1);
              setTo(1);
            }}
          >
            {surahs.map((s) => (
              <option key={s.number} value={s.number}>
                {s.number}. {s.englishName} {s.name}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          From <input type="number" min={1} max={maxAyah} value={from} onChange={(e) => setFrom(Number(e.target.value))} />
        </label>{" "}
        <label>
          To <input type="number" min={from} max={maxAyah} value={to} onChange={(e) => setTo(Number(e.target.value))} />
        </label>
      </p>
      <p>
        <label>
          Reciter{" "}
          <select value={reciter} onChange={(e) => setReciter(e.target.value)}>
            {reciters.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          Tafsir{" "}
          <select value={tafsir} onChange={(e) => setTafsir(e.target.value)}>
            <option value="">None</option>
            {tafsirs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </p>
      {error && <p>Error: {error}</p>}
      {clip && (
        <Player
          component={Clip}
          inputProps={clip}
          durationInFrames={totalFrames(clip)}
          fps={FPS}
          compositionWidth={WIDTH}
          compositionHeight={HEIGHT}
          style={{ width: 360, height: 640 }}
          controls
        />
      )}
      <p>
        <button onClick={generate} disabled={!clip || job?.status === "rendering"}>
          Generate
        </button>{" "}
        {job?.status === "rendering" && <span>Rendering… {Math.round(job.progress * 100)}%</span>}
        {job?.status === "error" && <span>Failed: {job.error}</span>}
      </p>
      {job?.url && (
        <div>
          <video src={job.url} controls width={360} />
          <p>
            <a href={job.url} download>
              Download MP4
            </a>
          </p>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
