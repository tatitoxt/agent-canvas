import { useEffect, useState } from "react";
import { useBoard } from "../store/board";
import { downloadPdf } from "../lib/pdf";
import { buildDoc, buildAskDoc } from "../lib/boardDocs";
import { Icon } from "./icons";

const tabBtn = (on: boolean): React.CSSProperties => ({
  border: "none",
  background: on ? "var(--cv-glass-hi)" : "transparent",
  color: on ? "var(--cv-accent)" : "var(--cv-ink-dim)",
  fontSize: 10.5,
  fontWeight: 600,
  padding: "4px 10px",
  borderRadius: 8,
  cursor: "pointer",
});

const actionBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  border: "1px solid var(--cv-glass-edge)",
  background: "var(--cv-glass-hi)",
  color: "var(--cv-ink)",
  fontSize: 10.5,
  fontWeight: 600,
  padding: "4px 10px",
  borderRadius: 999,
  cursor: "pointer",
};

/** Inline markdown → Obsidian-style runs: **bold**, `code`, [[wiki links]]
 * (clickable, amber like real Obsidian) and [md](url) links. */
function mdInline(text: string, onLink?: (name: string) => void): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\[\[[^\]|]+(?:\|[^\]]*)?\]\]|\[[^\]]+\]\([^)]*\)|\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, k = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("[[")) {
      const inner = t.slice(2, -2);
      const name = inner.split("|")[0].trim();
      const shown = inner.includes("|") ? inner.split("|")[1] : name;
      out.push(
        <a key={k++} onClick={() => onLink?.(name)} title={name}
          style={{ color: "var(--cv-accent)", cursor: "pointer", textDecoration: "none", borderBottom: "1px solid color-mix(in srgb, var(--cv-accent) 45%, transparent)" }}>
          {shown}
        </a>,
      );
    } else if (t.startsWith("[")) {
      const mm = t.match(/\[([^\]]+)\]\(([^)]*)\)/)!;
      const href = mm[2];
      if (/\.md$/.test(href)) {
        out.push(
          <a key={k++} onClick={() => onLink?.(href)} title={href}
            style={{ color: "var(--cv-accent)", cursor: "pointer", textDecoration: "none", borderBottom: "1px solid color-mix(in srgb, var(--cv-accent) 45%, transparent)" }}>
            {mm[1]}
          </a>,
        );
      } else {
        out.push(
          <a key={k++} href={href} target="_blank" rel="noreferrer"
            style={{ color: "var(--cv-accent)", textDecoration: "none", borderBottom: "1px solid color-mix(in srgb, var(--cv-accent) 45%, transparent)" }}>
            {mm[1]}
          </a>,
        );
      }
    } else if (t.startsWith("**")) {
      out.push(<strong key={k++} style={{ color: "var(--cv-ink)", fontWeight: 700 }}>{t.slice(2, -2)}</strong>);
    } else {
      out.push(
        <code key={k++} style={{ background: "rgba(255,255,255,0.07)", borderRadius: 4, padding: "0 4px", fontSize: "0.92em", fontFamily: "ui-monospace, monospace" }}>
          {t.slice(1, -1)}
        </code>,
      );
    }
    last = m.index! + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Reading view styled on real Obsidian: amber headings, amber link underlines,
 * bullet/numbered lists, tasks, blockquotes, fenced code. */
