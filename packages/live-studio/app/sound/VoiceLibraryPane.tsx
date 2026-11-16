// Virtualized English ElevenLabs v4 voice browser: instant sample previewing,
// favorites sync, Copy ID, Compose Note handoff, and background sync controls.
import {
  Check,
  Copy,
  Info,
  MessageSquarePlus,
  Mic,
  Pause,
  Play,
  RefreshCw,
  SearchX,
} from "lucide-react";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { SharedVoiceEntry } from "../../src/voice-library.mjs";
import { FavoriteStar } from "../components/FavoriteStar";
import { Tip } from "../components/Tip";
import { chunkRows } from "../components/virtual-utils";
import { VirtualList } from "../components/VirtualList";
import { useStudio } from "../core/store";
import { openVoiceNote, originOf } from "../notes/notes";
import { auditionTarget, listening, listenUrl, subscribeAudition } from "./sound";
import {
  loadVoiceLibrary,
  syncVoiceLibraryNow,
  type VoiceLibraryClientState,
} from "./voice-library-client";
import {
  captureVoiceRowAnchor,
  DEFAULT_VOICE_FILTERS,
  formatCompactCount,
  hasActiveVoiceFilters,
  resolveVoiceRowOffset,
  stickyVoiceRowKeys,
  VOICE_GRID_GAP_PX,
  VOICE_GRID_MIN_CARD_PX,
  voiceDetailLine,
  voiceDisplayName,
  voiceEmptyState,
  type VoiceFilters,
  voiceGridCols,
  voiceRowKey,
  type VoiceScrollAnchor,
  voiceStarId,
  voiceTitle,
} from "./voice-library-view";

const VOICE_ESTIMATED_CARD_PX = 64;

const VOICE_GRID_CLS: Record<number, string> = {
  1: "grid grid-cols-1 items-stretch gap-2",
  2: "grid grid-cols-2 items-stretch gap-2",
  3: "grid grid-cols-3 items-stretch gap-2",
  4: "grid grid-cols-4 items-stretch gap-2",
  5: "grid grid-cols-5 items-stretch gap-2",
  6: "grid grid-cols-6 items-stretch gap-2",
};

