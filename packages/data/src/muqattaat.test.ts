import { describe, expect, it } from "vitest";
import { expandMuqattaat, hasBackReference, MUQATTAAT } from "./muqattaat.js";

const BAQARAH_1 = "هذه الحروف وغيرها من الحروف المقطَّعة في أوائل السور فيها إشارة إلى إعجاز القرآن.";

describe("expandMuqattaat", () => {
  it("replaces a bare reference with the 2:1 explanation", () => {
    expect(expandMuqattaat("سبق الكلام عليها في أول سورة البقرة.", BAQARAH_1)).toBe(BAQARAH_1);
  });

  it("keeps the label and the rest of the ayah's tafsir", () => {
    const qaf = "(ق) سبق الكلام على الحروف المقطَّعة في أول سورة البقرة. أقسم الله تعالى بالقرآن الكريم ذي المجد والشرف.";
    expect(expandMuqattaat(qaf, BAQARAH_1)).toBe(`(ق) ${BAQARAH_1} أقسم الله تعالى بالقرآن الكريم ذي المجد والشرف.`);
  });

  it("matches without the shadda and the Quran.com braces", () => {
    expect(expandMuqattaat("{كهيعص} سبق الكلام على الحروف المقطعة في أول سورة البقرة.", BAQARAH_1)).toBe(`{كهيعص} ${BAQARAH_1}`);
  });

  it("handles At-Tabari's reference", () => {
    const tabari = 'القول في تأويل قوله : الم (1)قال أبو جعفر: قد أتينا على البيان عن معنى قوله: " الم " فيما مضى، بما أغنى عن إعادته في هذا الموضع.';
    expect(expandMuqattaat(tabari, BAQARAH_1)).toBe(`القول في تأويل قوله : الم (1)قال أبو جعفر: ${BAQARAH_1}`);
  });

  it("leaves a tafsir that explains the letters itself unchanged", () => {
    const waseet = "افتتحت سورة آل عمران ببعض حروف التهجى وهو قوله - تعالى - : { الم } .";
    expect(hasBackReference(waseet)).toBe(false);
    expect(expandMuqattaat(waseet, BAQARAH_1)).toBe(waseet);
  });
});

describe("MUQATTAAT", () => {
  it("lists only opening-letter ayat after Al-Baqarah", () => {
    expect(MUQATTAAT.has("3:1")).toBe(true);
    expect(MUQATTAAT.has("42:2")).toBe(true);
    expect(MUQATTAAT.has("2:1")).toBe(false);
    expect(MUQATTAAT.has("3:2")).toBe(false);
    expect(MUQATTAAT.size).toBe(29);
  });
});
