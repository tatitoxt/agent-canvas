import { useEffect, useState } from "react";
import { useBoard } from "../store/board";
import { panelRoot } from "./panelChrome";

/** Repository explorer and lightweight editor for registered workspaces. */
export function RepoExplorerPanel() {
  const workspaces = useBoard((s) => s.workspaces);
  const entries = useBoard((s) => s.repoEntries);
  const cachedFiles = useBoard((s) => s.repoFiles);
  const repoTree = useBoard((s) => s.repoTree);
  const repoRead = useBoard((s) => s.repoRead);
  const repoWrite = useBoard((s) => s.repoWrite);
  const notice = useBoard((s) => s.notice);
  const explorerDir = useBoard((s) => s.explorerDir);
  const repos = [...new Set([...Object.values(workspaces).map((w) => w.repo), ...(explorerDir ? [explorerDir] : [])])];
  const [dir, setDir] = useState<string>(explorerDir ?? repos[0] ?? "");
  // Per-agent file buttons aim the explorer at a worktree — follow them.
  useEffect(() => {
    if (explorerDir) setDir(explorerDir);
  }, [explorerDir]);
  const [sel, setSel] = useState<string | null>(null);
  const file = sel ? cachedFiles[`${dir}\u0000${sel}`] ?? null : null;
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [baseText, setBaseText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveRequest, setSaveRequest] = useState<{ dir: string; path: string; text: string } | null>(null);

  useEffect(() => {
    if (!file) return;
    if (saving && saveRequest?.dir === dir && file.path === saveRequest.path && file.text === saveRequest.text) {
      setSaving(false);
      setEditing(false);
      setSaveError("");
      setBaseText(file.text);
    } else if (!editing || file.path !== sel) {
      setBaseText(file.text);
    }
  }, [file, saving, editing, sel, draft, saveRequest, dir]);

  useEffect(() => {
    if (notice?.startsWith("error —") && saving) {
      setSaving(false);
      setSaveError(notice.replace(/^error —\s*/, ""));
    }
  }, [notice, saving]);

  const beginEdit = () => {
    if (!file) return;
    setDraft(file.text);
    setBaseText(file.text);
    setSaveError("");
    setEditing(true);
  };
  const save = () => {
    if (!file || !editing || saving) return;
    const serializedDraft = baseText.includes("\r\n") ? draft.replace(/\r?\n/g, "\r\n") : draft.replace(/\r\n/g, "\n");
    const request = { dir, path: file.path, text: serializedDraft };
    setSaveRequest(request);
    setSaving(true);
    repoWrite(dir, file.path, serializedDraft, baseText);
  };
  const selectFile = (path: string) => {
    if (saving) return;
    if (editing && draft !== baseText) {
      setSaveError("Save or cancel this draft before opening another file.");
      return;
    }
    setEditing(false);
    setSaveError("");
    setSel(path);
    repoRead(dir, path);
  };

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
              onClick={() => selectFile(p)}
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
      <div style={{ flex: 1, overflow: "auto", minWidth: 0, minHeight: 0, background: "color-mix(in srgb, var(--cv-base) 42%, transparent)" }}>
        {file ? (
          <>
            <div style={{
              position: "sticky", top: 0, zIndex: 1, minWidth: "max-content",
              padding: "9px 12px 8px", borderBottom: "1px solid var(--cv-glass-edge)",
              background: "color-mix(in srgb, var(--cv-base) 94%, transparent)",
              backdropFilter: "blur(12px)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 650, color: "var(--cv-ink)" }}>{base(file.path)}</div>
                  <div title={file.path} style={{ marginTop: 3, fontSize: 9.5, fontFamily: "monospace", color: "var(--cv-ink-faint)", whiteSpace: "nowrap" }}>{file.path}</div>
                </div>
                {!editing ? (
                  <button className="nodrag" onClick={beginEdit} aria-label={`Edit ${base(file.path)}`} style={editorButton}>Edit</button>
                ) : (
                  <>
                    <span role="status" style={{ color: saveError ? "var(--cv-blocked)" : saving ? "var(--cv-waiting)" : "var(--cv-ink-faint)", fontSize: 9.5 }}>
                      {saveError ? (saveError.includes("changed on disk") ? "CONFLICT" : "ERROR") : saving ? "SAVING" : draft === baseText ? "SAVED" : "UNSAVED"}
                    </span>
                    {saveError && <span style={{ color: "var(--cv-blocked)", fontSize: 9.5, maxWidth: 180, whiteSpace: "normal" }}>{saveError.includes("changed on disk") ? "This file changed on disk. Reload it before saving your draft." : saveError}</span>}
                    {saveError && <button className="nodrag" onClick={() => { setEditing(false); setSaveError(""); repoRead(dir, file.path); }} style={editorButton}>Reload</button>}
                    <button className="nodrag" onClick={save} disabled={saving || draft === baseText || !!saveError} style={editorButton}>Save</button>
                    <button className="nodrag" onClick={() => { setDraft(file.text); setEditing(false); setSaveError(""); }} style={editorButton}>Cancel</button>
                  </>
                )}
              </div>
            </div>
            {editing ? (
              <textarea
                aria-label={`Edit contents of ${file.path}`}
                className="nodrag nowheel"
                value={draft}
                spellCheck={false}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "s") { event.preventDefault(); save(); } if (event.key === "Escape") { setDraft(file.text); setEditing(false); setSaveError(""); } }}
                style={{ flex: 1, minWidth: 0, minHeight: 0, width: "100%", boxSizing: "border-box", resize: "none", border: 0, outline: 0, padding: "9px 12px", background: "transparent", color: "var(--cv-ink)", font: "11px/1.65 var(--cv-font-mono, monospace)", tabSize: 2 }}
              />
            ) : (
              <div aria-label={`Contents of ${file.path}`} style={{ minWidth: "max-content", padding: "9px 0 14px", fontFamily: "var(--cv-font-mono, monospace)", fontSize: 11, lineHeight: 1.65, color: "var(--cv-ink)" }}>
                {file.text.split("\n").map((line, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "42px max-content", minHeight: "1.65em" }}>
                    <span aria-hidden="true" style={{ paddingRight: 10, textAlign: "right", color: "var(--cv-ink-faint)", userSelect: "none", borderRight: "1px solid var(--cv-glass-edge)", marginRight: 12 }}>{i + 1}</span>
                    <code style={{ font: "inherit", whiteSpace: "pre", paddingRight: 16 }}>{line || " "}</code>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={{ height: "100%", minHeight: 180, display: "grid", placeItems: "center", padding: 14, color: "var(--cv-ink-faint)", textAlign: "center" }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--cv-ink-dim)", marginBottom: 5 }}>Choose a file to preview</div>
              <div style={{ fontSize: 10.5 }}>Select a repository file from the list.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const editorButton: React.CSSProperties = {
  border: "1px solid var(--cv-glass-edge)", borderRadius: 6, padding: "4px 8px",
  background: "var(--cv-glass-hi)", color: "var(--cv-ink)", fontSize: 10,
  cursor: "pointer", whiteSpace: "nowrap",
};
