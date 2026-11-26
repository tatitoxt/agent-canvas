import { beforeEach, describe, expect, it } from "vitest";
import { useBoard } from "./board";

describe("toast stack", () => {
  beforeEach(() => useBoard.setState({ notices: [], notice: null }));

  it("notify pushes into the stack instead of replacing", () => {
    const st = useBoard.getState();
    st.notify("first");
    st.notify("second");
    const { notices, notice } = useBoard.getState();
    expect(notices).toHaveLength(2);
    expect(notices[0].text).toBe("first");
    expect(notices[1].text).toBe("second");
    expect(notice).toBe("second");
  });

  it("ids increment so each toast expires on its own clock", () => {
    const st = useBoard.getState();
    st.notify("a");
    st.notify("b");
    const [x, y] = useBoard.getState().notices;
    expect(y.id).toBeGreaterThan(x.id);
  });

  it("caps the stack at 4 — a burst never floods the corner", () => {
    const st = useBoard.getState();
    for (let i = 0; i < 7; i++) st.notify(`n${i}`);
    const { notices } = useBoard.getState();
    expect(notices).toHaveLength(4);
    expect(notices[0].text).toBe("n3");
  });

  it("dismissNotice removes only its own toast", () => {
    const st = useBoard.getState();
    st.notify("keep");
    st.notify("drop");
    const dropId = useBoard.getState().notices[1].id;
    useBoard.getState().dismissNotice(dropId);
    const { notices } = useBoard.getState();
    expect(notices).toHaveLength(1);
    expect(notices[0].text).toBe("keep");
  });

  it("notify(\"\") clears the transient line without touching the stack", () => {
    const st = useBoard.getState();
    st.notify("persisted");
    useBoard.getState().notify("");
    expect(useBoard.getState().notice).toBe("");
    expect(useBoard.getState().notices).toHaveLength(1);
  });
});
