import { Star } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, useRef } from "react";

import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import { KIT_CATEGORIES, KIT_CATEGORY_IDS } from "../../src/sound-kit-classify.mjs";
import { HorizontalScrollRail } from "./HorizontalScrollRail";
import type { KitCategoryCounts, KitCategoryFilter, KitViewTab } from "./sound-kit-view";

const CATEGORY_FILTER_ORDER: readonly KitCategoryFilter[] = ["all", ...KIT_CATEGORY_IDS];

export function SoundKitCategoryRail({
  tab,
  category,
  counts,
  onSelect,
}: {
  tab: KitViewTab;
  category: KitCategoryFilter;
  counts: KitCategoryCounts;
  onSelect: (next: KitCategoryFilter) => void;
}) {
  const countOf = (id: KitCategoryFilter) =>
    id === "all" ? counts.totals[tab] : counts.byCategory[id][tab];

  return (
    <nav
      aria-label="Core Sound Kit categories"
      className="border-border/50 flex w-40 flex-none flex-col gap-0.5 overflow-y-auto overscroll-contain border-e px-2 py-2.5 @max-[440px]:hidden"
    >
      <button
        type="button"
        aria-current={category === "all" ? "true" : undefined}
        onClick={() => onSelect("all")}
        className={cn(
          "studio-press focus-visible:ring-ring flex h-7 w-full items-center justify-between gap-1.5 rounded-md px-2 text-start text-xs transition-colors duration-150 outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:h-9",
          category === "all"
            ? "bg-raised-3 text-primary-text font-medium"
            : "text-foreground/80 hover:bg-card/80 hover:text-foreground",
        )}
      >
        <span className="truncate">All categories</span>
        <span
          className={cn(
            "text-tag tabular-nums",
            category === "all" ? "text-primary-text" : "text-foreground/70",
          )}
        >
          {countOf("all").toLocaleString()}
        </span>
      </button>

      <Separator className="my-1" />

      {KIT_CATEGORIES.map((cat) => {
        const c = counts.byCategory[cat.id];
        const active = category === cat.id;
        const tabCount = countOf(cat.id);
        return (
          <button
            key={cat.id}
            type="button"
            title={cat.hint}
            aria-current={active ? "true" : undefined}
            onClick={() => onSelect(cat.id)}
            className={cn(
              "studio-press focus-visible:ring-ring flex h-7 w-full items-center justify-between gap-1.5 rounded-md px-2 text-start text-xs transition-colors duration-150 outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:h-9",
              active
                ? "bg-raised-3 text-primary-text font-medium"
                : "text-foreground/80 hover:bg-card/80 hover:text-foreground",
            )}
          >
            <span className="truncate">{cat.title}</span>
            <span className="flex flex-none items-center gap-1 tabular-nums">
              {c.core > 0 && tab !== "core" && (
                <span className="text-tag text-ok-text inline-flex items-center gap-0.5 font-medium">
                  {c.core}
                  <Star aria-hidden className="size-2.5 fill-current" />
                  <span className="sr-only"> in core</span>
                </span>
              )}
              <span className={cn("text-tag", active ? "text-primary-text" : "text-foreground/70")}>
                {tabCount.toLocaleString()}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

export function SoundKitCategoryStrip({
  tab,
  category,
  counts,
  onSelect,
}: {
  tab: KitViewTab;
  category: KitCategoryFilter;
  counts: KitCategoryCounts;
  onSelect: (next: KitCategoryFilter) => void;
}) {
  const radioRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const countOf = (id: KitCategoryFilter) =>
    id === "all" ? counts.totals[tab] : counts.byCategory[id][tab];
  const edgesKey = `${tab}:${category}:${counts.totals.core}:${counts.totals.inbox}:${counts.totals.pass}:${counts.totals.popular}:${counts.totals.ban}`;

  const handleRadioKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const len = CATEGORY_FILTER_ORDER.length;
    const nextIdx =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? len - 1
          : (idx + (e.key === "ArrowRight" ? 1 : -1) + len) % len;
    const next = CATEGORY_FILTER_ORDER[nextIdx];
    if (!next) return;
    onSelect(next);
    radioRefs.current[nextIdx]?.focus();
  };

  return (
    <div className="@min-[441px]:hidden">
      <HorizontalScrollRail
        label="Core Sound Kit categories"
        leftLabel="Scroll categories left"
        rightLabel="Scroll categories right"
        edgesKey={edgesKey}
        className="gap-1"
      >
        <button
          ref={(el) => {
            radioRefs.current[0] = el;
          }}
          type="button"
          role="radio"
          tabIndex={category === "all" ? 0 : -1}
          aria-checked={category === "all"}
          onKeyDown={(e) => handleRadioKeyDown(e, 0)}
          onClick={() => onSelect("all")}
          className={cn(
            "focus-visible:ring-ring studio-press flex h-7 flex-none items-center gap-1 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none",
            category === "all"
              ? "border-primary/45 bg-tint text-primary-text"
              : "border-border/60 text-foreground/80 hover:border-border hover:text-foreground bg-transparent",
          )}
        >
          <span>All</span>
          <span
            className={cn(
              "text-tag tabular-nums",
              category === "all" ? "text-primary-text/90" : "text-muted-foreground",
            )}
          >
            {countOf("all").toLocaleString()}
          </span>
        </button>
        {KIT_CATEGORIES.map((cat, idx) => {
          const active = category === cat.id;
          const radioIdx = idx + 1;
          return (
            <button
              key={cat.id}
              ref={(el) => {
                radioRefs.current[radioIdx] = el;
              }}
              type="button"
              role="radio"
              tabIndex={active ? 0 : -1}
              aria-checked={active}
              title={cat.hint}
              onKeyDown={(e) => handleRadioKeyDown(e, radioIdx)}
              onClick={() => onSelect(cat.id)}
              className={cn(
                "focus-visible:ring-ring studio-press flex h-7 flex-none items-center gap-1 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none",
                active
                  ? "border-primary/45 bg-tint text-primary-text"
                  : "border-border/60 text-foreground/80 hover:border-border hover:text-foreground bg-transparent",
              )}
            >
              <span>{cat.title}</span>
              <span
                className={cn(
                  "text-tag tabular-nums",
                  active ? "text-primary-text/90" : "text-muted-foreground",
                )}
              >
                {countOf(cat.id).toLocaleString()}
              </span>
            </button>
          );
        })}
      </HorizontalScrollRail>
    </div>
  );
}
