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

function layoutFor(width: number, height: number, overMedia = false): Layout {
  const u = Math.min(width, height) / 1080;
  const landscape = width > height * 1.2;
  const padX = landscape ? width * 0.06 : width * 0.045;
  const padY = height * (landscape ? 0.07 : 0.05);
  const panel = overMedia ? panelPad(u) : { x: 0, y: 0 };
  const innerWidth = width - padX * 2 - panel.x * 2;
  const columnGap = 60 * u;
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
    gap: 30 * u,
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
const panelPad = (u: number, roomy = false) => ({ y: 40 * u, x: (roomy ? 96 : 36) * u });

function Frame({
  p,
  l,
  overMedia,
  fit,
  children,
}: {
  p: Palette;
  l: Layout;
  overMedia?: boolean;
  /** Shrink the panel to its content instead of spanning the full width. */
  fit?: boolean;
  children: ReactNode;
}) {
  const pad = panelPad(l.u, fit);
  const panel: CSSProperties = overMedia
    ? {
        background: `${p.page}e6`,
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

function TafsirBlock({ props, l, p, maxHeight, width = l.columnWidth }: { props: SlideProps; l: Layout; p: Palette; maxHeight: number; width?: number }) {
  const { slide, tafsirName, tafsirPageIndex = 0, tafsirOpacity = 1 } = props;
  const pages = slide.tafsirPages.length ? slide.tafsirPages : slide.ayah.tafsir ? [slide.ayah.tafsir] : [];
  if (!pages.length) return null;
  const text = pages[Math.min(tafsirPageIndex, pages.length - 1)]!;
  const longest = Math.max(...pages.map((t) => t.length));
  const titleSize = 44 * l.u;
  const padding = 44 * l.u;
  const textWidth = width - padding * 2;
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
  // On short pages the running header already names the surah; keep at least two lines for the ayah.
  const bannerHeight = bannerWidth * 0.12 + headerSize;
  const opening = (Boolean(basmala) || slide.ayah.number === 1) && room - bannerHeight >= base * 4;
  const bodyHeight = room - (opening ? bannerHeight : 0);
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
        {opening ? <PageBanner name={surahName} width={bannerWidth} p={p} ink={paper.ink} paper={paper.bg} /> : null}
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

export function AyahSlide(props: SlideProps) {
  return <AyahTafsirSlide {...props} withTafsir={false} />;
}

export const WordHighlightSlide = AyahSlide;

const clamp = (min: number, max: number, v: number) => Math.min(max, Math.max(min, v));

/** Share of the canvas the ayah takes next to tafsir: a larger font gives the ayah more room. */
const ayahShareFor = (style: StyleConfig, base: number) => clamp(base - 0.15, base + 0.15, base * (style.fontSize / 64));

/** Square and wider canvases put tafsir beside the ayah; stacked, both get too short to read. */
const sideBySide = (l: Layout, width: number, height: number, hasTafsir: boolean) => l.landscape || (hasTafsir && width >= height);

export function AyahTafsirSlide({ withTafsir = true, ...props }: SlideProps & { withTafsir?: boolean }) {
  const { style, width, height, overMedia, slide } = props;
  const p = palette(style);
  const l = layoutFor(width, height, overMedia);
  const hasTafsir = withTafsir && Boolean(slide.tafsirPages.length || slide.ayah.tafsir);
  // The page carries its own header, so the banner's share of the height goes to the page.
  const available = budget(l, height, style.showWatermark) + l.bannerHeight + l.gap;
  const base = style.fontSize * l.u * (hasTafsir ? 1 : 1.25);
  const watermark = style.showWatermark ? <Watermark text={style.watermarkText} p={p} u={l.u} /> : null;

  if (sideBySide(l, width, height, hasTafsir)) {
    const row = l.innerWidth - (hasTafsir ? l.columnGap : 0);
    const pageWidth = hasTafsir ? row * ayahShareFor(style, 0.5) : Math.min(row, available * 1.35);
    const tafsirWidth = row - pageWidth;
    return (
      <Frame p={p} l={l} overMedia={overMedia}>
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
    <Frame p={p} l={l} overMedia={overMedia}>
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

/** Size of a scanned page drawn inside a `width` × `maxHeight` box (frame and header included). */
function scanBox(page: ScannedPage, width: number, maxHeight: number) {
  const { image } = page;
  const headerSize = Math.max(14, width * 0.03);
  const headerHeight = headerSize * 1.9;
  const frame = Math.max(6, width * 0.025);
  // The two opening pages are short; crop the empty space below their text.
  const allBoxes = Object.values(page.boxes ?? {}).flat();
  const visibleHeight =
    page.page <= 2 && allBoxes.length ? Math.min(image.height, Math.max(...allBoxes.map(([, y, , bh]) => y + bh)) + 60) : image.height;
  const scale = Math.min((width - frame * 2) / image.width, (maxHeight - headerHeight - frame * 2) / visibleHeight);
  return { headerSize, frame, scale, w: image.width * scale, h: visibleHeight * scale, outerWidth: image.width * scale + frame * 2 };
}

function MushafScan({ props, p, width, maxHeight, dimmed }: { props: SlideProps; p: Palette; width: number; maxHeight: number; dimmed?: boolean }) {
  const { mushafPage, surah, slide, style, surahName } = props;
  const image = mushafPage?.image;
  if (!mushafPage || !image) return null;
  const { headerSize, frame, scale, w, h, outerWidth } = scanBox({ ...mushafPage, image }, width, maxHeight);
  const pad = 10;
  const current = (mushafPage.boxes?.[`${surah}:${slide.ayah.number}`] ?? []).map(
    ([x, y, bw, bh]) => [x - pad, y - pad * 0.6, bw + pad * 2, bh + pad * 1.2] as const,
  );
  const maskId = `ayah-mask-${mushafPage.page}-${slide.ayah.number}`;
  const paper = paperOf(style);
  const inkId = `mushaf-ink-${paper.ink.replace("#", "")}`;
  const wordBoxes = mushafPage.words?.[`${surah}:${slide.ayah.number}`] ?? [];
  const word = (props.highlightedWordIndex ?? -1) >= 0 ? wordBoxes[Math.min(props.highlightedWordIndex!, wordBoxes.length - 1)] : undefined;
  const frameKind = style.mushafFrame ?? "classic";

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
        <Img src={image.url} style={{ width: w, height: image.height * scale, display: "block", filter: `url(#${inkId})` }} />
        {current.length || dimmed ? (
          <svg viewBox={`0 0 ${image.width} ${image.height}`} style={{ position: "absolute", top: 0, left: 0, width: w, height: image.height * scale }}>
            <defs>
              <mask id={maskId}>
                <rect x={0} y={0} width={image.width} height={image.height} fill="white" />
                {current.map(([x, y, bw, bh], i) => (
                  <rect key={i} x={x} y={y} width={bw} height={bh} rx={14} fill="black" />
                ))}
              </mask>
            </defs>
            <rect x={0} y={0} width={image.width} height={image.height} fill={paper.bg} opacity={0.6} mask={`url(#${maskId})`} />
            {current.map(([x, y, bw, bh], i) => (
              <rect key={i} x={x} y={y} width={bw} height={bh} rx={14} fill={p.primary} opacity={0.13} />
            ))}
            {word ? (
              <rect
                x={word[0] - 6}
                y={word[1] - 6}
                width={word[2] + 12}
                height={word[3] + 12}
                rx={12}
                fill={p.accent}
                fillOpacity={0.28}
                stroke={p.accent}
                strokeOpacity={0.7}
                strokeWidth={2.5}
              />
            ) : null}
          </svg>
        ) : null}
      </div>
    </div>
  );
}

export function MushafPageSlide(props: SlideProps) {
  const { style, width, height, slide, mushafPage, overMedia } = props;
  const p = palette(style);
  const l = layoutFor(width, height, overMedia);
  if (!mushafPage) return <AyahTafsirSlide {...props} />;

  const hasTafsir = Boolean(slide.tafsirPages.length || slide.ayah.tafsir);
  // The page carries its own running header (surah name, page number), so no separate banner is needed.
  const available = budget(l, height, style.showWatermark) + l.bannerHeight + l.gap;
  const watermark = style.showWatermark ? <Watermark text={style.watermarkText} p={p} u={l.u} /> : null;
  const page = (w: number, h: number) =>
    mushafPage.image ? <MushafScan props={props} p={p} width={w} maxHeight={h} /> : <MushafPageBlock props={props} p={p} width={w} maxHeight={h} />;

  if (l.landscape && !hasTafsir && props.facingPage) {
    // Open book: odd pages on the right, even on the left. Pages are tall, so height limits them —
    // use a tighter vertical margin and fit the panel to the pages.
    const sl = { ...l, padY: height * 0.035 };
    const pad = overMedia ? panelPad(l.u, true) : { x: 0, y: 0 };
    const gutter = 24 * l.u;
    const pageWidth = (width - l.padX * 2 - pad.x * 2 - gutter) / 2;
    const pageHeight = height - sl.padY * 2 - pad.y * 2 - (style.showWatermark ? l.watermarkHeight * 0.6 + l.gap : 0);
    const facing = { ...props, mushafPage: props.facingPage, highlightedWordIndex: -1 };
    const sides = mushafPage.page % 2 ? [facing, props] : [props, facing];
    return (
      <Frame p={p} l={sl} overMedia={overMedia} fit>
        <div style={{ display: "flex", flexDirection: "row", gap: gutter, alignItems: "center", justifyContent: "center", direction: "ltr" }}>
          {sides.map((side) =>
            side.mushafPage?.image ? (
              <MushafScan key={side.mushafPage.page} props={side} p={p} width={pageWidth} maxHeight={pageHeight} dimmed={side !== props} />
            ) : (
              <MushafPageBlock key={side.mushafPage?.page} props={side} p={p} width={pageWidth} maxHeight={pageHeight} />
            ),
          )}
        </div>
        {style.showWatermark ? <Watermark text={style.watermarkText} p={p} u={l.u} /> : null}
      </Frame>
    );
  }

  if (sideBySide(l, width, height, hasTafsir)) {
    // Full pages are tall, so height usually limits them; the tafsir takes whatever width the page leaves.
    const row = l.innerWidth - (hasTafsir ? l.columnGap : 0);
    const maxPage = hasTafsir ? row * 0.6 : row;
    const pageWidth = mushafPage.image ? Math.min(maxPage, scanBox({ ...mushafPage, image: mushafPage.image }, maxPage, available).outerWidth) : maxPage;
    const tafsirWidth = row - pageWidth;
    return (
      <Frame p={p} l={l} overMedia={overMedia}>
        <div style={{ display: "flex", flexDirection: "row", gap: l.columnGap, alignItems: "center", justifyContent: "center" }}>
          <div style={{ flex: "none", display: "flex", flexDirection: "column" }}>{page(maxPage, available)}</div>
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

  const pageShare = hasTafsir ? 0.68 : 1;
  return (
    <Frame p={p} l={l} overMedia={overMedia}>
      {page(l.columnWidth, available * pageShare)}
      {hasTafsir ? (
        <div style={{ height: available * (1 - pageShare) - l.gap, display: "flex", flexDirection: "column", gap: l.gap * 0.5, overflow: "hidden" }}>
          <TafsirBlock props={props} l={l} p={p} maxHeight={available * (1 - pageShare) - l.gap} />
        </div>
      ) : null}
      {watermark}
    </Frame>
  );
}
