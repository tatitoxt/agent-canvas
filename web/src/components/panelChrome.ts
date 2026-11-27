import type React from "react";

/** Embedded panel root — fills its canvas node. Replaces the old
 * absolute-positioned overlay style each tool panel used to carry. */
export const panelRoot: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

/** Shared quiet button style inside panels — the mini actions in panel
 * toolbars/menus (Export PDF, pin to board, generate). */
export const actionBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  color: "var(--cv-ink)",
  fontSize: "var(--cv-text-xxs)",
  fontWeight: 600,
  padding: "4px 10px",
  cursor: "pointer",
};
