import { useTranslation } from "react-i18next";
import { endSurah, needsWordTimings, spansSurahs, type VideoConfig } from "@autoayah/core";
import { entryName, useCatalog, type Catalog } from "./catalog";
import { useDivisionTitle } from "./components/SurahLabel";
import { localDigits, useSurahs, type Surah } from "./surahs";

export type Caption = { title: string; tags: string[]; text: string };

const TASHKEEL = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const plainArabic = (s: string) => s.replace(TASHKEEL, "").replace(/ٱ/g, "ا").replace(/\s+/g, " ").trim();
const hashtag = (s: string) => `#${s.trim().replace(/[\s\-–·]+/g, "_").replace(/[^\p{L}\p{N}_]/gu, "")}`;

/** Recitation styles are tagged in English even in Arabic names, e.g. "محمد صديق المنشاوي (Mujawwad)". */
const STYLE_AR: Record<string, string> = { mujawwad: "مجوّد", muallim: "معلّم", murattal: "مرتّل" };

/** Names people search for: "محمود خليل الحصري" → "الحصري". */
const SHORT_AR: Record<string, string> = { "عبد الباسط عبد الصمد": "عبد الباسط" };

/** "Mohamed Siddiq al-Minshawi" → "Minshawi". */
function englishTag(name: string) {
  if (/^AbdulBaset/i.test(name)) return "AbdulBaset";
  const last = name.split(/\s+/).pop() ?? name;
  return last.replace(/^(al|ar|as|ash|ad|an|at|az)-/i, "").replace(/[^\p{L}\p{N}]/gu, "") || name.replace(/\s+/g, "");
}

function reciterParts(full: string, arabic: boolean): { short: string; style?: string } {
  const style = /\(([^)]+)\)/.exec(full)?.[1]?.trim();
  const base = full
    .replace(/\([^)]*\)/g, "")
    .replace(/·.*$/, "")
    .replace(/^(الشيخ|شيخ)\s+/, "")
    .trim();
  const styleText = style ? (arabic ? (STYLE_AR[style.toLowerCase()] ?? style) : style) : undefined;
  if (!arabic || !/[\u0600-\u06FF]/.test(base)) return { short: base, style: styleText };
  if (SHORT_AR[base]) return { short: SHORT_AR[base], style: styleText };
  const words = base.split(" ");
  const last = words[words.length - 1] ?? base;
  if (!last.startsWith("ال") || words.length < 2) return { short: base, style: styleText };
  const prev = words[words.length - 2];
  return { short: prev && /^(عبد|أبو|ابو)$/.test(prev) ? `${prev} ${last}` : last, style: styleText };
}

/** Title and hashtags for posting the video, e.g. "سورة البقرة ١-٥ مع التفسير الميسر وتحديد الكلمات بصوت الشيخ الحصري #الحصري …". */
export function videoCaption(config: VideoConfig, surahs: Surah[], catalog: Catalog, lang: string, division?: string): Caption {
  const ar = lang === "ar";
  const n = (x: number) => localDigits(x, lang);
  const info = (s: number) => surahs.find((x) => x.number === s);
  const surahName = (s: number) =>
    ar ? plainArabic(info(s)?.name ?? String(s)).replace(/^سورة\s+/, "") : (info(s)?.englishName ?? String(s));
  const surahWord = ar ? "سورة" : "Surah";
  const last = endSurah(config);
  const whole = config.from === 1 && config.to === (info(last)?.numberOfAyahs ?? -1);

  let range: string;
  if (spansSurahs(config)) {
    const from = `${surahWord} ${surahName(config.surah)}${whole ? "" : ` ${n(config.from)}`}`;
    const to = `${surahWord} ${surahName(last)}${whole ? "" : ` ${n(config.to)}`}`;
    range = ar ? `من ${from} إلى ${to}` : `${from} to ${to}`;
  } else {
    const ayat = whole
      ? ""
      : config.from === config.to
        ? ar
          ? ` آية ${n(config.from)}`
          : `, Ayah ${config.from}`
        : ` ${n(config.from)}-${n(config.to)}`;
    range = `${surahWord} ${surahName(config.surah)}${ayat}`;
  }
  if (division) range = `${division} (${range})`;

  const tafsir = config.tafsir ? entryName(catalog.tafsirs, config.tafsir, lang) : undefined;
  const translation = config.translation ? entryName(catalog.translations, config.translation, lang) : undefined;
  const highlight = needsWordTimings(config.mode);
  const reciter = reciterParts(entryName(catalog.reciters, config.reciter, lang), ar);

  const extras = [tafsir, translation ? (ar ? `ترجمة ${translation}` : `${translation} translation`) : undefined].filter(Boolean);
  let title = range;
  if (ar) {
    if (extras.length) title += ` مع ${extras.join(" و")}`;
    if (highlight) title += extras.length ? " وتحديد الكلمات" : " مع تحديد الكلمات";
    title += ` بصوت الشيخ ${reciter.short}${reciter.style ? ` (${reciter.style})` : ""}`;
  } else {
    const withs = [...extras, highlight ? "word highlighting" : undefined].filter(Boolean);
    if (withs.length) title += ` with ${withs.join(" and ")}`;
    title += ` | ${reciter.short}${reciter.style ? ` (${reciter.style})` : ""}`;
  }

  const surahTags = [...new Set([config.surah, last])].map(surahName);
  const tags = ar
    ? [hashtag(reciter.short), "#قران", "#قران_كريم", ...surahTags.flatMap((s) => [hashtag(s), hashtag(`سورة ${s}`)])]
    : ["#Quran", "#QuranRecitation", ...surahTags.map((s) => hashtag(s.replace(/[-\s]/g, ""))), hashtag(englishTag(reciter.short))];
  const unique = [...new Set(tags)].filter((tag) => tag.length > 1);
  return { title, tags: unique, text: `${title} ${unique.join(" ")}` };
}

export function useCaption(config: VideoConfig): Caption {
  const { i18n } = useTranslation();
  const surahs = useSurahs();
  const catalog = useCatalog();
  const division = useDivisionTitle()(config);
  return videoCaption(config, surahs, catalog, i18n.language, division);
}

/** Download name for a render: the caption title plus the output's extension. */
export function downloadName(title: string, outputUrl: string) {
  const ext = /\.[a-z0-9]+$/i.exec(outputUrl)?.[0] ?? "";
  return `${title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim()}${ext}`;
}
