// The Lessons tab: project lessons/<path>.md plus global lessons/<path>.md, rendered as an md-phone desktop Miller deck
// with ancestor folder columns alongside the reader when they fit, a GFM Read view, painted
// line-synced editor, Contents flyTo, diacritic-insensitive search, and AI-first updates with optional word diffs.
import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { LESSON_PATH_MAX, lessonPath } from "../../src/lesson-template";
import { useActivity } from "../activity/activity";
import { Segmented } from "../components/inspector";
import { TabStage } from "../components/Motion";
import { isDesktopViewport } from "../components/splitter-layout";
import { AiInspector } from "./AiInspector";
import {
  animateDeckTransition,
  captureDeckSnapshot,
  type DeckMotion,
  type DeckSnapshot,
} from "./deck-motion";
import { downloadLessonDrafts, removeLessonWithUndo } from "./lesson-ui";
import { LessonColumnView } from "./LessonColumn";
import { LessonFileView } from "./LessonFileView";
import {
  dismissAiNotice,
  findExistingLesson,
  LESSON_NAME,
  type LessonFile,
  lessons,
  type LessonScope,
  type LessonScopeFilter,
  lessonTrailKey,
  loadLessons,
  newLesson,
  openLesson,
  openLessonFolder,
  parseLessonKey,
  setScopeFilter,
  useLessons,
} from "./lessons";
import { filterLessons } from "./markdown";
import {
  buildLessonTrail,
  layoutLessonDeck,
  lessonCardOffsets,
  type LessonColumn,
  LESSONS_LIBRARY_WIDTH,
  type LessonTrail,
} from "./tree";

// Arrow navigation keys that stay trapped inside the Miller deck so horizontal seek hotkeys do not steal focus.
export const isDeckBoundaryKey = (key: string): boolean =>
  key === "ArrowLeft" || key === "ArrowRight";

