import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  PLATFORMS,
  seriesUnits,
  unitsToQueue,
  type BackgroundPlan,
  type PlatformId,
  type Project,
  type Series,
  type SeriesUnitKind,
  type UnitSelect,
} from "@autoayah/core";
import { api, type MediaResult } from "../api";
import { Field, Segmented } from "../components/controls";
import { Editor } from "./Editor";
import { Icon } from "../components/Icon";
import { MediaGrid, mediaRefFrom, rememberMedia, useBackgroundLibrary } from "../components/MediaGrid";
import { NeedsDb } from "../components/NeedsDb";
import { EditorStoreContext, createEditorStore, useEditor } from "../store";
import { localDigits, useDivisions, useSurahs } from "../surahs";

const KINDS: SeriesUnitKind[] = ["surah", "juz", "hizb", "rub", "page", "manzil", "chunk"];
const kindLabel = (kind: SeriesUnitKind) => (kind === "chunk" ? "kind_chunk" : `kind_${kind}`);

function sameList(a: number[], b: number[]) {
  return a.length === b.length && a.every((n, i) => n === b[i]);
}

export function Automation() {
  return (
    <NeedsDb>
      <AutomationBody />
    </NeedsDb>
  );
}

function AutomationBody() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { appConfig, lang } = useEditor();
  const store = useRef(createEditorStore()).current;
  const surahs = useSurahs();
  const divisions = useDivisions();

  const [series, setSeries] = useState<Series[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [id, setId] = useState<string | null>(() => sessionStorage.getItem("aa-series"));
  const [name, setName] = useState("");
  const [unitKind, setUnitKind] = useState<SeriesUnitKind>("surah");
  const [chunkSize, setChunkSize] = useState(10);
  const [chunkSurahs, setChunkSurahs] = useState<number[]>([]);
  const [bgMode, setBgMode] = useState<BackgroundPlan["mode"]>("template");
  const [single, setSingle] = useState<MediaResult | null>(null);
  const [list, setList] = useState<MediaResult[]>([]);
  const [randomKind, setRandomKind] = useState<"image" | "video">("image");
  const library = useBackgroundLibrary(bgMode === "single" || bgMode === "list");
  const [platforms, setPlatforms] = useState<PlatformId[]>(["youtube", "tiktok"]);
  const [selectType, setSelectType] = useState<UnitSelect["type"]>("all");
  const [rangeFrom, setRangeFrom] = useState(1);
  const [rangeTo, setRangeTo] = useState(114);
  const [picked, setPicked] = useState<string[]>([]);
  const [nextN, setNextN] = useState(10);
  const [regenerate, setRegenerate] = useState(false);
  const [savedUnits, setSavedUnits] = useState<{ key: string; status: string }[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const loadedId = useRef<string | null>(null);

  const reload = () => api.series().then(setSeries).catch((e: Error) => setError(e.message));

  useEffect(() => {
    void reload();
    void api.projects().then(setProjects).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (id) sessionStorage.setItem("aa-series", id);
    else sessionStorage.removeItem("aa-series");
  }, [id]);

  useEffect(() => {
    if (series && id && !series.some((s) => s.id === id)) setId(null);
  }, [series, id]);

  useEffect(() => {
    if (!id) {
      setSavedUnits([]);
      return;
    }
    let live = true;
    api.seriesUnits(id).then((res) => live && setSavedUnits(res.units)).catch(() => live && setSavedUnits([]));
    return () => {
      live = false;
    };
  }, [id]);

  useEffect(() => {
    const current = series?.find((s) => s.id === id);
    if (!current || loadedId.current === current.id) return;
    loadedId.current = current.id;
    setName(current.name);
    setUnitKind(current.unitKind);
    setChunkSize(current.chunkSize ?? 10);
    setChunkSurahs([...(current.chunkSurahs ?? [])].sort((a, b) => a - b));
    setPlatforms(current.platforms);
    setBgMode(current.backgrounds.mode);
    if (current.backgrounds.mode === "single") setSingle({ ...current.backgrounds.media, type: current.backgrounds.type });
    if (current.backgrounds.mode === "list") setList(current.backgrounds.items.map((item) => ({ ...item.media, type: item.type })));
    if (current.backgrounds.mode === "random") setRandomKind(current.backgrounds.kind);
    store.getState().setConfig(current.template);
  }, [id, series, store]);

  const units = useMemo(
    () => (divisions ? seriesUnits(unitKind, divisions, { chunkSize, chunkSurahs }) : []),
    [divisions, unitKind, chunkSize, chunkSurahs],
  );

  const select = useMemo<UnitSelect>(() => {
    if (selectType === "range") return { type: "range", from: rangeFrom, to: rangeTo };
    if (selectType === "keys") return { type: "keys", keys: picked.length ? picked : ["_none"] };
    if (selectType === "nextN") return { type: "nextN", n: nextN };
    return { type: "all" };
  }, [selectType, rangeFrom, rangeTo, picked, nextN]);

  const saved = series?.find((s) => s.id === id);
  const sameShape = Boolean(
    saved && saved.unitKind === unitKind && (unitKind !== "chunk" || ((saved.chunkSize ?? 10) === chunkSize && sameList(saved.chunkSurahs ?? [], chunkSurahs))),
  );
  const plan = useMemo(() => {
    const statusOf = (unit: (typeof units)[number]) => (sameShape ? savedUnits.find((row) => row.key === unit.key)?.status : undefined);
    const chosen = select.type === "keys" && !picked.length ? { queue: [], skipped: 0 } : unitsToQueue(units, select, statusOf, regenerate);
    return chosen;
  }, [units, select, sameShape, savedUnits, regenerate, picked.length]);

  const chunkKey = chunkSurahs.join(",");
  useEffect(() => {
    if (!units.length) return;
    setRangeFrom(1);
    setRangeTo(units.length);
  }, [unitKind, chunkSize, chunkKey, units.length]);

  useEffect(() => {
    const first = plan.queue[0] ?? units[0];
    if (first) store.getState().setConfig(first.range);
  }, [plan, units, store]);

  const pickMedia = (m: MediaResult) => {
    rememberMedia(m, appConfig?.storageMode);
    if (bgMode === "list") {
      setList((prev) => (prev.some((item) => item.provider === m.provider && item.id === m.id) ? prev.filter((item) => item.id !== m.id || item.provider !== m.provider) : [...prev, m]));
      return;
    }
    setSingle(m);
    setBgMode("single");
  };

  const start = async () => {
    setError(undefined);
    const editor = store.getState();
    if (!name.trim()) return setError(t("needSeriesName"));
    if (editor.missing.reciter) return setError(t("needReciter"));
    if (unitKind === "chunk" && !chunkSurahs.length) return setError(t("pickSurahs"));
    if (selectType === "keys" && !picked.length) return setError(t("pickUnits"));
    if (!units.length) return setError(t("nothingToQueue"));
    let backgrounds: BackgroundPlan = { mode: "template" };
    if (bgMode === "single") {
      if (!single?.url) return setError(t("pickBackground"));
      backgrounds = { mode: "single", type: single.type, media: mediaRefFrom(single) };
    } else if (bgMode === "list") {
      if (!list.length) return setError(t("pickBackground"));
      backgrounds = { mode: "list", items: list.map((item) => ({ type: item.type, media: mediaRefFrom(item) })) };
    } else if (bgMode === "random") backgrounds = { mode: "random", kind: randomKind };
    const body = {
      name: name.trim(),
      unitKind,
      ...(unitKind === "chunk" ? { chunkSize, chunkSurahs } : {}),
      template: editor.config,
      backgrounds,
      platforms,
    };
    const runSelect: UnitSelect = selectType === "keys" ? { type: "keys", keys: picked } : select;
    setBusy(true);
    try {
      const savedSeries = id ? await api.updateSeries(id, body) : await api.createSeries(body);
      setId(savedSeries.id);
      loadedId.current = savedSeries.id;
      const result = await api.runSeries(savedSeries.id, { select: runSelect, regenerate });
      await reload();
      if (result.failed) {
        const failed = t("failedSome", { n: result.failed, error: result.errors.join(" ") });
        setError(result.queued ? t("queuedSome", { n: result.queued, error: failed }) : failed);
        return;
      }
      if (!result.queued) {
        setError(result.unchanged ? t("alreadyUpToDate") : t("nothingToQueue"));
        return;
      }
      nav(`/tracker?series=${savedSeries.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!id || !confirm(t("deleteSeriesConfirm"))) return;
    await api.deleteSeries(id);
    loadedId.current = null;
    setId(null);
    await reload();
  };

  const shapeLocked = Boolean(id && savedUnits.some((unit) => unit.status !== "none"));
  const clampRange = (value: number) => Math.min(units.length || 1, Math.max(1, value));

  return (
    <div className="auto-page fill-page">
      <aside className="auto-side">
        <header className="page-head">
          <h1>{t("automation")}</h1>
        </header>
        <p className="field-hint">{t("settingsAside")}</p>
        <Field label={t("series")}>
          <select
            aria-label={t("series")}
            value={id ?? ""}
            onChange={(e) => {
              loadedId.current = null;
              setId(e.target.value || null);
            }}
          >
            <option value="">{t("newSeries")}</option>
            {(series ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("seriesName")}>
          <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </Field>
        {projects.length ? (
          <Field label={t("loadProject")}>
            <select
              aria-label={t("loadProject")}
              defaultValue=""
              onChange={(e) => {
                const project = projects.find((item) => item.id === e.target.value);
                if (project) store.getState().setConfig(project.config);
              }}
            >
              <option value="">{t("choose")}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <Field label={t("unitKind")}>
          <select value={unitKind} disabled={shapeLocked} onChange={(e) => setUnitKind(e.target.value as SeriesUnitKind)}>
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(kindLabel(kind))}
              </option>
            ))}
            </select>
          </Field>
        {shapeLocked ? <p className="field-hint">{t("shapeLocked")}</p> : null}
        {unitKind === "chunk" ? (
          <>
            <Field label={t("chunkSize")}>
              <input
                type="number"
                min={1}
                max={50}
                value={chunkSize}
                disabled={shapeLocked}
                onChange={(e) => setChunkSize(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
              />
            </Field>
            <div className="field">
              <span className="field-label">{t("chunkSurahs")}</span>
              <div className="btn-row">
                <button type="button" className="btn btn-quiet btn-sm" disabled={shapeLocked} onClick={() => setChunkSurahs(surahs.map((s) => s.number))}>
                  {t("selectAllSurahs")}
                </button>
                <button type="button" className="btn btn-quiet btn-sm" disabled={shapeLocked} onClick={() => setChunkSurahs([])}>
                  {t("selectNoSurahs")}
                </button>
              </div>
              <div className="chip-grid" role="group" aria-label={t("chunkSurahs")}>
                {surahs.map((s) => {
                  const on = chunkSurahs.includes(s.number);
                  return (
                    <button
                      key={s.number}
                      type="button"
                      className={on ? "on" : ""}
                      aria-pressed={on}
                      disabled={shapeLocked}
                      onClick={() => setChunkSurahs((prev) => (on ? prev.filter((n) => n !== s.number) : [...prev, s.number].sort((a, b) => a - b)))}
                    >
                      {localDigits(s.number, lang)}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}

        <div className="field">
          <span className="field-label">{t("bgPlan")}</span>
          <Segmented
            value={bgMode}
            onChange={setBgMode}
            options={[
              { value: "template", label: t("bg_template") },
              { value: "single", label: t("bg_single") },
              { value: "list", label: t("bg_list") },
              { value: "random", label: t("bg_random") },
            ]}
          />
        </div>
        {bgMode === "random" ? (
          <Segmented
            label={t("bgRandomKind")}
            value={randomKind}
            onChange={setRandomKind}
            options={[
              { value: "image", label: t("images") },
              { value: "video", label: t("videos") },
            ]}
          />
        ) : null}
        {bgMode === "single" || bgMode === "list" ? (
          <>
            <div className="btn-row">
              <label className="btn btn-quiet btn-sm">
                <Icon name="upload" size={16} />
                {t("upload")}
                <input
                  type="file"
                  accept="image/*,video/*"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void library.upload(file).then(pickMedia).catch((err: Error) => setError(err.message));
                  }}
                />
              </label>
              <Segmented
                value={library.mediaKind}
                onChange={library.setMediaKind}
                options={[
                  { value: "image", label: t("images") },
                  { value: "video", label: t("videos") },
                ]}
              />
            </div>
            {library.media.length ? (
              <MediaGrid
                items={library.media}
                isSelected={(m) =>
                  bgMode === "list"
                    ? list.some((item) => item.provider === m.provider && item.id === m.id)
                    : single?.provider === m.provider && single.id === m.id
                }
                onPick={pickMedia}
              />
            ) : null}
            <button type="button" className="btn btn-quiet btn-sm" disabled={library.searching} onClick={() => void library.loadMore()}>
              {library.searching ? t("searching") : t("loadMore")}
            </button>
            {library.mediaNote ? <p className="notice warn">{library.mediaNote}</p> : null}
          </>
        ) : null}

        <div className="field">
          <span className="field-label">{t("targetPlatforms")}</span>
          <div className="chip-grid platforms">
            {PLATFORMS.map((platform) => {
              const on = platforms.includes(platform.id);
              return (
                <button
                  key={platform.id}
                  type="button"
                  className={on ? "on" : ""}
                  aria-pressed={on}
                  onClick={() => setPlatforms((prev) => (on ? prev.filter((id) => id !== platform.id) : [...prev, platform.id]))}
                >
                  {t(`platform_${platform.id}`)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="field">
          <span className="field-label">{t("selectBy")}</span>
          <Segmented
            value={selectType}
            onChange={setSelectType}
            options={[
              { value: "all", label: t("selectAll") },
              { value: "range", label: t("selectRange") },
              { value: "keys", label: t("selectPick") },
              { value: "nextN", label: t("selectNext") },
            ]}
          />
        </div>
        {selectType === "range" ? (
          <div className="pair">
            <Field label={t("from")}>
              <input type="number" min={1} max={units.length || 1} value={rangeFrom} onChange={(e) => setRangeFrom(clampRange(Number(e.target.value) || 1))} />
            </Field>
            <Field label={t("to")}>
              <input type="number" min={1} max={units.length || 1} value={rangeTo} onChange={(e) => setRangeTo(clampRange(Number(e.target.value) || 1))} />
            </Field>
          </div>
        ) : null}
        {selectType === "nextN" ? (
          <Field label={t("nextCount")}>
            <input type="number" min={1} max={2000} value={nextN} onChange={(e) => setNextN(Math.max(1, Number(e.target.value) || 1))} />
          </Field>
        ) : null}
        {selectType === "keys" ? (
          <div className="pick-list" role="group" aria-label={t("selectPick")}>
            {units.map((unit) => {
              const on = picked.includes(unit.key);
              return (
                <label key={unit.key}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => setPicked((prev) => (on ? prev.filter((key) => key !== unit.key) : [...prev, unit.key]))}
                  />
                  <span>{unit.label}</span>
                </label>
              );
            })}
          </div>
        ) : null}
        <label className="switch-row">
          <span>{t("regenerateDone")}</span>
          <input type="checkbox" role="switch" className="switch" checked={regenerate} onChange={(e) => setRegenerate(e.target.checked)} />
        </label>
        <p className="field-hint">
          {regenerate && selectType !== "nextN"
            ? t("willQueueAll", { n: plan.queue.length })
            : t("willQueue", { n: plan.queue.length, skipped: plan.skipped })}
        </p>
        {error ? <p className="notice error">{error}</p> : null}
        <div className="auto-start">
          <button type="button" className="btn btn-primary" disabled={busy || !divisions} onClick={() => void start()}>
            {t("startSeries")}
          </button>
          {id ? (
            <button type="button" className="btn btn-quiet danger" onClick={() => void remove()}>
              {t("deleteSeries")}
            </button>
          ) : null}
        </div>
      </aside>
      <div className="auto-main">
        <EditorStoreContext.Provider value={store}>
          <Editor variant="template" />
        </EditorStoreContext.Provider>
      </div>
    </div>
  );
}
