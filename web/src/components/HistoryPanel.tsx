import { useBoard } from "../store/board";
import type { LiveEdge } from "../store/board";

/** Chronological log of every delegation — the graph replayed as a
 * timeline: who asked whom, for what, and what came back. */
export function HistoryPanel({ onOpenEdge }: { onOpenEdge: (edgeId: string) => void }) {
  const edges = useBoard((s) => s.edges);
  const agents = useBoard((s) => s.agents);

  const rows = Object.values(edges).sort((a, b) =>
    (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  );
  const nameOf = (id: string) => agents[id]?.name ?? id.slice(0, 8);
  const duration = (e: LiveEdge) => {
    if (!e.created_at || !e.resolved_at) return "";
    const s = (Date.parse(e.resolved_at.replace(" ", "T") + "Z") -
      Date.parse(e.created_at.replace(" ", "T") + "Z")) / 1000;
    if (!isFinite(s) || s < 0) return "";
    return s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
  };

  return (
    <div
      className="glass"
      style={{
        position: "absolute",
        left: 64,
        top: 64,
        bottom: 64,
        width: 360,
        zIndex: 14,
        borderRadius: 16,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "14px 16px 8px", fontSize: 12, fontWeight: 700 }}>
        Delegation history
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 10px" }}>
        {rows.length === 0 && (
          <div style={{ padding: "12px 14px", fontSize: 11, color: "var(--cv-ink-faint)" }}>
            No delegations yet — drag from an agent's edge handle to delegate.
          </div>
        )}
        {rows.map((e) => (
          <button
            key={e.id}
            onClick={() => onOpenEdge(e.id)}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              width: "100%",
              textAlign: "left",
              padding: "9px 12px",
              borderRadius: 10,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "var(--cv-ink)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11 }}>
              <span style={{ fontWeight: 600 }}>
                {nameOf(e.from)} → {nameOf(e.to)}
              </span>
              <span
                style={{
                  color:
                    e.state === "delegated"
                      ? "var(--cv-waiting)"
                      : e.state === "failed"
                        ? "var(--cv-blocked)"
                        : "var(--cv-done)",
                }}
              >
                {e.state === "delegated" ? "in flight" : e.state}
                {duration(e) ? ` · ${duration(e)}` : ""}
              </span>
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--cv-ink-dim)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {e.task}
            </div>
            {(e.files ?? 0) > 0 && (
              <div style={{ fontSize: 10, color: "var(--cv-ink-faint)" }}>
                {e.files} file{e.files === 1 ? "" : "s"} changed
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
