import type { Virtualizer } from "@tanstack/react-virtual";

export const INITIAL_VIRTUAL_RECT = { width: 320, height: 600 };

/** Defers rect reads to ResizeObserver so mounting never forces sync layout inside commit. */
export function observeVirtualRect<T extends Element>(
  instance: { scrollElement: T | null },
  cb: (rect: { width: number; height: number }) => void,
) {
  const el = instance.scrollElement;
  if (!el) return;
  if (typeof ResizeObserver === "undefined") {
    cb({ width: el.clientWidth, height: el.clientHeight });
    return;
  }
  const ro = new ResizeObserver(() => {
    cb({ width: el.clientWidth, height: el.clientHeight });
  });
  ro.observe(el, { box: "content-box" });
  return () => ro.disconnect();
}

/** Skips sync offsetHeight reflow when ref attaches without a ResizeObserver entry; RO measures asynchronously right after layout. */
export function measureVirtualElement<TScrollElement extends Element, TItemElement extends Element>(
  element: TItemElement,
  entry: ResizeObserverEntry | undefined,
  instance: Virtualizer<TScrollElement, TItemElement>,
): number {
  const box = entry?.borderBoxSize?.[0];
  if (box) return Math.round(instance.options.horizontal ? box.inlineSize : box.blockSize);
  const index = instance.indexFromElement(element);
  if (index === null || index === undefined) return 0;
  const key = instance.options.getItemKey(index);
  const cached = instance.itemSizeCache.get(key);
  if (cached !== undefined) return cached;
  if (!entry && typeof ResizeObserver !== "undefined") {
    return instance.measurementsCache[index]?.size ?? instance.options.estimateSize(index);
  }
  if (typeof HTMLElement !== "undefined" && element instanceof HTMLElement) {
    return instance.options.horizontal ? element.offsetWidth : element.offsetHeight;
  }
  return Math.round(
    element.getBoundingClientRect()[instance.options.horizontal ? "width" : "height"],
  );
}

const scrolledContainers = new WeakSet<Element>();

/** Skips no-op scrollTo({ top: 0 }) on initial mount commit when offset is already 0. */
export function scrollVirtualElement<TScrollElement extends Element, TItemElement extends Element>(
  offset: number,
  canScroll: { adjustments?: number; behavior?: ScrollBehavior },
  instance: Virtualizer<TScrollElement, TItemElement>,
): void {
  const el = instance.scrollElement;
  if (!el) return;
  const target = offset + (canScroll.adjustments ?? 0);
  if (
    target === 0 &&
    !canScroll.behavior &&
    instance.scrollOffset === 0 &&
    !scrolledContainers.has(el)
  ) {
    return;
  }
  scrolledContainers.add(el);
  (el as { scrollTo?: (opts: ScrollToOptions) => void }).scrollTo?.({
    [instance.options.horizontal ? "left" : "top"]: target,
    behavior: canScroll.behavior,
  });
}

export function chunkRows<T>(items: readonly T[], cols: number): T[][] {
  if (!items.length) return [];
  const step = Math.max(1, Math.floor(cols));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}

export function tableSpacers(
  items: readonly { start: number; end: number }[],
  totalSize: number,
): { top: number; bottom: number } {
  if (!items.length) return { top: 0, bottom: 0 };
  const top = Math.max(0, items[0]!.start);
  const lastEnd = items[items.length - 1]!.end;
  const bottom = Math.max(0, totalSize - lastEnd);
  return { top, bottom };
}

/** Returns missing vertical height between two non-contiguous virtualized table rows. */
export function tableGapBetween(
  prev: { index: number; end: number } | undefined,
  curr: { index: number; start: number },
): number {
  if (!prev || curr.index <= prev.index + 1) return 0;
  return Math.max(0, curr.start - prev.end);
}
