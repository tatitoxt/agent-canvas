import { describe, expect, it } from "vitest";
import { ptyBufferWindow, recordPtyBuffer, resetPtyBufferWindow } from "./ptyBufferMeta";

const CAP = 65_536;
function appendCapped(prev: Uint8Array | undefined, chunks: Uint8Array[]) {
  const pendingLength = chunks.reduce((n, chunk) => n + chunk.length, 0);
  const merged = new Uint8Array((prev?.length ?? 0) + pendingLength);
  let offset = 0;
  if (prev) {
    merged.set(prev, 0);
    offset = prev.length;
  }
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged.length > CAP ? merged.subarray(merged.length - CAP) : merged;
}

describe("pty buffer stream positions", () => {
  it("tracks the left edge when the rolling window truncates", () => {
    const agentId = `meta-${crypto.randomUUID()}`;
    const first = new Uint8Array(CAP).fill(97);
    recordPtyBuffer(agentId, undefined, [first], first);
    expect(ptyBufferWindow(first)).toEqual({ start: 0, end: CAP });

    const appended = new Uint8Array(100).fill(98);
    const second = appendCapped(first, [appended]);
    recordPtyBuffer(agentId, first, [appended], second);
    expect(second.length).toBe(CAP);
    expect(ptyBufferWindow(second)).toEqual({ start: 100, end: CAP + 100 });

    const more = new Uint8Array(20).fill(99);
    const third = appendCapped(second, [more]);
    recordPtyBuffer(agentId, second, [more], third);
    expect(ptyBufferWindow(third)).toEqual({ start: 120, end: CAP + 120 });
    resetPtyBufferWindow(agentId);
  });

  it("reset starts the next replay at byte zero", () => {
    const agentId = `meta-reset-${crypto.randomUUID()}`;
    const first = new Uint8Array([1, 2, 3]);
    recordPtyBuffer(agentId, undefined, [first], first);
    resetPtyBufferWindow(agentId);

    const replay = new Uint8Array([4]);
    recordPtyBuffer(agentId, undefined, [replay], replay);
    expect(ptyBufferWindow(replay)).toEqual({ start: 0, end: 1 });
  });
});
