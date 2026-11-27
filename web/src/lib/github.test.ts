import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriMocks.invoke }));

import { ghJson } from "./github";

function enterTauri() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: {},
    configurable: true,
    writable: true,
  });
}

describe("ghJson transport selection", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.unstubAllGlobals();
  });

  it("invokes the native github_proxy command inside the Tauri shell", async () => {
    enterTauri();
    tauriMocks.invoke.mockResolvedValue('[{"number":7}]');
    const data = await ghJson("repos/o/r/pulls?state=open");
    expect(tauriMocks.invoke).toHaveBeenCalledWith("github_proxy", {
      path: "repos/o/r/pulls?state=open",
    });
    expect(data).toEqual([{ number: 7 }]);
  });

  it("surfaces upstream error JSON rather than throwing in Tauri", async () => {
    // Both backends serve upstream error bodies verbatim — shape validation
    // is the caller's job, so the message must arrive parseable.
    enterTauri();
    tauriMocks.invoke.mockResolvedValue('{"message":"github unavailable - install gh or retry later"}');
    const data = (await ghJson("repos/o/r/pulls")) as { message: string };
    expect(data.message).toContain("github unavailable");
  });

  it("fetches the daemon proxy with the bearer token outside Tauri", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ number: 3 }]),
    });
    vi.stubGlobal("fetch", fetchMock);
    const data = await ghJson("repos/o/r/issues");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/github/repos/o/r/issues");
    expect(init.headers.Authorization).toMatch(/^Bearer /);
    expect(data).toEqual([{ number: 3 }]);
  });

  it("falls back to the direct anonymous API when the daemon proxy is unreachable", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("failed to fetch"))
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });
    vi.stubGlobal("fetch", fetchMock);
    const data = await ghJson("repos/o/r/pulls");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.github.com/repos/o/r/pulls");
    expect(data).toEqual([]);
  });

  it("throws a rate-limit specific message on a 403 from the direct API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    vi.stubGlobal("fetch", fetchMock);
    await expect(ghJson("repos/o/r/pulls")).rejects.toThrow("rate limit");
  });
});
