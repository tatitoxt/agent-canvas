# UI Layout Rules

How the canvas chrome is organized and which file owns each region.
Chrome = everything that isn't the canvas itself (nodes, edges, minimap).
All of it lives in `web/src/components/` and mounts in `web/src/App.tsx`
(~line 420).

## Regions

```
┌────────────────────────── Topbar ──────────────────────────┐
│  Canvas · Machine · Workspaces · Worktrees · Tasks     usage │
│                                                     ·icons │
│                                                            │
│  LEFT RAIL                                              R  │
│  ┌────────┐                                             I  │
│  │ code   │                                             G  │
│  │ bubble │                                             H  │
│  └────────┘                                          ┌───┐ │
│   .                                                  │spc│ │
│   .                                                  └───┘ │
│  ┌────────┐                              canvas    ┌──────┐│
│  │ Extras │                                          │ctrl ││
│  └────────┘                                          └───┘ │
│ ┌──────────┐  ┌────────────────┐  ┌──────┐                 │
│ │ create   │  │   Ask Dex…     │  │inbox │   [minimap]     │
│ └──────────┘  └────────────────┘  └──────┘                 │
└──────────────────── BottomDock ────────────────────────────┘
```

### Left rail — `NavRail.tsx`, `NavRail()`

One glass column pinned left (`railCol`, `left:4`), split top/bottom:

- **Code bubble** (top): Source Control (`sc` — amber badge = agents
  with worktrees), Explorer (`vault`), Dev Tickets (`tickets`),
  Pull Requests and Issues (`prs`, `issues` — only when `repoUrl`
  exists; github.com refuses iframes so they open as panels, not web
  nodes), daemon-status dot (green connected / dim offline).
- **Extras** (`ExtrasBubble`, bottom): integrations hub — VS Code,
  Obsidian vault (opens `vault`), Discord, GitHub Actions; unbuilt
  bridges get a `soon` tag.

### Right rail — `NavRail.tsx`, `RightRail()`

- **Spaces bubble** (top): board tiles — first letter, live agent-count
  badge, double-click/right-click to rename, `+` creates a board, `×`
  deletes an empty active board.
- **Controls mini-bubble** (bottom-right, `bubbleRow`): zoom out / in /
  fit, gather loose windows, hide chrome, panel summaries toggle.

### Bottom dock — `NavRail.tsx`, `BottomDock()`

A 3-column grid (`1fr auto 1fr`) keeping Dex dead-center:

- **Left of Dex — create bubble**: New task (focuses the Orchestrator's
  spawn chooser), File Explorer (`vault`), Terminal (spawns plain
  `bash`), Code Editor (`notes`), New orchestrator.
- **Center — Dex pill** (`borderRadius:999`, 320px): real input, Enter
  sends `threadSend` + opens `thread`, ↑/↓ command history (last 20).
- **Right of Dex — round inbox**: approvals + waiting/blocked agents +
  delegations in flight, amber count badge.

### Topbar — `Topbar.tsx`, `Topbar()`

Two `glass-pill` groups, `pointerEvents:none` on the row so clicks fall
through to the canvas.

- **Left**: `Canvas` mark · Machine menu (This Mac now; Cloud box and
  Phone stubbed `soon`) · Workspaces (count + focus) · Worktrees (agent
  branches in flight) · Tasks (delegated count + focus + history link)
  · `offline` label when disconnected.
- **Right, icon-only**: Panels (open terminals + count) · usage pill
  (`N live` + per-agent output) · Search (fires ⌘F) · Automations ·
  Notifications bell (approvals + waiting + blocked, amber badge) ·
  Juice (`usage`) · Mission Map (fit view) · **Tools** menu · Settings.

### Tools menu — `ToolsRail.tsx`, `ToolsMenu()`

One dropdown holding what used to crowd a rail:

- **Board**: new orchestrator, team builder, shapes, new workspace,
  pin a web page, pause/resume all, gather, panel summaries.
- **Capture**: pencil markups, region shot, canvas shot (⌘⇧S),
  session digest, studio doc.
- **Panels**: every panel key in `PANEL_ITEMS`.

### Canvas chrome — `App.tsx`

Minimap sits `bottom-right` (`marginRight: 84`) next to the right rail,
pannable/zoomable, resizable via a drag grip at its top-left corner,
node colors map `kind`/`status` (orchestrator gold, agent status
palette).

## Rules

- **Bubbles, not bars.** Chrome groups live in small floating
  `glass`/`glass-pill` bubbles (radius 9–14, radius 999 for round pills)
  pinned to edges — never a full-width strip.
- **Icon-only + tooltips.** Every button carries a `title` explaining
  the action (`"verb — object"` style: `"Gather loose windows into a
  group"`). No icon ships without one.
- **Counts, not noise.** Badges (`badge()`) show live numbers — git
  agents, inbox items, open panels — amber `var(--cv-waiting)` for
  attention, `var(--cv-done)` for neutral counts, in `var(--cv-glass-hi)`
  for totals.
- **Dim = not built.** Unfinished features render at `opacity:.45` with
  a `soon` tag instead of being hidden.
- **Panels over pages.** Navigation keys (`sc`, `vault`, `tickets`,
  `prs`, `issues`, `inbox`, `thread`, `usage`, …) open panels inside the
  canvas — App.tsx maps `nav` → `*Panel` mounts. New UI surfaces get a
  nav key + a panel, not a route.
- **Click-through skeleton.** Container rows use `pointerEvents:none`;
  only the bubbles opt back in with `pointerEvents:auto`, so the canvas
  stays pannable behind chrome.
- **Menus self-close.** Every dropdown registers a `mousedown` listener
  that closes it on outside click; rows highlight via
  `var(--cv-glass-hi)` hover.
- **Status colors are the node's language.** The same palette drives the
  minimap (`nodeColor`), the terminal-card outline, and badges —
  `working` green, `waiting` amber, `blocked` red, `done` teal,
  `idle`/`exited` dim.

## File map

| Region          | File / export                                  |
|-----------------|------------------------------------------------|
| Left + right rail + bottom dock | `components/NavRail.tsx` (`NavRail`, `RightRail`, `BottomDock`, `SpacesBubble`, `ExtrasBubble`) |
| Topbar          | `components/Topbar.tsx` (`Topbar`)             |
| Tools dropdown  | `components/ToolsRail.tsx` (`ToolsMenu`, `PANEL_ITEMS`) |
| Panels          | `components/*Panel.tsx`, mounted in `App.tsx`  |
| Minimap         | `App.tsx` (`MiniMap`, resize grip)             |
| Nav dispatch    | `App.tsx` — `nav` state → panel mounts         |
| Store           | `store/board.ts` — every chrome control reads/writes here |
