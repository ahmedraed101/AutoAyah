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
  if (mode === "mushafPage") return ["mushafLayout"];
  if (mode === "wordHighlight") return ["wordTimings"];
  return [];
}

export function canUseMode(mode: string, caps: Capabilities): boolean {
  return modeRequires(mode).every((k) => caps[k]);
}
