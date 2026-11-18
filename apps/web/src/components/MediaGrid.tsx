import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MediaRef } from "@autoayah/core";
import { api, type MediaResult } from "../api";
import { browserStore } from "../browserStore";
import { useEditor } from "../store";
import { Icon } from "./Icon";

const keyOf = (m: { provider: string; id: string }) => `${m.provider}-${m.id}`;

/** The fields a video config stores for a chosen background. */
export function mediaRefFrom(m: MediaResult): MediaRef {
  return {
    provider: m.provider,
    id: m.id,
    url: m.url,
    previewUrl: m.previewUrl,
    attribution: m.attribution,
    photographer: m.photographer,
    photographerUrl: m.photographerUrl,
    downloadLocation: m.downloadLocation,
    duration: m.duration,
  };
}

/** Tell Unsplash it was used, and keep a local copy so renders don't depend on the provider staying up. */
export function rememberMedia(m: MediaResult, storageMode?: string) {
  if (m.provider === "unsplash" && m.downloadLocation) {
    const keys = storageMode === "browser" ? browserStore.getKeys() : Promise.resolve(undefined);
    void keys.then((k) => api.trackUnsplash(m.downloadLocation!, k?.unsplash).catch(() => undefined));
  }
  if (m.provider === "pexels" || m.provider === "unsplash" || m.provider === "pixabay") {
    api.keepMedia({ type: m.type, media: m }).catch(() => undefined);
  }
}

/** People-filtered library shown in the editor and when a series picks its backgrounds. */
export function useBackgroundLibrary(active: boolean) {
  const { t } = useTranslation();
  const { appConfig } = useEditor();
  const [media, setMedia] = useState<MediaResult[]>([]);
  const [mediaKind, setMediaKind] = useState<"image" | "video">("image");
  const [mediaNote, setMediaNote] = useState<string>();
  const [mediaDone, setMediaDone] = useState(false);
  const [searching, setSearching] = useState(false);
  const shownKind = useRef(mediaKind);

  const browserKeys = async () => (appConfig?.storageMode === "browser" ? await browserStore.getKeys() : undefined);

  const loadMore = async (kind: "image" | "video" = mediaKind) => {
    setSearching(true);
    try {
      const res = await api.moreMedia({ kind, keys: await browserKeys() });
      if (shownKind.current !== kind) return;
      setMedia((prev) => {
        const seen = new Set(prev.map(keyOf));
        return [...prev, ...res.added.filter((m) => !seen.has(keyOf(m)))];
      });
      setMediaDone(res.exhausted);
      const notes = [
        res.unchecked ? t("uncheckedResults", { n: res.unchecked }) : "",
        res.limited.length ? t("providersLimited", { names: res.limited.join(", ") }) : "",
      ].filter(Boolean);
      setMediaNote(notes.join(" ") || undefined);
    } catch (err) {
      if (shownKind.current === kind) setMediaNote((err as Error).message);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (!active) return;
    if (shownKind.current !== mediaKind) setMedia([]);
    shownKind.current = mediaKind;
    setMediaNote(undefined);
    setMediaDone(false);
    let live = true;
    api
      .mediaLibrary(mediaKind)
      .then((res) => {
        if (!live) return;
        setMedia((prev) => {
          const saved = new Set(res.results.map(keyOf));
          return [...res.results, ...prev.filter((m) => !saved.has(keyOf(m)))];
        });
        if (!res.results.length) void loadMore(mediaKind);
      })
      .catch((err: Error) => live && setMediaNote(err.message));
    return () => {
      live = false;
    };
    // loadMore closes over the latest keys; re-running it on every render would refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, mediaKind]);

  const upload = async (file: File) => {
    const item = await api.uploadMedia(file);
    setMedia((prev) => [item, ...prev.filter((m) => keyOf(m) !== keyOf(item))]);
    return item;
  };

  return { media, mediaKind, setMediaKind, mediaNote, mediaDone, searching, loadMore, upload };
}

export function MediaGrid({
  items,
  isSelected,
  onPick,
}: {
  items: MediaResult[];
  isSelected: (m: MediaResult) => boolean;
  onPick: (m: MediaResult) => void;
}) {
  return (
    <div className="media-grid">
      {items.map((m) => {
        const on = isSelected(m);
        return (
          <button
            type="button"
            key={keyOf(m)}
            className={`media-tile${on ? " on" : ""}${m.checked === false ? " unchecked" : ""}`}
            title={m.attribution}
            aria-pressed={on}
            onClick={() => onPick(m)}
          >
            <img src={m.previewUrl ?? m.url} alt={m.attribution ?? ""} loading="lazy" />
            {m.type === "video" ? (
              <span className="badge">
                <Icon name="play" size={12} />
              </span>
            ) : null}
            {on ? (
              <span className="tick">
                <Icon name="check" size={14} />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
