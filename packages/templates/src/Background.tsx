import type { BackgroundSegment, StyleConfig } from "@autoayah/core";

type Props = {
  segment?: BackgroundSegment;
  style: StyleConfig;
  width: number;
  height: number;
  /** When true, show video element (Remotion will wrap with OffthreadVideo). */
  videoElement?: React.ReactNode;
  imageElement?: React.ReactNode;
};

export function BackgroundLayer({ segment, style, width, height, videoElement, imageElement }: Props) {
  const base = style.theme === "dark" ? "#0b0f0c" : style.backgroundColor;
  if (!segment || segment.type === "color") {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          width,
          height,
          background: segment?.color ?? base,
        }}
      />
    );
  }
  if (segment.type === "gradient") {
    const [a, b] = segment.gradient ?? [base, style.primaryColor];
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          width,
          height,
          background: `linear-gradient(160deg, ${a}, ${b})`,
        }}
      />
    );
  }
  if (segment.type === "image" && imageElement) {
    return <div style={{ position: "absolute", inset: 0, width, height }}>{imageElement}</div>;
  }
  if (segment.type === "video" && videoElement) {
    return <div style={{ position: "absolute", inset: 0, width, height }}>{videoElement}</div>;
  }
  return (
    <div style={{ position: "absolute", inset: 0, width, height, background: base }} />
  );
}
