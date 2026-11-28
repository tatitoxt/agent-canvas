/** Local draft key scoped to one persistent canvas database and board. */
export function artifactDraftStorageKey(canvasId: string, boardId: string): string {
  return `cv-artifact-draft:${encodeURIComponent(canvasId)}:${encodeURIComponent(boardId)}`;
}
