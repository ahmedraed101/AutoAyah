import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Project } from "@autoayah/core";
import { api } from "../api";
import { browserStore } from "../browserStore";
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

  const open = (p: Project) => {
    setConfig(p.config);
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
      <h1>{t("projects")}</h1>
      {error ? <p className="error">{error}</p> : null}
      <label className="button secondary" style={{ display: "inline-flex", marginBottom: "0.75rem" }}>
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
      {items.map((p) => (
        <div key={p.id} className="card list-row">
          <div className="grow">
            <strong>{p.name}</strong>
            <p className="muted">
              {p.config.surah}:{p.config.from}-{p.config.to} · {t(p.config.mode)} · {new Date(p.updatedAt).toLocaleString()}
            </p>
          </div>
          <button type="button" onClick={() => open(p)}>
            {t("open")}
          </button>
          <a href={`data:application/json,${encodeURIComponent(browserStore.exportProject(p))}`} download={`${p.name}.autoayah.json`}>
            {t("export")}
          </a>
          <button type="button" className="secondary" onClick={() => void remove(p.id).catch((e: Error) => setError(e.message))}>
            {t("delete")}
          </button>
        </div>
      ))}
      {!items.length ? <p className="muted">{t("noProjects")}</p> : null}
    </div>
  );
}
