import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { Icon } from "../components/Icon";

type Item = { key: string; kind: string; size: number; source: string; lastUsed: string };

const formatBytes = (n: number) => (n > 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`);

export function Downloads() {
  const { t } = useTranslation();
  const [items, setItems] = useState<Item[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [error, setError] = useState<string>();

  const load = async () => {
    try {
      const data = await api.library();
      setItems(data.items);
      setTotalBytes(data.totalBytes);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const onImport = async (file: File) => {
    await api.importLibrary(file);
    setError(undefined);
    await load();
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t("downloads")}</h1>
        <label className="btn btn-quiet">
          <Icon name="upload" size={18} />
          {t("importQul")}
          <input
            type="file"
            accept=".json,.sqlite,.db,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void onImport(f).catch((err: Error) => setError(err.message));
            }}
          />
        </label>
      </header>
      <p className="page-intro">{t("libraryIntro")}</p>
      <p className="usage">{t("cached", { size: formatBytes(totalBytes), n: items.length })}</p>
      {error ? <p className="notice error">{error}</p> : null}
      <ul className="list">
        {items.map((i) => (
          <li key={i.key} className="list-item">
            <div className="list-main">
              <span className="file-key" dir="ltr">
                {i.key}
              </span>
              <span className="surah-meta">
                {i.kind} · {i.source} · {formatBytes(i.size)} · {new Date(i.lastUsed).toLocaleDateString()}
              </span>
            </div>
            <div className="list-actions">
              <button
                type="button"
                className="btn btn-quiet danger"
                aria-label={t("delete")}
                onClick={() => void api.deleteLibrary(i.key).then(load).catch((e: Error) => setError(e.message))}
              >
                <Icon name="trash" size={18} />
                <span className="label-wide">{t("delete")}</span>
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