// The AI may write a lesson any moment (bun run note learned): coming back to the page reads them again
const useFresh = () =>
  useEffect(() => {
    void loadLessons();
    const again = () => document.visibilityState === "visible" && void loadLessons();
    addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, []);

type LessonsPanelProps = {
  desktop?: boolean;
  lockWidthPx?: number | null;
  paneWidthPx?: number;
  dock?: "start" | "end";
};
const READER_WIDTH = 552;

export function LessonsPanel(props: LessonsPanelProps = {}) {
  const tab = useLessons((s) => s.subTab);
  const [visited, setVisited] = useState(tab === "inspector");
  const viewSelector = useRef<HTMLDivElement>(null);
  const openDeck = () => {
    lessons.setState({ subTab: "deck", inspectorLiveEnabled: false });
    requestAnimationFrame(() =>
      viewSelector.current
        ?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
        ?.focus(),
    );
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div ref={viewSelector} className="flex flex-none px-2 py-1.5">
        <Segmented
          label="Lessons view"
          animateIndicator={false}
          value={tab}
          items={[
            { id: "deck", title: "Deck" },
            { id: "inspector", title: "AI Inspector" },
          ]}
          onChange={(subTab) => {
            if (subTab === "inspector") setVisited(true);
            lessons.setState({ subTab, inspectorLiveEnabled: false });
          }}
        />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className={cn("min-h-0 min-w-0 flex-1 flex-col", tab === "deck" ? "flex" : "hidden")}>
          <LessonDeckPanel {...props} active={tab === "deck"} />
        </div>
        <div
          className={cn("min-h-0 min-w-0 flex-1 flex-col", tab === "inspector" ? "flex" : "hidden")}
        >
          {visited && <AiInspector active={tab === "inspector"} onOpenDeck={openDeck} />}
        </div>
      </div>
    </div>
  );
}

function LessonDeckPanel({
  active,
  desktop,
  lockWidthPx = null,
  paneWidthPx,
  dock = "start",
}: LessonsPanelProps & { active: boolean }) {
  useFresh();
  const {
      files,
      loaded,
      loadFailed,
      folder,
      open,
      seen,
      edits,
      scopeFilter,
      projectDir,
      aiNotice,
    } = useLessons((s) => s),
    lit = useActivity((s) => s.lit);

  const isDesktop =
    desktop ??
    (typeof window === "undefined"
      ? true
      : isDesktopViewport(window.innerWidth, window.innerHeight));

  const hostRef = useRef<HTMLDivElement>(null);
  const deckScrollRef = useRef<HTMLDivElement>(null);
  const motionLayerRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const formTriggerRef = useRef<HTMLElement>(null);
  const pendingMotionRef = useRef<{
    snapshot: DeckSnapshot | null;
    prevTrail: LessonTrail;
    animate: boolean;
  } | null>(null);
  const motionRef = useRef<DeckMotion | null>(null);
  const didAnimatedAlignRef = useRef(false);

  const [containerWidth, setContainerWidth] = useState(LESSONS_LIBRARY_WIDTH);
  const [jumpTarget, setJumpTarget] = useState<{ path: string; line: number } | null>(null);
  const [query, setQuery] = useState("");
  const [naming, setNaming] = useState<string | null>(null);
  const [namingDepth, setNamingDepth] = useState(0);
  const [newScope, setNewScope] = useState<LessonScope>("film");
  const [submitted, setSubmitted] = useState(false);
  const isLockedWidth = isDesktop && typeof lockWidthPx === "number" && lockWidthPx > 0;
  const hasPaneWidth = typeof paneWidthPx === "number" && paneWidthPx > 0;

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el || !active || hasPaneWidth) return;
    const sync = () => {
      const next = Math.round(el.getBoundingClientRect().width);
      if (next <= 0) return;
      setContainerWidth((prev) => (prev === next ? prev : next));
    };
    sync();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, hasPaneWidth, isLockedWidth]);

  useEffect(() => () => motionRef.current?.cancel(), []);

  useEffect(() => {
    if (!aiNotice) return;
    const drafts = aiNotice.drafts ?? [];
    if (drafts.length) {
      toast.add({
        title: "Lesson changed outside Studio",
        description: "The file on disk took precedence. Download your unsaved edits to keep them.",
        type: "warning",
        timeout: 0,
        actionProps: {
          children: drafts.length === 1 ? "Download draft" : "Download drafts",
          onClick: () => downloadLessonDrafts(drafts),
        },
      });
    } else {
      toast.add({
        title: aiNotice.removed ? "Lesson removed" : "Lesson updated",
        description: `${aiNotice.path} changed outside Studio.`,
        type: "info",
      });
    }
    dismissAiNotice();
  }, [aiNotice]);

  const filmCount = useMemo(() => files.filter((f) => f.scope === "film").length, [files]);
  const allCount = useMemo(() => files.filter((f) => f.scope === "all").length, [files]);
  const hasProject = Boolean(projectDir);
  const activeFilter: LessonScopeFilter = hasProject || filmCount > 0 ? scopeFilter : "both";
  const scopedFiles = useMemo(
    () => (activeFilter === "both" ? files : files.filter((f) => f.scope === activeFilter)),
    [files, activeFilter],
  );
  const isSearching = query.trim().length > 0;
  const searchMatches = useMemo(
    () => (isSearching ? filterLessons(scopedFiles, query) : null),
    [isSearching, scopedFiles, query],
  );
  const matchByKey = useMemo(() => {
    if (!searchMatches)
      return new Map<string, { matchLine: number | null; snippet: string | null }>();
    return new Map(
      searchMatches.map((m) => [m.file.key, { matchLine: m.matchLine, snippet: m.snippet }]),
    );
  }, [searchMatches]);

  const pendingFile = useMemo<LessonFile | null>(() => {
    if (!open || files.some((f) => f.key === open) || !(open in edits)) return null;
    const { scope, path } = parseLessonKey(open);
    return { key: open, scope, path, tag: "", text: edits[open]!.text };
  }, [open, files, edits]);

  const trail = useMemo(
    () =>
      buildLessonTrail({
        files: scopedFiles,
        folder,
        openKey: open,
        pendingFile,
        seen,
        edits,
        lit,
      }),
    [scopedFiles, folder, open, pendingFile, seen, edits, lit],
  );

  const searchColumn = useMemo<LessonColumn | null>(() => {
    if (!searchMatches) return null;
    return {
      depth: 0,
      key: "/",
      title: "Matches",
      parts: [],
      activeEntryKey: open ? `file:${open}` : null,
      entries: searchMatches.map(({ file }) => ({
        kind: "file" as const,
        key: `file:${file.key}`,
        name: file.path,
        file,
        isChanged: !!(seen[file.key] && seen[file.key]!.tag !== file.tag),
        isDraft: file.key in edits,
        isLit:
          `lesson:${file.key}` in lit || (file.scope === "all" && `lesson:${file.path}` in lit),
      })),
    };
  }, [searchMatches, open, seen, edits, lit]);

  const activeColumns = useMemo(
    () => (searchColumn ? [searchColumn] : trail.columns),
    [searchColumn, trail.columns],
  );
  const activeOpen = searchColumn
    ? open && (open in edits || scopedFiles.some((f) => f.key === open))
      ? open
      : null
    : trail.contentKey;

  const effectiveContainerWidth = isLockedWidth
    ? lockWidthPx
    : hasPaneWidth
      ? paneWidthPx
      : containerWidth;

  const layout = useMemo(
    () =>
      layoutLessonDeck({
        columnCount: activeColumns.length,
        hasContent: Boolean(activeOpen),
        containerWidth: effectiveContainerWidth,
        desktop: isDesktop,
      }),
    [activeColumns.length, activeOpen, effectiveContainerWidth, isDesktop],
  );
  const tighterDeck = layout.stickyStepPx === 24;
  const ancestorLimit =
    dock === "start" && activeOpen
      ? Math.max(
          0,
          Math.floor((effectiveContainerWidth - READER_WIDTH) / (tighterDeck ? 176 : 192)),
        )
      : activeColumns.length;
  const renderedColumns = activeColumns.slice(
    Math.max(0, activeColumns.length - (layout.showAncestors ? ancestorLimit : 1)),
  );

  useLayoutEffect(() => {
    const pending = pendingMotionRef.current;
    const deck = deckScrollRef.current;
    if (
      active &&
      pending &&
      deck?.clientWidth &&
      !isLockedWidth &&
      !hasPaneWidth &&
      deck.clientWidth !== containerWidth
    ) {
      setContainerWidth(deck.clientWidth);
      return;
    }
    pendingMotionRef.current = null;
    if (!pending && active) return;
    const interrupted = motionRef.current?.isRunning();
    const nextKey = trail.contentKey ?? trail.columns.at(-1)?.key;
    const exitFrame = nextKey && interrupted ? motionRef.current?.exitFrame(nextKey) : undefined;
    motionRef.current?.cancel();
    motionRef.current = null;
    if (!active || !pending?.animate || isSearching || layout.mode !== "desktop-stack" || !deck)
      return;

    const hasHiddenColumns = [...deck.querySelectorAll("[data-lessons-col]")].some(
      (column) => column.getClientRects().length === 0,
    );
    if (hasHiddenColumns || pending.snapshot?.cols.some(({ rect }) => rect.width === 0)) return;
    const target = Math.max(0, deck.scrollWidth - deck.clientWidth);
    if (Math.abs(deck.scrollLeft - target) >= 2) deck.scrollLeft = target;
    didAnimatedAlignRef.current = true;
    motionRef.current = animateDeckTransition({
      deck,
      overlayHost: motionLayerRef.current,
      snapshot: pending.snapshot,
      prevTrail: pending.prevTrail,
      nextTrail: trail,
      animate: true,
      interrupted,
      resume: nextKey && exitFrame ? { key: nextKey, ...exitFrame } : undefined,
    });
  }, [active, containerWidth, hasPaneWidth, isLockedWidth, isSearching, layout.mode, trail]);

  // Auto-scroll horizontal Miller deck cleanly when trail changes without an active FLIP/WAAPI transition
  useEffect(() => {
    if (didAnimatedAlignRef.current) {
      didAnimatedAlignRef.current = false;
      return;
    }
    const deck = deckScrollRef.current;
    if (!deck || !layout.showAncestors || effectiveContainerWidth <= 0) return;
    const snap = () => {
      const target = Math.max(0, deck.scrollWidth - deck.clientWidth);
      if (Math.abs(deck.scrollLeft - target) < 2) return;
      deck.scrollLeft = target;
    };
    const raf = requestAnimationFrame(snap);
    return () => cancelAnimationFrame(raf);
  }, [activeColumns.length, activeOpen, layout.showAncestors, effectiveContainerWidth]);

  const closeForm = () => {
    setNaming(null);
    setSubmitted(false);
  };

  const cancelForm = () => {
    closeForm();
    requestAnimationFrame(() => {
      const trigger = formTriggerRef.current;
      if (trigger?.isConnected) trigger.focus();
      else hostRef.current?.querySelector<HTMLElement>("[data-new-lesson]")?.focus();
    });
  };

  const triggerTrailChange = (animate: boolean, apply: () => void) => {
    if (naming !== null) closeForm();
    pendingMotionRef.current = {
      snapshot: animate ? captureDeckSnapshot(deckScrollRef.current) : null,
      prevTrail: trail,
      animate,
    };
    apply();
    const next = lessons.getState();
    const foldingTrail =
      animate && !next.open && next.folder.length <= folder.length ? lessonTrailKey(next) : null;
    if (next.foldingTrail !== foldingTrail) lessons.setState({ foldingTrail });
  };

  const openForm = (scope?: LessonScope, depth = 0, prefixParts: readonly string[] = []) => {
    const focused = document.activeElement;
    formTriggerRef.current =
      focused instanceof HTMLElement && focused.matches("[data-new-lesson]") ? focused : null;
    setSubmitted(false);
    setNewScope(scope ?? (!hasProject || scopeFilter === "all" ? "all" : "film"));
    setNamingDepth(depth);
    setNaming(prefixParts.length ? `${prefixParts.join("/")}/` : "");
    requestAnimationFrame(() => {
      const box = nameInputRef.current;
      if (!box) return;
      box.focus();
      const end = box.value.length;
      box.setSelectionRange(end, end);
    });
  };
  const trimmed = naming?.trim() ?? "";
  const targetScope: LessonScope = hasProject ? newScope : "all";
  const existingLesson = trimmed ? findExistingLesson(targetScope, trimmed) : undefined;
  const errMsg =
    !trimmed || trimmed.endsWith("/")
      ? trimmed
        ? "Enter a lesson name after the slash."
        : "Enter a lesson name."
      : !LESSON_NAME.test(trimmed)
        ? "Use letters (A–Z or a–z), numbers, hyphens, or underscores in each part. Separate folders with one slash, as in craft/camera."
        : !existingLesson && lessonPath(trimmed).length > LESSON_PATH_MAX
          ? `Shorten the path to ${LESSON_PATH_MAX} characters or fewer, including .md.`
          : null;
  const createLesson = () => {
    if (errMsg) {
      setSubmitted(true);
      nameInputRef.current?.focus();
      return;
    }
    closeForm();
    if (scopeFilter !== "both" && scopeFilter !== targetScope) setScopeFilter(targetScope);
    setQuery("");
    triggerTrailChange(false, () => newLesson(trimmed, targetScope));
  };

  const removeFromDeck = async (targetKey: string) => {
    const canFold = layout.mode !== "compact-file";
    const snapshot = canFold ? captureDeckSnapshot(deckScrollRef.current) : null;
    const prevTrail = trail;
    await removeLessonWithUndo(targetKey, () => {
      if (snapshot) {
        pendingMotionRef.current = { snapshot, prevTrail, animate: true };
      }
    });
  };

  const focusLastColumn = (returnKey?: string, fromPointer = false) => {
    requestAnimationFrame(() => {
      const columns = hostRef.current?.querySelectorAll<HTMLElement>("[data-lessons-col]");
      const column = columns?.[columns.length - 1];
      if (!column) return;
      const rows = [...column.querySelectorAll<HTMLElement>("[data-lesson-row]")];
      const target =
        rows.find((row) => row.dataset.lessonRow === returnKey) ??
        rows.find((row) => row.getAttribute("aria-current") === "true") ??
        rows[0] ??
        column.querySelector<HTMLElement>("header button");
      const destination = fromPointer ? (target?.closest("li") ?? column) : target;
      destination?.focus({ preventScroll: fromPointer });
    });
  };

  const navigateFolder = (parts: readonly string[], animate: boolean) => {
    triggerTrailChange(animate, () => openLessonFolder([...parts]));
    focusLastColumn(undefined, animate);
  };

  const closeLesson = (animate: boolean) => {
    triggerTrailChange(animate, () => openLesson(null));
    if (activeOpen) focusLastColumn(`file:${activeOpen}`, animate);
  };

  const handleOpenFile = (key: string, matchLine: number | null, animate = true) => {
    triggerTrailChange(animate && !isSearching, () => {
      setJumpTarget(matchLine ? { path: key, line: matchLine } : null);
      openLesson(key);
    });
    if (!matchLine)
      requestAnimationFrame(() => {
        const selector = animate ? "[data-lesson-content]" : "[data-lesson-back]";
        hostRef.current?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: animate });
      });
  };

  const setSearchQuery = (next: string) => {
    setQuery(next);
    setJumpTarget(null);
    if (next.trim() || !isSearching) return;
    requestAnimationFrame(() => {
      const host = hostRef.current;
      const field = host?.querySelector<HTMLInputElement>('input[type="search"]');
      if (field?.getClientRects().length) field.focus();
      else {
        const back = host?.querySelector<HTMLElement>("[data-lesson-back]");
        if (back) back.focus({ preventScroll: true });
        else focusLastColumn();
      }
    });
  };

  const handleDeckKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target;
    if (!(target instanceof HTMLElement) || target.matches("input, textarea, select")) return;
    const deck = deckScrollRef.current;
    if (!deck) return;
    const contentEl = target.closest<HTMLElement>("[data-lesson-content]");
    if (contentEl && e.key === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();
      closeLesson(false);
      return;
    }

    const colEl = target.closest<HTMLElement>("[data-lessons-col]");
    if (!colEl) return;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const rows = [...colEl.querySelectorAll<HTMLButtonElement>("button[data-lesson-row]")];
      const current = target.closest<HTMLButtonElement>("button[data-lesson-row]");
      const idx = current ? rows.indexOf(current) : -1;
      if (idx === -1) return;
      e.preventDefault();
      e.stopPropagation();
      const next =
        rows[Math.max(0, Math.min(rows.length - 1, idx + (e.key === "ArrowDown" ? 1 : -1)))];
      next?.focus();
      return;
    }

    if (isDeckBoundaryKey(e.key)) {
      if (target.closest("[role='radiogroup']")) return;
      e.preventDefault();
      e.stopPropagation();
      const cols = [...deck.querySelectorAll<HTMLElement>("[data-lessons-col]")].filter(
        (column) => column.getClientRects().length > 0,
      );
      const idx = cols.indexOf(colEl);
      const nextCol = cols[idx + (e.key === "ArrowRight" ? 1 : -1)];
      if (nextCol) {
        const focusTarget =
          nextCol.querySelector<HTMLButtonElement>(
            "button[aria-current='true'][data-lesson-row]",
          ) ?? nextCol.querySelector<HTMLButtonElement>("button[data-lesson-row]");
        focusTarget?.focus();
        return;
      }
      if (e.key === "ArrowRight") {
        const sheet = deck.querySelector<HTMLElement>("[data-lesson-content]");
        const focusTarget = sheet?.querySelector<HTMLElement>(
          "button, [role='radio'], [tabindex='0']",
        );
        focusTarget?.focus();
      }
    }
  };

  const initialLine = jumpTarget && jumpTarget.path === activeOpen ? jumpTarget.line : null;
  const contentOffsets = lessonCardOffsets(renderedColumns.length, layout);
  const mobileStageOrder = [
    ...Array.from({ length: Math.max(8, activeColumns.length + 1) }, (_, i) => `col:${i}`),
    "file",
  ];

  const deckItems = (
    <>
      {renderedColumns.map((col, idx) => {
        const showFormHere =
          naming !== null && namingDepth === col.depth && idx === renderedColumns.length - 1;
        return (
          <LessonColumnView
            key={col.key}
            col={col}
            idx={idx}
            totalCols={renderedColumns.length}
            trail={trail}
            layout={layout}
            activeOpen={activeOpen}
            loaded={loaded}
            loadFailed={loadFailed}
            isSearching={isSearching}
            query={query}
            setQuery={setSearchQuery}
            hasProject={hasProject}
            filesCount={files.length}
            filmCount={filmCount}
            allCount={allCount}
            scopedFilesCount={scopedFiles.length}
            activeFilter={activeFilter}
            onChangeFilter={(nextScope) => {
              setJumpTarget(null);
              triggerTrailChange(false, () => setScopeFilter(nextScope));
            }}
            showFormHere={showFormHere}
            onToggleForm={() =>
              showFormHere ? cancelForm() : openForm(undefined, col.depth, col.parts)
            }
            openForm={openForm}
            closeForm={cancelForm}
            nameInputRef={nameInputRef}
            newScope={newScope}
            setNewScope={setNewScope}
            naming={naming}
            setNaming={setNaming}
            submitted={submitted}
            openExisting={Boolean(existingLesson)}
            setSubmitted={setSubmitted}
            errMsg={errMsg}
            onCreateLesson={createLesson}
            matchByKey={matchByKey}
            onFocusFolder={navigateFolder}
            onFoldTo={(parts, animate) =>
              isSearching ? closeLesson(animate) : navigateFolder(parts, animate)
            }
            onSelectDir={navigateFolder}
            onSelectFile={handleOpenFile}
            onDeleteFile={(fileKey) => void removeFromDeck(fileKey)}
          />
        );
      })}

      {activeOpen && (
        <div
          data-lesson-content={activeOpen}
          tabIndex={-1}
          style={
            layout.showAncestors
              ? ({
                  "--deck-top": `${contentOffsets.stepTopPx}px`,
                  "--deck-z": String(renderedColumns.length + 1),
                  "--deck-reader-w": `${READER_WIDTH}px`,
                } as CSSProperties)
              : undefined
          }
          className={cn(
            "bg-background relative flex min-h-0 flex-1 flex-col self-stretch",
            layout.showAncestors
              ? cn(
                  "border-primary/45 shadow-sheet z-(--deck-z) mt-(--deck-top) rounded-ss-xl border-s border-t @max-[19rem]/lesson-deck:mt-0 @max-[19rem]/lesson-deck:rounded-none @max-[19rem]/lesson-deck:border-0 @max-[19rem]/lesson-deck:shadow-none",
                  tighterDeck || dock === "end"
                    ? "min-w-[min(17.5rem,100%)] @max-[19rem]/lesson-deck:min-w-0"
                    : "min-w-[min(var(--deck-reader-w),100%)] @max-[19rem]/lesson-deck:min-w-0",
                )
              : "min-w-0",
          )}
        >
          <LessonFileView
            key={activeOpen}
            path={activeOpen}
            initialLine={initialLine}
            showBack={layout.showAncestors}
            onBack={closeLesson}
            onDelete={() => void removeFromDeck(activeOpen)}
          />
        </div>
      )}
    </>
  );

  const deckBody = (
    <div
      ref={deckScrollRef}
      onKeyDown={handleDeckKeyDown}
      style={isLockedWidth ? ({ "--deck-lock-w": `${lockWidthPx}px` } as CSSProperties) : undefined}
      className={cn(
        "relative z-10 flex min-h-0 flex-1 [scrollbar-width:thin] overflow-x-auto overflow-y-hidden",
        isLockedWidth && (dock === "end" ? "justify-end" : "justify-start"),
      )}
    >
      <div
        className={cn(
          "flex min-h-0",
          isLockedWidth ? "w-(--deck-lock-w) flex-none" : "min-w-0 flex-1",
        )}
      >
        {deckItems}
      </div>
    </div>
  );

  return (
    <div
      ref={hostRef}
      className={cn(
        "@container/lesson-deck relative isolate flex min-h-0 min-w-0 flex-1 flex-col",
        (layout.showAncestors || renderedColumns.length > 1 || isLockedWidth) && "bg-backdrop",
      )}
    >
      <div
        ref={motionLayerRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      />
      {isDesktop ? (
        deckBody
      ) : (
        <TabStage
          activeKey={activeOpen ? "file" : `col:${renderedColumns[0]?.depth ?? 0}`}
          order={mobileStageOrder}
          distance={18}
          duration={200}
          className="flex min-h-0 flex-1 flex-col"
        >
          {layout.mode === "compact-file" && activeOpen ? (
            <div
              data-lesson-content={activeOpen}
              tabIndex={-1}
              className="flex min-h-0 flex-1 flex-col"
            >
              <LessonFileView
                key={activeOpen}
                path={activeOpen}
                initialLine={initialLine}
                showBack
                onBack={closeLesson}
                onDelete={() => void removeFromDeck(activeOpen)}
              />
            </div>
          ) : (
            deckBody
          )}
        </TabStage>
      )}
    </div>
  );
}
