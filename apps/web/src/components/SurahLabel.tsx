import type { ReactNode } from "react";
import type { VideoConfig } from "@autoayah/core";
import { useSurahs } from "../surahs";

export function SurahLabel({ config, meta }: { config: VideoConfig; meta?: ReactNode }) {
  const surah = useSurahs().find((s) => s.number === config.surah);
  const range = config.from === config.to ? `${config.from}` : `${config.from}–${config.to}`;
  return (
    <div className="surah-label">
      <span className="surah-ar" lang="ar" dir="rtl">
        {surah?.name ?? config.surah}
      </span>
      <span className="surah-en">
        {surah?.englishName ?? `Surah ${config.surah}`} <bdi dir="ltr">{range}</bdi>
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
