import { useBoard } from "../store/board";

const fmtBytes = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : n >= 1_000 ? `${(n / 1_000).toFixed(1)} KB` : `${n} B`;

/** Juice — per-agent usage on this board: terminal output produced, files
 * touched in its worktree, permission tier, signed-in account. Rows sort by
 * output; click flies the camera to the card. */
export function UsagePanel() {
  const agents = useBoard((s) => s.agents);
  const activeBoard = useBoard((s) => s.activeBoard);
  const requestFocus = useBoard((s) => s.requestFocus);

  const boardAgents = Object.values(agents).filter(
    (a) => (a.board_id ?? "main") === activeBoard,
  );
  const list = [...boardAgents].sort(
    (a, b) => (b.output_bytes ?? 0) - (a.output_bytes ?? 0),
  );

  const totalBytes = boardAgents.reduce((n, a) => n + (a.output_bytes ?? 0), 0);
  const totalFiles = boardAgents.reduce((n, a) => n + (a.files ?? 0), 0);
  const live = boardAgents.filter(
    (a) => a.status === "working" || a.status === "waiting" || a.status === "blocked",
  ).length;

  return (
    <div
      className="glass"
      style={{
        position: "absolute",
        right: 76,
        top: 64,
        width: 300,
        maxHeight: "72vh",
        zIndex: 19,
        padding: "12px 10px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 650, padding: "0 12px 8px", color: "var(--cv-ink)" }}>
        Juice
      </div>
      <div style={{ fontSize: 10, color: "var(--cv-ink-dim)", padding: "0 12px 10px" }}>
        {boardAgents.length} agent{boardAgents.length === 1 ? "" : "s"} · {live} live ·{" "}
        {fmtBytes(totalBytes)} output · {totalFiles} file{totalFiles === 1 ? "" : "s"} changed
      </div>
      <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
        {boardAgents.length === 0 && (
          <div style={{ fontSize: 11, color: "var(--cv-ink-dim)", padding: "2px 12px 8px" }}>
            No agents on this board — spawn one and watch its meter.
          </div>
        )}
        {list.map((a) => (
          <button
            key={a.id}
            onClick={() => requestFocus(a.id)}
            title={a.worktree ? `${a.name} — ${a.worktree}` : a.name}
            style={{
              display: "grid",
              gridTemplateColumns: "8px 1fr auto",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              border: "1px solid var(--cv-glass-edge)",
              borderRadius: 8,
              background: "transparent",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 99,
                background: `var(--cv-${a.status === "exited" ? "done" : a.status})`,
              }}
            />
            <span style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "var(--cv-ink)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                Terminal {boardAgents.indexOf(a) + 1}
                {a.command ? ` · ${a.command}` : ""}
              </div>
              <div style={{ fontSize: 9.5, color: "var(--cv-ink-dim)" }}>
                {a.status}
                {a.permission ? ` · ${a.permission}` : ""}
                {a.account_label ? ` · ${a.account_label}` : ""}
              </div>
            </span>
            <span style={{ textAlign: "right", fontSize: 10, color: "var(--cv-ink)" }}>
              <div>{fmtBytes(a.output_bytes ?? 0)}</div>
              {a.files ? <div style={{ color: "var(--cv-ink-dim)" }}>{a.files} files</div> : null}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
