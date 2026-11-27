/** Lazy facade over ptyScreenImpl: the headless xterm is ~36 kB gzip, so it
 * ships in its own chunk and loads on first use instead of slowing down the
 * canvas boot. The public API stays synchronous — callers see empty previews
 * for the handful of frames while the chunk loads, then the replay below
 * catches the screen model up and the usual flush callbacks repaint. */

type Impl = typeof import("./ptyScreenImpl");
export type { CellSpan } from "./ptyScreenImpl";

type CellSpan = import("./ptyScreenImpl").CellSpan;

let impl: Impl | null = null;
let loading = false;

/** Ops arrive before the chunk loads and must apply in their original
 * order per agent — a reconnect reset has to land before the replayed feed
 * bytes or the stale screen survives. Feeds are replayed through the impl's
 * own write pipeline, so their onWrite callbacks still fire only after
 * xterm has actually parsed the bytes. */
type PendingOp =
  | { kind: "reset" }
  | { kind: "feed"; buf: Uint8Array | undefined; onWrite?: () => void };

const pending = new Map<string, PendingOp[]>();

function enqueue(agentId: string, op: PendingOp) {
  const ops = pending.get(agentId);
  if (ops) ops.push(op);
  else pending.set(agentId, [op]);
}

function load() {
  if (impl || loading) return;
  loading = true;
  void import("./ptyScreenImpl")
    .then((m) => {
      impl = m;
      loading = false;
      for (const [agentId, ops] of pending) {
        // A reset queued before the chunk loaded can only mean "discard
        // everything before this point": no screen exists in the impl yet,
        // so the reset itself is a no-op — and the pre-reset feeds must be
        // dropped rather than replayed. Replaying them would write stale
        // bytes into xterm's (uncancellable) write queue and corrupt the
        // fresh screen the reset was announcing.
        let start = 0;
        for (let i = 0; i < ops.length; i++) if (ops[i].kind === "reset") start = i + 1;
        const dropped: Array<() => void> = [];
        for (const op of ops.slice(0, start)) {
          if (op.kind === "feed" && op.onWrite) dropped.push(op.onWrite);
        }
        for (const op of ops.slice(start)) {
          if (op.kind === "feed") m.screenLines(agentId, op.buf, op.onWrite);
        }
        // Components waiting on a dropped feed's flush callback still get
        // their repaint trigger — the screen state they re-render from is
        // simply the post-reset one.
        dropped.forEach((cb) => cb());
      }
      pending.clear();
    })
    .catch((err) => {
      // A failed chunk fetch must not take the canvas down — the next
      // screenLines call retries the import.
      console.error("headless terminal chunk failed to load", err);
      loading = false;
    });
}

/** Clear the cached screen before the daemon replays a reconnect scrollback. */
export function resetScreen(agentId: string) {
  if (impl) {
    impl.resetScreen(agentId);
    return;
  }
  enqueue(agentId, { kind: "reset" });
  load();
}

/** Feed the agent's latest bytes and return the visible screen as styled
 * spans. Until the headless chunk finishes loading this returns an empty
 * screen — the card preview simply renders nothing for those frames, the
 * same as an agent with no output yet. */
export function screenLines(agentId: string, buf: Uint8Array | undefined, onWrite?: () => void): CellSpan[][] {
  if (impl) return impl.screenLines(agentId, buf, onWrite);
  enqueue(agentId, { kind: "feed", buf, onWrite });
  load();
  return [];
}
