import { useEffect, useState } from "react";
import { useBoard } from "../store/board";

/** Transient toasts — macOS-style stack top-right, below the topbar.
 * Each notice auto-expires on its own clock, clicks dismiss individually,
 * and newer ones slide in under the previous instead of replacing them —
 * bottom-center collided with the spawn chooser and the Dex bar. */
function Toast({ id, text }: { id: number; text: string }) {
  const dismissNotice = useBoard((s) => s.dismissNotice);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLeaving(true), 5400);
    const gone = setTimeout(() => dismissNotice(id), 5800);
    return () => { clearTimeout(t); clearTimeout(gone); };
  }, [id, dismissNotice]);
  const error = text.startsWith("error");
  return (
    <div
      className="glass-pill cv-toast-in"
      onClick={() => dismissNotice(id)}
      title={text}
      style={{
        maxWidth: 340,
        padding: "8px 14px",
        fontSize: "var(--cv-text-xs)",
        lineHeight: 1.45,
        color: "var(--cv-ink)",
        cursor: "pointer",
        whiteSpace: "normal",
        overflow: "hidden",
        display: "-webkit-box",
        WebkitLineClamp: 3,
        WebkitBoxOrient: "vertical",
        borderLeft: error ? "2px solid var(--cv-danger, #e5484d)" : "2px solid var(--cv-accent)",
        borderRadius: 12,
        opacity: leaving ? 0 : 1,
        transform: leaving ? "translateX(12px)" : "none",
        transition: "opacity 380ms ease, transform 380ms ease",
      }}
    >
      {text}
    </div>
  );
}

export function NoticePill() {
  const notices = useBoard((s) => s.notices);
  if (!notices.length) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: 60,
        right: 14,
        zIndex: 80,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        alignItems: "flex-end",
        pointerEvents: "none",
      }}
    >
      {notices.map((n) => (
        <div key={n.id} style={{ pointerEvents: "auto" }}>
          <Toast id={n.id} text={n.text} />
        </div>
      ))}
    </div>
  );
}
