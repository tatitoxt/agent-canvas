import { useEffect, useState } from "react";
import { panelRoot } from "./panelChrome";
import { useBoard } from "../store/board";
import { Icon } from "./icons";
import { EmptyState } from "./EmptyState";

const TOKEN = (import.meta.env.VITE_CANVAS_TOKEN as string | undefined) ??
  new URLSearchParams(location.search).get("token") ??
  "";

type Item = {
  number: number;
  title: string;
  user: string;
  labels: string[];
  updated: string;
  url: string;
  draft?: boolean;
  sha?: string;
  ci?: "pass" | "fail" | "pending" | "none";
};

const CI_COLOR: Record<NonNullable<Item["ci"]>, string> = {
  pass: "var(--cv-working)",
  fail: "var(--cv-blocked)",
  pending: "var(--cv-waiting)",
  none: "var(--cv-ink-faint)",
};

function repoSlug(repoUrl: string | null): string | null {
  const m = repoUrl?.match(/github\.com\/([^/]+\/[^/]+)/);
  return m ? m[1].replace(/\.git$/, "") : null;
}

function age(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "1d" : `${d}d`;
}

/** Live GitHub PR/issue lists for the repo this canvas runs on (public API,
 * no token — 60 req/h). The web-node pin can't iframe github.com, so this is
 * the real panel. */
export function GitHubPanel({ kind }: { kind: "prs" | "issues" }) {
  const repoUrl = useBoard((s) => s.repoUrl);
  const slug = repoSlug(repoUrl);
  const [items, setItems] = useState<Item[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!slug) return;
    let dead = false;
    setItems(null);
    setErr(null);
    // canvasd proxies api.github.com (gh CLI auth when installed) — no
    // anonymous rate limit and private repos work too. No daemon → direct.
    const base =
      location.port === "5174" ? "http://127.0.0.1:4242" : location.origin;
    const gh = (rest: string) =>
      fetch(`${base}/api/github/${rest}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      }).catch(() => fetch(`https://api.github.com/${rest}`));
    gh(`repos/${slug}/${kind === "prs" ? "pulls" : "issues"}?state=open&per_page=30`)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 403 ? "GitHub rate limit — retry in a bit" : `GitHub ${r.status}`);
        const data = (await r.json()) as any;
        if (dead) return;
        if (!Array.isArray(data)) throw new Error(data?.message ?? "unexpected GitHub response");
        const rows: Item[] = data
          .filter((it) => kind === "prs" || !it.pull_request)
          .map((it) => ({
            number: it.number,
            title: it.title,
            user: it.user?.login ?? "?",
            labels: (it.labels ?? []).map((l: any) => l.name),
            updated: it.updated_at,
            url: it.html_url,
            draft: it.draft,
            sha: it.head?.sha,
          }));
        setItems(rows);
        useBoard.setState((s) => ({ ghCounts: { ...s.ghCounts, [kind]: rows.length } }));
        // Second pass: CI roll-up per PR head (status check aggregate).
        if (kind === "prs") {
          rows.forEach((it, i) => {
            if (!it.sha) return;
            gh(`repos/${slug}/commits/${it.sha}/check-runs?per_page=50`)
              .then((res) => res.json())
              .then((cr: any) => {
                if (dead || !Array.isArray(cr?.check_runs)) return;
                const runs = cr.check_runs;
                const ci: Item["ci"] =
                  runs.length === 0 ? "none"
                  : runs.some((x: any) => x.conclusion === "failure" || x.conclusion === "cancelled") ? "fail"
                  : runs.every((x: any) => x.status === "completed") ? "pass"
                  : "pending";
                setItems((cur) =>
                  cur ? cur.map((c, j) => (j === i ? { ...c, ci } : c)) : cur,
                );
              })
              .catch(() => {});
          });
        }
      })
      .catch((e) => !dead && setErr(String(e.message ?? e)));
    return () => {
      dead = true;
    };
  }, [slug, kind, tick]);

  return (
    <div
      data-panel={kind}
      style={{ ...panelRoot, padding: "12px 10px" }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 12px 8px", flexShrink: 0 }}>
        <span style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-dim)", paddingLeft: 8 }}>{slug ?? "no repo"}</span>
        <button
          title="Open on github.com — this repo in your browser"
          onClick={() => window.open(slug ? `https://github.com/${slug}` : "https://github.com", "_blank")}
          style={{ border: "none", background: "none", color: "var(--cv-ink-dim)", cursor: "pointer", padding: "0 0 0 8px", display: "flex", alignItems: "center" }}
        >
          <Icon name="openin" size={12} />
        </button>
        <button
          title="refresh"
          onClick={() => setTick((t) => t + 1)}
          style={{ border: "none", background: "none", color: "var(--cv-ink-dim)", cursor: "pointer", fontSize: "var(--cv-text-xs)", padding: "0 0 0 8px" }}
        >
          ↻
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {!slug && <Hint text="This canvas isn't bound to a GitHub repo." />}
        {err && <Hint text={err} />}
        {slug && !err && items === null && <Hint text="loading…" />}
        {items?.length === 0 && (
          <EmptyState
            compact
            icon={kind === "prs" ? "pr" : "issue"}
            title={kind === "prs" ? "No open pull requests" : "No open issues"}
          >
            {kind === "prs"
              ? "Nothing waiting on review — the repo is quiet."
              : "The tracker is clear — nothing open right now."}
          </EmptyState>
        )}
        {items?.map((it) => (
          <button
            key={it.number}
            onClick={() => window.open(it.url, "_blank")}
            className="glass"
            style={{
              display: "block",
              width: "calc(100% - 8px)",
              margin: "0 4px 6px",
              padding: "8px 10px",
              textAlign: "left",
              cursor: "pointer",
              border: "none",
              color: "var(--cv-ink)",
            }}
          >
            <div style={{ fontSize: "var(--cv-text-xs)", lineHeight: 1.35 }}>
              <span style={{ color: "var(--cv-ink-dim)", fontFamily: "var(--cv-font-mono)" }}>#{it.number}</span>{" "}
              {it.title}
              {it.draft && <span style={{ color: "var(--cv-ink-dim)", fontSize: "var(--cv-text-xxs)" }}> · draft</span>}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 4, fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-dim)", alignItems: "center", flexWrap: "wrap" }}>
              {it.ci && (
                <span
                  title={`CI: ${it.ci}`}
                  style={{ width: 7, height: 7, borderRadius: "50%", background: CI_COLOR[it.ci], flexShrink: 0 }}
                />
              )}
              <span>{it.user}</span>
              <span>·</span>
              <span>{slug?.split("/")[1]}</span>
              <span>·</span>
              <span>{age(it.updated)}</span>
              {it.labels.map((l) => (
                <span key={l} style={{ background: "var(--cv-glass-hi)", borderRadius: 999, padding: "1px 7px", fontSize: "var(--cv-text-xxs)" }}>
                  {l}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Hint({ text }: { text: string }) {
  return <div style={{ padding: "18px 12px", fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-dim)", textAlign: "center" }}>{text}</div>;
}
