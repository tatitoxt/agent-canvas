import { useState } from "react";
import { useBoard } from "../store/board";

const inputStyle: React.CSSProperties = {
  background: "var(--cv-glass-hi)",
  border: "1px solid var(--cv-glass-edge)",
  borderRadius: 999,
  padding: "6px 12px",
  fontSize: 12,
  color: "var(--cv-ink)",
  outline: "none",
};

export function SpawnBar() {
  const connected = useBoard((s) => s.connected);
  const connect = useBoard((s) => s.connect);
  const spawn = useBoard((s) => s.spawn);
  const [command, setCommand] = useState("bash");
  const [name, setName] = useState("");

  return (
    <div
      className="glass-pill"
      style={{
        position: "absolute",
        left: "50%",
        bottom: 22,
        transform: "translateX(-50%)",
        zIndex: 15,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px 8px 16px",
      }}
    >
      {!connected ? (
        <>
          <span style={{ fontSize: 11.5, color: "var(--cv-ink-dim)" }}>
            daemon offline
          </span>
          <button
            className="glass-pill"
            style={{
              padding: "6px 14px",
              fontSize: 11.5,
              fontWeight: 600,
              color: "var(--cv-ink)",
              cursor: "pointer",
            }}
            onClick={() => connect("")}
          >
            connect
          </button>
        </>
      ) : (
        <>
          <input
            style={{ ...inputStyle, width: 110 }}
            placeholder="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            style={{ ...inputStyle, width: 160 }}
            placeholder="command (bash, claude…)"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
          />
          <button
            className="glass-pill"
            style={{
              padding: "6px 16px",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--cv-accent)",
              cursor: "pointer",
              opacity: command.trim() ? 1 : 0.45,
            }}
            disabled={!command.trim()}
            onClick={() => {
              spawn(name.trim() || command.trim(), command.trim());
              setName("");
            }}
          >
            + agent
          </button>
        </>
      )}
    </div>
  );
}
