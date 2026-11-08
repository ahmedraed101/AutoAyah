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
  /** The page opposite `mushafPage` when the open book (two pages) is shown. */
  facingPage?: NonNullable<ResolvedClip["mushafPages"]>[number];
  surah?: number;
  /** 0–1 through the current ayah; used by follow mode to scroll a long ayah. */
  ayahProgress?: number;
  /** Continuous word position from word timings (2.4 = 40% through the third word); follow mode pans with it. */
  readPosition?: number;
  /** Previous ayah number on the same page (follow-mode pan source). */
  followFrom?: number;
  /** 0–1 ease from the previous ayah's window to the current one. */
  followMix?: number;
};

/** Running-header surah of a page: the surah its first line belongs to. */
function pageSurahName(page: NonNullable<SlideProps["mushafPage"]>, fallback: string): string {
  const first = page.lines[0];
  const n = !first ? undefined : first.kind === "ayah" ? first.words[0]?.verseKey.split(":")[0] : String(first.surah);
  return (n && page.surahNames[n]) || fallback;
}

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
  /** Content width inside the margins and the photo panel. */
  innerWidth: number;
  /** Vertical padding of the photo panel, 0 without one. */
  panelY: number;
  /** Gap between side-by-side columns. */
  columnGap: number;
};

function layoutFor(width: number, height: number, overMedia = false, compact = false): Layout {
  const u = Math.min(width, height) / 1080;
  const landscape = width > height * 1.2;
  const padX = landscape ? width * (compact ? 0.035 : 0.06) : width * (compact ? 0.025 : 0.045);
  const padY = height * (compact ? 0.03 : landscape ? 0.07 : 0.05);
  const panel = overMedia ? panelPad(u, false, compact) : { x: 0, y: 0 };
  const innerWidth = width - padX * 2 - panel.x * 2;
  const columnGap = (compact ? 36 : 60) * u;
  const columnWidth = landscape ? (innerWidth - columnGap) / 2 : innerWidth;
  const bannerWidth = Math.min(columnWidth, 1000 * u);
  return {
    u,
    landscape,
    padX,
    padY,
    innerWidth,
    panelY: panel.y,
    columnGap,
    columnWidth,
    bannerWidth,
    bannerHeight: bannerWidth * 0.14,
    gap: (compact ? 18 : 30) * u,
    watermarkHeight: 110 * u,
  };
}

// ---------- pieces ----------

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

/** `roomy` adds side margin for content that is narrower than the frame (the two-page spread). */
const panelPad = (u: number, roomy = false, compact = false) => ({
  y: (compact ? 20 : 40) * u,
  x: (roomy ? (compact ? 48 : 96) : compact ? 18 : 36) * u,
});

