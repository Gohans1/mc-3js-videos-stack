import { defaultRangeExtractor, type Range, useVirtualizer } from "@tanstack/react-virtual";
import { type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";

import { cn } from "@/lib/utils";

import { tableSpacers } from "./virtual-utils";

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
  role?: "list";
  stickyKeys?: readonly (string | number)[];
  scrollToIndex?: number | null;
  "data-arrow-scroll"?: boolean;
  header?: ReactNode;
  footer?: ReactNode;
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
  "data-arrow-scroll": arrowScroll,
  header,
  footer,
}: VirtualListProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusedKey = useRef<string | number | null>(null);
  const prevScrollIdx = useRef<number | null>(null);

  const keyIndex = useMemo(() => {
    const map = new Map<string | number, number>();
    items.forEach((item, i) => map.set(getKey(item, i), i));
    return map;
  }, [items, getKey]);

  const estimate = useCallback(
    (index: number) => (typeof estimateSize === "function" ? estimateSize(index) : estimateSize),
    [estimateSize],
  );

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
    getItemKey: (index) => getKey(items[index]!, index),
    overscan,
    gap,
    initialRect: { width: 400, height: 800 },
    useFlushSync: false,
    rangeExtractor,
  });

  useEffect(() => {
    if (scrollToIndex === null || scrollToIndex === undefined) {
      prevScrollIdx.current = null;
      return;
    }
    if (prevScrollIdx.current === scrollToIndex) return;
    prevScrollIdx.current = scrollToIndex;
    virtualizer.scrollToIndex(scrollToIndex, { align: "auto" });
  }, [scrollToIndex, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();
  const Container = role === "list" ? "ul" : "div";
  const ItemTag = role === "list" ? "li" : "div";

  return (
    <div
      ref={scrollRef}
      data-arrow-scroll={arrowScroll || undefined}
      className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", className)}
    >
      {header}
      <Container
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
              style={{ "--start": `${it.start}px` }}
              onFocus={() => {
                focusedKey.current = k;
              }}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                  focusedKey.current = null;
              }}
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

/** Virtualizes HTML `<TableBody>` rows using spacer heights to preserve sticky column alignment. */
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
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize,
    getItemKey: (index) => getKey(items[index]!, index),
    overscan,
    initialRect: { width: 400, height: 800 },
    useFlushSync: false,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const spacers = tableSpacers(virtualItems, virtualizer.getTotalSize());
  return { scrollRef, virtualItems, spacers, measureRow: virtualizer.measureElement };
}
