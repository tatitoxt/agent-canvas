import { useState } from "react";
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

/** Render markdown as lightweight reading view: headings, lists, code, links. */
function ReadingView({ text }: { text: string }) {
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "12px 14px", fontSize: 12, lineHeight: 1.65, color: "var(--cv-ink)" }}>
      {text.split("\n").map((l, i) => {
        const h = l.match(/^(#{1,4})\s+(.*)/);
        if (h) {
          const size = [18, 15, 13.5, 12][h[1].length - 1];
          return (
            <div key={i} style={{ fontSize: size, fontWeight: 700, margin: "14px 0 6px", color: "var(--cv-ink)" }}>
              {h[2]}
            </div>
          );
        }
        if (/^\s*[-*•]\s+/.test(l)) {
          return (
            <div key={i} style={{ paddingLeft: 14, margin: "2px 0" }}>
              <span style={{ color: "var(--cv-accent)", marginRight: 6 }}>•</span>
              {l.replace(/^\s*[-*•]\s+/, "")}
            </div>
          );
        }
        if (/^\s*```/.test(l)) return null;
        if (l.trim() === "") return <div key={i} style={{ height: 8 }} />;
        return (
          <div key={i} style={{ margin: "2px 0" }}>
            {l.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1")}
          </div>
        );
      })}
    </div>
  );
}

/** Graph view — the note's [[wiki links]] as clickable cards. */
function GraphView({ text, onOpen }: { text: string; onOpen: (name: string) => void }) {
  const links = [...new Set(
    [...text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim()),
  )];
  const mdLinks = [...new Set(
    [...text.matchAll(/\[([^\]]+)\]\(([^)]+\.md)\)/g)].map((m) => m[2].trim()),
  )];
  const all = [...new Set([...links, ...mdLinks])];
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "12px 14px" }}>
      {all.length === 0 && (
        <div style={{ fontSize: 11, color: "var(--cv-ink-faint)" }}>no links in this note</div>
      )}
      {all.map((l) => (
        <button
          key={l}
          onClick={() => onOpen(l)}
          style={{
            display: "block", width: "100%", textAlign: "left", marginBottom: 6,
            padding: "8px 12px", borderRadius: 10, border: "1px solid var(--cv-glass-edge)",
            background: "var(--cv-glass-hi)", color: "var(--cv-ink)", fontSize: 11.5, cursor: "pointer",
          }}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** "Generate PDF" menu — pick a template or ask for anything; the doc is
 * built from live board state, exported as .pdf and saved to artifacts. */
function GeneratePdfMenu({ onPick, onAsk }: {
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
  const [dir, setDir] = useState(vaultDir || "/home/ubuntu/repos/agent-canvas");
  const [filter, setFilter] = useState("");
  const [view, setView] = useState<"reading" | "source" | "graph">("reading");
  const [genOpen, setGenOpen] = useState(false);

  const shown = vaultEntries.filter((e) =>
    e.toLowerCase().includes(filter.toLowerCase()),
  );

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
          width: 320,
          zIndex: 19,
          display: "flex",
          flexDirection: "column",
          padding: "12px 10px",
          overflow: "hidden",
        }}
      >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px 8px" }}>
        <span style={{ fontSize: 12.5, fontWeight: 650, color: "var(--cv-ink)" }}>Vault</span>
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
          placeholder={`${vaultEntries.length} notes — filter…`}
          style={{ margin: "0 4px 8px", background: "var(--cv-glass-hi)", border: "1px solid var(--cv-glass-edge)", borderRadius: 999, padding: "5px 12px", fontSize: 11, color: "var(--cv-ink)", outline: "none" }}
        />
      )}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {shown.map((e) => (
          <button
            key={e}
            onClick={() => vaultRead(e)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              border: "none",
              background: vaultFile?.path === e ? "var(--cv-glass-hi)" : "transparent",
              color: "var(--cv-ink)",
              fontSize: 11.5,
              padding: "6px 12px",
              borderRadius: 8,
              cursor: "pointer",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ color: "var(--cv-ink-dim)" }}>✎ </span>
            {e}
            <span
              role="button"
              title="pin as live card on the board"
              onClick={(ev) => {
                ev.stopPropagation();
                useBoard.getState().mdNodeAdd(e);
              }}
              style={{ float: "right", color: "var(--cv-ink-dim)", cursor: "pointer", padding: "0 4px" }}
            >
              ⌖
            </span>
          </button>
        ))}
      </div>
      </div>
      {vaultFile && (
        <div
          className="glass"
          style={{
            position: "absolute",
            left: 396,
            top: 64,
            bottom: 64,
            width: 520,
            zIndex: 20,
            display: "flex",
            flexDirection: "column",
            padding: "14px 16px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--cv-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {vaultFile.path}
            </span>
            <div style={{ display: "flex", gap: 5, alignItems: "center", flexShrink: 0 }}>
              <button style={actionBtn} title="Pin this note as a live card on the board" onClick={() => useBoard.getState().mdNodeAdd(vaultFile.path)}>
                Add to Board
              </button>
              <button style={actionBtn} title="Export as PDF (saved to artifacts)" onClick={exportFile}>
                <Icon name="shot" size={11} /> Export PDF
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
          {view === "reading" && <ReadingView text={vaultFile.text} />}
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
              onOpen={(name) => {
                const hit = vaultEntries.find((e) => e === name || e.endsWith(`/${name}.md`) || e === `${name}.md` || e.replace(/\.md$/, "") === name);
                if (hit) vaultRead(hit);
              }}
            />
          )}
        </div>
      )}
    </>
  );
}
