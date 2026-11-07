import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "@fontsource-variable/readex-pro";
import "./i18n";
import "./styles.css";
import { api } from "./api";
import { Layout } from "./components/Layout";
import { Downloads } from "./pages/Downloads";
import { Editor } from "./pages/Editor";
import { Login } from "./pages/Login";
import { Projects } from "./pages/Projects";
import { Renders } from "./pages/Renders";
import { Settings } from "./pages/Settings";
import { useEditor } from "./store";

function App() {
  const { setAppConfig, setTheme, setLang, lang, theme } = useEditor();
  const [ready, setReady] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [theme, lang]);

  useEffect(() => {
    void (async () => {
      try {
        const auth = await api.authStatus();
        if (auth.required && !auth.authenticated) {
          setNeedLogin(true);
          setReady(true);
          return;
        }
        const cfg = await api.config();
        setAppConfig(cfg);
        setReady(true);
      } catch (e) {
        console.error(e);
        setReady(true);
      }
    })();
  }, [setAppConfig, setTheme, setLang]);

  if (!ready)
    return (
      <div className="boot" aria-label="Loading">
        <img className="brand-mark" src="/icon.svg" alt="" width={48} height={48} />
      </div>
    );
  if (needLogin) {
    return (
      <Login
        onOk={() => {
          setNeedLogin(false);
          void api.config().then(setAppConfig);
        }}
      />
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Editor />} />
          <Route path="projects" element={<Projects />} />
          <Route path="renders" element={<Renders />} />
          <Route path="downloads" element={<Downloads />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
