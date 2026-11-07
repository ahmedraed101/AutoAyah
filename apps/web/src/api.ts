import type { AppConfig, Job, MediaRef, Project, QuranDivisions, VideoConfig } from "@autoayah/core";
import type { CompositionProps } from "@autoayah/templates";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const isForm = init?.body instanceof FormData;
  const res = await fetch(url, {
    ...init,
    headers: isForm ? init?.headers : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    credentials: "include",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
  return body as T;
}

export type MediaResult = MediaRef & { type: "image" | "video"; checked?: boolean };
export type PreviewResult = CompositionProps & { warnings: string[] };

export type LibraryType = "recitation" | "mushaf" | "tafsir" | "translation" | "text" | "imports" | "app";
export type LibraryGroup = {
  type: LibraryType;
  id: string;
  name: string;
  nameAr?: string;
  language?: string;
  bytes: number;
  files: number;
  surahs: { surah: number; have: number; total: number; bytes: number }[];
  pages: number[];
};
export type DownloadRequest = { type: "recitation" | "mushaf" | "tafsir" | "translation"; id?: string; surahFrom: number; surahTo: number };
export type DownloadTask = DownloadRequest & {
  taskId: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  done: number;
  total: number;
  failed: number;
  error?: string;
};

export const api = {
  config: () => json<AppConfig>("/api/config"),
  surahs: () => json<{ number: number; name: string; englishName: string; numberOfAyahs: number }[]>("/api/surahs"),
  divisions: () => json<QuranDivisions>("/api/divisions"),
  reciters: () => json<{ id: string; name: string; nameAr?: string; hasWordTimings: boolean }[]>("/api/reciters"),
  tafsirs: () => json<{ id: string; name: string; language: string }[]>("/api/tafsirs"),
  translations: () => json<{ id: string; name: string; language: string }[]>("/api/translations"),
  preview: (config: VideoConfig, signal?: AbortSignal) =>
    json<PreviewResult>("/api/preview", { method: "POST", body: JSON.stringify(config), signal }),
  /** Text and pages only, no recitation: fast enough to follow every edit. */
  draft: (config: VideoConfig, signal?: AbortSignal) =>
    json<PreviewResult>("/api/preview?draft=1", { method: "POST", body: JSON.stringify(config), signal }),
  createJob: (config: VideoConfig) => json<Job>("/api/jobs", { method: "POST", body: JSON.stringify(config) }),
  jobs: () => json<Job[]>("/api/jobs"),
  job: (id: string) => json<Job>(`/api/jobs/${id}`),
  cancelJob: (id: string) => json<Job>(`/api/jobs/${id}/cancel`, { method: "POST" }),
  retryJob: (id: string) => json<Job>(`/api/jobs/${id}/retry`, { method: "POST" }),
  deleteJob: (id: string) => json<{ ok: boolean }>(`/api/jobs/${id}`, { method: "DELETE" }),
  projects: () => json<Project[]>("/api/projects"),
  saveProject: (p: { id?: string; config: VideoConfig }) =>
    json<Project>("/api/projects", { method: "POST", body: JSON.stringify(p) }),
  deleteProject: (id: string) => json<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),
  keysStatus: () => json<Record<string, boolean | string>>("/api/keys"),
  saveKeys: (keys: Record<string, string | null>) => json<{ ok: boolean }>("/api/keys", { method: "PUT", body: JSON.stringify(keys) }),
  testQf: (keys: { qfClientId?: string; qfClientSecret?: string }) =>
    json<{ ok: boolean; message: string }>("/api/qf/test", { method: "POST", body: JSON.stringify(keys) }),
  library: () => json<{ groups: LibraryGroup[]; totalBytes: number; downloads: DownloadTask[] }>("/api/library"),
  removeLibrary: (target: { type: LibraryType; id: string; surah?: number }) =>
    json<{ removed: number }>("/api/library/remove", { method: "POST", body: JSON.stringify(target) }),
  startDownload: (req: DownloadRequest) => json<DownloadTask>("/api/library/downloads", { method: "POST", body: JSON.stringify(req) }),
  dismissDownload: (taskId: string) => json<{ ok: boolean }>(`/api/library/downloads/${taskId}`, { method: "DELETE" }),
  importLibrary: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return json<{ key: string }>("/api/library/import", { method: "POST", body: fd });
  },
  searchMedia: (body: { query: string; kind: "image" | "video"; page?: number; keys?: Record<string, string | undefined> }) =>
    json<{ results: MediaResult[]; unchecked: number; page: number; hasMore: boolean; detector: { ready: boolean; error: string | null } }>("/api/media/search", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  uploadMedia: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return json<MediaResult>("/api/media/upload", { method: "POST", body: fd });
  },
  trackUnsplash: (downloadLocation: string, accessKey?: string) =>
    json<{ ok: boolean }>("/api/media/unsplash-download", { method: "POST", body: JSON.stringify({ downloadLocation, accessKey }) }),
  authStatus: () => json<{ required: boolean; authenticated: boolean }>("/api/auth/status"),
  login: (password: string) => json<{ ok: boolean }>("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
};
