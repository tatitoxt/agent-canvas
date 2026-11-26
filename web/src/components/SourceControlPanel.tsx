import { useBoard } from "../store/board";
import { panelRoot } from "./panelChrome";
import { usePanelActions } from "./panelCtx";

const groupLabel: React.CSSProperties = {
  fontSize: "var(--cv-text-xxs)",
  fontWeight: 400,
  letterSpacing: "0.02em",
  color: "var(--cv-ink-faint)",
  padding: "10px 12px 4px",
};

const card: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  width: "100%",
  textAlign: "left",
  padding: "9px 12px",
  borderRadius: 10,
  border: "none",
  background: "transparent",
  color: "var(--cv-ink)",
};

const mono: React.CSSProperties = {
  fontFamily: "var(--cv-mono, ui-monospace, monospace)",
  fontSize: "var(--cv-text-xxs)",
  color: "var(--cv-ink-dim)",
};

const STATUS_COLOR: Record<string, string> = {
  working: "var(--cv-working)",
  waiting: "var(--cv-waiting)",
  blocked: "var(--cv-blocked)",
  done: "var(--cv-done)",
  idle: "var(--cv-idle)",
  exited: "var(--cv-idle)",
};

/** Source control — every agent worktree on the board: its branch, the
 * files it touched and a push action. Deska-style: one row per tree,
 * paths under it, push on the right. */
export function SourceControlPanel() {
  const agents = useBoard((s) => s.agents);
  const { openTerm } = usePanelActions();
  const activeBoard = useBoard((s) => s.activeBoard);

  const trees = Object.values(agents)
    .filter((a) => (a.board_id ?? "main") === activeBoard)
    // Exited agents stay visible while their worktree still has changes —
    // the changed-file list and push action must survive the exit.
    .filter((a) => (a.worktree || a.branch) && (a.status !== "exited" || (a.files ?? 0) > 0));
  const dirty = trees.reduce((n, a) => n + (a.files ?? 0), 0);

  return (
    <div
      style={{
        ...panelRoot,
        display: "flex",
        flexDirection: "column",
        padding: "12px 8px",
      }}
    >
      <div
        style={{
          padding: "0 12px 8px",
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          userSelect: "none",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: "var(--cv-text-xxs)", fontWeight: 500, color: "var(--cv-ink-faint)" }}>
          {trees.length} {trees.length === 1 ? "tree" : "trees"}
          {dirty > 0 ? ` · ${dirty} changed` : ""}
        </span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "0 4px" }}>
        {trees.length === 0 && (
          <div style={{ ...groupLabel, padding: "14px 12px", letterSpacing: "0.01em" }}>
            No agent worktrees yet — spawn an agent in a workspace and its
            branch shows up here.
          </div>
        )}
        {trees.map((a) => (
          <div key={a.id}>
            <div style={groupLabel}>
              <span
                style={{
                  display: "inline-block",
                  width: 6,
                  height: 6,
                  borderRadius: 99,
                  background: STATUS_COLOR[a.status] ?? "var(--cv-idle)",
                  marginRight: 6,
                }}
              />
              {a.name}
            </div>
            <div style={{ ...card, cursor: "default" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ ...mono, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.branch}>
                  {a.branch ?? "—"}
                </span>
                <button
                  title={`push ${a.branch ?? a.name}`}
                  onClick={() => useBoard.getState().gitPush(a.id)}
                  style={{
                    border: "1px solid var(--cv-glass-edge)",
                    background: "var(--cv-glass-hi)",
                    color: "var(--cv-ink)",
                    borderRadius: 7,
                    fontSize: "var(--cv-text-xxs)",
                    fontWeight: 600,
                    padding: "3px 9px",
                    cursor: "pointer",
                    flex: "none",
                  }}
                >
                  push
                </button>
              </div>
              <div style={{ ...mono, fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.worktree}>
                {a.worktree}
              </div>
              {(a.files ?? 0) > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 2 }}>
                  {(a.paths ?? []).slice(0, 8).map((p) => (
                    <div key={p} style={{ ...mono, fontSize: "var(--cv-text-xxs)", color: "var(--cv-waiting)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      M&nbsp;{p}
                    </div>
                  ))}
                  {(a.paths ?? []).length > 8 && (
                    <div style={{ ...mono, fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)" }}>
                      +{(a.paths ?? []).length - 8} more
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)" }}>clean tree</div>
              )}
              <button
                title={`open ${a.name}'s terminal`}
                onClick={() => openTerm({ id: a.id, name: a.name })}
                style={{ alignSelf: "flex-start", border: "none", background: "transparent", color: "var(--cv-accent)", fontSize: "var(--cv-text-xxs)", fontWeight: 600, padding: 0, cursor: "pointer" }}
              >
                open terminal →
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
