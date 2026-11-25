import { describe, expect, it } from "vitest";
import { resetScreen, screenLines } from "./ptyScreen";

describe("pty screen preview", () => {
  it("signals after xterm has parsed ANSI output and preserves its styles", async () => {
    const agentId = `screen-test-${crypto.randomUUID()}`;
    const bytes = new TextEncoder().encode("\u001b[1;32mpreview-ready\u001b[0m\r\n");
    let flushed!: () => void;
    const parsed = new Promise<void>((resolve) => { flushed = resolve; });

    screenLines(agentId, bytes, flushed);
    await parsed;

    const lines = screenLines(agentId, undefined);
    const output = lines.flat().find((span) => span.text.includes("preview-ready"));
    expect(output?.bold).toBe(true);
    expect(output?.color).toBe("#3ddc84");
  });

  it("rebuilds the visible screen from a replay after reconnect reset", async () => {
    const agentId = `screen-replay-${crypto.randomUUID()}`;
    const oldOutput = new TextEncoder().encode("before-reconnect\r\n");
    const freshTail = new TextEncoder().encode("after-reconnect\r\n");
    let flush!: () => void;
    const parsed = new Promise<void>((resolve) => { flush = resolve; });

    screenLines(agentId, oldOutput);
    await new Promise((resolve) => setTimeout(resolve, 0));
    resetScreen(agentId);
    screenLines(agentId, freshTail, flush);
    await parsed;

    const visible = screenLines(agentId, undefined).flat().map((span) => span.text).join("");
    expect(visible).toContain("after-reconnect");
    expect(visible).not.toContain("before-reconnect");
  });
});
