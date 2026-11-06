import { useEffect, useMemo, useRef, useState } from "react";
import { Player } from "@remotion/player";
import { useTranslation } from "react-i18next";
import { ASPECT_RATIOS, AMBIENCE_PRESETS, canUseMode, projectName, type Job, type VideoConfig, type VideoMode } from "@autoayah/core";
import { AutoAyahComposition } from "@autoayah/templates";
import { api, type MediaResult, type PreviewResult } from "../api";
import { browserStore } from "../browserStore";
import { Field, Group, Segmented, Select, Slider, Stepper, Switch } from "../components/controls";
import { Icon, Rosette } from "../components/Icon";
import { useEditor, type Panel } from "../store";
import { localDigits, useSurahs } from "../surahs";

type Option = { id: string; name: string; language?: string; hasWordTimings?: boolean };

const TABS: Panel[] = ["content", "mode", "timing", "style", "background", "audio"];
const MODES: VideoMode[] = ["ayah", "ayahTafsir", "mushafPage", "wordHighlight"];
const EXPORTS: { value: VideoConfig["export"]; label: string }[] = [
  { value: "mp4", label: "MP4" },
  { value: "webm", label: "WebM" },
  { value: "png", label: "PNG" },
  { value: "srt", label: "SRT" },
  { value: "batch", label: "ZIP" },
];
const MAX_PREVIEW_HEIGHT = 720;
const percent = (v: number) => `${Math.round(v * 100)}%`;

/** Fields that change what the preview shows (export format does not). */
const previewKey = (c: VideoConfig) => JSON.stringify({ ...c, export: undefined, pngFrame: undefined });

