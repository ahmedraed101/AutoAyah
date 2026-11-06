import type { ReactNode } from "react";

const PATHS = {
  create: "M12 3.5l2.1 4.3 4.7.7-3.4 3.3.8 4.7L12 14.3l-4.2 2.2.8-4.7-3.4-3.3 4.7-.7z M5 20.5h14",
  projects: "M4 6.5A1.5 1.5 0 015.5 5h4l2 2h7A1.5 1.5 0 0120 8.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5z",
  renders: "M5 5h14v14H5z M10 9.5v5l4-2.5z",
  library: "M4 5h4v14H4z M10 5h4v14h-4z M16.5 5.5l3.5 1-3.5 13-3.5-1",
  settings:
    "M12 9a3 3 0 100 6 3 3 0 000-6z M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 00-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 00-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 002 1.2l.4 2.6h4l.4-2.6a7 7 0 002-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z",
  sun: "M12 8a4 4 0 100 8 4 4 0 000-8z M12 2.5v2 M12 19.5v2 M2.5 12h2 M19.5 12h2 M5.3 5.3l1.4 1.4 M17.3 17.3l1.4 1.4 M5.3 18.7l1.4-1.4 M17.3 6.7l1.4-1.4",
  moon: "M19.5 14.5A7.5 7.5 0 019.5 4.5a7.5 7.5 0 1010 10z",
  minus: "M6 12h12",
  plus: "M12 6v12 M6 12h12",
  check: "M5 12.5l4.5 4.5L19 7.5",
  play: "M8 5.5v13l10-6.5z",
  upload: "M12 16V5 M7.5 9.5L12 5l4.5 4.5 M5 19h14",
  download: "M12 5v11 M7.5 11.5L12 16l4.5-4.5 M5 19h14",
  trash: "M5 7h14 M10 4h4 M7 7l.8 12a1 1 0 001 1h6.4a1 1 0 001-1L17 7 M10.5 11v5 M13.5 11v5",
  retry: "M5 12a7 7 0 0112-4.9L19 9 M19 4.5V9h-4.5 M19 12a7 7 0 01-12 4.9L5 15 M5 19.5V15h4.5",
  close: "M6 6l12 12 M18 6L6 18",
  search: "M10.5 5a5.5 5.5 0 100 11 5.5 5.5 0 000-11z M15 15l4.5 4.5",
  save: "M6 4h9.5L19 7.5V19a1 1 0 01-1 1H6a1 1 0 01-1-1V5a1 1 0 011-1z M8 4v5h7V4 M8 20v-6h8v6",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Eight-pointed star used as the ayah-end marker and the brand mark. */
export function Rosette({ size = 32, children }: { size?: number; children?: ReactNode }) {
  return (
    <span className="rosette" style={{ width: size, height: size }}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <rect x="8" y="8" width="24" height="24" rx="2" />
        <rect x="8" y="8" width="24" height="24" rx="2" transform="rotate(45 20 20)" />
        <circle cx="20" cy="20" r="9.5" />
      </svg>
      {children != null ? <span className="rosette-num">{children}</span> : null}
    </span>
  );
}
