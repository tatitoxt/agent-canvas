import { useBoard } from "../store/board";
import { Icon } from "./icons";
import { panelRoot } from "./panelChrome";

const groupLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.8,
  textTransform: "uppercase",
  color: "var(--cv-ink-faint)",
  padding: "10px 12px 4px",
};

const ticketRow: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
  width: "100%",
  textAlign: "left",
  padding: "9px 12px",
  borderRadius: 10,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  color: "var(--cv-ink)",
};

const STATE_COLOR: Record<string, string> = {
  delegated: "var(--cv-waiting)",
  returned: "var(--cv-done)",
  failed: "var(--cv-blocked)",
};

const STATE_LABEL: Record<string, string> = {
  delegated: "in flight",
  returned: "returned",
  failed: "failed",
};

/** Dev tickets — every delegation on the board as a ticket: the task,
 * who it went to, its state and what came back. Click opens the edge's
 * delegation detail. */
export function DevTicketsPanel() {
  const setEdgeDetail = useBoard((s) => s.setEdgeDetail);
  const edges = useBoard((s) => s.edges);
  const agents = useBoard((s) => s.agents);
  const orchestrators = useBoard((s) => s.orchestrators);
  const activeBoard = useBoard((s) => s.activeBoard);

  const nameOf = (id: string) => agents[id]?.name ?? orchestrators[id]?.name ?? id.slice(0, 8);
  const all = Object.values(edges)
    .filter(
      // A ticket lives on its delegator's board — moving the child agent
      // elsewhere doesn't move the work it was given.
      (e) =>
        (agents[e.from]?.board_id ??
          orchestrators[e.from]?.board ??
          agents[e.to]?.board_id ??
          "main") === activeBoard,
    )
    .sort(
    (a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  );
  const groups: Array<[string, typeof all]> = [
    ["in flight", all.filter((e) => e.state === "delegated")],
    ["returned", all.filter((e) => e.state === "returned")],
    ["failed", all.filter((e) => e.state === "failed")],
  ];

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
          fontSize: 12.5,
          fontWeight: 650,
          padding: "0 12px 8px",
          color: "var(--cv-ink)",
          display: "flex",
          alignItems: "center",
          gap: 7,
          userSelect: "none",
        }}
      >
        <Icon name="ticket" size={14} color="var(--cv-accent)" />
        Dev tickets
        <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 500, color: "var(--cv-ink-faint)" }}>
          {all.length} total
        </span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "0 4px" }}>
        {all.length === 0 && (
          <div style={{ ...groupLabel, padding: "14px 12px", textTransform: "none", fontWeight: 500, letterSpacing: 0 }}>
            No tickets yet — drag a wire off an agent card to delegate a
            task and it lands here.
          </div>
        )}
        {groups.map(([label, list]) =>
          list.length === 0 ? null : (
            <div key={label}>
              <div style={groupLabel}>
                <span
                  style={{
                    display: "inline-block",
                    width: 6,
                    height: 6,
                    borderRadius: 99,
                    background: STATE_COLOR[label === "in flight" ? "delegated" : label],
                    marginRight: 6,
                  }}
                />
                {label} · {list.length}
              </div>
              {list.map((e) => (
                <button
                  key={e.id}
                  style={ticketRow}
                  title="open delegation detail"
                  onClick={() => setEdgeDetail(e.id)}
                  onMouseEnter={(ev) => (ev.currentTarget.style.background = "var(--cv-glass-hi)")}
                  onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600 }}>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {e.task || "untitled task"}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "var(--cv-ink-dim)" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {nameOf(e.from)} → {nameOf(e.to)}
                    </span>
                    <span style={{ marginLeft: "auto", flex: "none", color: STATE_COLOR[e.state] }}>
                      {STATE_LABEL[e.state]}
                    </span>
                  </div>
                  {e.result && (
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--cv-ink-dim)",
                        overflow: "hidden",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {e.result}
                    </div>
                  )}
                  {(e.files ?? 0) > 0 && (
                    <div style={{ fontSize: 9.5, color: "var(--cv-waiting)" }}>
                      {e.files} file{e.files === 1 ? "" : "s"} changed
                    </div>
                  )}
                </button>
              ))}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
