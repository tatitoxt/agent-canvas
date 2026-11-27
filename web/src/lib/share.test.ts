import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriMocks.invoke }));

import { shareArtifactPdf } from "./share";

function enterTauri() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: {},
    configurable: true,
    writable: true,
  });
}

describe("shareArtifactPdf transport selection", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.unstubAllGlobals();
  });

  it("publishes through the native share_create command inside Tauri", async () => {
    enterTauri();
    tauriMocks.invoke.mockResolvedValue({
      id: "0123456789abcdef",
      url: "http://127.0.0.1:50123/share/0123456789abcdef",
    });
    const url = await shareArtifactPdf("weekly digest", "# hello\nworld");
    expect(tauriMocks.invoke).toHaveBeenCalledTimes(1);
    const [cmd, args] = tauriMocks.invoke.mock.calls[0];
    expect(cmd).toBe("share_create");
    expect(args.title).toBe("weekly digest");
    expect(args.mime).toBe("application/pdf");
    // The body is the client-built PDF, base64 — no daemon rendering needed.
    expect(typeof args.b64).toBe("string");
    expect(atob(args.b64).startsWith("%PDF-1.4")).toBe(true);
    // Native returns the absolute URL verbatim — there is no web origin.
    expect(url).toBe("http://127.0.0.1:50123/share/0123456789abcdef");
  });

  it("returns null inside Tauri when the command rejects", async () => {
    enterTauri();
    tauriMocks.invoke.mockRejectedValue("share server unavailable — restart the app");
    expect(await shareArtifactPdf("t", "x")).toBeNull();
  });

  it("posts to the daemon /api/share outside Tauri and resolves the relative URL against the origin", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "abc", url: "/share/abc" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const url = await shareArtifactPdf("digest", "body");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [target, init] = fetchMock.mock.calls[0];
    expect(target).toContain("/api/share");
    expect(init.method).toBe("POST");
    const payload = JSON.parse(init.body);
    expect(payload.mime).toBe("application/pdf");
    expect(payload.title).toBe("digest");
    expect(url).toBe(`${location.origin}/share/abc`);
  });

  it("returns null outside Tauri when the daemon is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("failed to fetch")));
    expect(await shareArtifactPdf("t", "x")).toBeNull();
  });
});
