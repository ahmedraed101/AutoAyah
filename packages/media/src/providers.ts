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

async function pexelsSearch(key: string, query: string, kind: "image" | "video"): Promise<SearchResult[]> {
  const q = sanitizeQuery(query);
  const url =
    kind === "video"
      ? `https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=15`
      : `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=15`;
  const res = await fetch(url, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`Pexels search failed: ${res.status}`);
  const json = (await res.json()) as {
    photos?: { id: number; width: number; height: number; url: string; photographer: string; photographer_url: string; src: { large: string; large2x: string; original: string }; alt?: string }[];
    videos?: { id: number; width: number; height: number; duration: number; user: { name: string; url: string }; image: string; video_files: { link: string; width: number | null; height: number | null; file_type?: string }[]; url: string }[];
  };

  if (kind === "image") {
    return (json.photos ?? [])
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
  }

  return (json.videos ?? []).filter((v) => !containsBlockedTag(v.url)).map((v) => {
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

async function unsplashSearch(key: string, query: string): Promise<SearchResult[]> {
  const q = sanitizeQuery(query);
  const res = await fetch(
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=15&content_filter=high`,
    { headers: { Authorization: `Client-ID ${key}` } },
  );
  if (!res.ok) throw new Error(`Unsplash search failed: ${res.status}`);
  const json = (await res.json()) as {
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
  return json.results
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
}

async function pixabaySearch(key: string, query: string, kind: "image" | "video"): Promise<SearchResult[]> {
  const q = sanitizeQuery(query);
  const base =
    kind === "video"
      ? `https://pixabay.com/api/videos/?key=${key}&q=${encodeURIComponent(q)}&per_page=15`
      : `https://pixabay.com/api/?key=${key}&q=${encodeURIComponent(q)}&image_type=photo&per_page=15&safesearch=true`;
  const res = await fetch(base);
  if (!res.ok) throw new Error(`Pixabay search failed: ${res.status}`);
  const json = (await res.json()) as {
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
  return json.hits
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
}

export async function searchMedia(
  keys: ProviderKeys,
  query: string,
  kind: "image" | "video" = "image",
): Promise<SearchResult[]> {
  const searches: Promise<SearchResult[]>[] = [];
  if (keys.pexels) searches.push(pexelsSearch(keys.pexels, query, kind));
  if (keys.unsplash && kind === "image") searches.push(unsplashSearch(keys.unsplash, query));
  if (keys.pixabay) searches.push(pixabaySearch(keys.pixabay, query, kind));

  const settled = await Promise.allSettled(searches);
  const results = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
  const errors = settled.flatMap((s) => (s.status === "rejected" ? [(s.reason as Error).message] : []));
  if (!results.length && errors.length) throw new Error(errors.join("; "));
  return results;
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
