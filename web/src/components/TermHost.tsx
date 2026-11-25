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
      fontFamily: "ui-monospace, Menlo, monospace",
      theme: {
        background: "#121214",
        foreground: "#eceae6",
        cursor: "#c9a26b",
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
    fit.fit();

    const { attachPty, detachPty, sendInput, ptyBuffer, requestTranscript } = useBoard.getState();
    const history = ptyBuffer(agentId);
    if (history?.length) {
      // Replaying scrollback means this card is a restore, not a fresh
      // shell — mark it the way Deska does so the timeline stays honest.
      term.write("\x1b[2m\x1b[3m--- restored session ---\x1b[0m\r\n");
      term.write(history);
    }
    const onBytes = (bytes: Uint8Array) => term.write(bytes);
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

    const ro = new ResizeObserver(() => {
      fit.fit();
      if (term.cols && term.rows && alive()) {
        useBoard.getState().resizePty(agentId, term.cols, term.rows);
      }
    });
    ro.observe(hostRef.current!);
    termRef.current = term;

    return () => {
      sub.dispose();
      oscHandlers.forEach((h) => h.dispose());
      detachPty(agentId, onBytes);
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      searchRef.current = null;
    };
  }, [agentId]);

  useEffect(() => {
    const term = termRef.current;
    if (term && term.options.fontSize !== termFont) {
      term.options.fontSize = termFont;
      term.refresh(0, Math.max(0, term.rows - 1));
    }
  }, [termFont]);

  const findInput = (
    <input
      autoFocus
      value={findQ}
      placeholder="find in buffer"
      onChange={(e) => {
        setFindQ(e.target.value);
        if (e.target.value) searchRef.current?.findNext(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          if (e.shiftKey) searchRef.current?.findPrevious(findQ);
          else searchRef.current?.findNext(findQ);
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
      <div ref={hostRef} className="min-h-0 flex-1" />
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
