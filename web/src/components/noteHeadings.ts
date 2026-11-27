/** Heading extraction shared by the vault reader (outline + anchor jumps)
 * and the pinned markdown windows (scroll-to-heading on mount). Skips
 * frontmatter-ish noise by ignoring fenced code blocks; titles are stripped
 * of inline markdown the same way the Outline dropdown displays them. */
export interface NoteHeading {
  line: number;
  depth: number;
  title: string;
}

export function extractHeadings(text: string): NoteHeading[] {
  const out: NoteHeading[] = [];
  let inCode = false;
  text.split("\n").forEach((l, i) => {
    if (/^\s*```/.test(l)) { inCode = !inCode; return; }
    if (inCode) return;
    const m = l.match(/^(#{1,6})\s+(.*)/);
    if (m) out.push({ line: i, depth: m[1].length, title: m[2].replace(/[*_~=`[\]]/g, "") });
  });
  return out;
}

/** A pinned scroll anchor: the source line pins it exactly, the normalized
 * lowercase title lets it survive the note being edited above the heading. */
export interface HeadingAnchor {
  line: number;
  title: string;
}

/** Resolve an anchor to a live line: exact line when its heading still
 * matches the title (handles repeated titles — pin distinguishes them),
 * otherwise the first heading with that title, else null. */
export function headingLineFor(text: string, anchor: HeadingAnchor): number | null {
  const hs = extractHeadings(text);
  const atLine = hs.find((x) => x.line === anchor.line);
  if (atLine && atLine.title.trim().toLowerCase() === anchor.title) return anchor.line;
  const byTitle = hs.find((x) => x.title.trim().toLowerCase() === anchor.title);
  return byTitle ? byTitle.line : null;
}
