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
