import { lazy, Suspense } from "react";

/** xterm + addons are ~93 kB gzip — a third of the old bundle — so the
 * emulator ships in its own chunk and loads the first time a terminal
 * actually becomes visible (drawer pane, canvas terminal card, split).
 * React.lazy caches the module promise: only the first pane pays the fetch,
 * every mirror after that renders synchronously. */
const TermHostInner = lazy(() =>
  import("./TermHost").then((m) => ({ default: m.TermHost })),
);

/** Brief stand-in while the emulator chunk downloads: same dark surface the
 * terminal paints over, so the swap is invisible instead of a flash. */
function TermHostFallback() {
  return (
    <div
      data-testid="terminal-loading"
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0b0e",
        color: "rgba(238,241,245,0.35)",
        fontFamily: "var(--cv-font-mono)",
        fontSize: "var(--cv-text-xxs)",
        letterSpacing: "0.04em",
      }}
    >
      loading terminal…
    </div>
  );
}

export function LazyTermHost({ agentId }: { agentId: string }) {
  return (
    <Suspense fallback={<TermHostFallback />}>
      <TermHostInner agentId={agentId} />
    </Suspense>
  );
}
