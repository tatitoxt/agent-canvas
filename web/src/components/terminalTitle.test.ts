import { describe, expect, it } from "vitest";
import { terminalTitle } from "./TerminalPanel";
import { announcedModel } from "../board/nodes";

describe("terminalTitle", () => {
  it.each([
    ["reviewer-1", 3, "Review 1"],
    ["builder_2", 3, "Builder 2"],
    ["frontend 3", 3, "Frontend 3"],
    ["tester-4", 3, "Test 4"],
    ["docs-1", 3, "Docs 1"],
    ["Terminal", 3, "Terminal 3"],
    ["Terminal-2", 3, "Terminal 3"],
    ["custom-shell", 3, "custom-shell"],
  ])("maps %s to its useful title", (name, number, expected) => {
    expect(terminalTitle(name, number)).toBe(expected);
  });
});

describe("announcedModel", () => {
  it("reads a model announcement after stripping ANSI styling", () => {
    const buf = new TextEncoder().encode("banner\r\n\u001b[1;32mGPT-5.1\u001b[0m\r\nready");
    expect(announcedModel(buf)).toBe("GPT-5.1");
  });

  it("returns no model when the PTY has not announced one", () => {
    expect(announcedModel(new TextEncoder().encode("$ echo hello\r\nhello"))).toBeUndefined();
    expect(announcedModel(undefined)).toBeUndefined();
  });
});
