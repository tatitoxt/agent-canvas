import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriMocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauriMocks.listen }));

import { TauriCanvasClient } from "./tauriClient";

describe("Tauri PTY startup replay", () => {
  beforeEach(() => vi.resetAllMocks());

  it("waits for listeners, applies the snapshot, then delivers queued PTY history", async () => {
    const eventHandlers: Record<string, (event: { payload: any }) => void> = {};
    tauriMocks.listen.mockImplementation(async (name: string, handler: (event: { payload: any }) => void) => {
      eventHandlers[name] = handler;
      return () => {};
    });

    let resolveSnapshot!: (snapshot: unknown) => void;
    tauriMocks.invoke.mockReturnValue(new Promise((resolve) => { resolveSnapshot = resolve; }));
    const order: string[] = [];
    new TauriCanvasClient({
      onControl: (message) => { if (message.type === "snapshot") order.push("snapshot"); },
      onPty: (_agentId, bytes) => { expect(new TextDecoder().decode(bytes)).toBe("history"); order.push("pty"); },
    });

    await vi.waitFor(() => expect(tauriMocks.invoke).toHaveBeenCalledWith("snapshot"));
    eventHandlers["canvas://pty"]({ payload: { agent_id: "agent-a", data: "aGlzdG9yeQ==" } });
    expect(order).toEqual([]);

    resolveSnapshot({ type: "snapshot" });
    await vi.waitFor(() => expect(order).toEqual(["snapshot", "pty"]));

    eventHandlers["canvas://pty"]({ payload: { agent_id: "agent-a", data: "aGlzdG9yeQ==" } });
    expect(order).toEqual(["snapshot", "pty", "pty"]);
  });
});
