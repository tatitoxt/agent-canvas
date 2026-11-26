import { beforeEach, describe, expect, it } from "vitest";
import { useBoard } from "./board";
import { PANEL_META } from "../components/panelMeta";

const reset = () => {
  localStorage.clear();
  useBoard.setState({ panelNodes: {}, termNodes: {}, workspaceSizes: {}, mdNodeSizes: {}, webNodes: {}, webNodeSizes: {}, positions: {}, activeBoard: "main" });
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

  it("preserves the origin reported by a top/left panel resize", () => {
    useBoard.getState().openPanelNode("vault", { x: 200, y: 160 });
    useBoard.getState().resizePanelNode("panel-vault", 560, 620, { x: 120, y: 96 });
    const n = node("panel-vault")!;
    expect({ x: n.x, y: n.y, w: n.w, h: n.h }).toEqual({ x: 120, y: 96, w: 560, h: 620 });
    const saved = JSON.parse(localStorage.getItem("cv-panelnodes")!);
    expect(saved.main["panel-vault"].x).toBe(120);
    expect(saved.main["panel-vault"].y).toBe(96);
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

  it("preserves a workspace origin changed by a top or left edge resize", () => {
    useBoard.getState().resizeWorkspace("workspace-1", 760, 480, { x: 80, y: 120 });
    expect(useBoard.getState().positions["workspace-1"]).toEqual({ x: 80, y: 120 });
  });
});

describe("quick panel commands", () => {
  beforeEach(reset);

  it("routes Dex Tickets and Mission Map to their own panels", () => {
    useBoard.getState().quickRequest("open dex tickets");
    expect(node("panel-tickets")).toBeTruthy();
    expect(node("panel-notes")).toBeUndefined();
    useBoard.getState().quickRequest("open mission map");
    expect(node("panel-usage")).toBeTruthy();
  });
});

describe("markdown node sizes", () => {
  beforeEach(reset);

  it("persists resized note cards and enforces usable minimum dimensions", () => {
    useBoard.getState().resizeMdNode("md-note", 200, 100);
    expect(useBoard.getState().mdNodeSizes["main:md-note"]).toEqual({ w: 260, h: 180 });
    useBoard.getState().resizeMdNode("md-note", 640, 420);
    expect(JSON.parse(localStorage.getItem("cv-mdnodesizes")!)["main:md-note"]).toEqual({ w: 640, h: 420 });
    useBoard.getState().resizeMdNode("md-note", 360, 240, true, "qa");
    expect(useBoard.getState().mdNodeSizes["main:md-note"].w).toBe(640);
    expect(useBoard.getState().mdNodeSizes["qa:md-note"].w).toBe(360);
  });

  it("preserves the origin reported by a top/left markdown resize", () => {
    useBoard.getState().resizeMdNode("md-note", 420, 320, true, "main", { x: 44, y: 66 });
    expect(useBoard.getState().positions["md-note"]).toEqual({ x: 44, y: 66 });
  });
});

describe("canvas card resize origins", () => {
  beforeEach(reset);

  it("preserves the origin reported by a top/left terminal resize", () => {
    useBoard.getState().openTermNode("agent-1", { x: 200, y: 180 });
    useBoard.getState().resizeTermNode("term-agent-1", 640, 420, { x: 140, y: 130 });
    const n = useBoard.getState().termNodes.main["term-agent-1"];
    expect({ x: n.x, y: n.y, w: n.w, h: n.h }).toEqual({ x: 140, y: 130, w: 640, h: 420 });
    const saved = JSON.parse(localStorage.getItem("cv-termnodes")!);
    expect(saved.main["term-agent-1"].x).toBe(140);
    expect(saved.main["term-agent-1"].y).toBe(130);
  });

  it("preserves the origin reported by a top/left web-page resize", () => {
    useBoard.getState().resizeWebNode("web-1", 500, 380, true, "main", { x: 84, y: 52 });
    expect(useBoard.getState().positions["web-1"]).toEqual({ x: 84, y: 52 });
    expect(useBoard.getState().webNodeSizes["main:web-1"]).toEqual({ w: 500, h: 380 });
  });
});