export const VoiceCard = memo(function VoiceCard({
  voice,
  isPlaying,
  isTarget = false,
  isFav = false,
  isCopied = false,
  inFilm,
  showV4Badge = true,
  onCopyId,
}: {
  voice: SharedVoiceEntry;
  isPlaying: boolean;
  isTarget?: boolean;
  isFav?: boolean;
  isCopied?: boolean;
  inFilm: boolean;
  showV4Badge?: boolean;
  onCopyId?: (voice: SharedVoiceEntry) => void;
}) {
  const auditionId = `gv:${voice.id}`;
  const displayName = voiceDisplayName(voice.name);
  const detail = voiceDetailLine(voice);
  const [infoOpen, setInfoOpen] = useState(false);
  const popoverBodyRef = useRef<HTMLDivElement>(null);

  const detailsTrigger = (
    <PopoverTrigger
      render={
        <button
          type="button"
          aria-label={`Details for ${displayName}`}
          className={cn(
            "focus-visible:ring-ring studio-press inline-flex size-6 flex-none items-center justify-center rounded-full transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:size-9 [&_svg]:pointer-events-none [&_svg]:size-3",
            infoOpen
              ? "bg-tint text-primary-text ring-primary/50 ring-1"
              : "bg-backdrop text-foreground/90 hover:bg-raised-3 hover:text-foreground",
          )}
        />
      }
    >
      <Info />
    </PopoverTrigger>
  );

  return (
    <div
      data-voice-id={voice.id}
      className={cn(
        "group flex min-w-0 flex-col rounded-lg border px-2.5 py-2 transition-colors duration-150 select-none motion-reduce:transition-none",
        isPlaying
          ? "border-primary/75 bg-raised-3"
          : isTarget
            ? "border-primary/45 bg-raised-3"
            : "bg-card/85 hover:border-raised-4/50 hover:bg-raised-3 focus-within:border-raised-4/60 focus-within:bg-raised-3 border-border",
      )}
    >
      <div className="flex min-h-11 flex-1 items-start gap-2">
        <Tip label={isPlaying ? "Pause preview" : "Preview voice sample"}>
          <Button
            variant="cover"
            size="cover"
            className="mt-0.5 flex-none"
            disabled={!voice.previewUrl}
            onClick={() => {
              if (voice.previewUrl) listenUrl(auditionId, voice.previewUrl);
            }}
            aria-label={isPlaying ? `Pause ${displayName}` : `Preview ${displayName}`}
            aria-pressed={isPlaying}
          >
            {isPlaying ? (
              <Pause className="fill-current" />
            ) : (
              <Play className="translate-x-[0.5px] fill-current" />
            )}
          </Button>
        </Tip>

        <div className="flex min-w-0 flex-1 flex-col justify-between gap-0.5 self-stretch">
          <div className="relative flex min-h-6 items-start gap-1">
            <span
              className="text-ui text-foreground line-clamp-2 min-w-0 flex-1 py-0.5 leading-snug font-medium"
              title={displayName}
            >
              {displayName}
            </span>
            {isFav ? (
              <span className="inline-flex flex-none">
                <FavoriteStar kind="effects" id={voiceStarId(voice.id)} name={displayName} onCard />
              </span>
            ) : (
              <>
                <span className="hidden flex-none pointer-coarse:inline-flex">
                  <FavoriteStar
                    kind="effects"
                    id={voiceStarId(voice.id)}
                    name={displayName}
                    onCard
                  />
                </span>
                <span
                  className={cn(
                    "from-raised-3 pointer-events-none absolute end-7 top-0 flex h-6 items-center bg-linear-to-l from-75% to-transparent ps-4 opacity-0 transition-opacity duration-150 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 motion-reduce:transition-none pointer-coarse:hidden",
                    infoOpen && "pointer-events-auto opacity-100",
                  )}
                >
                  <FavoriteStar
                    kind="effects"
                    id={voiceStarId(voice.id)}
                    name={displayName}
                    onCard
                  />
                </span>
              </>
            )}

            <Popover open={infoOpen} onOpenChange={setInfoOpen}>
              <Tooltip open={infoOpen ? false : undefined}>
                <TooltipTrigger render={detailsTrigger} />
                <TooltipContent>Voice details & stats</TooltipContent>
              </Tooltip>
              <PopoverContent
                align="end"
                variant="flush"
                initialFocus={popoverBodyRef}
                className="w-[min(18.5rem,calc(100vw-1.5rem))] max-w-(--available-width)"
              >
                <div
                  ref={popoverBodyRef}
                  tabIndex={-1}
                  className="bg-backdrop flex flex-col gap-2.5 rounded-lg p-2.5 shadow-(--shadow-float) outline-none"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-ui text-foreground leading-snug font-medium">
                        {displayName}
                      </p>
                      {detail && (
                        <p className="text-tag text-foreground/70 mt-0.5 leading-snug">{detail}</p>
                      )}
                    </div>
                    {showV4Badge && voice.v4 && (
                      <Badge variant="synth" className="flex-none">
                        v4
                      </Badge>
                    )}
                  </div>
                  {voice.description && (
                    <p className="text-tag text-foreground/90 leading-relaxed select-text">
                      {voice.description}
                    </p>
                  )}
                  <div className="text-tag text-foreground/75 flex flex-wrap items-center gap-x-1.5 gap-y-1 tabular-nums">
                    {[
                      voiceTitle(voice.category),
                      `${formatCompactCount(voice.usage1y)} chars/yr`,
                      voice.likes > 0 ? `${formatCompactCount(voice.likes)} likes` : "",
                      voice.free ? "Free tier" : "Paid tier",
                    ]
                      .filter(Boolean)
                      .map((stat, statIdx) => (
                        <span key={stat} className="inline-flex items-center gap-1.5">
                          {statIdx > 0 && <span aria-hidden>·</span>}
                          <span>{stat}</span>
                        </span>
                      ))}
                  </div>
                  <div className="border-border/50 flex items-center justify-between gap-2 border-t pt-2">
                    <button
                      type="button"
                      onClick={() => onCopyId?.(voice)}
                      aria-label={`Copy voice ID ${voice.id}`}
                      className="bg-backdrop hover:bg-raised-3 text-tag text-foreground/85 focus-visible:ring-ring studio-press inline-flex h-6 min-w-0 items-center gap-1.5 rounded px-2 font-mono transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:min-h-9"
                    >
                      <span className="truncate">{voice.id}</span>
                      {isCopied ? (
                        <Check className="text-primary-text size-3 flex-none" />
                      ) : (
                        <Copy className="size-3 flex-none" />
                      )}
                    </button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-6 flex-none pointer-coarse:min-h-9"
                      onClick={(e) => {
                        const origin = originOf(e.currentTarget);
                        setInfoOpen(false);
                        openVoiceNote(displayName, voice.id, origin);
                      }}
                    >
                      <MessageSquarePlus className="size-3" />
                      <span>Use in note</span>
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <div className="mt-auto flex min-h-5 items-center gap-1.5 overflow-hidden">
            {showV4Badge && voice.v4 && (
              <Badge variant="synth" className="flex-none">
                v4
              </Badge>
            )}
            {voice.rate > 1 && (
              <Badge
                variant="claim"
                className="flex-none"
                title={`Consumes ${voice.rate}× credits per character`}
              >
                {voice.rate}×
              </Badge>
            )}
            {inFilm && (
              <Badge variant="voice" className="flex-none" title="Used in current film narration">
                In film
              </Badge>
            )}
            {detail && (
              <span
                className="text-foreground/70 text-tag min-w-0 flex-1 truncate leading-tight"
                title={detail}
              >
                {detail}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export function VoiceLibraryPane({
  library,
  voices,
  leaf,
  query,
  filters,
  onChangeFilters,
  onClearQuery,
  filmVoiceIds,
  hasVoiceFavs = false,
  copiedId = null,
  onCopyId,
  side = true,
}: {
  library: VoiceLibraryClientState;
  voices: readonly SharedVoiceEntry[];
  leaf: string;
  query: string;
  filters: VoiceFilters;
  onChangeFilters: (next: VoiceFilters) => void;
  onClearQuery: () => void;
  filmVoiceIds: ReadonlySet<string>;
  hasVoiceFavs?: boolean;
  copiedId?: string | null;
  onCopyId?: (voice: SharedVoiceEntry) => void;
  side?: boolean;
}) {
  // Subscribe to playing voice ID string rather than 80ms auditionRev ticks so virtualized rows never re-render during playback
  const now = useSyncExternalStore(subscribeAudition, listening, listening);
  const targetNow = useSyncExternalStore(subscribeAudition, auditionTarget, auditionTarget);
  const effectFavs = useStudio((s) => s.favorites.effects);
  const favSet = useMemo(() => new Set(effectFavs), [effectFavs]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(1);
  const colsRef = useRef(1);
  const voicesRef = useRef(voices);
  const refineRafRef = useRef<number | null>(null);
  const ignoreScrollUntilRef = useRef(0);
  const pendingAnchorRef = useRef<
    | (VoiceScrollAnchor & {
        focusVoiceId: string | null;
        focusBtnIndex: number;
      })
    | null
  >(null);
  const lastAnchoredRef = useRef<
    | (VoiceScrollAnchor & {
        voices: readonly SharedVoiceEntry[];
      })
    | null
  >(null);
  const hasVoices = voices.length > 0;
  const activeVoiceId = now.startsWith("gv:") ? now.slice(3) : "";
  const targetVoiceId = targetNow.startsWith("gv:") ? targetNow.slice(3) : "";

  useLayoutEffect(() => {
    colsRef.current = cols;
  }, [cols]);

  useLayoutEffect(() => {
    voicesRef.current = voices;
    lastAnchoredRef.current = null;
  }, [voices]);

  useEffect(
    () => () => {
      if (refineRafRef.current !== null) cancelAnimationFrame(refineRafRef.current);
    },
    [],
  );

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el || !hasVoices || typeof ResizeObserver === "undefined") return;
    // Observe VirtualList's stable scroll div and subtract px-* padding; flush before initial paint
    const scrollEl = (el.firstElementChild as HTMLElement | null) ?? el;
    const onUserScroll = () => {
      if (performance.now() > ignoreScrollUntilRef.current) {
        lastAnchoredRef.current = null;
      }
    };
    const syncCols = () => {
      const style = getComputedStyle(scrollEl);
      const pad = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const next = voiceGridCols(
        Math.max(0, scrollEl.clientWidth - pad),
        (VOICE_GRID_MIN_CARD_PX * rootPx) / 16,
      );
      const prev = colsRef.current;
      if (next === prev) return;

      const active = document.activeElement as HTMLElement | null;
      const activeCard =
        active && scrollEl.contains(active) ? active.closest<HTMLElement>("[data-voice-id]") : null;
      const focusVoiceId =
        activeCard?.dataset.voiceId ?? pendingAnchorRef.current?.focusVoiceId ?? null;
      const focusBtnIndex =
        activeCard && active
          ? [...activeCard.querySelectorAll<HTMLElement>("button, [role='slider']")].indexOf(active)
          : (pendingAnchorRef.current?.focusBtnIndex ?? -1);

      let anchor: typeof pendingAnchorRef.current = null;
      const last = lastAnchoredRef.current;
      if (last && last.voices === voicesRef.current) {
        anchor = {
          voiceIndex: last.voiceIndex,
          offsetWithinRow: last.offsetWithinRow,
          topRatio: last.topRatio,
          focusVoiceId,
          focusBtnIndex,
        };
      } else if (scrollEl.scrollTop > 2 || focusVoiceId) {
        const scrollRect = scrollEl.getBoundingClientRect();
        const rowNodes = [...scrollEl.querySelectorAll<HTMLElement>("[data-index]")].sort(
          (a, b) => Number(a.dataset.index) - Number(b.dataset.index),
        );
        const topRow = rowNodes.find((r) => r.getBoundingClientRect().bottom > scrollRect.top + 1);
        const step = VOICE_ESTIMATED_CARD_PX + VOICE_GRID_GAP_PX;
        const topIdx = topRow
          ? Number(topRow.dataset.index)
          : Math.floor(scrollEl.scrollTop / step);
        const rowRect = topRow?.getBoundingClientRect();
        anchor = {
          ...captureVoiceRowAnchor(
            topIdx,
            prev,
            rowRect ? rowRect.top - scrollRect.top : 0,
            rowRect?.height ?? VOICE_ESTIMATED_CARD_PX,
          ),
          focusVoiceId,
          focusBtnIndex,
        };
      }

      pendingAnchorRef.current = anchor;
      colsRef.current = next;
      setCols(next);
    };
    syncCols();
    scrollEl.addEventListener("scroll", onUserScroll, { passive: true });
    const ro = new ResizeObserver(syncCols);
    ro.observe(scrollEl);
    return () => {
      scrollEl.removeEventListener("scroll", onUserScroll);
      ro.disconnect();
    };
  }, [hasVoices, side]);

  const rows = useMemo(() => chunkRows(voices, cols), [voices, cols]);
  const stickyKeys = useMemo(() => {
    const ids: string[] = [];
    if (targetVoiceId) ids.push(targetVoiceId);
    if (focusedId) ids.push(focusedId);
    return stickyVoiceRowKeys(rows, ids);
  }, [rows, targetVoiceId, focusedId]);

  useLayoutEffect(() => {
    const anchor = pendingAnchorRef.current;
    if (!anchor || !rows.length) return;
    pendingAnchorRef.current = null;
    const el = hostRef.current;
    const scrollEl = (el?.firstElementChild as HTMLElement | null) ?? el;
    if (!scrollEl) return;

    const restoreFocus = () => {
      if (!anchor.focusVoiceId || anchor.focusBtnIndex < 0) return false;
      const card = scrollEl.querySelector<HTMLElement>(
        `[data-voice-id="${CSS.escape(anchor.focusVoiceId)}"]`,
      );
      const target =
        card?.querySelectorAll<HTMLElement>("button, [role='slider']")[anchor.focusBtnIndex];
      if (!target) return false;
      if (document.activeElement !== target) target.focus({ preventScroll: true });
      return true;
    };

    const targetRow = Math.min(rows.length - 1, Math.floor(anchor.voiceIndex / cols));
    const step = VOICE_ESTIMATED_CARD_PX + VOICE_GRID_GAP_PX;
    if (anchor.voiceIndex > 0) {
      const nextTop = Math.max(0, targetRow * step - anchor.offsetWithinRow);
      ignoreScrollUntilRef.current = performance.now() + 80;
      scrollEl.scrollTo({ top: nextTop, behavior: "instant" });
      lastAnchoredRef.current = {
        voiceIndex: anchor.voiceIndex,
        offsetWithinRow: anchor.offsetWithinRow,
        topRatio: anchor.topRatio,
        voices: voicesRef.current,
      };
    }

    restoreFocus();

    if (refineRafRef.current !== null) cancelAnimationFrame(refineRafRef.current);
    const refine = (attempt: number) => {
      refineRafRef.current = null;
      if (anchor.voiceIndex > 0) {
        const rowEl = scrollEl.querySelector<HTMLElement>(`[data-index="${targetRow}"]`);
        if (!rowEl && attempt < 3) {
          refineRafRef.current = requestAnimationFrame(() => refine(attempt + 1));
          return;
        }
        if (rowEl) {
          const rowRect = rowEl.getBoundingClientRect();
          const desiredOffset = resolveVoiceRowOffset(anchor, rowRect.height);
          const delta = rowRect.top - scrollEl.getBoundingClientRect().top - desiredOffset;
          if (Math.abs(delta) > 1) {
            ignoreScrollUntilRef.current = performance.now() + 80;
            scrollEl.scrollBy({ top: delta, behavior: "instant" });
          }
        }
      }
      restoreFocus();
    };
    refineRafRef.current = requestAnimationFrame(() => refine(0));
  }, [cols, rows]);
  const gridCls = VOICE_GRID_CLS[cols] ?? VOICE_GRID_CLS[1];
  const syncBanner =
    library.status === "syncing" ? (
      <div className="text-tag bg-card/70 border-border/45 mb-1.5 flex items-center gap-2 rounded-lg border px-2.5 py-1.5">
        <RefreshCw
          aria-hidden
          className="text-primary-text size-3 animate-spin motion-reduce:animate-none"
        />
        <span className="text-foreground/75 min-w-0 truncate tabular-nums">
          Syncing voices… page {library.pagesLoaded} ({library.totalEnglishV4.toLocaleString()} v4 /{" "}
          {library.totalEnglish.toLocaleString()} total)
        </span>
      </div>
    ) : !library.syncedAt && !library.voices.length && library.loaded && !library.error ? (
      <div className="text-tag bg-card/70 border-border/45 mb-1.5 rounded-lg border px-2.5 py-1.5">
        <span className="text-foreground/75">
          {library.hasKey ? "Ready to sync English voices" : "Connect ElevenLabs API key to sync"}
        </span>
      </div>
    ) : null;
  const hasTopBanner = Boolean(syncBanner || library.error);

  if (!voices.length) {
    const empty = voiceEmptyState({
      loaded: library.loaded,
      loading: library.loading,
      status: library.status,
      syncedAt: library.syncedAt,
      hasKey: library.hasKey,
      error: library.error,
      totalVoices: library.voices.length,
      leaf,
      query,
      hasVoiceFavs,
    });
    return (
      <div
        className={cn(
          "flex flex-col gap-2",
          side && "min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-3",
        )}
      >
        {syncBanner}
        {library.error && (
          <p
            role="alert"
            className="text-destructive bg-destructive/10 rounded-md px-2.5 py-1.5 text-xs"
          >
            {library.error}
          </p>
        )}
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              {empty.kind === "loading" ? (
                <RefreshCw className="animate-spin motion-reduce:animate-none" />
              ) : empty.kind === "nomatch" ? (
                <SearchX />
              ) : (
                <Mic />
              )}
            </EmptyMedia>
            <EmptyTitle>{empty.title}</EmptyTitle>
            <EmptyDescription>
              <span className="text-foreground/75">
                {empty.kind === "loading" && library.status === "syncing"
                  ? `Downloading English voices (page ${library.pagesLoaded}, ${library.totalEnglishV4.toLocaleString()} v4 found so far)…`
                  : empty.kind === "fetch-error"
                    ? `Failed to load — ${empty.detail}`
                    : empty.detail}
              </span>
            </EmptyDescription>
          </EmptyHeader>
          {empty.kind !== "loading" &&
            (empty.kind === "fetch-error" || empty.kind === "nomatch" || library.hasKey) && (
              <EmptyContent>
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  {empty.kind === "fetch-error" && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void loadVoiceLibrary(true)}
                    >
                      Retry
                    </Button>
                  )}
                  {(empty.kind === "sync-error" ||
                    empty.kind === "uncached" ||
                    empty.kind === "empty-catalog") &&
                    library.hasKey && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void syncVoiceLibraryNow()}
                      >
                        {empty.kind === "sync-error" ? "Retry sync" : "Sync English voices now"}
                      </Button>
                    )}
                  {empty.kind === "nomatch" && query.trim() && (
                    <Button variant="secondary" size="sm" onClick={onClearQuery}>
                      Clear search
                    </Button>
                  )}
                  {empty.kind === "nomatch" && hasActiveVoiceFilters(filters) && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onChangeFilters(DEFAULT_VOICE_FILTERS)}
                    >
                      Reset filters
                    </Button>
                  )}
                  {empty.kind === "nomatch" &&
                    filters.v4Mode !== "all" &&
                    (leaf !== "fav" || hasVoiceFavs) && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onChangeFilters({ ...filters, v4Mode: "all" })}
                      >
                        Include non-v4 English voices
                      </Button>
                    )}
                </div>
              </EmptyContent>
            )}
        </Empty>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col", side ? "min-h-0 flex-1" : "h-[min(70vh,28rem)] min-h-64")}>
      {hasTopBanner && (
        <div className={cn("flex flex-col", side && "px-3 pt-2.5")}>
          {syncBanner}
          {library.error && (
            <p
              role="alert"
              className="text-destructive bg-destructive/10 mb-1.5 rounded-md px-2.5 py-1 text-xs"
            >
              {library.error}
            </p>
          )}
        </div>
      )}
      <div
        ref={hostRef}
        role="region"
        aria-label="Shared English voice library"
        onFocusCapture={(e) => {
          const target = e.target instanceof HTMLElement ? e.target : null;
          const vid = target?.closest<HTMLElement>("[data-voice-id]")?.dataset.voiceId ?? null;
          setFocusedId((prev) => (prev === vid ? prev : vid));
        }}
        onBlurCapture={(e) => {
          const next = e.relatedTarget as Node | null;
          if (!next || !e.currentTarget.contains(next)) setFocusedId(null);
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <VirtualList
          items={rows}
          getKey={voiceRowKey}
          estimateSize={VOICE_ESTIMATED_CARD_PX}
          gap={VOICE_GRID_GAP_PX}
          overscan={8}
          className={
            side
              ? hasTopBanner
                ? "scroll-fade px-3 pb-3"
                : "scroll-fade px-3 pt-3 pb-3"
              : "scroll-fade"
          }
          stickyKeys={stickyKeys}
          resetKey={`${leaf}\0${query}\0${filters.v4Mode}\0${filters.category}\0${filters.gender}\0${filters.age}\0${filters.accent}\0${filters.descriptive}\0${filters.access}\0${filters.sort}`}
          data-arrow-scroll
          renderItem={(row) => (
            <div className={gridCls}>
              {row.map((voice) => (
                <VoiceCard
                  key={voice.id}
                  voice={voice}
                  isPlaying={activeVoiceId === voice.id}
                  isTarget={targetVoiceId === voice.id}
                  isFav={favSet.has(voiceStarId(voice.id))}
                  isCopied={copiedId === voice.id}
                  inFilm={filmVoiceIds.has(voice.id)}
                  showV4Badge={filters.v4Mode === "all"}
                  onCopyId={onCopyId}
                />
              ))}
            </div>
          )}
        />
      </div>
    </div>
  );
}

export default VoiceLibraryPane;
