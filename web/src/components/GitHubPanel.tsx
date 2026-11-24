import { useEffect, useState } from "react";
import { useBoard } from "../store/board";

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
    const rest = `repos/${slug}/${kind === "prs" ? "pulls" : "issues"}?state=open&per_page=30`;
    // canvasd proxies api.github.com (gh CLI auth when installed) — no
    // anonymous rate limit and private repos work too. No daemon → direct.
    const viaDaemon = fetch(`http://127.0.0.1:4242/api/github/${rest}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    viaDaemon
      .catch(() => fetch(`https://api.github.com/${rest}`))
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 403 ? "GitHub rate limit — retry in a bit" : `GitHub ${r.status}`);
        const data = (await r.json()) as any;
        if (dead) return;
        if (!Array.isArray(data)) throw new Error(data?.message ?? "unexpected GitHub response");
        setItems(
          data
            .filter((it) => kind === "prs" || !it.pull_request)
            .map((it) => ({
              number: it.number,
              title: it.title,
              user: it.user?.login ?? "?",
              labels: (it.labels ?? []).map((l: any) => l.name),
              updated: it.updated_at,
              url: it.html_url,
              draft: it.draft,
            })),
        );
      })
      .catch((e) => !dead && setErr(String(e.message ?? e)));
    return () => {
      dead = true;
    };
  }, [slug, kind, tick]);

  return (
    <div
      className="glass"
      style={{
        position: "absolute",
        left: 64,
        top: 64,
        bottom: 64,
        width: 400,
        zIndex: 19,
        display: "flex",
        flexDirection: "column",
        padding: "12px 10px",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", padding: "0 12px 8px" }}>
        <span style={{ fontSize: 12.5, fontWeight: 650, color: "var(--cv-ink)" }}>
          {kind === "prs" ? "Pull requests" : "Issues"}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: "var(--cv-ink-dim)" }}>{slug ?? "no repo"}</span>
        <button
          title="refresh"
          onClick={() => setTick((t) => t + 1)}
          style={{ border: "none", background: "none", color: "var(--cv-ink-dim)", cursor: "pointer", fontSize: 12, padding: "0 0 0 8px" }}
        >
          ↻
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {!slug && <Hint text="This canvas isn't bound to a GitHub repo." />}
        {err && <Hint text={err} />}
        {slug && !err && items === null && <Hint text="loading…" />}
        {items?.length === 0 && <Hint text={kind === "prs" ? "No open pull requests." : "No open issues."} />}
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
            <div style={{ fontSize: 11.5, lineHeight: 1.35 }}>
              <span style={{ color: "var(--cv-ink-dim)", fontFamily: "ui-monospace, monospace" }}>#{it.number}</span>{" "}
              {it.title}
              {it.draft && <span style={{ color: "var(--cv-ink-dim)", fontSize: 10 }}> · draft</span>}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 4, fontSize: 10, color: "var(--cv-ink-dim)", alignItems: "center", flexWrap: "wrap" }}>
              <span>{it.user}</span>
              <span>·</span>
              <span>{age(it.updated)}</span>
              {it.labels.map((l) => (
                <span key={l} style={{ background: "var(--cv-glass-hi)", borderRadius: 999, padding: "1px 7px", fontSize: 9.5 }}>
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
  return <div style={{ padding: "18px 12px", fontSize: 11, color: "var(--cv-ink-dim)", textAlign: "center" }}>{text}</div>;
}
