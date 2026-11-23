let shown = new WeakMap<Element, boolean>();
const listeners = new WeakMap<Element, Set<() => void>>();
let observed = new WeakSet<Element>();
let ro: ResizeObserver | null = null;
let roCtor: typeof ResizeObserver | undefined;

const getRo = () => {
  if (typeof ResizeObserver === "undefined") return null;
  if (!ro || roCtor !== ResizeObserver) {
    roCtor = ResizeObserver;
    shown = new WeakMap<Element, boolean>();
    observed = new WeakSet<Element>();
    ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const rect = entry.contentRect;
        shown.set(
          entry.target,
          rect.width > 0 || rect.height > 0 ? true : entry.target.getClientRects().length > 0,
        );
      }
      for (const entry of entries) {
        const cbs = listeners.get(entry.target);
        if (cbs) for (const cb of Array.from(cbs)) cb();
      }
    });
  }
  return ro;
};

export function invalidateShown(el?: Element): void {
  if (el) shown.delete(el);
  else shown = new WeakMap<Element, boolean>();
}

export function onShownResize(el: Element, cb: () => void): () => void {
  let cbs = listeners.get(el);
  if (!cbs) {
    cbs = new Set();
    listeners.set(el, cbs);
  }
  cbs.add(cb);
  const observer = getRo();
  if (observer && !observed.has(el)) {
    observed.add(el);
    observer.observe(el);
  }
  return () => {
    const current = listeners.get(el);
    if (!current) return;
    current.delete(cb);
    if (current.size === 0) {
      listeners.delete(el);
      observed.delete(el);
      shown.delete(el);
      getRo()?.unobserve?.(el);
    }
  };
}

export function isElementShown(el: Element): boolean {
  const observer = getRo();
  if (!el.isConnected) {
    shown.delete(el);
    return false;
  }
  const cached = shown.get(el);
  if (cached !== undefined) return cached;
  const visible = el.getClientRects().length > 0;
  shown.set(el, visible);
  if (observer && !observed.has(el)) {
    observed.add(el);
    observer.observe(el);
  }
  return visible;
}
