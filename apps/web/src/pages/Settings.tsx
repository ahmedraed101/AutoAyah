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
    <div key={k} className="key-row">
      <label className="field">
        <span className="field-label">
          {label}
          {savedKeys[k] ? <span className="pill">{t("keySaved")}</span> : null}
        </span>
        <input
          type={secret ? "password" : "text"}
          value={keys[k]}
          autoComplete="off"
          spellCheck={false}
          dir="ltr"
          onChange={(e) => setKeys({ ...keys, [k]: e.target.value })}
          placeholder={savedKeys[k] ? "••••••••" : ""}
        />
      </label>
      {savedKeys[k] ? (
        <button type="button" className="btn btn-quiet danger" onClick={() => void clearKey(k)}>
          {t("delete")}
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t("settings")}</h1>
      </header>

      <section className="section">
        <h2>{t("apiKeys")}</h2>
        <p className="page-intro">{browser ? t("keysBrowser") : t("keysServer")}</p>
        <div className="fields">
          {field("pexels", "Pexels")}
          {field("unsplash", "Unsplash")}
          {field("pixabay", "Pixabay")}
          {field("freesound", "Freesound")}
        </div>
      </section>

      <section className="section">
        <h2>
          {t("qfConnect")}
          {appConfig?.qfConnected ? <span className="pill ok">{t("connected")}</span> : null}
        </h2>
        <p className="page-intro">{t("qfIntro")}</p>
        <div className="fields">
          {field("qfClientId", "Client ID", false)}
          {field("qfClientSecret", "Client Secret")}
        </div>
        <div className="btn-row">
          <button type="button" className="btn btn-quiet" onClick={() => void testQf().catch((e: Error) => setQfMsg(e.message))}>
            {t("testConnection")}
          </button>
        </div>
        {qfMsg ? <p className="notice">{qfMsg}</p> : null}
      </section>

      <div className="save-bar">
        {status ? <span className="field-hint">{status}</span> : <span />}
        <button type="button" className="btn btn-primary" onClick={() => void save().catch((e: Error) => setStatus(e.message))}>
          {t("save")}
        </button>
      </div>
    </div>
  );
}
