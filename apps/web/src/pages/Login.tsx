import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { Rosette } from "../components/Icon";

export function Login({ onOk }: { onOk: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();

  return (
    <form
      className="login"
      onSubmit={(e) => {
        e.preventDefault();
        void api
          .login(password)
          .then(onOk)
          .catch((err: Error) => setError(err.message));
      }}
    >
      <div className="brand">
        <Rosette size={34} />
        <span>{t("brand")}</span>
      </div>
      <label className="field">
        <span className="field-label">{t("password")}</span>
        <input type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error ? <p className="notice error">{error}</p> : null}
      <button type="submit" className="btn btn-primary">
        {t("login")}
      </button>
    </form>
  );
}
