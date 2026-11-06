import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Job } from "@autoayah/core";
import { api } from "../api";

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

  const act = (p: Promise<unknown>) => void p.then(load).catch((e: Error) => setError(e.message));

  return (
    <div className="page">
      <h1>{t("renders")}</h1>
      {error ? <p className="error">{error}</p> : null}
      {jobs.map((j) => (
        <div key={j.id} className="card">
          <div className="list-row">
            <strong className="grow">
              {j.config.surah}:{j.config.from}-{j.config.to} · {t(j.config.mode)} · {j.config.export.toUpperCase()}
            </strong>
            <span className="muted">
              {j.status} · {new Date(j.createdAt).toLocaleString()}
            </span>
          </div>
          {ACTIVE.has(j.status) ? (
            <div className="progress" style={{ marginTop: 8 }}>
              <span style={{ width: `${Math.round(j.progress * 100)}%` }} />
            </div>
          ) : null}
          {j.error ? <p className="error">{j.error}</p> : null}
          <div className="list-row" style={{ marginTop: 8 }}>
            {j.outputUrl ? (
              <a href={j.outputUrl} download>
                {t("download")}
              </a>
            ) : null}
            <span className="grow" />
            {ACTIVE.has(j.status) ? (
              <button type="button" className="secondary" onClick={() => act(api.cancelJob(j.id))}>
                {t("cancel")}
              </button>
            ) : null}
            {j.status === "failed" || j.status === "cancelled" ? (
              <button type="button" onClick={() => act(api.retryJob(j.id))}>
                {t("retry")}
              </button>
            ) : null}
            {!ACTIVE.has(j.status) ? (
              <button type="button" className="secondary" onClick={() => act(api.deleteJob(j.id))}>
                {t("delete")}
              </button>
            ) : null}
          </div>
        </div>
      ))}
      {!jobs.length ? <p className="muted">{t("noRenders")}</p> : null}
    </div>
  );
}
