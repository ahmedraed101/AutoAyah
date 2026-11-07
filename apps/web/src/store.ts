import { create } from "zustand";
import { VideoConfigSchema, canUseMode, spansSurahs, type AppConfig, type VideoConfig } from "@autoayah/core";

/** `surah` and `reciter` are placeholders until the user picks them (see `missing`). */
const defaultConfig = VideoConfigSchema.parse({
  surah: 1,
  from: 1,
  to: 1,
  reciter: "qdc-7",
  mode: "mushafPage",
  aspectRatio: "9:16",
});

export type Missing = { surah: boolean; reciter: boolean };

export type Panel = "ayat" | "recitation" | "look" | "background";

type State = {
  config: VideoConfig;
  /** Message from the last rejected edit (the config keeps its previous valid value). */
  configError?: string;
  /** Choices the user hasn't made yet: the surah gates the view, the reciter gates playing and rendering. */
  missing: Missing;
  projectName: string;
  projectId?: string;
  appConfig?: AppConfig;
  theme: "dark" | "light";
  lang: "en" | "ar";
  /** `ayahKey(surah, ayah)` of the ayah picked on the timeline. */
  selectedAyah?: string;
  panel: Panel;
  /** Returns false (and sets `configError`) when the result is not a valid config. */
  setConfig: (patch: Partial<VideoConfig>) => boolean;
  setNested: <K extends keyof VideoConfig>(key: K, value: VideoConfig[K]) => void;
  setPanel: (p: Panel) => void;
  setTheme: (t: "dark" | "light") => void;
  setLang: (l: "en" | "ar") => void;
  setAppConfig: (c: AppConfig) => void;
  setProject: (name: string, id?: string) => void;
  setSelectedAyah: (key?: string) => void;
};

/** Keep the ayah range valid while the user types: from ≤ to (within one surah), both ≥ 1. */
function normalize(prev: VideoConfig, next: VideoConfig): VideoConfig {
  const from = Math.max(1, Math.floor(Number(next.from) || 1));
  let to = Math.max(1, Math.floor(Number(next.to) || from));
  if (spansSurahs(next)) return { ...next, from, to };
  if (next.from !== prev.from && to < from) to = from;
  return { ...next, from: Math.min(from, to), to };
}

function apply(s: State, next: VideoConfig, patch: Partial<VideoConfig> = {}): Partial<State> {
  const parsed = VideoConfigSchema.safeParse(normalize(s.config, next));
  if (!parsed.success) return { configError: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const missing = { surah: s.missing.surah && !("surah" in patch), reciter: s.missing.reciter && !("reciter" in patch) };
  const c = parsed.data;
  const sameRange = c.surah === s.config.surah && c.from === s.config.from && c.to === s.config.to && c.toSurah === s.config.toSurah;
  return { config: c, configError: undefined, missing, ...(sameRange ? {} : { selectedAyah: undefined }) };
}

const stored = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  const v = localStorage.getItem(key) as T | null;
  return v && allowed.includes(v) ? v : fallback;
};

export const useEditor = create<State>((set, get) => ({
  config: defaultConfig,
  missing: { surah: true, reciter: true },
  projectName: "Untitled",
  theme: stored("aa-theme", ["dark", "light"] as const, "dark"),
  lang: stored("aa-lang", ["en", "ar"] as const, "ar"),
  panel: "ayat",
  setConfig: (patch) => {
    set((s) => apply(s, { ...s.config, ...patch }, patch));
    return !get().configError;
  },
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
  setAppConfig: (appConfig) =>
    set((s) => (canUseMode(s.config.mode, appConfig.capabilities) ? { appConfig } : { appConfig, config: { ...s.config, mode: "ayah" } })),
  setProject: (projectName, projectId) => set({ projectName, projectId }),
  setSelectedAyah: (selectedAyah) => set({ selectedAyah }),
}));
