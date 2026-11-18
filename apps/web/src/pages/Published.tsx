import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PLATFORMS, type Job, type PlatformId, type Upload } from "@autoayah/core";
import { api } from "../api";
import { downloadName, useCaption } from "../caption";
import { CaptionCopy } from "../components/Caption";
import { Icon } from "../components/Icon";
import { NeedsDb } from "../components/NeedsDb";
import { Empty, SurahLabel } from "../components/SurahLabel";
import { UploadTicks } from "../components/UploadTicks";

type Row = { job: Job; uploads: Upload[] };
type Filter = "all" | "none" | "missing";

export function Published() {
  return (
    <NeedsDb>
      <PublishedBody />
    </NeedsDb>
  );
}

function PublishedBody() {
  const { t } = useTranslation();
  const [items, setItems] = useState<Row[]>([]);
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState<Filter>("all");
  const [platform, setPlatform] = useState<PlatformId>("youtube");

  const load = () =>
    void api
      .published()
      .then((res) => {
        setItems(res.items);
        setError(undefined);
      })
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  const shown = items.filter((row) => {
    if (filter === "none") return row.uploads.length === 0;
    if (filter === "missing") return !row.uploads.some((upload) => upload.platform === platform);
    return true;
  });

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t("published")}</h1>
      </header>
      <p className="page-intro">{t("noPublishedHint")}</p>
      <div className="tracker-tools">
        <span className="select">
          <select aria-label={t("filterAll")} value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="all">{t("filterAll")}</option>
            <option value="none">{t("notUploaded")}</option>
            <option value="missing">{t("missingPlatform")}</option>
          </select>
        </span>
        {filter === "missing" ? (
          <span className="select">
            <select aria-label={t("missingPlatform")} value={platform} onChange={(e) => setPlatform(e.target.value as PlatformId)}>
              {PLATFORMS.map((item) => (
                <option key={item.id} value={item.id}>
                  {t(`platform_${item.id}`)}
                </option>
              ))}
            </select>
          </span>
        ) : null}
      </div>
      {error ? <p className="notice error">{error}</p> : null}
      <ul className="list">
        {shown.map((row) => (
          <PublishedRow key={row.job.id} row={row} onChange={load} />
        ))}
      </ul>
      {!shown.length ? (
        <Empty
          title={t("noPublished")}
          hint={items.length ? undefined : t("noPublishedHint")}
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

function PublishedRow({ row, onChange }: { row: Row; onChange: () => void }) {
  const { t } = useTranslation();
  const caption = useCaption(row.job.config);
  return (
    <li className="list-item render">
      <div className="list-main">
        <SurahLabel
          config={row.job.config}
          meta={
            <>
              {t(row.job.config.mode)} · {row.job.config.aspectRatio}
            </>
          }
        />
        <CaptionCopy config={row.job.config} />
        <UploadTicks jobId={row.job.id} uploads={row.uploads} onChange={onChange} />
      </div>
      {row.job.outputUrl ? (
        <div className="list-actions">
          <a className="btn btn-quiet accent" href={row.job.outputUrl} download={downloadName(caption.title, row.job.outputUrl)}>
            <Icon name="download" size={18} />
            <span className="label-wide">{t("download")}</span>
          </a>
        </div>
      ) : null}
    </li>
  );
}
