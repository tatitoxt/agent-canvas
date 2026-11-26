import { describe, expect, it } from "vitest";
import { PtyWriteBuffer } from "./ptyWriteBuffer";

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (chunk: Uint8Array) => new TextDecoder().decode(chunk);

describe("pty write buffer", () => {
  it("writes synchronously while active", () => {
    const writes: Uint8Array[] = [];
    const gate = new PtyWriteBuffer((chunk) => writes.push(chunk));
    const input = bytes("live");

    gate.push(input);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toBe(input); // no copy on the interactive path
    expect(gate.queuedByteCount()).toBe(0);
  });

  it("queues offscreen bytes and flushes them in order when visible again", () => {
    const writes: string[] = [];
    const gate = new PtyWriteBuffer((chunk) => writes.push(text(chunk)));

    gate.setActive(false);
    gate.push(bytes("first-"));
    gate.push(bytes("second-"));
    gate.push(bytes("third"));
    expect(writes).toEqual([]);
    expect(gate.queuedByteCount()).toBe("first-second-third".length);

    gate.setActive(true);

    expect(writes).toEqual(["first-second-third"]);
    expect(gate.queuedByteCount()).toBe(0);
    gate.push(bytes("-live"));
    expect(writes).toEqual(["first-second-third", "-live"]);
  });

  it("forces one coalesced write at the high-water mark instead of dropping output", () => {
    const writes: string[] = [];
    const gate = new PtyWriteBuffer((chunk) => writes.push(text(chunk)), 8);

    gate.setActive(false);
    gate.push(bytes("abcd"));
    expect(writes).toEqual([]);
    gate.push(bytes("efgh"));

    expect(writes).toEqual(["abcdefgh"]);
    expect(gate.isActive()).toBe(false);
    expect(gate.queuedByteCount()).toBe(0);

    gate.push(bytes("tail"));
    expect(writes).toEqual(["abcdefgh"]);
    gate.setActive(true);
    expect(writes).toEqual(["abcdefgh", "tail"]);
  });

  it("reset clears a superseded offscreen stream before a replay", () => {
    const writes: string[] = [];
    const gate = new PtyWriteBuffer((chunk) => writes.push(text(chunk)));

    gate.setActive(false);
    gate.push(bytes("old-stream"));
    gate.reset();
    expect(gate.queuedByteCount()).toBe(0);
    gate.push(bytes("replay"));
    gate.setActive(true);

    expect(writes).toEqual(["replay"]);
  });
});
