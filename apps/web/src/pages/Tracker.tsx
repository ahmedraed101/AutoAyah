import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { VideoConfigSchema, type Series, type SeriesUnitView } from "@autoayah/core";
import { api } from "../api";
import { downloadName, useCaption } from "../caption";
import { CaptionCopy } from "../components/Caption";
import { Icon } from "../components/Icon";
import { NeedsDb } from "../components/NeedsDb";
import { Empty, SurahLabel } from "../components/SurahLabel";
import { UploadTicks } from "../components/UploadTicks";
import { useEditor } from "../store";
import { localDigits } from "../surahs";

const fallbackConfig = VideoConfigSchema.parse({ surah: 1, from: 1, to: 1, reciter: "qdc-7" });

type View = "grid" | "book";
const storedView = (): View => (localStorage.getItem("aa-tracker-view") === "book" ? "book" : "grid");

function level(unit: SeriesUnitView, targets: string[]) {
  const have = new Set<string>(unit.uploads.map((upload) => upload.platform));
  const wanted = targets.filter((id) => have.has(id)).length;
  if (!targets.length) return unit.uploads.length ? "all" : "none";
  if (!wanted) return "none";
  return wanted === targets.length ? "all" : "some";
}

export function Tracker() {
  return (
    <NeedsDb>
      <TrackerBody />
    </NeedsDb>
  );
}

