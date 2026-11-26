import { test as base, expect } from "@playwright/test";
// Node 20 (the CI runtime) has NO global WebSocket — it only became
// stable in Node 22. A bare `new WebSocket(...)` throws ReferenceError
// here, and because cleanup swallows every error by design, the whole
// per-test agent cleanup silently never ran in CI: PTYs accumulated in
// the shared daemon across the run, the board crowded with overlapping
// agent cards, zoom zoomed out, and late-file tests timed out on
// intercepted clicks. `ws` is already a devDependency — use it explicitly
// so the cleanup works on every Node version.
import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const STATE = resolve(import.meta.dirname, ".e2e-stack.json");

// The whole run shares ONE canvasd (globalSetup). Tests spawn agents
// whose PTYs stay alive in that daemon forever, so every later page
// reload has to rehydrate more scrollback and more snapshot state —
// reloads get slower as the run progresses and late-file timeouts
// cascade (the panels.spec chain failures). After each test, forget
// every agent through the real control path (no test-only backdoor):
// PTYs die, cards disappear, and the next test's reload is as cheap as
// the first. Cleanup must never fail a test — any error is swallowed.
async function forgetAllAgents() {
  let port, token;
  try {
    ({ port, token } = JSON.parse(readFileSync(STATE, "utf8")));
  } catch {
    return;
  }
  let ws;
  try {
    ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    const agents = await new Promise((res) => {
      const timer = setTimeout(() => res(null), 5_000);
      ws.onmessage = (ev) => {
        if (typeof ev.data !== "string") return;
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "snapshot") {
            clearTimeout(timer);
            res(msg.agents ?? []);
          }
        } catch { /* partial frame */ }
      };
      ws.onerror = () => { clearTimeout(timer); res(null); };
    });
    if (!agents || agents.length === 0) return;
    const pending = new Set();
    for (const a of agents) {
      if (ws.readyState === WebSocket.OPEN) {
        pending.add(a.agent_id);
        ws.send(JSON.stringify({ cmd: "confirm_destructive", agent_id: a.agent_id, action: "forget" }));
      }
    }
    // Wait for the daemon's per-forget Status acknowledgements instead of a
    // fixed beat: on a loaded CI runner 250ms is not always enough for the
    // batch to be processed before the socket closes, and a missed forget
    // resurrects the agent in every later test. State-based, capped at 3s —
    // in practice it resolves in a few milliseconds.
    await new Promise((res) => {
      const timer = setTimeout(res, 3_000);
      ws.onmessage = (ev) => {
        if (typeof ev.data !== "string") return;
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "status" && pending.delete(msg.agent_id) && pending.size === 0) {
            clearTimeout(timer);
            res();
          }
        } catch { /* partial frame */ }
      };
      if (pending.size === 0) { clearTimeout(timer); res(); }
    });
  } catch { /* cleanup never fails a test */ } finally {
    try { ws?.close(); } catch { /* gone */ }
  }
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await use(page);
    await forgetAllAgents();
  },
});

export { expect };
