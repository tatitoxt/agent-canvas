import { useBoard } from "../store/board";
import { Icon } from "./icons";

const hintRow: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 10,
  fontFamily: "var(--cv-font-mono)",
  fontSize: "var(--cv-text-xxs)",
  lineHeight: 1.9,
};

/** The first-run canvas — what a brand-new user sees before anything exists.
 * Editorial rather than illustrative: a quiet mark, one clear line, the three
 * gestures that matter, and a single accent action. The whole overlay is
 * pointer-transparent except the action button, so the pane's own gestures
 * (double-click to spawn, right-click for tools, marquee select) work
 * straight through it. */
export function CanvasEmptyState() {
  return (
    <div
      data-testid="canvas-empty-state"
      className="cv-canvas-empty"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 5,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          transform: "translateY(-5vh)",
          maxWidth: 340,
        }}
      >
        <div
          aria-hidden
          style={{
            width: 52,
            height: 52,
            borderRadius: 15,
            background: "var(--cv-ink-fill-control)",
            border: "1px solid var(--cv-hairline)",
            boxShadow: "inset 0 1px 0 var(--cv-glass-shine)",
            display: "grid",
            placeItems: "center",
            marginBottom: 18,
          }}
        >
          <Icon name="canvas" size={22} color="var(--cv-ink-dim)" />
        </div>
        <div
          style={{
            fontSize: "var(--cv-text-xl)",
            fontWeight: 600,
            letterSpacing: "0.01em",
            color: "var(--cv-ink)",
            lineHeight: 1.3,
          }}
        >
          This board is empty
        </div>
        <div
          style={{
            fontSize: "var(--cv-text-xs)",
            color: "var(--cv-ink-dim)",
            lineHeight: 1.6,
            marginTop: 8,
            maxWidth: 300,
          }}
        >
          Agents, terminals, notes and panels live here as cards — spawn one and it lands where you can move it, wire it and read it at a glance.
        </div>
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <div style={hintRow}>
            <span style={{ color: "var(--cv-ink-dim)", minWidth: 88, textAlign: "right" }}>double-click</span>
            <span style={{ color: "var(--cv-ink-faint)" }}>new agent here</span>
          </div>
          <div style={hintRow}>
            <span style={{ color: "var(--cv-ink-dim)", minWidth: 88, textAlign: "right" }}>right-click</span>
            <span style={{ color: "var(--cv-ink-faint)" }}>add tools to the board</span>
          </div>
          <div style={hintRow}>
            <span style={{ color: "var(--cv-ink-dim)", minWidth: 88, textAlign: "right" }}>⌘K</span>
            <span style={{ color: "var(--cv-ink-faint)" }}>every command, one palette</span>
          </div>
        </div>
        <button
          className="cv-mini-btn"
          data-testid="canvas-empty-spawn"
          title="open the agent chooser — the card lands on this board"
          style={{
            pointerEvents: "auto",
            marginTop: 20,
            padding: "7px 18px",
            fontSize: "var(--cv-text-xs)",
            color: "var(--cv-accent)",
          }}
          onClick={() => useBoard.getState().setSpawnOpen(true)}
        >
          spawn your first agent
        </button>
      </div>
    </div>
  );
}
