import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PLATFORMS, type PlatformId, type Upload } from "@autoayah/core";
import { api } from "../api";

function ordered(targets: PlatformId[]) {
  const rank = new Map(targets.map((id, index) => [id, index]));
  return [...PLATFORMS].sort((a, b) => (rank.get(a.id) ?? 100) - (rank.get(b.id) ?? 100) || 0);
}

function UploadRow({
  platform,
  label,
  target,
  upload,
  disabled,
  onToggle,
  onLink,
}: {
  platform: PlatformId;
  label: string;
  target: boolean;
  upload?: Upload;
  disabled: boolean;
  onToggle: (platform: PlatformId, on: boolean) => void;
  onLink: (platform: PlatformId, url: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(upload?.url ?? "");
  useEffect(() => setDraft(upload?.url ?? ""), [upload?.url]);
  const on = Boolean(upload);
  return (
    <div className={`upload-row${target ? " is-target" : ""}`}>
      <label className="switch-row">
        <span>{label}</span>
        <input type="checkbox" role="switch" className="switch" checked={on} disabled={disabled} onChange={(e) => onToggle(platform, e.target.checked)} />
      </label>
      {on ? (
        <input
          value={draft}
          placeholder={t("uploadLinkPh")}
          inputMode="url"
          aria-label={t("uploadLinkPh")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if ((draft || "") !== (upload?.url ?? "")) onLink(platform, draft.trim());
          }}
        />
      ) : null}
      {upload ? <span className="field-hint">{t("uploadedOn", { date: new Date(upload.uploadedAt).toLocaleString() })}</span> : null}
    </div>
  );
}

/** One tick per platform. YouTube and TikTok, and any series targets, are listed first. */
export function UploadTicks({
  jobId,
  uploads,
  targets = [],
  onChange,
}: {
  jobId?: string | null;
  uploads: Upload[];
  targets?: string[];
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string>();
  const byPlatform = new Map(uploads.map((upload) => [upload.platform, upload]));
  const list = ordered(targets.filter((id): id is PlatformId => PLATFORMS.some((p) => p.id === id)));

  const act = (p: Promise<unknown>) =>
    void p
      .then(() => {
        setError(undefined);
        onChange();
      })
      .catch((e: Error) => setError(e.message));

  return (
    <div className="upload-ticks">
      {list.map((platform) => (
        <UploadRow
          key={platform.id}
          platform={platform.id}
          label={t(`platform_${platform.id}`)}
          target={targets.includes(platform.id)}
          upload={byPlatform.get(platform.id)}
          disabled={!jobId}
          onToggle={(id, on) => {
            if (!jobId) return;
            act(on ? api.setUpload({ jobId, platform: id }) : api.clearUpload(jobId, id));
          }}
          onLink={(id, url) => {
            if (!jobId) return;
            act(api.setUpload({ jobId, platform: id, url: url || null }));
          }}
        />
      ))}
      {!jobId ? <p className="field-hint">{t("uploadNeedsVideo")}</p> : null}
      {error ? <p className="notice error">{error}</p> : null}
    </div>
  );
}
