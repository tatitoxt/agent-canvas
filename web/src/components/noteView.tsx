import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useBoard } from "../store/board";
import { resolveNotePath } from "./notePath";

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
            padding: "10px 14px", fontSize: "var(--cv-text-xs)", lineHeight: 1.6,
            boxShadow: "0 12px 40px rgba(0,0,0,0.5)", cursor: "default",
          }}
        >
          <div style={{ fontSize: "var(--cv-text-xxs)", fontWeight: 700, color: "var(--cv-accent)", marginBottom: 4 }}>
            {(path ?? name).replace(/\.md$/, "")}
          </div>
          {unresolved ? (
            <div style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)", fontStyle: "italic" }}>note not created yet</div>
          ) : text === undefined ? (
            <div style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)", fontStyle: "italic" }}>loading…</div>
          ) : (
            <ReadingView text={text} depth={1} onLink={onLink} />
          )}
        </div>
      )}
    </span>
  );
}

/** Inline markdown → Obsidian-style runs: **bold**, *italic*, `code`,
 * ==highlight==, ~~strike~~, [[wiki links]] (clickable, amber like real
 * Obsidian) and [md](url) links. */
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
        <code key={k++} style={{ background: "var(--cv-ink-fill-active)", borderRadius: 4, padding: "0 4px", fontSize: "0.92em", fontFamily: "var(--cv-font-mono)" }}>
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
export const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|ico)$/i;

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
          border: "1px solid var(--cv-hairline)",
          background: "var(--cv-ink-fill-subtle)", overflow: "hidden",
        }}
      >
        {props.map(([k, v], i) => (
          <div
            key={i}
            style={{
              display: "flex", gap: 10, padding: "4px 12px", fontSize: "var(--cv-text-xxs)",
              borderBottom: i === props.length - 1 ? "none" : "1px solid var(--cv-hairline)",
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
          <pre key={i} style={{ margin: "8px 0", padding: "10px 12px", borderRadius: 8, background: "var(--cv-code-bg)", border: "1px solid var(--cv-hairline)", fontSize: "var(--cv-text-xxs)", fontFamily: "var(--cv-font-mono)", lineHeight: 1.5, overflowX: "auto", color: "var(--cv-ink-dim)" }}>
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
      const size = [20, 16, 14, 13, 13, 13][h[1].length - 1];
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
            style={{ color: "var(--cv-accent)", fontSize: "var(--cv-text-xxs)", cursor: onToggleTask ? "pointer" : "default" }}
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
              fontSize: "var(--cv-text-xs)",
              width: "100%",
              maxWidth: 640,
              border: "1px solid var(--cv-hairline-strong)",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th
                    key={j}
                    style={{ padding: cell, textAlign: "left", color: "var(--cv-accent)", borderBottom: "1px solid var(--cv-hairline-strong)", fontWeight: 700, whiteSpace: "nowrap" }}
                  >
                    {mdInline(c, onLink, onTag, fns, fnScope, entries, onOpenExternal)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, j) => (
                <tr key={j} style={{ background: j % 2 ? "var(--cv-ink-fill-subtle)" : "transparent" }}>
                  {r.map((c, k) => (
                    <td key={k} style={{ padding: cell, borderBottom: "1px solid var(--cv-hairline)", color: "var(--cv-ink)" }}>
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
            <div style={{ color, fontWeight: 700, fontSize: "var(--cv-text-xs)", marginBottom: quote.length > 1 ? 2 : 0 }}>{title}</div>
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
      els.push(<hr key={i} style={{ border: "none", borderTop: "1px solid var(--cv-hairline-strong)", margin: "14px 0" }} />);
      continue;
    }
    if (l.trim() === "") { els.push(<div key={i} style={{ height: 7 }} />); continue; }
    els.push(<div key={i} style={{ margin: "3px 0" }}>{mdInline(l, onLink, onTag, fns, fnScope, entries, onOpenExternal)}</div>);
  }
  if (fns.size) {
    els.push(
      <div key="fns" style={{ margin: "18px 0 4px", borderTop: "1px solid var(--cv-hairline-strong)", paddingTop: 8 }}>
        {[...fnDefs.entries()].map(([id, def]) => (
          <div key={id} id={`${fnScope}vfn-def-${id}`} style={{ margin: "4px 0", fontSize: "var(--cv-text-xs)", color: "var(--cv-ink-dim)", display: "flex", gap: 7 }}>
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
    <div style={{ flex: 1, overflow: "auto", padding: "10px 18px", fontSize: "var(--cv-text-sm)", lineHeight: 1.7, color: "var(--cv-ink)", fontFamily: "inherit" }}>
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
      <div style={{ margin: "6px 0", fontSize: "var(--cv-text-xs)", color: "var(--cv-ink-faint)", fontStyle: "italic" }}>
        ![[{name}]] — note not found
      </div>
    );
  }
  if (isImg) {
    return (
      <div style={{ margin: "10px 0", maxWidth: 640 }}>
        {src === undefined ? (
          <div style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)", fontStyle: "italic" }}>loading image…</div>
        ) : (
          <img
            src={src}
            alt={hit.path}
            title={hit.path}
            style={{ maxWidth: "100%", maxHeight: 420, borderRadius: 8, border: "1px solid var(--cv-hairline)", display: "block" }}
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
        background: "var(--cv-ink-fill-subtle)", padding: "8px 12px 10px",
      }}
    >
      <button
        onClick={() => onLink?.(hit.path)}
        title={`Open ${hit.path}`}
        style={{
          background: "none", border: "none", padding: 0, cursor: "pointer",
          fontSize: "var(--cv-text-xxs)", fontWeight: 700, color: "var(--cv-accent)",
          display: "block", marginBottom: 4,
        }}
      >
        {hit.path.replace(/\.md$/, "")}
      </button>
      {missing ? (
        <div style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)", fontStyle: "italic" }}>loading…</div>
      ) : (
        <ReadingView text={section ? sectionSlice(hit.text!, section) : hit.text!} depth={1} onLink={onLink} onTag={onTag} entries={entries} />
      )}
    </div>
  );
}
