import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { Icon } from "./icons";

/** Canonical card-chrome actions. Keeping the glyph choice here means node
 * types cannot drift back into unicode symbols or one-off hand-rolled SVGs. */
export type CardChromeIcon =
  | "terminal"
  | "files"
  | "copy"
  | "open"
  | "collapse"
  | "expand"
  | "maximize"
  | "restore"
  | "close";

const CHROME_ICONS: Record<CardChromeIcon, string> = {
  terminal: "ph-terminal",
  files: "ph-folder-chrome",
  copy: "ph-copy",
  open: "ph-open-external",
  collapse: "ph-min",
  expand: "ph-caret-right",
  maximize: "ph-max",
  restore: "ph-restore",
  close: "ph-x",
};

/** Shared right-aligned window controls for canvas cards. The wrapper carries
 * both historical class names: `cv-card-chrome` is the current hook, while
 * `card-chrome` keeps the original agent-card selector/test compatibility. */
export function CardChrome({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={`cv-card-chrome card-chrome ${className}`.trim()} style={style}>
      {children}
    </span>
  );
}

/** One canonical 24px titlebar button (16px phosphor glyph). Event
 * propagation stops here so every card keeps the same drag/select/keyboard
 * behavior regardless of which node type renders the control. */
export function CardChromeButton({
  icon,
  title,
  ariaLabel,
  danger = icon === "close",
  className = "",
  onClick,
}: {
  icon: CardChromeIcon;
  title: string;
  ariaLabel?: string;
  danger?: boolean;
  className?: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className={`nodrag cv-chrome-btn ${danger ? "cv-card-close" : ""} ${className}`.trim()}
      title={title}
      aria-label={ariaLabel ?? title}
      data-danger={danger ? "true" : undefined}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
    >
      <Icon name={CHROME_ICONS[icon]} size={16} />
    </button>
  );
}
