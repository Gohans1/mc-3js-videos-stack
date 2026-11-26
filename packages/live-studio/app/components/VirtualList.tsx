import { defaultRangeExtractor, type Range, useVirtualizer } from "@tanstack/react-virtual";
import {
  type FocusEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";

import { cn } from "@/lib/utils";

import {
  INITIAL_VIRTUAL_RECT,
  measureVirtualElement,
  observeVirtualRect,
  scrollVirtualElement,
  tableSpacers,
} from "./virtual-utils";

export interface VirtualListProps<T> {
  items: readonly T[];
  getKey: (item: T, index: number) => string | number;
  estimateSize: number | ((index: number) => number);
  renderItem: (item: T, index: number) => ReactNode;
  overscan?: number;
  gap?: number;
  className?: string;
  listClassName?: string;
  itemClassName?: string;
  ariaLabel?: string;
  role?: "list" | "region";
  stickyKeys?: readonly (string | number)[];
  scrollToIndex?: number | null;
  scrollToRef?: RefObject<
    ((index: number, align?: "auto" | "center" | "start" | "end") => void) | null
  >;
  resetKey?: string | number;
  "data-arrow-scroll"?: boolean;
  header?: ReactNode;
  scrollOwner?: RefObject<HTMLDivElement | null>;
  scrollMargin?: number;
  footer?: ReactNode;
}

function useKeyedVirtualizer<T>({
  scrollRef,
  items,
  getKey,
  estimateSize,
  overscan,
  gap,
  stickyKeys,
  scrollMargin = 0,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  items: readonly T[];
  getKey: (item: T, index: number) => string | number;
  estimateSize: number | ((index: number) => number);
  overscan: number;
  gap?: number;
  stickyKeys?: readonly (string | number)[];
  scrollMargin?: number;
}) {
  const focusedKey = useRef<string | number | null>(null);

  const keyIndex = useMemo(() => {
    const map = new Map<string | number, number>();
    items.forEach((item, i) => map.set(getKey(item, i), i));
    return map;
  }, [items, getKey]);

  const estimate = useCallback(
    (index: number) => (typeof estimateSize === "function" ? estimateSize(index) : estimateSize),
    [estimateSize],
  );
  const getItemKey = useCallback((index: number) => getKey(items[index]!, index), [items, getKey]);

  const rangeExtractor = useCallback(
    (range: Range) => {
      const base = defaultRangeExtractor(range);
      const extra = new Set<number>(base);
      if (focusedKey.current !== null) {
        const fi = keyIndex.get(focusedKey.current);
        if (fi !== undefined) extra.add(fi);
      }
      if (stickyKeys) {
        for (const k of stickyKeys) {
          const ki = keyIndex.get(k);
          if (ki !== undefined) extra.add(ki);
        }
      }
      return extra.size === base.length ? base : [...extra].toSorted((a, b) => a - b);
    },
    [keyIndex, stickyKeys],
  );

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: estimate,
    getItemKey,
    overscan,
    gap,
    scrollMargin,
    initialRect: INITIAL_VIRTUAL_RECT,
    observeElementRect: observeVirtualRect,
    measureElement: measureVirtualElement,
    scrollToFn: scrollVirtualElement,
    useFlushSync: false,
    rangeExtractor,
  });

  const itemFocusProps = useCallback(
    (key: string | number) => ({
      onFocus: () => {
        focusedKey.current = key;
      },
      onBlur: (e: FocusEvent<HTMLElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focusedKey.current = null;
      },
    }),
    [],
  );

  return { virtualizer, itemFocusProps };
}

/**
 * Dynamic-height virtualized vertical list powered by `@tanstack/react-virtual`.
 * Uses `useFlushSync: false` for React 19 concurrent safety and retains focused/sticky keys in the DOM.
 */
export function VirtualList<T>({
  items,
  getKey,
  estimateSize,
  renderItem,
  overscan = 6,
  gap = 0,
  className,
  listClassName,
  itemClassName,
  ariaLabel,
  role,
  stickyKeys,
  scrollToIndex,
  scrollToRef,
  resetKey,
  "data-arrow-scroll": arrowScroll,
  header,
  scrollOwner,
  scrollMargin = 0,
  footer,
}: VirtualListProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const scrollRef = scrollOwner ?? listRef;
  const { virtualizer, itemFocusProps } = useKeyedVirtualizer({
    scrollRef,
    items,
    getKey,
    estimateSize,
    overscan,
    gap,
    stickyKeys,
    scrollMargin,
  });
  const prevScrollIdx = useRef<number | null>(null);

  useEffect(() => {
    if (!scrollToRef) return;
    scrollToRef.current = (index: number, align: "auto" | "center" | "start" | "end" = "auto") =>
      virtualizer.scrollToIndex(index, { align });
    return () => {
      scrollToRef.current = null;
    };
  }, [scrollToRef, virtualizer]);

  useEffect(() => {
    if (scrollToIndex === null || scrollToIndex === undefined) {
      prevScrollIdx.current = null;
      return;
    }
    if (prevScrollIdx.current === scrollToIndex) return;
    prevScrollIdx.current = scrollToIndex;
    virtualizer.scrollToIndex(scrollToIndex, { align: "auto" });
  }, [scrollToIndex, virtualizer]);

  const prevResetKey = useRef(resetKey);
  useEffect(() => {
    if (prevResetKey.current === resetKey) return;
    prevResetKey.current = resetKey;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [resetKey, scrollRef]);

  const virtualItems = virtualizer.getVirtualItems();
  const Container = role === "list" ? "ul" : "div";
  const ItemTag = role === "list" ? "li" : "div";

  return (
    <div
      ref={listRef}
      data-arrow-scroll={arrowScroll || undefined}
      className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", className)}
    >
      {header}
      <Container
        role={role === "region" ? "region" : undefined}
        aria-label={ariaLabel}
        className={cn("relative h-(--total) w-full", listClassName)}
        style={{ "--total": `${virtualizer.getTotalSize()}px` }}
      >
        {virtualItems.map((it) => {
          const item = items[it.index]!;
          const k = getKey(item, it.index);
          return (
            <ItemTag
              key={it.key}
              data-index={it.index}
              ref={virtualizer.measureElement}
              className={cn("absolute inset-x-0 top-0 translate-y-(--start)", itemClassName)}
              style={{ "--start": `${it.start - scrollMargin}px` }}
              {...itemFocusProps(k)}
            >
              {renderItem(item, it.index)}
            </ItemTag>
          );
        })}
      </Container>
      {footer}
    </div>
  );
}

export function useVirtualTable<T>({
  items,
  getKey,
  estimateSize = 44,
  overscan = 8,
}: {
  items: readonly T[];
  getKey: (item: T, index: number) => string | number;
  estimateSize?: number;
  overscan?: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { virtualizer, itemFocusProps } = useKeyedVirtualizer({
    scrollRef,
    items,
    getKey,
    estimateSize,
    overscan,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const spacers = tableSpacers(virtualItems, virtualizer.getTotalSize());
  return {
    scrollRef,
    virtualItems,
    spacers,
    measureRow: virtualizer.measureElement,
    rowFocusProps: itemFocusProps,
  };
}
