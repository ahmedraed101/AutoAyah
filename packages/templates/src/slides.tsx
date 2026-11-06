import { Fragment, type CSSProperties, type ReactNode } from "react";
import { toArabicDigits, type ResolvedClip, type Slide, type StyleConfig } from "@autoayah/core";
import { Img } from "remotion";
import { QURAN_FONT, UI_FONT } from "./fonts";
import { parseTajweed } from "./tajweed";

export type SlideProps = {
  slide: Slide;
  surahName: string;
  tafsirName?: string;
  translationName?: string;
  basmala?: string;
  style: StyleConfig;
  width: number;
  height: number;
  /** Index into ayah.words that is currently recited (word highlight mode). */
  highlightedWordIndex?: number;
  /** Which tafsir page is visible, and its fade (0–1). */
  tafsirPageIndex?: number;
  tafsirOpacity?: number;
  /** Background is a photo/video: put content on a readable panel. */
  overMedia?: boolean;
  mushafPage?: NonNullable<ResolvedClip["mushafPages"]>[number];
  surah?: number;
};

type Palette = {
  page: string;
  text: string;
  card: string;
  accent: string;
  primary: string;
  bannerFill: string;
  bannerText: string;
  muted: string;
};

function palette(style: StyleConfig): Palette {
  if (style.theme === "dark") {
    return {
      page: "#0b0f0c",
      text: "#f3efe6",
      card: "#1d1912",
      accent: style.accentColor,
      primary: style.primaryColor,
      bannerFill: "#132019",
      bannerText: "#e8f0e2",
      muted: "#8a8a80",
    };
  }
  return {
    page: style.backgroundColor,
    text: style.textColor,
    card: style.cardColor,
    accent: style.accentColor,
    primary: style.primaryColor,
    bannerFill: "#fbfdf8",
    bannerText: "#1d3a25",
    muted: "#9a9a9a",
  };
}

// ---------- text fitting ----------

/** Rough average glyph advance (in em) per character, including diacritics. */
const QURAN_CHAR_EM = 0.34;
const NASKH_CHAR_EM = 0.43;

function fitFontSize(chars: number, boxWidth: number, maxHeight: number, base: number, lineHeight: number, charEm: number, min = 18) {
  let size = base;
  while (size > min) {
    const perLine = Math.max(1, boxWidth / (size * charEm));
    const lines = Math.ceil(chars / perLine);
    if (lines * size * lineHeight <= maxHeight) break;
    size *= 0.95;
  }
  return Math.max(min, size);
}

type Layout = {
  u: number;
  landscape: boolean;
  padX: number;
  padY: number;
  columnWidth: number;
  bannerWidth: number;
  bannerHeight: number;
  gap: number;
  watermarkHeight: number;
};

function layoutFor(width: number, height: number): Layout {
  const u = Math.min(width, height) / 1080;
  const landscape = width > height * 1.2;
  const padX = landscape ? width * 0.06 : width * 0.045;
  const padY = height * (landscape ? 0.07 : 0.05);
  const columnWidth = landscape ? (width - padX * 2 - 60 * u) / 2 : width - padX * 2;
  const bannerWidth = Math.min(columnWidth, 1000 * u);
  return {
    u,
    landscape,
    padX,
    padY,
    columnWidth,
    bannerWidth,
    bannerHeight: bannerWidth * 0.14,
    gap: 30 * u,
    watermarkHeight: 110 * u,
  };
}

// ---------- pieces ----------

