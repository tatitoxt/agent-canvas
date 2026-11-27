import { useBoard } from "../store/board";

/** Keep transport/write failures visible beside the PTY that caused them. */
export function TerminalError({ agentId }: { agentId: string }) {
  const message = useBoard((s) => s.terminalErrors[agentId]);
  const dismiss = useBoard((s) => s.dismissTerminalError);
  if (!message) return null;

  return (
    <div
      role="alert"
      data-testid="terminal-error"
      className="flex shrink-0 items-start gap-2 border-b border-red-400/20 bg-red-950/45 px-3 py-2 text-xs text-red-100"
    >
      <span className="min-w-0 flex-1 break-words">{message}</span>
      <button
        type="button"
        aria-label="Dismiss terminal error"
        className="shrink-0 rounded px-1 text-red-200/70 hover:bg-white/10 hover:text-white"
        onClick={() => dismiss(agentId)}
      >
        ×
      </button>
    </div>
  );
}
