import { useEffect, useMemo, useRef, useState } from "react";
import { useBoard } from "../store/board";
import { CliMark } from "./CliMark";
import { cliMeta } from "../board/nodes";

type Action = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  cli?: string;
  run: () => void;
};

const CLI_SPAWNS: Array<[string, string]> = [
  ["claude", "Claude Code"],
  ["codex", "Codex"],
  ["gemini", "Gemini CLI"],
  ["aider", "Aider"],
  ["cursor-agent", "Cursor"],
  ["opencode", "OpenCode"],
  ["amp", "Amp"],
  ["droid", "Droid"],
  ["goose", "Goose"],
  ["kilocode", "Kilocode"],
  ["qwen", "Qwen Code"],
  ["hermes", "Hermes"],
  ["kimi", "Kimi Code"],
  ["vibe", "Mistral Vibe"],
  ["pi", "Pi"],
  ["antigravity", "Antigravity"],
  ["bash", "Terminal"],
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
  const notes = useBoard((s) => s.notes);
  const vaultEntries = useBoard((s) => s.vaultEntries);
  const mdNodes = useBoard((s) => s.mdNodes);
  const activeBoard = useBoard((s) => s.activeBoard);
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
        cli: cmd,
        run: () => s.spawn(`agent-${Date.now() % 1000}`, cmd),
      });
    }
    for (const [key, label] of [
      ["inbox", "open inbox"],
      ["prs", "open pull requests"],
      ["issues", "open issues"],
      ["notes", "open dex tickets"],
      ["artifacts", "open artifacts"],
      ["loops", "open loops"],
      ["automations", "open automations"],
      ["vault", "open obsidian vault"],
      ["history", "open history"],
      ["canvas", "back to canvas"],
    ] as const) {
      list.push({ id: `nav-${key}`, group: "panels", label, run: () => onNav(key) });
    }
    list.push(
      { id: "view-fit", group: "view", label: "fit view", run: () => s.requestView() },
      { id: "view-clear", group: "view", label: "clear done agents", hint: "removes exited nodes", run: () => s.clearDone() },
      { id: "view-gather", group: "view", label: "gather loose windows", hint: "group stray cards + agents into a frame", run: () => s.gatherLoose() },
      {
        id: "view-close-cards",
        group: "view",
        label: "close all cards",
        hint: "panels + canvas terminals",
        run: () => {
          const board = s.activeBoard;
          const m = { ...s.panelNodes, [board]: {} };
          const tm = { ...s.termNodes, [board]: {} };
          localStorage.setItem("cv-panelnodes", JSON.stringify(m));
          localStorage.setItem("cv-termnodes", JSON.stringify(tm));
          useBoard.setState({ panelNodes: m, termNodes: tm });
        },
      },
      {
        id: "spawn-term",
        group: "spawn",
        label: "new terminal card",
        cli: "bash",
        hint: "bash on the canvas",
        run: () => {
          s.setPendingTermPos({ x: 240 + Math.random() * 560, y: 120 + Math.random() * 240 });
          s.spawn("terminal", "bash");
        },
      },
      { id: "font-up", group: "view", label: "bigger terminal text", run: () => s.bumpFont(1) },
      { id: "font-down", group: "view", label: "smaller terminal text", run: () => s.bumpFont(-1) },
    );

    list.push({
      id: "board-duplicate",
      group: "boards",
      label: "duplicate this board",
      hint: "copies shapes, notes, panels + web cards — not agents",
      run: () => s.duplicateBoard(),
    });
    for (const [boardId, name] of Object.entries(s.boards)) {
      list.push({
        id: `board-${boardId}`,
        group: "boards",
        label: `switch to board — ${name}`,
        hint: boardId === s.activeBoard ? "current" : undefined,
        run: () => s.setActiveBoard(boardId),
      });
    }
    for (const a of Object.values(automations)) {
      list.push({
        id: `run-auto-${a.id}`,
        group: "automations",
        label: `run automation — ${a.name}`,
        hint: `${a.command} · ${a.permission}`,
        run: () => s.runAutomation(a.id),
      });
    }
    for (const n of Object.values(notes)) {
      list.push({
        id: `task-${n.note_id}`,
        group: "tasks",
        label: `task — ${n.text.slice(0, 48)}`,
        hint: n.col,
        run: () => onNav("notes"),
      });
    }
    for (const entry of vaultEntries) {
      const path = `${s.vaultDir ? `${s.vaultDir}/` : ""}${entry}`;
      list.push({
        id: `file-${entry}`,
        group: "files",
        label: `file — ${entry}`,
        hint: "vault",
        run: () => {
          s.vaultRead(path);
          onNav("vault");
        },
      });
    }
    for (const path of Object.values(mdNodes[activeBoard] ?? {})) {
      list.push({
        id: `md-${path}`,
        group: "files",
        label: `pinned note — ${path.split("/").pop()}`,
        hint: "on board",
        run: () => s.requestView(),
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
        list.push({
          id: `termcard-${a.id}`,
          group: "agents",
          label: `terminal on canvas — ${a.name}`,
          hint: "pop out",
          run: () => s.openTermNode(a.id),
        });
        list.push({
          id: `dup-${a.id}`,
          group: "agents",
          label: `duplicate — ${a.name}`,
          hint: "same CLI",
          run: () => {
            const p = s.positions[a.id];
            if (p) s.setPendingSpawnPos({ x: p.x + 60, y: p.y + 60 });
            s.spawn(a.name, a.command ?? "bash", a.workspace_id ?? undefined, a.permission);
          },
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
  }, [agents, automations, notes, vaultEntries, mdNodes, activeBoard, onNav, onOpenAgent]);

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
              <span style={{ display: "flex", alignItems: "center" }}>
                <span style={{ color: "var(--cv-ink-faint)", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6, marginRight: 8, width: 46, flex: "none" }}>
                  {a.group}
                </span>
                {a.cli && (
                  <CliMark cli={a.cli} color={cliMeta(a.cli).color} size={14} />
                )}
                {a.cli && <span style={{ width: 6 }} />}
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
