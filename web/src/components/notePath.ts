/** Resolve a [[wikilink]] name to a vault entry — Obsidian matches by
 * filename anywhere in the vault. Kept in its own tiny module: MdNode needs
 * it on the base canvas, while the full note renderer lazy-loads. */
export function resolveNotePath(entries: string[], name: string): string | null {
  return entries.find((e) =>
    e === name || e.endsWith(`/${name}`) || e === `${name}.md` || e.endsWith(`/${name}.md`) ||
    e.replace(/\.md$/, "") === name,
  ) ?? null;
}
