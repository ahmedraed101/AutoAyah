import type { Capabilities, ResolvedClip, VideoConfig } from "@autoayah/core";

export type CacheKind =
  | "ayah_text"
  | "tafsir"
  | "translation"
  | "audio"
  | "word_timings"
  | "mushaf_layout"
  | "font"
  | "qul_import"
  | "other";

export type CacheEntry = {
  key: string;
  kind: CacheKind;
  source: string;
  path: string;
  size: number;
  pinned: boolean;
  lastUsed: string;
  createdAt: string;
  meta?: Record<string, unknown>;
};

export type CacheStore = {
  get(key: string): Promise<CacheEntry | null>;
  put(entry: Omit<CacheEntry, "createdAt" | "lastUsed"> & { createdAt?: string }): Promise<CacheEntry>;
  touch(key: string): Promise<void>;
  remove(key: string): Promise<void>;
  list(filter?: { kind?: CacheKind }): Promise<CacheEntry[]>;
  totalBytes(): Promise<number>;
  readFile(key: string): Promise<Buffer | null>;
  writeFile(key: string, kind: CacheKind, source: string, data: Buffer, pinned?: boolean, meta?: Record<string, unknown>): Promise<CacheEntry>;
};

export type QfCredentials = {
  clientId: string;
  clientSecret: string;
  env?: "prelive" | "production";
};

export type ResolveOptions = {
  cache: CacheStore;
  qf?: QfCredentials | null;
  dataDir: string;
};

export type ClipRequest = Pick<VideoConfig, "surah" | "from" | "to" | "reciter" | "tafsir" | "translation" | "mode"> & {
  style?: { tajweed?: boolean };
};

export type Resolver = {
  getSurahs(): Promise<{ number: number; name: string; englishName: string; numberOfAyahs: number }[]>;
  getReciters(): Promise<{ id: string; name: string; source: string; hasWordTimings: boolean }[]>;
  getTafsirs(): Promise<{ id: string; name: string; language: string; source: string }[]>;
  getTranslations(): Promise<{ id: string; name: string; language: string; source: string }[]>;
  resolveClip(config: ClipRequest): Promise<ResolvedClip>;
  capabilities(): Promise<Capabilities>;
  /** Recitation audio from the local cache, downloading it once if needed. */
  getAudio(reciter: string, surah: number, ayah: number): Promise<{ data: Buffer; seconds: number }>;
  /** Scanned Mushaf page from the local cache, downloading it once if needed. */
  getMushafImage(page: number): Promise<{ data: Buffer; width: number; height: number }>;
  importQulFile(filename: string, data: Buffer, kind: CacheKind): Promise<CacheEntry>;
};
