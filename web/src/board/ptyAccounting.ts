/** The daemon replays at most this many bytes when a PTY reconnects. */
export const PTY_SCROLLBACK_BYTES = 65_536;

/** Number of replayed bytes that must be excluded from live usage totals. */
export function replayedPtyBytes(totalOutputBytes: number | undefined): number {
  if (!Number.isFinite(totalOutputBytes) || totalOutputBytes == null || totalOutputBytes <= 0) return 0;
  return Math.min(totalOutputBytes, PTY_SCROLLBACK_BYTES);
}
