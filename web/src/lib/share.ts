import { buildPdf, mdToLines } from "./pdf";

/** daemond REST base: same origin when canvasd serves the web build
 * (LAN/phone), localhost daemon on the vite dev port. */
export function daemonBase(): string {
  return location.port === "5174" ? "http://127.0.0.1:4242" : location.origin;
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

/** Publish an artifact's content as a PDF on the local daemon — returns a
 * link anyone on this machine/LAN can open while the app runs, or null when
 * the daemon isn't reachable (e.g. sharing inside the Tauri build). */
export async function shareArtifactPdf(title: string, md: string): Promise<string | null> {
  const pdf = buildPdf(title, mdToLines(md));
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
