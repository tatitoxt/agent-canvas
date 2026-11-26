import { useEffect, useRef, useState } from "react";
import { getAgentSpawnPositions, useBoard } from "../store/board";
import { isTauri } from "../daemon/tauriClient";
import { Icon } from "./icons";
import { ToolsMenu, type ToolsMenuActions } from "./ToolsRail";
import { PANEL_META } from "./panelMeta";

const pill: React.CSSProperties = {
  padding: "6px 11px",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--cv-ink)",
  display: "flex",
  alignItems: "center",
  gap: 6,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const iconBtn = (active: boolean): React.CSSProperties => ({
  display: "grid",
  placeItems: "center",
  width: 38,
  height: 38,
  borderRadius: 999,
  color: active ? "var(--cv-accent)" : "var(--cv-ink)",
  cursor: "pointer",
  position: "relative",
});

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

const sectionLabel: React.CSSProperties = {
  fontSize: 8.5,
  fontWeight: 700,
  letterSpacing: 1,
  textTransform: "uppercase",
  color: "var(--cv-ink-faint)",
  padding: "8px 10px 3px",
};

const miniInput: React.CSSProperties = {
  background: "var(--cv-glass-hi)",
  border: "1px solid var(--cv-glass-edge)",
  borderRadius: 8,
  height: 24,
  padding: "0 8px",
  fontSize: 10.5,
  color: "var(--cv-ink)",
  outline: "none",
  width: "100%",
  fontFamily: "inherit",
};

/** Deska-style topbar. Left: machine (This Mac / cloud / phone), workspaces,
 * worktrees, tasks. Right, icon-only: mission map, search, automations,
 * notifications, tools, settings. Everything iconified with tooltips. */
