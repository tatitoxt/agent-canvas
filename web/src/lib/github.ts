// GitHub REST access, one helper for both shells. The daemon proxies
// api.github.com at /api/github (gh CLI auth when installed); the native
// shell answers the same contract through the github_proxy command. Only
// a page with neither backing falls back to the direct anonymous API
// (60 req/h, no private repos).

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../daemon/tauriClient";

function token(): string {
  return (
    (import.meta.env.VITE_CANVAS_TOKEN as string | undefined) ??
    new URLSearchParams(location.search).get("token") ??
    ""
  );
}

/** Fetch a GitHub REST path (e.g. "repos/o/r/pulls?state=open") and parse
 * it as JSON. Error bodies come back as parsed JSON too — both backends
 * serve upstream error messages verbatim — so callers validate the shape
 * they expect rather than a transport status. Throws on transport failure
 * and on the direct fallback's non-2xx (rate limit included). */
export async function ghJson(rest: string): Promise<unknown> {
  if (isTauri()) {
    const text = await invoke<string>("github_proxy", { path: rest });
    return JSON.parse(text);
  }
  const r = await fetch(`${location.origin}/api/github/${rest}`, {
    headers: { Authorization: `Bearer ${token()}` },
  }).catch(() => fetch(`https://api.github.com/${rest}`));
  if (!r.ok) {
    throw new Error(
      r.status === 403 ? "GitHub rate limit — retry in a bit" : `GitHub ${r.status}`,
    );
  }
  return r.json();
}
