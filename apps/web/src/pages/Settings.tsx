import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { browserStore } from "../browserStore";
import { useEditor } from "../store";

const EMPTY = { pexels: "", unsplash: "", pixabay: "", freesound: "", qfClientId: "", qfClientSecret: "" };
type KeyName = keyof typeof EMPTY;

export function Settings() {
  const { t } = useTranslation();
  const { appConfig, setAppConfig } = useEditor();
  const browser = appConfig?.storageMode === "browser";
  const [keys, setKeys] = useState(EMPTY);
  const [savedKeys, setSavedKeys] = useState<Partial<Record<KeyName, boolean>>>({});
  const [status, setStatus] = useState<string>();
  const [qfMsg, setQfMsg] = useState<string>();

  const loadStatus = async () => {
    if (browser) {
      const k = await browserStore.getKeys();
      setKeys((s) => ({ ...s, ...k }));
    } else {
      const s = await api.keysStatus();
      setSavedKeys(Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v === "boolean")) as Record<KeyName, boolean>);
    }
  };

  useEffect(() => {
    if (appConfig) void loadStatus().catch((e: Error) => setStatus(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appConfig?.storageMode]);

  const save = async () => {
    if (browser) await browserStore.setKeys(keys);
    else {
      // Blank fields keep the stored value; the server never returns secrets.
      await api.saveKeys(Object.fromEntries(Object.entries(keys).filter(([, v]) => v.trim())));
      setKeys(EMPTY);
      await loadStatus();
    }
    setAppConfig(await api.config());
    setStatus(t("saved"));
  };

  const clearKey = async (k: KeyName) => {
    if (browser) setKeys({ ...keys, [k]: "" });
    else {
      await api.saveKeys({ [k]: null });
      await loadStatus();
      setAppConfig(await api.config());
    }
  };

  const testQf = async () => {
    const r = await api.testQf({ qfClientId: keys.qfClientId || undefined, qfClientSecret: keys.qfClientSecret || undefined });
    setQfMsg(r.message);
  };

  const field = (k: KeyName, label: string, secret = true) => (
    <label key={k}>
      <span>
        {label} {savedKeys[k] ? <span className="warning">· {t("keySaved")}</span> : null}
      </span>
      <div className="row">
        <input
          type={secret ? "password" : "text"}
          value={keys[k]}
          autoComplete="off"
          onChange={(e) => setKeys({ ...keys, [k]: e.target.value })}
          placeholder={savedKeys[k] ? "••••••••" : ""}
        />
        {savedKeys[k] ? (
          <button type="button" className="secondary" style={{ flex: "0 0 auto" }} onClick={() => void clearKey(k)}>
            {t("delete")}
          </button>
        ) : null}
      </div>
    </label>
  );

  return (
    <div className="page">
      <h1>{t("settings")}</h1>
      <div className="card">
        <h3>{t("apiKeys")}</h3>
        <p className="muted">
          {browser
            ? "Keys are stored in this browser only and sent with each request that needs them."
            : "Keys are stored encrypted on this server."}
        </p>
        <div className="fields">
          {field("pexels", "Pexels")}
          {field("unsplash", "Unsplash")}
          {field("pixabay", "Pixabay")}
          {field("freesound", "Freesound")}
        </div>
      </div>
      <div className="card">
        <h3>{t("qfConnect")}</h3>
        <p className="muted">
          Unlocks word-highlight and Mushaf page modes. Prelive keys only cover Al-Fatiha and Al-Baqarah until production access is
          approved. You can also import QUL files on the Downloads page.
        </p>
        <div className="fields">
          {field("qfClientId", "Client ID", false)}
          {field("qfClientSecret", "Client Secret")}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button type="button" className="secondary" onClick={() => void testQf().catch((e: Error) => setQfMsg(e.message))}>
            {t("testConnection")}
          </button>
        </div>
        {qfMsg ? <p className="muted">{qfMsg}</p> : null}
        {appConfig?.qfConnected ? <p>{t("connected")}</p> : null}
      </div>
      <button type="button" onClick={() => void save().catch((e: Error) => setStatus(e.message))}>
        {t("save")}
      </button>
      {status ? <p className="muted">{status}</p> : null}
    </div>
  );
}
