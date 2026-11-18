import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useEditor } from "../store";

/** Series, the tracker and upload ticks live in the server database. */
export function NeedsDb({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { appConfig } = useEditor();
  if (appConfig?.storageMode === "browser") {
    return (
      <div className="page">
        <p className="notice">{t("hostedOnly")}</p>
      </div>
    );
  }
  return children;
}