export function Editor() {
  const { t } = useTranslation();
  const { config, configError, setConfig, setNested, panel, setPanel, appConfig, selectedAyah, setSelectedAyah, setProject, projectId, lang } =
    useEditor();

  const surahs = useSurahs();
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
  const stage = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [panel]);

  const name = projectName(config);
  const surah = surahs.find((s) => s.number === config.surah);
  const maxAyah = surah?.numberOfAyahs ?? 286;
  const caps = appConfig?.capabilities ?? { wordTimings: false, mushafLayout: false, fullTafsirCatalog: false, translations: false };

  const aspect = ASPECT_RATIOS[config.aspectRatio];
  const playerStyle = useMemo(() => {
    const maxH = Math.max(160, Math.min(MAX_PREVIEW_HEIGHT, stageSize.height));
    const scale = Math.min(maxH / aspect.height, stageSize.width / aspect.width);
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
  const style = (patch: Partial<VideoConfig["style"]>) => setNested("style", { ...config.style, ...patch });
  const audio = (patch: Partial<VideoConfig["audio"]>) => setNested("audio", { ...config.audio, ...patch });
  const timing = (patch: Partial<VideoConfig["timing"]>) => setNested("timing", { ...config.timing, ...patch });

  return (
    <div className="editor">
      <section className="stage" aria-label={t("preview")}>
        <div className="stage-player" ref={stage}>
          {/* Remotion AbsoluteFill breaks under document dir=rtl — keep player LTR-isolated */}
          <div className="preview-stage" dir="ltr">
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
                <Rosette size={40} />
                <span>{t("loadingPreview")}</span>
              </div>
            )}
          </div>
        </div>

        {configError || error || preview?.warnings?.length ? (
          <div className="notices" role="status">
            {configError ? <p className="notice error">{configError}</p> : null}
            {error ? <p className="notice error">{error}</p> : null}
            {preview?.warnings?.map((w) => (
              <p key={w} className="notice warn">
                {w}
              </p>
            ))}
          </div>
        ) : null}

        <div className="ayah-strip" aria-label={t("ayat")}>
          {preview?.timeline.slides.map((s) => (
            <button
              type="button"
              key={s.ayah.number}
              className={`ayah-seg${selectedAyah === s.ayah.number ? " on" : ""}`}
              style={{ flexGrow: s.durationInSeconds }}
              aria-pressed={selectedAyah === s.ayah.number}
              onClick={() => {
                setSelectedAyah(s.ayah.number);
                setPanel("timing");
              }}
            >
              <Rosette size={30}>{localDigits(s.ayah.number, lang)}</Rosette>
              <span className="ayah-dur">{t("seconds", { n: s.durationInSeconds.toFixed(1) })}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="inspector">
        <div className="tool-tabs" role="tablist" aria-label={t("tools")}>
          {TABS.map((tab) => (
            <button key={tab} type="button" role="tab" aria-selected={panel === tab} className={panel === tab ? "on" : ""} onClick={() => setPanel(tab)}>
              {t(tab)}
            </button>
          ))}
        </div>

        <div className="tool-body" ref={body} role="tabpanel">
          {panel === "content" && (
            <div className="fields">
              <Group label={t("aspect")}>
                <div className="ratios" role="radiogroup">
                  {Object.entries(ASPECT_RATIOS).map(([k, v]) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={config.aspectRatio === k}
                      className={config.aspectRatio === k ? "on" : ""}
                      title={v.label}
                      onClick={() => setConfig({ aspectRatio: k as VideoConfig["aspectRatio"] })}
                    >
                      <span className="ratio-shape" style={{ aspectRatio: `${v.width} / ${v.height}` }} />
                      <strong>{k}</strong>
                      <small>{v.label.split(" / ")[0]}</small>
                    </button>
                  ))}
                </div>
              </Group>
              <Field label={t("surah")}>
                <Select value={config.surah} onChange={(e) => setConfig({ surah: Number(e.target.value), from: 1, to: 1 })}>
                  {surahs.map((s) => (
                    <option key={s.number} value={s.number}>
                      {lang === "ar" ? `${localDigits(s.number, lang)}. ${s.name}` : `${s.number}. ${s.englishName} — ${s.name}`}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="pair">
                <Stepper label={t("from")} value={config.from} min={1} max={maxAyah} onChange={(v) => setConfig({ from: v })} />
                <Stepper label={t("to")} value={config.to} min={config.from} max={maxAyah} onChange={(v) => setConfig({ to: v })} />
              </div>
              <Field label={t("reciter")}>
                <Select value={config.reciter} onChange={(e) => setConfig({ reciter: e.target.value })}>
                  {reciters.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("tafsir")}>
                <Select value={config.tafsir ?? ""} onChange={(e) => setConfig({ tafsir: e.target.value || null })}>
                  <option value="">{t("none")}</option>
                  {tafsirs.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("translation")}>
                <Select value={config.translation ?? ""} onChange={(e) => setConfig({ translation: e.target.value || null })}>
                  <option value="">{t("none")}</option>
                  {translations.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}

          {panel === "mode" && (
            <div className="choices" role="radiogroup" aria-label={t("mode")}>
              {MODES.map((m) => {
                const ok = canUseMode(m, caps);
                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={config.mode === m}
                    disabled={!ok}
                    className={`choice${config.mode === m ? " on" : ""}`}
                    onClick={() => setConfig({ mode: m })}
                  >
                    <span className="choice-dot" aria-hidden="true" />
                    <span className="choice-text">
                      <strong>{t(m)}</strong>
                      <small>{ok ? t(`${m}Hint`) : t("connectQul")}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {panel === "timing" && (
            <div className="fields">
              <Group label={t("timing")}>
                <Segmented
                  value={config.timing.mode}
                  onChange={(mode) => timing({ mode })}
                  options={[
                    { value: "continuous", label: t("continuous") },
                    { value: "reading", label: t("reading") },
                  ]}
                />
              </Group>
              {config.timing.mode === "reading" ? (
                <Group label={t("speed")}>
                  <Segmented
                    value={config.timing.readingSpeed}
                    onChange={(readingSpeed) => timing({ readingSpeed })}
                    options={[
                      { value: "fast", label: t("fast") },
                      { value: "slow", label: t("slow") },
                      { value: "verySlow", label: t("verySlow") },
                    ]}
                  />
                </Group>
              ) : null}
              {selectedAyah != null ? (
                <Field label={t("holdAyah", { n: selectedAyah })}>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={0.5}
                    value={config.timing.ayahOverrides?.[String(selectedAyah)]?.holdSeconds ?? ""}
                    onChange={(e) => {
                      const v = e.target.value === "" ? undefined : Number(e.target.value);
                      const ayahOverrides = { ...config.timing.ayahOverrides };
                      if (v == null || Number.isNaN(v)) delete ayahOverrides[String(selectedAyah)];
                      else ayahOverrides[String(selectedAyah)] = { holdSeconds: v };
                      timing({ ayahOverrides });
                    }}
                  />
                </Field>
              ) : (
                <p className="hint-box">{t("selectAyahHint")}</p>
              )}
            </div>
          )}

          {panel === "style" && (
            <div className="fields">
              <Group label={t("theme")}>
                <Segmented
                  value={config.style.theme}
                  onChange={(theme) => style({ theme })}
                  options={[
                    { value: "light", label: t("light") },
                    { value: "dark", label: t("dark") },
                  ]}
                />
              </Group>
              <div className="swatches">
                {(
                  [
                    ["primaryColor", t("primaryColor")],
                    ["accentColor", t("accentColor")],
                    ["cardColor", t("cardColor")],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} className="swatch">
                    <input type="color" value={config.style[k]} onChange={(e) => style({ [k]: e.target.value })} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <Slider label={t("fontSize")} min={32} max={120} value={config.style.fontSize} onChange={(fontSize) => style({ fontSize })} />
              <div className="switches">
                <Switch label={t("tajweedColors")} checked={config.style.tajweed} onChange={(tajweed) => style({ tajweed })} />
                <Switch label={t("watermark")} checked={config.style.showWatermark} onChange={(showWatermark) => style({ showWatermark })} />
              </div>
              {config.style.showWatermark ? (
                <Field label={t("watermarkText")}>
                  <input value={config.style.watermarkText} maxLength={60} onChange={(e) => style({ watermarkText: e.target.value })} />
                </Field>
              ) : null}
              <Group label={t("exportFormat")}>
                <Segmented value={config.export} onChange={(v) => setConfig({ export: v })} options={EXPORTS} />
              </Group>
            </div>
          )}

          {panel === "background" && (
            <div className="fields">
              <Segmented
                value={mediaKind}
                onChange={setMediaKind}
                options={[
                  { value: "image", label: t("images") },
                  { value: "video", label: t("videos") },
                ]}
              />
              <form
                className="search"
                role="search"
                onSubmit={(e) => {
                  e.preventDefault();
                  void searchBg().catch((err: Error) => setError(err.message));
                }}
              >
                <Icon name="search" size={18} />
                <input
                  type="search"
                  enterKeyHint="search"
                  aria-label={t("search")}
                  value={mediaQuery}
                  onChange={(e) => setMediaQuery(e.target.value)}
                  placeholder={t("search")}
                />
                <button type="submit" className="btn btn-quiet" disabled={searching}>
                  {searching ? t("searching") : t("search")}
                </button>
              </form>
              <p className="field-hint">{t("peopleFiltered")}</p>
              {mediaNote ? <p className="notice warn">{mediaNote}</p> : null}
              {media.length ? (
                <div className="media-grid">
                  {media.map((m) => (
                    <button
                      type="button"
                      key={`${m.provider}-${m.id}`}
                      className={`media-tile${selectedBg?.media?.id === m.id ? " on" : ""}${m.checked === false ? " unchecked" : ""}`}
                      title={m.attribution}
                      aria-pressed={selectedBg?.media?.id === m.id}
                      onClick={() => applyMedia(m)}
                    >
                      <img src={m.previewUrl ?? m.url} alt={m.attribution ?? ""} loading="lazy" />
                      {m.type === "video" ? (
                        <span className="badge">
                          <Icon name="play" size={12} />
                        </span>
                      ) : null}
                      {selectedBg?.media?.id === m.id ? (
                        <span className="tick">
                          <Icon name="check" size={14} />
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
              {selectedBg?.media?.attribution ? <p className="field-hint">{selectedBg.media.attribution}</p> : null}
              <div className="btn-row">
                <label className="btn btn-quiet">
                  <Icon name="upload" size={18} />
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
                <button type="button" className={`btn btn-quiet${!selectedBg ? " is-on" : ""}`} onClick={() => setNested("backgrounds", [])}>
                  {t("solidColor")}
                </button>
                <button
                  type="button"
                  className={`btn btn-quiet${selectedBg?.type === "gradient" ? " is-on" : ""}`}
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
              <Slider
                label={t("recitationVolume")}
                min={0}
                max={1}
                step={0.05}
                value={config.audio.recitationVolume}
                display={percent(config.audio.recitationVolume)}
                onChange={(recitationVolume) => audio({ recitationVolume })}
              />
              <Field label={t("ambience")}>
                <Select value={config.audio.ambienceId ?? ""} onChange={(e) => audio({ ambienceId: e.target.value || null })}>
                  <option value="">{t("none")}</option>
                  {AMBIENCE_PRESETS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {lang === "ar" ? a.nameAr : a.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Slider
                label={t("ambienceVolume")}
                min={0}
                max={1}
                step={0.05}
                disabled={!config.audio.ambienceId}
                value={config.audio.ambienceVolume}
                display={percent(config.audio.ambienceVolume)}
                onChange={(ambienceVolume) => audio({ ambienceVolume })}
              />
              <div className="switches">
                <Switch
                  label={t("bgSound")}
                  checked={config.audio.backgroundVideoSound}
                  onChange={(backgroundVideoSound) => audio({ backgroundVideoSound })}
                />
              </div>
              <Slider
                label={t("bgVolume")}
                min={0}
                max={1}
                step={0.05}
                disabled={!config.audio.backgroundVideoSound}
                value={config.audio.backgroundVideoVolume}
                display={percent(config.audio.backgroundVideoVolume)}
                onChange={(backgroundVideoVolume) => audio({ backgroundVideoVolume })}
              />
            </div>
          )}
        </div>
      </section>

      <footer className="action-bar">
        {job?.status === "done" && job.outputUrl ? (
          <div className="result">
            {/\.(mp4|webm)$/.test(job.outputUrl) ? <video src={job.outputUrl} controls playsInline /> : null}
            {job.outputUrl.endsWith(".png") ? <img src={job.outputUrl} alt="" /> : null}
            <div className="result-text">
              <strong>{t("ready")}</strong>
              <a className="btn btn-quiet" href={job.outputUrl} download>
                <Icon name="download" size={18} />
                {t("download")}
              </a>
            </div>
            <button type="button" className="icon-btn" aria-label={t("close")} onClick={() => setJob(undefined)}>
              <Icon name="close" size={18} />
            </button>
          </div>
        ) : null}
        <div className="action-row">
          <div className="action-info">
            {rendering ? (
              <>
                <span className="action-status">
                  {job.status === "queued" && job.queuePosition ? t("queued", { pos: job.queuePosition }) : `${t("rendering")} ${progress}%`}
                </span>
                <span className="progress">
                  <span style={{ width: `${progress}%` }} />
                </span>
              </>
            ) : (
              <span className="project-name" title={name}>
                {status ?? (
                  <>
                    <strong>{lang === "ar" ? (surah?.name ?? config.surah) : (surah?.englishName ?? config.surah)}</strong>{" "}
                    <bdi>{config.from === config.to ? config.from : `${config.from}–${config.to}`}</bdi>
                    <span className="project-sub">
                      {t(config.mode)} · {config.aspectRatio}
                    </span>
                  </>
                )}
              </span>
            )}
          </div>
          {rendering ? (
            <button type="button" className="btn btn-quiet" onClick={() => void api.cancelJob(job.id).then(setJob)}>
              {t("cancel")}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-quiet"
              aria-label={t("saveProject")}
              onClick={() => void saveProject().catch((e: Error) => setError(e.message))}>
              <Icon name="save" size={18} />
              <span className="hide-xs">{t("saveProject")}</span>
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void generate().catch((e: Error) => setError(e.message))}
            disabled={!preview || Boolean(rendering)}
          >
            {t("generate")}
          </button>
        </div>
      </footer>
    </div>
  );
}
