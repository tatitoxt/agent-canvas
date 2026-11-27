/**
 * Render probe — a near-zero-cost hook for measuring which components
 * re-render during high-frequency gestures (drag, resize, pan).
 *
 * Each probe point is a single property lookup when the probe is dark
 * (production use): `window.__cvRenderCounts` is undefined and the call
 * is one branch. Test harnesses opt in by assigning a plain object to
 * `window.__cvRenderCounts` before the app boots; every instrumented
 * component then increments `counts[probeName]` once per render. An
 * optional instance key (node id, agent id) additionally increments
 * `counts["name@instance"]`, so cascade analysis can tell apart "every
 * card re-rendered" from "only the gestured card re-rendered".
 *
 * The probe is how resize/drag cascade regressions are measured in
 * e2e/measure-resize.mjs — keep the call sites stable.
 */
export function countRender(name: string, instance?: string): void {
  const counts = (window as unknown as { __cvRenderCounts?: Record<string, number> }).__cvRenderCounts;
  if (!counts) return;
  counts[name] = (counts[name] ?? 0) + 1;
  if (instance) counts[`${name}@${instance}`] = (counts[`${name}@${instance}`] ?? 0) + 1;
}
