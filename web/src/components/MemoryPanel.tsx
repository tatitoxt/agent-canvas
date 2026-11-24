import { useEffect, useState } from "react";
import { useBoard } from "../store/board";
import { PinBtn } from "./PinBtn";

/** Per-scope memory: the board repo and every workspace keep their own
 * `.canvas/memory.md`, injected into agents as CANVAS_MEMORY so they
 * read and append shared notes. Write notes an agent should remember. */
export function MemoryPanel() {
  const workspaces = useBoard((s) => s.workspaces);
  const memories = useBoard((s) => s.memories);
  const memoryRead = useBoard((s) => s.memoryRead);
  const memoryWrite = useBoard((s) => s.memoryWrite);
  const [scope, setScope] = useState("main");
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    memoryRead(scope);
  }, [scope, memoryRead]);

  useEffect(() => {
    if (!dirty) setDraft(memories[scope] ?? "");
  }, [memories, scope, dirty]);

  const scopes = [
    { id: "main", name: "board (this repo)" },
    ...Object.values(workspaces).map((w) => ({ id: w.id, name: w.name })),
  ];

  return (
    <div
      className="glass"
      style={{
        position: "absolute",
        left: 64,
        top: 64,
        bottom: 64,
        width: 320,
        zIndex: 19,
        display: "flex",
        flexDirection: "column",
        padding: "12px 10px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          fontSize: 12.5,
          fontWeight: 650,
          padding: "0 12px 8px",
          color: "var(--cv-ink)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        Memory
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <PinBtn anchor="memory" title={`Memory — ${scope}`} body={draft || (memories[scope] ?? "")} />
        <button
          className="glass-pill"
          style={{ fontSize: 10.5, fontWeight: 600, padding: "3px 11px", cursor: "pointer", border: "none", color: dirty ? "var(--cv-accent)" : "var(--cv-ink-dim)" }}
          disabled={!dirty}
          onClick={() => {
            memoryWrite(scope, draft);
            setDirty(false);
          }}
        >
          save
        </button>
      </div>
      <select
        value={scope}
        onChange={(e) => {
          setScope(e.target.value);
          setDirty(false);
        }}
        style={{
          margin: "0 4px 8px",
          background: "var(--cv-glass-hi)",
          border: "1px solid var(--cv-glass-edge)",
          borderRadius: 999,
          padding: "6px 12px",
          fontSize: 12,
          color: "var(--cv-ink)",
          outline: "none",
          cursor: "pointer",
        }}
      >
        {scopes.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setDirty(true);
        }}
        placeholder="Notes every agent in this scope should remember — injected as CANVAS_MEMORY."
        spellCheck={false}
        style={{
          flex: 1,
          margin: "0 4px",
          padding: "10px 12px",
          borderRadius: 14,
          border: "1px solid var(--cv-glass-edge)",
          background: "var(--cv-glass-hi)",
          color: "var(--cv-ink)",
          fontSize: 11.5,
          fontFamily: "ui-monospace, monospace",
          lineHeight: 1.5,
          resize: "none",
          outline: "none",
        }}
      />
      <div style={{ fontSize: 10.5, color: "var(--cv-ink-dim)", padding: "8px 12px 0" }}>
        Agents spawned here get CANVAS_MEMORY → this file; they can read and append to it.
      </div>
    </div>
  );
}
