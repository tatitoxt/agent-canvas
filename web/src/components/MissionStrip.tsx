import type { AgentStatus } from "../board/types";
import { useBoard } from "../store/board";

type Props = { counts: Record<AgentStatus, number> };

const ITEMS: { key: AgentStatus; label: string; color: string }[] = [
  { key: "working", label: "working", color: "var(--cv-working)" },
  { key: "waiting", label: "needs you", color: "var(--cv-waiting)" },
  { key: "blocked", label: "blocked", color: "var(--cv-blocked)" },
  { key: "done", label: "done", color: "var(--cv-done)" },
];

/** Quiet top-center status strip — one glass pill, dots + counts only. */
export function MissionStrip({ counts }: Props) {
  const connected = useBoard((s) => s.connected);
  return (
    <div
      className="glass-pill"
      style={{
        position: "absolute",
        top: 14,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 15,
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "8px 18px",
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 650,
          letterSpacing: 0.3,
          marginRight: 2,
        }}
      >
        canvas
      </span>
      {ITEMS.map(({ key, label, color }) => (
        <span
          key={key}
          style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}
        >
          <span className="status-dot" style={{ background: color }} />
          <span style={{ fontWeight: 600, color }}>{counts[key] ?? 0}</span>
          <span style={{ color: "var(--cv-ink-faint)" }}>{label}</span>
        </span>
      ))}
      {!connected && (
        <span style={{ fontSize: 10.5, color: "var(--cv-ink-faint)" }}>
          demo
        </span>
      )}
    </div>
  );
}
