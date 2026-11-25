import { useEffect, useRef, useState } from "react";
import { useBoard } from "../store/board";
import { Icon } from "./icons";

const railCol: React.CSSProperties = {
  position: "absolute",
  left: 4,
  top: 226,
  bottom: 12,
  zIndex: 20,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 8,
};

const railColRight: React.CSSProperties = {
  ...railCol,
  left: undefined,
  right: 0,
  alignItems: "flex-end",
};

const bubble: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 3,
  padding: "6px 5px",
  borderRadius: 14,
};

const bubbleRow: React.CSSProperties = {
  ...bubble,
  flexDirection: "row",
  padding: "5px 6px",
};

const btn = (active: boolean): React.CSSProperties => ({
  width: 32,
  height: 32,
  display: "grid",
  placeItems: "center",
  borderRadius: 9,
  border: "none",
  cursor: "pointer",
  color: "var(--cv-ink)",
  background: active ? "var(--cv-glass-hi)" : "transparent",
  position: "relative",
  boxShadow: active ? "inset 0 1px 0 var(--cv-glass-shine)" : "none",
});

const miniBtn = (active: boolean): React.CSSProperties => ({
  ...btn(active),
  width: 26,
  height: 26,
  borderRadius: 7,
});

const tinyBtn = (active: boolean): React.CSSProperties => ({
  ...btn(active),
  width: 21,
  height: 21,
  borderRadius: 6,
});

const sectionLabel: React.CSSProperties = {
  fontSize: 8,
  fontWeight: 700,
  letterSpacing: 0.9,
  color: "var(--cv-ink-faint)",
  textTransform: "uppercase",
  padding: "1px 0 2px",
};

const menuRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  width: "100%",
  padding: "6px 10px",
  border: "none",
  background: "transparent",
  color: "var(--cv-ink)",
  fontSize: 11.5,
  fontWeight: 550,
  textAlign: "left",
  cursor: "pointer",
  borderRadius: 8,
};

const badge = (bg: string): React.CSSProperties => ({
  position: "absolute",
  top: 0,
  right: 0,
  minWidth: 13,
  height: 13,
  borderRadius: 999,
  background: bg,
  color: "var(--cv-base)",
  fontSize: 8.5,
  fontWeight: 700,
  display: "grid",
  placeItems: "center",
  padding: "0 3px",
});

const hoverRow = (e: React.MouseEvent<HTMLButtonElement>, on: boolean) => {
  e.currentTarget.style.background = on ? "var(--cv-glass-hi)" : "transparent";
};

/** Board tiles — Deska's Spaces list. `menuSide` is which edge the
 * (future) flyouts open toward; today only tiles render. */
