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

/** Line index of the heading whose normalized title matches, or null. */
export function headingLineFor(text: string, anchorTitle: string): number | null {
  const h = extractHeadings(text).find((x) => x.title.trim().toLowerCase() === anchorTitle);
  return h ? h.line : null;
}
