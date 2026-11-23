import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useBoard } from "../store/board";

type Props = { agentId: string; name: string; onClose: () => void };

export function TerminalPanel({ agentId, name, onClose }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [confirmingKill, setConfirmingKill] = useState(false);
  const kill = useBoard((s) => s.kill);

  useEffect(() => {
    const term = new Terminal({
      fontSize: 13,
      fontFamily: "ui-monospace, Menlo, monospace",
      theme: {
        background: "#0b0e14",
        foreground: "#e6e9f0",
        cursor: "#22d3ee",
        selectionBackground: "#232c3d",
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
      useBoard.getState();
    });
    ro.observe(hostRef.current!);

    return () => {
      sub.dispose();
      detachPty(agentId);
      ro.disconnect();
      term.dispose();
    };
  }, [agentId]);

  return (
    <div className="absolute bottom-0 right-0 z-20 m-4 flex h-72 w-[34rem] flex-col overflow-hidden rounded-xl border border-[var(--cv-border)] bg-[var(--cv-base)] shadow-2xl">
      <div className="flex items-center justify-between border-b border-[var(--cv-border)] bg-[var(--cv-surface)] px-3 py-1.5">
        <span className="text-xs font-semibold">{name}</span>
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
      <div ref={hostRef} className="min-h-0 flex-1 p-1" />
    </div>
  );
}
