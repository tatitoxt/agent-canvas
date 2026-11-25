import { useEffect, useState } from "react";
import { useBoard } from "../store/board";
import { panelRoot } from "./panelChrome";

/** Repo explorer — file tree of a workspace repo plus a read-only code
 * viewer. Browse/read go through the daemon's allowed-roots sandbox. */
export function RepoExplorerPanel() {
  const workspaces = useBoard((s) => s.workspaces);
  const entries = useBoard((s) => s.repoEntries);
  const file = useBoard((s) => s.repoFile);
  const repoTree = useBoard((s) => s.repoTree);
  const repoRead = useBoard((s) => s.repoRead);
  const notice = useBoard((s) => s.notice);
  const explorerDir = useBoard((s) => s.explorerDir);
  const repos = [...new Set([...Object.values(workspaces).map((w) => w.repo), ...(explorerDir ? [explorerDir] : [])])];
  const [dir, setDir] = useState<string>(explorerDir ?? repos[0] ?? "");
  // Per-agent file buttons aim the explorer at a worktree — follow them.
  useEffect(() => {
    if (explorerDir) setDir(explorerDir);
  }, [explorerDir]);
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!dir && repos.length) setDir(repos[0]);
  }, [repos, dir]);

  useEffect(() => {
    if (dir) {
      setSel(null);
      repoTree(dir);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir]);

  if (!repos.length) {
    return (
      <div style={{ ...panelRoot, padding: 16, fontSize: 12, color: "var(--cv-ink-dim)" }}>
        No workspaces yet — create one to browse its repository.
      </div>
    );
  }

  const depth = (p: string) => p.split("/").length - 1;
  const base = (p: string) => p.split("/").pop() ?? p;
  const visibleEntries = entries.filter((p) => p.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div style={{ ...panelRoot, flexDirection: "row", minHeight: 0 }}>
      <div style={{ width: "42%", borderRight: "1px solid var(--cv-glass-edge)", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <select
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          style={{ margin: 6, fontSize: 11, background: "transparent", color: "var(--cv-ink)", border: "1px solid var(--cv-glass-edge)", borderRadius: 6, padding: "3px 6px" }}
        >
          {repos.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <div style={{ position: "relative", margin: "0 6px 7px" }}>
          <input
            type="search"
            aria-label="Filter repository files"
            placeholder="Filter files…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{
              width: "100%", boxSizing: "border-box", height: 28, padding: "0 9px",
              background: "var(--cv-glass-hi)", color: "var(--cv-ink)",
              border: "1px solid var(--cv-glass-edge)", borderRadius: 7,
              fontSize: 10.5, fontFamily: "inherit", outline: "none",
            }}
          />
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0 4px 8px" }}>
          {entries.length === 0 && (
            <div style={{ padding: 10, fontSize: 11, color: "var(--cv-ink-faint)" }}>
              {notice?.includes("access denied") ? notice : "loading…"}
            </div>
          )}
          {entries.length > 0 && visibleEntries.length === 0 && (
            <div style={{ padding: 10, fontSize: 11, color: "var(--cv-ink-faint)" }}>No files match “{filter}”.</div>
          )}
          {visibleEntries.map((p) => (
            <button
              key={p}
              onClick={() => { setSel(p); repoRead(dir, p); }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                border: "none",
                background: sel === p ? "var(--cv-glass-edge)" : "transparent",
                color: "var(--cv-ink)",
                fontSize: 11,
                fontFamily: "monospace",
                padding: "2px 4px",
                paddingLeft: 4 + depth(p) * 10,
                cursor: "pointer",
                borderRadius: 4,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={p}
            >
              {base(p)}
            </button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: 8 }}>
        {file ? (
          <>
            <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--cv-ink-faint)", marginBottom: 6 }}>{file.path}</div>
            <pre style={{ margin: 0, fontSize: 11, fontFamily: "monospace", color: "var(--cv-ink)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{file.text}</pre>
          </>
        ) : (
          <div style={{ padding: 10, fontSize: 11, color: "var(--cv-ink-faint)" }}>select a file</div>
        )}
      </div>
    </div>
  );
}
