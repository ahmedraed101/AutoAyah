import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AMBIENCE_PRESETS, VideoConfigSchema, endSurah, isMushafMode, type VideoConfig } from "@autoayah/core";
import { entryName, useCatalog, type Catalog } from "../catalog";

type Fact = { key: string; text: string; title?: string; swatches?: string[] };

/** `always` facts are shown on every item; `extra` facts only appear when they tell siblings apart. */
function facts(raw: VideoConfig, catalog: Catalog, t: TFunction, lang: string): { always: Fact[]; extra: Fact[] } {
  const parsed = VideoConfigSchema.safeParse(raw);
  const c = parsed.success ? parsed.data : raw;
  const mushaf = isMushafMode(c.mode);
  const bg = c.backgrounds[0];
  const bgType = bg ? { color: t("solidColor"), gradient: t("gradient"), image: t("images"), video: t("videos") }[bg.type] : t("none");
  const ambience = AMBIENCE_PRESETS.find((a) => a.id === c.audio.ambienceId);
  const always: Fact[] = [
    { key: "mode", text: t(c.mode), title: t("mode") },
    { key: "aspect", text: c.aspectRatio, title: t("aspect") },
    { key: "reciter", text: entryName(catalog.reciters, c.reciter, lang), title: t("reciter") },
    { key: "tafsir", text: c.tafsir ? entryName(catalog.tafsirs, c.tafsir, lang) : `${t("tafsir")}: ${t("none")}`, title: t("tafsir") },
    ...(c.translation
      ? [{ key: "translation", text: entryName(catalog.translations, c.translation, lang), title: t("translation") }]
      : []),
    {
      key: "timing",
      text: c.timing.mode === "reading" ? `${t("reading")} · ${t(c.timing.readingSpeed)}` : t("continuous"),
      title: t("timing"),
    },
    { key: "theme", text: t(c.style.theme), title: t("theme") },
    ...(mushaf
      ? [
          { key: "paper", text: `${t("mushafPaper")}: ${t(`paper_${c.style.mushafPaper}`)}` },
          { key: "frame", text: `${t("mushafFrame")}: ${t(`frame_${c.style.mushafFrame}`)}` },
          { key: "view", text: `${t("mushafView")}: ${t(`mushafView_${c.style.mushafView ?? "page"}`)}` },
          ...(c.style.mushafHd ? [{ key: "hd", text: t("mushafHd") }] : []),
          ...(c.style.mushafCompact ? [{ key: "compact", text: t("mushafCompact") }] : []),
        ]
      : [{ key: "tajweed", text: c.style.tajweed ? t("tajweedColors") : t("noTajweed") }]),
    {
      key: "background",
      text: `${t("background")}: ${bgType}${c.backgrounds.length > 1 ? ` ×${c.backgrounds.length}` : ""}`,
      swatches: bg?.type === "color" && bg.color ? [bg.color] : bg?.type === "gradient" ? bg.gradient : undefined,
    },
    ...(ambience ? [{ key: "ambience", text: `${t("ambience")}: ${lang === "ar" ? ambience.nameAr : ambience.name}` }] : []),
    { key: "export", text: c.export.toUpperCase(), title: t("exportFormat") },
  ];
  const overrides = Object.keys(c.timing.ayahOverrides).length;
  const extra: Fact[] = [
    ...(c.translation ? [] : [{ key: "translation", text: `${t("translation")}: ${t("none")}` }]),
    ...(ambience ? [] : [{ key: "ambience", text: `${t("ambience")}: ${t("none")}` }]),
    { key: "transition", text: `${t("transition")}: ${t(`transition_${c.style.transition ?? "fade"}`)}` },
    { key: "fontSize", text: `${t("fontSize")}: ${c.style.fontSize}` },
    {
      key: "colors",
      text: t("colors"),
      swatches: [c.style.primaryColor, c.style.accentColor, c.style.cardColor, c.style.textColor, c.style.backgroundColor],
    },
    { key: "watermark", text: c.style.showWatermark ? `${t("watermark")}: ${c.style.watermarkText}` : `${t("watermark")}: ${t("none")}` },
    { key: "recitationVolume", text: `${t("recitationVolume")}: ${Math.round(c.audio.recitationVolume * 100)}%` },
    { key: "ambienceVolume", text: `${t("ambienceVolume")}: ${Math.round(c.audio.ambienceVolume * 100)}%` },
    { key: "bgSound", text: `${t("bgSound")}: ${c.audio.backgroundVideoSound ? Math.round(c.audio.backgroundVideoVolume * 100) + "%" : t("none")}` },
    { key: "holds", text: t("holdOverrides", { n: overrides }) },
    { key: "bgMedia", text: `${t("background")}: ${bg?.media?.photographer ?? bg?.media?.id ?? "—"}` },
  ];
  return { always, extra };
}

const factKey = (f: Fact) => `${f.text}|${f.swatches?.join(",") ?? ""}`;

const rangeKey = (c: VideoConfig) => `${c.surah}:${c.from}-${endSurah(c)}:${c.to}`;

/** Facts whose value differs among items covering the same surah and ayat. */
export function useDifferences(configs: VideoConfig[]) {
  const { t, i18n } = useTranslation();
  const catalog = useCatalog();
  const groups = new Map<string, VideoConfig[]>();
  for (const c of configs) {
    groups.set(rangeKey(c), [...(groups.get(rangeKey(c)) ?? []), c]);
  }
  return (config: VideoConfig): Set<string> => {
    const siblings = groups.get(rangeKey(config)) ?? [];
    const diff = new Set<string>();
    if (siblings.length < 2) return diff;
    const all = siblings.map((s) => facts(s, catalog, t, i18n.language));
    const keys = new Set(all.flatMap((f) => [...f.always, ...f.extra].map((x) => x.key)));
    for (const key of keys) {
      const values = new Set(all.map((f) => [...f.always, ...f.extra].find((x) => x.key === key)).map((x) => (x ? factKey(x) : "")));
      if (values.size > 1) diff.add(key);
    }
    return diff;
  };
}

export function ConfigSummary({ config, differs }: { config: VideoConfig; differs?: Set<string> }) {
  const { t, i18n } = useTranslation();
  const catalog = useCatalog();
  const { always, extra } = facts(config, catalog, t, i18n.language);
  const shown = [...always, ...extra.filter((f) => differs?.has(f.key))];
  return (
    <ul className="config-chips">
      {shown.map((f) => (
        <li key={f.key} className={differs?.has(f.key) ? "chip diff" : "chip"} title={f.title}>
          {f.swatches?.map((s, i) => <span key={i} className="chip-dot" style={{ background: s }} />)}
          <bdi>{f.text}</bdi>
        </li>
      ))}
    </ul>
  );
}
