import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import { useBoard } from "../store/board";

/** The xterm core shared by the bottom drawer (TerminalPanel) and the
 * canvas terminal card (TermNode): mounts the emulator, replays the
 * scrollback buffer, pipes PTY bytes both ways, answers OSC color
 * queries, and keeps the PTY size in sync with the box. */
const DECOR = { matchBackground: "#7a5a1e", matchOverviewRuler: "#e8b25a", activeMatchBackground: "#e8b25a", activeMatchColorOverviewRuler: "#ffffff" };


/** tmux-style grouped clients: several TermHosts can mirror the same PTY
 * (split panes). One PTY has ONE size — the smallest pane wins, recomputed
 * on every resize, so both views render identically instead of fighting
 * over the width and corrupting reflow. */
type Mirror = { term: Terminal; fit: FitAddon; host: HTMLDivElement };
const mirrors = new Map<string, Set<Mirror>>();

function syncMirroredSize(agentId: string) {
  const set = mirrors.get(agentId);
  if (!set || set.size === 0) return;
  let cols = Infinity;
  let rows = Infinity;
  for (const m of set) {
    const d = m.fit.proposeDimensions();
    if (!d) continue;
    cols = Math.min(cols, d.cols);
    rows = Math.min(rows, d.rows);
  }
  if (!isFinite(cols) || !isFinite(rows) || cols < 1 || rows < 1) return;
  for (const m of set) {
    if (m.term.cols !== cols || m.term.rows !== rows) m.term.resize(cols, rows);
  }
  if (useBoard.getState().agents[agentId]?.status !== "exited") {
    useBoard.getState().resizePty(agentId, cols, rows);
  }
}