function ReadingView({ text, onLink }: { text: string; onLink?: (name: string) => void }) {
  const lines = text.split("\n");
  const els: React.ReactNode[] = [];
  let inCode = false, codeBuf: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*```/.test(l)) {
      if (inCode) {
        els.push(
          <pre key={i} style={{ margin: "8px 0", padding: "10px 12px", borderRadius: 8, background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.06)", fontSize: 10.5, fontFamily: "ui-monospace, monospace", lineHeight: 1.5, overflowX: "auto", color: "var(--cv-ink-dim)" }}>
            {codeBuf.join("\n")}
          </pre>,
        );
        codeBuf = [];
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) { codeBuf.push(l); continue; }
    const h = l.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      const size = [19, 16, 14, 12.5, 11.5, 11][h[1].length - 1];
      els.push(
        <div key={i} style={{ fontSize: size, fontWeight: 700, margin: "16px 0 6px", color: "var(--cv-accent)", letterSpacing: 0.2 }}>
          {mdInline(h[2], onLink)}
        </div>,
      );
      continue;
    }
    const task = l.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.*)/);
    if (task) {
      els.push(
        <div key={i} style={{ paddingLeft: 14 + task[1].length * 6, margin: "3px 0", display: "flex", gap: 7, alignItems: "baseline" }}>
          <span style={{ color: "var(--cv-accent)", fontSize: 11 }}>{task[2] === " " ? "☐" : "☑"}</span>
          <span style={{ opacity: task[2] === " " ? 1 : 0.55, textDecoration: task[2] === " " ? "none" : "line-through" }}>{mdInline(task[3], onLink)}</span>
        </div>,
      );
      continue;
    }
    const bullet = l.match(/^(\s*)[-*•]\s+(.*)/);
    if (bullet) {
      els.push(
        <div key={i} style={{ paddingLeft: 14 + bullet[1].length * 6, margin: "3px 0" }}>
          <span style={{ color: "var(--cv-accent)", marginRight: 7 }}>•</span>
          {mdInline(bullet[2], onLink)}
        </div>,
      );
      continue;
    }
    const num = l.match(/^(\s*)(\d+)\.\s+(.*)/);
    if (num) {
      els.push(
        <div key={i} style={{ paddingLeft: 14 + num[1].length * 6, margin: "3px 0" }}>
          <span style={{ color: "var(--cv-accent)", marginRight: 7, fontSize: "0.95em" }}>{num[2]}.</span>
          {mdInline(num[3], onLink)}
        </div>,
      );
      continue;
    }
    if (/^\s*>\s?/.test(l)) {
      els.push(
        <div key={i} style={{ margin: "6px 0", paddingLeft: 12, borderLeft: "2px solid var(--cv-accent)", color: "var(--cv-ink-dim)", fontStyle: "italic" }}>
          {mdInline(l.replace(/^\s*>\s?/, ""), onLink)}
        </div>,
      );
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) {
      els.push(<hr key={i} style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.1)", margin: "14px 0" }} />);
      continue;
    }
    if (l.trim() === "") { els.push(<div key={i} style={{ height: 7 }} />); continue; }
    els.push(<div key={i} style={{ margin: "3px 0" }}>{mdInline(l, onLink)}</div>);
  }
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "10px 18px", fontSize: 12.5, lineHeight: 1.7, color: "var(--cv-ink)", fontFamily: "inherit" }}>
      {els}
    </div>
  );
}

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
      <div style={{ flex: 1, display: "grid", placeItems: "center", fontSize: 11, color: "var(--cv-ink-faint)" }}>
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
              textAnchor="middle" fontSize={9.5}
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
      <div style={{ position: "absolute", bottom: 8, left: 14, fontSize: 9.5, color: "var(--cv-ink-faint)" }}>
        {all.length} linked note{all.length === 1 ? "" : "s"} · hollow = not in vault yet
      </div>
    </div>
  );
}

/** "Generate PDF" menu — pick a template or ask for anything; the doc is
 * built from live board state, exported as .pdf and saved to artifacts. */
export function GeneratePdfMenu({ onPick, onAsk }: {
  onPick: (kind: "overview" | "onboarding" | "architecture") => void;
  onAsk: (question: string) => void;
}) {
  const [q, setQ] = useState("");
  const rows: { k: "overview" | "onboarding" | "architecture"; icon: string; label: string; hint: string }[] = [
    { k: "overview", icon: "notes", label: "Project overview", hint: "agents, boards, notes — what the board is doing" },
    { k: "onboarding", icon: "play", label: "Onboarding guide", hint: "how to drive this board" },
    { k: "architecture", icon: "artifacts", label: "Architecture", hint: "canvas + daemon + protocol map" },
  ];
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.9, textTransform: "uppercase", color: "var(--cv-ink-faint)", padding: "2px 6px 6px" }}>
        Generate PDF
      </div>
      {rows.map((r) => (
        <button
          key={r.k}
          onClick={() => onPick(r.k)}
          style={{
            display: "flex", alignItems: "center", gap: 10, width: "100%",
            padding: "8px 10px", border: "none", background: "transparent",
            color: "var(--cv-ink)", fontSize: 12, fontWeight: 550,
            borderRadius: 8, cursor: "pointer", textAlign: "left",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--cv-glass-hi)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <Icon name={r.icon} size={15} color="var(--cv-ink-dim)" />
          <div>
            <div>{r.label}</div>
            <div style={{ fontSize: 9.5, color: "var(--cv-ink-faint)" }}>{r.hint}</div>
          </div>
        </button>
      ))}
      <form
        style={{ display: "flex", gap: 5, padding: "8px 6px 2px", borderTop: "1px solid var(--cv-glass-edge)", marginTop: 4 }}
        onSubmit={(e) => { e.preventDefault(); if (q.trim()) onAsk(q.trim()); }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask for anything…"
          style={{ flex: 1, minWidth: 0, background: "var(--cv-glass-hi)", border: "1px solid var(--cv-glass-edge)", borderRadius: 999, padding: "5px 10px", fontSize: 10.5, color: "var(--cv-ink)", outline: "none" }}
        />
        <button type="submit" style={{ ...actionBtn, color: "var(--cv-accent)" }} title="Write a PDF about this from the board's state">→</button>
      </form>
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
const COLLAPSED_KEY = "cv-vault-collapsed";

function FileTree({ entries, collapsed, toggle, vaultFile, onOpen, onPin, onBookmark, bookmarks, depth = 0 }: {
  entries: TreeDir;
  collapsed: Set<string>;
  toggle: (p: string) => void;
  vaultFile: { path: string } | null;
  onOpen: (p: string) => void;
  onPin: (p: string) => void;
  onBookmark: (p: string) => void;
  bookmarks: Set<string>;
  depth?: number;
}) {
  const pad = 8 + depth * 12;
  return (
    <>
      {sortDir(entries).map((d) => {
        const isCol = collapsed.has(d.path);
        return (
          <div key={d.path}>
            <button
              onClick={() => toggle(d.path)}
              style={{
                display: "flex", alignItems: "center", gap: 4, width: "100%",
                textAlign: "left", border: "none", background: "transparent",
                color: "var(--cv-ink-dim)", fontSize: 11.5, padding: "4px 8px",
                paddingLeft: pad, cursor: "pointer", borderRadius: 6, fontWeight: 600,
              }}
            >
              <span style={{ fontSize: 8, width: 10, color: "var(--cv-ink-faint)" }}>{isCol ? "▸" : "▾"}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
            </button>
            {!isCol && (
              <FileTree
                entries={d} collapsed={collapsed} toggle={toggle}
                vaultFile={vaultFile} onOpen={onOpen} onPin={onPin}
                onBookmark={onBookmark} bookmarks={bookmarks} depth={depth + 1}
              />
            )}
          </div>
        );
      })}
      {entries.files.sort((a, b) => a.localeCompare(b)).map((e) => (
        <button
          key={e}
          onClick={() => onOpen(e)}
          className="vault-file"
          style={{
            display: "flex", alignItems: "center", width: "100%",
            textAlign: "left", border: "none",
            background: vaultFile?.path === e ? "var(--cv-glass-hi)" : "transparent",
            color: vaultFile?.path === e ? "var(--cv-ink)" : "var(--cv-ink-dim)",
            fontSize: 11.5, padding: "4px 8px", paddingLeft: pad + 10,
            borderRadius: 6, cursor: "pointer",
          }}
        >
          <span style={{ color: "var(--cv-ink-faint)", marginRight: 6, fontSize: 10 }}>✎</span>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {e.split("/").pop()!.replace(/\.md$/, "")}
          </span>
          <span className="vault-file-actions" style={{ display: "none", gap: 2 }}>
            <span
              role="button" title={bookmarks.has(e) ? "unbookmark" : "bookmark — pin to the top"}
              onClick={(ev) => { ev.stopPropagation(); onBookmark(e); }}
              style={{ color: bookmarks.has(e) ? "var(--cv-accent)" : "var(--cv-ink-faint)", cursor: "pointer", padding: "0 3px", fontSize: 11 }}
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
          </span>
        </button>
      ))}
    </>
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
  const closeVaultFile = useBoard((s) => s.closeVaultFile);
  const vaultHits = useBoard((s) => s.vaultHits);
  const vaultSearch = useBoard((s) => s.vaultSearch);
  const [dir, setDir] = useState(vaultDir || "/home/ubuntu/repos/agent-canvas");
  const [filter, setFilter] = useState("");
  const [panelW, setPanelW] = useState(320);
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
  const dragStart = (ev: React.MouseEvent) => {
    ev.preventDefault();
    const startX = ev.clientX, startW = panelW;
    const move = (e: MouseEvent) => setPanelW(Math.min(560, Math.max(230, startW + e.clientX - startX)));
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // Debounced full-text search — filename filter stays instant, content
  // hits arrive via `vault_hits`.
  useEffect(() => {
    const q = filter.trim();
    if (q.length < 2 || !vaultDir) return;
    const t = setTimeout(() => vaultSearch(q), 250);
    return () => clearTimeout(t);
  }, [filter, vaultDir, vaultSearch]);
  const [view, setView] = useState<"reading" | "source" | "graph">("reading");
  const [genOpen, setGenOpen] = useState(false);

  const shown = vaultEntries.filter((e) =>
    e.toLowerCase().includes(filter.toLowerCase()),
  );
  const tree = buildTree(filter ? shown : vaultEntries);
  const vaultName = vaultDir.replace(/\/+$/, "").split("/").pop() ?? "vault";
  const openByName = (name: string) => {
    const hit = vaultEntries.find((e) => e === name || e.endsWith(`/${name}.md`) || e === `${name}.md` || e.replace(/\.md$/, "") === name);
    if (hit) vaultRead(hit);
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
    <>
      <div
        className="glass"
        style={{
          position: "absolute",
          left: 64,
          top: 64,
          bottom: 64,
          width: panelW,
          zIndex: 19,
          display: "flex",
          flexDirection: "column",
          padding: "12px 10px 8px",
          overflow: "hidden",
        }}
      >
      <div
        onMouseDown={dragStart}
        title="drag to resize"
        style={{ position: "absolute", right: -3, top: 0, bottom: 0, width: 6, cursor: "col-resize", zIndex: 5 }}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px 8px" }}>
        <span style={{ fontSize: 12.5, fontWeight: 650, color: "var(--cv-ink)", display: "flex", alignItems: "center", gap: 6 }}>
          <img src="/obsidian.svg" alt="" width={13} height={13} /> Vault
        </span>
        <div style={{ position: "relative" }}>
          <button style={actionBtn} title="Generate a PDF document from the board" onClick={() => setGenOpen((o) => !o)}>
            <Icon name="shot" size={11} /> PDF
          </button>
          {genOpen && (
            <div className="cv-menu" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", width: 240, padding: 8, zIndex: 50 }}>
              <GeneratePdfMenu onPick={generate} onAsk={askAnything} />
            </div>
          )}
        </div>
      </div>
      <form
        style={{ display: "flex", gap: 6, margin: "0 4px 8px" }}
        onSubmit={(e) => {
          e.preventDefault();
          if (dir.trim()) vaultList(dir.trim());
        }}
      >
        <input
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          placeholder="/path/to/vault"
          style={{ flex: 1, minWidth: 0, background: "var(--cv-glass-hi)", border: "1px solid var(--cv-glass-edge)", borderRadius: 999, padding: "6px 12px", fontSize: 11, color: "var(--cv-ink)", outline: "none", fontFamily: "ui-monospace, monospace" }}
        />
        <button className="glass-pill" style={{ fontSize: 10.5, padding: "5px 12px", cursor: "pointer", border: "none", color: "var(--cv-accent)" }} type="submit">
          open
        </button>
      </form>
      {vaultEntries.length > 0 && (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`${vaultEntries.length} notes — filter or search inside…`}
          style={{ margin: "0 4px 8px", background: "var(--cv-glass-hi)", border: "1px solid var(--cv-glass-edge)", borderRadius: 999, padding: "5px 12px", fontSize: 11, color: "var(--cv-ink)", outline: "none" }}
        />
      )}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {bookmarks.size > 0 && !filter && (
          <>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.9, textTransform: "uppercase", color: "var(--cv-ink-faint)", padding: "2px 10px 4px" }}>
              Bookmarks
            </div>
            {[...bookmarks].filter((b) => vaultEntries.includes(b)).map((e) => (
              <button
                key={`bm-${e}`}
                onClick={() => vaultRead(e)}
                style={{
                  display: "flex", alignItems: "center", width: "100%",
                  textAlign: "left", border: "none",
                  background: vaultFile?.path === e ? "var(--cv-glass-hi)" : "transparent",
                  color: vaultFile?.path === e ? "var(--cv-ink)" : "var(--cv-ink-dim)",
                  fontSize: 11.5, padding: "4px 8px", borderRadius: 6, cursor: "pointer",
                }}
              >
                <span style={{ color: "var(--cv-accent)", marginRight: 6, fontSize: 10 }}>★</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.split("/").pop()!.replace(/\.md$/, "")}
                </span>
                <span
                  role="button" title="unbookmark"
                  onClick={(ev) => { ev.stopPropagation(); toggleBookmark(e); }}
                  style={{ color: "var(--cv-ink-faint)", cursor: "pointer", fontSize: 11 }}
                >
                  ×
                </span>
              </button>
            ))}
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.9, textTransform: "uppercase", color: "var(--cv-ink-faint)", padding: "8px 10px 4px" }}>
              Files
            </div>
          </>
        )}
        {filter.trim().length >= 2 && vaultHits.length > 0 && (
          <>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--cv-ink-faint)", padding: "10px 12px 4px" }}>
              content matches
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
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--cv-accent)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {h.path}:{h.line}
                </div>
                <div style={{ fontSize: 10.5, color: "var(--cv-ink-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {h.text}
                </div>
              </button>
            ))}
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--cv-ink-faint)", padding: "10px 12px 4px" }}>
              files
            </div>
          </>
        )}
        <FileTree
          entries={tree}
          collapsed={collapsed}
          toggle={toggleCollapsed}
          vaultFile={vaultFile}
          onOpen={vaultRead}
          onPin={(e) => useBoard.getState().mdNodeAdd(e)}
          onBookmark={toggleBookmark}
          bookmarks={bookmarks}
        />
        {shown.length === 0 && (
          <div style={{ fontSize: 11, color: "var(--cv-ink-faint)", padding: "8px 12px" }}>
            No notes match — try fewer letters.
          </div>
        )}
      </div>
      <div style={{
        borderTop: "1px solid var(--cv-glass-edge)",
        padding: "6px 12px 0", marginTop: 4,
        display: "flex", alignItems: "center", gap: 6,
        fontSize: 10.5, color: "var(--cv-ink-faint)",
      }}>
        <img src="/obsidian.svg" alt="" width={11} height={11} style={{ opacity: 0.7 }} />
        {vaultName}
      </div>
      </div>
      {vaultFile && (
        <div
          className="glass"
          data-panel="vault"
          style={{
            position: "absolute",
            left: 64 + panelW + 12,
            top: 64,
            bottom: 64,
            right: 24,
            maxWidth: 720,
            zIndex: 20,
            display: "flex",
            flexDirection: "column",
            padding: "14px 16px 10px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 500, color: "var(--cv-ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {vaultFile.path.replace(/\.md$/, "").split("/").join(" › ")}
            </span>
            <div style={{ display: "flex", gap: 5, alignItems: "center", flexShrink: 0 }}>
              <button style={actionBtn} title="Pin this note as a live card on the board" onClick={() => useBoard.getState().mdNodeAdd(vaultFile.path, "vault")}>
                Add to Board
              </button>
              <button style={actionBtn} title="Export as PDF (saved to artifacts)" onClick={exportFile}>
                <Icon name="shot" size={11} /> Export PDF
              </button>
              <button
                style={actionBtn}
                title="Open in Obsidian — jumps to this note in the real app"
                onClick={() => {
                  const vaultName = vaultDir.replace(/\/+$/, "").split("/").pop() ?? "";
                  const file = vaultFile.path.replace(/\.md$/, "");
                  window.open(`obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(file)}`, "_self");
                }}
              >
                <img src="/obsidian.svg" alt="" width={11} height={11} /> Obsidian
              </button>
              <button style={{ border: "none", background: "none", color: "var(--cv-ink-dim)", cursor: "pointer", fontSize: 14 }} onClick={closeVaultFile}>
                ×
              </button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            <button style={tabBtn(view === "reading")} onClick={() => setView("reading")}>Reading</button>
            <button style={tabBtn(view === "source")} onClick={() => setView("source")}>Source</button>
            <button style={tabBtn(view === "graph")} onClick={() => setView("graph")}>Graph</button>
          </div>
          {view === "reading" && <ReadingView text={vaultFile.text} onLink={openByName} />}
          {view === "source" && (
            <pre
              style={{
                flex: 1,
                overflow: "auto",
                margin: 0,
                padding: "10px 12px",
                borderRadius: 14,
                border: "1px solid var(--cv-glass-edge)",
                background: "var(--cv-glass-hi)",
                color: "var(--cv-ink)",
                fontSize: 11,
                fontFamily: "ui-monospace, monospace",
                lineHeight: 1.55,
                whiteSpace: "pre-wrap",
              }}
            >
              {vaultFile.text}
            </pre>
          )}
          {view === "graph" && (
            <GraphView
              text={vaultFile.text}
              path={vaultFile.path}
              entries={vaultEntries}
              onOpen={openByName}
            />
          )}
          <div style={{
            marginTop: 8, paddingTop: 6, borderTop: "1px solid var(--cv-glass-edge)",
            display: "flex", gap: 14, fontSize: 9.5, color: "var(--cv-ink-faint)",
          }}>
            <span>{[...vaultFile.text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].length} links</span>
            <span>{vaultFile.text.split(/\s+/).filter(Boolean).length} words</span>
            <span>{vaultFile.text.length.toLocaleString()} characters</span>
          </div>
        </div>
      )}
    </>
  );
}
