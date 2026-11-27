import { useEffect, useMemo, useRef, useState } from "react";
import { panelRoot, actionBtn } from "./panelChrome";
import { useBoard } from "../store/board";
import { isTauri } from "../daemon/tauriClient";
import { downloadPdf } from "../lib/pdf";
import { buildDoc, buildAskDoc } from "../lib/boardDocs";
import { Icon } from "./icons";
import { EmptyState } from "./EmptyState";
import { ReadingView, IMAGE_RE } from "./noteView";
import { resolveNotePath } from "./notePath";
import { GeneratePdfMenu } from "./GeneratePdfMenu";

const tabBtn = (on: boolean): React.CSSProperties => ({
  border: "none",
  background: on ? "var(--cv-glass-hi)" : "transparent",
  color: on ? "var(--cv-accent)" : "var(--cv-ink-dim)",
  fontSize: "var(--cv-text-xxs)",
  fontWeight: 600,
  padding: "4px 10px",
  borderRadius: 8,
  cursor: "pointer",
});

/** Visually hidden text — screen readers (and text-based test selectors)
 * still find it, sighted users see only the icon. */
const srOnly: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};

/** Obsidian-style "clickable icon" — a quiet square glyph that only lights
 * up on hover, never a text pill. The accessible label rides inside as
 * visually-hidden text so the control still has a real name. */
function IconBtn({ icon, label, text, onClick, active, size = 14 }: {
  icon: string;
  label: string;
  /** visually-hidden text content — defaults to the label */
  text?: string;
  onClick: (e: React.MouseEvent) => void;
  active?: boolean;
  size?: number;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className="vp-iconbtn"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        flexShrink: 0,
        border: "none",
        borderRadius: 5,
        background: active ? "var(--cv-glass-hi)" : "transparent",
        color: active ? "var(--cv-accent)" : "var(--cv-ink-dim)",
        cursor: "pointer",
        padding: 0,
        position: "relative",
      }}
    >
      <Icon name={icon} size={size} />
      <span style={srOnly}>{text ?? label}</span>
    </button>
  );
}

/** Scoped explorer CSS — injected once with the panel; keeps hover states
 * off the inline-style hot path. Row hover is the Obsidian sidebar feel:
 * a faint ink wash, the active note a soft accent tint. */
const VAULT_EXPLORER_CSS = `
.vp-row { transition: background-color 90ms ease; }
.vp-row:hover { background: color-mix(in srgb, var(--cv-ink) 6%, transparent) !important; }
.vp-row.vp-active { background: color-mix(in srgb, var(--cv-accent) 13%, transparent) !important; }
.vp-row.vp-active:hover { background: color-mix(in srgb, var(--cv-accent) 18%, transparent) !important; }
.vp-iconbtn { transition: background-color 90ms ease, color 90ms ease; }
.vp-iconbtn:hover { background: var(--cv-glass-hi) !important; color: var(--cv-ink) !important; }
.vp-caret { transition: transform 110ms ease; display: inline-flex; }
.vp-menuitem:hover { background: var(--cv-glass-hi) !important; }
`;

/** Graph view — real Obsidian local graph look: small dots with the note
 * name beside them, thin straight edges, the open note as the bright
 * center dot. Unresolved links = hollow dots. */
function GraphView({ text, path, entries, onOpen }: {
  text: string;
  path: string;
  entries: string[];
  onOpen: (name: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const links = [...new Set(
    [...text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim()),
  )];
  const mdLinks = [...new Set(
    [...text.matchAll(/\[([^\]]+)\]\(([^)]+\.md)\)/g)].map((m) => m[2].trim()),
  )];
  const all = [...new Set([...links, ...mdLinks])];
  const resolve = (name: string) =>
    entries.find((e) => e === name || e.endsWith(`/${name}.md`) || e === `${name}.md` || e.replace(/\.md$/, "") === name);

  const W = 560, H = 520, cx = W / 2, cy = H / 2;
  const R = Math.min(210, 90 + all.length * 9);
  const sats = all.map((name, i) => {
    const a = (i / Math.max(1, all.length)) * Math.PI * 2 - Math.PI / 2;
    const wobble = ((i * 37) % 11) - 5;
    const r = R + wobble * 4;
    return { name, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, hit: resolve(name) };
  });

  if (all.length === 0) {
    return (
      <div style={{ flex: 1, display: "grid", placeItems: "center", fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)" }}>
        no links in this note — use [[note name]] to wire them
      </div>
    );
  }
  const label = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + "…" : s);
  const centerName = label(path.replace(/\.md$/, "").split("/").pop() ?? path, 24);
  return (
    <div style={{ flex: 1, overflow: "auto", position: "relative", background: "radial-gradient(ellipse at center, rgba(255,255,255,0.02), transparent 65%)" }}>
      <svg width={W} height={H} style={{ display: "block", margin: "0 auto" }}>
        {sats.map((s) => (
          <line
            key={`l-${s.name}`}
            x1={cx} y1={cy} x2={s.x} y2={s.y}
            stroke={hover === s.name ? "var(--cv-accent)" : "rgba(140,130,110,0.35)"}
            strokeWidth={hover === s.name ? 1.4 : 0.8}
          />
        ))}
        {sats.map((s) => (
          <g key={s.name} onClick={() => onOpen(s.name)} style={{ cursor: "pointer" }}
            onMouseEnter={() => setHover(s.name)} onMouseLeave={() => setHover(null)}>
            <circle
              cx={s.x} cy={s.y} r={hover === s.name ? 6 : 4.5}
              fill={s.hit ? (hover === s.name ? "var(--cv-accent)" : "#7f9e78") : "transparent"}
              stroke={s.hit ? "none" : "#7f9e78"}
              strokeDasharray={s.hit ? undefined : "2 2"}
            />
            <text
              x={s.x} y={s.y - 9}
              textAnchor="middle" fontSize={11}
              fill={hover === s.name ? "var(--cv-accent)" : "var(--cv-ink-dim)"}
            >
              {label(s.name.replace(/\.md$/, "").split("/").pop() ?? s.name, 22)}
            </text>
          </g>
        ))}
        <circle cx={cx} cy={cy} r={9} fill="var(--cv-accent)" />
        <circle cx={cx} cy={cy} r={14} fill="none" stroke="var(--cv-accent)" strokeOpacity={0.35} />
        <text x={cx} y={cy - 20} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--cv-ink)">
          {centerName}
        </text>
      </svg>
      <div style={{ position: "absolute", bottom: 8, left: 14, fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)" }}>
        {all.length} linked note{all.length === 1 ? "" : "s"} · hollow = not in vault yet
      </div>
    </div>
  );
}

/** Whole-vault graph — every note as a dot on a ring (grouped by folder),
 * every resolved [[link]] as a faint edge. Hover a node to light its
 * edges; click to open it. The open note glows amber. */
