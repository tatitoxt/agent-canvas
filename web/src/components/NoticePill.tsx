import { useEffect } from "react";
import { useBoard } from "../store/board";

/** Transient toast top-center — daemon errors, git pushes, notices.
 * Bottom-right put it over the minimap; bottom-center collides with
 * the Dex input bar. */
export function NoticePill() {
  const notice = useBoard((s) => s.notice);
  const notify = useBoard((s) => s.notify);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => notify(""), 6000);
    return () => clearTimeout(t);
  }, [notice, notify]);
  if (!notice) return null;
  return (
    <div
      className="glass-pill"
      style={{
        position: "absolute",
        left: "50%",
        transform: "translateX(-50%)",
        top: 64,
        zIndex: 30,
        maxWidth: 420,
        padding: "7px 16px",
        fontSize: 11.5,
        color: "var(--cv-ink)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        cursor: "pointer",
      }}
      title={notice}
      onClick={() => notify("")}
    >
      {notice}
    </div>
  );
}
