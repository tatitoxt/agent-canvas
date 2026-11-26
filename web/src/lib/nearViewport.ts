import { useCallback, useEffect, useRef, useState } from "react";

/** Activation halo around the browser viewport. Terminals inside the halo
 * stay live so output is already warm when a slow pan brings them into view;
 * terminals outside it suspend expensive parsing/painting work. */
export const NEAR_VIEWPORT_MARGIN_PX = 240;

type RectLike = { left: number; top: number; right: number; bottom: number };

export function rectNearViewport(
  rect: RectLike,
  marginPx = NEAR_VIEWPORT_MARGIN_PX,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
) {
  return rect.right >= -marginPx
    && rect.left <= viewportWidth + marginPx
    && rect.bottom >= -marginPx
    && rect.top <= viewportHeight + marginPx;
}

export function elementNearViewport(element: Element, marginPx = NEAR_VIEWPORT_MARGIN_PX) {
  return rectNearViewport(element.getBoundingClientRect(), marginPx);
}

/** Observe viewport intersection, including movement caused by the canvas's
 * CSS-transform pan. The callback is invoked once synchronously with the
 * current state, then only on crossings. If IntersectionObserver is missing
 * we conservatively stay live — correctness beats the optimization. */
export function observeNearViewport(
  element: Element,
  onChange: (near: boolean) => void,
  marginPx = NEAR_VIEWPORT_MARGIN_PX,
): () => void {
  let near = elementNearViewport(element, marginPx);
  onChange(near);
  if (typeof IntersectionObserver === "undefined") return () => {};

  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const next = entry.isIntersecting;
      if (next === near) return;
      near = next;
      onChange(next);
    },
    { root: null, rootMargin: `${marginPx}px`, threshold: 0 },
  );
  observer.observe(element);
  return () => observer.disconnect();
}

/** React binding for card-level visibility. A callback ref is used because
 * some cards swap their root element when collapsed/expanded; plain ref
 * objects would keep observing the detached element. */
export function useNearViewport<T extends HTMLElement>(marginPx = NEAR_VIEWPORT_MARGIN_PX) {
  const [near, setNear] = useState(true);
  const disconnectRef = useRef<(() => void) | null>(null);
  const ref = useCallback((node: T | null) => {
    disconnectRef.current?.();
    disconnectRef.current = null;
    if (node) disconnectRef.current = observeNearViewport(node, setNear, marginPx);
  }, [marginPx]);

  useEffect(() => () => {
    disconnectRef.current?.();
    disconnectRef.current = null;
  }, []);

  return { ref, near };
}
