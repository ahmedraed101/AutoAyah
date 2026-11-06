import { create } from "zustand";
import { VideoConfigSchema, type AppConfig, type VideoConfig } from "@autoayah/core";

const defaultConfig = VideoConfigSchema.parse({
  surah: 25,
  from: 7,
  to: 7,
  reciter: "qdc-7",
  tafsir: "ar.muyassar",
  mode: "ayahTafsir",
  aspectRatio: "9:16",
});

export type Panel = "content" | "mode" | "timing" | "style" | "background" | "audio";

type State = {
  config: VideoConfig;
  /** Message from the last rejected edit (the config keeps its previous valid value). */
  configError?: string;
  projectName: string;
  projectId?: string;
  appConfig?: AppConfig;
  theme: "dark" | "light";
  lang: "en" | "ar";
  selectedAyah?: number;
  panel: Panel;
  setConfig: (patch: Partial<VideoConfig>) => void;
  setNested: <K extends keyof VideoConfig>(key: K, value: VideoConfig[K]) => void;
  setPanel: (p: Panel) => void;
  setTheme: (t: "dark" | "light") => void;
  setLang: (l: "en" | "ar") => void;
  setAppConfig: (c: AppConfig) => void;
  setProject: (name: string, id?: string) => void;
  setSelectedAyah: (n?: number) => void;
};

/** Keep the ayah range valid while the user types: from ≤ to, both ≥ 1. */
function normalize(prev: VideoConfig, next: VideoConfig): VideoConfig {
  const from = Math.max(1, Math.floor(Number(next.from) || 1));
  let to = Math.max(1, Math.floor(Number(next.to) || from));
  if (next.from !== prev.from && to < from) to = from;
  return { ...next, from: Math.min(from, to), to };
}

function apply(s: State, next: VideoConfig): Partial<State> {
  const parsed = VideoConfigSchema.safeParse(normalize(s.config, next));
  if (!parsed.success) return { configError: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return { config: parsed.data, configError: undefined };
}

const stored = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  const v = localStorage.getItem(key) as T | null;
  return v && allowed.includes(v) ? v : fallback;
};

export const useEditor = create<State>((set) => ({
  config: defaultConfig,
  projectName: "Untitled",
  theme: stored("aa-theme", ["dark", "light"] as const, "dark"),
  lang: stored("aa-lang", ["en", "ar"] as const, "en"),
  panel: "content",
  setConfig: (patch) => set((s) => apply(s, { ...s.config, ...patch })),
  setNested: (key, value) => set((s) => apply(s, { ...s.config, [key]: value })),
  setPanel: (panel) => set({ panel }),
  setTheme: (theme) => {
    localStorage.setItem("aa-theme", theme);
    document.documentElement.dataset.theme = theme;
    set({ theme });
  },
  setLang: (lang) => {
    localStorage.setItem("aa-lang", lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    set({ lang });
  },
  setAppConfig: (appConfig) => set({ appConfig }),
  setProject: (projectName, projectId) => set({ projectName, projectId }),
  setSelectedAyah: (selectedAyah) => set({ selectedAyah }),
}));
