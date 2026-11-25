import { describe, expect, it } from "vitest";
import { screenLines } from "./ptyScreen";

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
});
