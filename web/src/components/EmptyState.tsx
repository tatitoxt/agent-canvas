import type React from "react";
import { Icon } from "./icons";

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  title?: string;
  /** accent = the one strong call (amber); default stays a quiet mini button. */
  accent?: boolean;
}

/** Editorial empty state — sober icon tile, a clear title, one or two lines
 * of guidance and an optional action. No stock illustrations, no emoji:
 * the obsidian/amber identity carried by type, air and a single accent.
 *
 * `compact` drops the vertical padding for narrow rails and sidebar strips. */
export function EmptyState({
  icon,
  title,
  children,
  hint,
  actions,
  compact = false,
}: {
  icon: string;
  title: string;
  children?: React.ReactNode;
  /** Quiet mono line under the description — keyboard/mouse gestures, scope notes. */
  hint?: React.ReactNode;
  actions?: EmptyStateAction[];
  compact?: boolean;
}) {
  return (
    <div
      className="cv-empty-state"
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: compact ? "18px 16px" : "28px 22px",
        gap: 0,
      }}
    >
      <div
        aria-hidden
        style={{
          width: compact ? 38 : 44,
          height: compact ? 38 : 44,
          borderRadius: 13,
          background: "var(--cv-ink-fill-control)",
          border: "1px solid var(--cv-hairline)",
          boxShadow: "inset 0 1px 0 var(--cv-glass-shine)",
          display: "grid",
          placeItems: "center",
          marginBottom: compact ? 10 : 14,
        }}
      >
        <Icon name={icon} size={compact ? 17 : 19} color="var(--cv-ink-dim)" />
      </div>
      <div
        style={{
          fontSize: "var(--cv-text-sm)",
          fontWeight: 600,
          letterSpacing: "0.01em",
          color: "var(--cv-ink)",
          lineHeight: 1.3,
        }}
      >
        {title}
      </div>
      {children != null && (
        <div
          style={{
            fontSize: "var(--cv-text-xs)",
            color: "var(--cv-ink-dim)",
            lineHeight: 1.55,
            marginTop: 6,
            maxWidth: 252,
          }}
        >
          {children}
        </div>
      )}
      {hint != null && (
        <div
          style={{
            fontFamily: "var(--cv-font-mono)",
            fontSize: "var(--cv-text-xxs)",
            color: "var(--cv-ink-faint)",
            lineHeight: 1.7,
            marginTop: compact ? 8 : 12,
          }}
        >
          {hint}
        </div>
      )}
      {actions && actions.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginTop: compact ? 10 : 14, flexWrap: "wrap", justifyContent: "center" }}>
          {actions.map((a) => (
            <button
              key={a.label}
              className="cv-mini-btn"
              title={a.title}
              onClick={a.onClick}
              style={{
                padding: "5px 13px",
                color: a.accent ? "var(--cv-accent)" : "var(--cv-ink-dim)",
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
