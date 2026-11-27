import { memo } from "react";
import { NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import type { ShapeNodeData, ShapeDef } from "../board/types";
import { useBoard } from "../store/board";
import { countRender } from "../lib/renderProbe";

const PALETTE = [
  "#e8e6e3", "#e05d5d", "#e0954a", "#e0c04a",
  "#5db96f", "#4a9fe0", "#7a6fe0", "#c95db9",
];

function ShapeSvg({ s, w, h }: { s: ShapeDef; w: number; h: number }) {
  const isGroup = s.kind === "rect" && s.group;
  // Gather regions are structural chrome, not whiteboard doodles: crisp
  // geometry, a quiet 8% tint and a 1.25px hairline. Freehand shapes keep
  // the Excalidraw wobble.
  const sloppy = s.kind === "sticky" || isGroup ? {} : { filter: "url(#cv-sloppy)" as const };
  const common = {
    ...sloppy,
    stroke: isGroup ? `${s.color}b8` : s.color,
    strokeWidth: isGroup ? 1.25 : 2,
    fill: s.kind === "sticky" ? s.color : isGroup ? `${s.color}14` : `${s.color}26`,
  };
  if (s.kind === "ellipse") {
    return (
      <svg width={w} height={h}>
        <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - 2} ry={h / 2 - 2} {...common} />
      </svg>
    );
  }
  if (s.kind === "diamond") {
    return (
      <svg width={w} height={h}>
        <polygon
          points={`${w / 2},2 ${w - 2},${h / 2} ${w / 2},${h - 2} 2,${h / 2}`}
          {...common}
        />
      </svg>
    );
  }
  return (
    <svg width={w} height={h}>
      <rect x={1} y={1} width={w - 2} height={h - 2} rx={s.kind === "rect" ? (s.group ? 14 : 10) : 0} {...common} />
    </svg>
  );
}

