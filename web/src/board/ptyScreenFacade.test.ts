import { describe, expect, it, vi } from "vitest";

/** The lazy facade gets its own file: vi.resetModules poison-resets the
 * module graph, and vitest isolates per file — keeping the reset here stops
 * the facade's second instance from drifting out of alignment with the
 * statically-imported modules the other suite uses. */
describe("pty screen lazy facade", () => {
  it("replays ops queued before the impl chunk loads, dropping pre-reset feeds", async () => {
    // Fresh module graph: the first screenLines call is guaranteed cold —
    // a dynamic import can never resolve synchronously, so all three ops
    // below land in the facade queue and only replay when the chunk arrives.
    vi.resetModules();
    const facade = await import("./ptyScreen");
    const agentId = `lazy-facade-${crypto.randomUUID()}`;
    const encode = (value: string) => new TextEncoder().encode(value);

    facade.screenLines(agentId, encode("stale-before-reset\r\n"));
    facade.resetScreen(agentId);
    let flushed!: () => void;
    const parsed = new Promise<void>((resolve) => { flushed = resolve; });
    facade.screenLines(agentId, encode("fresh-after-reset\r\n"), flushed);
    await parsed;

    const visible = facade.screenLines(agentId, undefined).flat().map((span) => span.text).join("");
    expect(visible).toContain("fresh-after-reset");
    expect(visible).not.toContain("stale-before-reset");
  });

  it("feeds queued without any reset replay in order and in full", async () => {
    vi.resetModules();
    const facade = await import("./ptyScreen");
    const agentId = `lazy-facade-feeds-${crypto.randomUUID()}`;
    const encode = (value: string) => new TextEncoder().encode(value);

    facade.screenLines(agentId, encode("first-line\r\n"));
    let flushed!: () => void;
    const parsed = new Promise<void>((resolve) => { flushed = resolve; });
    facade.screenLines(agentId, encode("first-line\r\nsecond-line\r\n"), flushed);
    await parsed;

    const visible = facade.screenLines(agentId, undefined).flat().map((span) => span.text).join("");
    expect(visible).toContain("first-line");
    expect(visible).toContain("second-line");
  });
});
