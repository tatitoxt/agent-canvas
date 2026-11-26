import { test as base, expect } from "@playwright/test";
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
    if (!agents) return;
    for (const a of agents) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ cmd: "confirm_destructive", agent_id: a.agent_id, action: "forget" }));
      }
    }
    // Give the daemon a beat to process the batch before the socket
    // closes — messages are queued in order, so they all land.
    await new Promise((r) => setTimeout(r, 250));
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
