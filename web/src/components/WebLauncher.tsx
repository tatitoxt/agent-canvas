import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBoard } from "../store/board";
import { chromeBookmarks, isTauri, type ChromeBookmark } from "../daemon/tauriClient";

const PORTS = [3000, 3001, 4200, 5173, 8000, 8080];

// Only sites that allow cross-origin framing — Google/GitHub/YouTube/MDN/npm
// send X-Frame-Options or frame-ancestors and would render a dead card.
const QUICK = [
  // HN proper sends X-Frame-Options: DENY — Lobsters is the frameable
  // same-niche tech news board.
  { name: "Lobsters", url: "https://lobste.rs", letter: "Lo", color: "#ac130d" },
  { name: "Wikipedia", url: "https://en.wikipedia.org", letter: "W", color: "#3366cc" },
  // OSM's homepage sends frame-ancestors 'self'; /export/embed.html is their
  // official iframe target and allows cross-origin framing.
  { name: "OpenStreetMap", url: "https://www.openstreetmap.org/export/embed.html", letter: "OS", color: "#7ebc6f" },
  { name: "example.com", url: "https://example.com", letter: "ex", color: "#666" },
  { name: "httpbin", url: "https://httpbin.org", letter: "hb", color: "#2c8a5b" },
  { name: "wttr.in", url: "https://wttr.in", letter: "wt", color: "#4a7eb5" },
];

const label: React.CSSProperties = {
  fontSize: 8.5,
  fontWeight: 700,
  letterSpacing: 1,
  textTransform: "uppercase",
  color: "var(--cv-ink-faint)",
  padding: "10px 2px 5px",
};

/** Symvibe's "open a page" launcher — a centered dialog: address bar,
 * localhost port chips, and a QUICK OPEN bookmark grid. Choosing any of
 * them drops a live `web` node on the canvas at view center. */
export function WebLauncher({ onClose }: { onClose: () => void }) {
  const webNodeAdd = useBoard((s) => s.webNodeAdd);
  const [url, setUrl] = useState("");
  const [bookmarks, setBookmarks] = useState<ChromeBookmark[]>([]);
  const wrap = useRef<HTMLDivElement>(null);

  // Bookmarks exist only inside the desktop shell — it can read the local
  // Chrome profile file. The daemon client keeps the section hidden.
  useEffect(() => {
    if (!isTauri()) return;
    let on = true;
    void chromeBookmarks().then((b) => {
      // Bookmarklets and app-protocol links can't render as a page — and
      // letting them through would hand non-web schemes to the browser.
      if (on) setBookmarks(b.filter((bm) => /^(https?|file):\/\//i.test(bm.url)));
    });
    return () => {
      on = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const open = (u: string) => {
    const v = u.trim();
    if (!v) return;
    // Local dev servers speak plain HTTP — https://localhost would fail.
    const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[^./\s]+\.local)([:/?#]|$)/i;
    // Explicit web schemes pass through as-is — bookmarked file: pages
    // must not get an https:// prefix glued on, and non-web schemes
    // (javascript:, app handlers) must never reach the browser unchecked.
    const schemed = /^(https?|file):\/\//i.test(v) && !local.test(v);
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v) && !schemed) {
      // ftp://, javascript:, slack://... — don't wrap these in https://
      // and make a card that points at the wrong host.
      useBoard.getState().notify("only http(s) or file pages open on the canvas");
      return;
    }
    webNodeAdd(schemed ? v : `${local.test(v) ? "http" : "https"}://${v}`);
    onClose();
  };

  // Portal to <body>: the Tools menu sits inside the topbar's stacking
  // context, so an in-tree fixed overlay renders under high-z panels.
  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(10,9,8,0.45)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={wrap}
        className="glass"
        role="dialog"
        aria-label="Open a page"
        onKeyDown={(e) => {
          // Focus trap: Tab/Shift+Tab wrap inside the dialog instead of
          // escaping to board controls behind the backdrop.
          if (e.key !== "Tab" || !wrap.current) return;
          const els = Array.from(
            wrap.current.querySelectorAll<HTMLElement>("button, input, a[href], [tabindex]"),
          ).filter((el) => !el.hasAttribute("disabled"));
          if (!els.length) return;
          const first = els[0];
          const last = els[els.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }}
        style={{
          position: "absolute",
          left: "50%",
          top: "42%",
          transform: "translate(-50%, -50%)",
          width: 380,
          padding: "16px 16px 14px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <input
          autoFocus
          placeholder="address — example.com or localhost:3000"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") open(url);
          }}
          style={{
            background: "var(--cv-glass-hi)",
            border: "1px solid var(--cv-glass-edge)",
            borderRadius: 10,
            height: 34,
            padding: "0 12px",
            fontSize: 12.5,
            color: "var(--cv-ink)",
            outline: "none",
            width: "100%",
            boxSizing: "border-box",
          }}
        />
        <div style={label}>localhost</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {PORTS.map((p) => (
            <button
              key={p}
              className="glass-pill"
              title={`open http://localhost:${p}`}
              style={{ border: "none", cursor: "pointer", fontSize: 11, padding: "4px 11px", color: "var(--cv-ink)" }}
              onClick={() => open(`http://localhost:${p}`)}
            >
              :{p}
            </button>
          ))}
        </div>
        {bookmarks.length > 0 && (
          <>
            <div style={label}>bookmarks</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 170, overflowY: "auto" }}>
              {[...new Set(bookmarks.map((b) => b.folder ?? ""))].map((folder) => (
                <div key={folder}>
                  {folder && (
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--cv-ink-faint)", padding: "5px 2px 3px" }}>
                      {folder}
                    </div>
                  )}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {bookmarks
                      .filter((b) => (b.folder ?? "") === folder)
                      .map((b) => (
                        <button
                          key={b.url}
                          className="glass-pill"
                          title={b.url}
                          style={{ border: "none", cursor: "pointer", fontSize: 11, padding: "4px 11px", color: "var(--cv-ink)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          onClick={() => open(b.url)}
                        >
                          {b.name || b.url}
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        <div style={label}>quick open</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 8,
          }}
        >
          {QUICK.map((q) => (
            <button
              key={q.name}
              title={q.url}
              onClick={() => open(q.url)}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                padding: "10px 6px 8px",
                border: "1px solid var(--cv-glass-edge)",
                borderRadius: 12,
                background: "var(--cv-glass-hi)",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 9,
                  display: "grid",
                  placeItems: "center",
                  background: q.color,
                  color: "#fff",
                  fontSize: q.letter.length > 1 ? 11 : 14,
                  fontWeight: 800,
                }}
              >
                {q.letter}
              </span>
              <span style={{ fontSize: 10.5, color: "var(--cv-ink)", fontWeight: 600 }}>{q.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
