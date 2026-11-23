import { useBoard } from "../store/board";

const field: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.8,
  textTransform: "uppercase",
  color: "var(--cv-ink-faint)",
  margin: "12px 0 4px",
};

const stateColor: Record<string, string> = {
  delegated: "var(--cv-waiting)",
  returned: "var(--cv-done)",
  failed: "var(--cv-blocked)",
};

/** Delegation detail — the edge as a record: who delegated what to whom,
 * what came back, and what it touched. Opened by clicking an edge. */
export function DelegationPanel({
  edgeId,
  onClose,
  onOpenAgent,
}: {
  edgeId: string;
  onClose: () => void;
  onOpenAgent: (id: string, name: string) => void;
}) {
  const edge = useBoard((s) => s.edges[edgeId]);
  const agents = useBoard((s) => s.agents);
  if (!edge) return null;

  const from = agents[edge.from];
  const to = agents[edge.to];

  return (
    <div
      className="glass"
      style={{
        position: "absolute",
        right: 16,
        top: 64,
        width: 300,
        zIndex: 25,
        padding: "14px 14px 12px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 2,
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 650, color: "var(--cv-ink)" }}>
          delegation
        </span>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: "var(--cv-ink-faint)", cursor: "pointer", fontSize: 13 }}
        >
          ✕
        </button>
      </div>
      <div style={{ fontSize: 11, color: stateColor[edge.state] ?? "var(--cv-ink-dim)" }}>
        {edge.state}
      </div>

      <div style={field}>from</div>
      <button
        onClick={() => from && onOpenAgent(edge.from, from.name)}
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "var(--cv-ink)", fontFamily: "inherit" }}
      >
        {from?.name ?? edge.from.slice(0, 8)}
        <span style={{ fontSize: 10.5, color: "var(--cv-ink-faint)", marginLeft: 6 }}>
          {from?.command}
        </span>
      </button>

      <div style={field}>to</div>
      <button
        onClick={() => to && to.status !== "exited" && onOpenAgent(edge.to, to.name)}
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "var(--cv-ink)", fontFamily: "inherit" }}
      >
        {to?.name ?? edge.to.slice(0, 8)}
        <span style={{ fontSize: 10.5, color: "var(--cv-ink-faint)", marginLeft: 6 }}>
          {to?.command}{to ? ` · ${to.status}` : ""}
        </span>
      </button>

      <div style={field}>task</div>
      <div style={{ fontSize: 12, color: "var(--cv-ink)", lineHeight: 1.45 }}>{edge.task}</div>

      {edge.result && (
        <>
          <div style={field}>result</div>
          <div style={{ fontSize: 12, color: "var(--cv-ink)", lineHeight: 1.45 }}>{edge.result}</div>
        </>
      )}

      <div style={field}>files changed</div>
      <div style={{ fontSize: 12, color: "var(--cv-ink)" }}>
        {edge.files ?? 0} file{(edge.files ?? 0) === 1 ? "" : "s"}
        {to?.branch && (
          <span style={{ fontSize: 10.5, color: "var(--cv-ink-faint)", marginLeft: 8, fontFamily: "ui-monospace, monospace" }}>
            ⎇ {to.branch}
          </span>
        )}
      </div>
    </div>
  );
}
