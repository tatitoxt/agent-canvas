/** Stream positions for the rolling PTY buffers kept in zustand.
 *
 * The visible byte array is only a bounded window. Absolute positions let
 * consumers tell "no new bytes" apart from "the window advanced and dropped
 * its left edge" once the buffer reaches its 64 KiB cap. This module is
 * deliberately separate from the store so ptyScreen can read positions
 * without importing the store (which already imports ptyScreen). */
export type PtyBufferWindow = {
  /** Absolute stream position of merged[0]. */
  start: number;
  /** Absolute stream position one past the end of merged. */
  end: number;
};

const byBuffer = new WeakMap<Uint8Array, PtyBufferWindow>();
const byAgent = new Map<string, PtyBufferWindow>();

export function recordPtyBuffer(
  agentId: string,
  prev: Uint8Array | undefined,
  chunks: Uint8Array[],
  merged: Uint8Array,
) {
  const appended = chunks.reduce((n, chunk) => n + chunk.length, 0);
  const prior = byAgent.get(agentId);
  // The fallback only matters for a hot-reloaded module or a synthetic test
  // buffer: without prior metadata, treat the pre-existing window as the
  // beginning of its stream.
  const end = (prior?.end ?? prev?.length ?? 0) + appended;
  const start = Math.max(0, end - merged.length);
  const window = { start, end };
  byAgent.set(agentId, window);
  byBuffer.set(merged, window);
}

export function resetPtyBufferWindow(agentId: string) {
  byAgent.delete(agentId);
}

export function ptyBufferWindow(buf: Uint8Array | undefined): PtyBufferWindow | undefined {
  return buf ? byBuffer.get(buf) : undefined;
}
