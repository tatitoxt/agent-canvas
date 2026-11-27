import type React from "react";
import { lazy, Suspense, type ComponentType } from "react";
import { usePanelActions } from "./panelCtx";
import { PANEL_META, type PanelMeta } from "./panelMeta";

export interface PanelDef extends PanelMeta {
  render: () => React.ReactNode;
}

/** Every registry panel ships in its own chunk: together they are a third of
 * the app code, but any given session opens a handful of them. The card
 * chrome (title bar, resize, close) is part of PanelNode and renders
 * immediately — only the panel body waits for the chunk, so the fallback
 * below is a few frames of quiet filler, not a layout shift. */
function PanelLoading() {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--cv-ink-faint)",
        fontSize: "var(--cv-text-xxs)",
        letterSpacing: "0.04em",
      }}
    >
      loading…
    </div>
  );
}

function lazyPanel<T extends object>(
  loader: () => Promise<{ default: ComponentType<T> }>,
): ComponentType<T> {
  const Inner = lazy(loader);
  return function LazyPanel(props: T) {
    return (
      <Suspense fallback={<PanelLoading />}>
        <Inner {...props} />
      </Suspense>
    );
  };
}

const InboxPanel = lazyPanel(async () => ({ default: (await import("./InboxPanel")).InboxPanel }));
const AutomationsPanel = lazyPanel(async () => ({ default: (await import("./AutomationsPanel")).AutomationsPanel }));
const LoopsPanel = lazyPanel(async () => ({ default: (await import("./LoopsPanel")).LoopsPanel }));
const PresetsPanel = lazyPanel(async () => ({ default: (await import("./PresetsPanel")).PresetsPanel }));
const ThreadPanel = lazyPanel(async () => ({ default: (await import("./ThreadPanel")).ThreadPanel }));
const AccountsPanel = lazyPanel(async () => ({ default: (await import("./AccountsPanel")).AccountsPanel }));
const UsagePanel = lazyPanel(async () => ({ default: (await import("./UsagePanel")).UsagePanel }));
const MemoryPanel = lazyPanel(async () => ({ default: (await import("./MemoryPanel")).MemoryPanel }));
const GitHubPanel = lazyPanel(async () => ({ default: (await import("./GitHubPanel")).GitHubPanel }));
const NotesPanel = lazyPanel(async () => ({ default: (await import("./NotesPanel")).NotesPanel }));
const ArtifactsPanel = lazyPanel(async () => ({ default: (await import("./ArtifactsPanel")).ArtifactsPanel }));
const VaultPanel = lazyPanel(async () => ({ default: (await import("./VaultPanel")).VaultPanel }));
const SettingsPanel = lazyPanel(async () => ({ default: (await import("./SettingsPanel")).SettingsPanel }));
const SkillsPanel = lazyPanel(async () => ({ default: (await import("./SkillsPanel")).SkillsPanel }));
const HistoryPanel = lazyPanel(async () => ({ default: (await import("./HistoryPanel")).HistoryPanel }));
const SourceControlPanel = lazyPanel(async () => ({ default: (await import("./SourceControlPanel")).SourceControlPanel }));
const DevTicketsPanel = lazyPanel(async () => ({ default: (await import("./DevTicketsPanel")).DevTicketsPanel }));
const RepoExplorerPanel = lazyPanel(async () => ({ default: (await import("./RepoExplorerPanel")).RepoExplorerPanel }));

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
  explorer: { ...PANEL_META.explorer, render: () => <RepoExplorerPanel /> },
};
