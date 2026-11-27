import { panelRoot } from "./panelChrome";
import { useBoard, acctKey, agentAcctKey, acctLabel, DEFAULT_WEEK_CAP_KB } from "../store/board";
import { CliMark } from "./CliMark";
import { cliMeta } from "../board/nodes";

const fmtBytes = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : n >= 1_000 ? `${(n / 1_000).toFixed(1)} KB` : `${n} B`;

/** Mission Map — the board's command view: who needs you, who is working,
 * what each terminal was last doing, and every live delegation. Usage
 * meters ride along as a secondary section — juice is not a destination
 * of its own. */
export function UsagePanel() {
  const agents = useBoard((s) => s.agents);
  const accounts = useBoard((s) => s.accounts);
  const sessionUse = useBoard((s) => s.sessionUse);
  const ledger = useBoard((s) => s.acctLedger);
  const activeBoard = useBoard((s) => s.activeBoard);
  const requestFocus = useBoard((s) => s.requestFocus);
  const cliIdentities = useBoard((s) => s.cliIdentities);
  const edges = useBoard((s) => s.edges);
  const activityLines = useBoard((s) => s.activityLines);
  const attention = useBoard((s) => s.attention);
  const setEdgeDetail = useBoard((s) => s.setEdgeDetail);

  const boardAgents = Object.values(agents).filter(
    (a) => (a.board_id ?? "main") === activeBoard,
  );

  // Mission groups — same model the status strip uses: attention beats
  // status, so a blocked agent never also reads as working.
  const group = (key: "waiting" | "blocked" | "working" | "done") =>
    boardAgents.filter((a) =>
      key === "blocked"
        ? !!attention[a.id]
        : !attention[a.id] &&
          (key === "done"
            ? a.status === "exited"
            : key === "waiting"
              ? a.status === "waiting"
              : a.status === "working"),
    );
  const missionGroups: { key: string; label: string; color: string; list: typeof boardAgents }[] = [
    { key: "waiting", label: "Needs you", color: "var(--cv-waiting)", list: group("waiting") },
    { key: "blocked", label: "Blocked", color: "var(--cv-blocked)", list: group("blocked") },
    { key: "working", label: "Working", color: "var(--cv-working)", list: group("working") },
    { key: "done", label: "Resting", color: "var(--cv-done)", list: group("done") },
  ];

  const boardEdges = Object.values(edges).filter(
    (e) =>
      (agents[e.from]?.board_id ?? "main") === activeBoard ||
      (agents[e.to]?.board_id ?? "main") === activeBoard,
  );

  // Account rows: registered accounts plus any bucket with usage.
  const keys = new Set<string>([
    ...Object.values(accounts).map((a) => acctKey(a.cli, a.label)),
    ...Object.keys(ledger.bytes),
    ...Object.keys(sessionUse),
    ...Object.values(agents).map((a) => agentAcctKey(a, Object.values(accounts))),
  ]);
  const acctRows = [...keys]
    .map((key) => ({
      key,
      session: sessionUse[key] ?? 0,
      week: ledger.bytes[key] ?? 0,
      capKb: ledger.caps[key] ?? DEFAULT_WEEK_CAP_KB,
      agents: Object.values(agents).filter(
        (a) => agentAcctKey(a, Object.values(accounts)) === key && a.status !== "exited",
      ).length,
    }))
    .sort((a, b) => b.week - a.week);

  const totalBytes = boardAgents.reduce((n, a) => n + (a.output_bytes ?? 0), 0);
  const totalFiles = boardAgents.reduce((n, a) => n + (a.files ?? 0), 0);
  const live = boardAgents.filter(
    (a) => a.status === "working" || a.status === "waiting" || a.status === "blocked",
  ).length;

  const sectionHead = (text: string, color = "var(--cv-ink-faint)") => (
    <div
      style={{
        fontSize: "var(--cv-text-xxs)",
        fontWeight: 400,
        letterSpacing: "0.02em",
        color,
        padding: "8px 12px 2px",
      }}
    >
      {text}
    </div>
  );

  const agentRow = (a: (typeof boardAgents)[number]) => (
    <button
      key={a.id}
      onClick={() => requestFocus(a.id)}
      title={a.worktree ? `${a.name} — ${a.worktree}` : a.name}
      style={{
        display: "grid",
        gridTemplateColumns: "8px 1fr auto",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        border: "1px solid var(--cv-glass-edge)",
        borderRadius: 8,
        background: "transparent",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: 99,
          background: `var(--cv-${a.status === "exited" ? "done" : a.status})`,
        }}
      />
      <span style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: "var(--cv-text-xs)",
            fontWeight: 600,
            color: "var(--cv-ink)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          Terminal {boardAgents.indexOf(a) + 1}
          {a.name ? ` · ${a.name}` : ""}
        </div>
        <div style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-dim)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: cliMeta((a.command ?? "bash").split(/\s+/)[0]).color }}>
            <CliMark cli={(a.command ?? "bash").split(/\s+/)[0]} color={cliMeta((a.command ?? "bash").split(/\s+/)[0]).color} size={10} />
            {cliMeta((a.command ?? "bash").split(/\s+/)[0]).label}
          </span>
          {" · "}{attention[a.id] ? "blocked" : a.status}
          {a.permission ? ` · ${a.permission}` : ""}
          {a.account_label ? ` · ${a.account_label}` : ""}
        </div>
        {(activityLines[a.id] ?? a.lastLine) && (
          <div
            data-testid={`mission-activity-${a.id}`}
            style={{
              fontSize: "var(--cv-text-xxs)",
              color: "var(--cv-ink-faint)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {activityLines[a.id] ?? a.lastLine}
          </div>
        )}
      </span>
      <span style={{ textAlign: "right", fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink)" }}>
        <div>{fmtBytes(a.output_bytes ?? 0)}</div>
        {a.files ? <div style={{ color: "var(--cv-ink-dim)" }}>{a.files} files</div> : null}
      </span>
    </button>
  );

  return (
    <div
      style={{ ...panelRoot, padding: "12px 10px" }}
    >
      <div style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-dim)", padding: "0 12px 10px" }}>
        {boardAgents.length} terminals · {live} active ·{" "}
        {fmtBytes(totalBytes)} output · {totalFiles} file{totalFiles === 1 ? "" : "s"} changed
      </div>
      <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
        {/* missions — the board grouped by who needs what, with the last
            thing each terminal was doing */}
        {boardAgents.length === 0 && (
          <div style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-dim)", padding: "2px 12px 8px" }}>
            No agents on this board — spawn one and it shows up here.
          </div>
        )}
        {missionGroups.map(
          (g) =>
            g.list.length > 0 && (
              <div key={g.key} data-testid={`mission-group-${g.key}`}>
                {sectionHead(`${g.label} · ${g.list.length}`, g.color)}
                {g.list.map(agentRow)}
              </div>
            ),
        )}
        {/* delegations — every mission handed off on this board */}
        {sectionHead(`Delegations · ${boardEdges.length}`)}
        {boardEdges.length === 0 && (
          <div style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-dim)", padding: "2px 12px 8px" }}>
            No delegations yet — wire agents together and their missions land here.
          </div>
        )}
        {boardEdges.map((e) => (
          <button
            key={e.id}
            data-testid={`mission-delegation-${e.id}`}
            onClick={() => setEdgeDetail(e.id)}
            title={e.task}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: "0 10px",
              alignItems: "baseline",
              padding: "6px 10px",
              border: "1px solid var(--cv-glass-edge)",
              borderRadius: 8,
              background: "transparent",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: "var(--cv-text-xs)",
                  fontWeight: 600,
                  color: "var(--cv-ink)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {agents[e.from]?.name ?? e.from} → {agents[e.to]?.name ?? e.to}
              </div>
              <div
                style={{
                  fontSize: "var(--cv-text-xxs)",
                  color: "var(--cv-ink-dim)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {e.task}
              </div>
            </span>
            <span
              style={{
                fontSize: "var(--cv-text-xxs)",
                fontWeight: 600,
                color:
                  e.state === "returned"
                    ? "var(--cv-done)"
                    : e.state === "failed"
                      ? "var(--cv-blocked)"
                      : "var(--cv-waiting)",
              }}
            >
              {e.state}
            </span>
          </button>
        ))}
        {/* usage — juice folded into the mission view, not a destination */}
        {sectionHead("Usage")}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto auto",
            gap: "0 10px",
            padding: "0 12px 4px",
            fontSize: "var(--cv-text-xxs)",
            fontWeight: 400,
            letterSpacing: "0.02em",
            color: "var(--cv-ink-faint)",
          }}
        >
          <span>Account</span>
          <span style={{ textAlign: "right" }}>Session</span>
          <span style={{ textAlign: "right" }}>Week</span>
        </div>
        {acctRows.map((r) => {
          const pct = Math.min(100, (r.week / 1024 / r.capKb) * 100);
          return (
            <div
              key={r.key}
              title={`${acctLabel(r.key)} — ${Math.round(pct)}% of the ${fmtBytes(r.capKb * 1024)} weekly cap${r.agents ? ` · ${r.agents} live` : ""}`}
              style={{
                padding: "6px 10px",
                border: "1px solid var(--cv-glass-edge)",
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto",
                  gap: "0 10px",
                  alignItems: "baseline",
                }}
              >
                <span
                  style={{
                    fontSize: "var(--cv-text-xs)",
                    fontWeight: 600,
                    color: "var(--cv-ink)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {acctLabel(r.key)}
                  {r.agents > 0 && (
                    <span style={{ fontWeight: 400, fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-dim)" }}>
                      {" "}· {r.agents} live
                    </span>
                  )}
                </span>
                <span style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink)", textAlign: "right" }}>
                  {fmtBytes(r.session)}
                </span>
                <span style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-accent)", textAlign: "right" }}>
                  {fmtBytes(r.week)}
                </span>
              </div>
              {/* week-cap meter — milestones toast at 15/30/50/75% */}
              <div
                style={{
                  marginTop: 5,
                  height: 3,
                  borderRadius: 99,
                  background: "var(--cv-glass-edge)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: "100%",
                    borderRadius: 99,
                    background: pct >= 75 ? "var(--cv-blocked)" : pct >= 50 ? "var(--cv-waiting)" : "var(--cv-accent)",
                    transition: "width .4s ease",
                  }}
                />
              </div>
            </div>
          );
        })}
        {/* detected CLI setup — real data from each CLI's own config
            files; quota is honest: no CLI exposes remaining quota
            locally, so it is never invented. */}
        {Object.keys(cliIdentities).length > 0 && (
          <div style={{ padding: "10px 12px 2px", borderTop: "1px solid var(--cv-glass-edge)", marginTop: 8 }}>
            <div style={{ fontSize: "var(--cv-text-xxs)", fontWeight: 400, letterSpacing: "0.02em", color: "var(--cv-ink-faint)", marginBottom: 5 }}>
              Detected setup
            </div>
            {Object.entries(cliIdentities).map(([cli, id]) => (
              <div key={cli} style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-dim)", paddingBottom: 4 }} title={id.source ? `detected from ${id.source}` : undefined}>
                <span style={{ color: "var(--cv-ink)", fontWeight: 600 }}>{cli}</span>
                {" — "}{id.account ?? "account unknown"}{" · default model: "}{id.model ?? "unknown"}{" · quota unknown"}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
