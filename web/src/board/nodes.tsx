import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { AgentNodeData, OrchestratorNodeData } from "./types";

const STATUS: Record<string, { label: string; color: string; halo: string }> = {
  working: { label: "working", color: "var(--cv-working)", halo: "rgba(56,189,248,.22)" },
  waiting: { label: "needs you", color: "var(--cv-waiting)", halo: "rgba(251,191,36,.22)" },
  blocked: { label: "blocked", color: "var(--cv-blocked)", halo: "rgba(248,113,113,.22)" },
  done: { label: "done", color: "var(--cv-done)", halo: "rgba(52,211,153,.18)" },
  idle: { label: "idle", color: "var(--cv-ink-dim)", halo: "rgba(139,148,167,.15)" },
};

export function AgentNode({ data }: NodeProps<Node<AgentNodeData>>) {
  const s = STATUS[data.status] ?? STATUS.idle;
  return (
    <div
      className={`w-64 rounded-xl border bg-[var(--cv-surface)] px-4 py-3 ${
        data.status === "working"
          ? "node-working"
          : data.status === "waiting"
            ? "node-waiting"
            : ""
      }`}
      style={{ borderColor: "var(--cv-border)", ["--halo" as string]: s.halo }}
    >
      <Handle type="target" position={Position.Left} className="!bg-[var(--cv-ink-dim)]" />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-bold"
            style={{ background: "var(--cv-surface-2)", color: "var(--cv-accent)" }}
          >
            {data.cli.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{data.name}</div>
            <div className="text-[11px] text-[var(--cv-ink-dim)]">{data.cli}</div>
          </div>
        </div>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{ color: s.color, background: s.halo }}
        >
          {s.label}
        </span>
      </div>
      {data.task && (
        <div className="mt-2 truncate border-t border-[var(--cv-border)] pt-2 text-xs text-[var(--cv-ink-dim)]">
          {data.task}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!bg-[var(--cv-ink-dim)]" />
    </div>
  );
}

export function OrchestratorNode({ data }: NodeProps<Node<OrchestratorNodeData>>) {
  return (
    <div className="w-72 rounded-2xl border-2 border-[var(--cv-accent)]/60 bg-[var(--cv-surface-2)] px-5 py-4 shadow-[0_0_32px_rgba(34,211,238,.14)]">
      <Handle type="target" position={Position.Left} className="!bg-[var(--cv-accent)]" />
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--cv-accent)]">
        orchestrator
      </div>
      <div className="mt-1 text-base font-bold">{data.name}</div>
      <div className="mt-1 text-xs text-[var(--cv-ink-dim)]">
        {data.activeDelegations} delegation{data.activeDelegations === 1 ? "" : "s"} in flight
      </div>
      <Handle type="source" position={Position.Right} className="!bg-[var(--cv-accent)]" />
    </div>
  );
}