/** Ornamental surah header: green frame, floral band, cartouche with the surah name. */
export function SurahBanner({ name, width, p }: { name: string; width: number; p: Palette }) {
  const height = width * 0.14;
  const id = `rosette-${p.primary.replace("#", "")}`;
  return (
    <div style={{ position: "relative", width, height, flexShrink: 0, alignSelf: "center" }}>
      <svg viewBox="0 0 1000 140" width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <pattern id={id} width="46" height="46" patternUnits="userSpaceOnUse" x="9" y="9">
            <rect width="46" height="46" fill="#eef5e8" />
            <path d="M23 0 L46 23 L23 46 L0 23Z" fill="none" stroke={p.primary} strokeWidth="1.6" opacity="0.75" />
            {[0, 46].flatMap((x) =>
              [0, 46].map((y) => (
                <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
                  {[0, 90, 180, 270].map((r) => (
                    <ellipse key={r} cx="0" cy="-6" rx="3.2" ry="6.5" fill={p.primary} transform={`rotate(${r + 45})`} />
                  ))}
                </g>
              )),
            )}
            <g transform="translate(23 23)">
              {[0, 45, 90, 135, 180, 225, 270, 315].map((r) => (
                <ellipse key={r} cx="0" cy="-7" rx="3.6" ry="6.8" fill="#de8aa6" stroke="#b25a7c" strokeWidth="0.7" transform={`rotate(${r})`} />
              ))}
              <circle r="3.6" fill="#f0c75a" stroke="#b58a1e" strokeWidth="0.6" />
            </g>
          </pattern>
        </defs>
        <rect x="2.5" y="2.5" width="995" height="135" fill={`url(#${id})`} stroke={p.primary} strokeWidth="5" />
        <rect x="9" y="9" width="982" height="122" fill="none" stroke="#c9a94f" strokeWidth="2" />
        <rect x="270" y="17" width="460" height="106" rx="53" fill={p.bannerFill} stroke={p.primary} strokeWidth="4" />
        <rect x="278" y="25" width="444" height="90" rx="45" fill="none" stroke="#c9a94f" strokeWidth="1.6" />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: QURAN_FONT,
          fontSize: height * 0.36,
          color: p.bannerText,
          direction: "rtl",
          paddingBottom: height * 0.04,
        }}
      >
        {name}
      </div>
    </div>
  );
}

/** Ornamental end-of-ayah medallion with the ayah number. */
export function AyahMarker({ n, color }: { n: number; color: string }) {
  const digits = toArabicDigits(n);
  return (
    <svg
      viewBox="0 0 100 100"
      style={{ width: "1.05em", height: "1.05em", verticalAlign: "-0.18em", margin: "0 0.12em", display: "inline-block" }}
    >
      {Array.from({ length: 12 }, (_, k) => (
        <circle key={k} cx={50 + 40 * Math.cos((k * Math.PI) / 6)} cy={50 + 40 * Math.sin((k * Math.PI) / 6)} r="9" fill="none" stroke={color} strokeWidth="4" />
      ))}
      <circle cx="50" cy="50" r="34" fill="none" stroke={color} strokeWidth="5" />
      <text
        x="50"
        y="52"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily={UI_FONT}
        fontWeight={700}
        fontSize={digits.length > 2 ? 30 : 40}
        fill={color}
      >
        {digits}
      </text>
    </svg>
  );
}

function AyahText({ slide, style, p, highlightedWordIndex = -1 }: { slide: Slide; style: StyleConfig; p: Palette; highlightedWordIndex?: number }) {
  const { ayah } = slide;
  if (highlightedWordIndex >= 0 && ayah.words?.length) {
    return (
      <>
        {ayah.words.map((w, i) => (
          <span key={i}>
            <span
              style={{
                color: i === highlightedWordIndex ? p.primary : p.text,
                background: i === highlightedWordIndex ? `${p.primary}26` : "transparent",
                borderRadius: "0.2em",
                boxDecorationBreak: "clone",
              }}
            >
              {w}
            </span>{" "}
          </span>
        ))}
        <AyahMarker n={ayah.number} color={p.accent} />
      </>
    );
  }
  const segments = style.tajweed && ayah.tajweed ? parseTajweed(ayah.tajweed) : [{ text: ayah.text }];
  return (
    <>
      {segments.map((s, i) => (s.color ? <span key={i} style={{ color: s.color }}>{s.text}</span> : s.text))}{" "}
      <AyahMarker n={ayah.number} color={p.accent} />
    </>
  );
}

function Watermark({ text, p, u }: { text: string; p: Palette; u: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 * u, opacity: 0.85, flexShrink: 0 }}>
      <svg viewBox="0 0 100 100" width={54 * u} height={54 * u}>
        <circle cx="50" cy="50" r="46" fill="none" stroke={p.muted} strokeWidth="3" />
        <rect x="29" y="29" width="42" height="42" fill="none" stroke={p.muted} strokeWidth="3" />
        <rect x="29" y="29" width="42" height="42" fill="none" stroke={p.muted} strokeWidth="3" transform="rotate(45 50 50)" />
      </svg>
      <div style={{ fontFamily: UI_FONT, fontSize: 22 * u, color: p.muted, direction: "rtl" }}>{text}</div>
    </div>
  );
}

