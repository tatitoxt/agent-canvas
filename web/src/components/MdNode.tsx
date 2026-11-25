import { useEffect } from "react";
import { NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import type { MdNodeData } from "../board/types";
import { useBoard } from "../store/board";

/** Symvibe's live markdown card — a vault file pinned on the board,
 * re-polled so an agent editing the file shows up live. */
const POLL_MS = 4000;

export function MdNode({ id, data, selected }: NodeProps<Node<MdNodeData>>) {
  const text = useBoard((s) => s.mdContents[data.path]);
  const mdNodeRemove = useBoard((s) => s.mdNodeRemove);
  const resizeMdNode = useBoard((s) => s.resizeMdNode);
  const basename = data.path.split("/").pop() ?? data.path;

  useEffect(() => {
    const tick = () => useBoard.getState().vaultRead(data.path);
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => clearInterval(t);
  }, [data.path]);

  return (
    <div
      className="glass-panel"
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderRadius: 12,
        border: "1px solid var(--cv-glass-edge)",
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={260}
        minHeight={180}
        handleClassName="cv-node-resize-handle"
        lineClassName="cv-node-resize-line"
        onResize={(_, p) => resizeMdNode(id, Math.round(p.width), Math.round(p.height), false)}
        onResizeEnd={(_, p) => resizeMdNode(id, Math.round(p.width), Math.round(p.height))}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "7px 10px",
          borderBottom: "1px solid var(--cv-glass-edge)",
          fontSize: 11,
          color: "var(--cv-ink-dim)",
        }}
      >
        <span style={{ color: "var(--cv-accent)" }}>▤</span>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {basename}
        </span>
        <span style={{ fontSize: 9, color: "var(--cv-waiting)" }}>live</span>
        <button
          className="nodrag"
          onClick={() => mdNodeRemove(id)}
          style={{ background: "none", border: "none", color: "var(--cv-ink-dim)", cursor: "pointer", fontSize: 13 }}
        >
          ×
        </button>
      </div>
      <div
        className="nodrag"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "8px 12px",
          fontSize: 11.5,
          lineHeight: 1.5,
          color: "var(--cv-ink)",
          whiteSpace: "pre-wrap",
          fontFamily: "inherit",
        }}
      >
        {text == null
          ? "…"
          : text.split(/(!\[[^\]]*\]\([^)]+\))/g).map((part, i) => {
              const m = part.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
              // Remote images stay links — auto-loading them would leak the
              // viewer's IP and view time to the note author's server.
              const remote = m && /^https?:\/\//i.test(m[2]);
              return m && !remote ? (
                <img
                  key={i}
                  src={m[2]}
                  alt={m[1]}
                  style={{ maxWidth: "100%", borderRadius: 8, display: "block", margin: "4px 0" }}
                />
              ) : m ? (
                <a key={i} href={m[2]} target="_blank" rel="noreferrer" style={{ color: "var(--cv-accent)" }}>
                  {m[1] || m[2]}
                </a>
              ) : (
                <span key={i}>{part}</span>
              );
            })}
      </div>
    </div>
  );
}
