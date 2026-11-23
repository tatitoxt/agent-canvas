import { useBoard } from "../store/board";

const ITEMS = [
  { key: "canvas", glyph: "◫", label: "Canvas" },
  { key: "inbox", glyph: "◱", label: "Inbox" },
  { key: "agents", glyph: "◈", label: "Agents" },
  { key: "settings", glyph: "◌", label: "Settings" },
] as const;

/** Left navigation rail — section switcher + connection status. */
export function NavRail({ active }: { active: string }) {
  const connected = useBoard((s) => s.connected);
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
            boxShadow:
              active === it.key
                ? "inset 0 1px 0 var(--cv-glass-shine)"
                : "none",
          }}
        >
          {it.glyph}
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
