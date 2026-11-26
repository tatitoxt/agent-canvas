import { describe, expect, it } from "vitest";
import type { Node } from "@xyflow/react";
import type { BoardNodeData, ShapeKind } from "./types";
import {
  MINIMAP_FALLBACK_COLOR,
  MINIMAP_TYPE_COLORS,
  minimapNodeColor,
  minimapTypeColor,
  minimapTypeForNode,
  type MinimapColorType,
} from "./minimap";

const COLOR_TYPES: MinimapColorType[] = [
  "agent",
  "term",
  "panel",
  "note",
  "web",
  "orchestrator",
  "workspace",
  "shape",
];

function nodeFor(kind: BoardNodeData["kind"], selected = false): Node {
  return {
    id: `n-${kind}`,
    type: kind,
    position: { x: 0, y: 0 },
    data: { kind },
    selected,
  } as unknown as Node;
}

function shapeNodeFor(kind: ShapeKind): Node {
  return {
    id: `shape-${kind}`,
    type: "shape",
    position: { x: 0, y: 0 },
    data: {
      kind: "shape",
      shape: { id: `shape-${kind}`, kind, x: 0, y: 0, w: 120, h: 90, color: "#fff", text: "" },
    },
  } as unknown as Node;
}

describe("minimap type colors", () => {
  it("covers every minimap color type with a unique token", () => {
    expect(Object.keys(MINIMAP_TYPE_COLORS).sort()).toEqual([...COLOR_TYPES].sort());
    expect(new Set(Object.values(MINIMAP_TYPE_COLORS)).size).toBe(COLOR_TYPES.length);
  });

  it.each(["agent", "term", "panel", "web", "orchestrator", "workspace"] as const)(
    "maps %s nodes to their type token",
    (kind) => {
      expect(minimapTypeForNode(nodeFor(kind))).toBe(kind);
      expect(minimapTypeColor(nodeFor(kind))).toBe(MINIMAP_TYPE_COLORS[kind]);
    },
  );

  it("maps markdown cards to the note color", () => {
    expect(minimapTypeForNode(nodeFor("md"))).toBe("note");
    expect(minimapTypeColor(nodeFor("md"))).toBe(MINIMAP_TYPE_COLORS.note);
  });

  it.each(["sticky", "pin"] as const)("maps note-like %s cards to the note color", (kind) => {
    expect(minimapTypeForNode(shapeNodeFor(kind))).toBe("note");
    expect(minimapTypeColor(shapeNodeFor(kind))).toBe(MINIMAP_TYPE_COLORS.note);
  });

  it.each(["rect", "ellipse", "diamond"] as const)("keeps geometric %s shapes on the shape color", (kind) => {
    expect(minimapTypeForNode(shapeNodeFor(kind))).toBe("shape");
    expect(minimapTypeColor(shapeNodeFor(kind))).toBe(MINIMAP_TYPE_COLORS.shape);
  });

  it("falls back to node.type when data does not carry a kind", () => {
    const node = {
      id: "legacy-term",
      type: "term",
      position: { x: 0, y: 0 },
      data: {},
    } as unknown as Node;
    expect(minimapTypeForNode(node)).toBe("term");
    expect(minimapTypeColor(node)).toBe(MINIMAP_TYPE_COLORS.term);
  });

  it("combines selection with the type color instead of replacing it", () => {
    expect(minimapNodeColor(nodeFor("term", true))).toBe(
      "color-mix(in srgb, var(--cv-ink) 32%, var(--cv-minimap-node-term))",
    );
    expect(minimapNodeColor(nodeFor("term"))).toBe("var(--cv-minimap-node-term)");
  });

  it("uses a neutral fallback for unknown node types", () => {
    const node = {
      id: "unknown",
      type: "unknown",
      position: { x: 0, y: 0 },
      data: {},
    } as unknown as Node;
    expect(minimapTypeForNode(node)).toBeUndefined();
    expect(minimapNodeColor(node)).toBe(MINIMAP_FALLBACK_COLOR);
  });
});
