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

const buttonStyle: React.CSSProperties = {
  padding: "6px 14px",
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--cv-ink)",
  cursor: "pointer",
};

export function SpawnBar() {
  const connected = useBoard((s) => s.connected);
  const connect = useBoard((s) => s.connect);
  const spawn = useBoard((s) => s.spawn);
  const workspaces = useBoard((s) => s.workspaces);
  const createWorkspace = useBoard((s) => s.createWorkspace);
  const [command, setCommand] = useState("bash");
  const [name, setName] = useState("");
  const [wsId, setWsId] = useState("");
  const [makingWs, setMakingWs] = useState(false);
  const [wsName, setWsName] = useState("");
  const [wsRepo, setWsRepo] = useState("");

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
          <button className="glass-pill" style={buttonStyle} onClick={() => connect("")}>
            connect
          </button>
        </>
      ) : makingWs ? (
        <>
          <input
            style={{ ...inputStyle, width: 130 }}
            placeholder="workspace name"
            value={wsName}
            onChange={(e) => setWsName(e.target.value)}
            autoFocus
          />
          <input
            style={{ ...inputStyle, width: 220 }}
            placeholder="repo path (~/repos/my-app)"
            value={wsRepo}
            onChange={(e) => setWsRepo(e.target.value)}
          />
          <button
            className="glass-pill"
            style={{ ...buttonStyle, color: "var(--cv-accent)", opacity: wsName.trim() && wsRepo.trim() ? 1 : 0.45 }}
            disabled={!wsName.trim() || !wsRepo.trim()}
            onClick={() => {
              createWorkspace(wsName.trim(), wsRepo.trim());
              setMakingWs(false);
              setWsName("");
              setWsRepo("");
            }}
          >
            create
          </button>
          <button className="glass-pill" style={buttonStyle} onClick={() => setMakingWs(false)}>
            ×
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
            style={{ ...inputStyle, width: 150 }}
            placeholder="command (bash, claude…)"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
          />
          <select
            style={{ ...inputStyle, color: wsId ? "var(--cv-ink)" : "var(--cv-ink-dim)", cursor: "pointer" }}
            value={wsId}
            onChange={(e) => setWsId(e.target.value)}
          >
            <option value="">no workspace</option>
            {Object.values(workspaces).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <button
            className="glass-pill"
            style={{ ...buttonStyle, color: "var(--cv-accent)", opacity: command.trim() ? 1 : 0.45 }}
            disabled={!command.trim()}
            onClick={() => {
              spawn(name.trim() || command.trim(), command.trim(), wsId || undefined);
              setName("");
            }}
          >
            + agent
          </button>
          <button
            className="glass-pill"
            style={{ ...buttonStyle, color: "var(--cv-ink-dim)" }}
            onClick={() => setMakingWs(true)}
            title="New workspace"
          >
            ◫+
          </button>
        </>
      )}
    </div>
  );
}
