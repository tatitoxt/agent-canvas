import type { AgentStatus } from "../board/types";

type Props = { counts: Record<AgentStatus, number> };

const ITEMS: { key: AgentStatus; label: string; color: string }[] = [
  { key: "working", label: "running", color: "var(--cv-working)" },
  { key: "waiting", label: "needs you", color: "var(--cv-waiting)" },
  { key: "blocked", label: "blocked", color: "var(--cv-blocked)" },
  { key: "done", label: "done", color: "var(--cv-done)" },
];

export function MissionStrip({ counts }: Props) {
  return (
    <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b border-[var(--cv-border)] bg-[var(--cv-base)]/85 px-5 py-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <span className="text-sm font-bold tracking-wide">AGENT CANVAS</span>
        <span className="rounded-md bg-[var(--cv-surface-2)] px-2 py-0.5 text-[11px] text-[var(--cv-ink-dim)]">
          prototype · mock data
        </span>
      </div>
      <div className="flex items-center gap-4">
        {ITEMS.map(({ key, label, color }) => (
          <div key={key} className="flex items-center gap-1.5 text-xs">
            <span className="h-2 w-2 rounded-full" style={{ background: color }} />
            <span className="font-semibold" style={{ color }}>
              {counts[key] ?? 0}
            </span>
            <span className="text-[var(--cv-ink-dim)]">{label}</span>
          </div>
        ))}
      </div>
    </header>
  );
}
