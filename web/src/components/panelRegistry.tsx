import type React from "react";
import { usePanelActions } from "./panelCtx";
import { InboxPanel } from "./InboxPanel";
import { AutomationsPanel } from "./AutomationsPanel";
import { LoopsPanel } from "./LoopsPanel";
import { PresetsPanel } from "./PresetsPanel";
import { ThreadPanel } from "./ThreadPanel";
import { AccountsPanel } from "./AccountsPanel";
import { UsagePanel } from "./UsagePanel";
import { MemoryPanel } from "./MemoryPanel";
import { GitHubPanel } from "./GitHubPanel";
import { NotesPanel } from "./NotesPanel";
import { ArtifactsPanel } from "./ArtifactsPanel";
import { VaultPanel } from "./VaultPanel";
import { CalendarPanel } from "./CalendarPanel";
import { SettingsPanel } from "./SettingsPanel";
import { SkillsPanel } from "./SkillsPanel";
import { HistoryPanel } from "./HistoryPanel";

export interface PanelDef {
  title: string;
  icon?: string;
  img?: string;
  /** default node size + where it first drops (flow-space offset hint) */
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  render: () => React.ReactNode;
}

function InboxNode() {
  const ctx = usePanelActions();
  return (
    <InboxPanel
      onOpenAgent={(id) => ctx.openTerm({ id, name: id })}
    />
  );
}

function HistoryNode() {
  const ctx = usePanelActions();
  return <HistoryPanel onOpenEdge={(id) => ctx.openEdgeDetail(id)} />;
}

/** Every tool panel, renderable inside a canvas node — Deska "Add to
 * board". The panel keeps its own UI; the node adds title bar + close. */
export const PANEL_DEFS: Record<string, PanelDef> = {
  inbox: { title: "Inbox", icon: "bell", w: 320, h: 440, render: () => <InboxNode /> },
  automations: { title: "Automations", icon: "zap", w: 340, h: 440, render: () => <AutomationsPanel /> },
  loops: { title: "Loops", icon: "loops", w: 320, h: 400, render: () => <LoopsPanel /> },
  presets: { title: "Presets", icon: "presets", w: 320, h: 400, render: () => <PresetsPanel /> },
  thread: { title: "Thread", icon: "thread", w: 340, h: 460, render: () => <ThreadPanel /> },
  accounts: { title: "Accounts", icon: "accounts", w: 320, h: 400, render: () => <AccountsPanel /> },
  usage: { title: "Juice", icon: "juice", w: 320, h: 400, render: () => <UsagePanel /> },
  memory: { title: "Memory", icon: "memory", w: 320, h: 420, render: () => <MemoryPanel /> },
  prs: { title: "Pull requests", icon: "github", w: 360, h: 440, render: () => <GitHubPanel kind="prs" /> },
  issues: { title: "Issues", icon: "issue", w: 360, h: 440, render: () => <GitHubPanel kind="issues" /> },
  notes: { title: "Dex Tickets", icon: "ticket", w: 320, h: 420, render: () => <NotesPanel /> },
  artifacts: { title: "Artifacts", icon: "artifacts", w: 360, h: 440, render: () => <ArtifactsPanel /> },
  vault: { title: "Obsidian", img: "/obsidian.svg", w: 460, h: 520, minW: 320, minH: 280, render: () => <VaultPanel /> },
  calendar: { title: "Calendar", icon: "calendar", w: 340, h: 440, render: () => <CalendarPanel /> },
  settings: { title: "Settings", icon: "settings", w: 360, h: 480, render: () => <SettingsPanel /> },
  skills: { title: "Skills", icon: "skills", w: 340, h: 440, render: () => <SkillsPanel /> },
  history: { title: "Tasks", icon: "tasks", w: 360, h: 440, render: () => <HistoryNode /> },
};
