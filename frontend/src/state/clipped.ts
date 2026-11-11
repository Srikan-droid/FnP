import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";

/**
 * Whether a line-clamped element is cutting its text off (it ends in "…"), so a "Read more" is
 * offered only where there is more to read. Measured again whenever the element resizes.
 */
export function useClipped(ref: RefObject<HTMLElement | null>, text: string): boolean {
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    check();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, text]);
  return clipped;
}
