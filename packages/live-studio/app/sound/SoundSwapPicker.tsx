import { Check, ChevronsUpDown, Pause, Play } from "lucide-react";
import { useDeferredValue, useMemo, useState, useSyncExternalStore } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { Segmented } from "../components/inspector";
import { SearchBox } from "../components/SearchBox";
import { words } from "../core/search";
import {
  ALL,
  collapseSwapFamilies,
  displayTitleOf,
  formatSoundDuration,
  itemSearchTokens,
  itemVariantTitle,
  originOf,
  sortLibraryItems,
  type SoundKind,
  sourceOf,
  sourceTitle,
} from "./library-view";
import {
  familyItemsOf,
  kindOf,
  library,
  type LibraryItem,
  listen,
  listening,
  subscribeAudition,
} from "./sound";

const MAX_SWAP_RESULTS = 60;
type SwapScope = typeof ALL | SoundKind;

function SoundSwapList({
  items,
  value,
  initialScope,
  narrationName,
  onPick,
  onClose,
}: {
  items: readonly LibraryItem[];
  value: string;
  initialScope: SwapScope;
  narrationName: string | null;
  onPick: (name: string) => void;
  onClose: () => void;
}) {
  const now = useSyncExternalStore(subscribeAudition, listening);
  const [q, setQ] = useState("");
  const deferredQ = useDeferredValue(q);
  const [scope, setScope] = useState<SwapScope>(initialScope);

  const scopedSorted = useMemo(
    () =>
      sortLibraryItems(
        items.filter(
          (x) =>
            (x.name !== narrationName || x.name === value) &&
            (scope === ALL || kindOf(x) === scope),
        ),
      ),
    [items, narrationName, scope, value],
  );

  const hasDigitQuery = /\d/.test(deferredQ);
  const matched = useMemo(() => {
    const want = words(deferredQ);
    const filtered = !want.length
      ? scopedSorted
      : scopedSorted.filter((x) => {
          const have = itemSearchTokens(x);
          return want.every((w) => have.some((h) => h.startsWith(w)));
        });
    return hasDigitQuery ? filtered : collapseSwapFamilies(filtered, value);
  }, [deferredQ, hasDigitQuery, scopedSorted, value]);

  const visible = matched.slice(0, MAX_SWAP_RESULTS);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none flex-col gap-2 border-b p-2.5">
        <SearchBox
          name="swap-sound-search"
          value={q}
          onChange={setQ}
          onEscape={onClose}
          label="Search sound file"
          placeholder="Search sounds…"
          className="w-full"
        />
        <Segmented
          label="Sound scope"
          value={scope}
          onChange={setScope}
          items={[
            { id: ALL, title: "All" },
            { id: "sfx", title: "SFX" },
            { id: "mc", title: "MC" },
            { id: "bgm", title: "Music" },
          ]}
        />
      </div>
      <ul
        aria-label="Matching sounds"
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain p-1.5"
      >
        {visible.map((x) => {
          const isCurrent = x.name === value;
          const isPlaying = now === x.name;
          const takeCount = x.family ? familyItemsOf(x.name).length : 1;
          const label =
            takeCount > 1 && !hasDigitQuery && !isCurrent ? displayTitleOf(x) : itemVariantTitle(x);
          const itemKind = kindOf(x);
          return (
            <li
              key={x.name}
              className={cn(
                "hover:bg-raised-3 flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors duration-150",
                isCurrent && "bg-raised-2",
              )}
            >
              <Button
                variant="quiet"
                size="icon-sm"
                aria-pressed={isPlaying}
                aria-label={`${isPlaying ? "Stop" : "Preview"} ${label}`}
                onClick={() => listen(x.name)}
              >
                {isPlaying ? <Pause className="fill-current" /> : <Play className="fill-current" />}
              </Button>
              <button
                type="button"
                onClick={() => onPick(x.name)}
                className="focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 py-1 text-start outline-none focus-visible:ring-2"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={cn(
                      "truncate text-xs",
                      isCurrent ? "text-primary font-medium" : "text-foreground",
                    )}
                  >
                    {label}
                  </span>
                  <span className="text-tag text-muted-foreground flex min-w-0 items-center gap-1">
                    {originOf(x) === "synth" && <Badge variant="synth">Code</Badge>}
                    <span className="truncate">{sourceTitle(sourceOf(x))}</span>
                    {takeCount > 1 && !hasDigitQuery && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="flex-none tabular-nums">{takeCount} takes</span>
                      </>
                    )}
                    <span aria-hidden>·</span>
                    <span className="flex-none tabular-nums">
                      {formatSoundDuration(x.seconds, itemKind)}
                    </span>
                  </span>
                </span>
                {isCurrent && <Check aria-hidden className="text-primary size-3.5 flex-none" />}
              </button>
            </li>
          );
        })}
        {!visible.length && (
          <li className="text-muted-foreground px-2 py-4 text-center text-xs">
            No sounds match &ldquo;{q.trim()}&rdquo;.
          </li>
        )}
        {matched.length > MAX_SWAP_RESULTS && (
          <li className="text-tag text-muted-foreground px-2 py-1 text-center tabular-nums">
            Showing {MAX_SWAP_RESULTS} of {matched.length} — type more to narrow
          </li>
        )}
      </ul>
    </div>
  );
}

export function SoundSwapPicker({
  value,
  currentItem,
  narrationName,
  disabled,
  onChange,
}: {
  value: string;
  currentItem: LibraryItem | undefined;
  narrationName: string | null;
  disabled?: boolean;
  onChange: (nextName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerLabel = currentItem ? itemVariantTitle(currentItem) : value;
  const initialScope: SwapScope = currentItem ? kindOf(currentItem) : ALL;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="lg"
            disabled={disabled}
            aria-label="Sound file"
            title={triggerLabel}
            className="w-full min-w-0 justify-between"
          />
        }
      >
        <span className="min-w-0 flex-1 truncate text-start text-xs font-normal">
          {triggerLabel}
        </span>
        <ChevronsUpDown aria-hidden className="text-muted-foreground size-3.5 flex-none" />
      </PopoverTrigger>
      <PopoverContent
        variant="flush"
        align="end"
        sideOffset={4}
        className="flex max-h-[min(420px,var(--available-height))] w-80 flex-col overflow-hidden"
      >
        {open && (
          <SoundSwapList
            items={library}
            value={value}
            initialScope={initialScope}
            narrationName={narrationName}
            onClose={() => setOpen(false)}
            onPick={(next) => {
              if (next !== value) onChange(next);
              setOpen(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
