import { useBoard } from "../store/board";

const ITEMS = [
  { key: "canvas", glyph: "◫", label: "Canvas" },
  { key: "inbox", glyph: "◱", label: "Inbox" },
  { key: "automations", glyph: "◈", label: "Automations" },
  { key: "history", glyph: "↺", label: "History" },
  { key: "accounts", glyph: "◉", label: "Accounts" },
  { key: "settings", glyph: "◌", label: "Settings" },
] as const;

/** Left navigation rail — section switcher + connection status. */
export function NavRail({ active, onSelect }: { active: string; onSelect: (key: string) => void }) {
  const connected = useBoard((s) => s.connected);
  const agents = useBoard((s) => s.agents);
  const edges = useBoard((s) => s.edges);
  const approvals = useBoard((s) => s.approvals);
  const inboxCount =
    Object.keys(approvals).length +
    Object.values(agents).filter((a) => a.status === "waiting" || a.status === "blocked").length +
    Object.values(edges).filter((e) => e.state === "delegated").length;
  return (
    <nav
      className="glass"
      style={{
        position: "absolute",
        left: 16,
        top: "50%",
        transform: "translateY(-50%)",
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        padding: "10px 8px",
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          display: "grid",
          placeItems: "center",
          fontSize: 15,
          marginBottom: 6,
          color: "var(--cv-accent)",
        }}
        title="Agent Canvas"
      >
        ◧
      </div>
      {ITEMS.map((it) => (
        <button
          key={it.key}
          title={it.label}
          onClick={() => onSelect(it.key)}
          style={{
            width: 34,
            height: 34,
            display: "grid",
            placeItems: "center",
            borderRadius: 12,
            border: "none",
            cursor: "pointer",
            fontSize: 15,
            color:
              active === it.key ? "var(--cv-ink)" : "var(--cv-ink-faint)",
            background:
              active === it.key ? "var(--cv-glass-hi)" : "transparent",
            position: "relative",
            boxShadow:
              active === it.key
                ? "inset 0 1px 0 var(--cv-glass-shine)"
                : "none",
          }}
        >
          {it.glyph}
          {it.key === "inbox" && inboxCount > 0 && (
            <span
              style={{
                position: "absolute",
                top: 2,
                right: 2,
                minWidth: 14,
                height: 14,
                borderRadius: 999,
                background: "var(--cv-waiting)",
                color: "var(--cv-base)",
                fontSize: 9,
                fontWeight: 700,
                display: "grid",
                placeItems: "center",
                padding: "0 4px",
              }}
            >
              {inboxCount}
            </span>
          )}
        </button>
      ))}
      <div
        title={connected ? "daemon connected" : "daemon offline"}
        style={{
          marginTop: 8,
          width: 8,
          height: 8,
          borderRadius: 999,
          background: connected ? "var(--cv-done)" : "var(--cv-ink-faint)",
        }}
      />
    </nav>
  );
}
