import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriMocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauriMocks.listen }));

import { TauriCanvasClient } from "./tauriClient";

describe("Tauri PTY startup replay", () => {
  beforeEach(() => vi.resetAllMocks());

  it("settles a native resize only after the command succeeds", async () => {
    tauriMocks.listen.mockImplementation(async () => () => {});
    let resolveResize!: () => void;
    tauriMocks.invoke.mockImplementation((cmd: string) => {
      if (cmd === "snapshot") return Promise.resolve({ type: "snapshot" });
      if (cmd === "pty_resize") return new Promise<void>((resolve) => { resolveResize = resolve; });
      return Promise.resolve(null);
    });
    const controls: unknown[] = [];
    const client = new TauriCanvasClient({ onControl: (message) => controls.push(message), onPty: () => {} });

    const resize = client.resize("agent-a", 91, 23, "resize-1");
    await vi.waitFor(() => expect(tauriMocks.invoke).toHaveBeenCalledWith("pty_resize", { agentId: "agent-a", cols: 91, rows: 23 }));
    expect(controls).toEqual([]);

    resolveResize();
    await expect(resize).resolves.toBe(true);
    expect(controls).toContainEqual({ type: "pty_resized", agent_id: "agent-a", request_id: "resize-1" });
  });

  it("waits for listeners, applies the snapshot, then delivers queued PTY history", async () => {
    const eventHandlers: Record<string, (event: { payload: any }) => void> = {};
    tauriMocks.listen.mockImplementation(async (name: string, handler: (event: { payload: any }) => void) => {
      eventHandlers[name] = handler;
      return () => {};
    });

    let resolveSnapshot!: (snapshot: unknown) => void;
    tauriMocks.invoke.mockReturnValue(new Promise((resolve) => { resolveSnapshot = resolve; }));
    const order: string[] = [];
    const client = new TauriCanvasClient({
      onControl: (message) => { if (message.type === "snapshot") order.push("snapshot"); },
      onPty: (_agentId, bytes) => { expect(new TextDecoder().decode(bytes)).toBe("history"); order.push("pty"); },
    });
    let ready = false;
    void client.whenOpen().then(() => { ready = true; });

    await vi.waitFor(() => expect(tauriMocks.invoke).toHaveBeenCalledWith("snapshot"));
    eventHandlers["canvas://pty"]({ payload: { agent_id: "agent-a", data: "aGlzdG9yeQ==" } });
    expect(order).toEqual([]);
    expect(ready).toBe(false);

    resolveSnapshot({ type: "snapshot" });
    await vi.waitFor(() => expect(order).toEqual(["snapshot", "pty"]));
    await vi.waitFor(() => expect(ready).toBe(true));

    eventHandlers["canvas://pty"]({ payload: { agent_id: "agent-a", data: "aGlzdG9yeQ==" } });
    expect(order).toEqual(["snapshot", "pty", "pty"]);
  });

  it("surfaces a rejected spawn_agent invoke through onError instead of silence", async () => {
    tauriMocks.listen.mockImplementation(async () => () => {});
    tauriMocks.invoke.mockImplementation((cmd: string) => {
      if (cmd === "snapshot") return Promise.resolve({ type: "snapshot" });
      if (cmd === "spawn_agent") {
        return Promise.reject("git worktree add failed: fatal: Needed a single revision");
      }
      return Promise.resolve(null);
    });
    const errors: string[] = [];
    const client = new TauriCanvasClient({
      onControl: () => {},
      onPty: () => {},
      onError: (message) => errors.push(message),
    });

    client.spawnAgent("Terminal", "bash");
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]).toContain("git worktree add failed");
  });

  it("surfaces delegate rejections and formats non-string rejection reasons", async () => {
    tauriMocks.listen.mockImplementation(async () => () => {});
    tauriMocks.invoke.mockImplementation((cmd: string) => {
      if (cmd === "snapshot") return Promise.resolve({ type: "snapshot" });
      if (cmd === "delegate") return Promise.reject(new Error("pty open failed"));
      return Promise.resolve(null);
    });
    const errors: string[] = [];
    const client = new TauriCanvasClient({
      onControl: () => {},
      onPty: () => {},
      onError: (message) => errors.push(message),
    });

    client.delegate("node-a", "Terminal", "bash", "do the thing");
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]).toBe("pty open failed");
  });

  it("forwards setAgentChain to the native command with the workspace's chain", async () => {
    tauriMocks.listen.mockImplementation(async () => () => {});
    tauriMocks.invoke.mockImplementation((cmd: string) => {
      if (cmd === "snapshot") return Promise.resolve({ type: "snapshot" });
      return Promise.resolve(null);
    });
    const client = new TauriCanvasClient({ onControl: () => {}, onPty: () => {} });

    client.setAgentChain("ws-1", ["claude", "codex"]);
    await vi.waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("set_agent_chain", {
        workspaceId: "ws-1",
        chain: ["claude", "codex"],
      }),
    );
  });

  it("surfaces a rejected set_agent_chain invoke through onError", async () => {
    tauriMocks.listen.mockImplementation(async () => () => {});
    tauriMocks.invoke.mockImplementation((cmd: string) => {
      if (cmd === "snapshot") return Promise.resolve({ type: "snapshot" });
      if (cmd === "set_agent_chain") return Promise.reject("no such workspace");
      return Promise.resolve(null);
    });
    const errors: string[] = [];
    const client = new TauriCanvasClient({
      onControl: () => {},
      onPty: () => {},
      onError: (message) => errors.push(message),
    });

    client.setAgentChain("ws-gone", ["codex"]);
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]).toBe("no such workspace");
  });
});
