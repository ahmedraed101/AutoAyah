import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { VideoConfig } from "@autoayah/core";
import { useCaption } from "../caption";
import { Icon } from "./Icon";

/** `navigator.clipboard` only exists on https or localhost; the home server is often plain http on the LAN. */
async function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      return await navigator.clipboard.writeText(text);
    } catch {
      /* permission denied: fall through to the selection copy */
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("copy failed");
}

export function CaptionCopy({ config }: { config: VideoConfig }) {
  const { t, i18n } = useTranslation();
  const caption = useCaption(config);
  const text = useRef<HTMLParagraphElement>(null);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = () =>
    void copyText(caption.text).then(
      () => {
        setState("copied");
        setTimeout(() => setState("idle"), 1800);
      },
      () => {
        // Leave the caption selected so it can be copied by hand.
        const el = text.current;
        if (el) window.getSelection()?.selectAllChildren(el);
        setState("failed");
      },
    );
  return (
    <div className="caption-box">
      <p ref={text} className="caption-text" dir={i18n.language === "ar" ? "rtl" : "ltr"}>
        {caption.title} <span className="caption-tags">{caption.tags.join(" ")}</span>
      </p>
      <button type="button" className="btn btn-quiet caption-copy" onClick={copy}>
        <Icon name={state === "copied" ? "check" : "copy"} size={16} />
        <span>{state === "copied" ? t("copied") : state === "failed" ? t("copyManually") : t("copyCaption")}</span>
      </button>
    </div>
  );
}
