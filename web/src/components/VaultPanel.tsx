import { useEffect, useMemo, useRef, useState } from "react";
import { panelRoot } from "./panelChrome";
import { useBoard } from "../store/board";
import { isTauri } from "../daemon/tauriClient";
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

/** Inline markdown → Obsidian-style runs: **bold**, *italic*, `code`,
 * ==highlight==, ~~strike~~, [[wiki links]] (clickable, amber like real
 * Obsidian) and [md](url) links. */
/** Resolve a [[wikilink]] name to a vault entry — Obsidian matches by
 * filename anywhere in the vault. */
export function resolveNotePath(entries: string[], name: string): string | null {
  return entries.find((e) =>
    e === name || e.endsWith(`/${name}`) || e === `${name}.md` || e.endsWith(`/${name}.md`) ||
    e.replace(/\.md$/, "") === name,
  ) ?? null;
}

/** A [[wikilink]] with Obsidian's hover page-preview: hovering ~400ms opens a
 * glass popover rendering the target note (fetched via vault_peek). Links to
 * notes that don't exist yet get Obsidian's dashed 'unresolved' underline. */
function WikiLink({ name, shown, onLink, entries: suppliedEntries }: { name: string; shown: string; onLink?: (name: string) => void; entries?: string[] }) {
  const boardEntries = useBoard((s) => s.vaultEntries);
  const entries = suppliedEntries ?? boardEntries;
  const path = resolveNotePath(entries, name.split("#")[0]);
  const text = useBoard((s) => (path ? s.mdContents[path] : undefined));
  const peek = useBoard((s) => s.vaultPeek);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const enter = () => {
    timer.current = window.setTimeout(() => {
      setOpen(true);
      if (path && text === undefined) peek(path);
    }, 400);
  };
  const leave = () => { window.clearTimeout(timer.current); setOpen(false); };
  const unresolved = path === null;
  return (
    <span style={{ position: "relative" }} onMouseEnter={enter} onMouseLeave={leave}>
      <a
        onClick={() => onLink?.(name)}
        title={unresolved ? `${name} (not created yet)` : name}
        style={{
          color: "var(--cv-accent)", cursor: "pointer", textDecoration: "none",
          opacity: unresolved ? 0.55 : 1,
          borderBottom: `1px ${unresolved ? "dashed" : "solid"} color-mix(in srgb, var(--cv-accent) 45%, transparent)`,
        }}
      >
        {shown}
      </a>
      {name.includes("#") && (
        <span style={{ fontSize: "0.85em", opacity: 0.6 }}> &gt; {name.split("#")[1]}</span>
      )}
      {open && (
        <div
          className="glass"
          style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 70,
            width: 300, maxHeight: 240, overflow: "auto", borderRadius: 10,
            padding: "10px 14px", fontSize: 12, lineHeight: 1.6,
            boxShadow: "0 12px 40px rgba(0,0,0,0.5)", cursor: "default",
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--cv-accent)", marginBottom: 4 }}>
            {(path ?? name).replace(/\.md$/, "")}
          </div>
          {unresolved ? (
            <div style={{ fontSize: 11, color: "var(--cv-ink-faint)", fontStyle: "italic" }}>note not created yet</div>
          ) : text === undefined ? (
            <div style={{ fontSize: 11, color: "var(--cv-ink-faint)", fontStyle: "italic" }}>loading…</div>
          ) : (
            <ReadingView text={text} depth={1} onLink={onLink} />
          )}
        </div>
      )}
    </span>
  );
}

