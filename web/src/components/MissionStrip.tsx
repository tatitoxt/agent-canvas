import type { AgentStatus } from "../board/types";
import { useBoard } from "../store/board";

type Props = {
  counts: Record<AgentStatus, number>;
  /** Controlled open state — the topbar map button drives it. */
  open: boolean;
  onToggle: () => void;
};

const ITEMS: { key: AgentStatus; label: string; color: string }[] = [
  { key: "working", label: "working", color: "var(--cv-working)" },
  { key: "waiting", label: "needs you", color: "var(--cv-waiting)" },
  { key: "blocked", label: "blocked", color: "var(--cv-blocked)" },
  { key: "done", label: "done", color: "var(--cv-done)" },
];

/** Quiet top-center status strip — clicking it unfolds into the mission
 * map: every agent on the board grouped by who is working / resting /
 * needs you, with the last thing each was doing. */
export function MissionStrip({ counts, open, onToggle }: Props) {
  const connected = useBoard((s) => s.connected);
  const agents = useBoard((s) => s.agents);
  const activityLines = useBoard((s) => s.activityLines);
  const activeBoard = useBoard((s) => s.activeBoard);
  const attention = useBoard((s) => s.attention);
  const setOpen = onToggle;

  const grouped = (st: AgentStatus | "blocked") =>
    Object.values(agents).filter(
      (a) =>
        (a.board_id ?? "main") === activeBoard &&
        (st === "blocked"
          ? !!attention[a.id]
          : !attention[a.id] &&
            (st === "done" ? a.status === "exited" : a.status === st)),
    );

  const rows: { label: string; color: string; list: (typeof agents)[string][] }[] = [
    { label: "Needs you", color: "var(--cv-waiting)", list: grouped("waiting") },
    { label: "Blocked", color: "var(--cv-blocked)", list: grouped("blocked") },
    { label: "Working", color: "var(--cv-working)", list: grouped("working") },
    { label: "Resting", color: "var(--cv-done)", list: grouped("done") },
  ];

  return (
    <div
      className="glass-pill"
      style={{
        position: "absolute",
        top: 56,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 15,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "8px 18px",
        cursor: "pointer",
      }}
      onClick={() => setOpen()}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ fontSize: "var(--cv-text-xs)", fontWeight: 600, letterSpacing: 0.3, marginRight: 2 }}>
          canvas
        </span>
        {ITEMS.map(({ key, label, color }) => (
          <span key={key} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "var(--cv-text-xxs)" }}>
            <span className="status-dot" style={{ background: color }} />
            <span style={{ fontWeight: 600, color }}>{counts[key] ?? 0}</span>
            <span style={{ color: "var(--cv-ink-faint)" }}>{label}</span>
          </span>
        ))}
        {!connected && (
          <span style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)" }}>demo</span>
        )}
      </div>
      {open && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            borderTop: "1px solid var(--cv-glass-edge)",
            paddingTop: 10,
            minWidth: 340,
            maxWidth: 520,
            cursor: "default",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {rows.map(
            (r) =>
              r.list.length > 0 && (
                <div key={r.label}>
                  <div
                    style={{
                      fontSize: "var(--cv-text-xxs)",
                      fontWeight: 400,
                      color: r.color,
                      letterSpacing: "0.02em",
                      marginBottom: 3,
                    }}
                  >
                    {r.label} · {r.list.length}
                  </div>
                  {r.list.map((a) => (
                    <div
                      key={a.id}
                      style={{
                        display: "flex",
                        gap: 8,
                        fontSize: "var(--cv-text-xxs)",
                        color: "var(--cv-ink)",
                        padding: "2px 0",
                        alignItems: "baseline",
                      }}
                    >
                      <span style={{ fontWeight: 600, flexShrink: 0 }}>{a.name}</span>
                      <span
                        style={{
                          color: "var(--cv-ink-dim)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {activityLines[a.id] ?? a.lastLine ?? ""}
                      </span>
                    </div>
                  ))}
                </div>
              ),
          )}
          {rows.every((r) => r.list.length === 0) && (
            <div style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-dim)" }}>no agents on this board</div>
          )}
        </div>
      )}
    </div>
  );
}
