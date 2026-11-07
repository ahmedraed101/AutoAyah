import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { useTranslation } from "react-i18next";
import {
  ASPECT_RATIOS,
  AMBIENCE_PRESETS,
  ayahKey,
  buildTimeline,
  canUseMode,
  holdOverride,
  isMushafMode,
  needsWordTimings,
  projectName,
  spansSurahs,
  withoutWordHighlight,
  type Job,
  type VideoConfig,
  type VideoMode,
} from "@autoayah/core";
import { AutoAyahComposition, restFrame } from "@autoayah/templates";
import { api, type MediaResult, type PreviewResult } from "../api";
import { browserStore } from "../browserStore";
import { Field, Group, Section, Segmented, Select, Slider, Stepper, Switch } from "../components/controls";
import { Icon, Rosette } from "../components/Icon";
import { useEditor, type Panel } from "../store";
import { RangePicker } from "../components/RangePicker";
import { useDivisionTitle } from "../components/SurahLabel";
import { localDigits, rangeText, surahTitle, useSurahs } from "../surahs";
import { groupBy, languageName } from "../catalog";

type Option = { id: string; name: string; nameAr?: string; language?: string; hasWordTimings?: boolean };

const TABS: Panel[] = ["ayat", "recitation", "look", "background"];
const MODES: VideoMode[] = ["mushafPage", "mushafWords", "ayah", "ayahTafsir", "wordHighlight"];
const EXPORTS: { value: VideoConfig["export"]; label: string }[] = [
  { value: "mp4", label: "MP4" },
  { value: "webm", label: "WebM" },
  { value: "png", label: "PNG" },
  { value: "srt", label: "SRT" },
  { value: "batch", label: "ZIP" },
];
const PAPERS: VideoConfig["style"]["mushafPaper"][] = ["auto", "ivory", "white", "sepia", "mint", "night"];
const FRAMES: VideoConfig["style"]["mushafFrame"][] = ["classic", "ornate", "simple", "card", "none"];
const MAX_PREVIEW_HEIGHT = 720;
const percent = (v: number) => `${Math.round(v * 100)}%`;
const clock = (sec: number) => {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Fields that change the composed video (export format does not). */
const previewKey = (c: VideoConfig) => JSON.stringify({ ...c, export: undefined, pngFrame: undefined });

/** Fields the server needs for the text-only view; timing, style and backgrounds are applied in the browser. */
const draftKey = (c: VideoConfig) =>
  JSON.stringify([c.surah, c.from, c.toSurah, c.to, c.mode, c.tafsir, c.translation, c.aspectRatio, c.style.tajweed]);

export function Editor() {
  const { t } = useTranslation();
  const { config, configError, missing, setConfig, setNested, panel, setPanel, appConfig, selectedAyah, setSelectedAyah, setProject, projectId, lang } =
    useEditor();

  const surahs = useSurahs();
  const divisionTitle = useDivisionTitle();
  const [reciters, setReciters] = useState<Option[]>([]);
  const [tafsirs, setTafsirs] = useState<Option[]>([]);
  // Unknown until the catalog loads; only a reciter known to lack word timings blocks word highlighting.
  const reciterTimed = reciters.find((r) => r.id === config.reciter)?.hasWordTimings !== false;
  const [translations, setTranslations] = useState<Option[]>([]);
  const [draft, setDraft] = useState<PreviewResult>();
  const [composed, setComposed] = useState<{ key: string; result: PreviewResult }>();
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string>();
  const [draftError, setDraftError] = useState<string>();
  const [job, setJob] = useState<Job>();
  const [status, setStatus] = useState<string>();
  const [media, setMedia] = useState<MediaResult[]>([]);
  const [mediaKind, setMediaKind] = useState<"image" | "video">("image");
  const [mediaQuery, setMediaQuery] = useState("nature landscape");
  const [mediaNote, setMediaNote] = useState<string>();
  const [mediaMore, setMediaMore] = useState<{ query: string; kind: "image" | "video"; page: number; unchecked: number }>();
  const [searching, setSearching] = useState(false);
  const events = useRef<EventSource | null>(null);
  const composeAbort = useRef<AbortController | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const player = useRef<PlayerRef>(null);
  const [playingAyah, setPlayingAyah] = useState<string>();
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

  useEffect(() => {
    if (!reciterTimed && needsWordTimings(config.mode)) setConfig({ mode: withoutWordHighlight(config.mode) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reciterTimed, config.mode]);

  const textKey = missing.surah ? "" : draftKey(config);
  useEffect(() => {
    setPlayingAyah(undefined);
    if (!textKey) {
      setDraft(undefined);
      return;
    }
    const ac = new AbortController();
    const timer = setTimeout(() => {
      api
        .draft(config, ac.signal)
        .then((d) => {
          setDraft(d);
          setDraftError(undefined);
        })
        .catch((e: Error) => {
          if (e.name === "AbortError") return;
          setDraft(undefined);
          setDraftError(e.message);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textKey]);

  // Any edit after composing goes back to the live view, and cancels a compose in flight.
  const fullKey = previewKey(config);
  const isComposed = composed?.key === fullKey && !missing.reciter;
  useEffect(() => {
    composeAbort.current?.abort();
  }, [fullKey]);

  const liveTimeline = useMemo(() => {
    if (!draft) return undefined;
    const ayat = draft.timeline.slides.map((s) => s.ayah);
    return buildTimeline(config, { ...draft, surah: draft.config.surah, ayat, draft: true });
  }, [draft, config]);

  const shown: PreviewResult | undefined = isComposed
    ? composed.result
    : draft && liveTimeline
      ? { ...draft, timeline: liveTimeline, config, warnings: [...new Set([...draft.warnings, ...liveTimeline.warnings])] }
      : undefined;

  // Composed: start from the selected ayah. Back to live (any edit): stop, so nothing plays without controls.
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    if (!isComposed) {
      p.pause();
      return;
    }
    const from = composed.result.timeline.slides.find((s) => ayahKey(s.ayah.surah ?? config.surah, s.ayah.number) === selectedAyah);
    p.seekTo(from ? restFrame(from) : 0);
    p.play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComposed]);

  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [panel]);

  const slides = shown?.timeline.slides;
  useEffect(() => {
    const p = player.current;
    if (!p || !slides?.length) return;
    const onFrame = (e: { detail: { frame: number } }) => {
      let s = slides[0];
      for (const x of slides) if (x.startFrame <= e.detail.frame) s = x;
      if (s) setPlayingAyah(ayahKey(slideRef(s).surah, s.ayah.number));
    };
    p.addEventListener("frameupdate", onFrame);
    return () => p.removeEventListener("frameupdate", onFrame);
  }, [slides]);

  useEffect(() => {
    if (playingAyah == null) return;
    strip.current
      ?.querySelector<HTMLElement>(".ayah-seg.playing")
      ?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  }, [playingAyah]);

  const previewSpans = new Set(slides?.map((s) => s.ayah.surah)).size > 1;
  const totalSeconds = slides?.reduce((sum, s) => sum + s.durationInSeconds, 0) ?? 0;

  const name = projectName(config);
  const multiSurah = spansSurahs(config);
  const division = divisionTitle(config);
  const slideRef = (s: { ayah: { surah?: number; number: number } }) => ({ surah: s.ayah.surah ?? config.surah, ayah: s.ayah.number });
  const selectedRef = selectedAyah?.split(":").map(Number) as [number, number] | undefined;
  const caps = appConfig?.capabilities ?? { wordTimings: false, mushafLayout: false, fullTafsirCatalog: false, translations: false };
  const ready = !missing.surah && !missing.reciter;

  const aspect = ASPECT_RATIOS[config.aspectRatio];
  const playerStyle = useMemo(() => {
    const maxH = Math.max(160, Math.min(MAX_PREVIEW_HEIGHT, stageSize.height));
    const scale = Math.min(maxH / aspect.height, stageSize.width / aspect.width);
    return { width: Math.round(aspect.width * scale), height: Math.round(aspect.height * scale) };
  }, [aspect, stageSize]);

  const compose = async () => {
    if (missing.reciter) {
      setPanel("recitation");
      return;
    }
    const ac = new AbortController();
    composeAbort.current = ac;
    const key = fullKey;
    setComposing(true);
    setError(undefined);
    try {
      setComposed({ key, result: await api.preview(config, ac.signal) });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      if (composeAbort.current === ac) setComposing(false);
    }
  };

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

  const searchBg = async (more = false) => {
    const query = more && mediaMore ? mediaMore.query : mediaQuery;
    const kind = more && mediaMore ? mediaMore.kind : mediaKind;
    const page = more && mediaMore ? mediaMore.page + 1 : 1;
    setSearching(true);
    try {
      const res = await api.searchMedia({ query, kind, page, keys: await browserKeys() });
      const unchecked = (more && mediaMore ? mediaMore.unchecked : 0) + res.unchecked;
      setMedia((prev) => {
        if (!more) return res.results;
        const seen = new Set(prev.map((m) => `${m.provider}-${m.id}`));
        return [...prev, ...res.results.filter((m) => !seen.has(`${m.provider}-${m.id}`))];
      });
      setMediaMore(res.hasMore ? { query, kind, page: res.page, unchecked } : undefined);
      setMediaNote(unchecked ? t("uncheckedResults", { n: unchecked }) : undefined);
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
  const modeBlocker = (m: VideoMode) =>
    !canUseMode(m, caps) ? t("connectQul") : needsWordTimings(m) && !reciterTimed ? t("needsWordTimings") : undefined;
  const modeHint = modeBlocker(config.mode) ?? t(`${config.mode}Hint`);

  return (
    <div className="editor">
      <section className="stage" aria-label={t("preview")}>
        <div className="stage-player" ref={stage}>
          {/* Remotion AbsoluteFill breaks under document dir=rtl — keep player LTR-isolated */}
          <div className="preview-stage" dir="ltr">
            {shown ? (
              <div className="player">
                <Player
                  component={AutoAyahComposition}
                  inputProps={{
                    timeline: shown.timeline,
                    config: shown.config,
                    surahName: shown.surahName,
                    tafsirName: shown.tafsirName,
                    translationName: shown.translationName,
                    basmala: shown.basmala,
                    surahNames: shown.surahNames,
                    mushafPages: shown.mushafPages,
                  }}
                  durationInFrames={Math.max(1, shown.timeline.totalFrames)}
                  fps={shown.timeline.fps}
                  compositionWidth={shown.timeline.width}
                  compositionHeight={shown.timeline.height}
                  style={playerStyle}
                  ref={player}
                  acknowledgeRemotionLicense
                  controls={isComposed}
                  clickToPlay={isComposed}
                />
              </div>
            ) : !missing.surah ? (
              <div className="player-placeholder" style={playerStyle}>
                <Rosette size={40} />
                <span>{t("loadingPreview")}</span>
              </div>
            ) : (
              <div className="player-placeholder start" style={playerStyle} dir={lang === "ar" ? "rtl" : "ltr"}>
                <Rosette size={40} />
                <strong>{t("startTitle")}</strong>
                {panel !== "ayat" ? (
                  <button type="button" className="btn btn-quiet" onClick={() => setPanel("ayat")}>
                    {t("startChoose")}
                  </button>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {configError || error || draftError || shown?.warnings?.length ? (
          <div className="notices" role="status">
            {configError ? <p className="notice error">{configError}</p> : null}
            {draftError ? <p className="notice error">{draftError}</p> : null}
            {error ? <p className="notice error">{error}</p> : null}
            {shown?.warnings?.map((w) => (
              <p key={w} className="notice warn">
                {w}
              </p>
            ))}
          </div>
        ) : null}

        {slides?.length ? (
          <div className="timeline">
            <div className="timeline-head">
              <span className="timeline-title">
                {t("ayat")}{" "}
                <bdi className="timeline-total">{isComposed ? clock(totalSeconds) : localDigits(slides.length, lang)}</bdi>
              </span>
              <span className="timeline-hint">{isComposed ? t("timelineHint") : t("liveHint")}</span>
              {isComposed ? null : (
                <button type="button" className="btn btn-quiet btn-sm play-btn" disabled={composing} onClick={() => void compose()}>
                  {composing ? <Rosette size={16} /> : <Icon name="play" size={16} />}
                  {composing ? t("composing") : missing.reciter ? t("chooseReciterToPlay") : t("playRecitation")}
                </button>
              )}
            </div>
            <div className="ayah-strip" ref={strip} aria-label={t("ayat")}>
              {slides.map((s, i, all) => {
                const ref = slideRef(s);
                const k = ayahKey(ref.surah, ref.ayah);
                const held = holdOverride(config.timing, ref.surah, ref.ayah, config.surah) != null;
                const surahName = previewSpans ? surahTitle(surahs, ref.surah, lang) : undefined;
                const newSurah = i > 0 && slideRef(all[i - 1]!).surah !== ref.surah;
                return (
                  <Fragment key={k}>
                    {newSurah ? (
                      <span className="surah-break" aria-hidden>
                        {surahName}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className={`ayah-seg${selectedAyah === k ? " on" : ""}${playingAyah === k ? " playing" : ""}`}
                      style={{ flexGrow: s.durationInSeconds }}
                      aria-pressed={selectedAyah === k}
                      title={surahName}
                      aria-label={`${surahName ? `${surahName} ` : ""}${t("ayahN", { n: s.ayah.number })}${
                        isComposed ? `, ${t("seconds", { n: s.durationInSeconds.toFixed(1) })}` : ""
                      }`}
                      onClick={() => {
                        player.current?.seekTo(restFrame(s));
                        setPlayingAyah(k);
                        setSelectedAyah(k);
                      }}
                    >
                      <Rosette size={30}>{localDigits(s.ayah.number, lang)}</Rosette>
                      {isComposed ? <span className="ayah-dur">{t("seconds", { n: s.durationInSeconds.toFixed(1) })}</span> : null}
                      {held ? <span className="held-dot" title={t("customHold")} /> : null}
                    </button>
                  </Fragment>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      <section className="inspector">
        <div className="tool-tabs" role="tablist" aria-label={t("tools")}>
          {TABS.map((tab) => (
            <button key={tab} type="button" role="tab" aria-selected={panel === tab} className={panel === tab ? "on" : ""} onClick={() => setPanel(tab)}>
              {t(tab === "background" ? "background" : `tab_${tab}`)}
            </button>
          ))}
        </div>

        <div className="tool-body" ref={body} role="tabpanel">
          {panel === "ayat" && (
            <div className="fields">
              <RangePicker />
              <Section title={t("onScreen")}>
                <div className="views" role="radiogroup" aria-label={t("mode")}>
                  {MODES.map((m) => {
                    const blocked = modeBlocker(m);
                    return (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={config.mode === m}
                        disabled={blocked != null}
                        title={blocked ?? t(`${m}Hint`)}
                        className={config.mode === m ? "on" : ""}
                        onClick={() => setConfig({ mode: m })}
                      >
                        {t(m)}
                      </button>
                    );
                  })}
                </div>
                <p className="field-hint">{modeHint}</p>
                <Field label={t("tafsir")}>
                  <Select value={config.tafsir ?? ""} onChange={(e) => setConfig({ tafsir: e.target.value || null })}>
                    <option value="">{t("none")}</option>
                    {config.tafsir && tafsirs.length && !tafsirs.some((x) => x.id === config.tafsir) ? (
                      <option value={config.tafsir}>{config.tafsir}</option>
                    ) : null}
                    {groupBy(tafsirs, (x) => languageName(x.language, lang)).map(([group, items]) => (
                      <optgroup key={group} label={group}>
                        {items.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                </Field>
                <Field label={t("translation")}>
                  <Select value={config.translation ?? ""} onChange={(e) => setConfig({ translation: e.target.value || null })}>
                    <option value="">{t("none")}</option>
                    {config.translation && translations.length && !translations.some((x) => x.id === config.translation) ? (
                      <option value={config.translation}>{config.translation}</option>
                    ) : null}
                    {groupBy(translations, (x) => languageName(x.language, lang)).map(([group, items]) => (
                      <optgroup key={group} label={group}>
                        {items.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                </Field>
              </Section>
            </div>
          )}

          {panel === "recitation" && (
            <div className="fields">
              <Field label={t("reciter")}>
                <Select value={missing.reciter ? "" : config.reciter} onChange={(e) => setConfig({ reciter: e.target.value })}>
                  {missing.reciter ? (
                    <option value="" disabled>
                      {t("chooseReciter")}
                    </option>
                  ) : reciters.length && !reciters.some((r) => r.id === config.reciter) ? (
                    <option value={config.reciter}>{config.reciter}</option>
                  ) : null}
                  {groupBy(reciters, (r) => (r.hasWordTimings ? t("recitersTimed") : t("recitersOther"))).map(([group, items]) => (
                    <optgroup key={group} label={group}>
                      {items.map((r) => (
                        <option key={r.id} value={r.id}>
                          {(lang === "ar" && r.nameAr) || r.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </Field>

              <Section title={t("pacing")}>
                <Segmented
                  value={config.timing.mode}
                  onChange={(mode) => timing({ mode })}
                  options={[
                    { value: "continuous", label: t("continuous") },
                    { value: "reading", label: t("reading") },
                  ]}
                />
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
                {selectedRef ? (
                  <Field
                    label={
                      multiSurah
                        ? `${surahTitle(surahs, selectedRef[0], lang)} · ${t("holdAyah", { n: selectedRef[1] })}`
                        : t("holdAyah", { n: selectedRef[1] })
                    }
                  >
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.5}
                      value={holdOverride(config.timing, selectedRef[0], selectedRef[1], config.surah) ?? ""}
                      onChange={(e) => {
                        const v = e.target.value === "" ? undefined : Number(e.target.value);
                        const ayahOverrides = { ...config.timing.ayahOverrides };
                        if (selectedRef[0] === config.surah) delete ayahOverrides[String(selectedRef[1])];
                        if (v == null || Number.isNaN(v)) delete ayahOverrides[selectedAyah!];
                        else ayahOverrides[selectedAyah!] = { holdSeconds: v };
                        timing({ ayahOverrides });
                      }}
                    />
                  </Field>
                ) : (
                  <p className="field-hint">{t("selectAyahHint")}</p>
                )}
              </Section>

              <Section title={t("soundMix")}>
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
                {config.audio.ambienceId ? (
                  <Slider
                    label={t("ambienceVolume")}
                    min={0}
                    max={1}
                    step={0.05}
                    value={config.audio.ambienceVolume}
                    display={percent(config.audio.ambienceVolume)}
                    onChange={(ambienceVolume) => audio({ ambienceVolume })}
                  />
                ) : null}
                {selectedBg?.type === "video" ? (
                  <>
                    <div className="switches">
                      <Switch
                        label={t("bgSound")}
                        checked={config.audio.backgroundVideoSound}
                        onChange={(backgroundVideoSound) => audio({ backgroundVideoSound })}
                      />
                    </div>
                    {config.audio.backgroundVideoSound ? (
                      <Slider
                        label={t("bgVolume")}
                        min={0}
                        max={1}
                        step={0.05}
                        value={config.audio.backgroundVideoVolume}
                        display={percent(config.audio.backgroundVideoVolume)}
                        onChange={(backgroundVideoVolume) => audio({ backgroundVideoVolume })}
                      />
                    ) : null}
                  </>
                ) : null}
              </Section>
            </div>
          )}

          {panel === "look" && (
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

              <Section title={t("pageLook")}>
                <Segmented
                  value={config.style.theme}
                  onChange={(theme) => style({ theme })}
                  options={[
                    { value: "light", label: t("light") },
                    { value: "dark", label: t("dark") },
                  ]}
                />
                <Group label={t("mushafPaper")}>
                  <Segmented
                    value={config.style.mushafPaper}
                    onChange={(mushafPaper) => style({ mushafPaper })}
                    options={PAPERS.map((value) => ({ value, label: t(`paper_${value}`) }))}
                  />
                </Group>
                <Group label={t("mushafFrame")}>
                  <Segmented
                    value={config.style.mushafFrame}
                    onChange={(mushafFrame) => style({ mushafFrame })}
                    options={FRAMES.map((value) => ({ value, label: t(`frame_${value}`) }))}
                  />
                </Group>
              </Section>

              <Section title={t("ayat")}>
                {isMushafMode(config.mode) ? (
                  <p className="field-hint">{t("fontSizeMushafHint")}</p>
                ) : (
                  <Slider label={t("fontSize")} min={32} max={120} value={config.style.fontSize} onChange={(fontSize) => style({ fontSize })} />
                )}
                <div className="switches">
                  <Switch label={t("tajweedColors")} checked={config.style.tajweed} onChange={(tajweed) => style({ tajweed })} />
                  <Switch label={t("watermark")} checked={config.style.showWatermark} onChange={(showWatermark) => style({ showWatermark })} />
                </div>
                {config.style.showWatermark ? (
                  <Field label={t("watermarkText")}>
                    <input value={config.style.watermarkText} maxLength={60} onChange={(e) => style({ watermarkText: e.target.value })} />
                  </Field>
                ) : null}
              </Section>

              <Section title={t("colors")}>
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
              </Section>
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
                  void searchBg(false).catch((err: Error) => setError(err.message));
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
              {mediaMore ? (
                <button
                  type="button"
                  className="btn btn-quiet load-more"
                  disabled={searching}
                  onClick={() => void searchBg(true).catch((err: Error) => setError(err.message))}
                >
                  {searching ? t("searching") : t("loadMore")}
                </button>
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
              {selectedBg?.type === "image" || selectedBg?.type === "video" ? (
                <div className="switches">
                  <Switch label={t("mediaPanel")} checked={config.style.mediaPanel} onChange={(mediaPanel) => style({ mediaPanel })} />
                </div>
              ) : null}
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
              <span className="project-name" title={missing.surah ? undefined : name}>
                {status ??
                  (missing.surah ? (
                    <span className="project-sub">{t("startTitle")}</span>
                  ) : (
                    <>
                      {division ? <strong>{division} </strong> : null}
                      <bdi dir={lang === "ar" ? "rtl" : "ltr"}>{rangeText(config, surahs, lang)}</bdi>
                      <span className="project-sub">{missing.reciter ? t("needReciter") : `${t(config.mode)} · ${config.aspectRatio}`}</span>
                    </>
                  ))}
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
              disabled={!ready}
              onClick={() => void saveProject().catch((e: Error) => setError(e.message))}
            >
              <Icon name="save" size={18} />
              <span className="hide-xs">{t("saveProject")}</span>
            </button>
          )}
          <span className="select export-select">
            <select aria-label={t("exportFormat")} value={config.export} onChange={(e) => setConfig({ export: e.target.value as VideoConfig["export"] })}>
              {EXPORTS.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </select>
          </span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void generate().catch((e: Error) => setError(e.message))}
            disabled={!ready || Boolean(rendering)}
          >
            {t("generate")}
          </button>
        </div>
      </footer>
    </div>
  );
}