function Frame({ p, l, overMedia, children }: { p: Palette; l: Layout; overMedia?: boolean; children: ReactNode }) {
  const panel: CSSProperties = overMedia
    ? { background: `${p.page}e6`, borderRadius: 36 * l.u, padding: `${40 * l.u}px ${36 * l.u}px`, boxShadow: "0 20px 60px rgba(0,0,0,0.35)" }
    : {};
  return (
    <div
      lang="ar"
      style={{
        position: "absolute",
        inset: 0,
        padding: `${l.padY}px ${l.padX}px`,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        direction: "rtl",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: l.gap, ...panel }}>{children}</div>
    </div>
  );
}

// ---------- slides ----------

function AyahColumn({
  props,
  l,
  p,
  maxHeight,
  base,
}: {
  props: SlideProps;
  l: Layout;
  p: Palette;
  maxHeight: number;
  base: number;
}) {
  const { slide, style, basmala, translationName } = props;
  const translation = slide.ayah.translation;
  const transSize = 30 * l.u;
  const transHeight = translation ? Math.ceil((translation.length * 0.5 * transSize) / l.columnWidth) * transSize * 1.5 : 0;
  const basmalaHeight = basmala ? base * 0.8 * 2 : 0;
  const size = fitFontSize(slide.ayah.text.length, l.columnWidth, maxHeight - transHeight - basmalaHeight, base, 2, QURAN_CHAR_EM);
  return (
    <>
      {basmala ? (
        <div style={{ fontFamily: QURAN_FONT, fontSize: size * 0.8, color: p.text, textAlign: "center", lineHeight: 1.8 }}>{basmala}</div>
      ) : null}
      <div
        style={{
          fontFamily: QURAN_FONT,
          fontSize: size,
          lineHeight: 2,
          color: p.text,
          textAlign: "justify",
          textAlignLast: "right",
          wordSpacing: "0.05em",
        }}
      >
        <AyahText slide={slide} style={style} p={p} highlightedWordIndex={props.highlightedWordIndex} />
      </div>
      {translation ? (
        <div
          dir="auto"
          style={{ fontFamily: `"Segoe UI", Roboto, "Noto Sans", Arial, ${UI_FONT}`, fontSize: transSize, lineHeight: 1.5, color: p.accent, textAlign: "center" }}
        >
          {translation}
          {translationName ? <span style={{ opacity: 0.7, fontSize: transSize * 0.7 }}> — {translationName}</span> : null}
        </div>
      ) : null}
    </>
  );
}

function TafsirBlock({ props, l, p, maxHeight }: { props: SlideProps; l: Layout; p: Palette; maxHeight: number }) {
  const { slide, tafsirName, tafsirPageIndex = 0, tafsirOpacity = 1 } = props;
  const pages = slide.tafsirPages.length ? slide.tafsirPages : slide.ayah.tafsir ? [slide.ayah.tafsir] : [];
  if (!pages.length) return null;
  const text = pages[Math.min(tafsirPageIndex, pages.length - 1)]!;
  const longest = Math.max(...pages.map((t) => t.length));
  const titleSize = 44 * l.u;
  const padding = 44 * l.u;
  const textWidth = l.columnWidth - padding * 2;
  const size = fitFontSize(longest, textWidth, maxHeight - titleSize * 1.6 - padding * 2 - l.gap, 60 * l.u, 1.75, NASKH_CHAR_EM);
  // Keep the card the same height on every page so the layout doesn't jump.
  const minHeight = pages.length > 1 ? Math.ceil((longest * NASKH_CHAR_EM * size) / textWidth) * size * 1.75 : undefined;
  return (
    <>
      <div style={{ fontFamily: UI_FONT, fontWeight: 700, fontSize: titleSize, color: p.accent, textAlign: "right", lineHeight: 1.3 }}>
        {tafsirName ?? "التفسير"}
      </div>
      <div
        style={{
          background: p.card,
          borderRadius: 30 * l.u,
          padding,
          fontFamily: UI_FONT,
          fontWeight: 700,
          fontSize: size,
          lineHeight: 1.75,
          color: p.text,
          textAlign: "justify",
          textAlignLast: "right",
        }}
      >
        <div style={{ opacity: tafsirOpacity, minHeight }}>{text}</div>
      </div>
    </>
  );
}

function budget(l: Layout, height: number, hasWatermark: boolean) {
  return height - l.padY * 2 - l.bannerHeight - (hasWatermark ? l.watermarkHeight + l.gap : 0) - l.gap * 2;
}

