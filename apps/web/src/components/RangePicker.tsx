import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  RangeKindSchema,
  ayahCount,
  clipAyahCount,
  divisionRange,
  endSurah,
  surahRange,
  type AyahRef,
  type QuranDivision,
  type RangeKind,
} from "@autoayah/core";
import { useEditor } from "../store";
import { divisionLabel, localDigits, rangeText, useDivisions, useSurahs } from "../surahs";
import { Field, Select, Stepper } from "./controls";

type Kind = RangeKind | "ayat";
type DivisionKind = Exclude<RangeKind, "surah">;

const KINDS: Kind[] = ["ayat", ...RangeKindSchema.options];
const before = (a: AyahRef, b: AyahRef) => a.surah < b.surah || (a.surah === b.surah && a.ayah <= b.ayah);
const isDivision = (k: Kind): k is DivisionKind => k !== "ayat" && k !== "surah";

/** Pick the clip's ayat by hand, or as a whole surah / juz / hizb / quarter / page / manzil. */
export function RangePicker() {
  const { t } = useTranslation();
  const { config, setConfig, lang, missing } = useEditor();
  const surahs = useSurahs();
  const divisions = useDivisions();
  // Until a surah is picked, "select by" only switches the picker; it doesn't choose a range.
  const [pickedKind, setPickedKind] = useState<Kind>("ayat");
  const kind: Kind = missing.surah ? pickedKind : (config.range?.kind ?? "ayat");
  const start = { surah: config.surah, ayah: config.from };
  const last = endSurah(config);

  const pickDivision = (k: DivisionKind, d: QuranDivision | undefined) => d && setConfig(divisionRange(k, d));

  const pickKind = (next: Kind) => {
    if (missing.surah) setPickedKind(next);
    else if (next === "ayat") setConfig({ toSurah: null, range: null, to: last === config.surah ? config.to : ayahCount(config.surah) });
    else if (next === "surah") setConfig(surahRange(config.surah));
    else {
      const list = divisions?.[next] ?? [];
      pickDivision(next, list.find((d) => before(d.start, start) && before(start, d.end)) ?? list[0]);
    }
  };

  const surahSelect = (onPick: (n: number) => void) => (
    <Field label={t("surah")}>
      <Select value={missing.surah ? "" : config.surah} onChange={(e) => onPick(Number(e.target.value))}>
        {missing.surah ? (
          <option value="" disabled>
            {t("chooseSurah")}
          </option>
        ) : null}
        {surahs.map((s) => (
          <option key={s.number} value={s.number}>
            {lang === "ar" ? `${localDigits(s.number, lang)}. ${s.name}` : `${s.number}. ${s.englishName} — ${s.name}`}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <>
      <Field label={t("selectBy")}>
        <Select value={kind} onChange={(e) => pickKind(e.target.value as Kind)}>
          {KINDS.map((k) => (
            <option key={k} value={k} disabled={isDivision(k) && !divisions}>
              {t(`kind_${k}`)}
            </option>
          ))}
        </Select>
      </Field>

      {kind === "ayat" ? (
        <>
          {surahSelect((surah) => setConfig({ surah, from: 1, toSurah: null, to: 1, range: null }))}
          {missing.surah ? null : (
            <div className="pair">
              <Stepper label={t("from")} value={config.from} min={1} max={ayahCount(config.surah)} onChange={(from) => setConfig({ from })} />
              <Stepper
                label={t("to")}
                value={config.to}
                min={last === config.surah ? config.from : 1}
                max={ayahCount(last)}
                onChange={(to) => setConfig({ to })}
              />
            </div>
          )}
        </>
      ) : kind === "surah" ? (
        surahSelect((surah) => setConfig(surahRange(surah)))
      ) : (
        <Field
          label={t(`kind_${kind}`)}
          hint={missing.surah ? undefined : `${rangeText(config, surahs, lang)} · ${t("ayatCount", { n: clipAyahCount(config) })}`}
        >
          <Select
            value={missing.surah ? "" : config.range?.n}
            onChange={(e) => pickDivision(kind, divisions?.[kind].find((d) => d.n === Number(e.target.value)))}
          >
            {missing.surah ? (
              <option value="" disabled>
                {t("choose")}
              </option>
            ) : null}
            {(divisions?.[kind] ?? []).map((d) => (
              <option key={d.n} value={d.n}>
                {divisionLabel(d, surahs, lang)}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </>
  );
}
