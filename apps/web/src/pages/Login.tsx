import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";

export function Login({ onOk }: { onOk: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();

  return (
    <div className="page" style={{ maxWidth: 360, marginTop: "15vh" }}>
      <h1>{t("login")}</h1>
      <label>
        {t("password")}
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error ? <p className="error">{error}</p> : null}
      <button
        type="button"
        style={{ marginTop: 12 }}
        onClick={() =>
          void api
            .login(password)
            .then(onOk)
            .catch((e: Error) => setError(e.message))
        }
      >
        {t("login")}
      </button>
    </div>
  );
}
