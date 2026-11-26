import {
  EXPRESSION_GROUPS,
  EXPRESSIONS,
  feel,
  FEELINGS,
  INTENSITY,
  listToonExpressions,
} from "mc-actor/toon-face";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { SearchBox } from "../components/SearchBox";
import {
  buildExpressionGroups,
  type ExpressionEntry,
  type ExpressionGroup,
  expressionKey,
  expressionLabel,
  filterExpressionGroups,
} from "./expression-library";
import { ExpressionPreview, FaceSwatch } from "./ExpressionPreview";

const groups = buildExpressionGroups(
  EXPRESSIONS,
  EXPRESSION_GROUPS,
  FEELINGS,
  new Map(listToonExpressions().map((entry) => [entry.name, entry])),
);
const catalog = groups.flatMap(({ label, entries }) =>
  entries.map((entry) => ({ entry, category: label })),
);
const previews = new WeakMap<ExpressionEntry, ReturnType<typeof feel>>();

function thumbnailFace(entry: ExpressionEntry) {
  let face = previews.get(entry);
  if (!face) {
    face = feel(entry.name, entry.kind === "ramp" ? INTENSITY.medium : 1);
    previews.set(entry, face);
  }
  return face;
}

function ExpressionGroupResults({
  group,
  pickedKey,
  onPick,
}: {
  group: ExpressionGroup;
  pickedKey: string | undefined;
  onPick: (selection: { entry: ExpressionEntry; category: string }) => void;
}) {
  const section = useRef<HTMLElement>(null);
  const [showThumbnails, setShowThumbnails] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    const target = section.current;
    if (!target || showThumbnails) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        setShowThumbnails(true);
      },
      { root: target.parentElement, rootMargin: "128px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [showThumbnails]);

  const { label, entries } = group;
  return (
    <section ref={section} aria-label={label} className="flex flex-none flex-col gap-1.5">
      <h3 className="text-label flex items-center gap-2 text-xs font-semibold">
        {label}
        <Badge variant="count-muted">{entries.length}</Badge>
      </h3>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,6.5rem),1fr))] gap-1.5">
        {entries.map((entry) => {
          const key = expressionKey(entry);
          return (
            <li key={key} className="min-w-0">
              <Button
                variant="tab"
                size="wrapping"
                aria-pressed={pickedKey === key}
                onClick={() => onPick({ entry, category: label })}
                className="h-full w-full flex-col"
              >
                {showThumbnails ? (
                  <FaceSwatch face={thumbnailFace(entry)} size={128} className="size-16" />
                ) : (
                  <span aria-hidden className="size-16" />
                )}
                <span className="wrap-anywhere">
                  {expressionLabel(entry.name)}
                  {entry.kind === "ramp" && " ramp"}
                </span>
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ExpressionLibrary() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [actor, setActor] = useState<string | null>(null);
  const [picked, setPicked] = useState(() => catalog.find(({ entry }) => entry.kind === "preset"));
  const results = useRef<HTMLDivElement>(null);
  const matches = filterExpressionGroups(groups, query);
  const visible = category ? filterExpressionGroups(groups, query, category) : matches;
  const count = visible.reduce((sum, { entries }) => sum + entries.length, 0);
  const options = [
    {
      value: "",
      label: "All categories",
      count: matches.reduce((sum, { entries }) => sum + entries.length, 0),
    },
    ...groups.map(({ id, label }) => ({
      value: id,
      label,
      count: matches.find((group) => group.id === id)?.entries.length ?? 0,
    })),
  ];

  function resetScroll() {
    if (results.current) results.current.scrollTop = 0;
  }

  return (
    <section
      aria-label="Expressions"
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-3 pt-1 pb-3"
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="flex flex-none flex-wrap items-center gap-2">
        <SearchBox
          name="expressions"
          label="Search expressions"
          placeholder="Search expressions"
          value={query}
          onChange={(value) => {
            setQuery(value);
            resetScroll();
          }}
          className="min-w-36 flex-1"
        />
        <Select
          items={options}
          value={category}
          onValueChange={(value) => {
            setCategory(value ?? "");
            resetScroll();
          }}
        >
          <SelectTrigger aria-label="Expression category" size="readable">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end" alignItemWithTrigger={false} fitContent motion="instant">
            <SelectGroup>
              {options.map(({ value, label, count }) => (
                <SelectItem key={value} value={value}>
                  {label}
                  <span className="text-muted-foreground ms-auto tabular-nums">{count}</span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <p role="status" className="text-muted-foreground text-xs tabular-nums">
        {count} of {catalog.length} expressions and ramps
      </p>
      {!count && (
        <Empty className="flex-none">
          <EmptyHeader>
            <EmptyTitle>{catalog.length ? "No matching expressions" : "No expressions"}</EmptyTitle>
            {catalog.length > 0 && (
              <EmptyDescription>Try another search or select All categories.</EmptyDescription>
            )}
          </EmptyHeader>
        </Empty>
      )}
      {picked && (
        <ExpressionPreview
          key={expressionKey(picked.entry)}
          entry={picked.entry}
          category={picked.category}
          actor={actor}
          onActorChange={setActor}
        />
      )}
      <div
        ref={results}
        data-arrow-scroll
        className="scroll-fade flex min-h-28 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-1 empty:hidden"
      >
        {visible.map((group) => (
          <ExpressionGroupResults
            key={group.id}
            group={group}
            pickedKey={picked && expressionKey(picked.entry)}
            onPick={setPicked}
          />
        ))}
      </div>
    </section>
  );
}
