import type { NodeProps, Node } from "@xyflow/react";
import type { ShapeNodeData, ShapeDef } from "../board/types";
import { useBoard } from "../store/board";

const PALETTE = [
  "#e8e6e3", "#e05d5d", "#e0954a", "#e0c04a",
  "#5db96f", "#4a9fe0", "#7a6fe0", "#c95db9",
];

function ShapeSvg({ s }: { s: ShapeDef }) {
  const common = {
    stroke: s.color,
    strokeWidth: 2,
    fill: s.kind === "sticky" ? s.color : `${s.color}26`,
  };
  if (s.kind === "ellipse") {
    return (
      <svg width={s.w} height={s.h}>
        <ellipse cx={s.w / 2} cy={s.h / 2} rx={s.w / 2 - 2} ry={s.h / 2 - 2} {...common} />
      </svg>
    );
  }
  if (s.kind === "diamond") {
    return (
      <svg width={s.w} height={s.h}>
        <polygon
          points={`${s.w / 2},2 ${s.w - 2},${s.h / 2} ${s.w / 2},${s.h - 2} 2,${s.h / 2}`}
          {...common}
        />
      </svg>
    );
  }
  return (
    <svg width={s.w} height={s.h}>
      <rect x={1} y={1} width={s.w - 2} height={s.h - 2} rx={s.kind === "rect" ? 10 : 0} {...common} />
    </svg>
  );
}

export function ShapeNode({ id, data, selected }: NodeProps<Node<ShapeNodeData>>) {
  const s = data.shape;
  const updateShape = useBoard((st) => st.updateShape);
  const deleteShape = useBoard((st) => st.deleteShape);
  const isSticky = s.kind === "sticky";

  return (
    <div style={{ position: "relative", width: s.w, height: s.h }}>
      <ShapeSvg s={s} />
      {(isSticky || s.text) && (
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
            fontSize: 12,
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
            style={{ background: "none", border: "none", color: "var(--cv-ink-dim)", cursor: "pointer", fontSize: 13, marginLeft: 2 }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
