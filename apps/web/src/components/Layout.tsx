import { NavLink, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEditor } from "../store";

export function Layout() {
  const { t, i18n } = useTranslation();
  const { appConfig, theme, setTheme, lang, setLang } = useEditor();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">{t("brand")}</div>
        <nav>
          <NavLink to="/" end>
            {t("editor")}
          </NavLink>
          <NavLink to="/projects">{t("projects")}</NavLink>
          <NavLink to="/renders">{t("renders")}</NavLink>
          {appConfig?.showDownloads ? <NavLink to="/downloads">{t("downloads")}</NavLink> : null}
          <NavLink to="/settings">{t("settings")}</NavLink>
        </nav>
        <button
          className="secondary"
          type="button"
          onClick={() => {
            const next = theme === "dark" ? "light" : "dark";
            setTheme(next);
          }}
        >
          {theme === "dark" ? t("light") : t("dark")}
        </button>
        <button
          className="secondary"
          type="button"
          onClick={() => {
            const next = lang === "en" ? "ar" : "en";
            setLang(next);
            void i18n.changeLanguage(next);
          }}
        >
          {lang === "en" ? "عربي" : "EN"}
        </button>
      </header>
      <Outlet />
    </div>
  );
}
