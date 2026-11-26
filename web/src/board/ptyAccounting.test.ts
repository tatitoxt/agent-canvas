import { describe, expect, it } from "vitest";
import { PTY_SCROLLBACK_BYTES, replayedPtyBytes } from "./ptyAccounting";

describe("PTY reconnect usage accounting", () => {
  it("skips the whole transcript when it fits in the replay window", () => {
    expect(replayedPtyBytes(12_000)).toBe(12_000);
  });

  it("skips only the replayed tail when transcript history is larger", () => {
    expect(replayedPtyBytes(900_000)).toBe(PTY_SCROLLBACK_BYTES);
  });

  it("treats missing and invalid transcript sizes as no replay", () => {
    expect(replayedPtyBytes(undefined)).toBe(0);
    expect(replayedPtyBytes(Number.NaN)).toBe(0);
    expect(replayedPtyBytes(-1)).toBe(0);
  });
});
