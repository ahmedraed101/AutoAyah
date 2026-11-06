import { useEffect, useMemo, useRef, useState } from "react";
import { Player } from "@remotion/player";
import { useTranslation } from "react-i18next";
import { ASPECT_RATIOS, AMBIENCE_PRESETS, canUseMode, projectName, type Job, type VideoConfig, type VideoMode } from "@autoayah/core";
import { AutoAyahComposition } from "@autoayah/templates";
import { api, type MediaResult, type PreviewResult } from "../api";
import { browserStore } from "../browserStore";
import { useEditor, type Panel } from "../store";

type Surah = { number: number; name: string; englishName: string; numberOfAyahs: number };
type Option = { id: string; name: string; language?: string; hasWordTimings?: boolean };

const TABS: Panel[] = ["content", "mode", "timing", "style", "background", "audio"];
const MODES: VideoMode[] = ["ayah", "ayahTafsir", "mushafPage", "wordHighlight"];
const MAX_PREVIEW_HEIGHT = 720;
/** Room kept below the player for the project name, actions and render progress. */
const PREVIEW_CHROME = 150;

/** Fields that change what the preview shows (export format does not). */
const previewKey = (c: VideoConfig) => JSON.stringify({ ...c, export: undefined, pngFrame: undefined });

export function Editor() {
  const { t } = useTranslation();
  const { config, configError, setConfig, setNested, panel, setPanel, appConfig, selectedAyah, setSelectedAyah, setProject, projectId } =
    useEditor();

  const [surahs, setSurahs] = useState<Surah[]>([]);
  const [reciters, setReciters] = useState<Option[]>([]);
  const [tafsirs, setTafsirs] = useState<Option[]>([]);
  const [translations, setTranslations] = useState<Option[]>([]);
  const [preview, setPreview] = useState<PreviewResult>();
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState<string>();
  const [job, setJob] = useState<Job>();
  const [status, setStatus] = useState<string>();
  const [media, setMedia] = useState<MediaResult[]>([]);
  const [mediaKind, setMediaKind] = useState<"image" | "video">("image");
  const [mediaQuery, setMediaQuery] = useState("nature landscape");
  const [mediaNote, setMediaNote] = useState<string>();
  const [searching, setSearching] = useState(false);
  const events = useRef<EventSource | null>(null);
  const stage = useRef<HTMLElement>(null);
  const [stageSize, setStageSize] = useState({ width: 400, height: 700 });

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const fail = (e: Error) => setError(e.message);
    void api.surahs().then(setSurahs).catch(fail);
    void api.reciters().then(setReciters).catch(fail);
    void api.tafsirs().then(setTafsirs).catch(fail);
    void api.translations().then(setTranslations).catch(fail);
    return () => events.current?.close();
  }, []);

  const key = previewKey(config);
  useEffect(() => {
    const ac = new AbortController();
    const timer = setTimeout(() => {
      setLoadingPreview(true);
      api
        .preview(config, ac.signal)
        .then((p) => {
          setPreview(p);
          setError(undefined);
        })
        .catch((e: Error) => {
          if (e.name !== "AbortError") setError(e.message);
        })
        .finally(() => setLoadingPreview(false));
    }, 400);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const name = projectName(config);
  const maxAyah = surahs.find((s) => s.number === config.surah)?.numberOfAyahs ?? 286;
  const caps = appConfig?.capabilities ?? { wordTimings: false, mushafLayout: false, fullTafsirCatalog: false, translations: false };

  const aspect = ASPECT_RATIOS[config.aspectRatio];
  const playerStyle = useMemo(() => {
    const maxH = Math.max(200, Math.min(MAX_PREVIEW_HEIGHT, stageSize.height - PREVIEW_CHROME));
    const scale = Math.min(maxH / aspect.height, (stageSize.width - 16) / aspect.width);
    return { width: Math.round(aspect.width * scale), height: Math.round(aspect.height * scale) };
  }, [aspect, stageSize]);

  const follow = (j: Job) => {
    setJob(j);
    events.current?.close();
    if (["done", "failed", "cancelled"].includes(j.status)) return;
    const es = new EventSource(`/api/jobs/${j.id}/events`, { withCredentials: true });
    events.current = es;
    es.onmessage = (ev) => {
      const next = JSON.parse(ev.data) as Job;
      setJob(next);
      if (next.status === "failed") setError(next.error ?? "Render failed");
      if (["done", "failed", "cancelled"].includes(next.status)) es.close();
    };
  };

  const generate = async () => {
    setError(undefined);
    follow(await api.createJob(config));
  };

  const saveProject = async () => {
    const p =
      appConfig?.storageMode === "browser"
        ? await browserStore.saveProject({ id: projectId, config })
        : await api.saveProject({ id: projectId, config });
    setProject(p.name, p.id);
    setStatus(t("saved"));
    setTimeout(() => setStatus(undefined), 2000);
  };

  const browserKeys = async () => (appConfig?.storageMode === "browser" ? await browserStore.getKeys() : undefined);

  const searchBg = async () => {
    setSearching(true);
    try {
      const res = await api.searchMedia({ query: mediaQuery, kind: mediaKind, keys: await browserKeys() });
      setMedia(res.results);
      setMediaNote(res.unchecked ? t("uncheckedResults", { n: res.unchecked }) : undefined);
    } finally {
      setSearching(false);
    }
  };

  const applyMedia = (m: MediaResult) => {
    setNested("backgrounds", [
      {
        type: m.type,
        fromAyah: config.from,
        toAyah: config.to,
        media: {
          provider: m.provider,
          id: m.id,
          url: m.url,
          previewUrl: m.previewUrl,
          attribution: m.attribution,
          photographer: m.photographer,
          photographerUrl: m.photographerUrl,
          downloadLocation: m.downloadLocation,
          duration: m.duration,
        },
      },
    ]);
    if (m.provider === "unsplash" && m.downloadLocation) {
      void browserKeys().then((k) => api.trackUnsplash(m.downloadLocation!, k?.unsplash).catch(() => undefined));
    }
  };

  const onUpload = async (file: File) => applyMedia(await api.uploadMedia(file));

  const progress = Math.round((job?.progress ?? 0) * 100);
  const rendering = job && (job.status === "queued" || job.status === "rendering");
  const selectedBg = config.backgrounds[0];

  return (
    <div className="editor">
      <aside className="panel">
        <div className="tabs">
          {TABS.map((tab) => (
            <button key={tab} type="button" className={panel === tab ? "active" : ""} onClick={() => setPanel(tab)}>
              {t(tab)}
            </button>
          ))}
        </div>

        {panel === "content" && (
          <div className="fields">
            <label>
              {t("aspect")}
              <select value={config.aspectRatio} onChange={(e) => setConfig({ aspectRatio: e.target.value as VideoConfig["aspectRatio"] })}>
                {Object.entries(ASPECT_RATIOS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {k} — {v.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("surah")}
              <select value={config.surah} onChange={(e) => setConfig({ surah: Number(e.target.value), from: 1, to: 1 })}>
                {surahs.map((s) => (
                  <option key={s.number} value={s.number}>
                    {s.number}. {s.englishName} — {s.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="row">
              <label>
                {t("from")}
                <input
                  type="number"
                  min={1}
                  max={maxAyah}
                  value={config.from}
                  onChange={(e) => e.target.value && setConfig({ from: Math.min(maxAyah, Number(e.target.value)) })}
                />
              </label>
              <label>
                {t("to")}
                <input
                  type="number"
                  min={config.from}
                  max={maxAyah}
                  value={config.to}
                  onChange={(e) => e.target.value && setConfig({ to: Math.min(maxAyah, Number(e.target.value)) })}
                />
              </label>
            </div>
            <label>
              {t("reciter")}
              <select value={config.reciter} onChange={(e) => setConfig({ reciter: e.target.value })}>
                {reciters.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("tafsir")}
              <select value={config.tafsir ?? ""} onChange={(e) => setConfig({ tafsir: e.target.value || null })}>
                <option value="">{t("none")}</option>
                {tafsirs.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("translation")}
              <select value={config.translation ?? ""} onChange={(e) => setConfig({ translation: e.target.value || null })}>
                <option value="">{t("none")}</option>
                {translations.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {panel === "mode" && (
          <div className="fields">
            {MODES.map((m) => {
              const ok = canUseMode(m, caps);
              return (
                <label key={m} className="choice">
                  <span>
                    <input type="radio" name="mode" disabled={!ok} checked={config.mode === m} onChange={() => setConfig({ mode: m })} /> {t(m)}
                  </span>
                  {!ok ? <span className="muted">{t("connectQul")}</span> : null}
                </label>
              );
            })}
          </div>
        )}

        {panel === "timing" && (
          <div className="fields">
            <label>
              {t("timing")}
              <select
                value={config.timing.mode}
                onChange={(e) => setNested("timing", { ...config.timing, mode: e.target.value as "continuous" | "reading" })}
              >
                <option value="continuous">{t("continuous")}</option>
                <option value="reading">{t("reading")}</option>
              </select>
            </label>
            {config.timing.mode === "reading" ? (
              <label>
                {t("speed")}
                <select
                  value={config.timing.readingSpeed}
                  onChange={(e) => setNested("timing", { ...config.timing, readingSpeed: e.target.value as "fast" | "slow" | "verySlow" })}
                >
                  <option value="fast">{t("fast")}</option>
                  <option value="slow">{t("slow")}</option>
                  <option value="verySlow">{t("verySlow")}</option>
                </select>
              </label>
            ) : null}
            {selectedAyah != null ? (
              <label>
                {t("holdAyah", { n: selectedAyah })}
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={config.timing.ayahOverrides?.[String(selectedAyah)]?.holdSeconds ?? ""}
                  onChange={(e) => {
                    const v = e.target.value === "" ? undefined : Number(e.target.value);
                    const ayahOverrides = { ...config.timing.ayahOverrides };
                    if (v == null || Number.isNaN(v)) delete ayahOverrides[String(selectedAyah)];
                    else ayahOverrides[String(selectedAyah)] = { holdSeconds: v };
                    setNested("timing", { ...config.timing, ayahOverrides });
                  }}
                />
              </label>
            ) : (
              <p className="muted">{t("selectAyahHint")}</p>
            )}
          </div>
        )}

        {panel === "style" && (
          <div className="fields">
            <label>
              {t("theme")}
              <select value={config.style.theme} onChange={(e) => setNested("style", { ...config.style, theme: e.target.value as "dark" | "light" })}>
                <option value="light">{t("light")}</option>
                <option value="dark">{t("dark")}</option>
              </select>
            </label>
            <label className="choice">
              <span>
                <input
                  type="checkbox"
                  checked={config.style.tajweed}
                  onChange={(e) => setNested("style", { ...config.style, tajweed: e.target.checked })}
                />{" "}
                {t("tajweedColors")}
              </span>
            </label>
            <div className="row">
              <label>
                {t("primaryColor")}
                <input type="color" value={config.style.primaryColor} onChange={(e) => setNested("style", { ...config.style, primaryColor: e.target.value })} />
              </label>
              <label>
                {t("accentColor")}
                <input type="color" value={config.style.accentColor} onChange={(e) => setNested("style", { ...config.style, accentColor: e.target.value })} />
              </label>
              <label>
                {t("cardColor")}
                <input type="color" value={config.style.cardColor} onChange={(e) => setNested("style", { ...config.style, cardColor: e.target.value })} />
              </label>
            </div>
            <label>
              {t("fontSize")} ({config.style.fontSize})
              <input
                type="range"
                min={32}
                max={120}
                value={config.style.fontSize}
                onChange={(e) => setNested("style", { ...config.style, fontSize: Number(e.target.value) })}
              />
            </label>
            <label className="choice">
              <span>
                <input
                  type="checkbox"
                  checked={config.style.showWatermark}
                  onChange={(e) => setNested("style", { ...config.style, showWatermark: e.target.checked })}
                />{" "}
                {t("watermark")}
              </span>
            </label>
            {config.style.showWatermark ? (
              <label>
                {t("watermarkText")}
                <input
                  value={config.style.watermarkText}
                  maxLength={60}
                  onChange={(e) => setNested("style", { ...config.style, watermarkText: e.target.value })}
                />
              </label>
            ) : null}
            <label>
              {t("exportFormat")}
              <select value={config.export} onChange={(e) => setConfig({ export: e.target.value as VideoConfig["export"] })}>
                <option value="mp4">MP4</option>
                <option value="webm">WebM</option>
                <option value="png">PNG</option>
                <option value="srt">SRT</option>
                <option value="batch">Batch ZIP</option>
              </select>
            </label>
          </div>
        )}

        {panel === "background" && (
          <div className="fields">
            <div className="segmented">
              <button type="button" className={mediaKind === "image" ? "active" : ""} onClick={() => setMediaKind("image")}>
                {t("images")}
              </button>
              <button type="button" className={mediaKind === "video" ? "active" : ""} onClick={() => setMediaKind("video")}>
                {t("videos")}
              </button>
            </div>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                void searchBg().catch((err: Error) => setError(err.message));
              }}
            >
              <input value={mediaQuery} onChange={(e) => setMediaQuery(e.target.value)} placeholder={t("search")} />
              <button type="submit" disabled={searching}>
                {t("search")}
              </button>
            </form>
            <p className="muted">{t("peopleFiltered")}</p>
            {mediaNote ? <p className="warning">{mediaNote}</p> : null}
            <div className="media-grid">
              {media.map((m) => (
                <button
                  type="button"
                  key={`${m.provider}-${m.id}`}
                  className={`media-tile ${selectedBg?.media?.id === m.id ? "selected" : ""} ${m.checked === false ? "unchecked" : ""}`}
                  title={m.attribution}
                  onClick={() => applyMedia(m)}
                >
                  <img src={m.previewUrl ?? m.url} alt={m.attribution ?? ""} loading="lazy" />
                  {m.type === "video" ? <span className="badge">▶</span> : null}
                </button>
              ))}
            </div>
            {selectedBg?.media?.attribution ? <p className="muted">{selectedBg.media.attribution}</p> : null}
            <div className="row">
              <label className="button secondary">
                {t("upload")}
                <input
                  type="file"
                  accept="image/*,video/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void onUpload(f).catch((err: Error) => setError(err.message));
                  }}
                />
              </label>
              <button
                type="button"
                className="secondary"
                onClick={() => setNested("backgrounds", [])}
              >
                {t("solidColor")}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  setNested("backgrounds", [
                    { type: "gradient", fromAyah: config.from, toAyah: config.to, gradient: [config.style.cardColor, "#ffffff"] },
                  ])
                }
              >
                {t("gradient")}
              </button>
            </div>
          </div>
        )}

        {panel === "audio" && (
          <div className="fields">
            <label>
              {t("recitationVolume")}
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={config.audio.recitationVolume}
                onChange={(e) => setNested("audio", { ...config.audio, recitationVolume: Number(e.target.value) })}
              />
            </label>
            <label>
              {t("ambience")}
              <select value={config.audio.ambienceId ?? ""} onChange={(e) => setNested("audio", { ...config.audio, ambienceId: e.target.value || null })}>
                <option value="">{t("none")}</option>
                {AMBIENCE_PRESETS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {document.documentElement.lang === "ar" ? a.nameAr : a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("ambienceVolume")}
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                disabled={!config.audio.ambienceId}
                value={config.audio.ambienceVolume}
                onChange={(e) => setNested("audio", { ...config.audio, ambienceVolume: Number(e.target.value) })}
              />
            </label>
            <label className="choice">
              <span>
                <input
                  type="checkbox"
                  checked={config.audio.backgroundVideoSound}
                  onChange={(e) => setNested("audio", { ...config.audio, backgroundVideoSound: e.target.checked })}
                />{" "}
                {t("bgSound")}
              </span>
            </label>
            <label>
              {t("bgVolume")}
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                disabled={!config.audio.backgroundVideoSound}
                value={config.audio.backgroundVideoVolume}
                onChange={(e) => setNested("audio", { ...config.audio, backgroundVideoVolume: Number(e.target.value) })}
              />
            </label>
          </div>
        )}
      </aside>

      <main className="preview" ref={stage}>
        {/* Remotion AbsoluteFill breaks under document dir=rtl — keep player LTR-isolated */}
        <div className="preview-stage" dir="ltr">
          {configError ? <p className="error">{configError}</p> : null}
          {error ? <p className="error">{error}</p> : null}
          {preview?.warnings?.length ? <p className="warning">{preview.warnings.join(" · ")}</p> : null}
          {preview ? (
            <div className={loadingPreview ? "player loading" : "player"}>
              <Player
                component={AutoAyahComposition}
                inputProps={{
                  timeline: preview.timeline,
                  config: preview.config,
                  surahName: preview.surahName,
                  tafsirName: preview.tafsirName,
                  translationName: preview.translationName,
                  basmala: preview.basmala,
                  mushafPages: preview.mushafPages,
                }}
                durationInFrames={Math.max(1, preview.timeline.totalFrames)}
                fps={preview.timeline.fps}
                compositionWidth={preview.timeline.width}
                compositionHeight={preview.timeline.height}
                style={playerStyle}
                acknowledgeRemotionLicense
                controls
              />
            </div>
          ) : (
            <div className="player-placeholder" style={playerStyle}>
              <p className="muted">{t("loadingPreview")}</p>
            </div>
          )}
          <div className="row actions" dir="auto">
            <code className="project-name" title={name}>
              {name}
            </code>
            <button type="button" className="secondary" onClick={() => void saveProject().catch((e: Error) => setError(e.message))}>
              {t("saveProject")}
            </button>
            <button type="button" onClick={() => void generate().catch((e: Error) => setError(e.message))} disabled={!preview || Boolean(rendering)}>
              {t("generate")}
            </button>
            {status ? <span className="muted">{status}</span> : null}
          </div>
          {job && job.status !== "done" ? (
            <div className="job">
              <div className="progress">
                <span style={{ width: `${progress}%` }} />
              </div>
              <div className="row">
                <span className="muted">
                  {job.status === "queued" && job.queuePosition ? t("queued", { pos: job.queuePosition }) : `${t("rendering")} ${progress}%`}
                </span>
                {rendering ? (
                  <button type="button" className="secondary" onClick={() => void api.cancelJob(job.id).then(setJob)}>
                    {t("cancel")}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {job?.status === "done" && job.outputUrl ? (
            <div className="job">
              {/\.(mp4|webm)$/.test(job.outputUrl) ? <video src={job.outputUrl} controls width={300} /> : null}
              {job.outputUrl.endsWith(".png") ? <img src={job.outputUrl} alt="" width={300} /> : null}
              <p>
                <a href={job.outputUrl} download>
                  {t("download")}
                </a>
              </p>
            </div>
          ) : null}
        </div>
      </main>

      <footer className="timeline">
        <div className="track">
          <div className="track-label">{t("ayat")}</div>
          <div className="track-lane">
            {preview?.timeline.slides.map((s) => (
              <button
                type="button"
                key={s.ayah.number}
                className={`segment ${selectedAyah === s.ayah.number ? "selected" : ""}`}
                style={{ flex: s.durationInSeconds }}
                onClick={() => {
                  setSelectedAyah(s.ayah.number);
                  setPanel("timing");
                }}
              >
                {s.ayah.number} · {s.durationInSeconds.toFixed(1)}s
              </button>
            ))}
          </div>
        </div>
        <div className="track">
          <div className="track-label">{t("background")}</div>
          <div className="track-lane">
            {config.backgrounds.length ? (
              config.backgrounds.map((b, i) => (
                <div key={i} className="segment bg">
                  {b.type} {b.fromAyah}–{b.toAyah}
                </div>
              ))
            ) : (
              <div className="segment bg">{t("default")}</div>
            )}
          </div>
        </div>
        <div className="track">
          <div className="track-label">{t("audio")}</div>
          <div className="track-lane">
            <div className="segment audio">
              {t("reciter")} ×{config.audio.recitationVolume}
            </div>
            {config.audio.ambienceId ? (
              <div className="segment audio">
                {config.audio.ambienceId} ×{config.audio.ambienceVolume}
              </div>
            ) : null}
          </div>
        </div>
      </footer>
    </div>
  );
}
