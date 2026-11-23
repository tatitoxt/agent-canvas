import { useEffect, useRef, useState } from "react";

/** Where the floating terminal panel sits — default bottom-right (Deska-style
 * dock position) until the user pops it out by dragging the header. */
const DEFAULT_POS = { x: -1, y: -1 }; // sentinel: anchored, not popped out
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useBoard } from "../store/board";

type Props = { agentId: string; name: string; index?: number; onClose: () => void };

export function TerminalPanel({ agentId, name, index = 0, onClose }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [confirmingKill, setConfirmingKill] = useState(false);
  const kill = useBoard((s) => s.kill);
  const termFont = useBoard((s) => s.termFont);
  const [pos, setPos] = useState(DEFAULT_POS);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  // Voice dictation — Web Speech API is free/on-device-ish, unlike
  // Deska's metered voice minutes. Dictates text into the PTY.
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);

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
    // Transcript: replay buffered scrollback so an opened terminal shows
    // history (daemon replay also feeds this buffer on reconnect).
    const history = ptyBuffer(agentId);
    if (history?.length) term.write(history);
    attachPty(agentId, (bytes) => term.write(bytes));
    // Exited agent: pull its persisted transcript from the daemon — it
    // arrives as PTY output through the listener just attached.
    if (useBoard.getState().agents[agentId]?.status === "exited") {
      requestTranscript(agentId);
    }
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
      recRef.current?.stop?.();
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

  const toggleDictation = () => {
    if (listening) {
      recRef.current?.stop?.();
      setListening(false);
      return;
    }
    const SR =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      const text = e.results[e.results.length - 1][0].transcript;
      if (text) {
        useBoard.getState().sendInput(agentId, new TextEncoder().encode(text + " "));
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  const popped = pos.x >= 0;
  const panelStyle: React.CSSProperties = popped
    ? { position: "absolute", left: pos.x, top: pos.y, zIndex: 20 }
    : { position: "absolute", bottom: 16 + index * 28, right: 16 + index * 28, zIndex: 20 };

  const onHeaderDown = (e: React.PointerEvent) => {
    const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 120, ev.clientX - d.dx)),
        y: Math.max(48, Math.min(window.innerHeight - 60, ev.clientY - d.dy)),
      });
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      className="glass"
      style={{
        ...panelStyle,
        display: "flex",
        flexDirection: "column",
        height: 300,
        width: "36rem",
        overflow: "hidden",
      }}
    >
      <div
        onPointerDown={onHeaderDown}
        title={popped ? "drag to move" : "drag to pop out onto the canvas"}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          cursor: "grab",
          userSelect: "none",
          touchAction: "none",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600 }}>{name}</span>
        <div
          className="flex items-center gap-2"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            title={listening ? "stop dictation" : "dictate into this terminal"}
            onClick={toggleDictation}
            style={{
              border: "none",
              background: "transparent",
              fontSize: 11,
              cursor: "pointer",
              color: listening ? "var(--cv-blocked)" : "var(--cv-ink-dim)",
              animation: listening ? "pulse-dot 1.2s ease-in-out infinite" : "none",
            }}
          >
            {listening ? "◉" : "🎙"}
          </button>
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
