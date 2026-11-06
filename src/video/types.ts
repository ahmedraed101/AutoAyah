export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

export type Ayah = {
  number: number;
  text: string;
  tafsir?: string;
  audioUrl: string;
  durationInSeconds: number;
  durationInFrames: number;
};

export type ClipProps = {
  surahName: string;
  tafsirName?: string;
  ayat: Ayah[];
};

export const totalFrames = (props: ClipProps) =>
  Math.max(1, props.ayat.reduce((sum, a) => sum + a.durationInFrames, 0));
