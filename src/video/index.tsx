import { Composition, registerRoot } from "remotion";
import { Clip } from "./Clip";
import { FPS, HEIGHT, WIDTH, totalFrames, type ClipProps } from "./types";

const defaultProps: ClipProps = { surahName: "", ayat: [] };

registerRoot(() => (
  <Composition
    id="Clip"
    component={Clip}
    width={WIDTH}
    height={HEIGHT}
    fps={FPS}
    durationInFrames={1}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => ({ durationInFrames: totalFrames(props) })}
  />
));
