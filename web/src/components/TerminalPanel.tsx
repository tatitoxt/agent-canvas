import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useBoard } from "../store/board";

type Props = { agentId: string; name: string; onClose: () => void };

export function TerminalPanel({ agentId, name, onClose }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [confirmingKill, setConfirmingKill] = useState(false);
  const kill = useBoard((s) => s.kill);
  const termFont = useBoard((s) => s.termFont);

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
    term.loadAddon(fit);
    term.open(hostRef.current!);
    fit.fit();

    const { attachPty, detachPty, sendInput } = useBoard.getState();
    attachPty(agentId, (bytes) => term.write(bytes));
    const sub = term.onData((d) => sendInput(agentId, new TextEncoder().encode(d)));

    const ro = new ResizeObserver(() => {
      fit.fit();
    });
    ro.observe(hostRef.current!);
    termRef.current = term;

    return () => {
      sub.dispose();
      detachPty(agentId);
      ro.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, [agentId]);

  useEffect(() => {
    const term = termRef.current;
    if (term && term.options.fontSize !== termFont) {
      term.options.fontSize = termFont;
      term.refresh(0, Math.max(0, term.rows - 1));
    }
  }, [termFont]);

  return (
    <div
      className="glass"
      style={{
        position: "absolute",
        bottom: 16,
        right: 16,
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        height: 300,
        width: "36rem",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600 }}>{name}</span>
        <div className="flex items-center gap-2">
          {confirmingKill ? (
            <>
              <span className="text-[10px] text-[var(--cv-blocked)]">confirm kill?</span>
              <button
                className="rounded bg-[var(--cv-blocked)]/20 px-2 py-0.5 text-[10px] font-semibold text-[var(--cv-blocked)]"
                onClick={() => {
                  kill(agentId);
                  setConfirmingKill(false);
                  onClose();
                }}
              >
                kill
              </button>
              <button
                className="text-[10px] text-[var(--cv-ink-dim)]"
                onClick={() => setConfirmingKill(false)}
              >
                cancel
              </button>
            </>
          ) : (
            <button
              className="text-[10px] text-[var(--cv-ink-dim)] hover:text-[var(--cv-blocked)]"
              onClick={() => setConfirmingKill(true)}
            >
              kill
            </button>
          )}
          <button className="text-xs text-[var(--cv-ink-dim)]" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>
      <div ref={hostRef} className="min-h-0 flex-1" />
    </div>
  );
}
