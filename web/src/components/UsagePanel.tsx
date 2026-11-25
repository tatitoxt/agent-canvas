import { panelRoot } from "./panelChrome";
import { useBoard, acctKey, agentAcctKey, acctLabel, DEFAULT_WEEK_CAP_KB } from "../store/board";

const fmtBytes = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : n >= 1_000 ? `${(n / 1_000).toFixed(1)} KB` : `${n} B`;

/** Juice — usage grouped per account: "<CLI> — <account>" rows with a
 * session column (bytes since this client connected) and a week column
 * (persisted ledger). Below, the per-agent rows of the active board. */
export function UsagePanel() {
  const agents = useBoard((s) => s.agents);
  const accounts = useBoard((s) => s.accounts);
  const sessionUse = useBoard((s) => s.sessionUse);
  const ledger = useBoard((s) => s.acctLedger);
  const activeBoard = useBoard((s) => s.activeBoard);
  const requestFocus = useBoard((s) => s.requestFocus);
  const cliIdentities = useBoard((s) => s.cliIdentities);

  const boardAgents = Object.values(agents).filter(
    (a) => (a.board_id ?? "main") === activeBoard,
  );
  const list = [...boardAgents].sort(
    (a, b) => (b.output_bytes ?? 0) - (a.output_bytes ?? 0),
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

  return (
    <div
      style={{ ...panelRoot, padding: "12px 10px" }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 650, padding: "0 12px 8px", color: "var(--cv-ink)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        Juice
      </div>
      <div style={{ fontSize: 10, color: "var(--cv-ink-dim)", padding: "0 12px 10px" }}>
        {boardAgents.length} agent{boardAgents.length === 1 ? "" : "s"} · {live} live ·{" "}
        {fmtBytes(totalBytes)} output · {totalFiles} file{totalFiles === 1 ? "" : "s"} changed
      </div>
      <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
        {/* per-account usage — Deska's session vs week view */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto auto",
            gap: "0 10px",
            padding: "0 12px 4px",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: 0.8,
            textTransform: "uppercase",
            color: "var(--cv-ink-faint)",
          }}
        >
          <span>account</span>
          <span style={{ textAlign: "right" }}>session</span>
          <span style={{ textAlign: "right" }}>week</span>
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
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: "var(--cv-ink)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {acctLabel(r.key)}
                  {r.agents > 0 && (
                    <span style={{ fontWeight: 400, fontSize: 9.5, color: "var(--cv-ink-dim)" }}>
                      {" "}· {r.agents} live
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 10, color: "var(--cv-ink)", textAlign: "right" }}>
                  {fmtBytes(r.session)}
                </span>
                <span style={{ fontSize: 10, color: "var(--cv-accent)", textAlign: "right" }}>
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
        {/* per-agent rows for this board */}
        <div
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: 0.8,
            textTransform: "uppercase",
            color: "var(--cv-ink-faint)",
            padding: "8px 12px 2px",
          }}
        >
          this board
        </div>
        {boardAgents.length === 0 && (
          <div style={{ fontSize: 11, color: "var(--cv-ink-dim)", padding: "2px 12px 8px" }}>
            No agents on this board — spawn one and watch its meter.
          </div>
        )}
        {list.map((a) => (
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
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "var(--cv-ink)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                Terminal {boardAgents.indexOf(a) + 1}
                {a.command ? ` · ${a.command}` : ""}
              </div>
              <div style={{ fontSize: 9.5, color: "var(--cv-ink-dim)" }}>
                {a.status}
                {a.permission ? ` · ${a.permission}` : ""}
                {a.account_label ? ` · ${a.account_label}` : ""}
              </div>
            </span>
            <span style={{ textAlign: "right", fontSize: 10, color: "var(--cv-ink)" }}>
              <div>{fmtBytes(a.output_bytes ?? 0)}</div>
              {a.files ? <div style={{ color: "var(--cv-ink-dim)" }}>{a.files} files</div> : null}
            </span>
          </button>
        ))}
        {/* detected CLI setup — real data from each CLI's own config
            files; quota is honest: no CLI exposes remaining quota
            locally, so it is never invented. */}
        {Object.keys(cliIdentities).length > 0 && (
          <div style={{ padding: "10px 12px 2px", borderTop: "1px solid var(--cv-glass-edge)", marginTop: 8 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--cv-ink-faint)", marginBottom: 5 }}>
              detected setup
            </div>
            {Object.entries(cliIdentities).map(([cli, id]) => (
              <div key={cli} style={{ fontSize: 10, color: "var(--cv-ink-dim)", paddingBottom: 4 }} title={id.source ? `detected from ${id.source}` : undefined}>
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
