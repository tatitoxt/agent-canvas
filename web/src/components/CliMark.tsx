/** Real-ish brand marks for each CLI, drawn as inline SVGs the way Deska
 * and Symvibe show them — the OpenAI rosette for Codex, Anthropic's
 * starburst for Claude, Cursor's cube, OpenCode's block square, etc.
 * Single `color` prop; paths are simplified silhouettes of each logo. */
export function CliMark({ cli, color, size = 12 }: { cli: string; color: string; size?: number }) {
  const s = { width: size, height: size, flex: "none" as const, display: "inline-block" };
  const stroke = { fill: "none", stroke: color, strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (cli.toLowerCase()) {
    case "claude":
    case "claude-code":
      // Anthropic starburst — four tapered arms around a point.
      return (
        <svg viewBox="0 0 16 16" style={s}>
          <path d="M8 1.5 L9.4 6.6 L14.5 8 L9.4 9.4 L8 14.5 L6.6 9.4 L1.5 8 L6.6 6.6 Z" fill={color} />
        </svg>
      );
    case "codex":
      // OpenAI knot — simplified six-petal rosette.
      return (
        <svg viewBox="0 0 16 16" style={s}>
          <g {...stroke} strokeWidth={1.2}>
            {[0, 60, 120, 180, 240, 300].map((a) => (
              <ellipse key={a} cx="8" cy="8" rx="6" ry="2.6" transform={`rotate(${a} 8 8)`} />
            ))}
          </g>
        </svg>
      );
    case "gemini":
    case "gemini-cli":
      // Gemini sparkle — one elongated four-point star.
      return (
        <svg viewBox="0 0 16 16" style={s}>
          <path d="M8 1 C8.9 5.4 10.6 7.1 15 8 C10.6 8.9 8.9 10.6 8 15 C7.1 10.6 5.4 8.9 1 8 C5.4 7.1 7.1 5.4 8 1 Z" fill={color} />
        </svg>
      );
    case "cursor":
    case "cursor-agent":
      // Cursor cube.
      return (
        <svg viewBox="0 0 16 16" style={s}>
          <path d="M8 1.8 L14 5.2 V10.8 L8 14.2 L2 10.8 V5.2 Z" {...stroke} />
          <path d="M8 8 L8 14.2 M8 8 L14 5.2 M8 8 L2 5.2" {...stroke} strokeWidth={1.2} />
        </svg>
      );
    case "opencode":
      // OpenCode block — bold square with the notch.
      return (
        <svg viewBox="0 0 16 16" style={s}>
          <path d="M2.5 2.5 H13.5 V13.5 H9.8 V9.8 H6.2 V13.5 H2.5 Z" fill={color} />
        </svg>
      );
    case "hermes":
      // Hermes — ring with the winged bar.
      return (
        <svg viewBox="0 0 16 16" style={s}>
          <circle cx="8" cy="8" r="6.2" {...stroke} strokeWidth={1.3} />
          <path d="M4.5 10.5 L8 4.5 L11.5 10.5 M5.8 8.6 H10.2" {...stroke} strokeWidth={1.2} />
        </svg>
      );
    case "kimi":
      // Kimi — rounded tile with the K cut.
      return (
        <svg viewBox="0 0 16 16" style={s}>
          <rect x="2.5" y="2.5" width="11" height="11" rx="3" {...stroke} strokeWidth={1.3} />
          <path d="M6 11.5 V4.5 M6 8.5 L10.5 4.5 M6.8 9.2 L10.5 11.5" {...stroke} strokeWidth={1.4} />
        </svg>
      );
    case "pi":
      // Pi — the little flag.
      return (
        <svg viewBox="0 0 16 16" style={s}>
          <path d="M4 14.5 V2.5 M4 3 H12.5 L10.2 6 L12.5 9 H4" {...stroke} strokeWidth={1.4} />
        </svg>
      );
    case "antigravity":
      // Antigravity — the triangle badge.
      return (
        <svg viewBox="0 0 16 16" style={s}>
          <path d="M8 2.5 L14 13 H2 Z" fill={color} />
        </svg>
      );
    case "amp":
      return (
        <svg viewBox="0 0 16 16" style={s}>
          <path d="M9 1.5 L4 9.5 H7.5 L7 14.5 L12 6.5 H8.5 Z" fill={color} />
        </svg>
      );
    case "droid":
      return (
        <svg viewBox="0 0 16 16" style={s}>
          <path d="M8 1.8 L13.4 4.9 V11.1 L8 14.2 L2.6 11.1 V4.9 Z" {...stroke} />
          <circle cx="8" cy="8" r="2.2" {...stroke} strokeWidth={1.2} />
        </svg>
      );
    case "goose":
      // Goose — head and beak silhouette.
      return (
        <svg viewBox="0 0 16 16" style={s}>
          <path d="M4.5 13.5 C4.5 10.5 5 8 6.5 6.2 C7.6 4.9 9.3 4.2 10.8 4.6 L13.5 5.8 L11.8 7 C11.8 9.2 10.5 11 8.5 11.9 L8.5 13.5 Z" fill={color} />
        </svg>
      );
    case "kilocode":
      // Kilocode — K between brackets.
      return (
        <svg viewBox="0 0 16 16" style={s}>
          <path d="M1.5 4 V12 M14.5 4 V12" {...stroke} strokeWidth={1.4} />
          <path d="M5.5 12 V4 M5.5 8.4 L10.5 4 M6.3 9.2 L10.5 12" {...stroke} strokeWidth={1.4} />
        </svg>
      );
    case "qwen":
      return (
        <svg viewBox="0 0 16 16" style={s}>
          <circle cx="7.5" cy="7.5" r="5" {...stroke} strokeWidth={1.4} />
          <path d="M9.8 10 L13 13.5" {...stroke} strokeWidth={1.6} />
        </svg>
      );
    case "vibe":
      // Mistral — the three-bar mark.
      return (
        <svg viewBox="0 0 16 16" style={s}>
          <path d="M3 4 H13 M3 8 H10 M3 12 H13" {...stroke} strokeWidth={2.2} />
        </svg>
      );
    case "bash":
    case "live":
    case "sh":
    case "zsh":
      // Terminal window — the bare shell mark.
      return (
        <svg viewBox="0 0 16 16" style={s}>
          <rect x="1.8" y="2.5" width="12.4" height="11" rx="2" {...stroke} strokeWidth={1.3} />
          <path d="M4.5 6.5 L7 8.5 L4.5 10.5 M8.5 10.8 H12" {...stroke} strokeWidth={1.3} />
        </svg>
      );
    case "aider":
      return (
        <svg viewBox="0 0 16 16" style={s}>
          <rect x="1.8" y="2.5" width="12.4" height="11" rx="2" {...stroke} strokeWidth={1.3} />
          <path d="M4.5 6.5 L7 8.5 L4.5 10.5 M8.5 10.8 H12" {...stroke} strokeWidth={1.3} />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 16 16" style={s}>
          <rect x="3" y="3" width="10" height="10" rx="2.5" {...stroke} />
        </svg>
      );
  }
}
