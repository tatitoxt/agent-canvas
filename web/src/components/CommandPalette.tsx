import { useEffect, useMemo, useRef, useState } from "react";
import { useBoard } from "../store/board";

type Action = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  run: () => void;
};

const CLI_SPAWNS: Array<[string, string]> = [
  ["claude", "◆ Claude Code"],
  ["codex", "◈ Codex"],
  ["gemini", "✦ Gemini CLI"],
  ["aider", "▣ Aider"],
  ["bash", "›_ Terminal"],
];

/** ⌘K command launcher — every board action reachable from the keyboard. */
export function CommandPalette({
  onClose,
  onNav,
  onOpenAgent,
}: {
  onClose: () => void;
  onNav: (k: string) => void;
  onOpenAgent: (id: string, name: string) => void;
}) {
  const agents = useBoard((s) => s.agents);
  const automations = useBoard((s) => s.automations);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const actions = useMemo<Action[]>(() => {
    const s = useBoard.getState();
    const list: Action[] = [];

    for (const [cmd, label] of CLI_SPAWNS) {
      list.push({
        id: `spawn-${cmd}`,
        group: "spawn",
        label: `spawn agent — ${label}`,
        run: () => s.spawn(`agent-${Date.now() % 1000}`, cmd),
      });
    }
    list.push(
      { id: "nav-inbox", group: "navigate", label: "open inbox", run: () => onNav("inbox") },
      { id: "nav-automations", group: "navigate", label: "open automations", run: () => onNav("automations") },
      { id: "nav-canvas", group: "navigate", label: "back to canvas", run: () => onNav("canvas") },
      { id: "view-fit", group: "view", label: "fit view", run: () => s.requestView() },
      { id: "view-clear", group: "view", label: "clear done agents", hint: "removes exited nodes", run: () => s.clearDone() },
      { id: "font-up", group: "view", label: "bigger terminal text", run: () => s.bumpFont(1) },
      { id: "font-down", group: "view", label: "smaller terminal text", run: () => s.bumpFont(-1) },
    );

    for (const a of Object.values(automations)) {
      list.push({
        id: `run-auto-${a.id}`,
        group: "automations",
        label: `run automation — ${a.name}`,
        hint: `${a.command} · ${a.permission}`,
        run: () => s.runAutomation(a.id),
      });
    }
    for (const a of Object.values(agents)) {
      if (a.status !== "exited") {
        list.push({
          id: `term-${a.id}`,
          group: "agents",
          label: `open terminal — ${a.name}`,
          hint: a.status,
          run: () => onOpenAgent(a.id, a.name),
        });
      }
      list.push({
        id: `kill-${a.id}`,
        group: "agents",
        label: `kill — ${a.name}`,
        hint: "asks twice",
        run: () => s.kill(a.id),
      });
    }
    return list;
  }, [agents, automations, onNav, onOpenAgent]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? actions.filter((a) => a.label.toLowerCase().includes(q) || a.group.includes(q))
    : actions;
  const selClamped = Math.min(sel, Math.max(0, filtered.length - 1));

  const pick = (a: Action) => {
    a.run();
    onClose();
  };

  return (
    <div
      style={{ position: "absolute", inset: 0, zIndex: 40, background: "rgba(10,10,12,0.55)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="glass"
        style={{
          position: "absolute",
          top: "18%",
          left: "50%",
          transform: "translateX(-50%)",
          width: 460,
          maxHeight: 420,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          placeholder="type a command or search…"
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((i) => Math.min(i + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && filtered[selClamped]) {
              pick(filtered[selClamped]);
            } else if (e.key === "Escape") {
              onClose();
            }
          }}
          style={{
            background: "transparent",
            border: "none",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            padding: "13px 16px",
            fontSize: 13.5,
            color: "var(--cv-ink)",
            outline: "none",
            fontFamily: "inherit",
          }}
        />
        <div style={{ overflowY: "auto", padding: "6px" }}>
          {filtered.length === 0 && (
            <div style={{ padding: "16px 14px", fontSize: 12, color: "var(--cv-ink-dim)" }}>
              nothing matches — try "spawn", "run", "kill", "inbox", "fit"
            </div>
          )}
          {filtered.map((a, i) => (
            <button
              key={a.id}
              onClick={() => pick(a)}
              onMouseEnter={() => setSel(i)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                width: "100%",
                textAlign: "left",
                background: i === selClamped ? "rgba(255,255,255,0.07)" : "transparent",
                border: "none",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 12.5,
                color: "var(--cv-ink)",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <span>
                <span style={{ color: "var(--cv-ink-faint)", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6, marginRight: 8 }}>
                  {a.group}
                </span>
                {a.label}
              </span>
              {a.hint && <span style={{ fontSize: 10.5, color: "var(--cv-ink-faint)" }}>{a.hint}</span>}
            </button>
          ))}
        </div>
        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.06)",
            padding: "6px 14px",
            fontSize: 10,
            color: "var(--cv-ink-faint)",
            display: "flex",
            gap: 12,
          }}
        >
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
