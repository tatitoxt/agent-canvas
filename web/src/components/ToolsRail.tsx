import { Icon } from "./icons";

const ITEMS = [
  { key: "thread", icon: "thread", label: "Thread — command the board in words" },
  { key: "automations", icon: "automations", label: "Automations" },
  { key: "loops", icon: "loops", label: "Loops — re-send instructions on a cadence" },
  { key: "presets", icon: "presets", label: "Presets — saved board layouts" },
  { key: "memory", icon: "memory", label: "Memory — per-repo agent memory" },
  { key: "notes", icon: "notes", label: "Notes" },
  { key: "artifacts", icon: "artifacts", label: "Artifacts" },
  { key: "vault", icon: "vault", label: "Vault" },
  { key: "skills", icon: "skills", label: "Skills" },
  { key: "accounts", icon: "accounts", label: "Accounts" },
] as const;

const btn = (active: boolean): React.CSSProperties => ({
  width: 34,
  height: 34,
  display: "grid",
  placeItems: "center",
  borderRadius: 10,
  border: "none",
  cursor: "pointer",
  color: active ? "var(--cv-ink)" : "var(--cv-ink-faint)",
  background: active ? "var(--cv-glass-hi)" : "transparent",
  boxShadow: active ? "inset 0 1px 0 var(--cv-glass-shine)" : "none",
});

const divider: React.CSSProperties = {
  width: 20,
  height: 1,
  background: "var(--cv-glass-edge)",
  margin: "4px 0",
};

export interface ToolsRailActions {
  onDigest: () => void;
  onShot: () => void;
  onStudio: () => void;
  onDraw: () => void;
  onRegion: () => void;
  onSettings: () => void;
}

/** Right rail — Symvibe-style tool dock: everything that isn't a space.
 * Absorbs the floating digest/shot/studio/draw/region pills. */
export function ToolsRail({
  active,
  onSelect,
  actions,
  drawOn,
  regionOn,
}: {
  active: string;
  onSelect: (key: string) => void;
  actions: ToolsRailActions;
  drawOn: boolean;
  regionOn: boolean;
}) {
  return (
    <nav
      className="glass"
      style={{
        position: "absolute",
        right: 12,
        top: "50%",
        transform: "translateY(-50%)",
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        padding: "8px 7px",
        maxHeight: "86vh",
        overflowY: "auto",
      }}
    >
      {ITEMS.map((it) => (
        <button
          key={it.key}
          title={it.label}
          onClick={() => onSelect(it.key)}
          style={btn(active === it.key)}
        >
          <Icon name={it.icon} />
        </button>
      ))}
      <div style={divider} />
      <button title="digest of every session (lose nothing)" onClick={actions.onDigest} style={btn(false)}>
        <Icon name="digest" />
      </button>
      <button title="export the canvas as PNG" onClick={actions.onShot} style={btn(false)}>
        <Icon name="shot" />
      </button>
      <button title="studio — repo → markdown dossier" onClick={actions.onStudio} style={btn(false)}>
        <Icon name="studio" />
      </button>
      <button
        title="pencil — draw markups on the canvas (baked into shots)"
        onClick={actions.onDraw}
        style={btn(drawOn)}
      >
        <Icon name="draw" color={drawOn ? "var(--cv-accent)" : undefined} />
      </button>
      <button
        title="drag a region → PNG of just that part"
        onClick={actions.onRegion}
        style={btn(regionOn)}
      >
        <Icon name="region" color={regionOn ? "var(--cv-accent)" : undefined} />
      </button>
      <div style={divider} />
      <button title="Settings" onClick={actions.onSettings} style={btn(active === "settings")}>
        <Icon name="settings" />
      </button>
    </nav>
  );
}
