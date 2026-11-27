import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../daemon/tauriClient";
import { buildPdf, mdToLines } from "./pdf";

/** daemon REST base: same origin — canvasd serves the web build itself
 * (LAN/phone) and vite dev proxies /api, so the origin always reaches the
 * daemon when one backs this page. */
export function daemonBase(): string {
  return location.origin;
}

const DAEMON = daemonBase();

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function token(): string {
  return new URLSearchParams(location.search).get("token") ?? "";
}

/** Publish an artifact's content as a PDF — returns a link anyone on this
 * machine can open while the app runs, or null when nothing can host it.
 * Daemon shell: POST /api/share, served by canvasd. Native shell: the
 * share_create command publishes onto the app's embedded localhost server
 * and answers with the absolute URL (there is no web origin to resolve a
 * relative one against). */
export async function shareArtifactPdf(title: string, md: string): Promise<string | null> {
  const pdf = buildPdf(title, mdToLines(md));
  if (isTauri()) {
    try {
      const out = await invoke<{ id: string; url: string }>("share_create", {
        title,
        mime: "application/pdf",
        b64: toB64(pdf),
      });
      return out.url;
    } catch {
      return null;
    }
  }
  try {
    const res = await fetch(`${DAEMON}/api/share`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token()}`,
      },
      body: JSON.stringify({ title, mime: "application/pdf", b64: toB64(pdf) }),
    });
    if (!res.ok) return null;
    const { url } = (await res.json()) as { url: string };
    return `${DAEMON}${url}`;
  } catch {
    return null;
  }
}