export function AyahSlide(props: SlideProps) {
  const { style, width, height, surahName, overMedia } = props;
  const p = palette(style);
  const l = layoutFor(width, height);
  const available = budget(l, height, style.showWatermark);
  return (
    <Frame p={p} l={l} overMedia={overMedia}>
      <SurahBanner name={surahName} width={l.bannerWidth} p={p} />
      <AyahColumn props={props} l={{ ...l, columnWidth: l.landscape ? l.bannerWidth : l.columnWidth }} p={p} maxHeight={available} base={style.fontSize * 1.15 * l.u} />
      {style.showWatermark ? <Watermark text={style.watermarkText} p={p} u={l.u} /> : null}
    </Frame>
  );
}

export const WordHighlightSlide = AyahSlide;

export function AyahTafsirSlide(props: SlideProps) {
  const { style, width, height, surahName, overMedia, slide } = props;
  const p = palette(style);
  const l = layoutFor(width, height);
  const hasTafsir = Boolean(slide.tafsirPages.length || slide.ayah.tafsir);
  const available = budget(l, height, style.showWatermark);

  if (l.landscape && hasTafsir) {
    return (
      <Frame p={p} l={l} overMedia={overMedia}>
        <div style={{ display: "flex", flexDirection: "row", gap: 60 * l.u, alignItems: "center" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: l.gap }}>
            <SurahBanner name={surahName} width={l.columnWidth} p={p} />
            <AyahColumn props={props} l={l} p={p} maxHeight={available} base={style.fontSize * l.u} />
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: l.gap }}>
            <TafsirBlock props={props} l={l} p={p} maxHeight={available + l.bannerHeight} />
          </div>
        </div>
        {style.showWatermark ? <Watermark text={style.watermarkText} p={p} u={l.u} /> : null}
      </Frame>
    );
  }

  const ayahShare = hasTafsir ? 0.4 : 1;
  return (
    <Frame p={p} l={l} overMedia={overMedia}>
      <SurahBanner name={surahName} width={l.bannerWidth} p={p} />
      <AyahColumn props={props} l={l} p={p} maxHeight={available * ayahShare} base={style.fontSize * (hasTafsir ? 0.9 : 1.15) * l.u} />
      {hasTafsir ? <TafsirBlock props={props} l={l} p={p} maxHeight={available * (1 - ayahShare)} /> : null}
      {style.showWatermark ? <Watermark text={style.watermarkText} p={p} u={l.u} /> : null}
    </Frame>
  );
}

type PageLine = NonNullable<SlideProps["mushafPage"]>["lines"][number];
type AyahLine = Extract<PageLine, { kind: "ayah" }>;

/** Visible width in base letters: harakat and other marks take no horizontal space. */
const lineChars = (line: AyahLine) => line.words.reduce((n, w) => n + (w.ayahEnd ? 2.6 : w.text.replace(/\p{M}/gu, "").length + 1), 0);
const MUSHAF_CHAR_EM = 0.37;

/** One justified Mushaf line; the current ayah's words share a single highlight run. */
function MushafAyahLine({ line, currentKey, p, centered }: { line: AyahLine; currentKey: string; p: Palette; centered: boolean }) {
  const runs: { current: boolean; words: AyahLine["words"] }[] = [];
  for (const w of line.words) {
    const current = w.verseKey === currentKey;
    const last = runs[runs.length - 1];
    if (last && last.current === current) last.words.push(w);
    else runs.push({ current, words: [w] });
  }
  return (
    <div
      dir="rtl"
      style={{ whiteSpace: "nowrap", textAlign: centered ? "center" : "justify", textAlignLast: centered ? "center" : "justify" }}
    >
      {runs.map((run, i) => (
        <span
          key={i}
          style={
            run.current
              ? { color: p.text, background: `${p.primary}24`, borderRadius: "0.3em", padding: "0.05em 0.15em", boxDecorationBreak: "clone" }
              : { color: p.text, opacity: 0.38 }
          }
        >
          {run.words.map((w, k) => (
            <Fragment key={k}>
              {k > 0 || i > 0 ? " " : ""}
              {w.ayahEnd ? <AyahMarker n={w.ayahEnd} color={run.current ? p.accent : p.muted} /> : w.text}
            </Fragment>
          ))}
        </span>
      ))}
    </div>
  );
}

