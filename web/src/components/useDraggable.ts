import { useCallback, useEffect, useRef, useState } from "react";

/** Floating-panel drag: `pos` starts at the panel's dock spot; grabbing the
 * header (spread `handleProps` on it) moves the panel anywhere on screen.
 * Clamped so the panel can never be lost off-canvas. */
export function useDraggable(initial: { x: number; y: number }) {
  const [pos, setPos] = useState(initial);
  const offset = useRef<{ dx: number; dy: number } | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const el = (e.currentTarget as HTMLElement).closest("[data-float-panel]");
    if (!el) return;
    const r = el.getBoundingClientRect();
    offset.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.preventDefault();
  }, []);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!offset.current) return;
      setPos({
        x: Math.min(Math.max(0, e.clientX - offset.current.dx), window.innerWidth - 72),
        y: Math.min(Math.max(52, e.clientY - offset.current.dy), window.innerHeight - 60),
      });
    };
    const up = () => {
      offset.current = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  return { pos, handleProps: { onMouseDown } };
}
