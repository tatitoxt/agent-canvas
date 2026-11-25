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
import { SettingsPanel } from "./SettingsPanel";
import { SkillsPanel } from "./SkillsPanel";
import { HistoryPanel } from "./HistoryPanel";
import { SourceControlPanel } from "./SourceControlPanel";
import { DevTicketsPanel } from "./DevTicketsPanel";
import { PANEL_META, type PanelMeta } from "./panelMeta";

export interface PanelDef extends PanelMeta {
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
  inbox: { ...PANEL_META.inbox, render: () => <InboxNode /> },
  automations: { ...PANEL_META.automations, render: () => <AutomationsPanel /> },
  loops: { ...PANEL_META.loops, render: () => <LoopsPanel /> },
  presets: { ...PANEL_META.presets, render: () => <PresetsPanel /> },
  thread: { ...PANEL_META.thread, render: () => <ThreadPanel /> },
  accounts: { ...PANEL_META.accounts, render: () => <AccountsPanel /> },
  usage: { ...PANEL_META.usage, render: () => <UsagePanel /> },
  memory: { ...PANEL_META.memory, render: () => <MemoryPanel /> },
  prs: { ...PANEL_META.prs, render: () => <GitHubPanel kind="prs" /> },
  issues: { ...PANEL_META.issues, render: () => <GitHubPanel kind="issues" /> },
  notes: { ...PANEL_META.notes, render: () => <NotesPanel /> },
  artifacts: { ...PANEL_META.artifacts, render: () => <ArtifactsPanel /> },
  vault: { ...PANEL_META.vault, render: () => <VaultPanel /> },
  settings: { ...PANEL_META.settings, render: () => <SettingsPanel /> },
  skills: { ...PANEL_META.skills, render: () => <SkillsPanel /> },
  history: { ...PANEL_META.history, render: () => <HistoryNode /> },
  sc: { ...PANEL_META.sc, render: () => <SourceControlPanel /> },
  tickets: { ...PANEL_META.tickets, render: () => <DevTicketsPanel /> },
};
