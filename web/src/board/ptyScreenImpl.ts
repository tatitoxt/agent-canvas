// The lazily-loaded half of the ptyScreen split: this module is only ever
// reached through the dynamic import in ptyScreen.ts, which keeps the
// headless xterm out of the entry chunk. Never import it directly from
// eagerly-loaded code — that would defeat the split.

// The package's `module` field points at a file that doesn't ship — import
// the ESM bundle directly instead.
// @ts-expect-error untyped internal path
import { Terminal } from "@xterm/headless/lib-headless/xterm-headless.mjs";
import { ptyBufferWindow } from "./ptyBufferMeta";

/** Per-agent headless terminal: a real screen model so card previews show
 * the TUI's actual screen (cursor addressing, repaints, alt-screen) rather
 * than a raw byte tail. Fed from the same ptyBuffers the panels use. */
const SCREENS = new Map<string, { term: Terminal; fed: number; fedEnd: number; pendingWrites: number; flushCallbacks: Array<() => void>; generation: number }>();
const MAX_SCREENS = 48;
const COLS = 96;
const ROWS = 40;

function screen(agentId: string) {
  let s = SCREENS.get(agentId);
  if (!s) {
    if (SCREENS.size >= MAX_SCREENS) {
      const oldest = SCREENS.keys().next().value!;
      SCREENS.get(oldest)!.term.dispose();
      SCREENS.delete(oldest);
    }
    s = {
      term: new Terminal({ cols: COLS, rows: ROWS, scrollback: 400, allowProposedApi: true }),
      fed: 0,
      fedEnd: 0,
      pendingWrites: 0,
      flushCallbacks: [],
      generation: 0,
    };
    SCREENS.set(agentId, s);
  }
  return s;
}

/** Clear the cached screen before the daemon replays a reconnect scrollback. */
export function resetScreen(agentId: string) {
  const s = SCREENS.get(agentId);
  if (!s) return;
  s.generation += 1;
  s.term.reset();
  s.fed = 0;
  s.fedEnd = 0;
  s.pendingWrites = 0;
  s.flushCallbacks.length = 0;
}

const BASIC16 = [
  "#e8e4df", "#ff5d5d", "#3ddc84", "#ffb224",
  "#5aa2f7", "#c792ea", "#34d3d3", "#f4f2ee",
  "#9aa0a6", "#ff8f8f", "#7ce8a8", "#ffd166",
  "#8ab8ff", "#e0b0ff", "#7fe3e3", "#ffffff",
];

function palette256(i: number): string {
  if (i < 16) return BASIC16[i];
  if (i < 232) {
    const n = i - 16;
    const r = Math.floor(n / 36), g = Math.floor((n % 36) / 6), b = n % 6;
    const c = (v: number) => (v === 0 ? 0 : 55 + v * 40);
    return `#${[c(r), c(g), c(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  }
  const v = 8 + (i - 232) * 10;
  return `#${v.toString(16).padStart(2, "0").repeat(3)}`;
}

export type CellSpan = { text: string; color?: string; bold?: boolean };

/** Feed the agent's latest bytes and return the visible screen as styled
 * spans — one entry per terminal row, trimmed of empty tail rows. */
export function screenLines(agentId: string, buf: Uint8Array | undefined, onWrite?: () => void): CellSpan[][] {
  const s = screen(agentId);
  let chunk: Uint8Array | undefined;
  if (buf) {
    const window = ptyBufferWindow(buf);
    if (window) {
      // Buffers are rolling windows, not append-only arrays: once they hit
      // the store cap their length stops growing even though new PTY bytes
      // keep arriving. Absolute stream positions let a visibility-paused
      // preview resume at the right byte instead of freezing at the cap.
      if (window.end > s.fedEnd) {
        const offset = s.fedEnd <= window.start ? 0 : s.fedEnd - window.start;
        chunk = buf.slice(offset);
        s.fed = buf.length;
        s.fedEnd = window.end;
      }
    } else if (buf.length > s.fed) {
      // Direct unit-test / synthetic buffers have no store metadata; keep
      // the original append-only behavior for them.
      chunk = buf.slice(s.fed);
      s.fed = buf.length;
      s.fedEnd = buf.length;
    }
  }

  if (chunk?.length) {
    if (onWrite) s.flushCallbacks.push(onWrite);
    s.pendingWrites += 1;
    const generation = s.generation;
    s.term.write(chunk, () => {
      if (generation !== s.generation) return;
      s.pendingWrites -= 1;
      if (s.pendingWrites === 0) {
        const callbacks = s.flushCallbacks.splice(0);
        callbacks.forEach((callback) => callback());
      }
    });
  } else if (onWrite) {
    if (s.pendingWrites > 0) s.flushCallbacks.push(onWrite);
    else onWrite();
  }
  const b = s.term.buffer.active;
  const out: CellSpan[][] = [];
  for (let y = b.viewportY; y < b.viewportY + ROWS && y < b.length; y++) {
    const line = b.getLine(y);
    if (!line) continue;
    const spans: CellSpan[] = [];
    for (let x = 0; x < COLS; x++) {
      const cell = line.getCell(x);
      if (!cell) break;
      const ch = cell.getChars();
      if (!ch) continue;
      const last = spans[spans.length - 1];
      let color: string | undefined;
      if (cell.isFgRGB()) color = `#${cell.getFgColor().toString(16).padStart(6, "0")}`;
      else if (cell.isFgPalette()) color = palette256(cell.getFgColor());
      const bold = !!cell.isBold();
      if (last && last.color === color && last.bold === bold) {
        last.text += ch;
      } else {
        spans.push({ text: ch, color, bold });
      }
    }
    const text = spans.map((s) => s.text).join("");
    if (text.trim().length > 0) out.push(spans);
  }
  return out;
}