function GlobalGraph({ nodes, edges, current, onOpen }: {
  nodes: string[];
  edges: [string, string][];
  current: string;
  onOpen: (path: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const W = 640, H = 560, cx = W / 2, cy = H / 2;
  const R = Math.min(240, Math.max(120, nodes.length * 16));
  const pos = new Map<string, { x: number; y: number }>();
  nodes.forEach((n, i) => {
    const a = (i / Math.max(1, nodes.length)) * Math.PI * 2 - Math.PI / 2;
    const wobble = ((i * 29) % 13) - 6;
    pos.set(n, { x: cx + Math.cos(a) * (R + wobble * 3), y: cy + Math.sin(a) * (R + wobble * 3) });
  });
  const neighbors = hover ? new Set(edges.filter(([a, b]) => a === hover || b === hover).flat()) : null;
  const label = (s: string) => {
    const base = s.replace(/\.md$/, "").split("/").pop() ?? s;
    return base.length > 18 ? base.slice(0, 17) + "…" : base;
  };
  if (nodes.length === 0) {
    return <div style={{ flex: 1, display: "grid", placeItems: "center", fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)" }}>no notes in vault</div>;
  }
  return (
    <div style={{ flex: 1, overflow: "auto", position: "relative", background: "radial-gradient(ellipse at center, rgba(255,255,255,0.02), transparent 65%)" }}>
      <svg width={W} height={H} style={{ display: "block", margin: "0 auto" }}>
        {edges.map(([a, b], i) => {
          const pa = pos.get(a), pb = pos.get(b);
          if (!pa || !pb) return null;
          const hot = hover != null && (a === hover || b === hover);
          return <line key={i} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
            stroke={hot ? "var(--cv-accent)" : "rgba(140,130,110,0.22)"} strokeWidth={hot ? 1.3 : 0.7} />;
        })}
        {nodes.map((n) => {
          const p = pos.get(n)!;
          const isCur = n === current;
          const dim = neighbors != null && n !== hover && !neighbors.has(n);
          return (
            <g key={n} onClick={() => onOpen(n)} style={{ cursor: "pointer" }}
              onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(null)}>
              <circle cx={p.x} cy={p.y} r={isCur ? 8 : hover === n ? 6 : 4.5}
                fill={isCur ? "var(--cv-accent)" : hover === n ? "var(--cv-accent)" : "#7f9e78"}
                opacity={dim ? 0.3 : 1} />
              {isCur && <circle cx={p.x} cy={p.y} r={13} fill="none" stroke="var(--cv-accent)" strokeOpacity={0.35} />}
              <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize={11}
                fontWeight={isCur ? 700 : 400}
                fill={isCur || hover === n ? "var(--cv-accent)" : "var(--cv-ink-dim)"}
                opacity={dim ? 0.25 : 1}>
                {label(n)}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ position: "absolute", bottom: 8, left: 14, fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)" }}>
        {nodes.length} notes · {edges.length} links
      </div>
    </div>
  );
}


/** Obsidian-style file explorer tree — folders first with chevrons,
 * files indented by depth, like the real app's explorer pane. */
type TreeDir = { name: string; path: string; dirs: Map<string, TreeDir>; files: string[] };

function buildTree(entries: string[]): TreeDir {
  const root: TreeDir = { name: "", path: "", dirs: new Map(), files: [] };
  for (const e of entries) {
    const parts = e.split("/");
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts.slice(0, i + 1).join("/");
      if (!cur.dirs.has(parts[i])) cur.dirs.set(parts[i], { name: parts[i], path: p, dirs: new Map(), files: [] });
      cur = cur.dirs.get(parts[i])!;
    }
    cur.files.push(e);
  }
  return root;
}

function sortDir(d: TreeDir): TreeDir[] {
  return [...d.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const BOOKMARKS_KEY = "cv-vault-bookmarks";
const RECENT_KEY = "cv-vault-recent";
const COLLAPSED_KEY = "cv-vault-collapsed";

function FileTree({ entries, collapsed, toggle, vaultFile, onOpen, onPin, onBookmark, onDelete, onContext, armedDel, bookmarks, depth = 0 }: {
  entries: TreeDir;
  collapsed: Set<string>;
  toggle: (p: string) => void;
  vaultFile: { path: string } | null;
  onOpen: (p: string) => void;
  onPin: (p: string) => void;
  onBookmark: (p: string) => void;
  onDelete: (p: string) => void;
  armedDel: string | null;
  bookmarks: Set<string>;
  onContext: (path: string, x: number, y: number) => void;
  depth?: number;
}) {
  const pad = 4 + depth * 13;
  return (
    <>
      {sortDir(entries).map((d) => {
        const isCol = collapsed.has(d.path);
        return (
          <div key={d.path}>
            <button
              onClick={() => toggle(d.path)}
              className="vp-row"
              style={{
                display: "flex", alignItems: "center", gap: 3, width: "100%",
                textAlign: "left", border: "none", background: "transparent",
                color: "var(--cv-ink-dim)", fontSize: "var(--cv-text-xs)", padding: "3px 6px",
                paddingLeft: pad, cursor: "pointer", borderRadius: 5, fontWeight: 600,
              }}
            >
              <span
                className="vp-caret"
                style={{
                  width: 12, justifyContent: "center", flexShrink: 0,
                  transform: isCol ? "none" : "rotate(90deg)",
                  color: "var(--cv-ink-faint)",
                }}
              >
                <Icon name="ph-caret" size={8} />
              </span>
              <Icon name={isCol ? "ph-folder" : "ph-folder-open"} size={13} color="color-mix(in srgb, var(--cv-accent) 62%, var(--cv-ink-dim))" />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginLeft: 2 }}>{d.name}</span>
            </button>
            {!isCol && (
              <FileTree
                entries={d} collapsed={collapsed} toggle={toggle}
                vaultFile={vaultFile} onOpen={onOpen} onPin={onPin}
                onBookmark={onBookmark} onDelete={onDelete} onContext={onContext} armedDel={armedDel} bookmarks={bookmarks} depth={depth + 1}
              />
            )}
          </div>
        );
      })}
      {entries.files.sort((a, b) => a.localeCompare(b)).map((e) => (
        <button
          key={e}
          onClick={() => onOpen(e)}
          onContextMenu={(ev) => { ev.preventDefault(); ev.stopPropagation(); onContext(e, ev.clientX, ev.clientY); }}
          className={`vault-file vp-row${vaultFile?.path === e ? " vp-active" : ""}`}
          style={{
            display: "flex", alignItems: "center", gap: 4, width: "100%",
            textAlign: "left", border: "none",
            background: "transparent",
            color: vaultFile?.path === e ? "var(--cv-ink)" : "var(--cv-ink-dim)",
            fontSize: "var(--cv-text-xs)", padding: "3px 6px", paddingLeft: pad + 15,
            borderRadius: 5, cursor: "pointer",
          }}
        >
          <Icon
            name="ph-file"
            size={12}
            color={vaultFile?.path === e ? "var(--cv-accent)" : "var(--cv-ink-faint)"}
          />
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {e.split("/").pop()!.replace(/\.md$/, "")}
          </span>
          <span className="vault-file-actions" style={{ gap: 2 }}>
            <span
              role="button" title={bookmarks.has(e) ? "unbookmark" : "bookmark — pin to the top"}
              onClick={(ev) => { ev.stopPropagation(); onBookmark(e); }}
              style={{ color: bookmarks.has(e) ? "var(--cv-accent)" : "var(--cv-ink-faint)", cursor: "pointer", padding: "0 3px", fontSize: "var(--cv-text-xxs)" }}
            >
              ★
            </span>
            <span
              role="button" title="pin as live card on the board"
              onClick={(ev) => { ev.stopPropagation(); onPin(e); }}
              style={{ color: "var(--cv-ink-faint)", cursor: "pointer", padding: "0 3px" }}
            >
              ⌖
            </span>
            <span
              role="button"
              title={armedDel === e ? "click again to delete for real" : "delete this note (removes the real file)"}
              onClick={(ev) => { ev.stopPropagation(); onDelete(e); }}
              style={{ color: armedDel === e ? "#e07070" : "var(--cv-ink-faint)", cursor: "pointer", padding: "0 3px", fontSize: "var(--cv-text-xxs)", fontWeight: armedDel === e ? 700 : 400 }}
            >
              {armedDel === e ? "×?" : "×"}
            </span>
          </span>
        </button>
      ))}
    </>
  );
}

/** Editable raw markdown — like Obsidian's Source mode. Tracks local
 *  edits and saves the whole file back to the vault via vault_write. */
function SourceEditor({ path, text, onDraft }: { path: string; text: string; onDraft?: (v: string) => void }) {
  const vaultWrite = useBoard((st) => st.vaultWrite);
  const notify = useBoard((st) => st.notify);
  const entries = useBoard((st) => st.vaultEntries);
  const [draft, setDraft] = useState(text);
  const [saved, setSaved] = useState(text);
  const [suggest, setSuggest] = useState<{ query: string; start: number } | null>(null);
  const [sel, setSel] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setDraft(text); setSaved(text); setSuggest(null); }, [path, text]);
  const dirty = draft !== saved;

  const notes = useMemo(() => entries.filter((e) => e.endsWith(".md")).map((e) => e.replace(/\.md$/, "")), [entries]);
  const matches = suggest
    ? notes.filter((n) => n.toLowerCase().includes(suggest.query.toLowerCase())).slice(0, 8)
    : [];

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setDraft(v);
    onDraft?.(v);
    const pos = e.target.selectionStart;
    const m = v.slice(0, pos).match(/\[\[[^\]\n]*$/);
    setSuggest(m ? { query: m[0].slice(2), start: pos - m[0].length } : null);
    setSel(0);
  };

  const apply = (name: string) => {
    if (!suggest) return;
    const ta = taRef.current;
    const pos = ta?.selectionStart ?? draft.length;
    const caret = suggest.start + name.length + 4;
    setDraft(draft.slice(0, suggest.start) + `[[${name}]]` + draft.slice(pos));
    onDraft?.(draft.slice(0, suggest.start) + `[[${name}]]` + draft.slice(pos));
    setSuggest(null);
    requestAnimationFrame(() => { ta?.focus(); ta?.setSelectionRange(caret, caret); });
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, position: "relative" }}>
      <textarea
        ref={taRef}
        value={draft}
        onChange={onChange}
        onKeyDown={(e) => {
          if (suggest && matches.length > 0) {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % matches.length); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s - 1 + matches.length) % matches.length); return; }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); apply(matches[sel]); return; }
            if (e.key === "Escape") { e.preventDefault(); setSuggest(null); return; }
          }
          if ((e.metaKey || e.ctrlKey) && e.key === "s") {
            e.preventDefault();
            vaultWrite(path, draft);
            setSaved(draft);
            notify(`saved → ${path}`);
          }
        }}
        spellCheck={false}
        style={{
          flex: 1, minHeight: 0, overflow: "auto", margin: 0,
          padding: "10px 12px", borderRadius: 14, resize: "none",
          border: `1px solid ${dirty ? "rgba(255,196,66,.4)" : "var(--cv-glass-edge)"}`,
          background: "var(--cv-glass-hi)", color: "var(--cv-ink)",
          fontSize: "var(--cv-text-xxs)", fontFamily: "var(--cv-font-mono)",
          lineHeight: 1.55, whiteSpace: "pre-wrap", outline: "none",
        }}
      />
      {suggest && matches.length > 0 && (
        <div
          className="glass"
          style={{
            position: "absolute", bottom: 36, left: 0, right: 0, zIndex: 60,
            borderRadius: 10, overflow: "hidden",
            boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ padding: "4px 10px", fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)", borderBottom: "1px solid var(--cv-glass-edge)" }}>
            [[{suggest.query} — {matches.length} note{matches.length === 1 ? "" : "s"}
          </div>
          {matches.map((m, i) => (
            <div
              key={m}
              onMouseDown={(e) => { e.preventDefault(); apply(m); }}
              onMouseEnter={() => setSel(i)}
              style={{
                padding: "5px 10px", fontSize: "var(--cv-text-xxs)", cursor: "pointer",
                color: i === sel ? "var(--cv-ink)" : "var(--cv-ink-dim)",
                background: i === sel ? "color-mix(in srgb, var(--cv-accent) 18%, transparent)" : "transparent",
              }}
            >
              {m}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
        <button
          onClick={() => { vaultWrite(path, draft); setSaved(draft); notify(`saved → ${path}`); }}
          disabled={!dirty}
          style={{
            padding: "3px 12px", borderRadius: 10, fontSize: "var(--cv-text-xxs)", cursor: dirty ? "pointer" : "default",
            border: "1px solid var(--cv-glass-edge)",
            background: dirty ? "rgba(255,196,66,.2)" : "var(--cv-glass-hi)",
            color: dirty ? "var(--cv-amber)" : "var(--cv-ink-faint)",
          }}
        >
          {dirty ? "save to vault ⌘S" : "saved"}
        </button>
        {dirty && <span style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)" }}>unsaved changes</span>}
      </div>
    </div>
  );
}

/** Obsidian-style vault browser: point it at a vault directory and read
 * markdown notes in a side column. Reading/Source/Graph views, pin to
 * board, export to PDF (saved as an artifact). */
export function VaultPanel() {
  const vaultDir = useBoard((s) => s.vaultDir);
  const vaultEntries = useBoard((s) => s.vaultEntries);
  const vaultFile = useBoard((s) => s.vaultFile);
  const vaultList = useBoard((s) => s.vaultList);
  const vaultRead = useBoard((s) => s.vaultRead);
  const vaultPeek = useBoard((s) => s.vaultPeek);
  const vaultAsset = useBoard((s) => s.vaultAsset);
  const vaultAssets = useBoard((s) => s.vaultAssets);
  const mdContents = useBoard((s) => s.mdContents);
  const closeVaultFile = useBoard((s) => s.closeVaultFile);
  const vaultHits = useBoard((s) => s.vaultHits);
  const vaultSearch = useBoard((s) => s.vaultSearch);
  const vaultKnown = useBoard((s) => s.vaultKnown);
  const vaultDiscover = useBoard((s) => s.vaultDiscover);
  const vaultRegister = useBoard((s) => s.vaultRegister);
  const mdNodeAdd = useBoard((s) => s.mdNodeAdd);
  const vaultWrite = useBoard((s) => s.vaultWrite);
  const vaultDelete = useBoard((s) => s.vaultDelete);
  const vaultRename = useBoard((s) => s.vaultRename);
  const vaultGraph = useBoard((s) => s.vaultGraph);
  const vaultGraphReq = useBoard((s) => s.vaultGraphReq);
  const notify = useBoard((s) => s.notify);
  const [dir, setDir] = useState(vaultDir || "");
  const [filter, setFilter] = useState("");
  const activeVault = vaultKnown.find((v) => v.path === vaultDir);

  const [bookmarks, setBookmarks] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(BOOKMARKS_KEY) ?? "[]")); } catch { return new Set(); }
  });
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]")); } catch { return new Set(); }
  });
  const toggleCollapsed = (p: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      return next;
    });
  };
  const toggleBookmark = (p: string) => {
    setBookmarks((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([...next]));
      return next;
    });
  };
  // Recent files — Obsidian tracks what you opened; we keep the last 8.
  const [recent, setRecent] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); } catch { return []; }
  });
  useEffect(() => {
    const p = vaultFile?.path;
    if (!p) return;
    setRecent((prev) => {
      const next = [p, ...prev.filter((r) => r !== p)].slice(0, 8);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  }, [vaultFile?.path]);
  // Your vault, always mounted: reopen the last vault dir automatically.
  useEffect(() => {
    if (vaultDir) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem("cv-vault-dir"); } catch { saved = null; }
    if (saved) vaultList(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultDir]);

  // Debounced full-text search — filename filter stays instant, content
  // hits arrive via `vault_hits`.
  useEffect(() => {
    const q = filter.trim();
    if (q.length < 2 || !vaultDir) return;
    const t = setTimeout(() => vaultSearch(q), 250);
    return () => clearTimeout(t);
  }, [filter, vaultDir, vaultSearch]);
  const [view, setView] = useState<"reading" | "source" | "split" | "graph">("reading");
  // Keep the reading pane in sync with edits made in Obsidian itself. Pause
  // polling while Source/Split is active so an in-progress draft stays local.
  useEffect(() => {
    if (!vaultFile || view !== "reading") return;
    const timer = window.setInterval(() => vaultRead(vaultFile.path), 1800);
    return () => window.clearInterval(timer);
  }, [view, vaultFile?.path, vaultRead]);
  const [splitDraft, setSplitDraft] = useState<{ path: string; text: string } | null>(null);
  // A re-read that disagrees with the cached draft means the file changed
  // outside the editor (or a save roundtrip landed) — the draft is no
  // longer a safe preview source, drop it instead of showing stale text.
  const vaultText = useBoard((st) => st.vaultFile?.text);
  useEffect(() => {
    setSplitDraft((d) => (d && d.text !== vaultText ? null : d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultText]);
  const [genOpen, setGenOpen] = useState(false);
  const [newNote, setNewNote] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Switch-vault setup row — the path input only earns permanent space when
  // no vault is connected; otherwise it unfolds on demand from the ··· menu.
  const [switchOpen, setSwitchOpen] = useState(false);
  // The path input tracks the connected vault so "switch vault" opens with
  // the current folder pre-filled for editing.
  useEffect(() => { if (vaultDir) setDir(vaultDir); }, [vaultDir]);
  const [newName, setNewName] = useState("");
  const [armedDel, setArmedDel] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const [dropOn, setDropOn] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renName, setRenName] = useState("");
  const [graphScope, setGraphScope] = useState<"local" | "vault">("local");
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [backlinksOpen, setBacklinksOpen] = useState(false);
  const [imgView, setImgView] = useState<string | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);

  // Click in the tree: .md opens the reader, an image opens a lightbox.
  const openEntry = (e: string) => {
    if (IMAGE_RE.test(e)) { setImgView(e); vaultAsset(e); }
    else vaultRead(e);
  };

  // Backlinks — Obsidian's "Linked mentions": fetch the vault graph when a
  // note opens so the footer can list every note that links here.
  useEffect(() => { if (vaultFile) vaultGraphReq(); }, [vaultFile?.path]);
  const backlinks = useMemo(() => {
    if (!vaultFile || !vaultGraph) return [] as string[];
    return vaultGraph.edges.filter(([, t]) => t === vaultFile.path).map(([s]) => s);
  }, [vaultFile, vaultGraph]);

  // Unlinked mentions — Obsidian's second half of the backlinks panel:
  // notes that contain this note's title as plain text (no [[link]]).
  const noteTitle = vaultFile?.path.replace(/\.md$/, "").split("/").pop();
  useEffect(() => {
    if (backlinksOpen && noteTitle) vaultSearch(noteTitle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backlinksOpen, vaultFile?.path]);
  const unlinked = useMemo(() => {
    if (!backlinksOpen || !noteTitle) return [] as typeof vaultHits;
    return vaultHits.filter((h) => h.text.includes(noteTitle) && !h.text.includes(`[[${noteTitle}`));
  }, [vaultHits, noteTitle, backlinksOpen]);

  /** Headings of the open note for the Outline dropdown (Obsidian's Outline
   * panel): skips frontmatter and fenced code, keeps the line index used by
   * the `vh-<line>` ids ReadingView renders. */
  const headings = useMemo(() => {
    if (!vaultFile) return [] as { line: number; depth: number; title: string }[];
    const out: { line: number; depth: number; title: string }[] = [];
    let inCode = false;
    vaultFile.text.split("\n").forEach((l, i) => {
      if (/^\s*```/.test(l)) { inCode = !inCode; return; }
      if (inCode) return;
      const m = l.match(/^(#{1,6})\s+(.*)/);
      if (m) out.push({ line: i, depth: m[1].length, title: m[2].replace(/[*_~=`[\]]/g, "") });
    });
    return out;
  }, [vaultFile]);

  // After opening a note via [[note#heading]], scroll to that heading
  // once its content (and thus the vh-<line> anchors) is rendered.
  useEffect(() => {
    if (!pendingAnchor || !vaultFile) return;
    const h = headings.find((x) => x.title.trim().toLowerCase() === pendingAnchor);
    if (h) document.getElementById(`vh-${h.line}`)?.scrollIntoView({ block: "start" });
    setPendingAnchor(null);
  }, [vaultFile?.path, pendingAnchor, headings]);

  const openDaily = () => {
    if (!vaultDir) { notify("open a vault first"); return; }
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const path = `Daily/${stamp}.md`;
    if (vaultEntries.includes(path)) {
      vaultRead(path);
    } else {
      vaultWrite(path, `# ${stamp}\n\n`);
      setTimeout(() => vaultList(vaultDir), 150);
      notify(`daily note → ${path}`);
    }
  };

  const createNote = () => {
    const name = newName.trim().replace(/\.md$/i, "").replace(/[\\:*?"<>|]/g, "-");
    if (!name || !vaultDir) return;
    vaultWrite(`${name}.md`, `# ${name.split("/").pop()}\n`);
    setTimeout(() => vaultList(vaultDir), 150);
    setNewNote(false); setNewName("");
    notify(`created ${name}.md`);
  };

  const onDeleteFile = (p: string) => {
    if (armedDel === p) {
      vaultDelete(p);
      setArmedDel(null);
      if (vaultFile?.path === p) closeVaultFile();
      notify(`deleted ${p}`);
    } else {
      setArmedDel(p);
      setTimeout(() => setArmedDel((c) => (c === p ? null : c)), 2500);
    }
  };

  const shown = vaultEntries.filter((e) =>
    e.toLowerCase().includes(filter.toLowerCase()),
  );
  const tree = buildTree(filter ? shown : vaultEntries);
  const vaultName = activeVault?.name ?? vaultDir.replace(/\/+$/, "").split("/").pop() ?? "vault";
  const pinCurrentNote = () => {
    if (!vaultFile) return;
    const state = useBoard.getState();
    const viewport = state.viewportRect;
    const position = viewport
      ? { x: viewport.left + (viewport.right - viewport.left) * 0.34, y: viewport.top + (viewport.bottom - viewport.top) * 0.24 }
      : undefined;
    mdNodeAdd(vaultFile.path, undefined, position);
    state.closePanelNode("panel-vault");
    state.requestNav("canvas");
    state.requestView();
    notify("Added the live note window to the board.");
  };
  const openByName = (name: string) => {
    // [[note#heading]] — Obsidian opens the note and scrolls to the heading.
    const [base, ...rest] = name.split("#");
    const anchor = rest.join("#").trim().toLowerCase();
    const hit = resolveNotePath(vaultEntries, base.trim());
    if (hit) {
      vaultRead(hit);
      if (anchor) setPendingAnchor(anchor);
    }
  };

  // Embed resolution for ![[note]] / ![[img.png]] transclusion:
  // name → {path, cached text}. Images resolve by exact filename like Obsidian.
  const resolveEmbed = (name: string) => {
    const isImg = IMAGE_RE.test(name);
    const hit = vaultEntries.find((e) =>
      e === name || e.endsWith(`/${name}`) ||
      (!isImg && (e === `${name}.md` || e.endsWith(`/${name}.md`) || e.replace(/\.md$/, "") === name)),
    );
    return hit ? { path: hit, text: mdContents[hit] } : null;
  };

  const exportFile = () => {
    if (!vaultFile) return;
    const title = vaultFile.path.replace(/\.md$/, "").split("/").pop() ?? "note";
    downloadPdf(title, vaultFile.text);
    useBoard.getState().artifactCreate("pdf", `PDF — ${title}`, vaultFile.path, vaultFile.text);
  };

  const generate = (kind: "overview" | "onboarding" | "architecture") => {
    const { title, md } = buildDoc(kind);
    downloadPdf(title, md);
    useBoard.getState().artifactCreate("pdf", `PDF — ${title}`, undefined, md);
    setGenOpen(false);
  };

  const askAnything = (q: string) => {
    const { title, md } = buildAskDoc(q);
    downloadPdf(title, md);
    useBoard.getState().artifactCreate("pdf", `PDF — ${title}`, undefined, md);
    setGenOpen(false);
  };

  return (
    <div style={{ ...panelRoot, flexDirection: "row" }}>
      <div
        data-panel="vault-explorer"
        style={{
          width: "36%",
          minWidth: 170,
          flexShrink: 0,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "10px 6px 8px",
          // no overflow hidden here — the tree scrollbox clips itself, and
          // the header dropdowns must be free to overlap the reader pane
          // (a narrower clip would cut their text off mid-row).
          borderRight: "1px solid var(--cv-glass-edge)",
        }}
      >
      <style>{VAULT_EXPLORER_CSS}</style>
      {/* Explorer header — the vault's name plus one compact row of icon
          actions, Obsidian-style. The actions group is a single flex item
          inside a wrapping row: when the column gets too narrow the whole
          group drops to a second row — buttons never overlap the name.
          The dropdowns anchor to this wrapper's bottom edge (whatever the
          wrap state) and open rightward over the reader pane, the way a
          menu is meant to overlap — the column itself must not clip them. */}
      <div style={{ position: "relative", flexShrink: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 2, rowGap: 3, padding: "0 2px 7px" }}>
        <span
          title={vaultDir ? vaultDir : undefined}
          style={{
            flex: "1 1 56px", minWidth: 0,
            fontSize: "var(--cv-text-xs)", fontWeight: 700, letterSpacing: 0.2,
            color: "var(--cv-ink)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            padding: "2px 2px",
          }}
        >
          {vaultDir ? vaultName : "Vault"}
        </span>
        <div style={{ flex: "0 0 auto", marginLeft: "auto", display: "flex", alignItems: "center", gap: 1 }}>
          {vaultDir && (
            <IconBtn icon="ph-calendar" label="open today's daily note (creates Daily/YYYY-MM-DD.md)" text="today" size={13} onClick={openDaily} />
          )}
          {vaultDir && (
            <IconBtn
              icon="ph-file-plus"
              label="new note in this vault"
              text="+ note"
              size={14}
              active={newNote}
              onClick={() => { setNewNote((o) => !o); setGenOpen(false); setMoreOpen(false); }}
            />
          )}
          <IconBtn
            icon="ph-file-pdf"
            label="Generate a PDF document from the board"
            text="PDF"
            size={14}
            active={genOpen}
            onClick={() => { setGenOpen((o) => !o); setNewNote(false); setMoreOpen(false); }}
          />
          {vaultDir && (
            <IconBtn
              icon="ph-dots"
              label="vault menu — switch vault, more actions"
              text="···"
              size={14}
              active={moreOpen}
              onClick={() => { setMoreOpen((o) => !o); setGenOpen(false); setNewNote(false); }}
            />
          )}
        </div>
      </div>
      {(genOpen || newNote || moreOpen) && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 45 }}
          onClick={() => { setGenOpen(false); setNewNote(false); setMoreOpen(false); }}
          onContextMenu={(e) => e.preventDefault()}
        />
      )}
      {genOpen && (
        <div className="cv-menu" style={{ position: "absolute", left: 2, top: "calc(100% - 4px)", width: 240, padding: 8, zIndex: 50 }}>
          <GeneratePdfMenu onPick={generate} onAsk={askAnything} />
        </div>
      )}
      {newNote && (
        <form
          className="cv-menu"
          style={{ position: "absolute", left: 2, top: "calc(100% - 4px)", width: 224, padding: 8, zIndex: 50, display: "flex", gap: 6 }}
          onSubmit={(e) => { e.preventDefault(); createNote(); }}
        >
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="folder/note name"
            style={{ flex: 1, minWidth: 0, background: "var(--cv-glass-hi)", border: "1px solid var(--cv-glass-edge)", borderRadius: 8, padding: "5px 9px", fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink)", outline: "none" }}
          />
          <button type="submit" style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-accent)", background: "none", border: "none", cursor: "pointer" }}>create</button>
        </form>
      )}
      {moreOpen && (
        <div className="cv-menu" style={{ position: "absolute", left: 2, top: "calc(100% - 4px)", width: 216, padding: 5, zIndex: 50 }}>
          {[
            {
              label: switchOpen ? "Close vault switcher" : "Switch vault…",
              fn: () => { setSwitchOpen((o) => !o); setMoreOpen(false); },
            },
            ...(vaultDir && !activeVault
              ? [{ label: "Register in Obsidian's vault list", fn: () => { vaultRegister(vaultDir); notify("registered in Obsidian's vault list"); setMoreOpen(false); } }]
              : []),
            {
              label: "Detect vaults on this machine",
              fn: () => { vaultDiscover(); setSwitchOpen(true); setMoreOpen(false); },
            },
          ].map((it) => (
            <button
              key={it.label}
              onClick={it.fn}
              className="vp-menuitem"
              style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", color: "var(--cv-ink)", fontSize: "var(--cv-text-xs)", padding: "6px 10px", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap" }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
      </div>
      {/* Vault setup — the path bar only earns permanent space while no
          vault is connected. With a live vault it unfolds on demand from
          the ··· menu's "Switch vault…". */}
      {(!vaultDir || switchOpen) && (
        <form
          style={{ display: "flex", alignItems: "center", gap: 5, margin: "0 2px 7px" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (dir.trim()) {
              vaultList(dir.trim());
              setSwitchOpen(false);
            }
          }}
        >
          <input
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            placeholder="/path/to/vault"
            style={{ flex: 1, minWidth: 0, background: "var(--cv-glass-hi)", border: "1px solid var(--cv-glass-edge)", borderRadius: 999, padding: "5px 11px", fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink)", outline: "none", fontFamily: "var(--cv-font-mono)" }}
          />
          <button className="cv-mini-btn" style={{ padding: "4px 11px", color: "var(--cv-accent)", flexShrink: 0 }} type="submit">
            open
          </button>
          <button
            type="button"
            title="detect vaults the real Obsidian app registered on this machine"
            onClick={vaultDiscover}
            style={{ display: "inline-flex", alignItems: "center", background: "none", border: "none", color: "var(--cv-ink-faint)", cursor: "pointer", padding: 2, flexShrink: 0 }}
          >
            <Icon name="ph-refresh" size={13} />
          </button>
        </form>
      )}
      {vaultKnown.length > 0 && (!vaultDir || switchOpen) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "0 2px 7px" }}>
          {vaultKnown.map((v) => (
            <button
              key={v.path}
              title={`${v.path} — registered Obsidian vault`}
              onClick={() => { setDir(v.path); vaultList(v.path); setSwitchOpen(false); }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                background: v.path === vaultDir ? "color-mix(in srgb, var(--cv-accent) 22%, transparent)" : "var(--cv-glass-hi)",
                border: "1px solid var(--cv-glass-edge)", borderRadius: 999,
                padding: "3px 9px", fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink)", cursor: "pointer",
              }}
            >
              <img src="/obsidian.svg" alt="" width={10} height={10} /> {v.name}
            </button>
          ))}
        </div>
      )}
      {vaultEntries.length > 0 && (
        <div style={{ position: "relative", margin: "0 2px 7px" }}>
          <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--cv-ink-faint)", pointerEvents: "none", display: "inline-flex" }}>
            <Icon name="ph-search" size={11} />
          </span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`${vaultEntries.length} notes — filter or search inside…`}
            style={{ width: "100%", boxSizing: "border-box", background: "var(--cv-glass-hi)", border: "1px solid var(--cv-glass-edge)", borderRadius: 999, padding: "5px 12px 5px 26px", fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink)", outline: "none" }}
          />
        </div>
      )}
      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setDropOn(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropOn(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDropOn(false);
          const files = Array.from(e.dataTransfer.files ?? []);
          if (!files.length) return;
          const vaultWriteAsset = useBoard.getState().vaultWriteAsset;
          // Capture the destination now — reading it inside the FileReader
          // callback would follow a vault switch mid-read.
          const dropDir = useBoard.getState().vaultDir;
          for (const f of files) {
            // ws mode caps a message at 8 MiB → 5 MiB file ≈ 6.7 MiB base64.
            // The desktop shell has no socket: it takes the full 8 MiB.
            const cap = isTauri() ? 8 : 5;
            if (f.size > cap * 1024 * 1024) {
              notify(`skipped ${f.name} — over the ${cap} MB vault limit`);
              continue;
            }
            const rd = new FileReader();
            rd.onload = () => {
              const b64 = String(rd.result ?? "").split(",")[1] ?? "";
              if (b64) vaultWriteAsset(f.name, b64, dropDir);
            };
            rd.readAsDataURL(f);
          }
        }}
        style={{ flex: 1, overflowY: "auto", outline: dropOn ? "1.5px dashed var(--cv-accent)" : "none", outlineOffset: -4, borderRadius: 8 }}
      >
        {bookmarks.size > 0 && !filter && (
          <>
            <div style={{ fontSize: "var(--cv-text-xxs)", fontWeight: 400, letterSpacing: "0.02em", color: "var(--cv-ink-faint)", padding: "2px 8px 4px" }}>
              Bookmarks
            </div>
            {[...bookmarks].filter((b) => vaultEntries.includes(b)).map((e) => (
              <button
                key={`bm-${e}`}
                onClick={() => vaultRead(e)}
                className={`vp-row${vaultFile?.path === e ? " vp-active" : ""}`}
                style={{
                  display: "flex", alignItems: "center", gap: 4, width: "100%",
                  textAlign: "left", border: "none",
                  background: "transparent",
                  color: vaultFile?.path === e ? "var(--cv-ink)" : "var(--cv-ink-dim)",
                  fontSize: "var(--cv-text-xs)", padding: "3px 6px", paddingLeft: 19, borderRadius: 5, cursor: "pointer",
                }}
              >
                <Icon name="ph-file" size={12} color={vaultFile?.path === e ? "var(--cv-accent)" : "var(--cv-ink-faint)"} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.split("/").pop()!.replace(/\.md$/, "")}
                </span>
                <span
                  role="button" title="unbookmark"
                  onClick={(ev) => { ev.stopPropagation(); toggleBookmark(e); }}
                  style={{ color: "var(--cv-accent)", cursor: "pointer", fontSize: "var(--cv-text-xxs)" }}
                >
                  ★
                </span>
              </button>
            ))}
          </>
        )}
        {recent.length > 0 && !filter && (
          <>
            <div style={{ fontSize: "var(--cv-text-xxs)", fontWeight: 400, letterSpacing: "0.02em", color: "var(--cv-ink-faint)", padding: "2px 8px 4px" }}>
              Recent
            </div>
            {recent.filter((r) => vaultEntries.includes(r) && !bookmarks.has(r)).slice(0, 5).map((e) => (
              <button
                key={`rc-${e}`}
                onClick={() => vaultRead(e)}
                className={`vp-row${vaultFile?.path === e ? " vp-active" : ""}`}
                style={{
                  display: "flex", alignItems: "center", gap: 4, width: "100%",
                  textAlign: "left", border: "none",
                  background: "transparent",
                  color: vaultFile?.path === e ? "var(--cv-ink)" : "var(--cv-ink-dim)",
                  fontSize: "var(--cv-text-xs)", padding: "3px 6px", paddingLeft: 19, borderRadius: 5, cursor: "pointer",
                }}
              >
                <Icon name="ph-file" size={12} color={vaultFile?.path === e ? "var(--cv-accent)" : "var(--cv-ink-faint)"} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.split("/").pop()!.replace(/\.md$/, "")}
                </span>
              </button>
            ))}
          </>
        )}
        {(bookmarks.size > 0 || recent.length > 0) && !filter && (
          <div style={{ fontSize: "var(--cv-text-xxs)", fontWeight: 400, letterSpacing: "0.02em", color: "var(--cv-ink-faint)", padding: "8px 10px 4px" }}>
            Files
          </div>
        )}
        {filter.trim().length >= 2 && vaultHits.length > 0 && (
          <>
            <div style={{ fontSize: "var(--cv-text-xxs)", fontWeight: 400, letterSpacing: "0.02em", color: "var(--cv-ink-faint)", padding: "10px 12px 4px" }}>
              Content matches
            </div>
            {vaultHits.map((h, i) => (
              <button
                key={`${h.path}:${h.line}:${i}`}
                onClick={() => vaultRead(h.path)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  background: "transparent",
                  padding: "5px 12px",
                  cursor: "pointer",
                  borderRadius: 8,
                }}
                title={`${h.path}:${h.line}`}
              >
                <div style={{ fontSize: "var(--cv-text-xxs)", fontWeight: 600, color: "var(--cv-accent)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {h.path}:{h.line}
                </div>
                <div style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {h.text}
                </div>
              </button>
            ))}
            <div style={{ fontSize: "var(--cv-text-xxs)", fontWeight: 400, letterSpacing: "0.02em", color: "var(--cv-ink-faint)", padding: "10px 12px 4px" }}>
              Files
            </div>
          </>
        )}
        <FileTree
          entries={tree}
          collapsed={collapsed}
          toggle={toggleCollapsed}
          vaultFile={vaultFile}
          onOpen={openEntry}
          onPin={(e) => useBoard.getState().mdNodeAdd(e)}
          onBookmark={toggleBookmark}
          onDelete={onDeleteFile}
          onContext={(p, x, y) => { setCtxMenu({ path: p, x, y }); setArmedDel(null); }}
          armedDel={armedDel}
          bookmarks={bookmarks}
        />
        {shown.length === 0 && vaultDir && vaultEntries.length === 0 && (
          <EmptyState
            compact
            icon="notes"
            title="This vault is empty"
            actions={[{
              label: "+ new note",
              accent: true,
              title: "create the first note in this vault",
              onClick: () => { setNewNote(true); setGenOpen(false); setMoreOpen(false); },
            }]}
          >
            Write the first note, or drop markdown files here — they land straight in the vault.
          </EmptyState>
        )}
        {shown.length === 0 && vaultDir && vaultEntries.length > 0 && (
          <EmptyState compact icon="search" title="No notes match">
            Nothing in titles or contents — try fewer letters.
          </EmptyState>
        )}
        {!vaultDir && (
          <EmptyState
            compact
            icon="vault"
            title="No vault open"
          >
            Point the explorer at a folder of markdown notes above — read, edit, link and pin them without leaving the board.
          </EmptyState>
        )}
      </div>
      </div>
      {vaultFile ? (
        <div
          data-panel="vault"
          style={{
            position: "relative",
            flex: 1,
            minWidth: 0,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            padding: "14px 16px 10px",
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
            {renaming ? (
              <input
                autoFocus
                value={renName}
                onChange={(e) => setRenName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setRenaming(false);
                  if (e.key === "Enter") {
                    const name = renName.trim().replace(/\.md$/i, "").replace(/[\\:*?"<>|]/g, "-");
                    if (name && `${name}.md` !== vaultFile.path) {
                      vaultRename(vaultFile.path, `${name}.md`);
                      notify(`renamed → ${name}.md`);
                    }
                    setRenaming(false);
                  }
                }}
                onBlur={() => setRenaming(false)}
                style={{ fontSize: "var(--cv-text-xxs)", fontWeight: 500, color: "var(--cv-ink)", background: "var(--cv-ink-fill-active)", border: "1px solid color-mix(in srgb, var(--cv-accent) 40%, transparent)", borderRadius: 5, padding: "1px 6px", outline: "none", minWidth: 140 }}
              />
            ) : (
              <span
                title="click to rename / move (use folder/name)"
                onClick={() => { setRenName(vaultFile.path.replace(/\.md$/, "")); setRenaming(true); }}
                style={{ fontSize: "var(--cv-text-xxs)", fontWeight: 500, color: "var(--cv-ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "text" }}
              >
                {vaultFile.path.replace(/\.md$/, "").split("/").join(" › ")}
              </span>
            )}
            <div style={{ display: "flex", gap: 5, alignItems: "center", flexShrink: 0 }}>
              <button className="vault-board-action cv-mini-btn" style={actionBtn} title="Pin this live note as a resizable window on the board" onClick={pinCurrentNote}>
                Add to Board
              </button>
              <button
                className="cv-mini-btn"
                style={actionBtn}
                title="Spawn a Claude agent whose first instruction is this note"
                onClick={() => {
                  const title = vaultFile.path.replace(/\.md$/, "").split("/").pop() ?? "note";
                  const brief = `Work from this vault note (${vaultFile.path}):\n\n${vaultFile.text}`;
                  useBoard.getState().spawn(`task-${title.toLowerCase().replace(/[^\w-]+/g, "-").slice(0, 24)}`, "claude", undefined, undefined, undefined, brief);
                  useBoard.getState().notify(`spawned agent from "${title}"`);
                }}
              >
                ▶ task
              </button>
              <button className="cv-mini-btn" style={actionBtn} title="Export as PDF (saved to artifacts)" onClick={exportFile}>
                <Icon name="ph-export" size={11} /> Export PDF
              </button>
              <button style={{ border: "none", background: "none", color: "var(--cv-ink-dim)", cursor: "pointer", fontSize: "var(--cv-text-md)" }} onClick={closeVaultFile}>
                ×
              </button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            <button style={tabBtn(view === "reading")} onClick={() => setView("reading")}>Reading</button>
            <button style={tabBtn(view === "source")} onClick={() => setView("source")}>Source</button>
            <button style={tabBtn(view === "split")} onClick={() => setView("split")}>Split</button>
            <button style={tabBtn(view === "graph")} onClick={() => setView("graph")}>Graph</button>
            {view === "graph" && (
              <>
                <span style={{ width: 1, background: "var(--cv-glass-edge)", margin: "2px 2px" }} />
                <button style={tabBtn(graphScope === "local")} onClick={() => setGraphScope("local")}>note</button>
                <button
                  style={tabBtn(graphScope === "vault")}
                  title="whole-vault graph — every note and every [[link]] between them"
                  onClick={() => { setGraphScope("vault"); vaultGraphReq(); }}
                >
                  vault
                </button>
              </>
            )}
            {view === "reading" && headings.length > 0 && (
              <>
                <span style={{ width: 1, background: "var(--cv-glass-edge)", margin: "2px 2px" }} />
                <div style={{ position: "relative" }}>
                  <button
                    style={tabBtn(outlineOpen)}
                    title="Outline — jump to a heading (Obsidian's Outline panel)"
                    onClick={() => setOutlineOpen((o) => !o)}
                  >
                    outline
                  </button>
                  {outlineOpen && (
                    <div
                      className="glass"
                      style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 40, minWidth: 190, maxWidth: 280, maxHeight: 300, overflow: "auto", borderRadius: 8, padding: 5 }}
                    >
                      {headings.map((h) => (
                        <button
                          key={h.line}
                          onClick={() => {
                            document.getElementById(`vh-${h.line}`)?.scrollIntoView({ block: "start" });
                            setOutlineOpen(false);
                          }}
                          style={{
                            display: "block", width: "100%", textAlign: "left",
                            background: "none", border: "none", cursor: "pointer",
                            color: h.depth === 1 ? "var(--cv-ink)" : "var(--cv-ink-dim)",
                            fontSize: "var(--cv-text-xxs)", fontWeight: h.depth <= 2 ? 600 : 400,
                            padding: `4px 8px 4px ${8 + (h.depth - 1) * 10}px`,
                            borderRadius: 5,
                          }}
                        >
                          {h.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          {view === "reading" && (
            <ReadingView
              text={vaultFile.text}
              onLink={openByName}
              onTag={(t) => setFilter(t)}
              embedLookup={resolveEmbed}
              embedFetch={vaultPeek}
              embedAsset={(p) => vaultAssets[p]}
              embedAssetFetch={vaultAsset}
              onToggleTask={(ln, done) => {
                const ls = vaultFile.text.split("\n");
                ls[ln] = ls[ln].replace(/- \[[ xX]\]/, done ? "- [x]" : "- [ ]");
                vaultWrite(vaultFile.path, ls.join("\n"));
              }}
            />
          )}
          {(view === "source" || view === "split") && (
            /* ONE editor instance across both tabs — switching Source ↔ Split
               never unmounts it, so unsaved edits survive the switch.
               In Split the preview tracks the in-memory draft via onDraft. */
            <div style={{ flex: 1, display: "flex", minHeight: 0, gap: 8 }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
                <SourceEditor path={vaultFile.path} text={vaultFile.text} onDraft={(v) => setSplitDraft({ path: vaultFile.path, text: v })} />
              </div>
              {view === "split" && (
                <div style={{ flex: 1, minWidth: 0, overflowY: "auto", borderLeft: "1px solid var(--cv-glass-edge)", paddingLeft: 8 }}>
                  <ReadingView
                    text={splitDraft?.path === vaultFile.path ? splitDraft.text : vaultFile.text}
                    onLink={openByName}
                    onTag={(t) => setFilter(t)}
                    embedLookup={resolveEmbed}
                    embedFetch={vaultPeek}
                    embedAsset={(p) => vaultAssets[p]}
                    embedAssetFetch={vaultAsset}
                  />
                </div>
              )}
            </div>
          )}
          {view === "graph" && graphScope === "local" && (
            <GraphView
              text={vaultFile.text}
              path={vaultFile.path}
              entries={vaultEntries}
              onOpen={openByName}
            />
          )}
          {view === "graph" && graphScope === "vault" && (
            vaultGraph ? (
              <GlobalGraph
                nodes={vaultGraph.nodes}
                edges={vaultGraph.edges}
                current={vaultFile.path}
                onOpen={vaultRead}
              />
            ) : (
              <div style={{ flex: 1, display: "grid", placeItems: "center", fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)" }}>
                building graph…
              </div>
            )
          )}
          {backlinksOpen && (
            <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px solid var(--cv-glass-edge)" }}>
              <div style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)", marginBottom: 3 }}>Linked mentions</div>
              {backlinks.length === 0 && <div style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-dim)", fontStyle: "italic" }}>no notes link here</div>}
              {backlinks.map((b) => (
                <button
                  key={b}
                  onClick={() => vaultRead(b)}
                  style={{ display: "block", background: "none", border: "none", cursor: "pointer", padding: "2px 0", fontSize: "var(--cv-text-xxs)", color: "var(--cv-accent)", textDecoration: "underline", textDecorationColor: "color-mix(in srgb, var(--cv-accent) 55%, transparent)", textUnderlineOffset: 2 }}
                >
                  {b.replace(/\.md$/, "")}
                </button>
              ))}
              <div style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)", margin: "8px 0 3px" }}>Unlinked mentions</div>
              {unlinked.length === 0 && <div style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-dim)", fontStyle: "italic" }}>none</div>}
              {unlinked.map((h, i) => (
                <button
                  key={`${h.path}:${h.line}:${i}`}
                  onClick={() => vaultRead(h.path)}
                  title={`${h.path}:${h.line}`}
                  style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "3px 0" }}
                >
                  <div style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-accent)", textDecoration: "underline", textDecorationColor: "color-mix(in srgb, var(--cv-accent) 55%, transparent)", textUnderlineOffset: 2 }}>
                    {h.path.replace(/\.md$/, "")}:{h.line}
                  </div>
                  <div style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.text}</div>
                </button>
              ))}
            </div>
          )}
          <div style={{
            marginTop: 8, paddingTop: 6, borderTop: "1px solid var(--cv-glass-edge)",
            display: "flex", gap: 14, fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)",
          }}>
            <span
              onClick={() => setBacklinksOpen((o) => !o)}
              title="Linked mentions — notes that link to this one"
              style={{ cursor: "pointer", color: backlinks.length ? "var(--cv-accent)" : undefined }}
            >
              {backlinks.length} backlinks
            </span>
            <span>{[...vaultFile.text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].length} links</span>
            <span>{vaultFile.text.split(/\s+/).filter(Boolean).length} words</span>
            <span>{vaultFile.text.length.toLocaleString()} characters</span>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <EmptyState icon="ph-file" title="No note open">
            Pick a note from the explorer — or open today's daily note.
          </EmptyState>
        </div>
      )}
      {ctxMenu && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 90 }}
            onClick={() => { setCtxMenu(null); setArmedDel(null); }}
            onContextMenu={(ev) => ev.preventDefault()}
          />
          <div style={{
            position: "fixed", left: Math.min(ctxMenu.x, window.innerWidth - 190), top: Math.min(ctxMenu.y, window.innerHeight - 200),
            zIndex: 95, minWidth: 160, padding: 4, borderRadius: 10,
            background: "var(--cv-glass-bg, rgba(24,24,30,0.92))", border: "1px solid var(--cv-glass-edge)",
            backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
            boxShadow: "0 8px 28px rgba(0,0,0,0.45)", fontSize: "var(--cv-text-xs)",
          }}>
            <div style={{ padding: "4px 10px 6px", fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)", borderBottom: "1px solid var(--cv-glass-edge)", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {ctxMenu.path}
            </div>
            {[
              { label: IMAGE_RE.test(ctxMenu.path) ? "Open image" : "Open note", fn: () => openEntry(ctxMenu.path) },
              { label: "Pin to board", fn: () => useBoard.getState().mdNodeAdd(ctxMenu.path) },
              { label: "Run as task", fn: () => {
                const title = ctxMenu.path.replace(/\.md$/, "").split("/").pop() ?? "note";
                const abs = `${vaultDir.replace(/\/+$/, "")}/${ctxMenu.path}`;
                useBoard.getState().spawn(
                  `task-${title.toLowerCase().replace(/[^\w-]+/g, "-").slice(0, 24)}`,
                  "claude", undefined, undefined, undefined,
                  `Work from this vault note: ${abs} — read the file first, then act on it.`,
                );
                notify(`spawned agent from "${title}"`);
              } },
              { label: bookmarks.has(ctxMenu.path) ? "Remove bookmark" : "Bookmark", fn: () => toggleBookmark(ctxMenu.path) },
              { label: "Copy wikilink", fn: () => { const n = ctxMenu.path.replace(/\.md$/, "").split("/").pop()!; void navigator.clipboard?.writeText(`[[${n}]]`).catch(() => {}); notify(`[[${n}]] copied`); } },
            ].map((it) => (
              <button
                key={it.label}
                onClick={() => { it.fn(); setCtxMenu(null); }}
                className="vault-ctx-item"
                style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", color: "var(--cv-ink)", fontSize: "var(--cv-text-xs)", padding: "5px 10px", borderRadius: 6, cursor: "pointer" }}
              >
                {it.label}
              </button>
            ))}
            <button
              onClick={() => { onDeleteFile(ctxMenu.path); if (armedDel === ctxMenu.path) { setCtxMenu(null); setArmedDel(null); } }}
              className="vault-ctx-item"
              style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", color: armedDel === ctxMenu.path ? "#e07070" : "var(--cv-ink-dim)", fontSize: "var(--cv-text-xs)", padding: "5px 10px", borderRadius: 6, cursor: "pointer" }}
            >
              {armedDel === ctxMenu.path ? "Confirm delete → .trash" : "Move to .trash"}
            </button>
          </div>
        </>
      )}
      {imgView && (
        <div
          onClick={() => setImgView(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center",
            background: "rgba(0,0,0,0.72)", cursor: "zoom-out",
          }}
        >
          <div
            className="glass"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "80vw", maxHeight: "80vh", padding: 14, borderRadius: 14, cursor: "default" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-dim)" }}>{imgView}</span>
              <button style={{ border: "none", background: "none", color: "var(--cv-ink-dim)", cursor: "pointer", fontSize: "var(--cv-text-md)" }} onClick={() => setImgView(null)}>×</button>
            </div>
            {vaultAssets[imgView] ? (
              <img src={vaultAssets[imgView]} alt={imgView} style={{ maxWidth: "76vw", maxHeight: "70vh", borderRadius: 8, display: "block" }} />
            ) : (
              <div style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)", fontStyle: "italic", padding: 20 }}>loading image…</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
