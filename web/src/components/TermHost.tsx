import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useBoard } from "../store/board";

/** The xterm core shared by the bottom drawer (TerminalPanel) and the
 * canvas terminal card (TermNode): mounts the emulator, replays the
 * scrollback buffer, pipes PTY bytes both ways, answers OSC color
 * queries, and keeps the PTY size in sync with the box. */
export function TermHost({ agentId }: { agentId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
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

    const { attachPty, detachPty, sendInput, ptyBuffer, requestTranscript } = useBoard.getState();
    const history = ptyBuffer(agentId);
    if (history?.length) term.write(history);
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
    };
  }, [agentId]);

  useEffect(() => {
    const term = termRef.current;
    if (term && term.options.fontSize !== termFont) {
      term.options.fontSize = termFont;
      term.refresh(0, Math.max(0, term.rows - 1));
    }
  }, [termFont]);

  return <div ref={hostRef} className="min-h-0 flex-1" />;
}
