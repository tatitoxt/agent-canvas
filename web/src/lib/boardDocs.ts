import { useBoard } from "../store/board";

export type BoardDocKind = "overview" | "onboarding" | "architecture";

export function buildDoc(kind: BoardDocKind): { title: string; md: string } {
  const s = useBoard.getState();
  const agents = Object.values(s.agents);
  const boards = Object.entries(s.boards);
  const notes = Object.values(s.notes ?? {});
  const artifacts = Object.values(s.artifacts ?? {});
  if (kind === "overview") {
    return {
      title: "Project overview",
      md: [
        "# Project overview",
        "",
        `Boards: ${boards.map(([, n]) => n).join(", ") || "Main"}`,
        `Agents: ${agents.length} (${agents.filter((a) => a.status !== "exited").length} live)`,
        "",
        "## Agents",
        ...agents.map((a) => `- ${a.name} · ${a.command ?? "?"} · ${a.status}`),
        "",
        "## Notes",
        ...(notes.length ? notes.map((n) => `- [${(n as { col?: string }).col ?? "todo"}] ${(n as { text?: string }).text ?? ""}`) : ["- none"]),
        "",
        "## Artifacts",
        ...(artifacts.length ? artifacts.map((a) => `- ${(a as { title?: string }).title ?? "untitled"} (${(a as { kind?: string }).kind ?? "doc"})`) : ["- none"]),
      ].join("\n"),
    };
  }
  if (kind === "onboarding") {
    return {
      title: "Onboarding guide",
      md: [
        "# Onboarding guide",
        "",
        "## The board",
        "Each card is a live agent console on a worktree. Drag to arrange, select several to group.",
        "",
        "## Spawning",
        "Use the Orchestrator card (+), the create bubble, or tell Dex 'spawn two codex'.",
        "",
        "## Dex",
        "Bottom-center pill. @Terminal N <msg> directs one console, @all broadcasts, check Terminal N peeks output.",
        "",
        "## Obsidian",
        "Left rail gem opens the vault. 'obsidian <note>' in Dex writes to canvas-dex.md.",
        "",
        "## Panels",
        "Inbox (approvals), Usage/Juice (per-agent output), Artifacts (agent deliverables), History, Loops.",
      ].join("\n"),
    };
  }
  return {
    title: "Architecture",
    md: [
      "# Architecture",
      "",
      "## canvasd",
      "Local Rust daemon (:4242) owning PTYs, worktrees, SQLite board state. Survives UI restarts; web and Tauri share it.",
      "",
      "## Web client",
      "React + React Flow canvas, Zustand store, ws control channel + binary PTY frames.",
      "",
      "## Protocol",
      "JSON control msgs (spawn/input/vault/notes/artifacts) + [id_len][id][bytes] PTY frames.",
      "",
      "## Nodes",
      "Agent consoles, orchestrators, workspaces, kanban notes, web + live-markdown pins.",
      "",
      "## Rails",
      "Left: tools sidebar (source control, vault, GitHub). Right: spaces + zoom/controls. Bottom: create · Dex · inbox.",
    ].join("\n"),
  };
}


/** "Ask for anything" — build a doc about any topic from live board state. */
export function buildAskDoc(q: string): { title: string; md: string } {
  const s = useBoard.getState();
  const agents = Object.values(s.agents);
  const md = [
    `# ${q}`,
    "",
    "## Board right now",
    `Agents: ${agents.length} (${agents.filter((a) => a.status !== "exited").length} live)`,
    ...agents.map((a) => `- ${a.name} · ${a.command ?? "?"} · ${a.status}`),
    "",
    "## Boards",
    ...Object.entries(s.boards).map(([, n]) => `- ${n}`),
    "",
    "## Notes",
    ...(Object.values(s.notes ?? {}).length
      ? Object.values(s.notes ?? {}).map((n) => `- ${(n as { text?: string }).text ?? ""}`)
      : ["- none"]),
  ].join("\n");
  return { title: q.slice(0, 40), md };
}
