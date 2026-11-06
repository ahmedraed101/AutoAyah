import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Job } from "@autoayah/core";
import { api } from "../api";
import { ConfigSummary, useDifferences } from "../components/ConfigSummary";
import { Icon } from "../components/Icon";
import { Empty, SurahLabel } from "../components/SurahLabel";

const ACTIVE = new Set(["queued", "rendering"]);

export function Renders() {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string>();

  const load = () =>
    void api
      .jobs()
      .then((j) => {
        setJobs(j);
        setError(undefined);
      })
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  const differences = useDifferences(jobs.map((j) => j.config));
  const act = (p: Promise<unknown>) => void p.then(load).catch((e: Error) => setError(e.message));

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t("renders")}</h1>
      </header>
      {error ? <p className="notice error">{error}</p> : null}
      <ul className="list">
        {jobs.map((j) => (
          <li key={j.id} className="list-item render">
            <div className="list-main">
              <SurahLabel
                config={j.config}
                meta={
                  <>
                    <span className={`status s-${j.status}`}>{t(`status_${j.status}`)}</span> ·{" "}
                    {new Date(j.createdAt).toLocaleString()}
                  </>
                }
              />
              <ConfigSummary config={j.config} differs={differences(j.config)} />
              {ACTIVE.has(j.status) ? (
                <span className="progress">
                  <span style={{ width: `${Math.round(j.progress * 100)}%` }} />
                </span>
              ) : null}
              {j.error ? <p className="notice error">{j.error}</p> : null}
            </div>
            <div className="list-actions">
              {j.outputUrl ? (
                <a className="btn btn-quiet accent" href={j.outputUrl} download aria-label={t("download")}>
                  <Icon name="download" size={18} />
                  <span className="label-wide">{t("download")}</span>
                </a>
              ) : null}
              {ACTIVE.has(j.status) ? (
                <button type="button" className="btn btn-quiet" onClick={() => act(api.cancelJob(j.id))}>
                  {t("cancel")}
                </button>
              ) : null}
              {j.status === "failed" || j.status === "cancelled" ? (
                <button type="button" className="btn btn-quiet" aria-label={t("retry")} onClick={() => act(api.retryJob(j.id))}>
                  <Icon name="retry" size={18} />
                  <span className="label-wide">{t("retry")}</span>
                </button>
              ) : null}
              {!ACTIVE.has(j.status) ? (
                <button type="button" className="btn btn-quiet danger" aria-label={t("delete")} onClick={() => act(api.deleteJob(j.id))}>
                  <Icon name="trash" size={18} />
                  <span className="label-wide">{t("delete")}</span>
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {!jobs.length ? (
        <Empty
          title={t("noRenders")}
          hint={t("noRendersHint")}
          action={
            <Link className="btn btn-primary" to="/">
              {t("goToEditor")}
            </Link>
          }
        />
      ) : null}
    </div>
  );
}
