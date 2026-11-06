const BITRATES = {
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] } as Record<number, number[]>;

type Frame = { offset: number; length: number; ms: number };

function id3Size(buf: Buffer): number {
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
  return { offset: i, length, ms: (samples / sampleRate) * 1000 };
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
