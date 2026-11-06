/**
 * People detector: COCO-SSD on TensorFlow.js (WASM backend, no native addon) with sharp for decoding.
 * Returns "unchecked" when the model cannot load (e.g. offline) so callers can decide not to cache it.
 */

export type Verdict = {
  hasPerson: boolean;
  confidence: number;
  method: "coco-ssd" | "tags" | "unchecked";
};

type Detector = {
  detectImage(buffer: Buffer): Promise<Verdict>;
};

const PERSON_THRESHOLD = 0.35;
const DETECT_SIZE = 320;

let detectorPromise: Promise<Detector | null> | null = null;
let loadError: string | null = null;

async function loadDetector(): Promise<Detector | null> {
  try {
    const tf = await import("@tensorflow/tfjs");
    await import("@tensorflow/tfjs-backend-wasm");
    await tf.setBackend("wasm");
    await tf.ready();
    const coco = await import("@tensorflow-models/coco-ssd");
    const sharp = (await import("sharp")).default;
    const model = await coco.load({ base: "lite_mobilenet_v2" });
    return {
      async detectImage(buffer: Buffer) {
        const { data, info } = await sharp(buffer)
          .resize(DETECT_SIZE, DETECT_SIZE, { fit: "inside" })
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const image = tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3], "int32");
        try {
          const predictions = await model.detect(image, 20, 0.2);
          const person = predictions
            .filter((p) => p.class === "person")
            .sort((a, b) => b.score - a.score)[0];
          const confidence = person?.score ?? 0;
          return { hasPerson: confidence >= PERSON_THRESHOLD, confidence, method: "coco-ssd" as const };
        } finally {
          image.dispose();
        }
      },
    };
  } catch (e) {
    loadError = (e as Error).message;
    console.warn("[autoayah] people detector unavailable:", loadError);
    return null;
  }
}

export async function getDetector(): Promise<Detector | null> {
  detectorPromise ??= loadDetector().then((d) => {
    // Allow a later retry (e.g. the model download failed while offline).
    if (!d) setTimeout(() => (detectorPromise = null), 60_000).unref?.();
    return d;
  });
  return detectorPromise;
}

/** Start loading the model in the background so the first search is fast. */
export function warmDetector() {
  void getDetector();
}

export function detectorStatus(): { ready: boolean; error: string | null } {
  return { ready: detectorPromise != null && loadError == null, error: loadError };
}

export async function detectPeopleInImage(buffer: Buffer): Promise<Verdict> {
  const det = await getDetector();
  if (!det) return { hasPerson: false, confidence: 0, method: "unchecked" };
  try {
    return await det.detectImage(buffer);
  } catch {
    return { hasPerson: false, confidence: 0, method: "unchecked" };
  }
}

export async function detectPeopleInVideo(
  videoPath: string,
  extractFrames: (path: string, count: number) => Promise<Buffer[]>,
): Promise<Verdict> {
  try {
    const frames = await extractFrames(videoPath, 4);
    let maxConf = 0;
    for (const frame of frames) {
      const v = await detectPeopleInImage(frame);
      if (v.method === "unchecked") return v;
      if (v.hasPerson) return v;
      maxConf = Math.max(maxConf, v.confidence);
    }
    return { hasPerson: false, confidence: maxConf, method: "coco-ssd" };
  } catch {
    return { hasPerson: false, confidence: 0, method: "unchecked" };
  }
}