export function TermHost({ agentId }: { agentId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const termFont = useBoard((s) => s.termFont);
  // In-terminal find — a mini bar over the buffer (next/prev, Enter=next).
  const [findOpen, setFindOpen] = useState(false);
  const [findQ, setFindQ] = useState("");

  useEffect(() => {
    const term = new Terminal({
      fontSize: useBoard.getState().termFont,
      fontFamily: "\"IBM Plex Mono\", ui-monospace, Menlo, monospace",
      theme: {
        background: "#121214",
        foreground: "#eceae6",
        cursor: "#f5a524",
        selectionBackground: "rgba(255,255,255,0.12)",
      },
      convertEol: true,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    searchRef.current = search;
    term.open(hostRef.current!);
    const mirror: Mirror = { term, fit, host: hostRef.current! };
    if (!mirrors.has(agentId)) mirrors.set(agentId, new Set());
    mirrors.get(agentId)!.add(mirror);
    syncMirroredSize(agentId);

    const { attachPty, detachPty, sendInput, ptyBuffer, requestTranscript } = useBoard.getState();
    const history = ptyBuffer(agentId);
    if (history?.length) {
      // Replaying scrollback means this card is a restore, not a fresh
      // shell — mark it the way Deska does so the timeline stays honest.
      term.write("\x1b[2m\x1b[3m--- restored session ---\x1b[0m\r\n");
      term.write(history);
    }
    const onBytes = (bytes: Uint8Array | null) => {
      if (bytes === null) {
        term.reset();
        return;
      }
      term.write(bytes);
    };
    attachPty(agentId, onBytes);
    if (useBoard.getState().agents[agentId]?.status === "exited") {
      requestTranscript(agentId);
    }
    const alive = () => useBoard.getState().agents[agentId]?.status !== "exited";
    const sub = term.onData((d) => {
      if (alive()) sendInput(agentId, new TextEncoder().encode(d));
    });

    const reply = (text: string) =>
      sendInput(agentId, new TextEncoder().encode(`\x1b]${text}\x07`));
    const oscReplies: Record<number, string> = {
      10: "10;rgb:ecec/eaea/e6e6",
      11: "11;rgb:1212/1212/1414",
      12: "12;rgb:c9c9/a2a2/6b6b",
    };
    const oscHandlers = Object.entries(oscReplies).map(([ps, answer]) =>
      term.parser.registerOscHandler(Number(ps), (data) => {
        if (data === "?") reply(answer);
        return true;
      })
    );

    const ro = new ResizeObserver(() => syncMirroredSize(agentId));
    ro.observe(hostRef.current!);
    termRef.current = term;

    return () => {
      sub.dispose();
      oscHandlers.forEach((h) => h.dispose());
      detachPty(agentId, onBytes);
      ro.disconnect();
      mirrors.get(agentId)?.delete(mirror);
      syncMirroredSize(agentId);
      term.dispose();
      termRef.current = null;
      searchRef.current = null;
    };
  }, [agentId]);

  useEffect(() => {
    const activeMirrors = mirrors.get(agentId);
    if (!activeMirrors) return;
    for (const mirror of activeMirrors) {
      if (mirror.term.options.fontSize !== termFont) {
        mirror.term.options.fontSize = termFont;
        mirror.term.refresh(0, Math.max(0, mirror.term.rows - 1));
        mirror.fit.fit();
      }
    }
  }, [agentId, termFont]);

  const findInput = (
    <input
      autoFocus
      value={findQ}
      placeholder="find in buffer"
      onChange={(e) => {
        setFindQ(e.target.value);
        if (e.target.value) searchRef.current?.findNext(e.target.value, { decorations: DECOR });
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          if (e.shiftKey) searchRef.current?.findPrevious(findQ, { decorations: DECOR });
          else searchRef.current?.findNext(findQ, { decorations: DECOR });
        }
        if (e.key === "Escape") {
          setFindOpen(false);
          // Hand focus back to xterm — otherwise the next keystrokes are lost.
          termRef.current?.focus();
        }
      }}
      style={{
        width: 130,
        fontSize: 10.5,
        padding: "3px 8px",
        borderRadius: 999,
        border: "1px solid var(--cv-glass-edge)",
        background: "rgba(18,18,20,0.92)",
        color: "var(--cv-ink)",
        outline: "none",
      }}
    />
  );

  return (
    <div className="min-h-0 flex-1" style={{ position: "relative", display: "flex", flexDirection: "column" }}>
      {findOpen && (
        <div
          className="nodrag"
          style={{
            display: "flex",
            gap: 4,
            alignItems: "center",
            justifyContent: "flex-end",
            padding: "2px 8px",
            borderBottom: "1px solid var(--cv-glass-edge)",
            background: "rgba(18,18,20,0.6)",
          }}
        >
          {findInput}
          <button
            title="previous match (shift+enter)"
            onClick={() => searchRef.current?.findPrevious(findQ)}
            style={{ background: "none", border: "none", color: "var(--cv-ink-dim)", cursor: "pointer", fontSize: 11, padding: "0 2px" }}
          >
            ↑
          </button>
          <button
            title="next match (enter)"
            onClick={() => searchRef.current?.findNext(findQ)}
            style={{ background: "none", border: "none", color: "var(--cv-ink-dim)", cursor: "pointer", fontSize: 11, padding: "0 2px" }}
          >
            ↓
          </button>
          <button
            title="close find"
            onClick={() => {
              setFindOpen(false);
              termRef.current?.focus();
            }}
            style={{ background: "none", border: "none", color: "var(--cv-ink-dim)", cursor: "pointer", fontSize: 11, padding: "0 2px" }}
          >
            ✕
          </button>
        </div>
      )}
      <div ref={hostRef} className="min-h-0 min-w-0 flex-1" style={{ minWidth: 0 }} />
      <div
        className="nodrag"
        style={{ position: "absolute", top: findOpen ? 30 : 6, right: 8, display: findOpen ? "none" : "flex", gap: 4, alignItems: "center", zIndex: 5 }}
      >
        <button
          title="find in terminal buffer"
          onClick={() => setFindOpen((v) => !v)}
          style={{ background: "none", border: "none", color: findOpen ? "var(--cv-accent)" : "var(--cv-ink-dim)", cursor: "pointer", fontSize: 12, padding: "0 2px" }}
        >
          ⌕
        </button>
      </div>
    </div>
  );
}
