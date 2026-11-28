import { describe, expect, it } from "vitest";
import { artifactDraftStorageKey } from "./artifactDraft";

describe("artifact draft storage scope", () => {
  it("isolates equal board ids in different canvas databases", () => {
    expect(artifactDraftStorageKey("repo-a-db", "main")).not.toBe(
      artifactDraftStorageKey("repo-b-db", "main"),
    );
  });

  it("restores a draft scope for the same database and board", () => {
    expect(artifactDraftStorageKey("repo-a-db", "main")).toBe(
      artifactDraftStorageKey("repo-a-db", "main"),
    );
  });

  it("keeps boards in one canvas database separate", () => {
    expect(artifactDraftStorageKey("repo-a-db", "main")).not.toBe(
      artifactDraftStorageKey("repo-a-db", "review"),
    );
  });
});
