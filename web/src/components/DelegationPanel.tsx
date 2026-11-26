import { useState } from "react";
import { useBoard } from "../store/board";

const field: React.CSSProperties = {
  fontSize: "var(--cv-text-xxs)",
  fontWeight: 400,
  letterSpacing: "0.02em",
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
  const [confirmDelete, setConfirmDelete] = useState(false);
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
        <span style={{ fontSize: "var(--cv-text-sm)", fontWeight: 600, color: "var(--cv-ink)" }}>
          delegation
        </span>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: "var(--cv-ink-faint)", cursor: "pointer", fontSize: "var(--cv-text-sm)" }}
        >
          ✕
        </button>
      </div>
      <div style={{ fontSize: "var(--cv-text-xxs)", color: stateColor[edge.state] ?? "var(--cv-ink-dim)" }}>
        {edge.state}
      </div>

      <div style={field}>From</div>
      <button
        onClick={() => from && onOpenAgent(edge.from, from.name)}
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: "var(--cv-text-sm)", fontWeight: 600, color: "var(--cv-ink)", fontFamily: "inherit" }}
      >
        {from?.name ?? edge.from.slice(0, 8)}
        <span style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)", marginLeft: 6 }}>
          {from?.command}
        </span>
      </button>

      <div style={field}>To</div>
      <button
        onClick={() => to && to.status !== "exited" && onOpenAgent(edge.to, to.name)}
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: "var(--cv-text-sm)", fontWeight: 600, color: "var(--cv-ink)", fontFamily: "inherit" }}
      >
        {to?.name ?? edge.to.slice(0, 8)}
        <span style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)", marginLeft: 6 }}>
          {to?.command}{to ? ` · ${to.status}` : ""}
        </span>
      </button>

      <div style={field}>Task</div>
      <div style={{ fontSize: "var(--cv-text-xs)", color: "var(--cv-ink)", lineHeight: 1.45 }}>{edge.task}</div>

      {edge.result && (
        <>
          <div style={field}>Result</div>
          <div style={{ fontSize: "var(--cv-text-xs)", color: "var(--cv-ink)", lineHeight: 1.45 }}>{edge.result}</div>
        </>
      )}

      <div style={field}>Files changed</div>
      <div style={{ fontSize: "var(--cv-text-xs)", color: "var(--cv-ink)" }}>
        {edge.files ?? 0} file{(edge.files ?? 0) === 1 ? "" : "s"}
        {to?.branch && (
          <span style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)", marginLeft: 8, fontFamily: "var(--cv-font-mono)" }}>
            ⎇ {to.branch}
          </span>
        )}
      </div>
      {(to?.paths?.length ?? 0) > 0 && (
        <div
          style={{
            marginTop: 6,
            fontSize: "var(--cv-text-xxs)",
            fontFamily: "var(--cv-font-mono)",
            color: "var(--cv-ink-dim)",
            maxHeight: 120,
            overflowY: "auto",
            lineHeight: 1.6,
          }}
        >
          {to!.paths!.slice(0, 40).map((p) => (
            <div key={p}>{p}</div>
          ))}
          {to!.paths!.length > 40 && <div>…{to!.paths!.length - 40} more</div>}
        </div>
      )}
      {to && (edge.files ?? 0) > 0 && (
        <DiffBlock agentId={edge.to} />
      )}

      {to && edge.state !== "delegated" && (
        <button
          onClick={() =>
            useBoard
              .getState()
              .delegate(edge.from, `${to.name}-retry`, to.command ?? "bash", edge.task, to.permission)
          }
          title="Run this same task again — spawns a fresh child agent wired to the same delegator"
          style={{
            marginTop: 10,
            width: "100%",
            border: "1px solid var(--cv-border)",
            borderRadius: 8,
            background: "var(--cv-panel)",
            color: "var(--cv-accent)",
            fontSize: "var(--cv-text-xs)",
            fontWeight: 600,
            padding: "7px 0",
            cursor: "pointer",
          }}
        >
          ↺ replay this delegation
        </button>
      )}
      <button
        onClick={() => {
          if (confirmDelete) {
            useBoard.getState().deleteEdge(edge.id);
            onClose();
          } else {
            setConfirmDelete(true);
            setTimeout(() => setConfirmDelete(false), 2500);
          }
        }}
        title="Remove this delegation record and its edge from the board"
        style={{
          marginTop: 6,
          width: "100%",
          border: `1px solid ${confirmDelete ? "#e5484d" : "var(--cv-border)"}`,
          borderRadius: 8,
          background: "transparent",
          color: confirmDelete ? "#e5484d" : "var(--cv-ink-dim)",
          fontSize: "var(--cv-text-xxs)",
          fontWeight: 600,
          padding: "5px 0",
          cursor: "pointer",
        }}
      >
        {confirmDelete ? "remove this record? click again" : "✕ remove record"}
      </button>
    </div>
  );
}

/** Expandable unified diff of what the child produced — the edge's
 * payload rendered, not just counted. Fetched on demand from the daemon. */
function DiffBlock({ agentId }: { agentId: string }) {
  const [open, setOpen] = useState(false);
  const diff = useBoard((s) => s.diffTexts[agentId]);
  const requestDiff = useBoard((s) => s.requestDiff);
  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) requestDiff(agentId);
        }}
        style={{
          border: "none",
          background: "transparent",
          color: "var(--cv-accent)",
          fontSize: "var(--cv-text-xxs)",
          cursor: "pointer",
          padding: 0,
        }}
      >
        {open ? "hide diff ▾" : "view diff ▸"}
      </button>
      {open && (
        <pre
          style={{
            marginTop: 6,
            fontSize: "var(--cv-text-xxs)",
            fontFamily: "var(--cv-font-mono)",
            color: "var(--cv-ink-dim)",
            background: "rgba(0,0,0,0.3)",
            border: "1px solid var(--cv-glass-edge)",
            borderRadius: 8,
            padding: "8px 10px",
            maxHeight: 240,
            overflow: "auto",
            whiteSpace: "pre",
            lineHeight: 1.5,
          }}
        >
          {diff ?? "loading…"}
        </pre>
      )}
    </div>
  );
}
