import { useState } from "react";
import { useBoard, PERMISSION_LEVELS } from "../store/board";

const inputStyle: React.CSSProperties = {
  background: "var(--cv-glass-hi)",
  border: "1px solid var(--cv-glass-edge)",
  borderRadius: 8,
  padding: "7px 11px",
  fontSize: 12,
  color: "var(--cv-ink)",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

export function DelegateDialog({
  from,
  at,
  onClose,
}: {
  from: string;
  at?: { x: number; y: number };
  onClose: () => void;
}) {
  const delegate = useBoard((s) => s.delegate);
  const agents = useBoard((s) => s.agents);
  const parent = agents[from];
  const [name, setName] = useState(`${parent?.name ?? "agent"}-task`);
  const [command, setCommand] = useState("bash");
  const [task, setTask] = useState("");
  // Children inherit the parent's permission level — a supervised parent
  // can't spawn a more autonomous child than itself.
  const [permission, setPermission] = useState(parent?.permission ?? "supervised");

  const submit = () => {
    if (!task.trim() || !command.trim()) return;
    delegate(from, name.trim() || command.trim(), command.trim(), task.trim(), permission, at);
    onClose();
  };

  return (
    <div
      className="glass"
      role="dialog"
      aria-label="Delegate task"
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 30,
        width: 340,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--cv-ink)" }}>
        Delegate from <span style={{ color: "var(--cv-accent)" }}>{parent?.name ?? from}</span>
      </div>
      <input
        style={inputStyle}
        placeholder="child name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <input
        style={inputStyle}
        placeholder="command (bash, claude…)"
        value={command}
        onChange={(e) => setCommand(e.target.value)}
      />
      <textarea
        style={{ ...inputStyle, resize: "vertical", minHeight: 60, fontFamily: "inherit" }}
        placeholder="task — sent as the delegation payload"
        value={task}
        onChange={(e) => setTask(e.target.value)}
      />
      <select
        style={{ ...inputStyle, cursor: "pointer" }}
        value={permission}
        onChange={(e) => setPermission(e.target.value)}
        title="child permission level"
      >
        {PERMISSION_LEVELS.map((p) => (
          <option key={p.id} value={p.id}>{p.label} — {p.hint}</option>
        ))}
      </select>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          className="glass-pill"
          style={{ padding: "6px 14px", fontSize: 11.5, color: "var(--cv-ink-dim)", cursor: "pointer" }}
          onClick={onClose}
        >
          cancel
        </button>
        <button
          className="glass-pill"
          style={{
            padding: "6px 14px",
            fontSize: 11.5,
            fontWeight: 600,
            color: "var(--cv-accent)",
            opacity: task.trim() && command.trim() ? 1 : 0.45,
            cursor: "pointer",
          }}
          disabled={!task.trim() || !command.trim()}
          onClick={submit}
        >
          delegate →
        </button>
      </div>
    </div>
  );
}
