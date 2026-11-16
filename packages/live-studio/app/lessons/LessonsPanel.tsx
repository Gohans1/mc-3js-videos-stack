// The Lessons tab: project lessons/<path>.md plus global lessons/<path>.md, rendered as an md-phone desktop Miller deck
// so ancestor folder columns always stay visible beside opened subfolders and notes, with GFM Read view, painted
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

import { useActivity } from "../activity/activity";
import { Segmented } from "../components/inspector";
import { prefersReduced, TabStage } from "../components/Motion";
import { isDesktopViewport } from "../components/splitter-layout";
import { AiInspector } from "./AiInspector";
import { animateDeckTransition, captureDeckSnapshot, type DeckSnapshot } from "./deck-motion";
import { removeLessonWithUndo } from "./lesson-ui";
import { LessonColumnView } from "./LessonColumn";
import { LessonFileView } from "./LessonFileView";
import {
  dismissAiNotice,
  LESSON_NAME,
  type LessonFile,
  lessons,
  type LessonScope,
  type LessonScopeFilter,
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

type LessonsPanelProps = { desktop?: boolean; lockWidthPx?: number | null; dock?: "start" | "end" };

export function LessonsPanel(props: LessonsPanelProps = {}) {
  const tab = useLessons((s) => s.subTab);
  const [visited, setVisited] = useState(tab === "inspector");
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-none px-2 py-1.5">
        <Segmented
          label="Lessons view"
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
      <TabStage
        activeKey={tab}
        order={["deck", "inspector"]}
        duration={150}
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        <div className={cn("min-h-0 min-w-0 flex-1 flex-col", tab === "deck" ? "flex" : "hidden")}>
          <LessonDeckPanel {...props} />
        </div>
        <div
          className={cn("min-h-0 min-w-0 flex-1 flex-col", tab === "inspector" ? "flex" : "hidden")}
        >
          {visited && <AiInspector active={tab === "inspector"} />}
        </div>
      </TabStage>
    </div>
  );
}

