import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Procedurally generated, music-free ambience loops. Deterministic (seeded), so every install
 * produces identical public-domain files without shipping binaries.
 */

export const AMBIENCE_IDS = ["rain", "wind", "ocean", "forest"] as const;
export type AmbienceId = (typeof AMBIENCE_IDS)[number];

const SAMPLE_RATE = 32_000;
const LOOP_SECONDS = 30;
const CROSSFADE_SECONDS = 2;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pinkNoise(n: number, rand: () => number): Float32Array {
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = rand() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return out;
}

function brownNoise(n: number, rand: () => number): Float32Array {
  const out = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    last = (last + 0.02 * (rand() * 2 - 1)) / 1.02;
    out[i] = last * 3.5;
  }
  return out;
}

function onePoleLowpass(buf: Float32Array, cutoffHz: number) {
  const a = Math.exp((-2 * Math.PI * cutoffHz) / SAMPLE_RATE);
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y = (1 - a) * buf[i]! + a * y;
    buf[i] = y;
  }
}

function onePoleHighpass(buf: Float32Array, cutoffHz: number) {
  const a = Math.exp((-2 * Math.PI * cutoffHz) / SAMPLE_RATE);
  let y = 0;
  let xPrev = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]!;
    y = a * (y + x - xPrev);
    xPrev = x;
    buf[i] = y;
  }
}

function rain(n: number, rand: () => number): Float32Array {
  const out = pinkNoise(n, rand);
  onePoleHighpass(out, 400);
  for (let i = 0; i < n; i++) out[i]! *= 0.6;
  const drops = Math.floor((n / SAMPLE_RATE) * 35);
  for (let d = 0; d < drops; d++) {
    const start = Math.floor(rand() * n);
    const amp = 0.05 + rand() * 0.25;
    const len = Math.floor(SAMPLE_RATE * (0.004 + rand() * 0.012));
    for (let k = 0; k < len && start + k < n; k++) {
      out[start + k]! += (rand() * 2 - 1) * amp * Math.exp((-6 * k) / len);
    }
  }
  return out;
}

function wind(n: number, rand: () => number): Float32Array {
  const out = brownNoise(n, rand);
  const howl = pinkNoise(n, rand);
  onePoleLowpass(howl, 900);
  const p1 = rand() * Math.PI * 2;
  const p2 = rand() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    // Loop-friendly LFO periods (divide LOOP_SECONDS evenly).
    const gust = 0.55 + 0.3 * Math.sin((2 * Math.PI * t) / 15 + p1) + 0.15 * Math.sin((2 * Math.PI * t) / 6 + p2);
    out[i] = (out[i]! * 0.8 + howl[i]! * 0.5) * gust;
  }
  return out;
}

function ocean(n: number, rand: () => number): Float32Array {
  const out = brownNoise(n, rand);
  const foam = pinkNoise(n, rand);
  onePoleHighpass(foam, 600);
  const periods = [10, 7.5, 6];
  const phases = periods.map(() => rand() * Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    let env = 0;
    periods.forEach((p, k) => {
      env += Math.pow(Math.max(0, Math.sin((2 * Math.PI * t) / p + phases[k]!)), 3) / periods.length;
    });
    out[i] = out[i]! * (0.35 + 0.9 * env) + foam[i]! * env * 0.45;
  }
  return out;
}

function forest(n: number, rand: () => number): Float32Array {
  const out = pinkNoise(n, rand);
  onePoleLowpass(out, 1500);
  for (let i = 0; i < n; i++) out[i]! *= 0.25;
  let t = 0.5;
  const total = n / SAMPLE_RATE;
  while (t < total - 1) {
    const base = 2600 + rand() * 1800;
    const notes = 2 + Math.floor(rand() * 4);
    let nt = t;
    for (let k = 0; k < notes; k++) {
      const dur = 0.05 + rand() * 0.1;
      const sweep = (rand() - 0.3) * 1400;
      const start = Math.floor(nt * SAMPLE_RATE);
      const len = Math.floor(dur * SAMPLE_RATE);
      let phase = 0;
      for (let s = 0; s < len && start + s < n; s++) {
        const x = s / len;
        phase += (2 * Math.PI * (base + sweep * x)) / SAMPLE_RATE;
        out[start + s]! += Math.sin(phase) * Math.sin(Math.PI * x) * 0.18;
      }
      nt += dur + 0.03 + rand() * 0.08;
    }
    t = nt + 1.5 + rand() * 3.5;
  }
  return out;
}

const GENERATORS: Record<AmbienceId, (n: number, rand: () => number) => Float32Array> = { rain, wind, ocean, forest };
const SEEDS: Record<AmbienceId, number> = { rain: 11, wind: 23, ocean: 37, forest: 53 };

function toLoopingWav(raw: Float32Array): Buffer {
  const loop = LOOP_SECONDS * SAMPLE_RATE;
  const fade = CROSSFADE_SECONDS * SAMPLE_RATE;
  const samples = new Float32Array(loop);
  for (let i = 0; i < loop; i++) {
    if (i < fade) {
      const g = i / fade;
      samples[i] = raw[i]! * g + raw[loop + i]! * (1 - g);
    } else {
      samples[i] = raw[i]!;
    }
  }
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const gain = peak > 0 ? 0.8 / peak : 1;

  const header = Buffer.alloc(44);
  const dataBytes = loop * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  const data = Buffer.alloc(dataBytes);
  for (let i = 0; i < loop; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i]! * gain)) * 32767), i * 2);
  }
  return Buffer.concat([header, data]);
}

export function generateAmbience(id: AmbienceId): Buffer {
  const n = (LOOP_SECONDS + CROSSFADE_SECONDS) * SAMPLE_RATE;
  return toLoopingWav(GENERATORS[id](n, rng(SEEDS[id])));
}

/** Write any missing (or empty) ambience loops into `dir`. */
export function ensureAmbienceFiles(dir: string) {
  mkdirSync(dir, { recursive: true });
  for (const id of AMBIENCE_IDS) {
    const file = path.join(dir, `${id}.wav`);
    if (existsSync(file) && statSync(file).size > 44) continue;
    writeFileSync(file, generateAmbience(id));
  }
}
