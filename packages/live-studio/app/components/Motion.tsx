import { type ReactNode, type RefObject, useLayoutEffect, useRef } from "react";

export const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
export const EASE_ACCORDION = "cubic-bezier(0.4, 0, 0.2, 1)";

export function prefersReduced(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

function resolveDirection(
  prev: string | number | null,
  next: string | number,
  order?: readonly (string | number)[],
): 1 | -1 {
  if (prev === null || !order) return 1;
  const from = order.indexOf(prev);
  const to = order.indexOf(next);
  if (from === -1 || to === -1 || from === to) return 1;
  return to > from ? 1 : -1;
}

/**
 * Animates panel content on key changes using WAAPI, skipping the initial mount
 * unless `animateMount` is true and canceling prior runs when interrupted.
 */
export function TabStage({
  activeKey,
  order,
  axis = "x",
  distance = 10,
  duration = 180,
  animateMount = false,
  className,
  children,
}: {
  activeKey: string | number;
  order?: readonly (string | number)[];
  axis?: "x" | "y";
  distance?: number;
  duration?: number;
  animateMount?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const prevKeyRef = useRef<string | number | null>(null);
  const animRef = useRef<Animation | null>(null);
  const orderRef = useRef(order);

  useLayoutEffect(() => {
    orderRef.current = order;
  }, [order]);

  useLayoutEffect(() => {
    const prev = prevKeyRef.current;
    prevKeyRef.current = activeKey;

    if (prev === null && !animateMount) return;
    if (prev === activeKey) return;

    const el = ref.current;
    if (!el || !el.animate) return;

    animRef.current?.cancel();

    if (prefersReduced()) return;

    const dir = resolveDirection(prev, activeKey, orderRef.current);
    const shift = dir * distance;
    const fromTransform =
      axis === "x"
        ? `translate3d(${shift}px, 0, 0) scale(0.992)`
        : `translate3d(0, ${shift}px, 0) scale(0.992)`;

    const anim = el.animate(
      [
        { opacity: 0, transform: fromTransform },
        { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" },
      ],
      { duration, easing: EASE_OUT },
    );
    animRef.current = anim;
    anim.onfinish = () => {
      if (animRef.current === anim) animRef.current = null;
    };
    return () => {
      anim.cancel();
      if (animRef.current === anim) animRef.current = null;
    };
  }, [activeKey, animateMount, axis, distance, duration]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/**
 * Runs a crisp one-shot entrance animation on mount (and optional key changes).
 */
export function useEnterMotion(
  ref: RefObject<HTMLElement | null>,
  opts: {
    x?: number;
    y?: number;
    scale?: number;
    duration?: number;
    trigger?: string | number | boolean;
  } = {},
) {
  const { x = 0, y = 8, scale = 0.99, duration = 200, trigger } = opts;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !el.animate || prefersReduced()) return;

    const anim = el.animate(
      [
        {
          opacity: 0,
          transform: `translate3d(${x}px, ${y}px, 0) scale(${scale})`,
        },
        {
          opacity: 1,
          transform: "translate3d(0, 0, 0) scale(1)",
        },
      ],
      { duration, easing: EASE_OUT },
    );

    return () => {
      anim.cancel();
    };
  }, [duration, ref, scale, trigger, x, y]);
}
