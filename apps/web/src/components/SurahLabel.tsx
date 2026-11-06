import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { endSurah, spansSurahs, type VideoConfig } from "@autoayah/core";
import { rangeText, surahTitle, useSurahs } from "../surahs";

/** "Juz 30" for a clip picked as a named division, otherwise undefined. */
export function useDivisionTitle() {
  const { t } = useTranslation();
  return (c: Pick<VideoConfig, "range">) => (c.range && c.range.kind !== "surah" ? t(`range_${c.range.kind}`, { n: c.range.n }) : undefined);
}

export function SurahLabel({ config, meta }: { config: VideoConfig; meta?: ReactNode }) {
  const surahs = useSurahs();
  const division = useDivisionTitle()(config);
  const arabic = spansSurahs(config)
    ? `${surahTitle(surahs, config.surah, "ar")} – ${surahTitle(surahs, endSurah(config), "ar")}`
    : surahTitle(surahs, config.surah, "ar");
  return (
    <div className="surah-label">
      <span className="surah-ar" lang="ar" dir="rtl">
        {arabic}
      </span>
      <span className="surah-en">
        {division ? `${division} · ` : null}
        <bdi dir="ltr">{rangeText(config, surahs, "en")}</bdi>
      </span>
      {meta ? <span className="surah-meta">{meta}</span> : null}
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {hint ? <p className="empty-hint">{hint}</p> : null}
      {action}
    </div>
  );
}