export const ShapeNode = memo(function ShapeNode({ id, data, selected, width, height }: NodeProps<Node<ShapeNodeData>>) {
  countRender("ShapeNode", id);
  const s = data.shape;
  // Live geometry comes from React Flow while a resize gesture is in
  // flight; the store shape only catches up when the pointer is released.
  // Shape nodes always carry explicit style dimensions, so the props are
  // never circular — unlike natural-height agent cards.
  const liveW = typeof width === "number" && width > 0 ? width : s.w;
  const liveH = typeof height === "number" && height > 0 ? height : s.h;
  const updateShape = useBoard((st) => st.updateShape);
  const deleteShape = useBoard((st) => st.deleteShape);
  const vaultDir = useBoard((st) => st.vaultDir);
  const vaultAppend = useBoard((st) => st.vaultAppend);
  const notify = useBoard((st) => st.notify);
  const leaving = useBoard((st) => Boolean(st.leavingShapes[id]));
  const isSticky = s.kind === "sticky";
  const isGroup = s.kind === "rect" && s.group;

  const saveToVault = () => {
    if (!vaultDir) {
      notify("open a vault first — Library → Obsidian");
      return;
    }
    const title = (s.title ?? "pinned").trim() || "pinned";
    const safe = title.replace(/[\\/:*?"<>|]/g, "-").slice(0, 60) || "note";
    vaultAppend(`Canvas/${safe}.md`, `## ${title}\n\n${s.text ?? ""}\n`);
    notify(`saved to vault → Canvas/${safe}.md`);
  };

  if (s.kind === "pin" || s.kind === "artifact") {
    return (
      <>
        <NodeResizer
          isVisible={selected}
          minWidth={220}
          minHeight={140}
          handleClassName="cv-node-resize-handle"
          lineClassName="cv-node-resize-line"
          color="transparent"
          onResizeEnd={(_, p) => updateShape(id, { x: p.x, y: p.y, w: Math.round(p.width), h: Math.round(p.height) })}
        />
        <div
          style={{
            position: "relative",
            width: liveW,
            height: liveH,
            borderRadius: 12,
            background: "var(--cv-glass)",
            backdropFilter: "blur(var(--cv-blur-popover))",
            border: `1px solid ${s.anchor ? `${s.color}55` : "var(--cv-hairline)"}`,
            boxShadow: "var(--cv-shadow-card)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
        <div
          style={{
            padding: "10px 14px 8px",
            borderBottom: "1px solid var(--cv-hairline)",
            fontSize: "var(--cv-text-sm)",
            fontWeight: 700,
            color: "var(--cv-ink)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 2, background: s.color, flexShrink: 0 }} />
          {s.kind === "artifact" && <span data-testid="artifact-window-kind" style={{ color: s.color, fontSize: "var(--cv-text-xxs)", textTransform: "uppercase", letterSpacing: "0.08em", flexShrink: 0 }}>{s.artifactKind ?? "artifact"}</span>}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{s.title ?? "pinned"}</span>
          <button
            className="nodrag"
            onClick={saveToVault}
            title={vaultDir ? (s.kind === "artifact" ? "save this artifact window to your Obsidian vault" : "append this note to your Obsidian vault (Canvas/<title>.md)") : "open a vault first — Library → Obsidian"}
            style={{
              background: "none", border: "none", cursor: "pointer", padding: 0,
              color: vaultDir ? "#a98af0" : "var(--cv-ink-faint)", flexShrink: 0,
              display: "flex", alignItems: "center",
            }}
          >
            <img src="/obsidian.svg" alt="" width={11} height={11} style={{ opacity: vaultDir ? 1 : 0.5 }} />
          </button>
        </div>
        {s.kind === "artifact" ? (
          <div data-testid="artifact-window-content" className="nodrag" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "10px 14px", color: "var(--cv-ink)", fontSize: "var(--cv-text-sm)", lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {s.text || "This artifact has no text preview."}
          </div>
        ) : <textarea
          className="nodrag"
          value={s.text}
          onChange={(e) => updateShape(id, { text: e.target.value })}
          placeholder="…"
          style={{
            flex: 1,
            padding: "10px 14px",
            background: "transparent",
            border: "none",
            outline: "none",
            resize: "none",
            fontSize: "var(--cv-text-sm)",
            lineHeight: 1.55,
            fontFamily: "inherit",
            color: "var(--cv-ink)",
          }}
        />}
        {selected && (
          <button
            className="nodrag cv-card-btn cv-card-close"
            onClick={() => deleteShape(id)}
            title="remove card"
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              fontSize: "var(--cv-text-xxs)",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        )}
        </div>
      </>
    );
  }

  return (
    <div
      className={`${isGroup ? "cv-group-frame" : ""}${leaving ? " cv-group-frame-out" : ""}`.trim() || undefined}
      style={{ position: "relative", width: liveW, height: liveH }}
    >
      <ShapeSvg s={s} w={liveW} h={liveH} />
      {s.kind === "rect" && s.text != null && (
        // Freehand region labels sit above the frame. Gather regions reserve
        // a real header band in the layout, so the label lives inside it and
        // can never be clipped by the topbar or hidden under a window.
        <input
          className="nodrag"
          value={s.text}
          onChange={(e) => updateShape(id, { text: e.target.value })}
          placeholder="region"
          style={isGroup ? {
            position: "absolute",
            top: 11,
            left: 14,
            width: Math.max(76, Math.min(220, liveW - 28, (s.text?.length ?? 0) * 7.4 + 30)),
            height: 28,
            padding: "0 10px",
            borderRadius: 8,
            background: `color-mix(in srgb, ${s.color} 12%, transparent)`,
            border: `1px solid ${s.color}30`,
            outline: "none",
            fontSize: "var(--cv-text-xs)",
            fontWeight: 700,
            fontFamily: "inherit",
            color: `color-mix(in srgb, ${s.color} 78%, var(--cv-ink))`,
            letterSpacing: 0.25,
          } : {
            position: "absolute",
            top: -24,
            left: 2,
            width: Math.min(220, liveW - 12),
            background: "transparent",
            border: "none",
            outline: "none",
            fontSize: "var(--cv-text-xs)",
            fontWeight: 600,
            fontFamily: "inherit",
            color: s.color,
            letterSpacing: 0.3,
          }}
        />
      )}
      {s.kind !== "rect" && (isSticky || s.text) && (
        <textarea
          className="nodrag"
          value={s.text}
          onChange={(e) => updateShape(id, { text: e.target.value })}
          placeholder={isSticky ? "note…" : "label"}
          style={{
            position: "absolute",
            inset: isSticky ? 8 : "20%",
            background: "transparent",
            border: "none",
            outline: "none",
            resize: "none",
            fontSize: "var(--cv-text-xs)",
            fontFamily: "inherit",
            color: isSticky ? "#1a1a1c" : "var(--cv-ink)",
            textAlign: isSticky ? "left" : "center",
          }}
        />
      )}
      {selected && (
        <div
          className="nodrag"
          style={{
            position: "absolute",
            top: -34,
            left: 0,
            display: "flex",
            gap: 4,
            alignItems: "center",
            background: "var(--cv-glass)",
            border: "1px solid var(--cv-glass-edge)",
            borderRadius: 999,
            padding: "4px 8px",
          }}
        >
          {PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => updateShape(id, { color: c })}
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: c,
                border: s.color === c ? "2px solid var(--cv-ink)" : "1px solid #0006",
                cursor: "pointer",
                padding: 0,
              }}
            />
          ))}
          <button
            onClick={() => deleteShape(id)}
            style={{ background: "none", border: "none", color: "var(--cv-ink-dim)", cursor: "pointer", fontSize: "var(--cv-text-sm)", marginLeft: 2 }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
});