/** Hex (#rgb / #rrggbb) with a 0–1 alpha channel for the media panel. */
function withAlpha(hex: string, alpha: number): string {
  const raw = hex.replace("#", "").trim();
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return hex;
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${full}${a}`;
}

/** Readable panel fill behind text when the background is a photo/video. */
function mediaPanelBackground(style: StyleConfig, page: string): string {
  const hex =
    style.mediaPanelColor === "white" ? "#ffffff" : style.mediaPanelColor === "black" ? "#0b0f0c" : page;
  return withAlpha(hex, style.mediaPanelOpacity ?? 0.9);
}

function Frame({
  p,
  l,
  style,
  overMedia,
  fit,
  compact,
  children,
}: {
  p: Palette;
  l: Layout;
  style: StyleConfig;
  overMedia?: boolean;
  /** Shrink the panel to its content instead of spanning the full width. */
  fit?: boolean;
  compact?: boolean;
  children: ReactNode;
}) {
  const pad = panelPad(l.u, fit, compact);
  const panel: CSSProperties = overMedia
    ? {
        background: mediaPanelBackground(style, p.page),
        borderRadius: 36 * l.u,
        padding: `${pad.y}px ${pad.x}px`,
        boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
        ...(fit ? { alignSelf: "center" } : {}),
      }
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

/** Smaller headings and card padding for when tafsir and translation share a short strip. */
const noteChrome = (l: Layout, compact?: boolean) => ({ titleSize: (compact ? 32 : 44) * l.u, padding: (compact ? 24 : 44) * l.u });

function TafsirBlock({
  props,
  l,
  p,
  maxHeight,
  width = l.columnWidth,
  compact,
}: {
  props: SlideProps;
  l: Layout;
  p: Palette;
  maxHeight: number;
  width?: number;
  compact?: boolean;
}) {
  const { slide, tafsirName, tafsirPageIndex = 0, tafsirOpacity = 1 } = props;
  const pages = slide.tafsirPages.length ? slide.tafsirPages : slide.ayah.tafsir ? [slide.ayah.tafsir] : [];
  if (!pages.length) return null;
  const text = pages[Math.min(tafsirPageIndex, pages.length - 1)]!;
  const longest = Math.max(...pages.map((t) => t.length));
  const { titleSize, padding } = noteChrome(l, compact);
  const textWidth = width - padding * 2;
  const base = (props.style.tafsirFontSize ?? 60) * l.u;
  const size = fitFontSize(longest, textWidth, maxHeight - titleSize * 1.6 - padding * 2 - l.gap, base, 1.75, NASKH_CHAR_EM);
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

const TRANSLATION_CHAR_EM = 0.5;
const TRANSLATION_FONT = `"Segoe UI", Roboto, "Noto Sans", Arial, ${UI_FONT}`;

/** Size and estimated height of the translation quote, fitted into `maxHeight`. */
function translationFit(props: SlideProps, l: Layout, width: number, maxHeight: number, compact?: boolean) {
  const text = props.slide.ayah.translation;
  if (!text) return null;
  const labelSize = (compact ? 22 : 26) * l.u;
  const bar = 5 * l.u;
  const indent = 28 * l.u;
  const padY = 8 * l.u;
  const textWidth = width - bar - indent;
  const chrome = labelSize * 1.4 + padY * 3;
  const base = (props.style.translationFontSize ?? 40) * l.u;
  const size = fitFontSize(text.length, textWidth, maxHeight - chrome, base, 1.5, TRANSLATION_CHAR_EM, 14 * l.u);
  const height = chrome + Math.ceil((text.length * TRANSLATION_CHAR_EM * size) / textWidth) * size * 1.5;
  const rtl = /^[^A-Za-z\u0590-\u08FF]*[\u0590-\u08FF]/.test(text);
  return { text, labelSize, bar, indent, padY, size, height, rtl };
}

/** A quote with a side rule, set apart from the tafsir card. */
function TranslationBlock({ fit, name, p }: { fit: NonNullable<ReturnType<typeof translationFit>>; name?: string; p: Palette }) {
  return (
    <div
      dir={fit.rtl ? "rtl" : "ltr"}
      style={{
        borderInlineStart: `${fit.bar}px solid ${p.accent}`,
        paddingInlineStart: fit.indent,
        paddingBlock: fit.padY,
        display: "flex",
        flexDirection: "column",
        gap: fit.padY,
        textAlign: "start",
      }}
    >
      <div
        dir="auto"
        style={{ fontFamily: TRANSLATION_FONT, fontWeight: 600, fontSize: fit.labelSize, color: p.muted, letterSpacing: "0.04em", lineHeight: 1.4 }}
      >
        {name ?? "الترجمة"}
      </div>
      <div style={{ fontFamily: TRANSLATION_FONT, fontStyle: "italic", fontWeight: 400, fontSize: fit.size, lineHeight: 1.5, color: p.text, opacity: 0.88 }}>
        {fit.text}
      </div>
    </div>
  );
}

/** Tafsir with the translation under it; the translation takes what it needs (up to under half when both show). */
function SideNotes({
  props,
  l,
  p,
  width,
  maxHeight,
  compact,
}: {
  props: SlideProps;
  l: Layout;
  p: Palette;
  width: number;
  maxHeight: number;
  compact?: boolean;
}) {
  const hasTafsir = Boolean(props.slide.tafsirPages.length || props.slide.ayah.tafsir);
  const fit = translationFit(props, l, width, hasTafsir ? maxHeight * 0.45 : maxHeight, compact);
  return (
    <>
      {hasTafsir ? (
        <TafsirBlock props={props} l={l} p={p} width={width} maxHeight={maxHeight - (fit ? fit.height + l.gap : 0)} compact={compact} />
      ) : null}
      {fit ? <TranslationBlock fit={fit} name={props.translationName} p={p} /> : null}
    </>
  );
}

function budget(l: Layout, height: number, hasWatermark: boolean) {
  return height - l.padY * 2 - l.panelY * 2 - l.bannerHeight - (hasWatermark ? l.watermarkHeight + l.gap : 0) - l.gap * 2;
}

/** Surah title cartouche in the page's own ink, like the headers printed in the Mushaf. */
function PageBanner({ name, width, p, ink, paper }: { name: string; width: number; p: Palette; ink: string; paper: string }) {
  const height = width * 0.12;
  const id = `page-banner-${p.accent.replace("#", "")}-${ink.replace("#", "")}`;
  return (
    <div style={{ position: "relative", width, height, flexShrink: 0, alignSelf: "center" }}>
      <svg viewBox="0 0 1000 120" width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <pattern id={id} width="24" height="24" patternUnits="userSpaceOnUse" x="6" y="6">
            <path d="M12 2 L22 12 L12 22 L2 12Z" fill="none" stroke={p.accent} strokeWidth="1.4" opacity="0.7" />
            <circle cx="12" cy="12" r="2.2" fill={p.accent} opacity="0.8" />
          </pattern>
        </defs>
        <rect x="3" y="3" width="994" height="114" rx="6" fill={`url(#${id})`} stroke={p.accent} strokeWidth="4" />
        <rect x="11" y="11" width="978" height="98" rx="3" fill="none" stroke={ink} strokeOpacity="0.35" strokeWidth="1.5" />
        <path d="M300 60 Q300 18 360 18 H640 Q700 18 700 60 Q700 102 640 102 H360 Q300 102 300 60Z" fill={paper} stroke={p.accent} strokeWidth="4" />
        <path d="M314 60 Q314 28 364 28 H636 Q686 28 686 60 Q686 92 636 92 H364 Q314 92 314 60Z" fill="none" stroke={ink} strokeOpacity="0.4" strokeWidth="1.5" />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: QURAN_FONT,
          fontSize: height * 0.4,
          color: ink,
          direction: "rtl",
          paddingBottom: height * 0.06,
        }}
      >
        {name}
      </div>
    </div>
  );
}