export function Topbar({
  nav,
  onNav,
  tools,
}: {
  nav: string;
  onNav: (key: string) => void;
  tools: ToolsMenuActions;
}) {
  const lastGather = useBoard((s) => s.lastGather);
  const connected = useBoard((s) => s.connected);
  const workspaces = useBoard((s) => s.workspaces);
  const agents = useBoard((s) => s.agents);
  const edges = useBoard((s) => s.edges);
  const approvals = useBoard((s) => s.approvals);
  const activeBoard = useBoard((s) => s.activeBoard);

  const wsList = Object.values(workspaces);
  const liveAgents = Object.values(agents).filter(
    (a) => a.status !== "exited" && (a.board_id ?? "main") === activeBoard,
  );
  const boardEdges = Object.values(edges).filter((e) =>
    (agents[e.from]?.board_id ?? agents[e.to]?.board_id ?? "main") === activeBoard,
  );
  const delegated = boardEdges.filter((e) => e.state === "delegated").length;
  const waiting = liveAgents.filter((a) => a.status === "waiting").length;
  const blockedN = liveAgents.filter((a) => a.status === "blocked").length;
  const boardApprovals = Object.keys(approvals).filter(
    (agentId) => agents[agentId] && (agents[agentId].board_id ?? "main") === activeBoard,
  ).length;
  const notifCount = boardApprovals + waiting + blockedN;

  const shapes = useBoard((s) => s.shapes);
  const positions = useBoard((s) => s.positions);
  const workspaceSizes = useBoard((s) => s.workspaceSizes);
  const agentSizes = useBoard((s) => s.agentSizes);
  const viewportRect = useBoard((s) => s.viewportRect);
  const panelNodes = useBoard((s) => s.panelNodes);
  const termNodes = useBoard((s) => s.termNodes);
  const mdNodes = useBoard((s) => s.mdNodes);
  const webNodes = useBoard((s) => s.webNodes);
  const orchestrators = useBoard((s) => s.orchestrators);

  const [menu, setMenu] = useState<"machine" | "ws" | "wt" | "tasks" | "panels" | null>(null);
  const [wsName, setWsName] = useState("");
  const [wsRepo, setWsRepo] = useState("");

  // ── Deska "Panels" switcher: every open window on the board, grouped by
  // the region rect its center sits in. Click focuses the card.
  type PanelItem = { id: string; icon: string; label: string; sub?: string; hint: string; cx: number; cy: number };
  const panelItems: PanelItem[] = [];
  // Same ordering the board uses for "Terminal N" titles so the switcher
  // matches what the card header shows.
  const boardAgents = Object.values(agents)
    .filter((a) => (a.board_id ?? "main") === activeBoard)
    .sort((a, b) => (a.seenAt ?? 0) - (b.seenAt ?? 0));
  const termNo = new Map(boardAgents.map((a, i) => [a.id, i + 1]));
  const looseAgents = boardAgents.filter((a) => !a.workspace_id);
  const explicitLoose = looseAgents.filter((a) => positions[a.id]);
  const missingLoose = looseAgents.filter((a) => !positions[a.id]);
  const looseFallbacks = getAgentSpawnPositions(
    missingLoose.length,
    viewportRect,
    explicitLoose.map((a) => ({ ...positions[a.id], w: agentSizes[a.id]?.w ?? 460, h: agentSizes[a.id]?.h ?? 260 })),
  );
  const looseFallbackById = new Map(missingLoose.map((a, i) => [a.id, looseFallbacks[i]]));
  const workspaceFallbackById = new Map<string, { x: number; y: number }>();
  const workspaceOffsets = new Map<string, number>();
  for (const a of boardAgents) {
    if (!a.workspace_id || positions[a.id]) continue;
    const offset = workspaceOffsets.get(a.workspace_id) ?? 0;
    workspaceFallbackById.set(a.id, { x: 24, y: 64 + offset * 284 });
    workspaceOffsets.set(a.workspace_id, offset + 1);
  }
  boardAgents.forEach((a) => {
    // Agents inside a workspace keep positions RELATIVE to the parent node —
    // translate to absolute canvas coords so region grouping and focus work.
    // Never-dragged agents have no positions entry: replicate the canvas
    // fallback spawn grid, or they'd measure at the origin — inside any
    // unmoved workspace's rect — and group falsely under it.
    const ws = a.workspace_id ? workspaces[a.workspace_id] : undefined;
    const rel = positions[a.id] ?? (ws
      ? (workspaceFallbackById.get(a.id) ?? { x: 24, y: 64 })
      : (looseFallbackById.get(a.id) ?? { x: 24, y: 64 }));
    const base = ws ? (positions[ws.id] ?? { x: 60, y: 60 }) : { x: 0, y: 0 };
    const p = { x: base.x + rel.x, y: base.y + rel.y };
    const done = a.status === "exited";
    panelItems.push({
      id: a.id,
      icon: "terminal",
      label: `Terminal ${termNo.get(a.id)}`,
      sub: [a.name !== "Terminal" ? a.name : undefined, ws ? `in ${ws.name}` : undefined].filter(Boolean).join(" · ") || undefined,
      hint: `${a.name} · ${done ? "done" : a.status}${ws ? ` · workspace ${ws.name}` : ""} — click to focus`,
      cx: p.x + 180,
      cy: p.y + 110,
    });
  });
  for (const [id, o] of Object.entries(orchestrators)) {
    if (o.board !== activeBoard) continue;
    const p = positions[id] ?? { x: 0, y: 0 };
    panelItems.push({ id, icon: "orchestrator", label: o.name, hint: "orchestrator — click to focus", cx: p.x + 180, cy: p.y + 110 });
  }
  for (const [id, n] of Object.entries(termNodes[activeBoard] ?? {})) {
    const no = termNo.get(id.slice(5));
    panelItems.push({ id, icon: "terminal", label: no ? `Terminal ${no}` : "Terminal", sub: "popped out", hint: "popped-out terminal — click to focus", cx: n.x + n.w / 2, cy: n.y + n.h / 2 });
  }
  for (const [id, n] of Object.entries(panelNodes[activeBoard] ?? {})) {
    const meta = PANEL_META[id.slice(6)];
    panelItems.push({ id, icon: meta?.icon ?? "panels", label: meta?.title ?? id.slice(6), hint: "panel — click to focus", cx: n.x + n.w / 2, cy: n.y + n.h / 2 });
  }
  for (const [id, path] of Object.entries(mdNodes[activeBoard] ?? {})) {
    const p = positions[id] ?? { x: 0, y: 0 };
    panelItems.push({ id, icon: "notes", label: path.split("/").pop() ?? "note", hint: path, cx: p.x + 170, cy: p.y + 130 });
  }
  for (const [id, url] of Object.entries(webNodes[activeBoard] ?? {})) {
    const p = positions[id] ?? { x: 0, y: 0 };
    let host = url;
    try { host = new URL(url).hostname; } catch { /* keep the raw url */ }
    panelItems.push({ id, icon: "web", label: host, hint: "web card — click to focus", cx: p.x + 260, cy: p.y + 170 });
  }
  const regionRects: { id: string; x: number; y: number; w?: number; h?: number; text?: string }[] = [
    ...Object.values(shapes[activeBoard] ?? {}).filter((s) => s.kind === "rect" && s.w != null && s.h != null),
    // Workspaces are regions too — terminals inside them group under the ws name.
    ...Object.values(workspaces)
      .filter((w) => (w.board_id ?? "main") === activeBoard)
      .map((w) => {
        const fallbackCount = boardAgents.filter((a) => a.workspace_id === w.id && !positions[a.id]).length;
        const size = workspaceSizes[w.id] ?? { w: 900, h: 540 };
        return {
          id: w.id,
          ...(positions[w.id] ?? { x: 60, y: 60 }),
          w: size.w,
          h: Math.max(size.h, 100 + fallbackCount * 284),
          text: `workspace ${w.name}`,
        };
      }),
  ];
  const itemRegion = (it: PanelItem) => {
    const hits = regionRects.filter((r) => it.cx >= r.x && it.cx <= r.x + r.w! && it.cy >= r.y && it.cy <= r.y + r.h!);
    // Overlapping regions: the smallest one is the most specific container.
    return hits.sort((a, b) => (a.w! * a.h!) - (b.w! * b.h!))[0];
  };
  const panelRegions = regionRects
    .map((shape) => ({ shape, members: panelItems.filter((it) => itemRegion(it) === shape) }))
    .sort((a, b) => (a.shape.text ?? "").localeCompare(b.shape.text ?? ""));
  const looseItems = panelItems.filter((it) => !itemRegion(it));

  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setMenu(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menu]);

  const drop = (key: "machine" | "ws" | "wt" | "tasks" | "panels", node: React.ReactNode) =>
    menu === key ? (
      <div
        className="cv-menu cv-menu-scroll"
        style={{
          position: "absolute",
          top: "calc(100% + 8px)",
          left: 0,
          minWidth: 200,
          maxHeight: "60vh",
          overflowY: "auto",
          padding: 6,
          zIndex: 40,
        }}
      >
        {node}
      </div>
    ) : null;

  const row = (icon: string, label: string, hint: string, onClick?: () => void, dim?: boolean) => (
    <button
      key={label}
      style={{ ...menuRow, opacity: dim ? 0.45 : 1, cursor: onClick ? "pointer" : "default" }}
      title={hint}
      onClick={() => { onClick?.(); setMenu(null); }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--cv-glass-hi)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <Icon name={icon} size={14} color="var(--cv-ink-dim)" />
      <span style={{ flex: 1 }}>{label}</span>
      {dim && <span style={{ fontSize: 9, color: "var(--cv-ink-faint)" }}>soon</span>}
    </button>
  );

  const openSearch = () =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true }));

  return (
    <div
      ref={wrap}
      className="cv-topbar-fuse"
      style={{
        position: "absolute",
        top: 12,
        // Tauri's overlay titlebar paints the macOS traffic lights over the
        // webview — push the bar right so they never sit on the buttons.
        left: isTauri() ? 96 : 58,
        right: 12,
        // Above the pencil (29) and region-shot (30) modal overlays — the
        // Tools menu is an exit path out of those modes, so it must stay
        // clickable while they own the canvas pointer.
        zIndex: 31,
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: 3,
        pointerEvents: "auto",
      }}
    >
      {/* ── left: app · machine · workspaces · worktrees · tasks ── */}
      <div
        className="glass-pill"
        style={{
          display: "flex",
          alignItems: "center",
          padding: "3px 6px",
          gap: 2,
          pointerEvents: "auto",
        }}
      >
        <span style={{ ...pill, color: "var(--cv-accent)", fontWeight: 700, cursor: "default", display: "flex", alignItems: "center", gap: 5 }}>
          <img src="/canvas-mark.png" alt="" width={15} height={15} style={{ display: "block" }} />
          Canvas
        </span>
        <div style={{ position: "relative" }}>
          <button
            style={{ ...pill, border: "none", background: "transparent" }}
            title="Machine — where agents run"
            onClick={() => setMenu((m) => (m === "machine" ? null : "machine"))}
          >
            <Icon name="monitor" size={13} color="var(--cv-ink-dim)" />
            This Mac
            <span style={{ fontSize: 9, color: "var(--cv-ink-faint)" }}>▾</span>
          </button>
          {drop("machine", (
            <>
              <div style={sectionLabel}>Machine</div>
              {row("monitor", "This Mac", "agents run locally", () => {})}
              {row("ws", "Cloud box", "remote runner — soon", undefined, true)}
              {row("bot", "Phone", "pair a device — soon", undefined, true)}
            </>
          ))}
        </div>
        <div style={{ position: "relative" }}>
          <button
            style={{ ...pill, border: "none", background: "transparent" }}
            title="Workspaces"
            onClick={() => setMenu((m) => (m === "ws" ? null : "ws"))}
          >
            <Icon name="ws" size={13} color="var(--cv-ink-dim)" />
            {wsList.length > 0 ? `${wsList.length} ws` : "Workspaces"}
            <span style={{ fontSize: 9, color: "var(--cv-ink-faint)" }}>▾</span>
          </button>
          {drop("ws", (
            <>
              <div style={sectionLabel}>Workspaces</div>
              {wsList.length === 0 &&
                row("ws", "no workspaces", "add one below")}
              {wsList.map((w) =>
                row("ws", w.name, w.repo ?? "", () => useBoard.getState().requestFocus(w.id)),
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "6px 4px 2px", borderTop: "1px solid var(--cv-glass-edge)" }}>
                <input style={miniInput} placeholder="+ workspace name" value={wsName} onChange={(e) => setWsName(e.target.value)} />
                {isTauri() && (
                  <button
                    style={{ ...miniInput, width: "auto", cursor: "pointer", flexShrink: 0 } as React.CSSProperties}
                    title="pick the repo folder with the native dialog"
                    onClick={async () => {
                      const { open } = await import("@tauri-apps/plugin-dialog");
                      const dir = await open({ directory: true, title: "Repo for the workspace" });
                      if (typeof dir === "string") setWsRepo(dir);
                    }}
                  >
                    📁 pick folder…
                  </button>
                )}
                <input style={miniInput} placeholder="repo path (~/repos/my-app)" value={wsRepo} onChange={(e) => setWsRepo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && wsName.trim() && wsRepo.trim()) {
                      useBoard.getState().createWorkspace(wsName.trim(), wsRepo.trim());
                      setWsName(""); setWsRepo(""); setMenu(null);
                    }
                  }} />
              </div>
            </>
          ))}
        </div>
        <div style={{ position: "relative" }}>
          <button
            style={{ ...pill, border: "none", background: "transparent" }}
            title="Worktrees — agent branches in flight"
            onClick={() => setMenu((m) => (m === "wt" ? null : "wt"))}
          >
            <Icon name="worktree" size={13} color="var(--cv-ink-dim)" />
            Worktrees
            <span style={{ fontSize: 9, color: "var(--cv-ink-faint)" }}>▾</span>
          </button>
          {drop("wt", (
            <>
              <div style={sectionLabel}>Worktrees</div>
              {Object.values(agents).filter((a) => a.worktree && a.status !== "exited").length === 0 &&
                row("worktree", "no worktrees", "spawn agents in a workspace to see their trees")}
              {Object.values(agents)
                .filter((a) => a.worktree && a.status !== "exited")
                .map((a) =>
                  row("worktree", a.name, `${a.branch ?? ""} · ${a.worktree}`, () =>
                    useBoard.getState().requestFocus(a.id)),
                )}
              {row("worktree", "＋ spawn an agent", "opens the spawn chooser — pick a workspace-backed CLI", () => {
                setMenu(null);
                useBoard.getState().focusSpawn();
              })}
            </>
          ))}
        </div>
        <div style={{ position: "relative" }}>
          <button
            style={{ ...pill, border: "none", background: "transparent" }}
            title={`Tasks — ${delegated} in flight`}
            onClick={() => setMenu((m) => (m === "tasks" ? null : "tasks"))}
          >
            <Icon name="tasks" size={13} color="var(--cv-ink-dim)" />
            Tasks{delegated > 0 ? ` ${delegated}` : ""}
            <span style={{ fontSize: 9, color: "var(--cv-ink-faint)" }}>▾</span>
          </button>
          {drop("tasks", (
            <>
              <div style={sectionLabel}>Tasks</div>
              {Object.values(edges).filter((e) => e.state === "delegated").length === 0 &&
                row("tasks", "no tasks in flight", "history lives in the Tasks panel", () => onNav("history"))}
              {Object.values(edges)
                .filter((e) => e.state === "delegated")
                .map((e) => {
                  const to = agents[e.to];
                  return row("tasks", `${to?.name ?? e.to} · ${e.task.slice(0, 28)}`, "click to focus the agent", () =>
                    useBoard.getState().requestFocus(e.to));
                })}
              {row("tasks", "＋ new task", "opens the spawn chooser", () => {
                setMenu(null);
                useBoard.getState().focusSpawn();
              })}
              {row("tasks", "Open task history", "all delegated runs", () => onNav("history"))}
            </>
          ))}
        </div>
        <span
          data-testid="daemon-status"
          role="status"
          aria-label={connected ? "Canvas daemon connected" : "Canvas demo mode; daemon offline"}
          title={connected ? "canvasd connected" : "demo mode · start canvasd to connect"}
          style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            background: connected ? "var(--cv-done)" : "var(--cv-ink-faint)",
            margin: "0 7px 0 5px",
            flexShrink: 0,
            boxShadow: connected ? "0 0 8px color-mix(in srgb, var(--cv-done) 42%, transparent)" : undefined,
          }}
        />
      </div>

      <div style={{ flex: 1 }} />

      {/* ── right: loose round glass buttons that fuse into one bubble on
          hover — Deska's topbar trick ── */}
      <div
        className="cv-fuse"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          pointerEvents: "auto",
        }}
      >
        <div style={{ position: "relative" }}>
          <button
            className="glass-pill"
            style={{
              ...pill,
              ...iconBtn(menu === "panels"),
              width: "auto",
              padding: "0 10px",
              display: "flex",
              gap: 7,
              background: "transparent",
              border: "none",
              fontSize: 11,
              color: menu === "panels" ? "var(--cv-accent)" : "var(--cv-ink-dim)",
            }}
            title="Panels on the canvas — which terminals are open"
            onClick={() => setMenu((m) => (m === "panels" ? null : "panels"))}
          >
            <Icon name="windows" size={15} color={menu === "panels" ? "var(--cv-accent)" : "var(--cv-ink-dim)"} />
            <span>Panels</span>
            {panelItems.length > 0 && (
              <span
                style={{
                  minWidth: 13,
                  height: 17,
                  borderRadius: 999,
                  background: "var(--cv-glass-hi)",
                  color: "var(--cv-ink)",
                  fontSize: 9,
                  fontWeight: 700,
                  display: "grid",
                  placeItems: "center",
                  padding: "0 3px",
                }}
              >
                {panelItems.length}
              </span>
            )}
          </button>
          {drop("panels", (
            <>
              <div style={sectionLabel}>Panels · {panelItems.length + panelRegions.length}</div>
              {panelItems.length === 0 && panelRegions.length === 0 &&
                row("panels", "nothing on the board", "right-click the canvas → add to board")}
              {panelRegions.map((r) => (
                <div key={r.shape.id}>
                  <button
                    style={menuRow}
                    title={`${r.members.length} window${r.members.length === 1 ? "" : "s"} — click to focus the region`}
                    onClick={() => { useBoard.getState().requestFocus(r.shape.id); setMenu(null); }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--cv-glass-hi)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <Icon name="region" size={14} color="var(--cv-accent)" />
                    <span style={{ flex: 1 }}>{r.shape.text ?? "Region"}</span>
                    <span style={{ fontSize: 9, color: "var(--cv-ink-faint)" }}>{r.members.length}</span>
                  </button>
                  {r.members.map((it) =>
                    <button
                      key={it.id}
                      style={{ ...menuRow, paddingLeft: 24 }}
                      title={it.hint}
                      onClick={() => { useBoard.getState().requestFocus(it.id); setMenu(null); }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--cv-glass-hi)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <Icon name={it.icon} size={13} color="var(--cv-ink-dim)" />
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{it.label}</span>
                      {it.sub && <span style={{ fontSize: 9, color: "var(--cv-ink-faint)", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 90 }}>{it.sub}</span>}
                    </button>,
                  )}
                </div>
              ))}
              {looseItems.length > 0 && <div style={sectionLabel}>Not in a region · {looseItems.length}</div>}
              {looseItems.map((it) =>
                <button
                  key={it.id}
                  style={menuRow}
                  title={it.hint}
                  onClick={() => { useBoard.getState().requestFocus(it.id); setMenu(null); }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--cv-glass-hi)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <Icon name={it.icon} size={13} color="var(--cv-ink-dim)" />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{it.label}</span>
                  {it.sub && <span style={{ fontSize: 9, color: "var(--cv-ink-faint)", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 90 }}>{it.sub}</span>}
                </button>,
              )}
            </>
          ))}
        </div>
        <button
          className="glass-pill cv-topbar-summary"
          style={{
            ...pill,
            height: 34,
            padding: "0 11px",
            border: "none",
            background: "transparent",
            color: nav === "usage" ? "var(--cv-accent)" : "var(--cv-ink-dim)",
            gap: 7,
          }}
          title="Mission Map — agents, terminals, models and accounts"
          onClick={() => onNav("usage")}
        >
          <Icon name="mission-map" size={16} color={nav === "usage" ? "var(--cv-accent)" : "var(--cv-ink-dim)"} />
          <span>Mission Map</span>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "3px 7px",
            borderRadius: 999,
            background: "var(--cv-glass-hi)",
            color: "var(--cv-ink)",
            fontSize: 10,
            fontWeight: 650,
            fontVariantNumeric: "tabular-nums",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: liveAgents.length ? "var(--cv-working)" : "var(--cv-ink-faint)" }} />
            {liveAgents.length} live
          </span>
        </button>
        <button
          className="glass-pill"
          style={{ ...iconBtn(false), background: "transparent", border: "none" }}
          title="Search — find on the board (⌘F)"
          onClick={openSearch}
        >
          <Icon name="search" size={16} color="var(--cv-ink-dim)" />
        </button>
        <button
          className="glass-pill cv-topbar-labeled-control"
          style={{ ...iconBtn(nav === "automations"), width: "auto", padding: "0 10px", display: "flex", gap: 7, background: "transparent", border: "none" }}
          title="Automations"
          onClick={() => onNav("automations")}
        >
          <Icon name="automations" size={16} color={nav === "automations" ? "var(--cv-accent)" : "var(--cv-ink-dim)"} />
          <span className="cv-topbar-control-label">Automations</span>
        </button>
        <button
          className="glass-pill cv-topbar-labeled-control"
          style={{ ...iconBtn(nav === "inbox"), width: "auto", padding: "0 10px", display: "flex", gap: 7, background: "transparent", border: "none" }}
          title="Notifications — approvals and agents that need you"
          onClick={() => onNav("inbox")}
        >
          <Icon name="bell" size={16} color={nav === "inbox" ? "var(--cv-accent)" : "var(--cv-ink-dim)"} />
          <span className="cv-topbar-control-label">Inbox</span>
          {notifCount > 0 && (
            <span
              style={{
                position: "absolute",
                top: 2,
                right: 2,
                minWidth: 13,
                height: 13,
                borderRadius: 999,
                background: "var(--cv-waiting)",
                color: "var(--cv-base)",
                fontSize: 8.5,
                fontWeight: 700,
                display: "grid",
                placeItems: "center",
                padding: "0 3px",
              }}
            >
              {notifCount}
            </span>
          )}
        </button>
        <button
          className="glass-pill"
          style={{ ...iconBtn(false), background: "transparent", border: "none" }}
          title="Gather — group loose windows into a frame"
          onClick={() => useBoard.getState().gatherLoose()}
        >
          <Icon name="gather" size={16} color="var(--cv-ink-dim)" />
        </button>
        {lastGather && (
          <button
            className="glass-pill"
            style={{ ...iconBtn(false), background: "transparent", border: "none" }}
            title="Undo grouping — put windows back where they were"
            onClick={() => useBoard.getState().undoGather()}
          >
            <Icon name="history" size={16} color="var(--cv-accent)" />
          </button>
        )}
        <ToolsMenu active={nav} onSelect={onNav} actions={tools} />
        <button
          className="glass-pill"
          style={{ ...iconBtn(nav === "settings"), background: "transparent", border: "none" }}
          title="Settings"
          onClick={() => onNav("settings")}
        >
          <Icon name="settings" size={16} color={nav === "settings" ? "var(--cv-accent)" : "var(--cv-ink-dim)"} />
        </button>
      </div>
    </div>
  );
}
