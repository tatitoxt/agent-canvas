// Resize-cascade measurement harness — NOT a playwright test (testMatch only
// picks *.spec.ts). Boots the same canvasd+dist stack as e2e, builds a
// realistic board (3 shell agents, one popped-out term card, an Obsidian
// panel, a pinned note), spreads the cards so hit-tests are clean, then
// performs continuous 2-second gestures while recording:
//   - per-component React render counts (window.__cvRenderCounts probe)
//   - long tasks (PerformanceObserver, >50ms)
//   - CDP Performance metrics: ScriptDuration / TaskDuration / LayoutDuration
//   - localStorage writes and outgoing websocket commands (hot-path check)
// Usage: node e2e/measure-resize.mjs [--out report.json]
import { chromium } from "@playwright/test";
import { startStack, stopStack } from "./stack.mjs";
import { writeFileSync } from "node:fs";
import WebSocket from "ws";

/** Raw control-channel helper: send move_node commands for any node id —
 * the daemon's layout table is generic and replays on boot. */
function wsMoveNodes(port, token, moves) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    const timer = setTimeout(() => { try { ws.close(); } catch { /* gone */ } resolve(); }, 6_000);
    ws.on("open", () => {
      for (const [id, x, y] of moves) ws.send(JSON.stringify({ cmd: "move_node", agent_id: id, x, y }));
      setTimeout(() => { clearTimeout(timer); try { ws.close(); } catch { /* gone */ } resolve(); }, 700);
    });
    ws.on("error", () => { clearTimeout(timer); resolve(); });
  });
}

const INIT = () => {
  window.__cvRenderCounts = {};
  window.__cvLongTasks = [];
  window.__cvLSWrites = [];
  window.__cvWsSends = {};
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__cvLongTasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: "longtask", buffered: true });
  } catch { /* older engine */ }
  const origSet = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (k, v) => {
    try { window.__cvLSWrites.push([k, String(v).length]); } catch { /* probe must never break the app */ }
    return origSet(k, v);
  };
  const origSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    try {
      if (typeof data === "string") {
        const cmd = JSON.parse(data).cmd;
        if (cmd) window.__cvWsSends[cmd] = (window.__cvWsSends[cmd] ?? 0) + 1;
      }
    } catch { /* non-json frame */ }
    return origSend.call(this, data);
  };
};

async function resetProbes(page) {
  await page.evaluate(() => {
    window.__cvRenderCounts = {};
    window.__cvLongTasks = [];
    window.__cvLSWrites = [];
    window.__cvWsSends = {};
  });
}

async function readProbes(page) {
  return page.evaluate(() => ({
    renders: { ...window.__cvRenderCounts },
    longTasks: window.__cvLongTasks.slice(),
    lsWrites: window.__cvLSWrites.slice(),
    wsSends: { ...window.__cvWsSends },
  }));
}

async function cdpMetrics(session) {
  const { metrics } = await session.send("Performance.getMetrics");
  const out = {};
  for (const m of metrics) {
    if (["ScriptDuration", "TaskDuration", "LayoutDuration", "RecalcStyleDuration"].includes(m.name)) out[m.name] = m.value;
  }
  return out;
}

/** Continuous pointer gesture: down at (x,y), then a triangle-wave drift
 * (grow, shrink, grow, shrink) spread over `durationMs` wall time — a real
 * user resize changes direction, and reversing keeps the card inside the
 * viewport so every mousemove produces real geometry change. */
async function continuousGesture(page, x, y, dx, dy, durationMs = 2000) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  const segments = 4;
  const t0 = Date.now();
  // ~55 moves/sec — a fast-but-real 60Hz mouse.
  const totalMoves = Math.floor(durationMs / 18);
  for (let i = 1; i <= totalMoves; i++) {
    const progress = i / totalMoves; // 0..1 over the whole gesture
    const phase = (progress * segments) % 2; // triangle wave 0→2 per segment pair
    const tri = phase < 1 ? phase : 2 - phase; // 0..1..0
    await page.mouse.move(x + dx * tri, y + dy * tri);
    const target = t0 + progress * durationMs;
    const now = Date.now();
    if (target > now) await new Promise((r) => setTimeout(r, target - now));
  }
  await page.mouse.up();
  // Let the trailing commit/rAF flush land before reading counters.
  await page.waitForTimeout(250);
}

/** Find a screen point that hits the bare pane (no card, no chrome) and
 * click it — the reliable deselect gesture. */
async function clickEmptyPane(page) {
  const point = await page.evaluate(() => {
    for (let y = 80; y < window.innerHeight - 40; y += 40) {
      for (let x = 200; x < window.innerWidth - 40; x += 40) {
        const el = document.elementFromPoint(x, y);
        if (el?.classList?.contains("react-flow__pane")) return { x, y };
      }
    }
    return null;
  });
  if (point) await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(250);
}