function TrackerBody() {
  const { t } = useTranslation();
  const { lang } = useEditor();
  const [params, setParams] = useSearchParams();
  const [series, setSeries] = useState<Series[]>([]);
  const [units, setUnits] = useState<SeriesUnitView[]>([]);
  const [view, setView] = useState<View>(storedView);
  const [juz, setJuz] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);

  const requested = params.get("series");
  const current = series.find((item) => item.id === requested) ?? null;

  useEffect(() => {
    void api.series().then(setSeries).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!series.length || (requested && series.some((item) => item.id === requested))) return;
    setParams({ series: series[0]!.id }, { replace: true });
  }, [series, requested, setParams]);

  useEffect(() => {
    setUnits([]);
    setSelected(null);
  }, [current?.id]);

  useEffect(() => {
    if (!current) return;
    let live = true;
    api
      .seriesUnits(current.id)
      .then((res) => {
        if (!live) return;
        setUnits(res.units);
        setError(undefined);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [current?.id, tick]);

  const live = units.some((unit) => unit.status === "queued" || unit.status === "rendering");
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, [live]);

  const done = units.filter((unit) => unit.status === "done" || unit.status === "removed").length;
  const uploaded = units.filter((unit) => level(unit, current?.platforms ?? []) === "all").length;
  const unit = units.find((item) => item.key === selected) ?? null;
  const juzList = useMemo(() => [...new Set(units.map((item) => item.juz))].sort((a, b) => a - b), [units]);
  const juzIndex = juzList.indexOf(juz);
  const inJuz = units.filter((item) => item.juz === juz);
  const mid = Math.ceil(inJuz.length / 2);

  useEffect(() => {
    const first = juzList[0];
    if (first != null && !juzList.includes(juz)) setJuz(first);
  }, [juzList, juz]);

  const choose = (id: string) => {
    sessionStorage.setItem("aa-series", id);
    setSelected(null);
    setJuz(1);
    setParams({ series: id });
  };

  const tile = (item: SeriesUnitView) => {
    const text = /^\d+$/.test(item.label) ? localDigits(Number(item.label), lang) : item.label;
    const pct = item.status === "queued" || item.status === "rendering" ? Math.round((item.job?.progress ?? 0) * 100) : null;
    return (
      <button
        key={item.key}
        type="button"
        className={`unit-tile st-${item.status} up-${level(item, current?.platforms ?? [])}${item.key === selected ? " on" : ""}`}
        aria-pressed={item.key === selected}
        onClick={() => setSelected((key) => (key === item.key ? null : item.key))}
      >
        <span>{text}</span>
        {pct != null ? <small>{pct}%</small> : null}
      </button>
    );
  };

  return (
    <div className="page wide">
      <header className="page-head">
        <h1>{t("tracker")}</h1>
        <div className="tracker-tools">
          {series.length ? (
            <span className="select">
              <select aria-label={t("series")} value={current?.id ?? ""} onChange={(e) => choose(e.target.value)}>
                {series.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </span>
          ) : null}
          <div className="views" role="radiogroup" aria-label={t("tracker")}>
            {(["grid", "book"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={view === mode}
                className={view === mode ? "on" : ""}
                onClick={() => {
                  setView(mode);
                  localStorage.setItem("aa-tracker-view", mode);
                }}
              >
                {t(mode === "grid" ? "gridView" : "bookView")}
              </button>
            ))}
          </div>
        </div>
      </header>
      {error ? <p className="notice error">{error}</p> : null}
      {current ? (
        <p className="usage">
          {t("progressDone", { done, total: units.length })}
          {" · "}
          {t("progressUploaded", { n: uploaded, total: units.length })}
        </p>
      ) : null}
      {!series.length ? (
        <Empty
          title={t("noSeries")}
          hint={t("noSeriesHint")}
          action={
            <Link className="btn btn-primary" to="/automation">
              {t("automation")}
            </Link>
          }
        />
      ) : (
        <div className={unit ? "tracker-layout has-panel" : "tracker-layout"}>
          <div>
            {view === "grid" ? (
              <div className={`unit-grid${units.some((item) => item.label.length > 3) ? " wide-tiles" : ""}`}>{units.map(tile)}</div>
            ) : (
              <div className="book">
                <button type="button" className="btn btn-quiet" disabled={juzIndex <= 0} onClick={() => setJuz(juzList[juzIndex - 1]!)}>
                  {t("bookPrev")}
                </button>
                <div>
                  <p className="book-title">{t("juzSpread", { n: localDigits(juz, lang) })}</p>
                  <div className="book-spread" dir="rtl">
                    <div className="book-page">{inJuz.slice(0, mid).map(tile)}</div>
                    <div className="book-page">{inJuz.slice(mid).map(tile)}</div>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={juzIndex < 0 || juzIndex >= juzList.length - 1}
                  onClick={() => setJuz(juzList[juzIndex + 1]!)}
                >
                  {t("bookNext")}
                </button>
              </div>
            )}
          </div>
          {unit && current ? <UnitPanel seriesId={current.id} targets={current.platforms} unit={unit} onRefresh={() => setTick((n) => n + 1)} onClose={() => setSelected(null)} /> : null}
        </div>
      )}
    </div>
  );
}

function UnitPanel({
  seriesId,
  targets,
  unit,
  onRefresh,
  onClose,
}: {
  seriesId: string;
  targets: string[];
  unit: SeriesUnitView;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const config = unit.job?.config;
  const caption = useCaption(config ?? fallbackConfig);
  const active = unit.status === "queued" || unit.status === "rendering";
  const again = unit.status === "done" || unit.status === "failed" || unit.status === "cancelled" || unit.status === "removed";
  const run = async () => {
    if (again && unit.uploads.length && !confirm(t("regenerateUploadedConfirm"))) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.runSeries(seriesId, {
        select: { type: "keys", keys: [unit.key] },
        regenerate: again,
      });
      if (result.failed) setError(t("failedSome", { n: result.failed, error: result.errors.join(" ") }));
      else if (!result.queued && result.unchanged) setError(t("alreadyUpToDate"));
      onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="unit-panel">
      <div className="unit-panel-head">
        <strong>{unit.label}</strong>
        <button type="button" className="icon-btn" aria-label={t("close")} onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>
      {config ? <SurahLabel config={config} meta={<span className={`status s-${unit.status}`}>{t(`status_${unit.status}`)}</span>} /> : null}
      {unit.job?.outputUrl && /\.(mp4|webm)$/.test(unit.job.outputUrl) ? <video src={unit.job.outputUrl} controls playsInline /> : null}
      {active ? (
        <span className="progress">
          <span style={{ width: `${Math.round((unit.job?.progress ?? 0) * 100)}%` }} />
        </span>
      ) : null}
      {unit.status === "removed" ? <p className="notice">{t("videoRemoved")}</p> : null}
      {unit.job?.error ? <p className="notice error">{unit.job.error}</p> : null}
      <div className="btn-row">
        {unit.job?.outputUrl && config ? (
          <a className="btn btn-quiet" href={unit.job.outputUrl} download={downloadName(caption.title, unit.job.outputUrl)}>
            <Icon name="download" size={18} />
            {t("download")}
          </a>
        ) : null}
        <button type="button" className="btn btn-primary" disabled={busy || active} onClick={() => void run()}>
          {unit.status === "none" ? t("generateUnit") : t("regenerateUnit")}
        </button>
      </div>
      {config ? <CaptionCopy config={config} /> : null}
      <UploadTicks
        jobId={unit.status === "done" || unit.status === "removed" ? unit.jobId : null}
        uploads={unit.uploads}
        targets={targets}
        onChange={onRefresh}
      />
      {error ? <p className="notice error">{error}</p> : null}
    </aside>
  );
}
