import { useEffect, useState } from "react";

/**
 * Authentication and scoring are simulated with elapsed time, so a page showing a case in one
 * of those stages has to re-render to notice it finishing. Ticking stops as soon as nothing is
 * in flight, so a settled queue costs nothing.
 */
export function useStageTicker(active: boolean, intervalMs = 500): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const tick = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(tick);
  }, [active, intervalMs]);

  return now;
}
