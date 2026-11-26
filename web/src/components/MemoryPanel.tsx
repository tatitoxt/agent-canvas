import { useEffect, useState } from "react";
import { panelRoot } from "./panelChrome";
import { useBoard } from "../store/board";

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
      style={{ ...panelRoot, padding: "12px 10px" }}
    >
      <div
        style={{
          padding: "0 12px 8px",
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <button
          className="cv-mini-btn"
          style={{ padding: "3px 11px", color: dirty ? "var(--cv-accent)" : "var(--cv-ink-dim)" }}
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
          fontSize: "var(--cv-text-xs)",
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
          fontSize: "var(--cv-text-xs)",
          fontFamily: "var(--cv-font-mono)",
          lineHeight: 1.5,
          resize: "none",
          outline: "none",
        }}
      />
      <div style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-dim)", padding: "8px 12px 0" }}>
        Agents spawned here get CANVAS_MEMORY → this file; they can read and append to it.
      </div>
    </div>
  );
}
