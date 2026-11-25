import { useEffect } from "react";
import { NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import type { MdNodeData } from "../board/types";
import { ReadingView, resolveNotePath } from "./VaultPanel";
import { useBoard } from "../store/board";

/** A live Obsidian vault note pinned as an interactive canvas window. */
const POLL_MS = 4000;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|ico)$/i;

export function MdNode({ id, data, selected }: NodeProps<Node<MdNodeData>>) {
  const text = useBoard((s) => s.mdContents[data.path]);
  const entries = useBoard((s) => s.vaultEntries);
  const mdNodeRemove = useBoard((s) => s.mdNodeRemove);
  const resizeMdNode = useBoard((s) => s.resizeMdNode);
  const boardId = useBoard((s) => s.activeBoard);
  const basename = data.path.split("/").pop() ?? data.path;

  useEffect(() => {
    const tick = () => useBoard.getState().vaultRead(data.path);
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => clearInterval(t);
  }, [data.path]);

  const openLinkedNote = (name: string) => {
    const base = name.split("#")[0].trim();
    const path = resolveNotePath(entries, base);
    if (path) useBoard.getState().vaultRead(path);
  };
  const resolveEmbed = (name: string) => {
    const isImage = IMAGE_RE.test(name);
    const path = entries.find((entry) => entry === name || entry.endsWith(`/${name}`) ||
      (!isImage && (entry === `${name}.md` || entry.endsWith(`/${name}.md`) || entry.replace(/\.md$/, "") === name)));
    return path ? { path, text: useBoard.getState().mdContents[path] } : null;
  };

  return (
    <div className="glass-panel" style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: 12, border: "1px solid var(--cv-glass-edge)" }}>
      <NodeResizer isVisible={selected} minWidth={260} minHeight={180} handleClassName="cv-node-resize-handle" lineClassName="cv-node-resize-line"
        onResize={(_, p) => resizeMdNode(id, Math.round(p.width), Math.round(p.height), false, boardId)}
        onResizeEnd={(_, p) => resizeMdNode(id, Math.round(p.width), Math.round(p.height), true, boardId)} />
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid var(--cv-glass-edge)", fontSize: 11, color: "var(--cv-ink-dim)" }}>
        <img src="/obsidian.svg" alt="" width={12} height={12} />
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{basename}</span>
        <span style={{ fontSize: 9, color: "var(--cv-waiting)" }}>LIVE VAULT</span>
        <button className="nodrag" aria-label={`Remove ${basename} from board`} title="Remove from board" onClick={() => mdNodeRemove(id)}
          style={{ background: "none", border: "none", color: "var(--cv-ink-dim)", cursor: "pointer", fontSize: 13 }}>×</button>
      </div>
      {text == null ? <div style={{ padding: 12, color: "var(--cv-ink-faint)", fontSize: 11 }}>Loading note…</div> : (
        <ReadingView text={text} entries={entries} onLink={openLinkedNote}
          embedLookup={resolveEmbed}
          embedFetch={(path) => useBoard.getState().vaultPeek(path)}
          embedAsset={(path) => useBoard.getState().vaultAssets[path]}
          embedAssetFetch={(path) => useBoard.getState().vaultAsset(path)} />
      )}
    </div>
  );
}
