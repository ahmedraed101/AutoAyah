const BITRATES = {
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] } as Record<number, number[]>;

type Frame = { offset: number; length: number; ms: number; bitrate: number; sampleRate: number; samples: number };

export function id3Size(buf: Buffer): number {
  if (buf.length < 10 || buf.toString("latin1", 0, 3) !== "ID3") return 0;
  const size = ((buf[6]! & 0x7f) << 21) | ((buf[7]! & 0x7f) << 14) | ((buf[8]! & 0x7f) << 7) | (buf[9]! & 0x7f);
  return 10 + size + (buf[5]! & 0x10 ? 10 : 0);
}

function frameAt(buf: Buffer, i: number): Frame | null {
  if (i + 4 > buf.length || buf[i] !== 0xff || (buf[i + 1]! & 0xe0) !== 0xe0) return null;
  const version = (buf[i + 1]! >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
  const layer = (buf[i + 1]! >> 1) & 3; // 1 = Layer III
  const bitrateIdx = buf[i + 2]! >> 4;
  const srIdx = (buf[i + 2]! >> 2) & 3;
  const padding = (buf[i + 2]! >> 1) & 1;
  if (version === 1 || layer !== 1 || bitrateIdx === 0 || bitrateIdx === 15 || srIdx === 3) return null;
  const bitrate = (version === 3 ? BITRATES.v1 : BITRATES.v2)[bitrateIdx]! * 1000;
  const sampleRate = SAMPLE_RATES[version]![srIdx]!;
  const samples = version === 3 ? 1152 : 576;
  const length = Math.floor(((samples / 8) * bitrate) / sampleRate) + padding;
  return { offset: i, length, ms: (samples / sampleRate) * 1000, bitrate, sampleRate, samples };
}

/** A frame header that is followed by another one of the same stream (or by the end of the buffer). */
function syncedFrameAt(buf: Buffer, i: number): Frame | null {
  const f = frameAt(buf, i);
  if (!f) return null;
  if (i + f.length + 4 > buf.length) return f;
  const next = frameAt(buf, i + f.length);
  return next && next.sampleRate === f.sampleRate && next.samples === f.samples ? f : null;
}

function nextSync(buf: Buffer, i: number): Frame | null {
  for (; i + 4 <= buf.length; i++) {
    const f = syncedFrameAt(buf, i);
    if (f) return f;
  }
  return null;
}

const isInfoFrame = (buf: Buffer, f: Frame) => {
  const head = buf.toString("latin1", f.offset, f.offset + Math.min(f.length, 64));
  return head.includes("Xing") || head.includes("Info") || head.includes("VBRI");
};

/** Cut [startMs, endMs) out of an MP3 at frame boundaries (no re-encoding). */
export function sliceMp3(buf: Buffer, startMs: number, endMs: number): Buffer {
  const parts: Buffer[] = [];
  let i = id3Size(buf);
  let t = 0;
  let first = true;
  while (i < buf.length && t < endMs) {
    const f = frameAt(buf, i);
    if (!f) {
      i++;
      continue;
    }
    if (first && isInfoFrame(buf, f)) {
      first = false;
      i += f.length;
      continue;
    }
    first = false;
    if (t + f.ms > startMs) parts.push(buf.subarray(f.offset, f.offset + f.length));
    t += f.ms;
    i += f.length;
  }
  return Buffer.concat(parts);
}

/** Rejoin `sliceMp3` cuts made at consecutive `boundariesMs`: a frame straddling a boundary is in both neighbours. */
export function joinMp3Cuts(cuts: Buffer[], boundariesMs: number[]): Buffer {
  return Buffer.concat(
    cuts.map((cut, i) => {
      const f = i > 0 ? frameAt(cut, 0) : null;
      if (!f) return cut;
      // Accumulate frame times the way sliceMp3 does so exact multiples land on the same side.
      const b = boundariesMs[i - 1]!;
      let t = 0;
      while (t + f.ms <= b) t += f.ms;
      return t < b ? cut.subarray(f.length) : cut;
    }),
  );
}

/**
 * Constant-bitrate stream layout: frame k starts near `dataStart + k * frameBytes`. `exact` when the average frame size
 * comes from the Info tag's frame and byte counts; encoders pad slightly differently from the nominal rate, so without
 * them the estimate can drift by a fraction of a frame over a long file.
 */
export type CbrLayout = { dataStart: number; frameBytes: number; frameMs: number; bitrate: number; sampleRate: number; exact: boolean };

/**
 * Reads the layout from the first bytes of a file (`base` = absolute offset of `buf`, past any ID3 tag when > 0).
 * Null for VBR ("Xing"/"VBRI") or when the frames seen don't all share one bitrate.
 */
export function cbrLayout(buf: Buffer, base = 0): CbrLayout | null {
  const first = nextSync(buf, base ? 0 : id3Size(buf));
  if (!first) return null;
  const head = buf.toString("latin1", first.offset, first.offset + Math.min(first.length, 64));
  if (head.includes("Xing") || head.includes("VBRI")) return null;
  let i = head.includes("Info") ? first.offset + first.length : first.offset;
  const dataStart = base + i;
  let audio: Frame | null = null;
  let frames = 0;
  for (let f = frameAt(buf, i); f && i + f.length <= buf.length; i += f.length, f = frameAt(buf, i)) {
    audio ??= f;
    if (f.bitrate !== audio.bitrate || f.sampleRate !== audio.sampleRate) return null;
    frames++;
  }
  if (!audio || frames < 8) return null;
  const nominal = ((audio.samples / 8) * audio.bitrate) / audio.sampleRate;
  let frameBytes = nominal;
  const tag = head.indexOf("Info");
  if (tag >= 0 && first.offset + tag + 16 <= buf.length) {
    const at = first.offset + tag;
    // Info flags: bit 0 = frame count follows, bit 1 = byte count (which includes the Info frame itself).
    if ((buf.readUInt32BE(at + 4) & 3) === 3) {
      const count = buf.readUInt32BE(at + 8);
      const avg = (buf.readUInt32BE(at + 12) - first.length) / count;
      if (count > 0 && Math.abs(avg - nominal) < 1) frameBytes = avg;
    }
  }
  return { dataStart, frameBytes, frameMs: audio.ms, bitrate: audio.bitrate, sampleRate: audio.sampleRate, exact: frameBytes !== nominal };
}

const RANGE_MARGIN = 4096;

/** Inclusive byte range that holds every frame overlapping [fromMs, toMs), with room to resync on either side. */
export function cbrByteRange(layout: CbrLayout, fromMs: number, toMs: number): [number, number] {
  const first = Math.floor(fromMs / layout.frameMs);
  const last = Math.ceil(toMs / layout.frameMs);
  return [
    Math.max(0, layout.dataStart + Math.floor(first * layout.frameBytes) - RANGE_MARGIN),
    layout.dataStart + Math.ceil(last * layout.frameBytes) + RANGE_MARGIN,
  ];
}

/**
 * Cut [fromMs, toMs) out of `chunk`, which holds the file's bytes from absolute offset `chunkStart`.
 * Frame numbers come from byte offsets (within a frame without an exact layout); null when the chunk doesn't look CBR or misses the start.
 */
export function sliceCbrChunk(chunk: Buffer, chunkStart: number, layout: CbrLayout, fromMs: number, toMs: number): Buffer | null {
  const parts: Buffer[] = [];
  const wanted = Math.floor(fromMs / layout.frameMs);
  let f = nextSync(chunk, Math.max(0, layout.dataStart - chunkStart));
  let k: number | null = null;
  let started = false;
  while (f) {
    if (f.bitrate !== layout.bitrate || f.sampleRate !== layout.sampleRate) return null;
    if (k == null) {
      const pos = (chunkStart + f.offset - layout.dataStart) / layout.frameBytes;
      k = Math.round(pos);
      if (layout.exact && Math.abs(pos - k) > 0.05) return null;
    }
    if (k * layout.frameMs >= toMs) break;
    if ((k + 1) * layout.frameMs > fromMs) {
      if (!started && k > wanted) return null;
      started = true;
      if (f.offset + f.length > chunk.length) break;
      parts.push(chunk.subarray(f.offset, f.offset + f.length));
    }
    const next = frameAt(chunk, f.offset + f.length);
    if (next) k++;
    else k = null;
    f = next ?? nextSync(chunk, f.offset + 1);
  }
  return started ? Buffer.concat(parts) : null;
}
