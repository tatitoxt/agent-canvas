import { beforeEach, describe, expect, it } from "vitest";
import { useBoard } from "./board";
import { PANEL_META } from "../components/panelMeta";

const reset = () => {
  localStorage.clear();
  useBoard.setState({ panelNodes: {}, workspaceSizes: {}, activeBoard: "main" });
};

const node = (id: string, board = "main") => useBoard.getState().panelNodes[board]?.[id];

describe("panel nodes", () => {
  beforeEach(reset);

  it("openPanelNode creates a card sized from PANEL_META", () => {
    useBoard.getState().openPanelNode("inbox", { x: 100, y: 200 });
    const n = node("panel-inbox");
    expect(n).toBeTruthy();
    expect(n!.x).toBe(100);
    expect(n!.y).toBe(200);
    expect(n!.w).toBe(PANEL_META.inbox.w);
    expect(n!.h).toBe(PANEL_META.inbox.h);
  });

  it("re-opening the same panel focuses instead of duplicating", () => {
    useBoard.getState().openPanelNode("inbox", { x: 1, y: 1 });
    useBoard.getState().openPanelNode("inbox", { x: 999, y: 999 });
    expect(Object.keys(useBoard.getState().panelNodes.main)).toHaveLength(1);
    // position untouched — no jump out from under the user
    expect(node("panel-inbox")!.x).toBe(1);
  });

  it("closePanelNode removes only that card", () => {
    useBoard.getState().openPanelNode("inbox", { x: 0, y: 0 });
    useBoard.getState().openPanelNode("loops", { x: 10, y: 10 });
    useBoard.getState().closePanelNode("panel-inbox");
    expect(node("panel-inbox")).toBeUndefined();
    expect(node("panel-loops")).toBeTruthy();
  });

  it("movePanelNode commits x/y and persists to localStorage", () => {
    useBoard.getState().openPanelNode("inbox", { x: 0, y: 0 });
    useBoard.getState().movePanelNode("panel-inbox", 420, 240);
    expect(node("panel-inbox")!.x).toBe(420);
    const saved = JSON.parse(localStorage.getItem("cv-panelnodes")!);
    expect(saved.main["panel-inbox"].x).toBe(420);
  });

  it("resizePanelNode never shrinks a card below PANEL_META minW/minH", () => {
    // vault is the panel that declares explicit minimums
    const meta = PANEL_META.vault;
    expect(meta.minW).toBeTruthy();
    useBoard.getState().openPanelNode("vault", { x: 0, y: 0 });
    useBoard.getState().resizePanelNode("panel-vault", 40, 30);
    const n = node("panel-vault")!;
    expect(n.w).toBeGreaterThanOrEqual(meta.minW!);
    expect(n.h).toBeGreaterThanOrEqual(meta.minH!);
  });

  it("every panel card respects its PANEL_META minimums after any resize", () => {
    for (const [key, meta] of Object.entries(PANEL_META)) {
      reset();
      useBoard.getState().openPanelNode(key, { x: 0, y: 0 });
      useBoard.getState().resizePanelNode(`panel-${key}`, 1, 1);
      const n = node(`panel-${key}`)!;
      if (meta.minW) expect(n.w, `${key}.w`).toBeGreaterThanOrEqual(meta.minW);
      if (meta.minH) expect(n.h, `${key}.h`).toBeGreaterThanOrEqual(meta.minH);
    }
  });

  it("collapse remembers the expanded height and restores it", () => {
    useBoard.getState().openPanelNode("inbox", { x: 0, y: 0 });
    const h0 = node("panel-inbox")!.h;
    useBoard.getState().collapsePanelNode("panel-inbox");
    expect(node("panel-inbox")!.h).toBe(34);
    expect(node("panel-inbox")!.collapsed).toBe(true);
    useBoard.getState().collapsePanelNode("panel-inbox");
    expect(node("panel-inbox")!.h).toBe(h0);
    expect(node("panel-inbox")!.collapsed).toBe(false);
  });

  it("panels are per-board: the same panel lives independently on two boards", () => {
    useBoard.getState().openPanelNode("inbox", { x: 5, y: 5 });
    useBoard.setState({ activeBoard: "qa" });
    useBoard.getState().openPanelNode("inbox", { x: 50, y: 50 });
    expect(node("panel-inbox", "main")!.x).toBe(5);
    expect(node("panel-inbox", "qa")!.x).toBe(50);
    useBoard.getState().closePanelNode("panel-inbox");
    expect(node("panel-inbox", "qa")).toBeUndefined();
    expect(node("panel-inbox", "main")).toBeTruthy();
  });
});

describe("workspace sizes", () => {
  beforeEach(reset);

  it("persists resized workspace frames and enforces usable minimum dimensions", () => {
    useBoard.getState().resizeWorkspace("workspace-1", 420, 200);
    expect(useBoard.getState().workspaceSizes["workspace-1"]).toEqual({ w: 520, h: 320 });
    useBoard.getState().resizeWorkspace("workspace-1", 760, 480);
    expect(JSON.parse(localStorage.getItem("cv-workspacesizes")!)["workspace-1"]).toEqual({ w: 760, h: 480 });
  });
});
