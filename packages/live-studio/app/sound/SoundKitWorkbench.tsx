import {
  AlertTriangle,
  Film,
  Headphones,
  Keyboard,
  Redo2,
  Search,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { classifyPopularSound, type KitStatus } from "../../src/sound-kit-classify.mjs";
import { Tip } from "../components/Tip";
import { VirtualList } from "../components/VirtualList";
import { say, useStudio } from "../core/store";
import { FilterTriggerButton } from "./FilterTriggerButton";
import { HorizontalScrollRail } from "./HorizontalScrollRail";
import {
  cleanAudioTitle,
  formatSoundDuration,
  originOf,
  sourceOf,
  sourceTitle,
} from "./library-view";
import {
  audibleName,
  clearSoundReveal,
  clipOf,
  ensureSoundLibrary,
  itemOf,
  lanes,
  library,
  listening,
  stopAudition,
  subscribeAudition,
} from "./sound";
import {
  acquireWorkbenchMount,
  applyKitSoundToFilm,
  getSoundKitSnapshot,
  isEditableSoundClip,
  playKitSound,
  previewSoundInVideo,
  redoKit,
  reloadSoundKit,
  removeKitItem,
  saveKitItem,
  stopMiniStudioBuffer,
  stopVideoPreview,
  toggleKitAbSlot,
  undoKit,
  useSoundKit,
  warmAbAudio,
} from "./sound-kit-client";
import {
  buildKitRows,
  buildPopularPool,
  computeCategoryCounts,
  isBulkPopularSource,
  type KitCategoryFilter,
  type KitRow,
  type KitViewTab,
  nextFocusAfterTriage,
  type PopularPoolScope,
  resolveKitTargetRowId,
  shouldInterceptKitKey,
  stepFocusIndex,
  suggestedTagsForCategory,
} from "./sound-kit-view";
import { SoundKitAbDeck } from "./SoundKitAbDeck";
import { SoundKitCategoryRail, SoundKitCategoryStrip } from "./SoundKitCategoryNav";
import { KitRowCard } from "./SoundKitRowCard";
import { SoundKitSimilarDrawer } from "./SoundKitSimilarDrawer";

const VIEW_TABS: readonly { id: KitViewTab; label: string; shortLabel: string }[] = [
  { id: "inbox", label: "Inbox", shortLabel: "Inbox" },
  { id: "core", label: "Core Kit", shortLabel: "Core" },
  { id: "popular", label: "Popular Pool", shortLabel: "Pool" },
  { id: "ban", label: "Banned", shortLabel: "Ban" },
];

const KIT_ESTIMATED_ROW_PX = 76;
const KIT_DIVIDER_PX = 28;

type KitVirtualEntry = { kind: "divider"; count: number } | { kind: "row"; row: KitRow };

const kitEntryKey = (entry: KitVirtualEntry) =>
  entry.kind === "divider" ? "__passed_divider__" : entry.row.id;

interface KitSessionView {
  chosenTab: KitViewTab | null;
  category: KitCategoryFilter;
  query: string;
  activeTag: string;
  poolScope: PopularPoolScope;
  includeSynth: boolean;
  includeMc: boolean;
  videoMode: boolean;
  selectedAbSlot: number;
  focusedId: string | null;
  similarId: string | null;
}

let sessionView: KitSessionView = {
  chosenTab: null,
  category: "all",
  query: "",
  activeTag: "",
  poolScope: "curated",
  includeSynth: false,
  includeMc: false,
  videoMode: false,
  selectedAbSlot: 0,
  focusedId: null,
  similarId: null,
};

const saveSessionView = (next: KitSessionView) => {
  sessionView = next;
};

export function SoundKitWorkbench({
  onDockToWatch,
  dock,
  onFallbackToLibrary,
}: {
  onDockToWatch?: () => void;
  dock?: ReactNode;
  onFallbackToLibrary?: (names: string[]) => void;
}) {
  const soundRev = useStudio((s) => s.soundRev);
  const clip = useStudio((s) => s.clip);
  const clips = useStudio((s) => s.clips);
  const soundReveal = useStudio((s) => s.soundReveal);
  const kit = useSoundKit(true);
  const hasEditableClip =
    isEditableSoundClip(clip) ||
    (kit.videoPreview.active && isEditableSoundClip(kit.videoPreview.targetClip));
  const nowPlaying = useSyncExternalStore(subscribeAudition, listening, listening);
  const selectedClipNames = useMemo(() => {
    void soundRev;
    const set = new Set<string>();
    for (const ref of clips) {
      const row = clipOf(ref);
      const name = row ? (audibleName(row) ?? row.name) : undefined;
      if (name) set.add(name);
    }
    return set;
  }, [clips, soundRev]);

  useEffect(() => {
    void ensureSoundLibrary();
    return acquireWorkbenchMount();
  }, []);

  useEffect(() => {
    if (kit.state.abSlots.length) warmAbAudio(kit.state.abSlots);
  }, [kit.state.abSlots]);

  const [chosenTab, setChosenTab] = useState<KitViewTab | null>(sessionView.chosenTab);
  const [category, setCategory] = useState<KitCategoryFilter>(sessionView.category);
  const [query, setQuery] = useState(sessionView.query);
  const deferredQuery = useDeferredValue(query);
  const [activeTag, setActiveTag] = useState(sessionView.activeTag);
  const [poolScope, setPoolScope] = useState<PopularPoolScope>(sessionView.poolScope);
  const [includeSynth, setIncludeSynth] = useState(sessionView.includeSynth);
  const [includeMc, setIncludeMc] = useState(sessionView.includeMc);
  const [videoMode, setVideoMode] = useState(sessionView.videoMode);
  const [selectedAbSlot, setSelectedAbSlot] = useState(sessionView.selectedAbSlot);
  const [focusedId, setFocusedId] = useState<string | null>(sessionView.focusedId);
  const [metaOpenId, setMetaOpenId] = useState<string | null>(null);
  const [similarId, setSimilarId] = useState<string | null>(sessionView.similarId);
  const [filterOpen, setFilterOpen] = useState(false);
  const [revealFilterIds, setRevealFilterIds] = useState<string[] | null>(null);
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRevealSeqRef = useRef(0);
  const searchId = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const workbenchRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const kitScrollToRef = useRef<
    ((index: number, align?: "auto" | "center" | "start" | "end") => void) | null
  >(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(
    () => () => {
      if (revealTimerRef.current !== null) clearTimeout(revealTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    saveSessionView({
      chosenTab,
      category,
      query,
      activeTag,
      poolScope,
      includeSynth,
      includeMc,
      videoMode,
      selectedAbSlot,
      focusedId,
      similarId,
    });
  }, [
    chosenTab,
    category,
    query,
    activeTag,
    poolScope,
    includeSynth,
    includeMc,
    videoMode,
    selectedAbSlot,
    focusedId,
    similarId,
  ]);

  const defaultTab: KitViewTab = useMemo(() => {
    const items = Object.values(kit.state.items);
    if (items.some((x) => x.status === "inbox")) return "inbox";
    if (items.some((x) => x.status === "core")) return "core";
    return "popular";
  }, [kit.state.items]);
  const tab: KitViewTab = chosenTab ?? defaultTab;
  const setTab = (next: KitViewTab) => setChosenTab(next);
  const pinTab = () => {
    if (chosenTab === null) setChosenTab(tab);
  };

  const libraryItems = library;
  const narrationName = lanes?.narration ?? null;
  const kitItems = kit.state.items;
  const poolOpts = useMemo(
    () => ({ scope: poolScope, includeSynth, includeMc, narrationName }),
    [poolScope, includeSynth, includeMc, narrationName],
  );
  const popularPool = useMemo(
    () =>
      buildPopularPool(
        libraryItems,
        { version: 1, items: kitItems, abSlots: [], decisions: [] },
        poolOpts,
      ),
    [libraryItems, kitItems, poolOpts],
  );
  const counts = useMemo(
    () =>
      computeCategoryCounts(
        libraryItems,
        { version: 1, items: kitItems, abSlots: [], decisions: [] },
        poolOpts,
        popularPool,
      ),
    [libraryItems, kitItems, poolOpts, popularPool],
  );
  const baseRows = useMemo(
    () =>
      buildKitRows({
        library: libraryItems,
        kitState: kit.state,
        tab,
        category,
        query: deferredQuery,
        tag: activeTag,
        poolScope,
        includeSynth,
        includeMc,
        narrationName,
        popularPool,
      }),
    [
      libraryItems,
      kit.state,
      tab,
      category,
      deferredQuery,
      activeTag,
      poolScope,
      includeSynth,
      includeMc,
      narrationName,
      popularPool,
    ],
  );
  const rows = useMemo(() => {
    if (!revealFilterIds) return baseRows;
    const abIndexMap = new Map<string, number>();
    kit.state.abSlots.forEach((slotId, idx) => abIndexMap.set(slotId, idx));
    const qWords = deferredQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const out: KitRow[] = [];
    for (const id of revealFilterIds) {
      const lib = itemOf(id) ?? null;
      const item = Object.hasOwn(kit.state.items, id) ? kit.state.items[id]! : null;
      const cat =
        item?.category ??
        (lib ? classifyPopularSound(lib) : null) ??
        (lib?.kind === "bgm" ? "bgm" : "foley-core");
      if (category !== "all" && cat !== category) continue;
      const kind: "bgm" | "sfx" | "mc" = lib?.kind ?? (cat === "bgm" ? "bgm" : "sfx");
      const seconds = Number(lib?.seconds ?? 0);
      const title = cleanAudioTitle(lib?.title?.trim() || id, { mc: kind === "mc" });
      if (qWords.length) {
        const hay =
          `${id} ${title} ${cat} ${lib?.source ?? ""} ${item?.tags.join(" ") ?? ""} ${item?.note ?? ""}`
            .replaceAll("_", " ")
            .toLowerCase();
        if (!qWords.every((w) => hay.includes(w))) continue;
      }
      out.push({
        id,
        title,
        category: cat,
        status: item?.status ?? null,
        item,
        libraryItem: lib,
        missingFromLibrary: !lib,
        seconds,
        durationLabel: seconds > 0 ? formatSoundDuration(seconds, kind) : "—",
        sourceLabel: lib ? sourceTitle(sourceOf(lib)) : "Not in film library",
        kind,
        variantCount: 1,
        variantIds: [id],
        abIndex: abIndexMap.get(id) ?? -1,
        tags: item?.tags ?? [],
        note: item?.note ?? "",
        tier: item?.tier ?? 0,
        elo: item?.elo ?? 1500,
        wins: item?.wins ?? 0,
        losses: item?.losses ?? 0,
        picks: item?.picks ?? 0,
      });
    }
    return out;
  }, [baseRows, revealFilterIds, kit.state, category, deferredQuery]);
  const pendingScrollIdx = pendingScrollId
    ? rows.findIndex((r) => r.id === pendingScrollId || r.variantIds.includes(pendingScrollId))
    : -1;
  const firstPassedIdx = useMemo(
    () => (revealFilterIds ? -1 : rows.findIndex((r) => r.status === "pass")),
    [rows, revealFilterIds],
  );
  const passedTotal = useMemo(
    () => (revealFilterIds ? 0 : rows.reduce((acc, r) => acc + (r.status === "pass" ? 1 : 0), 0)),
    [rows, revealFilterIds],
  );
  const virtualEntries = useMemo<KitVirtualEntry[]>(() => {
    if (firstPassedIdx < 0 || passedTotal <= 0) {
      return rows.map((row) => ({ kind: "row", row }));
    }
    const out: KitVirtualEntry[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (i === firstPassedIdx) out.push({ kind: "divider", count: passedTotal });
      out.push({ kind: "row", row: rows[i]! });
    }
    return out;
  }, [rows, firstPassedIdx, passedTotal]);
  const rowEntryIndex = useMemo(() => {
    const map = new Map<string, number>();
    virtualEntries.forEach((entry, idx) => {
      if (entry.kind === "row") map.set(entry.row.id, idx);
    });
    return map;
  }, [virtualEntries]);
  const rowEntryIndexRef = useRef(rowEntryIndex);
  useEffect(() => {
    rowEntryIndexRef.current = rowEntryIndex;
  }, [rowEntryIndex]);
  const dividerEntryIdx = firstPassedIdx >= 0 && passedTotal > 0 ? firstPassedIdx : -1;
  const estimateKitEntrySize = useCallback(
    (index: number) =>
      virtualEntries[index]?.kind === "divider" ? KIT_DIVIDER_PX : KIT_ESTIMATED_ROW_PX,
    [virtualEntries],
  );
  const focusedRow =
    rows.find(
      (r) => r.id === focusedId || (focusedId !== null && r.variantIds.includes(focusedId)),
    ) ??
    rows[0] ??
    null;
  const stickyKitKeys = useMemo(() => {
    const out: string[] = [];
    if (focusedRow) out.push(focusedRow.id);
    if (revealedId) {
      const revRow = rows.find((r) => r.id === revealedId || r.variantIds.includes(revealedId));
      if (revRow && !out.includes(revRow.id)) out.push(revRow.id);
    }
    if (pendingScrollId) {
      const pendRow = rows.find(
        (r) => r.id === pendingScrollId || r.variantIds.includes(pendingScrollId),
      );
      if (pendRow && !out.includes(pendRow.id)) out.push(pendRow.id);
    }
    return out;
  }, [focusedRow, revealedId, pendingScrollId, rows]);

  useEffect(() => {
    if (!soundReveal || soundReveal.seq === lastRevealSeqRef.current) return;
    if (soundReveal.target !== "kit" && soundReveal.target !== "auto") return;
    if (!kit.loaded) return;
    let cancelled = false;
    void ensureSoundLibrary().then(() => {
      if (cancelled || soundReveal.seq === lastRevealSeqRef.current) return;
      const eligible = soundReveal.names.filter((n) => n !== narrationName);
      lastRevealSeqRef.current = soundReveal.seq;
      clearSoundReveal(soundReveal.seq);
      if (soundReveal.category && !eligible.length) {
        const cat = soundReveal.category;
        const itemsInCat = Object.values(kit.state.items).filter((x) => x.category === cat);
        const nextTab: KitViewTab = itemsInCat.some((x) => x.status === "core")
          ? "core"
          : itemsInCat.some((x) => x.status === "inbox")
            ? "inbox"
            : "popular";
        setRevealFilterIds(null);
        setQuery("");
        setActiveTag("");
        setCategory(cat);
        setChosenTab(nextTab);
        return;
      }
      if (!eligible.length) {
        if (soundReveal.names.length) {
          say("Voiceover clips live in All Library");
          onFallbackToLibrary?.(soundReveal.names);
        }
        return;
      }

      const flashReveal = (id: string) => {
        setRevealedId(id);
        if (revealTimerRef.current !== null) clearTimeout(revealTimerRef.current);
        revealTimerRef.current = setTimeout(() => {
          setRevealedId(null);
          revealTimerRef.current = null;
        }, 2200);
      };

      if (eligible.length > 1) {
        setQuery("");
        setActiveTag("");
        setCategory("all");
        setRevealFilterIds(eligible);
        setFocusedId(eligible[0]!);
        setPendingScrollId(eligible[0]!);
        flashReveal(eligible[0]!);
        return;
      }

      const id = eligible[0]!;
      const tracked = Object.hasOwn(kit.state.items, id) ? kit.state.items[id]! : null;
      const libItem = itemOf(id) ?? null;
      const inferredCategory =
        tracked?.category ?? (libItem ? classifyPopularSound(libItem) : null);
      if (!tracked && (!libItem || !inferredCategory)) {
        say("Not in Core Kit's 8 popular categories — opened in All Library");
        onFallbackToLibrary?.([id]);
        return;
      }

      setRevealFilterIds(null);
      setQuery("");
      setActiveTag("");
      setCategory(inferredCategory ?? "all");
      if (tracked?.status === "core") setTab("core");
      else if (tracked?.status === "inbox" || tracked?.status === "pass") setTab("inbox");
      else if (tracked?.status === "ban") setTab("ban");
      else {
        setTab("popular");
        if (libItem) {
          if (isBulkPopularSource(libItem)) setPoolScope("all");
          if (originOf(libItem) === "synth") setIncludeSynth(true);
          if (libItem.kind === "mc") setIncludeMc(true);
        }
      }
      setFocusedId(id);
      setPendingScrollId(id);
      flashReveal(id);
    });
    return () => {
      cancelled = true;
    };
  }, [soundReveal, kit.loaded, kit.state.items, narrationName, onFallbackToLibrary]);

  useEffect(() => {
    if (!pendingScrollId) return;
    if (query !== deferredQuery) return;
    if (pendingScrollIdx < 0) {
      if (!kit.loaded || !libraryItems.length) return;
      const frame = requestAnimationFrame(() => setPendingScrollId(null));
      return () => cancelAnimationFrame(frame);
    }
    const targetRow = rows[pendingScrollIdx];
    if (!targetRow) return;
    const domId = targetRow.id;
    const entryIdx = rowEntryIndex.get(domId);
    if (entryIdx === undefined) return;
    kitScrollToRef.current?.(entryIdx, "center");
    let refineFrame: number | null = null;
    const frame = requestAnimationFrame(() => {
      kitScrollToRef.current?.(entryIdx, "center");
      refineFrame = requestAnimationFrame(() => {
        setPendingScrollId(null);
        const rowEl = listRef.current?.querySelector<HTMLElement>(
          `[data-kit-row="${CSS.escape(domId)}"]`,
        );
        rowEl?.querySelector<HTMLElement>("[data-kit-row-focus]")?.focus({ preventScroll: true });
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      if (refineFrame !== null) cancelAnimationFrame(refineFrame);
    };
  }, [
    pendingScrollIdx,
    pendingScrollId,
    query,
    deferredQuery,
    rows,
    rowEntryIndex,
    kit.loaded,
    libraryItems.length,
  ]);

  const focusKitRow = (id: string | null) => {
    requestAnimationFrame(() => {
      if (id) {
        const entryIdx = rowEntryIndexRef.current.get(id);
        if (entryIdx !== undefined) kitScrollToRef.current?.(entryIdx, "auto");
        requestAnimationFrame(() => {
          const el = listRef.current?.querySelector<HTMLElement>(
            `[data-kit-row="${CSS.escape(id)}"]`,
          );
          if (el) {
            el.querySelector<HTMLElement>("[data-kit-row-focus]")?.focus({ preventScroll: true });
            return;
          }
          workbenchRef.current?.focus({ preventScroll: true });
        });
        return;
      }
      workbenchRef.current?.focus({ preventScroll: true });
    });
  };

  const stopRowPlaybackIfActive = (rowId: string) => {
    const live = getSoundKitSnapshot();
    if (live.videoPreview.active && live.videoPreview.soundId === rowId) {
      stopVideoPreview(true);
    } else if (live.loudnessPlayingId === rowId || listening() === rowId) {
      stopMiniStudioBuffer();
      stopAudition();
    }
  };

  const auditionRow = (row: KitRow, forcePlay = true) => {
    pinTab();
    setFocusedId(row.id);
    if (row.missingFromLibrary) return;
    if (videoMode) {
      void previewSoundInVideo(row.id);
    } else {
      playKitSound(row.id, { forcePlay, loudnessMatch: false });
    }
  };

  const triageRow = async (row: KitRow, status: KitStatus) => {
    pinTab();
    const removesFromTab =
      (tab === "inbox" && status !== "inbox" && status !== "pass") ||
      (tab === "core" && status !== "core") ||
      (tab === "ban" && status !== "ban") ||
      (tab === "popular" && status === "ban");
    const sinksToBottom = status === "pass" && (tab === "inbox" || tab === "popular");
    const activeRows = rows.filter((r) => r.status !== "pass");
    const passedRows = rows.filter((r) => r.status === "pass");
    let nextId: string | null;
    if (sinksToBottom) {
      nextId = nextFocusAfterTriage(activeRows, row.id);
    } else if (row.status === "pass") {
      nextId = nextFocusAfterTriage(passedRows, row.id) ?? nextFocusAfterTriage(rows, row.id);
    } else if (removesFromTab) {
      nextId = nextFocusAfterTriage(activeRows, row.id);
    } else if (tab === "popular") {
      const activeIdx = activeRows.findIndex((r) => r.id === row.id);
      nextId =
        activeIdx >= 0 && activeIdx + 1 < activeRows.length
          ? activeRows[activeIdx + 1]!.id
          : row.id;
    } else {
      nextId = row.id;
    }
    const saved = await saveKitItem({
      id: row.id,
      category: row.category,
      status,
      addedBy: "human",
    });
    if (!saved) return;
    if (status === "core") say(`Approved "${row.title}" into Core Kit · Ctrl+Z to undo`);
    else if (status === "pass") say(`Passed "${row.title}" — pushed to bottom · Ctrl+Z to undo`);
    else if (status === "ban") say(`Banned "${row.title}" — Ctrl+Z to undo`);
    else say(`Restored "${row.title}" to Inbox · Ctrl+Z to undo`);

    if (nextId === null) {
      stopRowPlaybackIfActive(row.id);
      setFocusedId(null);
      focusKitRow(null);
      return;
    }

    const nextRow = nextId !== row.id ? rows.find((r) => r.id === nextId) : null;
    const autoPlayNext = Boolean(
      nextRow &&
      !nextRow.missingFromLibrary &&
      (tab === "inbox" || status === "ban" || status === "pass"),
    );
    if ((removesFromTab || sinksToBottom) && !autoPlayNext) {
      stopRowPlaybackIfActive(row.id);
    }
    if (nextId !== row.id) {
      setFocusedId(nextId);
      focusKitRow(nextId);
      if (autoPlayNext && nextRow) {
        if (videoMode) void previewSoundInVideo(nextRow.id);
        else playKitSound(nextRow.id, { forcePlay: true, loudnessMatch: false });
      }
    } else {
      focusKitRow(row.id);
    }
  };

  const restorePassedRow = async (row: KitRow) => {
    pinTab();
    const passedRows = rows.filter((r) => r.status === "pass");
    const nextId = nextFocusAfterTriage(passedRows, row.id) ?? nextFocusAfterTriage(rows, row.id);
    const keepRecord =
      tab === "inbox" ||
      kit.state.abSlots.includes(row.id) ||
      row.tags.length > 0 ||
      row.note.length > 0 ||
      row.tier === 1 ||
      row.wins > 0 ||
      row.losses > 0 ||
      row.picks > 0;
    const saved = keepRecord
      ? await saveKitItem({
          id: row.id,
          category: row.category,
          status: "inbox",
          addedBy: "human",
        })
      : await removeKitItem(row.id);
    if (!saved) return;
    say(
      keepRecord ? `Restored "${row.title}" to Inbox` : `Restored "${row.title}" to Popular Pool`,
    );
    if (nextId && nextId !== row.id) {
      setFocusedId(nextId);
      focusKitRow(nextId);
    } else if (keepRecord) {
      setFocusedId(row.id);
      focusKitRow(row.id);
    } else {
      stopRowPlaybackIfActive(row.id);
      setFocusedId(null);
      focusKitRow(null);
    }
  };

  const setAuditionMode = (nextVideoMode: boolean) => {
    if (videoMode === nextVideoMode) return;
    if (videoMode && !nextVideoMode) stopVideoPreview(true);
    setVideoMode(nextVideoMode);
  };

  const toggleVideoMode = () => setAuditionMode(!videoMode);

  const toggleStarRow = (row: KitRow) => {
    if (row.status === "ban") return;
    pinTab();
    const nextTier = row.tier === 1 ? 0 : 1;
    const nextStatus: KitStatus =
      nextTier === 1 && (row.status === null || row.status === "pass")
        ? "core"
        : (row.status ?? "core");
    void saveKitItem({
      id: row.id,
      category: row.category,
      status: nextStatus,
      tier: nextTier,
      addedBy: "human",
    }).then((saved) => {
      if (!saved) return;
      say(
        nextTier === 1 ? `Marked "${row.title}" as Signature` : `Unmarked "${row.title}" Signature`,
      );
    });
  };

  const selectCategory = (next: KitCategoryFilter) => {
    pinTab();
    setRevealFilterIds(null);
    setCategory(next);
    setActiveTag("");
  };

  const handleTabKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const nextIdx =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? VIEW_TABS.length - 1
          : (idx + (e.key === "ArrowRight" ? 1 : -1) + VIEW_TABS.length) % VIEW_TABS.length;
    const next = VIEW_TABS[nextIdx];
    if (!next) return;
    setTab(next.id);
    tabRefs.current[nextIdx]?.focus();
  };

  const restoreWorkbenchFocus = () => {
    requestAnimationFrame(() => {
      workbenchRef.current?.focus({ preventScroll: true });
    });
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        if (
          e.target instanceof HTMLElement &&
          (e.target.isContentEditable || e.target.closest("input, textarea"))
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopPropagation();
        if (kit.canUndo) void undoKit();
        return;
      }
      if (k === "y" || (k === "z" && e.shiftKey)) {
        if (
          e.target instanceof HTMLElement &&
          (e.target.isContentEditable || e.target.closest("input, textarea"))
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopPropagation();
        if (kit.canRedo) void redoKit();
        return;
      }
      return;
    }
    if (e.altKey || e.shiftKey) return;
    const key = e.key;
    if (!shouldInterceptKitKey(e.target, key)) return;
    const lower = key.toLowerCase();
    const consume = () => {
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopPropagation();
    };

    if (key === "Escape") {
      if (similarId) {
        consume();
        const closingId = similarId;
        setSimilarId(null);
        focusKitRow(closingId);
      } else if (kit.videoPreview.active) {
        consume();
        stopVideoPreview(true);
      }
      return;
    }

    if (key === "1" || key === "2" || key === "3" || key === "4") {
      consume();
      const slotIdx = Number(key) - 1;
      const slotId = kit.state.abSlots[slotIdx];
      if (!slotId) return;
      setSelectedAbSlot(slotIdx);
      if (rows.some((r) => r.id === slotId)) setFocusedId(slotId);
      if (videoMode) void previewSoundInVideo(slotId);
      else playKitSound(slotId, { forcePlay: true, loudnessMatch: true });
      return;
    }

    if (lower === "v") {
      consume();
      toggleVideoMode();
      return;
    }

    const targetRowId = resolveKitTargetRowId(e.target);
    const activeRow = (targetRowId ? rows.find((r) => r.id === targetRowId) : null) ?? focusedRow;

    if (key === "ArrowDown" || key === "ArrowUp") {
      consume();
      if (!rows.length) return;
      const curIdx = activeRow ? rows.findIndex((r) => r.id === activeRow.id) : -1;
      const nextIdx = stepFocusIndex(curIdx, key === "ArrowDown" ? 1 : -1, rows.length);
      const nextRow = rows[nextIdx];
      if (!nextRow) return;
      auditionRow(nextRow, true);
      focusKitRow(nextRow.id);
      return;
    }

    if (key === " ") {
      consume();
      if (!activeRow) return;
      if (kit.videoPreview.active && kit.videoPreview.soundId === activeRow.id) {
        stopVideoPreview(true);
      } else {
        auditionRow(activeRow, false);
      }
      return;
    }

    if (lower === "k") {
      consume();
      if (activeRow && activeRow.status !== "core") void triageRow(activeRow, "core");
      return;
    }

    if (lower === "p") {
      consume();
      if (activeRow && (activeRow.status === null || activeRow.status === "inbox")) {
        void triageRow(activeRow, "pass");
      }
      return;
    }

    if (lower === "x") {
      consume();
      if (activeRow && activeRow.status !== "ban") void triageRow(activeRow, "ban");
      return;
    }

    if (lower === "t") {
      consume();
      if (activeRow) toggleStarRow(activeRow);
      return;
    }

    if (lower === "a") {
      consume();
      if (!activeRow || activeRow.status === "ban") return;
      pinTab();
      void toggleKitAbSlot(activeRow.id);
      return;
    }

    if (lower === "s") {
      consume();
      if (!activeRow) return;
      setSimilarId((cur) => (cur === activeRow.id ? null : activeRow.id));
    }
  };

  const suggestedTags = suggestedTagsForCategory(category);
  const hasActiveFilter = Boolean(
    query.trim() || activeTag || category !== "all" || revealFilterIds,
  );
  const isPoolFiltered = poolScope === "all" || includeSynth || includeMc;
  const filterTitle = isPoolFiltered
    ? `Filter: ${[poolScope === "all" && "All packs", includeSynth && "Synth", includeMc && "MC"]
        .filter(Boolean)
        .join(" · ")}`
    : "Pool & source filters";

  return (
    <div
      ref={workbenchRef}
      tabIndex={-1}
      data-sound-kit
      data-keep-click-focus
      role="region"
      aria-label="Core Sound Kit workbench"
      onKeyDown={handleKeyDown}
      className="@container flex min-h-0 flex-1 flex-col overflow-hidden outline-none"
    >
      {(kit.warning || (kit.error && kit.loaded)) && (
        <div className="border-border/50 flex-none border-b px-3 py-1.5">
          <Alert variant="warn">
            <AlertTriangle aria-hidden />
            <AlertDescription>{kit.warning || kit.error}</AlertDescription>
            {kit.error && (
              <AlertAction>
                <Button variant="secondary" size="xs" onClick={() => void reloadSoundKit()}>
                  Retry
                </Button>
              </AlertAction>
            )}
          </Alert>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <SoundKitCategoryRail
          tab={tab}
          category={category}
          counts={counts}
          onSelect={selectCategory}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="border-border/50 flex flex-none flex-col gap-1.5 border-b px-3 py-2">
            <SoundKitCategoryStrip
              tab={tab}
              category={category}
              counts={counts}
              onSelect={selectCategory}
            />

            <div className="flex flex-wrap items-center gap-1.5">
              <div
                role="tablist"
                aria-label="Sound Kit status views"
                className="bg-raised-2 border-border/60 inline-flex items-center rounded-lg border p-0.5"
              >
                {VIEW_TABS.map((t, idx) => {
                  const selected = tab === t.id && !revealFilterIds;
                  const count = counts.totals[t.id];
                  return (
                    <button
                      key={t.id}
                      ref={(el) => {
                        tabRefs.current[idx] = el;
                      }}
                      type="button"
                      role="tab"
                      tabIndex={selected ? 0 : -1}
                      aria-selected={selected}
                      onKeyDown={(e) => handleTabKeyDown(e, idx)}
                      onClick={() => {
                        setRevealFilterIds(null);
                        setTab(t.id);
                      }}
                      className={cn(
                        "studio-press focus-visible:ring-ring text-tag inline-flex h-6 items-center gap-1 rounded-md px-2 font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none",
                        selected
                          ? "bg-tint text-primary-text"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <span className="hidden @min-[500px]:inline">{t.label}</span>
                      <span className="@min-[500px]:hidden">{t.shortLabel}</span>
                      <span
                        className={cn(
                          "tabular-nums",
                          selected ? "text-primary-text/90" : "text-muted-foreground",
                        )}
                      >
                        {count.toLocaleString()}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="ms-auto flex items-center gap-1">
                <Tip
                  label={
                    kit.lastUndoLabel ? `Undo: ${kit.lastUndoLabel} (Ctrl+Z)` : "Undo (Ctrl+Z)"
                  }
                >
                  <Button
                    variant="quiet"
                    size="icon-sm"
                    aria-label="Undo kit change"
                    disabled={!kit.canUndo}
                    onClick={() => {
                      void undoKit().finally(restoreWorkbenchFocus);
                    }}
                  >
                    <Undo2 />
                  </Button>
                </Tip>
                <Tip
                  label={
                    kit.lastRedoLabel ? `Redo: ${kit.lastRedoLabel} (Ctrl+Y)` : "Redo (Ctrl+Y)"
                  }
                >
                  <Button
                    variant="quiet"
                    size="icon-sm"
                    aria-label="Redo kit change"
                    disabled={!kit.canRedo}
                    onClick={() => {
                      void redoKit().finally(restoreWorkbenchFocus);
                    }}
                  >
                    <Redo2 />
                  </Button>
                </Tip>

                <div
                  role="group"
                  aria-label="Audition output target (V)"
                  className="bg-raised-2 border-border/60 inline-flex items-center rounded-lg border p-0.5"
                >
                  <Tip label="Audition directly in Studio (V)">
                    <button
                      type="button"
                      aria-pressed={!videoMode}
                      onClick={() => setAuditionMode(false)}
                      className={cn(
                        "studio-press focus-visible:ring-ring text-tag inline-flex h-6 items-center gap-1 rounded-md px-2 font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none",
                        !videoMode
                          ? "bg-tint text-primary-text"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Headphones aria-hidden className="size-3" />
                      <span>Studio</span>
                    </button>
                  </Tip>
                  <Tip label="Audition live inside the video at the clip or playhead (V)">
                    <button
                      type="button"
                      aria-pressed={videoMode}
                      onClick={() => setAuditionMode(true)}
                      className={cn(
                        "studio-press focus-visible:ring-ring text-tag inline-flex h-6 items-center gap-1 rounded-md px-2 font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none",
                        videoMode
                          ? "bg-primary text-primary-foreground font-semibold"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Film aria-hidden className="size-3" />
                      <span>In Video</span>
                    </button>
                  </Tip>
                </div>

                <Popover>
                  <Tip label="Keyboard shortcuts">
                    <PopoverTrigger
                      render={
                        <Button variant="quiet" size="icon-sm" aria-label="Keyboard shortcuts" />
                      }
                    >
                      <Keyboard />
                    </PopoverTrigger>
                  </Tip>
                  <PopoverContent align="end" className="w-64">
                    <div className="flex flex-col gap-2">
                      <p className="text-foreground text-xs font-semibold">Core Kit shortcuts</p>
                      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-xs">
                        <dt className="flex items-center gap-0.5">
                          <Kbd>↑</Kbd>
                          <Kbd>↓</Kbd>
                        </dt>
                        <dd className="text-muted-foreground">Play previous / next</dd>
                        <dt>
                          <Kbd>Space</Kbd>
                        </dt>
                        <dd className="text-muted-foreground">Play / pause</dd>
                        <dt className="flex items-center gap-0.5">
                          <Kbd>K</Kbd>
                          <Kbd>P</Kbd>
                          <Kbd>X</Kbd>
                        </dt>
                        <dd className="text-muted-foreground">Keep · Pass · Ban</dd>
                        <dt className="flex items-center gap-0.5">
                          <Kbd>T</Kbd>
                          <Kbd>S</Kbd>
                        </dt>
                        <dd className="text-muted-foreground">Signature · Find similar</dd>
                        <dt className="flex items-center gap-0.5">
                          <Kbd>A</Kbd>
                          <Kbd>1–4</Kbd>
                        </dt>
                        <dd className="text-muted-foreground">Toggle A/B · Switch slots</dd>
                        <dt>
                          <Kbd>V</Kbd>
                        </dt>
                        <dd className="text-muted-foreground">Toggle Studio / In Video</dd>
                        <dt className="flex items-center gap-0.5">
                          <Kbd>Ctrl+Z</Kbd>
                          <Kbd>Ctrl+Y</Kbd>
                        </dt>
                        <dd className="text-muted-foreground">Undo / redo kit change</dd>
                      </dl>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <div className="border-input bg-backdrop focus-within:border-ring focus-within:ring-ring flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md border ps-2.5 pe-1 focus-within:ring-1">
                <label
                  htmlFor={searchId}
                  className="flex h-full min-w-0 flex-1 cursor-text items-center gap-1.5"
                >
                  <Search aria-hidden className="text-foreground/70 size-4 flex-none" />
                  <input
                    id={searchId}
                    ref={searchInputRef}
                    type="text"
                    role="searchbox"
                    value={query}
                    placeholder="Search Core Kit…"
                    aria-label="Filter Core Sound Kit"
                    onChange={(e) => {
                      pinTab();
                      if (revealFilterIds) setRevealFilterIds(null);
                      setQuery(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape" && !query) return;
                      e.stopPropagation();
                      e.nativeEvent.stopPropagation();
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setQuery("");
                      }
                    }}
                    className="text-ui text-foreground placeholder:text-foreground/65 h-full min-w-0 flex-1 bg-transparent pe-1 outline-none"
                  />
                </label>
                {query && (
                  <Button
                    variant="tool"
                    size="icon-sm"
                    aria-label="Clear kit search"
                    onClick={() => {
                      setQuery("");
                      searchInputRef.current?.focus();
                    }}
                  >
                    <X />
                  </Button>
                )}
              </div>

              {passedTotal > 0 && dividerEntryIdx >= 0 && !revealFilterIds && (
                <Tip label={`Jump to ${passedTotal.toLocaleString()} passed sounds at bottom`}>
                  <Button
                    variant="tool"
                    size="sm"
                    onClick={() => kitScrollToRef.current?.(dividerEntryIdx, "start")}
                  >
                    Passed ({passedTotal.toLocaleString()})
                  </Button>
                </Tip>
              )}

              {tab === "popular" && !revealFilterIds && (
                <DropdownMenu open={filterOpen} onOpenChange={setFilterOpen}>
                  <DropdownMenuTrigger
                    render={
                      <FilterTriggerButton
                        active={isPoolFiltered}
                        open={filterOpen}
                        title={filterTitle}
                        aria-label={filterTitle}
                      />
                    }
                  />
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Popular pool</DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={poolScope}
                        onValueChange={(v) => {
                          pinTab();
                          setPoolScope(v as PopularPoolScope);
                        }}
                      >
                        <DropdownMenuRadioItem value="curated">
                          Curated packs (clean list)
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="all">
                          All packs (incl. Sonniss & OpenFilm)
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Extra sources</DropdownMenuLabel>
                      <DropdownMenuCheckboxItem
                        checked={includeSynth}
                        onCheckedChange={(v) => {
                          pinTab();
                          setIncludeSynth(Boolean(v));
                        }}
                      >
                        Include code / synth sounds
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={includeMc}
                        onCheckedChange={(v) => {
                          pinTab();
                          setIncludeMc(Boolean(v));
                        }}
                      >
                        Include Minecraft (.ogg)
                      </DropdownMenuCheckboxItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {revealFilterIds && (
              <div className="border-primary/40 bg-tint/40 flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-xs">
                <span className="text-primary-text truncate font-medium">
                  Showing {rows.length} selected sounds
                </span>
                <Button variant="ghost" size="xs" onClick={() => setRevealFilterIds(null)}>
                  Show all
                </Button>
              </div>
            )}

            {suggestedTags.length > 0 && !revealFilterIds && (
              <HorizontalScrollRail
                label="Quick category tags"
                leftLabel="Scroll tags left"
                rightLabel="Scroll tags right"
                edgesKey={`${category}:${activeTag}`}
                className="gap-1"
              >
                {suggestedTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={activeTag === tag}
                    onClick={() => {
                      pinTab();
                      setActiveTag((cur) => (cur === tag ? "" : tag));
                    }}
                    className={cn(
                      "studio-press focus-visible:ring-ring text-tag h-6 flex-none rounded-full border px-2 whitespace-nowrap transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none",
                      activeTag === tag
                        ? "border-primary/50 bg-tint text-primary-text font-medium"
                        : "border-border/60 text-muted-foreground hover:text-foreground bg-transparent",
                    )}
                  >
                    #{tag}
                  </button>
                ))}
              </HorizontalScrollRail>
            )}
          </div>

          {!kit.loaded && !kit.error ? (
            <div
              role="status"
              aria-busy="true"
              aria-label="Loading Core Sound Kit"
              className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-2"
            >
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : !kit.loaded && kit.error ? (
            <div className="flex min-h-0 flex-1 items-center justify-center p-4">
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <AlertTriangle />
                  </EmptyMedia>
                  <EmptyTitle>Could not load Core Sound Kit</EmptyTitle>
                  <EmptyDescription>
                    <span className="text-muted-foreground">
                      {kit.error}. Check that Live Studio is running and retry.
                    </span>
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={kit.loading}
                    onClick={() => void reloadSoundKit()}
                  >
                    Retry
                  </Button>
                </EmptyContent>
              </Empty>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex min-h-0 flex-1 items-center justify-center p-4">
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Sparkles />
                  </EmptyMedia>
                  <EmptyTitle>
                    {hasActiveFilter
                      ? query.trim()
                        ? `No results for “${query.trim()}”`
                        : "No matching sounds"
                      : tab === "inbox"
                        ? "Inbox is empty"
                        : tab === "core"
                          ? "No Core Kit sounds yet"
                          : tab === "ban"
                            ? "No banned sounds"
                            : "No matching sounds"}
                  </EmptyTitle>
                  <EmptyDescription>
                    <span className="text-muted-foreground">
                      {hasActiveFilter
                        ? "Clear active filters or switch to another category to keep browsing."
                        : tab === "inbox"
                          ? "Browse Popular Pool to audition candidates and press K to keep your go-to sounds."
                          : tab === "core"
                            ? "Audition Inbox or Popular Pool and press K to approve sounds into your Core Kit."
                            : tab === "ban"
                              ? "Sounds you ban with X appear here so you can restore them anytime."
                              : "No vault sounds match these popular categories yet."}
                    </span>
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    {hasActiveFilter && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setQuery("");
                          setActiveTag("");
                          setCategory("all");
                          setRevealFilterIds(null);
                        }}
                      >
                        Reset filters
                      </Button>
                    )}
                    {tab === "popular" && poolScope === "curated" && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          pinTab();
                          setPoolScope("all");
                        }}
                      >
                        Search all packs
                      </Button>
                    )}
                    {tab !== "popular" && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setTab("popular");
                          setActiveTag("");
                        }}
                      >
                        Browse Popular Pool
                      </Button>
                    )}
                  </div>
                </EmptyContent>
              </Empty>
            </div>
          ) : (
            <div ref={listRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <VirtualList
                items={virtualEntries}
                getKey={kitEntryKey}
                estimateSize={estimateKitEntrySize}
                gap={6}
                overscan={6}
                role="list"
                ariaLabel="Sound kit candidates"
                className="px-3 py-2"
                stickyKeys={stickyKitKeys}
                scrollToRef={kitScrollToRef}
                resetKey={`${tab}\0${category}\0${deferredQuery}\0${activeTag}\0${poolScope}\0${includeSynth}\0${includeMc}\0${revealFilterIds?.join(",") ?? ""}`}
                renderItem={(entry) => {
                  if (entry.kind === "divider") {
                    return (
                      <div
                        role="presentation"
                        data-kit-passed-divider=""
                        className="text-tag text-muted-foreground flex items-center gap-2 pt-2 pb-0.5"
                      >
                        <span className="bg-border/70 h-px flex-1" aria-hidden />
                        <span className="whitespace-nowrap">
                          Passed ({entry.count.toLocaleString()}) · still searchable by AI
                        </span>
                        <span className="bg-border/70 h-px flex-1" aria-hidden />
                      </div>
                    );
                  }
                  const { row } = entry;
                  const isFocused = focusedRow?.id === row.id;
                  const isPlaying = kit.videoPreview.active
                    ? kit.videoPreview.soundId === row.id
                    : kit.loudnessPlayingId === row.id || nowPlaying === row.id;
                  return (
                    <KitRowCard
                      row={row}
                      tab={tab}
                      isFocused={isFocused}
                      isPlaying={isPlaying}
                      isTimelineSelected={row.variantIds.some((vid) => selectedClipNames.has(vid))}
                      isRevealed={
                        revealedId !== null &&
                        (revealedId === row.id || row.variantIds.includes(revealedId))
                      }
                      hasSelectedClip={hasEditableClip}
                      similarOpen={similarId === row.id}
                      metaOpen={metaOpenId === row.id}
                      onFocus={() => setFocusedId(row.id)}
                      onToggleMeta={() => {
                        setFocusedId(row.id);
                        setMetaOpenId((cur) => (cur === row.id ? null : row.id));
                      }}
                      onTogglePlay={() => {
                        if (isPlaying) {
                          if (kit.videoPreview.active) stopVideoPreview(true);
                          else playKitSound(row.id, { forcePlay: false, loudnessMatch: false });
                        } else {
                          auditionRow(row, false);
                        }
                      }}
                      onTriage={(nextStatus) => {
                        void triageRow(row, nextStatus);
                      }}
                      onRestorePass={() => {
                        void restorePassedRow(row);
                      }}
                      onToggleStar={() => toggleStarRow(row)}
                      onToggleAb={() => {
                        pinTab();
                        void toggleKitAbSlot(row.id);
                      }}
                      onToggleSimilar={() =>
                        setSimilarId((cur) => (cur === row.id ? null : row.id))
                      }
                      onApply={() => void applyKitSoundToFilm(row.id, row.category)}
                      onRemove={() => {
                        pinTab();
                        const nextId = nextFocusAfterTriage(rows, row.id);
                        void removeKitItem(row.id).then((saved) => {
                          if (!saved) return;
                          stopRowPlaybackIfActive(row.id);
                          setFocusedId(nextId);
                          focusKitRow(nextId);
                          say(`Removed "${row.title}" from Sound Kit · Ctrl+Z to undo`);
                        });
                      }}
                      onSaveTags={(tags) => {
                        pinTab();
                        void saveKitItem({
                          id: row.id,
                          category: row.category,
                          ...(row.status ? { status: row.status } : {}),
                          tags,
                          addedBy: "human",
                        });
                      }}
                      onSaveNote={(note) => {
                        pinTab();
                        void saveKitItem({
                          id: row.id,
                          category: row.category,
                          ...(row.status ? { status: row.status } : {}),
                          note,
                          addedBy: "human",
                        });
                      }}
                    />
                  );
                }}
              />
            </div>
          )}

          {similarId && (
            <SoundKitSimilarDrawer
              targetId={similarId}
              fallbackCategory={
                rows.find((r) => r.id === similarId)?.category ??
                (category !== "all" ? category : "foley-core")
              }
              kitState={kit.state}
              videoMode={videoMode}
              videoPreview={kit.videoPreview}
              loudnessPlayingId={kit.loudnessPlayingId}
              onPinTab={pinTab}
              onRestoreFocus={restoreWorkbenchFocus}
              onClose={() => {
                const closingId = similarId;
                setSimilarId(null);
                focusKitRow(closingId);
              }}
            />
          )}

          <SoundKitAbDeck
            state={kit.state}
            reasons={kit.reasons}
            videoMode={videoMode}
            videoPreview={kit.videoPreview}
            loudnessPlayingId={kit.loudnessPlayingId}
            abLoudnessMatch={kit.abLoudnessMatch}
            activeCategory={category}
            selectedSlot={selectedAbSlot}
            onSelectSlotIndex={setSelectedAbSlot}
            onSelectSlot={(id) => {
              if (rows.some((r) => r.id === id)) setFocusedId(id);
            }}
            onPinTab={pinTab}
            onDockToWatch={onDockToWatch}
            onRestoreFocus={restoreWorkbenchFocus}
          />
          {dock}
        </div>
      </div>
    </div>
  );
}
