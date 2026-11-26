import { beforeEach, describe, expect, it } from "vitest";
import { useBoard } from "./board";

function resetGatherState() {
  localStorage.clear();
  useBoard.setState({
    activeBoard: "main",
    boards: { main: { id: "main", name: "Main" } as never },
    agents: {},
    edges: {},
    positions: {},
    agentSizes: {},
    shapes: {},
    panelNodes: {},
    termNodes: {},
    mdNodes: {},
    webNodes: {},
    workspaces: {},
    workspaceSizes: {},
    orchestrators: {},
    viewportRect: { left: 0, top: 0, right: 1600, bottom: 1000 },
    moveHistory: [],
    lastGather: null,
    gatherMotion: null,
    leavingShapes: {},
    connected: true,
  });
}

describe("gatherLoose", () => {
  beforeEach(resetGatherState);

  it("does not pollute one-card move history; undo gather restores the snapshot", () => {
    useBoard.setState({
      agents: {
        "agent-1": { id: "agent-1", name: "builder", status: "working", board_id: "main" },
      },
      positions: { "agent-1": { x: 800, y: 100 } },
    });
    useBoard.getState().moveNode("agent-1", 900, 120);
    expect(useBoard.getState().moveHistory).toHaveLength(1);

    useBoard.getState().gatherLoose();
    expect(useBoard.getState().moveHistory).toHaveLength(1);
    const gathered = useBoard.getState().positions["agent-1"];
    expect(gathered).not.toEqual({ x: 900, y: 120 });
    expect(useBoard.getState().lastGather?.items).toContainEqual({ id: "agent-1", kind: "agent", x: 900, y: 120 });

    useBoard.getState().undoGather();
    expect(useBoard.getState().positions["agent-1"]).toEqual({ x: 900, y: 120 });
    expect(useBoard.getState().moveHistory).toHaveLength(1);

    // The manual move that preceded gather is still the next single-card undo.
    expect(useBoard.getState().undoMove()).toBe(true);
    expect(useBoard.getState().positions["agent-1"]).toEqual({ x: 800, y: 100 });
  });

  it("respects locked and maximized panels instead of moving them into the group", () => {
    useBoard.setState({
      panelNodes: {
        main: {
          "panel-inbox": { panel: "inbox", x: 900, y: 100, w: 320, h: 440, locked: true },
          "panel-vault": { panel: "vault", x: 100, y: 500, w: 460, h: 520 },
          "panel-settings": { panel: "settings", x: 1200, y: 500, w: 360, h: 480, maximized: true },
        },
      },
    });
    useBoard.getState().gatherLoose();
    expect(useBoard.getState().panelNodes.main["panel-inbox"]).toMatchObject({ x: 900, y: 100 });
    expect(useBoard.getState().panelNodes.main["panel-vault"].x).not.toBe(100);
    expect(useBoard.getState().panelNodes.main["panel-settings"]).toMatchObject({ x: 1200, y: 500 });
  });
});