function mdInline(text: string, onLink?: (name: string) => void, onTag?: (tag: string) => void, fns?: Map<string, number>, scope = "", entries?: string[], onOpenExternal?: (url: string) => void): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\[\^[^\]]+\]|\[\[[^\]|]+(?:\|[^\]]*)?\]\]|\[[^\]]+\]\([^)]*\)|\*\*[^*]+\*\*|\*[^*\n]+\*|==[^=]+==|~~[^~]+~~|`[^`]+`|(?<![\p{L}\p{N}])#[\p{L}_][\p{L}\p{N}_/-]*)/gu;
  let last = 0, k = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("[^")) {
      const id = t.slice(2, -1);
      const n = fns?.get(id);
      if (n === undefined) {
        out.push(t);
      } else {
        out.push(
          <sup key={k++} id={`${scope}vfn-ref-${id}`}>
            <a
              onClick={() => document.getElementById(`${scope}vfn-def-${id}`)?.scrollIntoView({ block: "center" })}
              title="footnote"
              style={{ color: "var(--cv-accent)", cursor: "pointer", textDecoration: "none" }}
            >
              {n}
            </a>
          </sup>,
        );
      }
    } else if (t.startsWith("[[")) {
      const inner = t.slice(2, -2);
      const name = inner.split("|")[0].trim();
      const shown = inner.includes("|") ? inner.split("|")[1] : name;
      out.push(<WikiLink key={k++} name={name} shown={shown} onLink={onLink} entries={entries} />);
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
      } else if (onOpenExternal && !/^(?:https?:|mailto:|#)/i.test(href)) {
        out.push(<a key={k++} onClick={() => onOpenExternal(href)} title={href} style={{ color: "var(--cv-accent)", cursor: "pointer", textDecoration: "none", borderBottom: "1px solid color-mix(in srgb, var(--cv-accent) 45%, transparent)" }}>{mm[1]}</a>);
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
    } else if (t.startsWith("*")) {
      out.push(<em key={k++} style={{ color: "var(--cv-ink)" }}>{t.slice(1, -1)}</em>);
    } else if (t.startsWith("==")) {
      out.push(
        <mark key={k++} style={{ background: "color-mix(in srgb, var(--cv-accent) 30%, transparent)", color: "var(--cv-ink)", borderRadius: 3, padding: "0 2px" }}>
          {t.slice(2, -2)}
        </mark>,
      );
    } else if (t.startsWith("~~")) {
      out.push(<s key={k++} style={{ opacity: 0.6 }}>{t.slice(2, -2)}</s>);
    } else if (t.startsWith("#")) {
      out.push(
        <span
          key={k++}
          onClick={() => onTag?.(t)}
          title={onTag ? `search ${t}` : undefined}
          style={{ color: "var(--cv-accent)", background: "color-mix(in srgb, var(--cv-accent) 12%, transparent)", borderRadius: 4, padding: "0 4px", fontSize: "0.92em", cursor: onTag ? "pointer" : "default" }}
        >
          {t}
        </span>,
      );
    } else {
      out.push(
        <code key={k++} style={{ background: "rgba(255,255,255,0.07)", borderRadius: 4, padding: "0 4px", fontSize: "0.92em", fontFamily: "var(--cv-font-mono)" }}>
          {t.slice(1, -1)}
        </code>,
      );
    }
    last = m.index! + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Per-instance footnote id scope — embeds render their own defs. */
ReadingView.scopeN = 0;

/** Reading view styled on real Obsidian: amber headings, amber link underlines,
 * bullet/numbered lists, tasks, blockquotes, fenced code. */
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|ico)$/i;

export function ReadingView({ text, onLink, onTag, onToggleTask, depth = 0, embedLookup, embedFetch, embedAsset, embedAssetFetch, entries, onOpenExternal }: {
  text: string;
  onLink?: (name: string) => void;
  onTag?: (tag: string) => void;
  onToggleTask?: (line: number, done: boolean) => void;
  depth?: number;
  embedLookup?: (name: string) => { path: string; text?: string } | null;
  embedFetch?: (path: string) => void;
  embedAsset?: (path: string) => string | undefined;
  embedAssetFetch?: (path: string) => void;
  entries?: string[];
  onOpenExternal?: (url: string) => void;
}) {
  const lines = text.split("\n");
  // Heading folding (Obsidian): chevron on each heading collapses the body
  // until the next same-or-higher-level heading.
  const [folded, setFolded] = useState<Set<number>>(() => new Set());
  const { hidden } = useMemo(() => {
    const heads: [number, number][] = [];
    let code = false;
    lines.forEach((l, i) => {
      if (/^\s*```/.test(l)) { code = !code; return; }
      if (code) return;
      const m = l.match(/^(#{1,6})\s/);
      if (m) heads.push([i, m[1].length]);
    });
    const folds = new Map<number, number>();
    heads.forEach(([i, lvl], j) => {
      let end = lines.length;
      for (let k = j + 1; k < heads.length; k++) {
        if (heads[k][1] <= lvl) { end = heads[k][0]; break; }
      }
      folds.set(i, end);
    });
    const hidden = new Set<number>();
    folded.forEach((f) => {
      const end = folds.get(f) ?? lines.length;
      for (let i = f + 1; i < end; i++) hidden.add(i);
    });
    return { folds, hidden };
  }, [text, folded]);
  const toggleFold = (i: number) =>
    setFolded((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i); else n.add(i);
      return n;
    });
  // YAML frontmatter (--- ... ---): Obsidian renders it as a "Properties"
  // table at the top of the note instead of raw YAML.
  let start = 0;
  const props: [string, string][] = [];
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (end > 0) {
      start = end + 1;
      for (let i = 1; i < end; i++) {
        const kv = lines[i].match(/^([A-Za-z_][\w .-]*):\s*(.*)/);
        if (kv) props.push([kv[1], kv[2].trim()]);
        else if (/^\s*-\s+/.test(lines[i]) && props.length) {
          const [k, v] = props[props.length - 1];
          props[props.length - 1] = [k, v ? `${v}, ${lines[i].trim().replace(/^-\s*/, "")}` : lines[i].trim().replace(/^-\s*/, "")];
        }
      }
    }
  }
  // Footnotes: [^id] refs get a superscript number (ordered by first
  // reference, like Obsidian) that jumps to the [^id]: def section below.
  const fnDefs = new Map<string, string>();
  {
    let code = false;
    for (const l of lines) {
      if (/^\s*```/.test(l)) { code = !code; continue; }
      if (code) continue;
      const m = l.match(/^\[\^([^\]]+)\]:\s*(.*)$/);
      if (m) fnDefs.set(m[1], m[2]);
    }
  }
  const fnOrder: string[] = [];
  const fnReferenced = new Set<string>();
  if (fnDefs.size) {
    // Number by first visible reference: body lines in reading order first,
    // then refs inside def bodies (a footnote citing another gets a backref
    // but shouldn't jump ahead of body citations in numbering).
    for (const defBody of [false, true]) {
      // Reset per pass: an unclosed fence must not bleed into the next scan.
      let code = false;
      for (const l of lines) {
        if (/^\s*```/.test(l)) { code = !code; continue; }
        if (code) continue;
        const isDef = /^\[\^[^\]]+\]:/.test(l);
        if (isDef !== defBody) continue;
        const body = l.replace(/^\[\^[^\]]+\]:\s*/, "");
        for (const m of body.matchAll(/\[\^([^\]]+)\]/g)) {
          if (fnDefs.has(m[1]) && !fnOrder.includes(m[1])) { fnOrder.push(m[1]); fnReferenced.add(m[1]); }
        }
      }
    }
    for (const id of fnDefs.keys()) if (!fnOrder.includes(id)) fnOrder.push(id);
  }
  const fns = new Map(fnOrder.map((id, i) => [id, i + 1]));
  const fnScope = useRef(`fn${++ReadingView.scopeN}-`).current;
  const els: React.ReactNode[] = [];
  if (props.length) {
    els.push(
      <div
        key="fm"
        style={{
          margin: "4px 0 12px", maxWidth: 640, borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.02)", overflow: "hidden",
        }}
      >
        {props.map(([k, v], i) => (
          <div
            key={i}
            style={{
              display: "flex", gap: 10, padding: "4px 12px", fontSize: 10.5,
              borderBottom: i === props.length - 1 ? "none" : "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <span style={{ minWidth: 90, color: "var(--cv-ink-faint)", fontWeight: 600 }}>{k}</span>
            <span style={{ color: "var(--cv-ink-dim)", wordBreak: "break-word" }}>{v || "—"}</span>
          </div>
        ))}
      </div>,
    );
  }
  let inCode = false, codeBuf: string[] = [];
  for (let i = start; i < lines.length; i++) {
    if (hidden.has(i)) continue;
    const l = lines[i];
    if (/^\s*```/.test(l)) {
      if (inCode) {
        els.push(
          <pre key={i} style={{ margin: "8px 0", padding: "10px 12px", borderRadius: 8, background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.06)", fontSize: 10.5, fontFamily: "var(--cv-font-mono)", lineHeight: 1.5, overflowX: "auto", color: "var(--cv-ink-dim)" }}>
            {codeBuf.join("\n")}
          </pre>,
        );
        codeBuf = [];
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) { codeBuf.push(l); continue; }
    if (/^\[\^[^\]]+\]:/.test(l)) continue;
    // Obsidian transclusion: ![[Note]] embeds the note's content inline.
    // Rendered one level deep — a nested embed falls back to a plain link
    // so cycles can never recurse.
    const emb = l.match(/^\s*!\[\[([^\]|#]+?)(?:#([^\]|]*))?(?:\|[^\]]*)?\]\]\s*$/);
    if (emb && embedLookup) {
      if (depth >= 1) {
        els.push(<div key={i} style={{ margin: "4px 0" }}>{mdInline(`[[${emb[1].trim()}]]`, onLink, onTag, fns, fnScope)}</div>);
      } else {
        els.push(
          <NoteEmbed key={i} name={emb[1].trim()} section={emb[2]?.trim()} lookup={embedLookup} fetchPath={embedFetch} onLink={onLink} onTag={onTag} assetSrc={embedAsset} assetFetch={embedAssetFetch} entries={entries} />,
        );
      }
      continue;
    }
    const h = l.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      const size = [19, 16, 14, 12.5, 11.5, 11][h[1].length - 1];
      const isFolded = folded.has(i);
      els.push(
        <div key={i} id={`vh-${i}`} style={{ fontSize: size, fontWeight: 700, margin: "16px 0 6px", color: "var(--cv-accent)", letterSpacing: 0.2 }}>
          <span
            onClick={() => toggleFold(i)}
            title={isFolded ? "unfold" : "fold"}
            style={{
              cursor: "pointer", marginRight: 4, marginLeft: -4, padding: "2px 6px",
              display: "inline-block", minWidth: 14, textAlign: "center",
              fontSize: "0.75em", opacity: isFolded ? 0.9 : 0.35, userSelect: "none",
            }}
          >
            {isFolded ? "▸" : "▾"}
          </span>
          {mdInline(h[2], onLink, onTag, fns, fnScope, entries, onOpenExternal)}
        </div>,
      );
      continue;
    }
    const task = l.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.*)/);
    if (task) {
      els.push(
        <div key={i} style={{ paddingLeft: 14 + task[1].length * 6, margin: "3px 0", display: "flex", gap: 7, alignItems: "baseline" }}>
          <span
            onClick={onToggleTask ? () => onToggleTask(i, task[2] === " ") : undefined}
            title={onToggleTask ? "Toggle task — writes the change to the vault file" : undefined}
            style={{ color: "var(--cv-accent)", fontSize: 11, cursor: onToggleTask ? "pointer" : "default" }}
          >
            {task[2] === " " ? "☐" : "☑"}
          </span>
          <span style={{ opacity: task[2] === " " ? 1 : 0.55, textDecoration: task[2] === " " ? "none" : "line-through" }}>{mdInline(task[3], onLink, onTag, fns, fnScope, entries, onOpenExternal)}</span>
        </div>,
      );
      continue;
    }
    const bullet = l.match(/^(\s*)[-*•]\s+(.*)/);
    if (bullet) {
      els.push(
        <div key={i} style={{ paddingLeft: 14 + bullet[1].length * 6, margin: "3px 0" }}>
          <span style={{ color: "var(--cv-accent)", marginRight: 7 }}>•</span>
          {mdInline(bullet[2], onLink, onTag, fns, fnScope, entries, onOpenExternal)}
        </div>,
      );
      continue;
    }
    const num = l.match(/^(\s*)(\d+)\.\s+(.*)/);
    if (num) {
      els.push(
        <div key={i} style={{ paddingLeft: 14 + num[1].length * 6, margin: "3px 0" }}>
          <span style={{ color: "var(--cv-accent)", marginRight: 7, fontSize: "0.95em" }}>{num[2]}.</span>
          {mdInline(num[3], onLink, onTag, fns, fnScope, entries, onOpenExternal)}
        </div>,
      );
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{3,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      i--;
      if (rows.length) {
        const [head, ...body] = rows;
        const cell = "8px 12px";
        els.push(
          <table
            key={`t${i}`}
            style={{
              margin: "10px 0",
              borderCollapse: "collapse",
              fontSize: 12,
              width: "100%",
              maxWidth: 640,
              border: "1px solid rgba(255,255,255,0.09)",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th
                    key={j}
                    style={{ padding: cell, textAlign: "left", color: "var(--cv-accent)", borderBottom: "1px solid rgba(255,255,255,0.14)", fontWeight: 700, whiteSpace: "nowrap" }}
                  >
                    {mdInline(c, onLink, onTag, fns, fnScope, entries, onOpenExternal)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, j) => (
                <tr key={j} style={{ background: j % 2 ? "rgba(255,255,255,0.02)" : "transparent" }}>
                  {r.map((c, k) => (
                    <td key={k} style={{ padding: cell, borderBottom: "1px solid rgba(255,255,255,0.06)", color: "var(--cv-ink)" }}>
                      {mdInline(c, onLink, onTag, fns, fnScope, entries, onOpenExternal)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>,
        );
      }
      continue;
    }
    if (/^\s*>\s?/.test(l)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      i--;
      const co = quote[0]?.match(/^\[!([a-zA-Z-]+)\][+-]?\s*(.*)/);
      if (co) {
        const kind = co[1].toLowerCase();
        const palette: Record<string, string> = {
          note: "#7aa2f7", abstract: "#56d4c2", summary: "#56d4c2", tldr: "#56d4c2",
          info: "#7aa2f7", todo: "#7aa2f7",
          tip: "#56d4c2", hint: "#56d4c2", important: "#56d4c2",
          success: "#9ece6a", check: "#9ece6a", done: "#9ece6a",
          question: "#e0af68", help: "#e0af68", faq: "#e0af68",
          warning: "#e0af68", caution: "#e0af68", attention: "#e0af68",
          failure: "#f7768e", fail: "#f7768e", missing: "#f7768e",
          danger: "#f7768e", error: "#f7768e", bug: "#f7768e",
          example: "#bb9af7", quote: "#a9b1d6", cite: "#a9b1d6",
        };
        const color = palette[kind] ?? "#7aa2f7";
        const title = co[2].trim() || kind[0].toUpperCase() + kind.slice(1);
        els.push(
          <div
            key={i}
            style={{
              margin: "8px 0", maxWidth: 640, borderRadius: 8,
              background: `color-mix(in srgb, ${color} 9%, transparent)`,
              border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
              borderLeft: `3px solid ${color}`, padding: "7px 12px",
            }}
          >
            <div style={{ color, fontWeight: 700, fontSize: 11.5, marginBottom: quote.length > 1 ? 2 : 0 }}>{title}</div>
            {quote.slice(1).filter((q) => q.trim()).map((q, j) => (
              <div key={j} style={{ margin: "2px 0" }}>{mdInline(q, onLink, onTag, fns, fnScope, entries, onOpenExternal)}</div>
            ))}
          </div>,
        );
      } else {
        quote.forEach((q, j) => {
          els.push(
            <div key={`${i}-${j}`} style={{ margin: "6px 0", paddingLeft: 12, borderLeft: "2px solid var(--cv-accent)", color: "var(--cv-ink-dim)", fontStyle: "italic" }}>
              {mdInline(q, onLink, onTag, fns, fnScope, entries, onOpenExternal)}
            </div>,
          );
        });
      }
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) {
      els.push(<hr key={i} style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.1)", margin: "14px 0" }} />);
      continue;
    }
    if (l.trim() === "") { els.push(<div key={i} style={{ height: 7 }} />); continue; }
    els.push(<div key={i} style={{ margin: "3px 0" }}>{mdInline(l, onLink, onTag, fns, fnScope, entries, onOpenExternal)}</div>);
  }
  if (fns.size) {
    els.push(
      <div key="fns" style={{ margin: "18px 0 4px", borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 8 }}>
        {[...fnDefs.entries()].map(([id, def]) => (
          <div key={id} id={`${fnScope}vfn-def-${id}`} style={{ margin: "4px 0", fontSize: 11.5, color: "var(--cv-ink-dim)", display: "flex", gap: 7 }}>
            {fnReferenced.has(id) ? (
              <a
                onClick={() => document.getElementById(`${fnScope}vfn-ref-${id}`)?.scrollIntoView({ block: "center" })}
                title="back to reference"
                style={{ color: "var(--cv-accent)", cursor: "pointer", textDecoration: "none", fontWeight: 700, flexShrink: 0 }}
              >
                {fns.get(id) ?? 0}.
              </a>
            ) : (
              <span style={{ color: "var(--cv-accent)", fontWeight: 700, flexShrink: 0 }}>{fns.get(id) ?? 0}.</span>
            )}
            <span>{mdInline(def, onLink, onTag, fns, fnScope, entries, onOpenExternal)}</span>
          </div>
        ))}
      </div>,
    );
  }
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "10px 18px", fontSize: 12.5, lineHeight: 1.7, color: "var(--cv-ink)", fontFamily: "inherit" }}>
      {els}
    </div>
  );
}

/** Obsidian-style note transclusion: renders another note's content in a
 * bordered embed box. Fetches the text on demand via vault_peek so the open
 * note is untouched; the title opens the real note. */
/** Slice a note's markdown to one heading section (Obsidian ![[note#heading]]
 * transclusion): from the heading line to the next heading of same-or-higher
 * level. Falls back to the whole note when the heading isn't found. */
function sectionSlice(text: string, section: string): string {
  const lines = text.split("\n");
  const target = section.trim().toLowerCase();
  const idx = lines.findIndex((l) => {
    const m = l.match(/^(#{1,6})\s+(.*)/);
    return !!m && m[2].replace(/[*_~=`[\]]/g, "").trim().toLowerCase() === target;
  });
  if (idx < 0) return text;
  const depth = lines[idx].match(/^(#{1,6})/)?.[1].length ?? 1;
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s/);
    if (m && m[1].length <= depth) { end = i; break; }
  }
  return lines.slice(idx, end).join("\n");
}

