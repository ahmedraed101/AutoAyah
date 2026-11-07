import { describe, expect, it } from "vitest";
import { cbrByteRange, cbrLayout, joinMp3Cuts, sliceCbrChunk, sliceMp3 } from "./mp3.js";

const FRAME_MS = (1152 / 44100) * 1000;
const EXACT_BYTES = (144 * 128000) / 44100;

/** MPEG-1 Layer III, 128 kbps, 44.1 kHz; the first payload bytes number the frame so cuts can be checked. */
function frame(index: number, padding: boolean, payload?: Buffer): Buffer {
  const buf = Buffer.alloc(Math.floor(EXACT_BYTES) + (padding ? 1 : 0), 0x11);
  buf[0] = 0xff;
  buf[1] = 0xfb;
  buf[2] = (9 << 4) | (padding ? 2 : 0);
  buf[3] = 0x44;
  buf.writeUInt16BE(index, 4);
  payload?.copy(buf, 36);
  return buf;
}

/** `drift`: skip the padding byte on every 10th frame, as some encoders do, so the nominal frame size overshoots. */
function cbrFile(frames: number, opts: { id3?: number; info?: boolean; drift?: boolean } = {}): Buffer {
  const audio: Buffer[] = [];
  // Encoders pad a frame whenever the running byte count falls a whole byte behind.
  for (let k = 0; k < frames; k++) {
    const pad = Math.floor((k + 1) * EXACT_BYTES) - Math.floor(k * EXACT_BYTES) > Math.floor(EXACT_BYTES);
    audio.push(frame(k, pad && !(opts.drift && k % 10 === 0)));
  }
  const parts: Buffer[] = [];
  if (opts.id3) {
    const tag = Buffer.alloc(10 + opts.id3);
    tag.write("ID3", 0, "latin1");
    tag[3] = 4;
    tag[6] = (opts.id3 >> 21) & 0x7f;
    tag[7] = (opts.id3 >> 14) & 0x7f;
    tag[8] = (opts.id3 >> 7) & 0x7f;
    tag[9] = opts.id3 & 0x7f;
    parts.push(tag);
  }
  if (opts.info !== false) {
    const tag = Buffer.alloc(16);
    tag.write("Info", 0, "latin1");
    tag.writeUInt32BE(3, 4);
    tag.writeUInt32BE(frames, 8);
    tag.writeUInt32BE(Math.floor(EXACT_BYTES) + audio.reduce((n, b) => n + b.length, 0), 12);
    parts.push(frame(0xfff0, false, tag));
  }
  return Buffer.concat([...parts, ...audio]);
}

const indices = (buf: Buffer) => {
  const out: number[] = [];
  for (let i = 0; i < buf.length; ) {
    out.push(buf.readUInt16BE(i + 4));
    i += Math.floor(EXACT_BYTES) + ((buf[i + 2]! >> 1) & 1);
  }
  return out;
};

describe("CBR range slicing", () => {
  const file = cbrFile(3000, { id3: 300 });
  const layout = cbrLayout(file.subarray(0, 64 * 1024))!;

  it("reads the layout past the ID3 tag and Info frame", () => {
    expect(layout).not.toBeNull();
    expect(layout.dataStart).toBe(310 + Math.floor(EXACT_BYTES));
    expect(layout.frameBytes).toBeCloseTo(EXACT_BYTES, 2);
    expect(layout.frameMs).toBeCloseTo(FRAME_MS, 6);
  });

  it("cuts the same frames from a byte range as sliceMp3 does from the whole file", () => {
    for (const [from, to] of [
      [0, 500],
      [12_345, 13_000],
      [40_000, 52_000],
      [77_000, 78_000],
    ] as const) {
      const [start, end] = cbrByteRange(layout, from, to);
      const cut = sliceCbrChunk(file.subarray(start, end + 1), start, layout, from, to)!;
      expect(cut).not.toBeNull();
      const want = indices(sliceMp3(file, from, to));
      expect(indices(cut)).toEqual(want);
      expect(want[0]).toBe(Math.floor(from / FRAME_MS));
      expect(want[want.length - 1]).toBe(Math.ceil(to / FRAME_MS) - 1);
    }
  });

  it("stays frame-exact deep into a file whose padding drifts from the nominal rate", () => {
    const drifted = cbrFile(3000, { drift: true });
    const exact = cbrLayout(drifted.subarray(0, 64 * 1024))!;
    expect(exact.exact).toBe(true);
    expect(exact.frameBytes).toBeLessThan(EXACT_BYTES);
    const [from, to] = [75_000, 76_000];
    const [start, end] = cbrByteRange(exact, from, to);
    const cut = sliceCbrChunk(drifted.subarray(start, end + 1), start, exact, from, to)!;
    expect(indices(cut)).toEqual(indices(sliceMp3(drifted, from, to)));
  });

  it("rejoins consecutive cuts into the cut of their whole span", () => {
    const bounds = [1000, 1280, 2000.5, 5000];
    const cuts = bounds.slice(1).map((to, i) => sliceMp3(file, bounds[i]!, to));
    expect(indices(joinMp3Cuts(cuts, bounds.slice(1, -1)))).toEqual(indices(sliceMp3(file, 1000, 5000)));
  });

  it("treats files without an Info tag as CBR when every frame shares a bitrate", () => {
    const bare = cbrFile(200, { info: false });
    expect(cbrLayout(bare)?.dataStart).toBe(0);
  });

  it("rejects VBR files", () => {
    const vbr = Buffer.concat([frame(0xfff0, false, Buffer.from("Xing", "latin1")), cbrFile(50, { info: false })]);
    expect(cbrLayout(vbr)).toBeNull();
    const mixed = cbrFile(50, { info: false });
    mixed[Math.floor(EXACT_BYTES * 10) + 2] = 10 << 4;
    expect(cbrLayout(mixed)).toBeNull();
  });
});
