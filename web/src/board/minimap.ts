import type { Node } from "@xyflow/react";
import type { BoardNodeData, ShapeNodeData } from "./types";

/** Markdown cards and note-like whiteboard cards (sticky notes / pinned
 * notes) share one minimap hue: to the user they are all "notes". Geometric
 * whiteboard shapes remain a separate type. */
export type MinimapColorType = Exclude<BoardNodeData["kind"], "md"> | "note";

/**
 * Type palette for the minimap. These are deliberately CSS variables rather
 * than raw hexes: the minimap compresses cards to a few pixels, so the paper
 * theme needs deeper versions of the same hues to keep the swatches legible.
 */
export const MINIMAP_TYPE_COLORS = {
  agent: "var(--cv-minimap-node-agent)",
  term: "var(--cv-minimap-node-term)",
  panel: "var(--cv-minimap-node-panel)",
  note: "var(--cv-minimap-node-note)",
  web: "var(--cv-minimap-node-web)",
  orchestrator: "var(--cv-minimap-node-orchestrator)",
  workspace: "var(--cv-minimap-node-workspace)",
  shape: "var(--cv-minimap-node-shape)",
} satisfies Record<MinimapColorType, string>;

export const MINIMAP_FALLBACK_COLOR = "var(--cv-idle)";

export function minimapTypeForNode(node: Node): MinimapColorType | undefined {
  const data = node.data as Partial<BoardNodeData> | undefined;
  if (data?.kind === "shape") {
    const shapeKind = (data as Partial<ShapeNodeData>).shape?.kind;
    if (shapeKind === "sticky" || shapeKind === "pin") return "note";
    return "shape";
  }

  const candidate = data?.kind ?? node.type;
  if (candidate === "md") return "note";
  return candidate && candidate in MINIMAP_TYPE_COLORS
    ? (candidate as MinimapColorType)
    : undefined;
}

export function minimapTypeColor(node: Node): string {
  const type = minimapTypeForNode(node);
  return type ? MINIMAP_TYPE_COLORS[type] : MINIMAP_FALLBACK_COLOR;
}

/**
 * Minimap color is type-first. Selection does not replace the hue; it mixes
 * towards the theme foreground, so a selected amber terminal is still amber —
 * just clearly lifted from its unselected siblings.
 */
export function minimapNodeColor(node: Node): string {
  const color = minimapTypeColor(node);
  if (!node.selected) return color;
  return `color-mix(in srgb, var(--cv-ink) 32%, ${color})`;
}
