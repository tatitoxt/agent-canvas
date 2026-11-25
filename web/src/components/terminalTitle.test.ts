import { describe, expect, it } from "vitest";
import { terminalTitle } from "./TerminalPanel";

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
