// Smooth clamped cubic-out scroll animation ported from md-phone (`flyTo`).

const FLY_MS = 220;

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Scrolls `scroller` smoothly to `targetTop`, clamping jump distance to at most one viewport
 * so long-document jumps glide briskly without disorienting blur, and cancels on user input.
 */
export function flyTo(scroller: HTMLElement, targetTop: number): () => void {
  const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const end = Math.max(0, Math.min(maxTop, targetTop));
  if (reducedMotion() || Math.abs(end - scroller.scrollTop) < 2) {
    scroller.scrollTop = end;
    return () => {};
  }

  const maxSpan = Math.max(scroller.clientHeight, 120);
  const delta = end - scroller.scrollTop;
  const start = Math.abs(delta) > maxSpan ? end - Math.sign(delta) * maxSpan : scroller.scrollTop;
  const span = end - start;

  let raf = 0;
  let stopped = false;
  const t0 = performance.now();

  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    scroller.removeEventListener("wheel", stop);
    scroller.removeEventListener("pointerdown", stop);
  };

  scroller.addEventListener("wheel", stop, { passive: true, once: true });
  scroller.addEventListener("pointerdown", stop, { passive: true, once: true });

  const step = (now: number) => {
    if (stopped) return;
    const p = Math.min(1, (now - t0) / FLY_MS);
    const eased = 1 - (1 - p) ** 3;
    scroller.scrollTop = start + span * eased;
    if (p < 1) raf = requestAnimationFrame(step);
    else stop();
  };

  raf = requestAnimationFrame(step);
  return stop;
}
