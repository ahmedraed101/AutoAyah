import type { MediaRef } from "@autoayah/core";
import { containsBlockedTag, sanitizeQuery } from "./blocklist.js";

export type ProviderKeys = {
  pexels?: string;
  unsplash?: string;
  pixabay?: string;
  freesound?: string;
};

export type SearchResult = MediaRef & {
  type: "image" | "video";
  width?: number;
  height?: number;
  duration?: number;
  tags?: string[];
};

export type SearchPage = { results: SearchResult[]; hasMore: boolean };

export type StockProvider = "pexels" | "unsplash" | "pixabay";

export class ProviderError extends Error {
  constructor(
    readonly provider: StockProvider,
    readonly status: number,
  ) {
    super(`${provider[0]!.toUpperCase()}${provider.slice(1)} search failed: ${status}`);
  }

  /** Quota or key problems: retrying soon only burns more of the quota. */
  get limited() {
    return this.status === 429 || this.status === 403;
  }
}

/** Calm, people-free scenery keywords rotated by "load more" so each click brings different backgrounds. */
export const BACKGROUND_KEYWORDS: Record<"image" | "video", string[]> = {
  image: [
    "nature landscape",
    "mountains",
    "ocean waves",
    "clouds sky",
    "desert dunes",
    "forest",
    "night sky stars",
    "waterfall",
    "sunset",
    "lake reflection",
    "misty hills",
    "green valley",
    "snow mountains",
    "calm sea",
    "autumn trees",
    "river",
    "flowers field",
    "galaxy",
    "sunrise horizon",
    "rain drops",
    "canyon",
    "islamic architecture",
    "mosque",
    "palm trees",
    "beach",
  ],
  video: [
    "nature landscape",
    "ocean waves",
    "clouds timelapse",
    "forest",
    "waterfall",
    "night sky stars",
    "desert",
    "rain",
    "sunset",
    "mountains aerial",
    "river stream",
    "snow falling",
    "calm lake",
    "sky",
    "sea aerial",
  ],
};

const PER_PAGE = 15;

async function pexelsSearch(key: string, query: string, kind: "image" | "video", page: number): Promise<SearchPage> {
  const q = sanitizeQuery(query);
  const url =
    kind === "video"
      ? `https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=${PER_PAGE}&page=${page}`
      : `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=${PER_PAGE}&page=${page}`;
  const res = await fetch(url, { headers: { Authorization: key } });
  if (!res.ok) throw new ProviderError("pexels", res.status);
  const json = (await res.json()) as {
    next_page?: string;
    photos?: { id: number; width: number; height: number; url: string; photographer: string; photographer_url: string; src: { large: string; large2x: string; original: string }; alt?: string }[];
    videos?: { id: number; width: number; height: number; duration: number; user: { name: string; url: string }; image: string; video_files: { link: string; width: number | null; height: number | null; file_type?: string }[]; url: string }[];
  };

  const hasMore = Boolean(json.next_page);
  if (kind === "image") {
    const results = (json.photos ?? [])
      .filter((p) => !containsBlockedTag(`${p.alt ?? ""} ${p.url}`))
      .map((p) => ({
        provider: "pexels" as const,
        id: String(p.id),
        type: "image" as const,
        url: p.src.large2x ?? p.src.original,
        previewUrl: p.src.large,
        photographer: p.photographer,
        photographerUrl: p.photographer_url,
        attribution: `Photo by ${p.photographer} on Pexels`,
        width: p.width,
        height: p.height,
      }));
    return { results, hasMore };
  }

  const results = (json.videos ?? []).filter((v) => !containsBlockedTag(v.url)).map((v) => {
    const file = pickVideoFile(v.video_files);
    return {
      provider: "pexels" as const,
      id: String(v.id),
      type: "video" as const,
      url: file?.link ?? v.url,
      previewUrl: v.image,
      photographer: v.user.name,
      photographerUrl: v.user.url,
      attribution: `Video by ${v.user.name} on Pexels`,
      width: v.width,
      height: v.height,
      duration: v.duration,
    };
  });
  return { results, hasMore };
}

/** Largest mp4 that is at most 1080p — 4K files are slow to render and gain nothing at 1080 output. */
function pickVideoFile<T extends { link: string; width: number | null; height: number | null; file_type?: string }>(
  files: T[],
): T | undefined {
  const mp4 = files.filter((f) => !f.file_type || f.file_type === "video/mp4");
  const pool = mp4.length ? mp4 : files;
  const fits = pool.filter((f) => Math.min(f.width ?? 0, f.height ?? 0) <= 1080);
  const byArea = (a: T, b: T) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0);
  return [...(fits.length ? fits : pool)].sort(byArea)[0];
}

