import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Project } from "@autoayah/core";
import { api } from "../api";
import { browserStore } from "../browserStore";
import { ConfigSummary, useDifferences } from "../components/ConfigSummary";
import { Icon } from "../components/Icon";
import { Empty, SurahLabel } from "../components/SurahLabel";
import { useEditor } from "../store";

export function Projects() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { appConfig, setConfig, setProject } = useEditor();
  const browser = appConfig?.storageMode === "browser";
  const [items, setItems] = useState<Project[]>([]);
  const [error, setError] = useState<string>();

  const load = async () => {
    try {
      setItems(browser ? await browserStore.listProjects() : await api.projects());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    if (appConfig) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appConfig?.storageMode]);

  const differences = useDifferences(items.map((p) => p.config));
  const open = (p: Project) => {
    if (!setConfig(p.config)) {
      setError(useEditor.getState().configError);
      return;
    }
    setProject(p.name, p.id);
    nav("/");
  };

  const remove = async (id: string) => {
    if (browser) await browserStore.deleteProject(id);
    else await api.deleteProject(id);
    await load();
  };

  const onImport = async (file: File) => {
    const p = browserStore.importProject(await file.text());
    if (browser) await browserStore.saveProject(p);
    else await api.saveProject(p);
    setError(undefined);
    await load();
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t("projects")}</h1>
        <label className="btn btn-quiet">
          <Icon name="upload" size={18} />
          {t("importJson")}
          <input
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void onImport(f).catch((err: Error) => setError(err.message));
            }}
          />
        </label>
      </header>
      {error ? <p className="notice error">{error}</p> : null}
      <ul className="list">
        {items.map((p) => (
          <li key={p.id} className="list-item">
            <button type="button" className="list-main" onClick={() => open(p)}>
              <SurahLabel config={p.config} meta={new Date(p.updatedAt).toLocaleDateString()} />
              <ConfigSummary config={p.config} differs={differences(p.config)} />
            </button>
            <div className="list-actions">
              <a
                className="btn btn-quiet"
                href={`data:application/json,${encodeURIComponent(browserStore.exportProject(p))}`}
                download={`${p.name}.autoayah.json`}
                aria-label={t("export")}
              >
                <Icon name="download" size={18} />
                <span className="label-wide">{t("export")}</span>
              </a>
              <button
                type="button"
                className="btn btn-quiet danger"
                aria-label={t("delete")}
                onClick={() => void remove(p.id).catch((e: Error) => setError(e.message))}
              >
                <Icon name="trash" size={18} />
                <span className="label-wide">{t("delete")}</span>
              </button>
            </div>
          </li>
        ))}
      </ul>
      {!items.length ? (
        <Empty
          title={t("noProjects")}
          hint={t("noProjectsHint")}
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