function LessonDeckPanel({
  desktop,
  lockWidthPx = null,
  dock = "start",
}: {
  desktop?: boolean;
  lockWidthPx?: number | null;
  dock?: "start" | "end";
} = {}) {
  useFresh();
  const { files, loaded, folder, open, seen, edits, scopeFilter, projectDir, aiNotice } =
      useLessons((s) => s),
    lit = useActivity((s) => s.lit);

  const isDesktop =
    desktop ??
    (typeof window === "undefined"
      ? true
      : isDesktopViewport(window.innerWidth, window.innerHeight));

  const hostRef = useRef<HTMLDivElement>(null);
  const deckScrollRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const pendingMotionRef = useRef<{
    snapshot: DeckSnapshot | null;
    prevTrail: LessonTrail;
    animate: boolean;
  } | null>(null);
  const stopMotionRef = useRef<(() => void) | null>(null);
  const didAnimatedAlignRef = useRef(false);

  const [containerWidth, setContainerWidth] = useState(720);
  const [jumpTarget, setJumpTarget] = useState<{ path: string; line: number } | null>(null);
  const [query, setQuery] = useState("");
  const [naming, setNaming] = useState<string | null>(null);
  const [namingDepth, setNamingDepth] = useState(0);
  const [newScope, setNewScope] = useState<LessonScope>("film");
  const [submitted, setSubmitted] = useState(false);

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const sync = () => {
      const next = Math.round(el.getBoundingClientRect().width);
      setContainerWidth((prev) => (prev === next ? prev : next));
    };
    sync();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => () => stopMotionRef.current?.(), []);

  useEffect(() => {
    if (!aiNotice) return;
    toast.add({
      title: aiNotice.removed ? "Lesson removed by AI" : "Lesson updated by AI",
      description: aiNotice.removed
        ? `${aiNotice.path} was removed outside the studio.`
        : `Adopted the AI's latest version of ${aiNotice.path}.`,
      type: "info",
    });
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

  const isLockedWidth = isDesktop && typeof lockWidthPx === "number" && lockWidthPx > 0;
  const effectiveContainerWidth = isLockedWidth ? lockWidthPx : containerWidth;

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
  const renderedColumns = layout.showAncestors ? activeColumns : activeColumns.slice(-1);

  useLayoutEffect(() => {
    const pending = pendingMotionRef.current;
    pendingMotionRef.current = null;
    if (!pending?.animate || isSearching || layout.mode !== "desktop-stack") return;

    const deck = deckScrollRef.current;
    if (deck) {
      const target = Math.max(0, deck.scrollWidth - deck.clientWidth);
      if (Math.abs(deck.scrollLeft - target) >= 2) {
        deck.scrollLeft = target;
      }
    }
    didAnimatedAlignRef.current = true;
    stopMotionRef.current?.();
    stopMotionRef.current = animateDeckTransition({
      deck,
      snapshot: pending.snapshot,
      prevTrail: pending.prevTrail,
      nextTrail: trail,
      animate: true,
    });
  });

  // Auto-scroll horizontal Miller deck cleanly when trail changes without an active FLIP/WAAPI transition
  useEffect(() => {
    if (didAnimatedAlignRef.current) {
      didAnimatedAlignRef.current = false;
      return;
    }
    const deck = deckScrollRef.current;
    if (!deck || !layout.showAncestors || containerWidth <= 0) return;
    const snap = () => {
      const target = Math.max(0, deck.scrollWidth - deck.clientWidth);
      if (Math.abs(deck.scrollLeft - target) < 2) return;
      deck.scrollTo({ left: target, behavior: prefersReduced() ? "instant" : "smooth" });
    };
    const raf = requestAnimationFrame(snap);
    return () => cancelAnimationFrame(raf);
  }, [activeColumns.length, activeOpen, layout.showAncestors, containerWidth]);

  const closeForm = () => {
    setNaming(null);
    setSubmitted(false);
  };

  const triggerTrailChange = (animate: boolean, apply: () => void) => {
    if (naming !== null) closeForm();
    pendingMotionRef.current = {
      snapshot: animate ? captureDeckSnapshot(deckScrollRef.current) : null,
      prevTrail: trail,
      animate,
    };
    apply();
  };

  const openForm = (scope?: LessonScope, depth = 0, prefixParts: readonly string[] = []) => {
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
  const errMsg = !trimmed
    ? "Enter a topic name first."
    : !LESSON_NAME.test(trimmed)
      ? "Letters, digits, - and _ only; / for a folder"
      : null;
  const createLesson = () => {
    if (errMsg) {
      setSubmitted(true);
      nameInputRef.current?.focus();
      return;
    }
    const targetScope: LessonScope = hasProject ? newScope : "all";
    closeForm();
    if (scopeFilter !== "both" && scopeFilter !== targetScope) setScopeFilter(targetScope);
    setQuery("");
    triggerTrailChange(true, () => newLesson(trimmed, targetScope));
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

  const handleOpenFile = (key: string, matchLine: number | null, animate = true) => {
    triggerTrailChange(animate && !isSearching, () => {
      setJumpTarget(matchLine ? { path: key, line: matchLine } : null);
      openLesson(key);
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
      const cols = [...deck.querySelectorAll<HTMLElement>("[data-lessons-col]")];
      const lastCol = cols[cols.length - 1];
      const focusTarget =
        lastCol?.querySelector<HTMLButtonElement>("button[aria-current='true'][data-lesson-row]") ??
        lastCol?.querySelector<HTMLButtonElement>("button[data-lesson-row]");
      if (focusTarget) {
        e.preventDefault();
        e.stopPropagation();
        focusTarget.focus();
      }
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
      const cols = [...deck.querySelectorAll<HTMLElement>("[data-lessons-col]")];
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
  const contentDepth = trail.contentDepth ?? 1;
  const contentOffsets = lessonCardOffsets(contentDepth, layout);
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
            isSearching={isSearching}
            query={query}
            setQuery={setQuery}
            hasProject={hasProject}
            filesCount={files.length}
            filmCount={filmCount}
            allCount={allCount}
            scopedFilesCount={scopedFiles.length}
            activeFilter={activeFilter}
            onChangeFilter={(nextScope) =>
              triggerTrailChange(true, () => setScopeFilter(nextScope))
            }
            showFormHere={showFormHere}
            onToggleForm={() =>
              showFormHere ? closeForm() : openForm(undefined, col.depth, col.parts)
            }
            openForm={openForm}
            closeForm={closeForm}
            nameInputRef={nameInputRef}
            newScope={newScope}
            setNewScope={setNewScope}
            naming={naming}
            setNaming={setNaming}
            submitted={submitted}
            setSubmitted={setSubmitted}
            errMsg={errMsg}
            onCreateLesson={createLesson}
            matchByKey={matchByKey}
            onFocusFolder={(parts, animate) =>
              triggerTrailChange(animate, () => openLessonFolder([...parts]))
            }
            onFoldTo={(parts, animate) =>
              triggerTrailChange(animate, () =>
                isSearching ? openLesson(null) : openLessonFolder([...parts]),
              )
            }
            onSelectDir={(nextParts, animate) =>
              triggerTrailChange(animate && !isSearching, () => openLessonFolder([...nextParts]))
            }
            onSelectFile={handleOpenFile}
            onDeleteFile={(fileKey) => void removeFromDeck(fileKey)}
          />
        );
      })}

      {activeOpen && (
        <div
          data-lesson-content={activeOpen}
          style={
            layout.showAncestors
              ? ({
                  "--deck-top": `${contentOffsets.stepTopPx}px`,
                  "--deck-z": String(renderedColumns.length + 1),
                } as CSSProperties)
              : undefined
          }
          className={cn(
            "bg-background relative flex min-h-0 flex-1 flex-col self-stretch",
            layout.showAncestors
              ? cn(
                  "border-primary/45 shadow-sheet z-(--deck-z) mt-(--deck-top) rounded-ss-xl border-s border-t",
                  layout.stickyStepPx === 24
                    ? "min-w-[min(17.5rem,100%)]"
                    : "min-w-[min(20rem,100%)]",
                )
              : "min-w-0",
          )}
        >
          <LessonFileView
            key={activeOpen}
            path={activeOpen}
            depthPill={layout.showAncestors ? `L${contentDepth}` : undefined}
            initialLine={initialLine}
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
        "flex min-h-0 flex-1 [scrollbar-width:thin] overflow-x-auto overflow-y-hidden",
        (layout.showAncestors || renderedColumns.length > 1 || isLockedWidth) && "bg-backdrop",
        isLockedWidth && (dock === "end" ? "justify-end" : "justify-start"),
      )}
    >
      {isLockedWidth ? (
        <div className="flex min-h-0 w-(--deck-lock-w) flex-none">{deckItems}</div>
      ) : (
        deckItems
      )}
    </div>
  );

  return (
    <div ref={hostRef} className="flex min-h-0 flex-1 flex-col">
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
            <div data-lesson-content={activeOpen} className="flex min-h-0 flex-1 flex-col">
              <LessonFileView
                key={activeOpen}
                path={activeOpen}
                initialLine={initialLine}
                showBack
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
