/** Panel metadata shared between the store (which sizes/places panel cards
 * and must not import React components) and panelRegistry (which adds the
 * render functions). Keep titles/sizes/icons here, single source. */
export interface PanelMeta {
  title: string;
  icon?: string;
  img?: string;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

export const PANEL_META: Record<string, PanelMeta> = {
  inbox: { title: "Inbox", icon: "bell", w: 320, h: 440 },
  automations: { title: "Automations", icon: "zap", w: 340, h: 440 },
  loops: { title: "Loops", icon: "loops", w: 320, h: 400 },
  presets: { title: "Presets", icon: "presets", w: 320, h: 400 },
  thread: { title: "Thread", icon: "thread", w: 340, h: 460 },
  accounts: { title: "Accounts", icon: "accounts", w: 320, h: 400 },
  usage: { title: "Mission Map", icon: "mission-map", w: 420, h: 500 },
  memory: { title: "Memory", icon: "memory", w: 320, h: 420 },
  prs: { title: "Pull requests", icon: "github", w: 360, h: 440 },
  issues: { title: "Issues", icon: "issue", w: 360, h: 440 },
  notes: { title: "Board Notes", icon: "ticket", w: 320, h: 420 },
  artifacts: { title: "Artifacts", icon: "artifacts", w: 360, h: 440 },
  vault: { title: "Vault Explorer", img: "/obsidian.svg", w: 460, h: 520, minW: 320, minH: 280 },
  settings: { title: "Settings", icon: "settings", w: 360, h: 480 },
  skills: { title: "Skills", icon: "skills", w: 340, h: 440 },
  history: { title: "Tasks", icon: "tasks", w: 360, h: 440 },
  sc: { title: "Source Control", icon: "github", w: 340, h: 440 },
  explorer: { title: "Repo Explorer", icon: "explorer", w: 480, h: 480, minW: 320, minH: 240 },
  tickets: { title: "Dex Tickets", icon: "ticket", w: 380, h: 460 },
};