async function run() {
  const outIdx = process.argv.indexOf("--out");
  const outFile = outIdx >= 0 ? process.argv[outIdx + 1] : null;
  console.log("[measure] starting stack…");
  const { port, token, vault } = await startStack();
  console.log(`[measure] canvasd on :${port}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.log("[pageerror]", String(err).slice(0, 200)));
  await page.addInitScript(INIT);
  await page.addInitScript((v) => localStorage.setItem("cv-vault-dir", v), vault);
  const session = await context.newCDPSession(page);
  await session.send("Performance.enable");

  console.log("[measure] booting app…");
  await page.goto(`http://127.0.0.1:${port}/?token=${token}`);
  await page.locator(".react-flow").waitFor({ timeout: 15_000 });

  // Two shell agents — live PTYs, idle.
  console.log("[measure] spawning 2 shell agents…");
  for (let i = 0; i < 2; i++) {
    await page.locator("button[title='Terminal — spawn a plain shell']").first().click();
    await page.waitForTimeout(1100);
  }

  // Pop the first one out onto the canvas as a term card: open the drawer
  // through the right-click menu, then hit pop-out.
  console.log("[measure] popping out a term card…");
  const node = page.locator(".react-flow__node").first();
  await node.waitFor({ timeout: 8_000 });
  const nb = await node.boundingBox();
  await page.mouse.click(nb.x + 30, nb.y + 30, { button: "right" });
  await page.waitForTimeout(400);
  await page.locator("button", { hasText: "open terminal" }).first().click();
  await page.waitForTimeout(900);
  const popBtn = page.locator("button[title='pop out onto the canvas as a card']").first();
  await popBtn.waitFor({ timeout: 5_000 });
  await popBtn.click();
  const termCard = page.locator(".react-flow__node-term").first();
  await termCard.waitFor({ timeout: 5_000 });
  // Close the drawer so the popped-out term card is the only xterm visible.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // Obsidian panel card on the board.
  console.log("[measure] adding Obsidian panel + pinned note…");
  await page.locator("button[title^='Tools —']").click();
  const dock = page.getByRole("dialog", { name: "Tools panel" });
  await dock.getByRole("button", { name: "Add Obsidian to canvas" }).click();
  const panelCard = page.locator(".react-flow__node-panel").first();
  await panelCard.waitFor({ timeout: 8_000 });

  // Pin the seeded note onto the canvas as an md card.
  const fileRow = page.locator(".react-flow__node-panel [data-panel='vault']").first().locator("button.vault-file").filter({ hasText: "Canvas E2E note" });
  await fileRow.waitFor({ timeout: 10_000 });
  await fileRow.click();
  const reader = page.locator(".react-flow__node-panel [data-panel='vault']").filter({ hasText: "Canvas E2E note" }).last();
  await reader.getByRole("button", { name: "Add to Board" }).waitFor({ timeout: 8_000 });
  await reader.getByRole("button", { name: "Add to Board" }).click();
  const mdCard = page.locator(".react-flow__node[data-id^='md-']").first();
  await mdCard.waitFor({ timeout: 8_000 });
  // "Add to Board" closes the vault panel it came from (the pinned note
  // replaces it). Re-add the panel so the board carries both card types.
  await page.locator("button[title^='Tools —']").click();
  const dock2 = page.getByRole("dialog", { name: "Tools panel" });
  await dock2.getByRole("button", { name: "Add Obsidian to canvas" }).click();
  await page.locator(".react-flow__node-panel").first().waitFor({ timeout: 8_000 });
  // A second panel — the vault panel's content hit-tests over its own resize
  // grip, so the resize measurement targets the sparser Automations panel.
  await page.locator("button[title^='Tools —']").click();
  const dock3 = page.getByRole("dialog", { name: "Tools panel" });
  await dock3.getByRole("button", { name: "Add Automations to canvas" }).click();
  await page.locator(".react-flow__node-panel [data-panel='automations']").first().waitFor({ timeout: 8_000 });

  // ── Deterministic layout: random spawn positions overlap, which poisons
  // hit-tests. Panel/term positions live in localStorage (x/y inside the
  // per-board maps); agents and md notes read the daemon's layout table.
  // Write both, then reload so every card lands in a fixed spread grid.
  console.log("[measure] spreading cards into a fixed grid + reload…");
  const ids = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".react-flow__node")).map((n) => n.getAttribute("data-id")),
  );
  const agents = ids.filter((i) => !/^(term|panel|md|web|shape|orch)-/.test(i));
  const mdId = ids.find((i) => i.startsWith("md-"));
  // Flow-space grid: three columns, generous gutters — no overlap possible.
  const grid = {
    [agents[0]]: [540, 30],
    [agents[1]]: [540, 500],
    [mdId]: [30, 30],
  };
  // term/panel positions live in localStorage — patch their cells directly.
  await page.evaluate(() => {
    const targets = { "term-": [1060, 30], "panel-vault": [1060, 500], "panel-automations": [30, 500] };
    for (const key of ["cv-termnodes", "cv-panelnodes"]) {
      const all = JSON.parse(localStorage.getItem(key) ?? "{}");
      for (const board of Object.keys(all)) {
        for (const id of Object.keys(all[board])) {
          const t = Object.entries(targets).find(([prefix]) => id.startsWith(prefix));
          if (t) { all[board][id].x = t[1][0]; all[board][id].y = t[1][1]; }
        }
      }
      localStorage.setItem(key, JSON.stringify(all));
    }
  });
  await wsMoveNodes(port, token, [
    ...agents.map((id, i) => [id, ...grid[id]]),
    [mdId, ...grid[mdId]],
  ]);
  await page.reload();
  await page.locator(".react-flow").waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  // Frame the whole board so every card is visible for hit-tests.
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true })));
  await page.waitForTimeout(800);

  const layout = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".react-flow__node")).map((n) => {
      const r = n.getBoundingClientRect();
      return { id: n.getAttribute("data-id"), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }),
  );
  console.log("[measure] board layout:", JSON.stringify(layout));

  // Overlap sanity: no two cards may overlap — a failed spread would poison
  // hit-tests. Reported, not fatal: the resize scenarios pick clean handles.
  for (let i = 0; i < layout.length; i++) {
    for (let j = i + 1; j < layout.length; j++) {
      const a = layout[i], b = layout[j];
      const overlapX = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const overlapY = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      if (overlapX > 4 && overlapY > 4) console.log(`[measure] WARNING overlap: ${a.id} × ${b.id} (${overlapX}x${overlapY})`);
    }
  }

  async function measure(label, fn) {
    console.log(`[measure] ── ${label} ──`);
    await resetProbes(page);
    const before = await cdpMetrics(session);
    const t0 = Date.now();
    await fn();
    const wallMs = Date.now() - t0;
    const after = await cdpMetrics(session);
    const probes = await readProbes(page);
    const lt = probes.longTasks;
    const lsKeys = {};
    for (const [k] of probes.lsWrites) lsKeys[k] = (lsKeys[k] ?? 0) + 1;
    const result = {
      label,
      wallMs,
      renders: probes.renders,
      totalRenders: Object.values(probes.renders).reduce((a, b) => a + b, 0),
      longTaskCount: lt.length,
      longTaskTotalMs: Math.round(lt.reduce((a, t) => a + t.duration, 0)),
      longTaskMaxMs: Math.round(Math.max(0, ...lt.map((t) => t.duration))),
      scriptMs: Math.round(((after.ScriptDuration ?? 0) - (before.ScriptDuration ?? 0)) * 1000),
      taskMs: Math.round(((after.TaskDuration ?? 0) - (before.TaskDuration ?? 0)) * 1000),
      layoutMs: Math.round(((after.LayoutDuration ?? 0) - (before.LayoutDuration ?? 0)) * 1000),
      recalcMs: Math.round(((after.RecalcStyleDuration ?? 0) - (before.RecalcStyleDuration ?? 0)) * 1000),
      lsWrites: probes.lsWrites.length,
      lsKeys,
      wsSends: probes.wsSends,
    };
    console.log(`[measure] ${label}: totalRenders=${result.totalRenders} longTasks=${result.longTaskCount}(${result.longTaskTotalMs}ms) script=${result.scriptMs}ms layout=${result.layoutMs}ms lsWrites=${result.lsWrites}`);
    console.log(`          renders: ${JSON.stringify(result.renders)}`);
    console.log(`          lsKeys: ${JSON.stringify(result.lsKeys)} wsSends: ${JSON.stringify(result.wsSends)}`);
    return result;
  }

  const results = [];
  const sleep = (ms) => page.waitForTimeout(ms);

  /** Select a card and return its bottom-right resize grip point, verifying
   * with elementFromPoint that the grip really is the hit target. */
  async function selectAndGrip(card, label) {
    // Click the title bar area — small y offset, clear of content.
    const b = await card.boundingBox();
    const cx = b.x + Math.min(90, b.width / 3);
    const cy = b.y + 10;
    const clean = await page.evaluate(({ x, y, id }) => {
      const el = document.elementFromPoint(x, y);
      const node = el?.closest(".react-flow__node");
      return node?.getAttribute("data-id") === id || node?.contains(document.querySelector(`[data-id="${id}"]`));
    }, { x: cx, y: cy, id: await card.getAttribute("data-id") });
    if (!clean) console.log(`[measure] WARNING ${label}: header hit-test not clean, clicking anyway`);
    await page.mouse.click(cx, cy);
    await sleep(350);
    const handle = card.locator(".react-flow__resize-control.handle.bottom.right");
    await handle.waitFor({ state: "attached", timeout: 5_000 });
    const grip = await handle.boundingBox();
    if (!grip) throw new Error(`${label}: no grip box`);
    // Card content can overlap the grip's center (panel bodies run flush to
    // the card edge) — scan candidate points ordered by distance from the
    // handle center and take the nearest one that hit-tests clean.
    const point = await page.evaluate(({ x, y, w, h }) => {
      const cx = x + w / 2, cy = y + h / 2;
      const candidates = [];
      for (let dy = 0; dy <= h; dy += 1) {
        for (let dx = 0; dx <= w; dx += 1) {
          candidates.push({ x: x + dx, y: y + dy, d: Math.hypot(dx - w / 2, dy - h / 2) });
        }
      }
      candidates.sort((a, b) => a.d - b.d);
      for (const c of candidates) {
        const el = document.elementFromPoint(c.x, c.y);
        if (el?.closest?.(".react-flow__resize-control")) return c;
      }
      return null;
    }, { x: grip.x, y: grip.y, w: grip.width, h: grip.height });
    if (!point) throw new Error(`${label}: no clean grip point in handle rect`);
    return point;
  }

  // ── Baseline: 2s drag of an agent card (the already-optimized gesture) ──
  {
    const card = page.locator(".react-flow__node").filter({ has: page.locator("[data-testid='agent-card-header']") }).first();
    await card.waitFor({ timeout: 8_000 });
    const b = await card.boundingBox();
    results.push(await measure("drag-agent-2s", async () => {
      await continuousGesture(page, b.x + b.width / 2, b.y + 14, 110, 90, 2000);
    }));
    await sleep(600);
  }

  // ── Resize of an agent card, bottom-right corner ──
  {
    const card = page.locator(".react-flow__node").filter({ has: page.locator("[data-testid='agent-card-header']") }).first();
    const grip = await selectAndGrip(card, "resize-agent");
    results.push(await measure("resize-agent-2s", async () => {
      await continuousGesture(page, grip.x, grip.y, 110, 90, 2000);
    }));
    await clickEmptyPane(page);
    await sleep(600);
  }

  // ── Resize of the popped-out terminal card ──
  {
    const grip = await selectAndGrip(termCard, "resize-term");
    results.push(await measure("resize-term-2s", async () => {
      await continuousGesture(page, grip.x, grip.y, 110, 90, 2000);
    }));
    await clickEmptyPane(page);
    await sleep(600);
  }

  // ── Resize of the Automations panel card ──
  {
    const autoPanel = page.locator(".react-flow__node-panel").filter({ has: page.locator("[data-panel='automations']") }).first();
    const grip = await selectAndGrip(autoPanel, "resize-panel");
    results.push(await measure("resize-panel-2s", async () => {
      await continuousGesture(page, grip.x, grip.y, 110, 90, 2000);
    }));
    const w1 = await autoPanel.evaluate((el) => el.getBoundingClientRect().width);
    console.log(`[measure] resize-panel width after: ${Math.round(w1)}`);
    await clickEmptyPane(page);
    await sleep(600);
  }

  // ── Resize of the pinned markdown note ──
  {
    const grip = await selectAndGrip(mdCard, "resize-md");
    results.push(await measure("resize-md-2s", async () => {
      await continuousGesture(page, grip.x, grip.y, 110, 90, 2000);
    }));
    await clickEmptyPane(page);
    await sleep(600);
  }

  const report = { when: new Date().toISOString(), results };
  if (outFile) {
    writeFileSync(outFile, JSON.stringify(report, null, 2));
    console.log(`[measure] report written to ${outFile}`);
  }
  console.log("\n[measure] ══ SUMMARY ══");
  for (const r of results) {
    console.log(`${r.label.padEnd(18)} renders=${String(r.totalRenders).padStart(5)}  longTasks=${String(r.longTaskCount).padStart(3)}/${String(r.longTaskTotalMs).padStart(5)}ms  script=${String(r.scriptMs).padStart(5)}ms  layout=${String(r.layoutMs).padStart(4)}ms  lsWrites=${r.lsWrites}`);
  }

  await browser.close();
  await stopStack();
}

run().catch((err) => {
  console.error(err);
  return stopStack().finally(() => process.exit(1));
});
