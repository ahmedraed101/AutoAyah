import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEditor } from "../store";
import { Icon, type IconName } from "./Icon";

export function Layout() {
  const { t, i18n } = useTranslation();
  const { appConfig, theme, setTheme, lang, setLang } = useEditor();
  const { pathname } = useLocation();

  const links: { to: string; label: string; icon: IconName }[] = [
    { to: "/", label: t("editor"), icon: "create" },
    { to: "/projects", label: t("projects"), icon: "projects" },
    { to: "/renders", label: t("renders"), icon: "renders" },
    ...(appConfig?.showDownloads ? [{ to: "/downloads", label: t("downloads"), icon: "library" as const }] : []),
    { to: "/settings", label: t("settings"), icon: "settings" },
  ];

  const toggles = (
    <div className="shell-toggles">
      <button
        type="button"
        className="icon-btn"
        aria-label={theme === "dark" ? t("light") : t("dark")}
        title={theme === "dark" ? t("light") : t("dark")}
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      >
        <Icon name={theme === "dark" ? "sun" : "moon"} size={20} />
      </button>
      <button
        type="button"
        className="icon-btn lang-btn"
        aria-label={t("language")}
        onClick={() => {
          const next = lang === "en" ? "ar" : "en";
          setLang(next);
          void i18n.changeLanguage(next);
        }}
      >
        {lang === "en" ? "ع" : "EN"}
      </button>
    </div>
  );

  return (
    <div className={pathname === "/" ? "shell shell--editor" : "shell"}>
      <header className="shell-bar">
        <div className="brand">
          <img className="brand-mark" src="/icon.svg" alt="" width={28} height={28} />
          <span>{t("brand")}</span>
        </div>
        {toggles}
      </header>

      <nav className="shell-nav" aria-label={t("brand")}>
        <div className="brand rail-only">
          <img className="brand-mark" src="/icon.svg" alt="" width={32} height={32} />
        </div>
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.to === "/"} className="nav-item">
            <Icon name={l.icon} />
            <span>{l.label}</span>
          </NavLink>
        ))}
        <div className="rail-only rail-foot">{toggles}</div>
      </nav>

      <div className="shell-main">
        <Outlet />
      </div>
    </div>
  );
}
