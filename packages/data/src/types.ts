import type { Capabilities, QuranDivisions, ResolvedClip, VideoConfig } from "@autoayah/core";
import type { LibraryNames } from "./library.js";

export type CacheKind =
  | "ayah_text"
  | "tafsir"
  | "translation"
  | "audio"
  | "word_timings"
  | "mushaf_layout"
  | "font"
  | "qul_import"
  | "background"
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
  /** Protect an entry from LRU eviction. */
  pin(key: string): Promise<void>;
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
  toSurah?: number | null;
  aspectRatio?: VideoConfig["aspectRatio"];
  style?: { tajweed?: boolean; mushafView?: "page" | "follow" };
  /** Text only: skip recitation audio and word timings, and estimate each ayah's length. */
  draft?: boolean;
};

export type Resolver = {
  getSurahs(): Promise<{ number: number; name: string; englishName: string; numberOfAyahs: number }[]>;
  getReciters(): Promise<{ id: string; name: string; nameAr?: string; source: string; hasWordTimings: boolean }[]>;
  getTafsirs(): Promise<{ id: string; name: string; language: string; source: string }[]>;
  getTranslations(): Promise<{ id: string; name: string; language: string; source: string }[]>;
  resolveClip(config: ClipRequest): Promise<ResolvedClip>;
  /** Juz, hizb, rub', page and manzil boundaries. */
  getDivisions(): Promise<QuranDivisions>;
  capabilities(): Promise<Capabilities>;
  /** Recitation audio from the local cache, downloading it once if needed. */
  getAudio(reciter: string, surah: number, ayah: number): Promise<{ data: Buffer; seconds: number }>;
  /** Ayat `from`–`to` as one uninterrupted cut of the reciter's surah recording (see `ResolvedAyah.run`). */
  getAudioRun(reciter: string, surah: number, from: number, to: number): Promise<{ data: Buffer; seconds: number }>;
  /** Scanned Mushaf page from the local cache, downloading it once if needed. */
  getMushafImage(page: number, hd?: boolean): Promise<{ data: Buffer; width: number; height: number }>;
  importQulFile(filename: string, data: Buffer, kind: CacheKind): Promise<CacheEntry>;
  /** Display names for every id the library can hold, including ones hidden from the pickers. */
  libraryNames(): Promise<LibraryNames>;
  /** Uthmani + tajweed text of a whole surah. */
  prefetchSurahText(surah: number): Promise<void>;
  /** Word timings and audio file index for one reciter's surah, when the reciter has them. */
  prefetchRecitationIndex(reciter: string, surah: number): Promise<void>;
  prefetchEdition(kind: "tafsir" | "translation", id: string, surah: number): Promise<void>;
  mushafPagesOf(surah: number): Promise<number[]>;
  /** Layout, scan and word boxes for one Mushaf page. */
  prefetchMushafPage(page: number): Promise<void>;
};