/** A real 15-line Madani page: the current ayah is highlighted, the rest of the page stays visible but dimmed. */
function MushafPageBlock({ props, p, width, maxHeight }: { props: SlideProps; p: Palette; width: number; maxHeight: number }) {
  const { mushafPage, surah, slide, style } = props;
  if (!mushafPage) return null;
  const currentKey = `${surah}:${slide.ayah.number}`;
  const ayahLines = mushafPage.lines.filter((l): l is AyahLine => l.kind === "ayah");
  const widest = Math.max(1, ...ayahLines.map(lineChars));
  const lineHeight = 1.75;
  const rows = Math.max(mushafPage.lines.length, 8);
  const padX = width * 0.035;
  const inner = width - padX * 2;
  // Rows plus the running header and frame padding.
  const size = Math.min(inner / (widest * MUSHAF_CHAR_EM), maxHeight / ((rows + 1) * lineHeight + 0.8), (style.fontSize * width) / 1000);
  const rowHeight = size * lineHeight;
  // When height limits the font, narrow the page to its natural width instead of stretching word gaps.
  const pageWidth = Math.min(width, widest * MUSHAF_CHAR_EM * size * 1.08 + padX * 2);
  // Short decorated opening pages and surah endings are centered rather than stretched.
  const centered = (line: AyahLine) => mushafPage.page <= 2 || lineChars(line) < widest * 0.72;

  return (
    <div
      style={{
        width: pageWidth,
        alignSelf: "center",
        border: `${Math.max(1, size * 0.05)}px solid ${p.primary}66`,
        outline: `${Math.max(1, size * 0.02)}px solid ${p.accent}55`,
        outlineOffset: -size * 0.16,
        borderRadius: size * 0.3,
        padding: `${size * 0.3}px ${padX}px`,
        fontFamily: QURAN_FONT,
        fontSize: size,
        lineHeight,
      }}
    >
      <div
        dir="rtl"
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: UI_FONT,
          fontWeight: 700,
          fontSize: size * 0.62,
          lineHeight: `${rowHeight}px`,
          color: p.accent,
          borderBottom: `1px solid ${p.accent}44`,
          marginBottom: size * 0.15,
        }}
      >
        <span>{props.surahName}</span>
        <span>{toArabicDigits(mushafPage.page)}</span>
      </div>
      {mushafPage.lines.map((line) => {
        if (line.kind === "ayah") return <MushafAyahLine key={line.line} line={line} currentKey={currentKey} p={p} centered={centered(line)} />;
        if (line.kind === "surah") {
          const bannerWidth = Math.min(pageWidth - padX * 2, (rowHeight * 0.92) / 0.14);
          return (
            <div key={line.line} style={{ height: rowHeight, display: "flex", alignItems: "center", justifyContent: "center", opacity: line.surah === surah ? 1 : 0.5 }}>
              <SurahBanner name={mushafPage.surahNames[line.surah] ?? ""} width={bannerWidth} p={p} />
            </div>
          );
        }
        return (
          <div key={line.line} dir="rtl" style={{ textAlign: "center", color: p.text, opacity: line.surah === surah ? 0.9 : 0.38 }}>
            {mushafPage.basmala ?? ""}
          </div>
        );
      })}
    </div>
  );
}

