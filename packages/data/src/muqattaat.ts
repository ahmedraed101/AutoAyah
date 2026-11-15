/** Ayat (after Al-Baqarah 2:1) that are, or open with, the separated letters (الحروف المقطعة). */
export const MUQATTAAT = new Set([
  "3:1", "7:1", "10:1", "11:1", "12:1", "13:1", "14:1", "15:1", "19:1", "20:1", "26:1", "27:1", "28:1", "29:1", "30:1",
  "31:1", "32:1", "36:1", "38:1", "40:1", "41:1", "42:1", "42:2", "43:1", "44:1", "45:1", "46:1", "50:1", "68:1",
]);

/** Matches `phrase` whatever harakat, shadda or tatweel the source puts on its letters. */
const loose = (phrase: string) =>
  phrase
    .split("")
    .map((c) => (c === " " ? "\\s+" : `${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\u064B-\\u0652\\u0670\\u0640]*`))
    .join("");

/** Sentences that answer these letters by pointing back to Al-Baqarah instead of explaining them. */
const BACK_REFERENCES = [
  // Al-Muyassar
  new RegExp(`(?:${loose("سبق")}|${loose("تقدم")})\\s+${loose("الكلام")}\\s+(?:${loose("عليها")}|${loose("على الحروف المقطعة")})\\s+${loose("في أول سورة البقرة")}\\.?`),
  // At-Tabari
  new RegExp(`${loose("قد أتينا على البيان عن معنى قوله")}[^.]*?${loose("فيما مضى")}[^.]*\\.?`),
  // As-Sa'di
  new RegExp(`${loose("تقدم تفسيرها")}\\.?`),
];

/** Replaces the first back-reference in `text` with `explanation` (the same tafsir's 2:1), keeping everything around it. */
export function expandMuqattaat(text: string, explanation: string): string {
  for (const re of BACK_REFERENCES) {
    if (re.test(text)) return text.replace(re, explanation.trim()).trim();
  }
  return text;
}

export const hasBackReference = (text: string) => BACK_REFERENCES.some((re) => re.test(text));