function SpacesBubble() {
  const boards = useBoard((s) => s.boards);
  const activeBoard = useBoard((s) => s.activeBoard);
  const setActiveBoard = useBoard((s) => s.setActiveBoard);
  const createBoard = useBoard((s) => s.createBoard);
  const renameBoard = useBoard((s) => s.renameBoard);
  const deleteBoard = useBoard((s) => s.deleteBoard);
  const agents = useBoard((s) => s.agents);

  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [editName, setEditName] = useState("");

  const agentCount = (boardId: string) =>
    Object.values(agents).filter(
      (a) => (a.board_id ?? "main") === boardId && a.status !== "exited",
    ).length;

  const submitEdit = () => {
    const n = editName.trim();
    if (n) {
      if (editing === "new") createBoard(n);
      else if (editing) renameBoard(editing, n);
    }
    setEditing(null);
    setEditName("");
  };

  const renameInput = (key: string) => (
    <input
      key={key}
      autoFocus
      value={editName}
      onChange={(e) => setEditName(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") submitEdit();
        if (e.key === "Escape") setEditing(null);
      }}
      onBlur={submitEdit}
      placeholder="+"
      style={{
        width: 32,
        height: 32,
        borderRadius: 9,
        border: "1px solid var(--cv-glass-edge)",
        background: "var(--cv-glass-hi)",
        color: "var(--cv-ink)",
        fontSize: 11,
        textAlign: "center",
        outline: "none",
      }}
    />
  );

  return (
    <nav className="glass" style={bubble}>
      <div style={sectionLabel}>Spaces</div>
      {Object.entries(boards).map(([id, n]) =>
        editing === id ? (
          renameInput(id)
        ) : (
          <button
            key={id}
            data-board-tab={id}
            onClick={() => setActiveBoard(id)}
            onDoubleClick={() => { setEditing(id); setEditName(n); }}
            onContextMenu={(e) => { e.preventDefault(); setEditing(id); setEditName(n); }}
            title={`${n} — double-click to rename${id !== "main" ? ", ⌫ deletes when empty" : ""}`}
            style={{
              ...btn(id === activeBoard),
              fontSize: 12,
              fontWeight: 700,
              color: id === activeBoard ? "var(--cv-accent)" : "var(--cv-ink-dim)",
            }}
          >
            {n.slice(0, 1).toUpperCase()}
            {agentCount(id) > 0 && (
              <span style={badge("var(--cv-done)")}>{agentCount(id)}</span>
            )}
            {id !== "main" && id === activeBoard && (
              <span
                role="button"
                aria-label="delete board"
                onClick={(e) => { e.stopPropagation(); deleteBoard(id); }}
                title="delete board (only when empty)"
                style={{
                  position: "absolute",
                  bottom: -1,
                  right: -1,
                  width: 13,
                  height: 13,
                  borderRadius: 999,
                  background: "var(--cv-blocked)",
                  color: "var(--cv-base)",
                  fontSize: 9,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                ×
              </span>
            )}
          </button>
        ),
      )}
      {editing === "new" ? (
        renameInput("new")
      ) : (
        <button
          onClick={() => { setEditing("new"); setEditName(""); }}
          title="New board"
          style={{ ...btn(false), fontSize: 15 }}
        >
          +
        </button>
      )}
    </nav>
  );
}

/** Integrations hub — one button, dropdown opens toward `side`. */
function ExtrasBubble({ side, onSelect }: { side: "left" | "right"; onSelect: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <nav ref={ref} className="glass" style={{ ...bubble, position: "relative", borderRadius: 999 }}>
      <button
        title="Extras — plug other apps into the canvas (VS Code, Obsidian, Discord)"
        onClick={() => setOpen((o) => !o)}
        style={btn(open)}
      >
        <Icon name="extras" />
      </button>
      {open && (
        <div
          className="cv-menu"
          style={{
            position: "absolute",
            [side]: 46,
            bottom: 0,
            width: 208,
            padding: 6,
            zIndex: 40,
          }}
        >
          <div style={sectionLabel}>Extras</div>
          {[
            ["monitor", "VS Code", "bridge — soon"],
            ["vault", "Obsidian vault", "open vault panel"],
            ["thread", "Discord bridge", "chat relay — soon"],
            ["automations", "GitHub Actions", "watch runs — soon"],
          ].map(([icon, label, hint]) => (
            <button
              key={label}
              style={menuRow}
              title={hint}
              onClick={() => {
                if (label === "Obsidian vault") onSelect("vault");
                setOpen(false);
              }}
              onMouseEnter={(e) => hoverRow(e, true)}
              onMouseLeave={(e) => hoverRow(e, false)}
            >
              <Icon name={icon as string} size={14} color="var(--cv-ink-dim)" />
              <span style={{ flex: 1 }}>{label}</span>
              {hint.includes("soon") && (
                <span style={{ fontSize: 9, color: "var(--cv-ink-faint)" }}>soon</span>
              )}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}

/** Left rail — the code bubble up top (source control, explorer,
 * dev ticket, daemon status), Extras parked at the bottom. */
export function NavRail({ active, onSelect }: { active: string; onSelect: (key: string) => void }) {
  const repoUrl = useBoard((s) => s.repoUrl);
  const agents = useBoard((s) => s.agents);
  const activeBoard = useBoard((s) => s.activeBoard);
  const ghCounts = useBoard((s) => s.ghCounts);
  const noteCount = useBoard((s) => Object.keys(s.notes).length);
  const artifactCount = useBoard((s) => Object.keys(s.artifacts).length);
  const loopCount = useBoard((s) => Object.values(s.loops).filter((l) => l.enabled).length);
  const openAgents = Object.values(agents)
    .filter((a) => (a.board_id ?? "main") === activeBoard && a.status !== "exited");
  const gitAgents = openAgents.filter((a) => a.worktree);

  const [expanded, setExpanded] = useState(() => localStorage.getItem("cv-library-expanded") === "1");
  const toggleExpanded = () => setExpanded((e) => { localStorage.setItem("cv-library-expanded", e ? "0" : "1"); return !e; });
  const railRef = useRef<HTMLDivElement>(null);
  const tools: { icon?: string; img?: string; label: string; hint: string; onClick: () => void; key?: string; color?: string; fact?: string; badgeN?: number }[] = [
    { icon: "git", label: "Source Control", hint: `worktrees, push an agent's branch${gitAgents.length ? ` — ${gitAgents.length} live` : ""}`, onClick: () => onSelect("sc"), key: "sc", badgeN: gitAgents.length },
    { img: "/obsidian.svg", label: "Obsidian", hint: "your real vault — 'obsidian <note>' in Dex writes to it", onClick: () => onSelect("vault"), key: "vault", color: "#8B5CF6" },
    ...(repoUrl ? [
      { icon: "github", label: "Pull requests", hint: "live list from the repo's GitHub", onClick: () => onSelect("prs"), key: "prs", fact: ghCounts.prs != null ? `${ghCounts.prs} open` : undefined },
      { icon: "issue", label: "Issues", hint: "live list from the repo's GitHub", onClick: () => onSelect("issues"), key: "issues", fact: ghCounts.issues != null ? `${ghCounts.issues} open` : undefined },
    ] as const : []),
    { icon: "ticket", label: "Dex Tickets", hint: "delegations, status, results and changed files", onClick: () => onSelect("tickets"), key: "tickets" },
    { icon: "notes", label: "Notes", hint: "notes and tasks on the board", onClick: () => onSelect("notes"), key: "notes", fact: noteCount ? `${noteCount}` : undefined },
    { icon: "artifacts", label: "Artifacts", hint: "shots, docs and files the agents produced", onClick: () => onSelect("artifacts"), key: "artifacts", fact: artifactCount ? `${artifactCount}` : undefined },
    { icon: "loops", label: "Loops", hint: "recurring instructions per agent", onClick: () => onSelect("loops"), key: "loops", fact: loopCount ? `${loopCount} active` : undefined },
  ];

  const renderTool = (t: (typeof tools)[number]) =>
    expanded ? (
      <button
        key={t.label}
        title={t.hint}
        onClick={t.onClick}
        style={menuRow}
        onMouseEnter={(e) => hoverRow(e, true)}
        onMouseLeave={(e) => hoverRow(e, false)}
      >
        {t.img ? (
          <img src={t.img} alt="" width={14} height={14} />
        ) : (
          <Icon name={t.icon!} size={14} color={t.color ?? (t.key && active === t.key ? "var(--cv-accent)" : "var(--cv-ink-dim)")} />
        )}
        <span style={{ flex: 1 }}>{t.label}</span>
        {t.fact && <span style={{ fontSize: 9, color: "var(--cv-ink-dim)", fontWeight: 600 }}>{t.fact}</span>}
      </button>
    ) : (
      <button key={t.label} title={t.hint} onClick={t.onClick} style={btn(!!t.key && active === t.key)}>
        {t.img ? (
          <img src={t.img} alt="" width={15} height={15} />
        ) : (
          <Icon name={t.icon!} color={t.color} />
        )}
        {!!t.badgeN && <span style={badge("var(--cv-waiting)")}>{t.badgeN}</span>}
      </button>
    );

  return (
    <div ref={railRef} style={{ ...railCol, alignItems: expanded ? "stretch" : "center", width: expanded ? 174 : undefined }}>
      <nav
        className={expanded ? "glass cv-menu-scroll" : "glass"}
        style={{
          ...bubble,
          alignItems: expanded ? "stretch" : "center",
          padding: expanded ? "6px 4px" : bubble.padding,
          gap: expanded ? 1 : bubble.gap,
          maxHeight: expanded ? "70vh" : undefined,
          overflowY: expanded ? "auto" : undefined,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: expanded ? "space-between" : "center", padding: expanded ? "2px 6px 6px" : "2px 0", width: expanded ? "100%" : undefined }}>
          {expanded && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--cv-ink)" }}>Library</span>}
          <button
            title={expanded ? "Collapse tools — icons only" : "Library — expand for panel names"}
            onClick={toggleExpanded}
            style={{ ...tinyBtn(false), borderRadius: 999 }}
          >
            <Icon name={expanded ? "expand" : "collapse"} size={12} />
          </button>
        </div>

        {tools.map(renderTool)}
      </nav>
      <div style={{ flex: 1 }} />

      <div style={{ display: "flex", gap: 8 }}>
        <ExtrasBubble side="left" onSelect={onSelect} />
        <OrchestratorsBubble />
      </div>
    </div>
  );
}

function OrchestratorsBubble() {
  const orchestrators = useBoard((s) => s.orchestrators);
  const activeBoard = useBoard((s) => s.activeBoard);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const list = Object.entries(orchestrators).filter(([, o]) => o.board === activeBoard);

  return (
    <nav ref={ref} className="glass" style={{ ...bubble, position: "relative", borderRadius: 999 }}>
      <button
        title="Orchestrators — commanders on this board; click one to focus it, or spawn a new one"
        onClick={() => setOpen((o) => !o)}
        style={btn(open)}
      >
        <Icon name="orchestrator" />
        {list.length > 0 && (
          <span style={badge("var(--cv-accent-dim)")}>{list.length}</span>
        )}
      </button>
      {open && (
        <div
          className="cv-menu"
          style={{
            position: "absolute",
            left: 46,
            bottom: 0,
            width: 208,
            padding: 6,
            zIndex: 40,
          }}
        >
          <div style={sectionLabel}>Orchestrators</div>
          {list.length === 0 && (
            <div style={{ ...menuRow, color: "var(--cv-ink-faint)", cursor: "default" }}>
              none on this board
            </div>
          )}
          {list.map(([id, o]) => (
            <button
              key={id}
              style={menuRow}
              title={`${o.name} — ${o.wired.length} wired; click to focus`}
              onClick={() => { useBoard.getState().requestFocus(id); setOpen(false); }}
              onMouseEnter={(e) => hoverRow(e, true)}
              onMouseLeave={(e) => hoverRow(e, false)}
            >
              <Icon name="orchestrator" size={13} color="var(--cv-accent)" />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {o.name}
              </span>
              <span style={{ fontSize: 9.5, color: "var(--cv-ink-faint)" }}>{o.wired.length} wired</span>
            </button>
          ))}
          <button
            style={menuRow}
            title="Spawn a new orchestrator on this board"
            onClick={() => { useBoard.getState().spawnOrchestrator(); setOpen(false); }}
            onMouseEnter={(e) => hoverRow(e, true)}
            onMouseLeave={(e) => hoverRow(e, false)}
          >
            <Icon name="plus" size={13} color="var(--cv-accent)" />
            <span style={{ flex: 1 }}>New orchestrator</span>
          </button>
        </div>
      )}
    </nav>
  );
}

/** Right rail — Spaces up top; the mini controls bubble (zoom,
 * gather, hide, summaries) parked at the bottom-right edge, right
 * of the minimap. */

export function RightRail() {
  const summaries = useBoard((s) => s.panelSummaries);
  const zoomPct = useBoard((s) => s.zoomPct);

  return (
    <div style={railColRight}>
      <SpacesBubble />

      <div style={{ flex: 1 }} />

      <nav className="glass" style={{ ...bubbleRow, padding: "3px 4px", gap: 1, borderRadius: 999 }}>
        <button title="Zoom out" onClick={() => useBoard.getState().requestZoom(-1)} style={tinyBtn(false)}>
          <Icon name="minus" size={11} />
        </button>
        <button title="Zoom in" onClick={() => useBoard.getState().requestZoom(1)} style={tinyBtn(false)}>
          <Icon name="plus" size={11} />
        </button>
        <span
          title="Zoom level"
          style={{ fontSize: 9.5, color: "var(--cv-ink-dim)", fontWeight: 600, minWidth: 30, textAlign: "center" }}
        >
          {zoomPct}%
        </span>
        <button title="Zoom to fit — frame the whole board" onClick={() => useBoard.getState().requestView()} style={tinyBtn(false)}>
          <Icon name="zoom" size={11} />
        </button>
        <button
          title="Hide panels and menus — chrome away, canvas only"
          onClick={() => useBoard.getState().toggleChrome()}
          style={tinyBtn(false)}
        >
          <Icon name="hide" size={11} />
        </button>
        <button
          title="Show panel summaries — last line + mini preview per card"
          onClick={() => useBoard.getState().togglePanelSummaries()}
          style={tinyBtn(!summaries)}
        >
          <Icon name="eye" size={11} color={summaries ? "var(--cv-ink)" : "var(--cv-ink-faint)"} />
        </button>
      </nav>
    </div>
  );
}

/** Bottom dock — the wide Dex pill sits dead-center at the bottom of
 * the screen. A 3-column grid keeps it exactly on the 50% axis:
 * create on its left, the small round inbox on its right. */
export function BottomDock({ active, onSelect }: { active: string; onSelect: (key: string) => void }) {
  const activeBoard = useBoard((s) => s.activeBoard);
  const agents = useBoard((s) => s.agents);
  const panelNodes = useBoard((s) => s.panelNodes);
  const terminalCount = Object.values(agents).filter((a) => a.status !== "exited" && (a.board_id ?? "main") === activeBoard).length;
  const editorCount = Object.values(panelNodes[activeBoard] ?? {}).filter((n) => n.panel === "explorer").length;
  const [dexText, setDexText] = useState("");
  const [dexHist, setDexHist] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const dexInputRef = useRef<HTMLInputElement>(null);
  // Voice dictation — Web Speech API where it exists (Chrome/Edge; hidden
  // on WKWebView/Firefox). Interim results stream into the input.
  type Recog = {
    continuous: boolean; interimResults: boolean;
    onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
    onend: (() => void) | null; onerror: (() => void) | null;
    start: () => void; stop: () => void;
  };
  const SR: (new () => Recog) | undefined =
    (window as unknown as { SpeechRecognition?: new () => Recog; webkitSpeechRecognition?: new () => Recog }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => Recog }).webkitSpeechRecognition;
  const recog = useRef<Recog | null>(null);
  const [listening, setListening] = useState(false);
  const toggleListen = () => {
    if (!SR) return;
    if (listening) { recog.current?.stop(); return; }
    const r = new SR();
    recog.current = r;
    r.continuous = false;
    r.interimResults = true;
    r.onresult = (e) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      setDexText(t);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    r.start();
    setListening(true);
    dexInputRef.current?.focus();
  };

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 12,
        zIndex: 25,
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "end",
        pointerEvents: "none",
      }}
    >
      {/* ── left of Dex · create ──────────────────────────── */}
      <div style={{ justifySelf: "end", display: "flex", alignItems: "flex-end", gap: 8, marginRight: 16, pointerEvents: "auto" }}>
        <nav className="glass" style={{ ...bubbleRow, padding: "4px 6px", gap: 4, borderRadius: 999 }}>
          <button
            title="New task — open the spawn chooser (lives on the Orchestrator)"
            onClick={() => useBoard.getState().focusSpawn()}
            style={{ ...btn(false), borderRadius: 999 }}
          >
            <Icon name="newtask" size={16} />
          </button>
          <button
            title="Files — open your Obsidian vault"
            onClick={() => onSelect("vault")}
            style={{ ...btn(active === "vault"), borderRadius: 999 }}
          >
            <Icon name="vault" size={16} />
          </button>
          <button
            title="Terminal — spawn a plain shell"
            onClick={() => useBoard.getState().spawn("Terminal", "bash")}
            style={{ ...btn(false), borderRadius: 999 }}
          >
            <Icon name="terminal" size={16} />
            {terminalCount > 0 && <span aria-label={`${terminalCount} open terminal${terminalCount === 1 ? "" : "s"}`} style={badge("var(--cv-accent)")}>{terminalCount}</span>}
          </button>
          <button
            title="Code Editor — open the workspace file tree and code viewer"
            onClick={() => onSelect("explorer")}
            style={{ ...btn(active === "explorer"), borderRadius: 999 }}
          >
            <Icon name="code" size={16} />
            {editorCount > 0 && <span aria-label={`${editorCount} open code editor${editorCount === 1 ? "" : "s"}`} style={{ ...badge("var(--cv-glass-hi)"), color: "var(--cv-ink)" }}>{editorCount}</span>}
          </button>

        </nav>
      </div>

      {/* ── dead center · Dex (a real input — Enter sends) ── */}
      <div style={{ justifySelf: "center", pointerEvents: "auto" }}>
        <div
          className="glass"
          title="Ask Dex — command the board in plain words"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            height: 40,
            width: 320,
            padding: "0 8px 0 16px",
            borderRadius: 999,
            cursor: "text",
          }}
          onClick={() => dexInputRef.current?.focus()}
        >
          <Icon name="bot" size={16} color={active === "thread" ? "var(--cv-accent)" : "var(--cv-ink-dim)"} />
          <input
            ref={dexInputRef}
            value={dexText}
            onChange={(e) => setDexText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && dexText.trim()) {
                const t = dexText.trim();
                useBoard.getState().threadSend(t);
                setDexHist((h) => [...h.slice(-19), t]);
                setHistIdx(-1);
                setDexText("");
                onSelect("thread");
              } else if (e.key === "ArrowUp" && dexHist.length) {
                e.preventDefault();
                const i = histIdx < 0 ? dexHist.length - 1 : Math.max(0, histIdx - 1);
                setHistIdx(i);
                setDexText(dexHist[i]);
              } else if (e.key === "ArrowDown" && histIdx >= 0) {
                e.preventDefault();
                const i = histIdx + 1;
                if (i >= dexHist.length) { setHistIdx(-1); setDexText(""); }
                else { setHistIdx(i); setDexText(dexHist[i]); }
              }
            }}
            placeholder="Ask Dex…"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              background: "transparent",
              outline: "none",
              color: "var(--cv-ink)",
              fontSize: 12.5,
              fontWeight: 550,
            }}
          />
          {SR && (
            <button
              title={listening ? "Stop dictation" : "Dictate — speak a command"}
              onClick={(e) => { e.stopPropagation(); toggleListen(); }}
              style={{ ...miniBtn(listening), borderRadius: 999, color: listening ? "var(--cv-danger, #e06c75)" : undefined }}
            >
              <Icon name="mic" size={13} />
            </button>
          )}
          <button
            title="Open the Dex thread"
            onClick={(e) => { e.stopPropagation(); onSelect("thread"); }}
            style={{ ...miniBtn(false), borderRadius: 999 }}
          >
            <Icon name="thread" size={13} />
          </button>
        </div>
      </div>

      {/* inbox lives in ONE place: the topbar bell — no bottom bubble. */}
    </div>
  );
}
