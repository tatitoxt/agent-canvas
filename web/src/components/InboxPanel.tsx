import { useBoard } from "../store/board";

const rowStyle: React.CSSProperties = {
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
};

const groupLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.8,
  textTransform: "uppercase",
  color: "var(--cv-ink-faint)",
  padding: "10px 12px 4px",
};

/** Deska-style inbox: work grouped by what it needs from you — agents
 * waiting on input, blocked runs, delegations still in flight. */
export function InboxPanel({ onOpenAgent }: { onOpenAgent: (id: string) => void }) {
  const agents = useBoard((s) => s.agents);
  const edges = useBoard((s) => s.edges);
  const approvals = useBoard((s) => s.approvals);
  const attention = useBoard((s) => s.attention);

  const alerts = Object.entries(attention).map(([id, reason]) => ({
    id,
    reason,
    name: agents[id]?.name ?? id.slice(0, 8),
  }));
  const held = Object.entries(approvals).map(([id, line]) => ({
    id,
    line,
    name: agents[id]?.name ?? id.slice(0, 8),
  }));
  const needsYou = Object.values(agents).filter(
    (a) => a.status === "waiting" || a.status === "blocked",
  );
  const inFlight = Object.values(edges).filter((e) => e.state === "delegated");
  const done = Object.values(edges).filter((e) => e.state === "returned");
  const empty =
    held.length === 0 && alerts.length === 0 && needsYou.length === 0 &&
    inFlight.length === 0 && done.length === 0;

  return (
    <div
      className="glass"
      style={{
        position: "absolute",
        left: 64,
        top: 64,
        bottom: 64,
        width: 300,
        zIndex: 19,
        display: "flex",
        flexDirection: "column",
        padding: "12px 8px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          fontSize: 12.5,
          fontWeight: 650,
          padding: "0 12px 8px",
          color: "var(--cv-ink)",
        }}
      >
        Inbox
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {empty && (
          <div style={{ padding: "18px 12px", fontSize: 11.5, color: "var(--cv-ink-dim)" }}>
            Nothing needs you — agents are running or done.
          </div>
        )}
        {alerts.length > 0 && (
          <>
            <div style={{ ...groupLabel, color: "var(--cv-blocked)" }}>automation alerts</div>
            {alerts.map((a) => (
              <button key={a.id} style={rowStyle} className="inbox-row" onClick={() => onOpenAgent(a.id)}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{a.name}</span>
                <span style={{ fontSize: 11, color: "var(--cv-ink-dim)" }}>{a.reason}</span>
              </button>
            ))}
          </>
        )}
        {held.length > 0 && (
          <>
            <div style={{ ...groupLabel, color: "var(--cv-waiting)" }}>approve commands</div>
            {held.map((h) => (
              <div key={h.id} style={{ ...rowStyle, cursor: "default" }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{h.name}</span>
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--cv-ink-dim)",
                    fontFamily: "ui-monospace, SFMono-Regular, monospace",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={h.line}
                >
                  {h.line}
                </span>
                <span style={{ display: "flex", gap: 6, marginTop: 4 }}>
                  <button
                    className="glass-pill"
                    style={{ fontSize: 10.5, fontWeight: 600, padding: "2px 11px", color: "var(--cv-done)", cursor: "pointer", border: "none" }}
                    onClick={() => useBoard.getState().approveInput(h.id)}
                  >
                    allow
                  </button>
                  <button
                    className="glass-pill"
                    style={{ fontSize: 10.5, fontWeight: 600, padding: "2px 11px", color: "var(--cv-blocked)", cursor: "pointer", border: "none" }}
                    onClick={() => useBoard.getState().denyInput(h.id)}
                  >
                    deny
                  </button>
                </span>
              </div>
            ))}
          </>
        )}
        {needsYou.length > 0 && (
          <>
            <div style={groupLabel}>needs you</div>
            {needsYou.map((a) => (
              <button key={a.id} style={rowStyle} className="inbox-row" onClick={() => onOpenAgent(a.id)}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{a.name}</span>
                <span style={{ fontSize: 11, color: "var(--cv-ink-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.lastLine ?? (a.status === "blocked" ? "blocked" : "waiting for input")}
                </span>
              </button>
            ))}
          </>
        )}
        {inFlight.length > 0 && (
          <>
            <div style={groupLabel}>delegations in flight</div>
            {inFlight.map((e) => (
              <button key={e.id} style={rowStyle} className="inbox-row" onClick={() => onOpenAgent(e.to)}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{e.task}</span>
                <span style={{ fontSize: 11, color: "var(--cv-ink-dim)" }}>delegated</span>
              </button>
            ))}
          </>
        )}
        {done.length > 0 && (
          <>
            <div style={groupLabel}>returned</div>
            {done.map((e) => (
              <button key={e.id} style={rowStyle} className="inbox-row" onClick={() => onOpenAgent(e.to)}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{e.task}</span>
                <span style={{ fontSize: 11, color: "var(--cv-done)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.result ?? "returned"}
                </span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
