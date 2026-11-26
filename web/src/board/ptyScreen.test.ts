import { describe, expect, it } from "vitest";
import { recordPtyBuffer } from "./ptyBufferMeta";
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

  it("resumes at the correct byte when a rolling buffer window has truncated", async () => {
    const agentId = `screen-window-${crypto.randomUUID()}`;
    const encode = (value: string) => new TextEncoder().encode(value);
    const first = encode("0123456789");
    recordPtyBuffer(agentId, undefined, [first], first);
    let flushFirst!: () => void;
    const firstParsed = new Promise<void>((resolve) => { flushFirst = resolve; });
    screenLines(agentId, first, flushFirst);
    await firstParsed;

    // Conceptual stream: 0123456789abcde. The retained window is only its
    // last eight bytes (789abcde), so absolute positions must skip forward to
    // stream offset 10 before feeding the headless screen.
    const appended = encode("abcde");
    const second = encode("789abcde");
    recordPtyBuffer(agentId, first, [appended], second);
    let flushSecond!: () => void;
    const secondParsed = new Promise<void>((resolve) => { flushSecond = resolve; });
    screenLines(agentId, second, flushSecond);
    await secondParsed;

    const visible = screenLines(agentId, undefined).flat().map((span) => span.text).join("");
    expect(visible).toContain("0123456789abcde");
  });
});
