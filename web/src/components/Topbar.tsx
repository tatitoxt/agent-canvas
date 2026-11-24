import { useState } from "react";
import { useBoard } from "../store/board";
import { Icon } from "./icons";
import { ToolsMenu, type ToolsMenuActions } from "./ToolsRail";

const pill: React.CSSProperties = {
  padding: "5px 12px",
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--cv-ink)",
  display: "flex",
  alignItems: "center",
  gap: 6,
  cursor: "default",
  whiteSpace: "nowrap",
};

const divider: React.CSSProperties = {
  width: 1,
  height: 14,
  background: "var(--cv-glass-edge)",
};

/** Deska-style topbar: one pill row — app ▸ machine ▸ board ▸ status —
 * Mission Map + Tools dropdown + quick-request on the right. Board
 * switching lives in the left Spaces rail. */
export function Topbar({
  nav,
  onNav,
  tools,
}: {
  nav: string;
  onNav: (key: string) => void;
  tools: ToolsMenuActions;
}) {
  const connected = useBoard((s) => s.connected);
  const workspaces = useBoard((s) => s.workspaces);
  const agents = useBoard((s) => s.agents);
  const edges = useBoard((s) => s.edges);
  const boards = useBoard((s) => s.boards);
  const activeBoard = useBoard((s) => s.activeBoard);

  const wsList = Object.values(workspaces);
  const liveAgents = Object.values(agents).filter((a) => a.status !== "exited");
  const pending = Object.values(edges).filter((e) => e.state === "delegated").length;
  const working = Object.values(agents).filter((a) => a.status === "working").length;
  const needsYou = Object.values(agents).filter((a) => a.status === "waiting").length;
  const blocked = Object.values(agents).filter((a) => a.status === "blocked").length;
  const quickRequest = useBoard((s) => s.quickRequest);
  const [qr, setQr] = useState("");
  const [qrHint, setQrHint] = useState("");

  const count = (n: number, color: string, label: string) =>
    n > 0 ? (
      <span
        key={label}
        title={label}
        style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color }}
      >
        <span className="status-dot" style={{ background: color }} />
        {n}
      </span>
    ) : null;

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 58,
        right: 58,
        zIndex: 15,
        display: "flex",
        alignItems: "center",
        gap: 10,
        pointerEvents: "none",
      }}
    >
      <div
        className="glass-pill"
        style={{
          display: "flex",
          alignItems: "center",
          padding: "3px 8px",
          gap: 2,
          pointerEvents: "auto",
        }}
      >
        <span style={{ ...pill, color: "var(--cv-accent)", fontWeight: 700 }}>
          Canvas
        </span>
        <span style={divider} />
        <span style={{ ...pill, color: "var(--cv-ink-dim)", fontWeight: 500 }}>
          This Mac
        </span>
        <span style={divider} />
        <span style={pill}>
          {boards[activeBoard] ?? "Main"}
          {wsList.length > 0 && (
            <span style={{ color: "var(--cv-ink-faint)", fontWeight: 500 }}>
              · {wsList.length} ws
            </span>
          )}
        </span>
      </div>
      <div
        className="glass-pill"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "6px 12px",
          pointerEvents: "auto",
        }}
      >
        {count(working, "var(--cv-working)", "working")}
        {count(needsYou, "var(--cv-waiting)", "needs you")}
        {count(blocked, "var(--cv-blocked)", "blocked")}
        <span style={{ fontSize: 10.5, color: "var(--cv-ink-faint)" }}>
          {connected ? `${liveAgents.length} live` : "offline"}
          {pending > 0 ? ` · ${pending} in flight` : ""}
        </span>
      </div>
      <div style={{ flex: 1 }} />
      <button
        className="glass-pill"
        onClick={() => useBoard.getState().requestView()}
        title="Mission Map — fit the whole board in view"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          fontSize: 11.5,
          fontWeight: 650,
          color: "var(--cv-ink)",
          cursor: "pointer",
          pointerEvents: "auto",
        }}
      >
        <Icon name="map" size={13} color="var(--cv-ink-dim)" />
        Map
      </button>
      <ToolsMenu active={nav} onSelect={onNav} actions={tools} />
      <div
        className="glass-pill"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 12px",
          pointerEvents: "auto",
        }}
      >
        <Icon name="automations" size={12} color="var(--cv-ink-faint)" />
        <input
          value={qr}
          onChange={(e) => setQr(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && qr.trim()) {
              setQrHint(quickRequest(qr));
              setQr("");
              setTimeout(() => setQrHint(""), 2400);
            }
          }}
          placeholder={qrHint || "quick request · ⌘K commands"}
          title="Local short-requests — instant, no agent spawned"
          style={{
            width: 210,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--cv-ink)",
            fontSize: 11,
            fontFamily: "inherit",
          }}
        />
      </div>
    </div>
  );
}