async function unsplashSearch(key: string, query: string, page: number): Promise<SearchPage> {
  const q = sanitizeQuery(query);
  const res = await fetch(
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=${PER_PAGE}&page=${page}&content_filter=high`,
    { headers: { Authorization: `Client-ID ${key}` } },
  );
  if (!res.ok) throw new ProviderError("unsplash", res.status);
  const json = (await res.json()) as {
    total_pages: number;
    results: {
      id: string;
      width: number;
      height: number;
      description: string | null;
      alt_description: string | null;
      urls: { regular: string; full: string };
      user: { name: string; links: { html: string } };
      links: { download_location: string };
    }[];
  };
  const results = json.results
    .filter((p) => !containsBlockedTag(`${p.description ?? ""} ${p.alt_description ?? ""}`))
    .map((p) => ({
      provider: "unsplash" as const,
      id: p.id,
      type: "image" as const,
      url: p.urls.full,
      previewUrl: p.urls.regular,
      photographer: p.user.name,
      photographerUrl: p.user.links.html,
      downloadLocation: p.links.download_location,
      attribution: `Photo by ${p.user.name} on Unsplash`,
      width: p.width,
      height: p.height,
    }));
  return { results, hasMore: page < json.total_pages };
}

async function pixabaySearch(key: string, query: string, kind: "image" | "video", page: number): Promise<SearchPage> {
  const q = sanitizeQuery(query);
  const base =
    kind === "video"
      ? `https://pixabay.com/api/videos/?key=${key}&q=${encodeURIComponent(q)}&per_page=${PER_PAGE}&page=${page}`
      : `https://pixabay.com/api/?key=${key}&q=${encodeURIComponent(q)}&image_type=photo&per_page=${PER_PAGE}&page=${page}&safesearch=true`;
  const res = await fetch(base);
  if (!res.ok) throw new ProviderError("pixabay", res.status);
  const json = (await res.json()) as {
    totalHits: number;
    hits: {
      id: number;
      tags: string;
      user: string;
      pageURL: string;
      largeImageURL?: string;
      webformatURL?: string;
      imageWidth?: number;
      imageHeight?: number;
      videos?: Record<"large" | "medium" | "small" | "tiny", { url: string; width: number; height: number; thumbnail?: string } | undefined>;
      duration?: number;
    }[];
  };
  const results = json.hits
    .filter((h) => !containsBlockedTag(`${h.tags} ${h.pageURL}`))
    .map((h) => {
      if (kind === "video") {
        const v = h.videos?.large?.url ? h.videos.large : (h.videos?.medium ?? h.videos?.small);
        return {
          provider: "pixabay" as const,
          id: String(h.id),
          type: "video" as const,
          url: v?.url ?? "",
          previewUrl: h.videos?.medium?.thumbnail ?? h.videos?.large?.thumbnail ?? h.videos?.small?.thumbnail,
          photographer: h.user,
          photographerUrl: h.pageURL,
          attribution: `Video by ${h.user} on Pixabay`,
          duration: h.duration,
          tags: h.tags.split(", "),
        };
      }
      return {
        provider: "pixabay" as const,
        id: String(h.id),
        type: "image" as const,
        url: h.largeImageURL ?? "",
        previewUrl: h.webformatURL,
        photographer: h.user,
        photographerUrl: h.pageURL,
        attribution: `Photo by ${h.user} on Pixabay`,
        width: h.imageWidth,
        height: h.imageHeight,
        tags: h.tags.split(", "),
      };
    })
    .filter((r) => r.url);
  return { results, hasMore: page * PER_PAGE < json.totalHits };
}

/** Providers that can serve this kind with the given keys. */
export function stockProviders(keys: ProviderKeys, kind: "image" | "video"): StockProvider[] {
  const all: StockProvider[] = ["pexels", "unsplash", "pixabay"];
  return all.filter((p) => keys[p] && (p !== "unsplash" || kind === "image"));
}

export function searchProvider(provider: StockProvider, key: string, query: string, kind: "image" | "video", page: number): Promise<SearchPage> {
  if (provider === "pexels") return pexelsSearch(key, query, kind, page);
  if (provider === "unsplash") return unsplashSearch(key, query, page);
  return pixabaySearch(key, query, kind, page);
}

export async function searchMedia(
  keys: ProviderKeys,
  query: string,
  kind: "image" | "video" = "image",
  page = 1,
): Promise<SearchPage> {
  const searches = stockProviders(keys, kind).map((p) => searchProvider(p, keys[p]!, query, kind, page));

  const settled = await Promise.allSettled(searches);
  const pages = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  const results = pages.flatMap((p) => p.results);
  const errors = settled.flatMap((s) => (s.status === "rejected" ? [(s.reason as Error).message] : []));
  if (!results.length && errors.length) throw new Error(errors.join("; "));
  return { results, hasMore: pages.some((p) => p.hasMore) };
}

/** Unsplash requires calling the download tracking endpoint when a photo is used. */
export async function trackUnsplashDownload(downloadLocation: string, accessKey: string) {
  const url = new URL(downloadLocation);
  if (url.protocol !== "https:" || url.hostname !== "api.unsplash.com") {
    throw new Error("downloadLocation must be an api.unsplash.com URL");
  }
  await fetch(url, { headers: { Authorization: `Client-ID ${accessKey}` } });
}

export const BUNDLED_AMBIENCE = ["rain", "wind", "ocean", "forest"].map((id) => ({
  provider: "bundled" as const,
  id,
  url: `/ambience/${id}.wav`,
  attribution: "Generated by AutoAyah (public domain)",
}));