/** Running header shared by every page: surah name on the right, page number on the left. */
function PageHeader({ surahName, page, size, color, inset }: { surahName: string; page?: number; size: number; color: string; inset: number }) {
  return (
    <div
      dir="rtl"
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontFamily: UI_FONT,
        fontWeight: 700,
        fontSize: size,
        lineHeight: `${size * 1.9}px`,
        color,
        paddingInline: inset,
        flexShrink: 0,
      }}
    >
      <span>{surahName}</span>
      <span>{page ? toArabicDigits(page) : ""}</span>
    </div>
  );
}

/** The ayah set on a Mushaf-style page: same paper, frame and running header as the page view. */
function AyahPage({ props, p, width, height, base }: { props: SlideProps; p: Palette; width: number; height: number; base: number }) {
  const { slide, style, basmala, translationName, surahName } = props;
  const paper = paperOf(style);
  const ink: Palette = { ...p, text: paper.ink };
  const frameKind = style.mushafFrame ?? "classic";
  const frame = Math.max(6, width * 0.025);
  const headerSize = Math.max(14, width * 0.03);
  const padX = width * 0.055;
  const inner = width - frame * 2 - padX * 2;
  const bannerWidth = Math.min(inner, 900 * (width / 1000));
  const translation = slide.ayah.translation;
  const transSize = Math.max(14, width * 0.028);
  const transHeight = translation ? (Math.ceil((translation.length * 0.5 * transSize) / inner) * 1.5 + 1.2) * transSize : 0;
  const room = height - headerSize * 1.9 - frame * 2 - headerSize * 2 - transHeight;
  // On short pages the running header already names the surah; keep room for the ayah's lines (up to two) at full size.
  const bannerHeight = bannerWidth * 0.12 + headerSize;
  const linesAtBase = Math.ceil(slide.ayah.text.length / Math.max(1, inner / (base * QURAN_CHAR_EM)));
  const banner = room - bannerHeight >= Math.min(2, linesAtBase) * base * 2;
  const bodyHeight = room - (banner ? bannerHeight : 0);
  // The basmala line scales with the ayah, so size once with it at full size, then again at the fitted size.
  const fit = (basmalaSize: number) =>
    fitFontSize(slide.ayah.text.length, inner, bodyHeight - (basmala ? basmalaSize * 1.44 + headerSize : 0), base, 2, QURAN_CHAR_EM);
  const size = fit(fit(base));

  return (
    <div
      style={{
        position: "relative",
        alignSelf: "center",
        width,
        height,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        padding: `0 ${frame}px ${frame}px`,
        ...frameStyle(frameKind, frame, p, paper.bg),
      }}
    >
      {frameKind === "ornate" ? <OrnateCorners size={frame * 2.6} p={p} /> : null}
      <PageHeader surahName={surahName} page={slide.ayah.page} size={headerSize} color={p.accent} inset={frameKind === "ornate" ? frame * 1.3 : 0} />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: headerSize,
          padding: `${headerSize}px ${padX}px`,
          overflow: "hidden",
        }}
      >
        {banner ? <PageBanner name={surahName} width={bannerWidth} p={p} ink={paper.ink} paper={paper.bg} /> : null}
        {basmala ? (
          <div style={{ fontFamily: QURAN_FONT, fontSize: size * 0.8, color: paper.ink, textAlign: "center", lineHeight: 1.8 }}>{basmala}</div>
        ) : null}
        <div
          style={{
            fontFamily: QURAN_FONT,
            fontSize: size,
            lineHeight: 2,
            color: paper.ink,
            textAlign: "justify",
            textAlignLast: "center",
            wordSpacing: "0.05em",
          }}
        >
          <AyahText slide={slide} style={style} p={ink} highlightedWordIndex={props.highlightedWordIndex} />
        </div>
        {translation ? (
          <div
            dir="auto"
            style={{
              borderTop: `1px solid ${p.accent}55`,
              paddingTop: transSize * 0.8,
              fontFamily: `"Segoe UI", Roboto, "Noto Sans", Arial, ${UI_FONT}`,
              fontSize: transSize,
              lineHeight: 1.5,
              color: paper.ink,
              opacity: 0.8,
              textAlign: "center",
            }}
          >
            {translation}
            {translationName ? <span style={{ opacity: 0.7, fontSize: transSize * 0.7 }}> — {translationName}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const clamp = (min: number, max: number, v: number) => Math.min(max, Math.max(min, v));

/** Share of the canvas the ayah takes next to tafsir: a larger font gives the ayah more room. */
const ayahShareFor = (style: StyleConfig, base: number) => clamp(base - 0.15, base + 0.15, base * (style.fontSize / 64));

/** Square and wider canvases put tafsir beside the ayah; stacked, both get too short to read. */
const sideBySide = (l: Layout, width: number, height: number, hasTafsir: boolean) => l.landscape || (hasTafsir && width >= height);

export function AyahTafsirSlide(props: SlideProps) {
  const { style, width, height, overMedia, slide } = props;
  const p = palette(style);
  const l = layoutFor(width, height, overMedia);
  const hasTafsir = Boolean(slide.tafsirPages.length || slide.ayah.tafsir);
  // The page carries its own header, so the banner's share of the height goes to the page.
  const available = budget(l, height, style.showWatermark) + l.bannerHeight + l.gap;
  const base = style.fontSize * l.u * (hasTafsir ? 1 : 1.25);
  const watermark = style.showWatermark ? <Watermark text={style.watermarkText} p={p} u={l.u} /> : null;

  if (sideBySide(l, width, height, hasTafsir)) {
    const row = l.innerWidth - (hasTafsir ? l.columnGap : 0);
    const pageWidth = hasTafsir ? row * ayahShareFor(style, 0.5) : Math.min(row, available * 1.35);
    const tafsirWidth = row - pageWidth;
    return (
      <Frame p={p} l={l} style={style} overMedia={overMedia}>
        <div style={{ display: "flex", flexDirection: "row", gap: l.columnGap, alignItems: "center", justifyContent: "center" }}>
          <AyahPage props={props} p={p} width={pageWidth} height={available} base={base} />
          {hasTafsir ? (
            <div style={{ width: tafsirWidth, minWidth: 0, display: "flex", flexDirection: "column", gap: l.gap }}>
              <TafsirBlock props={props} l={l} p={p} width={tafsirWidth} maxHeight={available} />
            </div>
          ) : null}
        </div>
        {watermark}
      </Frame>
    );
  }

  const ayahShare = hasTafsir ? ayahShareFor(style, 0.45) : 1;
  return (
    <Frame p={p} l={l} style={style} overMedia={overMedia}>
      <AyahPage props={props} p={p} width={l.columnWidth} height={available * ayahShare - (hasTafsir ? l.gap : 0)} base={base} />
      {hasTafsir ? <TafsirBlock props={props} l={l} p={p} maxHeight={available * (1 - ayahShare)} /> : null}
      {watermark}
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
  const paper = paperOf(style);
  const ink: Palette = { ...p, text: paper.ink };
  const frameKind = style.mushafFrame ?? "classic";
  const frame = size * 0.3;

  return (
    <div
      style={{
        position: "relative",
        width: pageWidth,
        boxSizing: "border-box",
        alignSelf: "center",
        padding: `0 ${padX}px ${frame}px`,
        fontFamily: QURAN_FONT,
        fontSize: size,
        lineHeight,
        ...frameStyle(frameKind, frame, p, paper.bg),
      }}
    >
      {frameKind === "ornate" ? <OrnateCorners size={frame * 2.6} p={p} /> : null}
      <PageHeader surahName={pageSurahName(mushafPage, props.surahName)} page={mushafPage.page} size={size * 0.62} color={p.accent} inset={0} />
      {mushafPage.lines.map((line) => {
        if (line.kind === "ayah") return <MushafAyahLine key={line.line} line={line} currentKey={currentKey} p={ink} centered={centered(line)} />;
        if (line.kind === "surah") {
          const bannerWidth = Math.min(pageWidth - padX * 2, (rowHeight * 0.92) / 0.12);
          return (
            <div key={line.line} style={{ height: rowHeight, display: "flex", alignItems: "center", justifyContent: "center", opacity: line.surah === surah ? 1 : 0.5 }}>
              <PageBanner name={mushafPage.surahNames[line.surah] ?? ""} width={bannerWidth} p={p} ink={paper.ink} paper={paper.bg} />
            </div>
          );
        }
        return (
          <div key={line.line} dir="rtl" style={{ textAlign: "center", color: paper.ink, opacity: line.surah === surah ? 0.9 : 0.38 }}>
            {mushafPage.basmala ?? ""}
          </div>
        );
      })}
    </div>
  );
}

/** Paper and ink for the scanned page; the scan is transparent ink, recolored by an SVG filter. */
const PAPERS = {
  ivory: { bg: "#fffdf8", ink: "#1b1b1b" },
  white: { bg: "#ffffff", ink: "#000000" },
  sepia: { bg: "#f3e6cc", ink: "#3b2a18" },
  mint: { bg: "#eef6ee", ink: "#14301f" },
  night: { bg: "#14120e", ink: "#ece6d8" },
} as const;

const paperOf = (style: StyleConfig) =>
  PAPERS[style.mushafPaper === "auto" || !style.mushafPaper ? (style.theme === "dark" ? "night" : "ivory") : style.mushafPaper];

type FrameKind = NonNullable<StyleConfig["mushafFrame"]>;

function frameStyle(kind: FrameKind, frame: number, p: Palette, bg: string): CSSProperties {
  switch (kind) {
    case "ornate":
      return {
        background: bg,
        border: `${frame * 0.32}px double ${p.primary}`,
        outline: `${Math.max(1, frame * 0.08)}px solid ${p.accent}`,
        outlineOffset: -frame * 0.6,
        borderRadius: frame * 0.4,
        boxShadow: `0 0 0 ${Math.max(1, frame * 0.1)}px ${p.accent}88`,
      };
    case "simple":
      return { background: bg, border: `${Math.max(1, frame * 0.08)}px solid ${p.accent}aa`, borderRadius: frame * 0.3 };
    case "card":
      return { background: bg, borderRadius: frame * 1.6, boxShadow: `0 ${frame}px ${frame * 3.5}px rgba(0,0,0,0.22)` };
    case "none":
      return { background: bg };
    default:
      return {
        background: bg,
        border: `${Math.max(1, frame * 0.12)}px solid ${p.primary}66`,
        outline: `${Math.max(1, frame * 0.05)}px solid ${p.accent}55`,
        outlineOffset: -frame * 0.45,
        borderRadius: frame * 0.8,
      };
  }
}

/** Small eight-petal rosettes on the corners of the ornate frame. */
function OrnateCorners({ size, p }: { size: number; p: Palette }) {
  const offset = -size * 0.42;
  const corners: CSSProperties[] = [
    { top: offset, left: offset },
    { top: offset, right: offset },
    { bottom: offset, left: offset },
    { bottom: offset, right: offset },
  ];
  return (
    <>
      {corners.map((pos, i) => (
        <svg key={i} viewBox="-50 -50 100 100" width={size} height={size} style={{ position: "absolute", zIndex: 1, ...pos }} aria-hidden="true">
          <circle r="30" fill={p.primary} />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((r) => (
            <ellipse key={r} cx="0" cy="-30" rx="11" ry="18" fill={p.primary} stroke={p.accent} strokeWidth="3" transform={`rotate(${r})`} />
          ))}
          <circle r="22" fill="none" stroke={p.accent} strokeWidth="4" />
          <circle r="9" fill={p.accent} />
        </svg>
      ))}
    </>
  );
}

/** The scanned printed page; everything except the current ayah is softly veiled (all of it when `dimmed`). */
type ScannedPage = NonNullable<SlideProps["mushafPage"]> & { image: NonNullable<NonNullable<SlideProps["mushafPage"]>["image"]> };

type ScanOpts = { compact?: boolean; follow?: boolean; followLines?: number; followZoom?: number };

/** Zooming past the page width is for narrow canvases; landscape already enlarges by showing fewer lines. */
const scanOptsOf = (props: Pick<SlideProps, "style" | "width" | "height">, follow: boolean): ScanOpts => ({
  compact: props.style.mushafCompact === true,
  follow,
  followLines: props.style.mushafFollowLines,
  followZoom: props.width <= props.height ? props.style.mushafFollowZoom : 1,
});

/** Vertical range of an ayah's boxes on the page (image pixels). */
function ayahRange(boxes: [number, number, number, number][] | undefined) {
  if (!boxes?.length) return null;
  const top = Math.min(...boxes.map(([, y]) => y));
  const bottom = Math.max(...boxes.map(([, y, , bh]) => y + bh));
  return { top, bottom, center: (top + bottom) / 2, height: bottom - top };
}

/** Size of a scanned page drawn inside a `width` × `maxHeight` box (frame and header included). */
function scanBox(page: ScannedPage, width: number, maxHeight: number, opts: ScanOpts = {}) {
  // Header and frame scale with the drawn page, not the box: a wide box around a height-limited page would
  // otherwise get an oversized header. Guess the page width, fit, then refit with the real width.
  const first = scanFit(page, width, maxHeight, opts, Math.min(width, maxHeight * 0.75));
  return scanFit(page, width, maxHeight, opts, Math.min(width, first.outerWidth));
}

function scanFit(page: ScannedPage, width: number, maxHeight: number, opts: ScanOpts, pageWidth: number) {
  const { image } = page;
  const compact = opts.compact ?? false;
  const headerSize = Math.max(14, pageWidth * (compact ? 0.028 : 0.03));
  const headerHeight = headerSize * 1.9;
  const frame = Math.max(compact ? 4 : 6, pageWidth * (compact ? 0.014 : 0.025));
  // The two opening pages are short; crop the empty space below their text.
  const allBoxes = Object.values(page.boxes ?? {}).flat();
  const k = image.width / 1024;
  const visibleHeight =
    page.page <= 2 && allBoxes.length
      ? Math.min(image.height, Math.max(...allBoxes.map(([, y, , bh]) => y + bh)) + 60 * k)
      : image.height;
  const availW = width - frame * 2;
  const availH = maxHeight - headerHeight - frame * 2;
  const widthScale = availW / image.width;

  if (opts.follow) {
    // Line pitch of a full 15-line page; the short opening pages are cropped, so use the whole scan height.
    const pitch = image.height / 15;
    const desired = Math.min(visibleHeight, Math.max(4, opts.followLines ?? 7) * pitch);
    const heightScale = availH / desired;
    // Narrow canvases (9:16, 1:1) run out of width first: let the page grow past it and pan along the line.
    const zoomScale = widthScale * Math.max(1, opts.followZoom ?? 1);
    const scale = Math.min(zoomScale, heightScale);
    // A width-limited window shows more lines to fill the height rather than leave it empty.
    const windowH = Math.min(visibleHeight, scale === zoomScale ? availH / scale : desired);
    const windowW = Math.min(image.width, availW / scale);
    return {
      headerSize,
      frame,
      scale,
      w: windowW * scale,
      h: windowH * scale,
      outerWidth: windowW * scale + frame * 2,
      visibleHeight,
      windowH,
      windowW,
      follow: true as const,
    };
  }

  const scale = Math.min(widthScale, availH / visibleHeight);
  return {
    headerSize,
    frame,
    scale,
    w: image.width * scale,
    h: visibleHeight * scale,
    outerWidth: image.width * scale + frame * 2,
    visibleHeight,
    windowH: visibleHeight,
    windowW: image.width,
    follow: false as const,
  };
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

type Box = [number, number, number, number];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const center = ([x, y, w, h]: Box) => ({ x: x + w / 2, y: y + h / 2 });

/**
 * Where the reciter is on the page (image pixels). With word timings it rests on each word and glides to the
 * next in the word's second half; without, it sweeps each line right to left by ayah progress, swinging back
 * to the start of the next line at the end.
 */
function readPoint(boxes: Box[], words: Box[], props: SlideProps): { x: number; y: number } {
  if (words.length && props.readPosition != null) {
    const pos = Math.max(0, props.readPosition);
    const i = Math.min(words.length - 1, Math.floor(pos));
    if (i >= words.length - 1) return center(words[words.length - 1]!);
    const mix = easeInOut(clamp01((pos - i - 0.5) / 0.5));
    const a = center(words[i]!);
    const b = center(words[i + 1]!);
    return { x: lerp(a.x, b.x, mix), y: lerp(a.y, b.y, mix) };
  }
  const lines = [...boxes].sort((a, b) => a[1] - b[1]);
  const total = lines.reduce((s, [, , w]) => s + w, 0);
  let d = clamp01(props.ayahProgress ?? 0) * total;
  const SWING = 0.12;
  for (let i = 0; i < lines.length; i++) {
    const [x, y, w, h] = lines[i]!;
    const next = lines[i + 1];
    if (d > w && next) {
      d -= w;
      continue;
    }
    const u = w > 0 ? clamp01(d / w) : 1;
    if (next && u > 1 - SWING) {
      const mix = easeInOut((u - (1 - SWING)) / SWING);
      return { x: lerp(x, next[0] + next[2], mix), y: lerp(y + h / 2, next[1] + next[3] / 2, mix) };
    }
    return { x: x + w - w * clamp01(u / (next ? 1 - SWING : 1)), y: y + h / 2 };
  }
  return { x: 0, y: 0 };
}

/** Window position (image pixels) that keeps the recited ayah, and the reciter's place in it, in view. */
function followView(
  page: ScannedPage,
  surah: number | undefined,
  ayah: number,
  box: { windowH: number; windowW: number; visibleHeight: number },
  props: SlideProps,
): { top: number; left: number } {
  const boxes = (page.boxes?.[`${surah}:${ayah}`] ?? []) as Box[];
  const range = ayahRange(boxes);
  if (!range) return { top: 0, left: 0 };
  const point = readPoint(boxes, (page.words?.[`${surah}:${ayah}`] ?? []) as Box[], props);
  let cy = range.height > box.windowH ? point.y : range.center;
  let cx = point.x;
  if (props.followFrom != null && (props.followMix ?? 1) < 1) {
    const prevBoxes = (page.boxes?.[`${surah}:${props.followFrom}`] ?? []) as Box[];
    const prev = ayahRange(prevBoxes);
    if (prev) {
      const mix = easeInOut(clamp01(props.followMix ?? 1));
      const last = [...prevBoxes].sort((a, b) => a[1] - b[1]).pop()!;
      cy = lerp(prev.height > box.windowH ? last[1] + last[3] / 2 : prev.center, cy, mix);
      cx = lerp(last[0], cx, mix);
    }
  }
  const width = page.image.width;
  return {
    top: Math.max(0, Math.min(box.visibleHeight - box.windowH, cy - box.windowH / 2)),
    left: Math.max(0, Math.min(width - box.windowW, cx - box.windowW / 2)),
  };
}

function MushafScan({
  props,
  p,
  width,
  maxHeight,
  dimmed,
}: {
  props: SlideProps;
  p: Palette;
  width: number;
  maxHeight: number;
  dimmed?: boolean;
}) {
  const { mushafPage, surah, slide, style, surahName } = props;
  const image = mushafPage?.image;
  if (!mushafPage || !image) return null;
  const follow = style.mushafView === "follow" && !dimmed;
  const box = scanBox({ ...mushafPage, image }, width, maxHeight, scanOptsOf(props, follow));
  const { headerSize, frame, scale, w, h, outerWidth, visibleHeight, windowH, windowW } = box;
  const { top, left } = follow
    ? followView({ ...mushafPage, image }, surah, slide.ayah.number, box, props)
    : { top: 0, left: 0 };
  // Highlight sizes are tuned on the 1024px scan; HD scans use the same look at their own pixel size.
  const k = image.width / 1024;
  const pad = 10 * k;
  const current = (mushafPage.boxes?.[`${surah}:${slide.ayah.number}`] ?? []).map(
    ([x, y, bw, bh]) => [x - pad, y - pad * 0.6, bw + pad * 2, bh + pad * 1.2] as const,
  );
  const maskId = `ayah-mask-${mushafPage.page}-${slide.ayah.number}`;
  const paper = paperOf(style);
  const inkId = `mushaf-ink-${paper.ink.replace("#", "")}`;
  const wordBoxes = mushafPage.words?.[`${surah}:${slide.ayah.number}`] ?? [];
  const word = (props.highlightedWordIndex ?? -1) >= 0 ? wordBoxes[Math.min(props.highlightedWordIndex!, wordBoxes.length - 1)] : undefined;
  const frameKind = style.mushafFrame ?? "classic";
  const fade = Math.max(8, h * 0.04);

  return (
    <div
      style={{
        position: "relative",
        alignSelf: "center",
        boxSizing: "border-box",
        width: outerWidth,
        padding: `0 ${frame}px ${frame}px`,
        ...frameStyle(frameKind, frame, p, paper.bg),
      }}
    >
      {frameKind === "ornate" ? <OrnateCorners size={frame * 2.6} p={p} /> : null}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden="true">
        <filter id={inkId} colorInterpolationFilters="sRGB">
          <feFlood floodColor={paper.ink} />
          <feComposite in2="SourceAlpha" operator="in" />
        </filter>
      </svg>
      <PageHeader
        surahName={pageSurahName(mushafPage, surahName)}
        page={mushafPage.page}
        size={headerSize}
        color={p.accent}
        inset={frameKind === "ornate" ? frame * 1.3 : 0}
      />
      <div style={{ position: "relative", width: w, height: h, overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: image.width * scale,
            transform: `translate(${-left * scale}px, ${-top * scale}px)`,
          }}
        >
          <Img src={image.url} style={{ width: image.width * scale, height: image.height * scale, display: "block", filter: `url(#${inkId})` }} />
          {current.length || dimmed ? (
            <svg
              viewBox={`0 0 ${image.width} ${image.height}`}
              style={{ position: "absolute", top: 0, left: 0, width: image.width * scale, height: image.height * scale }}
            >
              <defs>
                <mask id={maskId}>
                  <rect x={0} y={0} width={image.width} height={image.height} fill="white" />
                  {current.map(([x, y, bw, bh], i) => (
                    <rect key={i} x={x} y={y} width={bw} height={bh} rx={14 * k} fill="black" />
                  ))}
                </mask>
              </defs>
              <rect x={0} y={0} width={image.width} height={image.height} fill={paper.bg} opacity={0.6} mask={`url(#${maskId})`} />
              {current.map(([x, y, bw, bh], i) => (
                <rect key={i} x={x} y={y} width={bw} height={bh} rx={14 * k} fill={p.primary} opacity={0.13} />
              ))}
              {word ? (
                <rect
                  x={word[0] - 6 * k}
                  y={word[1] - 6 * k}
                  width={word[2] + 12 * k}
                  height={word[3] + 12 * k}
                  rx={12 * k}
                  fill={p.accent}
                  fillOpacity={0.28}
                  stroke={p.accent}
                  strokeOpacity={0.7}
                  strokeWidth={2.5 * k}
                />
              ) : null}
            </svg>
          ) : null}
        </div>
        {follow && top > 1 ? (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: fade,
              background: `linear-gradient(${paper.bg}, ${paper.bg}00)`,
              pointerEvents: "none",
            }}
          />
        ) : null}
        {follow && top + windowH < visibleHeight - 1 ? (
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: fade,
              background: `linear-gradient(${paper.bg}00, ${paper.bg})`,
              pointerEvents: "none",
            }}
          />
        ) : null}
        {follow && left > 1 ? (
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              width: fade,
              background: `linear-gradient(to right, ${paper.bg}, ${paper.bg}00)`,
              pointerEvents: "none",
            }}
          />
        ) : null}
        {follow && left + windowW < image.width - 1 ? (
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              right: 0,
              width: fade,
              background: `linear-gradient(to left, ${paper.bg}, ${paper.bg}00)`,
              pointerEvents: "none",
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

export function MushafPageSlide(props: SlideProps) {
  const { style, width, height, slide, mushafPage, overMedia } = props;
  const p = palette(style);
  const compact = style.mushafCompact === true;
  const follow = style.mushafView === "follow";
  const l = layoutFor(width, height, overMedia, compact);
  if (!mushafPage) return <AyahTafsirSlide {...props} />;

  const hasSide = Boolean(slide.tafsirPages.length || slide.ayah.tafsir || slide.ayah.translation);
  // Landscape without side notes: tuck the watermark in a corner so it doesn't steal height.
  const cornerMark = compact && l.landscape && !hasSide && style.showWatermark;
  const available =
    budget(l, height, style.showWatermark && !cornerMark) + l.bannerHeight + l.gap;
  const watermark = style.showWatermark && !cornerMark ? <Watermark text={style.watermarkText} p={p} u={l.u} /> : null;
  const scanOpts = scanOptsOf(props, follow);
  const page = (w: number, h: number) =>
    mushafPage.image ? <MushafScan props={props} p={p} width={w} maxHeight={h} /> : <MushafPageBlock props={props} p={p} width={w} maxHeight={h} />;
  const cornerWatermark = cornerMark ? (
    <div style={{ position: "absolute", bottom: l.padY * 0.4, insetInlineStart: l.padX * 0.4, zIndex: 2, transform: "scale(0.7)", transformOrigin: "bottom left" }}>
      <Watermark text={style.watermarkText} p={p} u={l.u} />
    </div>
  ) : null;

  if (l.landscape && !hasSide && props.facingPage) {
    // Open book: odd pages on the right, even on the left. Pages are tall, so height limits them —
    // use a tighter vertical margin and fit the panel to the pages.
    const sl = { ...l, padY: height * (compact ? 0.02 : 0.035) };
    const pad = overMedia ? panelPad(l.u, true, compact) : { x: 0, y: 0 };
    const gutter = 24 * l.u;
    const pageWidth = (width - l.padX * 2 - pad.x * 2 - gutter) / 2;
    const pageHeight =
      height - sl.padY * 2 - pad.y * 2 - (style.showWatermark && !cornerMark ? l.watermarkHeight * 0.6 + l.gap : 0);
    const facing = { ...props, mushafPage: props.facingPage, highlightedWordIndex: -1 };
    const sides = mushafPage.page % 2 ? [facing, props] : [props, facing];
    return (
      <Frame p={p} l={sl} style={style} overMedia={overMedia} fit compact={compact}>
        <div style={{ display: "flex", flexDirection: "row", gap: gutter, alignItems: "center", justifyContent: "center", direction: "ltr" }}>
          {sides.map((side) =>
            side.mushafPage?.image ? (
              <MushafScan key={side.mushafPage.page} props={side} p={p} width={pageWidth} maxHeight={pageHeight} dimmed={side !== props} />
            ) : (
              <MushafPageBlock key={side.mushafPage?.page} props={side} p={p} width={pageWidth} maxHeight={pageHeight} />
            ),
          )}
        </div>
        {style.showWatermark && !cornerMark ? <Watermark text={style.watermarkText} p={p} u={l.u} /> : null}
        {cornerWatermark}
      </Frame>
    );
  }

  if (sideBySide(l, width, height, hasSide)) {
    // Full pages are tall, so height limits them: with side notes, use a tighter vertical margin and put the
    // watermark under them so the page gets the full height. The notes take the width the page leaves.
    const sl = hasSide ? { ...l, padY: height * (compact ? 0.02 : 0.035) } : l;
    const pageHeight = hasSide ? height - sl.padY * 2 - l.panelY * 2 : available;
    const row = l.innerWidth - (hasSide ? l.columnGap : 0);
    // Follow mode makes the page wider (shorter window → larger scale), so it can claim more of the row.
    const maxPage = hasSide ? row * (follow ? 0.62 : 0.6) : row;
    const measured = mushafPage.image
      ? scanBox({ ...mushafPage, image: mushafPage.image }, maxPage, pageHeight, scanOpts).outerWidth
      : maxPage;
    const pageWidth = Math.min(maxPage, measured);
    const sideWidth = row - pageWidth;
    const sideHeight = pageHeight - (watermark ? l.watermarkHeight + l.gap : 0);
    return (
      <Frame p={p} l={sl} style={style} overMedia={overMedia} compact={compact}>
        <div style={{ display: "flex", flexDirection: "row", gap: l.columnGap, alignItems: "center", justifyContent: "center" }}>
          <div style={{ flex: "none", display: "flex", flexDirection: "column" }}>{page(maxPage, pageHeight)}</div>
          {hasSide ? (
            <div style={{ width: sideWidth, minWidth: 0, display: "flex", flexDirection: "column", gap: l.gap }}>
              <SideNotes props={props} l={l} p={p} width={sideWidth} maxHeight={sideHeight} />
              {watermark}
            </div>
          ) : null}
        </div>
        {hasSide ? null : watermark}
        {cornerWatermark}
      </Frame>
    );
  }

  const bothNotes = Boolean((slide.tafsirPages.length || slide.ayah.tafsir) && slide.ayah.translation);
  const pageShare = bothNotes ? 0.5 : hasSide ? 0.68 : 1;
  // A width-limited scan is shorter than its share; the notes get what it leaves.
  const scan = mushafPage.image
    ? scanBox({ ...mushafPage, image: mushafPage.image }, l.columnWidth, available * pageShare, scanOpts)
    : null;
  const pageHeight = scan ? Math.min(available * pageShare, scan.h + scan.headerSize * 1.9 + scan.frame) : available * pageShare;
  const notesHeight = available - pageHeight - l.gap;
  return (
    <Frame p={p} l={l} style={style} overMedia={overMedia} compact={compact}>
      {page(l.columnWidth, available * pageShare)}
      {hasSide ? (
        // Fixed height keeps the page still from ayah to ayah; short notes sit in the middle of it.
        <div style={{ height: notesHeight, display: "flex", flexDirection: "column", justifyContent: "center", gap: l.gap * 0.5, overflow: "hidden" }}>
          <SideNotes props={props} l={l} p={p} width={l.columnWidth} maxHeight={notesHeight} compact={bothNotes && notesHeight < 600 * l.u} />
        </div>
      ) : null}
      {watermark}
      {cornerWatermark}
    </Frame>
  );
}