function NoteEmbed({ name, section, lookup, fetchPath, onLink, onTag, assetSrc, assetFetch, entries }: {
  name: string;
  section?: string;
  lookup: (n: string) => { path: string; text?: string } | null;
  fetchPath?: (p: string) => void;
  onLink?: (name: string) => void;
  entries?: string[];
  onTag?: (tag: string) => void;
  assetSrc?: (p: string) => string | undefined;
  assetFetch?: (p: string) => void;
}) {
  const hit = lookup(name);
  const isImg = !!hit && IMAGE_RE.test(hit.path);
  const src = hit && isImg ? assetSrc?.(hit.path) : undefined;
  const missing = hit ? (isImg ? src === undefined : hit.text === undefined) : false;
  useEffect(() => {
    if (!hit) return;
    if (isImg && src === undefined) assetFetch?.(hit.path);
    else if (!isImg && hit.text === undefined) fetchPath?.(hit.path);
  }, [hit?.path, hit?.text === undefined, src === undefined]);
  if (!hit) {
    return (
      <div style={{ margin: "6px 0", fontSize: 11.5, color: "var(--cv-ink-faint)", fontStyle: "italic" }}>
        ![[{name}]] — note not found
      </div>
    );
  }
  if (isImg) {
    return (
      <div style={{ margin: "10px 0", maxWidth: 640 }}>
        {src === undefined ? (
          <div style={{ fontSize: 11, color: "var(--cv-ink-faint)", fontStyle: "italic" }}>loading image…</div>
        ) : (
          <img
            src={src}
            alt={hit.path}
            title={hit.path}
            style={{ maxWidth: "100%", maxHeight: 420, borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)", display: "block" }}
          />
        )}
      </div>
    );
  }
  return (
    <div
      style={{
        margin: "10px 0", maxWidth: 640, borderRadius: 8,
        border: "1px solid color-mix(in srgb, var(--cv-accent) 32%, transparent)",
        borderLeft: "3px solid var(--cv-accent)",
        background: "rgba(255,255,255,0.025)", padding: "8px 12px 10px",
      }}
    >
      <button
        onClick={() => onLink?.(hit.path)}
        title={`Open ${hit.path}`}
        style={{
          background: "none", border: "none", padding: 0, cursor: "pointer",
          fontSize: 10.5, fontWeight: 700, color: "var(--cv-accent)",
          display: "block", marginBottom: 4,
        }}
      >
        {hit.path.replace(/\.md$/, "")}
      </button>
      {missing ? (
        <div style={{ fontSize: 11, color: "var(--cv-ink-faint)", fontStyle: "italic" }}>loading…</div>
      ) : (
        <ReadingView text={section ? sectionSlice(hit.text!, section) : hit.text!} depth={1} onLink={onLink} onTag={onTag} entries={entries} />
      )}
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
    return <div style={{ flex: 1, display: "grid", placeItems: "center", fontSize: 11, color: "var(--cv-ink-faint)" }}>no notes in vault</div>;
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
              <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize={isCur ? 10.5 : 9}
                fontWeight={isCur ? 700 : 400}
                fill={isCur || hover === n ? "var(--cv-accent)" : "var(--cv-ink-dim)"}
                opacity={dim ? 0.25 : 1}>
                {label(n)}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ position: "absolute", bottom: 8, left: 14, fontSize: 9.5, color: "var(--cv-ink-faint)" }}>
        {nodes.length} notes · {edges.length} links
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
          <span className="vault-file-actions" style={{ gap: 2 }}>
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
            <span
              role="button"
              title={armedDel === e ? "click again to delete for real" : "delete this note (removes the real file)"}
              onClick={(ev) => { ev.stopPropagation(); onDelete(e); }}
              style={{ color: armedDel === e ? "#e07070" : "var(--cv-ink-faint)", cursor: "pointer", padding: "0 3px", fontSize: 11, fontWeight: armedDel === e ? 700 : 400 }}
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
          fontSize: 11, fontFamily: "var(--cv-font-mono)",
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
          <div style={{ padding: "4px 10px", fontSize: 9, color: "var(--cv-ink-faint)", borderBottom: "1px solid var(--cv-glass-edge)" }}>
            [[{suggest.query} — {matches.length} note{matches.length === 1 ? "" : "s"}
          </div>
          {matches.map((m, i) => (
            <div
              key={m}
              onMouseDown={(e) => { e.preventDefault(); apply(m); }}
              onMouseEnter={() => setSel(i)}
              style={{
                padding: "5px 10px", fontSize: 11, cursor: "pointer",
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
            padding: "3px 12px", borderRadius: 10, fontSize: 10, cursor: dirty ? "pointer" : "default",
            border: "1px solid var(--cv-glass-edge)",
            background: dirty ? "rgba(255,196,66,.2)" : "var(--cv-glass-hi)",
            color: dirty ? "var(--cv-amber)" : "var(--cv-ink-faint)",
          }}
        >
          {dirty ? "save to vault ⌘S" : "saved"}
        </button>
        {dirty && <span style={{ fontSize: 9, color: "var(--cv-ink-faint)" }}>unsaved changes</span>}
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
  const openObsidian = useBoard((s) => s.openObsidian);
  const mdNodeAdd = useBoard((s) => s.mdNodeAdd);
  const vaultWrite = useBoard((s) => s.vaultWrite);
  const vaultDelete = useBoard((s) => s.vaultDelete);
  const vaultRename = useBoard((s) => s.vaultRename);
  const vaultGraph = useBoard((s) => s.vaultGraph);
  const vaultGraphReq = useBoard((s) => s.vaultGraphReq);
  const notify = useBoard((s) => s.notify);
  const [dir, setDir] = useState(vaultDir || "/home/ubuntu/repos/agent-canvas");
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
          padding: "12px 10px 8px",
          overflow: "hidden",
          borderRight: "1px solid var(--cv-glass-edge)",
        }}
      >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px 8px" }}>
        <span style={{ fontSize: 12.5, fontWeight: 650, color: "var(--cv-ink)", display: "flex", alignItems: "center", gap: 6 }}>
          <img src="/obsidian.svg" alt="" width={13} height={13} /> Vault
        </span>
        <div style={{ position: "relative", display: "flex", gap: 4 }}>
          {vaultDir && (
            <button
              style={actionBtn}
              title={activeVault ? `Open ${activeVault.name} in the installed Obsidian app` : "Open this vault in Obsidian — register it first if Obsidian has not opened it before"}
              onClick={() => void openObsidian(vaultFile?.path ?? "")}
            >
              <img src="/obsidian.svg" alt="" width={11} height={11} /> app
            </button>
          )}
          {vaultDir && !activeVault && (
            <button style={actionBtn} title="Add this folder to Obsidian's vault list" onClick={() => vaultRegister(vaultDir)}>
              register
            </button>
          )}
          {vaultDir && (
            <button style={actionBtn} title="open today's daily note (creates Daily/YYYY-MM-DD.md)" onClick={openDaily}>
              today
            </button>
          )}
          {vaultDir && (
            <button style={actionBtn} title="new note in this vault" onClick={() => { setNewNote((o) => !o); setGenOpen(false); }}>
              + note
            </button>
          )}
          <button style={actionBtn} title="Generate a PDF document from the board" onClick={() => { setGenOpen((o) => !o); setNewNote(false); }}>
            <Icon name="shot" size={11} /> PDF
          </button>
          {genOpen && (
            <div className="cv-menu" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", width: 240, padding: 8, zIndex: 50 }}>
              <GeneratePdfMenu onPick={generate} onAsk={askAnything} />
            </div>
          )}
          {newNote && (
            <form
              className="cv-menu"
              style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", width: 220, padding: 8, zIndex: 50, display: "flex", gap: 6 }}
              onSubmit={(e) => { e.preventDefault(); createNote(); }}
            >
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="folder/note name"
                style={{ flex: 1, minWidth: 0, background: "var(--cv-glass-hi)", border: "1px solid var(--cv-glass-edge)", borderRadius: 8, padding: "5px 9px", fontSize: 11, color: "var(--cv-ink)", outline: "none" }}
              />
              <button type="submit" style={{ fontSize: 10.5, color: "var(--cv-accent)", background: "none", border: "none", cursor: "pointer" }}>create</button>
            </form>
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
          style={{ flex: 1, minWidth: 0, background: "var(--cv-glass-hi)", border: "1px solid var(--cv-glass-edge)", borderRadius: 999, padding: "6px 12px", fontSize: 11, color: "var(--cv-ink)", outline: "none", fontFamily: "var(--cv-font-mono)" }}
        />
        <button className="glass-pill" style={{ fontSize: 10.5, padding: "5px 12px", cursor: "pointer", border: "none", color: "var(--cv-accent)" }} type="submit">
          open
        </button>
        <button
          type="button"
          title="detect vaults the real Obsidian app registered on this machine"
          onClick={vaultDiscover}
          style={{ background: "none", border: "none", color: "var(--cv-ink-faint)", cursor: "pointer", fontSize: 12 }}
        >
          ↻
        </button>
      </form>
      {vaultKnown.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "0 4px 8px" }}>
          {vaultKnown.map((v) => (
            <button
              key={v.path}
              title={`${v.path} — registered Obsidian vault`}
              onClick={() => { setDir(v.path); vaultList(v.path); }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                background: v.path === vaultDir ? "color-mix(in srgb, var(--cv-accent) 22%, transparent)" : "var(--cv-glass-hi)",
                border: "1px solid var(--cv-glass-edge)", borderRadius: 999,
                padding: "3px 9px", fontSize: 10.5, color: "var(--cv-ink)", cursor: "pointer",
              }}
            >
              <img src="/obsidian.svg" alt="" width={10} height={10} /> {v.name}
            </button>
          ))}
        </div>
      )}
      {vaultEntries.length > 0 && (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`${vaultEntries.length} notes — filter or search inside…`}
          style={{ margin: "0 4px 8px", background: "var(--cv-glass-hi)", border: "1px solid var(--cv-glass-edge)", borderRadius: 999, padding: "5px 12px", fontSize: 11, color: "var(--cv-ink)", outline: "none" }}
        />
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
          </>
        )}
        {recent.length > 0 && !filter && (
          <>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.9, textTransform: "uppercase", color: "var(--cv-ink-faint)", padding: "2px 10px 4px" }}>
              Recent
            </div>
            {recent.filter((r) => vaultEntries.includes(r) && !bookmarks.has(r)).slice(0, 5).map((e) => (
              <button
                key={`rc-${e}`}
                onClick={() => vaultRead(e)}
                style={{
                  display: "flex", alignItems: "center", width: "100%",
                  textAlign: "left", border: "none",
                  background: vaultFile?.path === e ? "var(--cv-glass-hi)" : "transparent",
                  color: vaultFile?.path === e ? "var(--cv-ink)" : "var(--cv-ink-dim)",
                  fontSize: 11.5, padding: "4px 8px", borderRadius: 6, cursor: "pointer",
                }}
              >
                <span style={{ color: "var(--cv-ink-faint)", marginRight: 6, fontSize: 10 }}>◷</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.split("/").pop()!.replace(/\.md$/, "")}
                </span>
              </button>
            ))}
          </>
        )}
        {(bookmarks.size > 0 || recent.length > 0) && !filter && (
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.9, textTransform: "uppercase", color: "var(--cv-ink-faint)", padding: "8px 10px 4px" }}>
            Files
          </div>
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
          onOpen={openEntry}
          onPin={(e) => useBoard.getState().mdNodeAdd(e)}
          onBookmark={toggleBookmark}
          onDelete={onDeleteFile}
          onContext={(p, x, y) => { setCtxMenu({ path: p, x, y }); setArmedDel(null); }}
          armedDel={armedDel}
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
                style={{ fontSize: 11, fontWeight: 500, color: "var(--cv-ink)", background: "rgba(255,255,255,.06)", border: "1px solid rgba(212,169,106,.4)", borderRadius: 5, padding: "1px 6px", outline: "none", minWidth: 140 }}
              />
            ) : (
              <span
                title="click to rename / move (use folder/name)"
                onClick={() => { setRenName(vaultFile.path.replace(/\.md$/, "")); setRenaming(true); }}
                style={{ fontSize: 11, fontWeight: 500, color: "var(--cv-ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "text" }}
              >
                {vaultFile.path.replace(/\.md$/, "").split("/").join(" › ")}
              </span>
            )}
            <div style={{ display: "flex", gap: 5, alignItems: "center", flexShrink: 0 }}>
              <button className="vault-board-action" style={actionBtn} title="Pin this live note as a resizable window on the board" onClick={pinCurrentNote}>
                Add to Board
              </button>
              <button
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
              <button style={actionBtn} title="Export as PDF (saved to artifacts)" onClick={exportFile}>
                <Icon name="shot" size={11} /> Export PDF
              </button>
              <button
                style={actionBtn}
                title="Open in Obsidian — jumps to this note in the real app"
                onClick={() => {
                  void openObsidian(vaultFile.path);
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
                            fontSize: 11, fontWeight: h.depth <= 2 ? 600 : 400,
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
              <div style={{ flex: 1, display: "grid", placeItems: "center", fontSize: 11, color: "var(--cv-ink-faint)" }}>
                building graph…
              </div>
            )
          )}
          {backlinksOpen && (
            <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px solid var(--cv-glass-edge)" }}>
              <div style={{ fontSize: 9.5, color: "var(--cv-ink-faint)", marginBottom: 3 }}>Linked mentions</div>
              {backlinks.length === 0 && <div style={{ fontSize: 10.5, color: "var(--cv-ink-dim)", fontStyle: "italic" }}>no notes link here</div>}
              {backlinks.map((b) => (
                <button
                  key={b}
                  onClick={() => vaultRead(b)}
                  style={{ display: "block", background: "none", border: "none", cursor: "pointer", padding: "2px 0", fontSize: 11, color: "var(--cv-accent)", textDecoration: "underline", textDecorationColor: "color-mix(in srgb, var(--cv-accent) 55%, transparent)", textUnderlineOffset: 2 }}
                >
                  {b.replace(/\.md$/, "")}
                </button>
              ))}
              <div style={{ fontSize: 9.5, color: "var(--cv-ink-faint)", margin: "8px 0 3px" }}>Unlinked mentions</div>
              {unlinked.length === 0 && <div style={{ fontSize: 10.5, color: "var(--cv-ink-dim)", fontStyle: "italic" }}>none</div>}
              {unlinked.map((h, i) => (
                <button
                  key={`${h.path}:${h.line}:${i}`}
                  onClick={() => vaultRead(h.path)}
                  title={`${h.path}:${h.line}`}
                  style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "3px 0" }}
                >
                  <div style={{ fontSize: 11, color: "var(--cv-accent)", textDecoration: "underline", textDecorationColor: "color-mix(in srgb, var(--cv-accent) 55%, transparent)", textUnderlineOffset: 2 }}>
                    {h.path.replace(/\.md$/, "")}:{h.line}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--cv-ink-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.text}</div>
                </button>
              ))}
            </div>
          )}
          <div style={{
            marginTop: 8, paddingTop: 6, borderTop: "1px solid var(--cv-glass-edge)",
            display: "flex", gap: 14, fontSize: 9.5, color: "var(--cv-ink-faint)",
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
        <div style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--cv-ink-faint)", fontSize: 11.5 }}>
          pick a note — or today for your daily
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
            boxShadow: "0 8px 28px rgba(0,0,0,0.45)", fontSize: 11.5,
          }}>
            <div style={{ padding: "4px 10px 6px", fontSize: 9.5, color: "var(--cv-ink-faint)", borderBottom: "1px solid var(--cv-glass-edge)", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
              { label: "Open in Obsidian", fn: () => { void openObsidian(ctxMenu.path); } },
              { label: "Register vault in Obsidian", fn: () => { vaultRegister(vaultDir); notify("registered in Obsidian's vault list"); } },
            ].map((it) => (
              <button
                key={it.label}
                onClick={() => { it.fn(); setCtxMenu(null); }}
                className="vault-ctx-item"
                style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", color: "var(--cv-ink)", fontSize: 11.5, padding: "5px 10px", borderRadius: 6, cursor: "pointer" }}
              >
                {it.label}
              </button>
            ))}
            <button
              onClick={() => { onDeleteFile(ctxMenu.path); if (armedDel === ctxMenu.path) { setCtxMenu(null); setArmedDel(null); } }}
              className="vault-ctx-item"
              style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", color: armedDel === ctxMenu.path ? "#e07070" : "var(--cv-ink-dim)", fontSize: 11.5, padding: "5px 10px", borderRadius: 6, cursor: "pointer" }}
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
              <span style={{ fontSize: 11, color: "var(--cv-ink-dim)" }}>{imgView}</span>
              <button style={{ border: "none", background: "none", color: "var(--cv-ink-dim)", cursor: "pointer", fontSize: 14 }} onClick={() => setImgView(null)}>×</button>
            </div>
            {vaultAssets[imgView] ? (
              <img src={vaultAssets[imgView]} alt={imgView} style={{ maxWidth: "76vw", maxHeight: "70vh", borderRadius: 8, display: "block" }} />
            ) : (
              <div style={{ fontSize: 11, color: "var(--cv-ink-faint)", fontStyle: "italic", padding: 20 }}>loading image…</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
