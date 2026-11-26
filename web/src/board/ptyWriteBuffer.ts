/**
 * Correctness-first write gate for terminals that are outside the viewport.
 *
 * While inactive, PTY chunks are queued instead of parsed/rendered by xterm.
 * The queue is bounded not by dropping bytes — output is never discarded — but
 * by forcing one coalesced xterm write at a high-water mark. That fallback is
 * intentional: with a hard no-loss guarantee there is no cheaper place to put
 * unbounded output, so sustained very-large streams still pay their parse cost
 * instead of growing memory without limit.
 */
export const OFFSCREEN_WRITE_HIGH_WATER_BYTES = 256 * 1024;

export class PtyWriteBuffer {
  private active = true;
  private chunks: Uint8Array[] = [];
  private queuedBytes = 0;

  constructor(
    private readonly write: (bytes: Uint8Array) => void,
    private readonly highWaterBytes = OFFSCREEN_WRITE_HIGH_WATER_BYTES,
  ) {}

  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    if (active) this.flush();
  }

  isActive() {
    return this.active;
  }

  queuedByteCount() {
    return this.queuedBytes;
  }

  push(bytes: Uint8Array) {
    if (bytes.length === 0) return;
    if (this.active) {
      this.write(bytes);
      return;
    }
    // websocket frames are subarrays of their enclosing packet. Copy just the
    // payload so a queued tail cannot pin a larger transport buffer alive.
    const copy = new Uint8Array(bytes);
    this.chunks.push(copy);
    this.queuedBytes += copy.length;
    if (this.queuedBytes >= this.highWaterBytes) this.flush();
  }

  /** Drop queued bytes ONLY when the terminal itself is reset for a replay.
   * This is not output loss: the replay bytes replace the old stream. */
  reset() {
    this.chunks = [];
    this.queuedBytes = 0;
  }

  private flush() {
    if (this.queuedBytes === 0) return;
    let merged: Uint8Array;
    if (this.chunks.length === 1) {
      merged = this.chunks[0];
    } else {
      merged = new Uint8Array(this.queuedBytes);
      let offset = 0;
      for (const chunk of this.chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
    }
    this.chunks = [];
    this.queuedBytes = 0;
    this.write(merged);
  }
}
