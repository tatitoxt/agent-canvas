import { useState } from "react";
import { useBoard } from "../store/board";

const pill: React.CSSProperties = {
  padding: "5px 13px",
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--cv-ink)",
  display: "flex",
  alignItems: "center",
  gap: 6,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const crumb: React.CSSProperties = {
  color: "var(--cv-ink-faint)",
  fontSize: 11,
  padding: "0 2px",
};

/** Deska-style breadcrumb topbar: home ▸ scope ▸ workspace + status cluster. */
export function Topbar() {
  const connected = useBoard((s) => s.connected);
  const workspaces = useBoard((s) => s.workspaces);
  const agents = useBoard((s) => s.agents);
  const edges = useBoard((s) => s.edges);

  const wsList = Object.values(workspaces);
  const liveAgents = Object.values(agents).filter((a) => a.status !== "exited");
  const pending = Object.values(edges).filter((e) => e.state === "delegated").length;
  const quickRequest = useBoard((s) => s.quickRequest);
  const [qr, setQr] = useState("");
  const [qrHint, setQrHint] = useState("");

  return (
    <div
      style={{
        position: "absolute",
        top: 14,
        left: 50,
        right: 14,
        zIndex: 15,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        pointerEvents: "none",
      }}
    >
      <div
        className="glass-pill"
        style={{
          display: "flex",
          alignItems: "center",
          padding: "4px 6px",
          gap: 2,
          pointerEvents: "auto",
        }}
      >
        <span className="glass-pill" style={pill}>
          <span style={{ color: "var(--cv-accent)" }}>⌂</span> canvas
        </span>
        <span style={crumb}>▸</span>
        <span style={{ ...pill, color: "var(--cv-ink-dim)", fontWeight: 500 }}>
          this machine
        </span>
        {wsList.length > 0 && (
          <>
            <span style={crumb}>▸</span>
            <span style={pill}>
              {wsList.length === 1 ? wsList[0].name : `${wsList.length} workspaces`}
            </span>
          </>
        )}
      </div>
      <div
        className="glass-pill"
        style={{ padding: "3px 12px", pointerEvents: "auto" }}
      >
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
          placeholder={qrHint || "⌘ quick request · bigger text, undo, fit, clear done"}
          title="Local short-requests — instant, no agent spawned"
          style={{
            width: 300,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--cv-ink)",
            fontSize: 11,
            fontFamily: "inherit",
          }}
        />
      </div>
      <div
        className="glass-pill"
        style={{
          display: "flex",
          alignItems: "center",
          padding: "4px 6px",
          gap: 6,
          pointerEvents: "auto",
          fontSize: 11,
          color: "var(--cv-ink-dim)",
        }}
      >
        <span style={{ padding: "4px 8px" }}>
          {connected ? `${liveAgents.length} agent${liveAgents.length === 1 ? "" : "s"}` : "offline"}
        </span>
        {pending > 0 && (
          <span style={{ padding: "4px 8px", color: "var(--cv-accent)" }}>
            {pending} delegation{pending === 1 ? "" : "s"} in flight
          </span>
        )}
      </div>
    </div>
  );
}
