import { useBoard } from "../store/board";
import { PinBtn } from "./PinBtn";

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
      data-panel="inbox"
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
          display: "flex",
          alignItems: "center",
        }}
      >
        Inbox
        <span style={{ flex: 1 }} />
        <PinBtn anchor="inbox" title="Inbox" body={needsYou.map((a) => `${a.name} — ${a.lastLine ?? a.status}`).join("\n")} />
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {empty && (
          <div style={{ padding: "18px 12px", fontSize: 11.5, color: "var(--cv-ink-dim)" }}>
            Nothing needs you — agents are running or done.
          </div>
        )}
        {alerts.length > 0 && (
          <>
            <div style={{ ...groupLabel, color: "var(--cv-blocked)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>automation alerts</span>
              <button
                style={{ background: "none", border: "none", color: "var(--cv-ink-faint)", fontSize: 10, cursor: "pointer" }}
                onClick={() => useBoard.getState().dismissAlert("*")}
              >
                clear all
              </button>
            </div>
            {alerts.map((a) => (
              <div key={a.id} style={{ ...rowStyle, cursor: "default", position: "relative" }}>
                <button
                  style={{ position: "absolute", right: 8, top: 8, background: "none", border: "none", color: "var(--cv-ink-faint)", fontSize: 11, cursor: "pointer" }}
                  title="dismiss"
                  onClick={() => useBoard.getState().dismissAlert(a.id)}
                >
                  ×
                </button>
                <button
                  style={{ ...rowStyle, padding: 0 }}
                  className="inbox-row"
                  onClick={() => onOpenAgent(a.id)}
                >
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{a.name}</span>
                  <span style={{ fontSize: 11, color: "var(--cv-ink-dim)", paddingRight: 14 }}>{a.reason}</span>
                </button>
              </div>
            ))}
          </>
        )}
        {held.length > 0 && (
          <>
            <div style={{ ...groupLabel, color: "var(--cv-waiting)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              approve commands
              {held.length > 1 && (
                <span style={{ display: "flex", gap: 8 }}>
                  <button
                    title="approve every held command"
                    style={{ border: "none", background: "none", cursor: "pointer", fontSize: 10, fontWeight: 600, color: "var(--cv-done)" }}
                    onClick={() => held.forEach((h) => useBoard.getState().approveInput(h.id))}
                  >
                    approve all
                  </button>
                  <button
                    title="deny every held command"
                    style={{ border: "none", background: "none", cursor: "pointer", fontSize: 10, fontWeight: 600, color: "var(--cv-danger, #c66)" }}
                    onClick={() => held.forEach((h) => useBoard.getState().denyInput(h.id))}
                  >
                    deny all
                  </button>
                </span>
              )}
            </div>
            {held.map((h) => (
              <div key={h.id} style={{ ...rowStyle, cursor: "default" }}>
                <button
                  style={{ ...rowStyle, padding: 0 }}
                  className="inbox-row"
                  title="open the terminal"
                  onClick={() => onOpenAgent(h.id)}
                >
                  <span style={{ fontSize: 12, fontWeight: 600 }}>
                    {h.name}
                    <span style={{ fontSize: 9.5, fontWeight: 500, color: "var(--cv-ink-faint)", marginLeft: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      {agents[h.id]?.permission ?? "supervised"}
                    </span>
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--cv-ink-dim)",
                      fontFamily: "ui-monospace, SFMono-Regular, monospace",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: "100%",
                      display: "block",
                      textAlign: "left",
                    }}
                    title={h.line}
                  >
                    {h.line}
                  </span>
                </button>
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
                  <button
                    className="glass-pill"
                    style={{ fontSize: 10.5, fontWeight: 600, padding: "2px 11px", color: "var(--cv-waiting)", cursor: "pointer", border: "none" }}
                    title="Allow this one and stop asking — agent moves to auto"
                    onClick={() => useBoard.getState().approveAlways(h.id)}
                  >
                    always
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
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button style={{ ...rowStyle, flex: 1 }} className="inbox-row" onClick={() => onOpenAgent(a.id)}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{a.name}</span>
                  <span style={{ fontSize: 11, color: "var(--cv-ink-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {a.lastLine ?? (a.status === "blocked" ? "blocked" : "waiting for input")}
                  </span>
                </button>
                {(["↵", "y", "n", "esc"] as const).map((k) => (
                  <button
                    key={k}
                    className="glass-pill"
                    title={`type ${k === "↵" ? "enter" : k === "esc" ? "escape" : `'${k}'`} into ${a.name}'s terminal`}
                    style={{ fontSize: 10.5, fontWeight: 600, padding: "2px 8px", cursor: "pointer", border: "none", color: "var(--cv-ink-dim)", fontFamily: "ui-monospace, monospace", flexShrink: 0 }}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      const seq = k === "↵" ? "\r" : k === "esc" ? "\x1b" : k;
                      useBoard.getState().sendInput(a.id, new TextEncoder().encode(seq));
                    }}
                  >
                    {k}
                  </button>
                ))}
              </div>
            ))}
          </>
        )}
        {inFlight.length > 0 && (
          <>
            <div style={groupLabel}>delegations in flight</div>
            {inFlight.map((e) => (
              <button
                key={e.id}
                style={rowStyle}
                className="inbox-row"
                title="Open this delegation's full record"
                onClick={() => useBoard.getState().setEdgeDetail(e.id)}
              >
                <span style={{ fontSize: 12, fontWeight: 600 }}>{e.task}</span>
                <span style={{ fontSize: 11, color: "var(--cv-ink-dim)" }}>delegated</span>
              </button>
            ))}
          </>
        )}
        {done.length > 0 && (
          <>
            <div style={{ ...groupLabel, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>returned</span>
              <button
                style={{ background: "none", border: "none", color: "var(--cv-ink-faint)", fontSize: 10, cursor: "pointer" }}
                onClick={() => useBoard.getState().clearReturned()}
              >
                clear
              </button>
            </div>
            {done.map((e) => (
              <button
                key={e.id}
                style={rowStyle}
                className="inbox-row"
                title="Open this delegation's full record"
                onClick={() => useBoard.getState().setEdgeDetail(e.id)}
              >
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