/** The scanned printed page; everything except the current ayah is softly veiled. */
function MushafScan({ props, p, width, maxHeight }: { props: SlideProps; p: Palette; width: number; maxHeight: number }) {
  const { mushafPage, surah, slide, style, surahName } = props;
  const image = mushafPage?.image;
  if (!mushafPage || !image) return null;
  const headerSize = Math.max(14, width * 0.03);
  const headerHeight = headerSize * 1.9;
  const frame = Math.max(6, width * 0.025);
  // The two opening pages are short; crop the empty space below their text.
  const allBoxes = Object.values(mushafPage.boxes ?? {}).flat();
  const visibleHeight =
    mushafPage.page <= 2 && allBoxes.length ? Math.min(image.height, Math.max(...allBoxes.map(([, y, , bh]) => y + bh)) + 60) : image.height;
  const scale = Math.min((width - frame * 2) / image.width, (maxHeight - headerHeight - frame * 2) / visibleHeight);
  const w = image.width * scale;
  const h = visibleHeight * scale;
  const pad = 10;
  const current = (mushafPage.boxes?.[`${surah}:${slide.ayah.number}`] ?? []).map(
    ([x, y, bw, bh]) => [x - pad, y - pad * 0.6, bw + pad * 2, bh + pad * 1.2] as const,
  );
  const maskId = `ayah-mask-${mushafPage.page}-${slide.ayah.number}`;
  const dark = style.theme === "dark";

  return (
    <div
      style={{
        alignSelf: "center",
        padding: `0 ${frame}px ${frame}px`,
        border: `${Math.max(1, frame * 0.12)}px solid ${p.primary}66`,
        outline: `${Math.max(1, frame * 0.05)}px solid ${p.accent}55`,
        outlineOffset: -frame * 0.45,
        borderRadius: frame * 0.8,
        background: dark ? "#14120e" : "#fffdf8",
      }}
    >
      <div
        dir="rtl"
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: UI_FONT,
          fontWeight: 700,
          fontSize: headerSize,
          lineHeight: `${headerHeight}px`,
          color: p.accent,
        }}
      >
        <span>{surahName}</span>
        <span>{toArabicDigits(mushafPage.page)}</span>
      </div>
      <div style={{ position: "relative", width: w, height: h, overflow: "hidden" }}>
        <Img src={image.url} style={{ width: w, height: image.height * scale, display: "block", filter: dark ? "invert(0.92)" : undefined }} />
        {current.length ? (
          <svg viewBox={`0 0 ${image.width} ${image.height}`} style={{ position: "absolute", top: 0, left: 0, width: w, height: image.height * scale }}>
            <defs>
              <mask id={maskId}>
                <rect x={0} y={0} width={image.width} height={image.height} fill="white" />
                {current.map(([x, y, bw, bh], i) => (
                  <rect key={i} x={x} y={y} width={bw} height={bh} rx={14} fill="black" />
                ))}
              </mask>
            </defs>
            <rect x={0} y={0} width={image.width} height={image.height} fill={dark ? "#14120e" : "#fffdf8"} opacity={0.6} mask={`url(#${maskId})`} />
            {current.map(([x, y, bw, bh], i) => (
              <rect key={i} x={x} y={y} width={bw} height={bh} rx={14} fill={p.primary} opacity={0.13} />
            ))}
          </svg>
        ) : null}
      </div>
    </div>
  );
}

export function MushafPageSlide(props: SlideProps) {
  const { style, width, height, surahName, slide, mushafPage, overMedia } = props;
  const p = palette(style);
  const l = layoutFor(width, height);
  if (!mushafPage) return <AyahTafsirSlide {...props} />;

  const hasTafsir = Boolean(slide.tafsirPages.length || slide.ayah.tafsir);
  // The page carries its own running header (surah name, page number), so no separate banner is needed.
  const available = budget(l, height, style.showWatermark) + l.bannerHeight + l.gap;

  if (l.landscape) {
    return (
      <Frame p={p} l={l} overMedia={overMedia}>
        <div style={{ display: "flex", flexDirection: "row", gap: 60 * l.u, alignItems: "center" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: l.gap * 0.6 }}>
            {mushafPage.image ? (
              <MushafScan props={props} p={p} width={l.columnWidth} maxHeight={height - l.padY * 2} />
            ) : (
              <MushafPageBlock props={props} p={p} width={l.columnWidth} maxHeight={height - l.padY * 2} />
            )}
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: l.gap }}>
            <SurahBanner name={surahName} width={l.columnWidth} p={p} />
            {hasTafsir ? <TafsirBlock props={props} l={l} p={p} maxHeight={available - l.bannerHeight - l.gap} /> : null}
          </div>
        </div>
        {style.showWatermark ? <Watermark text={style.watermarkText} p={p} u={l.u} /> : null}
      </Frame>
    );
  }

  return (
    <Frame p={p} l={l} overMedia={overMedia}>
      {mushafPage.image ? (
        <MushafScan props={props} p={p} width={l.columnWidth} maxHeight={available * (hasTafsir ? 0.68 : 1)} />
      ) : (
        <MushafPageBlock props={props} p={p} width={l.columnWidth} maxHeight={available * (hasTafsir ? 0.68 : 1)} />
      )}
      {hasTafsir ? <TafsirBlock props={props} l={l} p={p} maxHeight={available * 0.32} /> : null}
      {style.showWatermark ? <Watermark text={style.watermarkText} p={p} u={l.u} /> : null}
    </Frame>
  );
}
