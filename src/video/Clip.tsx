import { AbsoluteFill, Audio, Sequence } from "remotion";
import { loadFont } from "@remotion/google-fonts/AmiriQuran";
import { loadFont as loadUiFont } from "@remotion/google-fonts/Amiri";
import type { Ayah, ClipProps } from "./types";

const { fontFamily: quranFont } = loadFont();
const { fontFamily: uiFont } = loadUiFont("normal", { weights: ["700"], subsets: ["arabic"] });

const toArabicDigits = (n: number) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);

const tafsirFontSize = (len: number) => (len > 900 ? 32 : len > 600 ? 38 : len > 350 ? 46 : 54);

const Slide: React.FC<{ ayah: Ayah; surahName: string; tafsirName?: string }> = ({
  ayah,
  surahName,
  tafsirName,
}) => (
  <AbsoluteFill style={{ background: "#fff", direction: "rtl", padding: "120px 60px", gap: 40 }}>
    <div
      style={{
        border: "6px solid #3f7d4e",
        background: "#e7f1e4",
        borderRadius: 12,
        padding: "20px 0",
        textAlign: "center",
        fontFamily: quranFont,
        fontSize: 64,
        color: "#1f3d27",
      }}
    >
      {surahName}
    </div>
    <div style={{ fontFamily: quranFont, fontSize: 68, lineHeight: 1.9, color: "#111", textAlign: "justify" }}>
      {ayah.text} ﴿{toArabicDigits(ayah.number)}﴾
    </div>
    {ayah.tafsir ? (
      <>
        <div style={{ fontFamily: uiFont, fontSize: 40, color: "#b08a4a" }}>{tafsirName ?? "التفسير"}</div>
        <div
          style={{
            fontFamily: uiFont,
            fontSize: tafsirFontSize(ayah.tafsir.length),
            lineHeight: 1.7,
            background: "#fbf6ec",
            borderRadius: 32,
            padding: 48,
            color: "#111",
            textAlign: "justify",
          }}
        >
          {ayah.tafsir}
        </div>
      </>
    ) : null}
  </AbsoluteFill>
);

export const Clip: React.FC<ClipProps> = ({ surahName, tafsirName, ayat }) => {
  let from = 0;
  return (
    <AbsoluteFill style={{ background: "#fff" }}>
      {ayat.map((ayah) => {
        const start = from;
        from += ayah.durationInFrames;
        return (
          <Sequence key={ayah.number} from={start} durationInFrames={ayah.durationInFrames}>
            <Audio src={ayah.audioUrl} />
            <Slide ayah={ayah} surahName={surahName} tafsirName={tafsirName} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
