export type Capabilities = {
  wordTimings: boolean;
  mushafLayout: boolean;
  fullTafsirCatalog: boolean;
  translations: boolean;
};

export const EMPTY_CAPABILITIES: Capabilities = {
  wordTimings: false,
  mushafLayout: false,
  fullTafsirCatalog: false,
  translations: false,
};

export function mergeCapabilities(...parts: Partial<Capabilities>[]): Capabilities {
  return {
    wordTimings: parts.some((p) => p.wordTimings),
    mushafLayout: parts.some((p) => p.mushafLayout),
    fullTafsirCatalog: parts.some((p) => p.fullTafsirCatalog),
    translations: parts.some((p) => p.translations),
  };
}

export function modeRequires(mode: string): (keyof Capabilities)[] {
  if (mode === "mushafPage" || mode === "mushafWords") return ["mushafLayout"];
  if (mode === "wordHighlight") return ["wordTimings"];
  return [];
}

/** Modes that highlight words as they are recited; they need real word timings from the reciter. */
export const needsWordTimings = (mode: string) => mode === "wordHighlight" || mode === "mushafWords";

/** The same view without word highlighting, for reciters that have no word timings. */
export const withoutWordHighlight = <M extends string>(mode: M) =>
  (mode === "mushafWords" ? "mushafPage" : mode === "wordHighlight" ? "ayah" : mode) as M;

export function canUseMode(mode: string, caps: Capabilities): boolean {
  return modeRequires(mode).every((k) => caps[k]);
}
