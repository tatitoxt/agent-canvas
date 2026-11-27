import { useBoard } from "../store/board";

type ResizeState = {
  cols: number;
  rows: number;
  sentAt: number;
  timer?: number;
  pending?: { cols: number; rows: number };
  connected: boolean;
  hasConnected: boolean;
  suppressUntil: number;
  userIntentUntil: number;
};

const states = new Map<string, ResizeState>();
const COALESCE_MS = 140;
const RECONNECT_LAYOUT_GUARD_MS = 2_000;
const USER_RESIZE_INTENT_MS = 1_500;

function stateFor(agentId: string) {
  let state = states.get(agentId);
  if (!state) {
    const connected = useBoard.getState().connected;
    state = {
      cols: -1,
      rows: -1,
      sentAt: 0,
      connected,
      hasConnected: connected,
      suppressUntil: 0,
      userIntentUntil: 0,
    };
    states.set(agentId, state);
  }
  return state;
}

/** A reconnect can reflow xterm as connection chrome mounts. Ignore that
 * observer-only geometry churn; the shared PTY may already have a newer size
 * from another tab. */
export function updatePtyConnection(agentId: string, connected: boolean) {
  const state = stateFor(agentId);
  const now = Date.now();
  if (connected && !state.connected && state.hasConnected) {
    if (state.userIntentUntil <= now) {
      state.suppressUntil = now + RECONNECT_LAYOUT_GUARD_MS;
      state.pending = undefined;
      if (state.timer !== undefined) {
        clearTimeout(state.timer);
        state.timer = undefined;
      }
    }
  }
  state.connected = connected;
  if (connected) state.hasConnected = true;
}

/** Preserve an explicit drawer resize even during the short reconnect guard. */
export function markPtyResizeIntent(agentId: string) {
  stateFor(agentId).userIntentUntil = Date.now() + USER_RESIZE_INTENT_MS;
}

export function sendPtyResize(agentId: string, cols: number, rows: number) {
  const state = stateFor(agentId);
  const now = Date.now();
  if (now < state.suppressUntil && now >= state.userIntentUntil) return;
  if (!state.pending && state.cols === cols && state.rows === rows) return;
  state.pending = { cols, rows };
  if (state.timer !== undefined) return;

  const flush = () => {
    const current = states.get(agentId);
    if (!current) return;
    current.timer = undefined;
    if (!current.pending) return;
    if (Date.now() < current.suppressUntil && Date.now() >= current.userIntentUntil) {
      current.pending = undefined;
      return;
    }
    const { cols: nextCols, rows: nextRows } = current.pending;
    current.pending = undefined;
    if (current.cols === nextCols && current.rows === nextRows) return;
    current.cols = nextCols;
    current.rows = nextRows;
    current.sentAt = Date.now();
    useBoard.getState().resizePty(agentId, nextCols, nextRows);
  };

  const wait = COALESCE_MS - (now - state.sentAt);
  if (wait <= 0) flush();
  else state.timer = window.setTimeout(flush, wait);
}
