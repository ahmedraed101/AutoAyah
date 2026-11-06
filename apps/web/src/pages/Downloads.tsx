import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";

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
      <h1>{t("downloads")}</h1>
      <p className="muted">Recitations, texts and media are cached locally as you use the app. Import QUL JSON/SQLite files here.</p>
      {error ? <p className="error">{error}</p> : null}
      <p>
        {formatBytes(totalBytes)} · {items.length}
      </p>
      <label className="button secondary" style={{ display: "inline-flex", marginBottom: "0.75rem" }}>
        Import QUL file
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
      {items.map((i) => (
        <div key={i.key} className="card list-row">
          <div className="grow">
            <strong style={{ wordBreak: "break-all" }}>{i.key}</strong>
            <p className="muted">
              {i.kind} · {i.source} · {formatBytes(i.size)} · {new Date(i.lastUsed).toLocaleString()}
            </p>
          </div>
          <button
            type="button"
            className="secondary"
            onClick={() => void api.deleteLibrary(i.key).then(load).catch((e: Error) => setError(e.message))}
          >
            {t("delete")}
          </button>
        </div>
      ))}
    </div>
  );
}
