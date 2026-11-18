import { type CSSProperties, lazy, Suspense, useEffect, useRef, useSyncExternalStore } from "react";

import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";

import { cliStore, useCliStore } from "./cli/cli-store";
import { Splitter, useStoredSize } from "./components/Splitter";
import {
  clampSplitterLayout,
  EDIT_MIN,
  isDesktopViewport,
  LIB_MIN,
  measureTimelineMin,
  REVIEW_MIN,
  sanitizeStoredSize,
  SIDE_MIN,
  wideLayout,
} from "./components/splitter-layout";
import type { Bind, Elements } from "./core/state";
import { useStudio } from "./core/store";
import { useDeckShrinkLatch } from "./lessons/deck-latch";
import { lessonTrailKey, useLessons } from "./lessons/lessons";
import { LESSONS_LIBRARY_WIDTH } from "./lessons/tree";
import { ReviewRoom } from "./notes/ReviewRoom";
import { Stage } from "./picture/Stage";
import { useBoot } from "./shell/boot";
import { Library, Side, useEditable, useWide } from "./shell/Side";
import { Transport } from "./shell/Transport";
import { useStudioHotkeys } from "./shell/useStudioHotkeys";
import { useVoicePlaygroundSelector } from "./sound/voice-playground-client";
import { PasteAttributes } from "./timeline/PasteAttributes";
import { TimelinePanel } from "./timeline/TimelinePanel";

const VoicePlaygroundWorkbenchDialog = lazy(() =>
  import("./sound/VoicePlaygroundWorkspace").then((m) => ({
    default: m.VoicePlaygroundWorkbenchDialog,
  })),
);

const subscribeViewport = (onChange: () => void) => {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
};
const getViewport = () => `${window.innerWidth}x${window.innerHeight}`;

function useViewport() {
  const snap = useSyncExternalStore(subscribeViewport, getViewport, () => "1440x900");
  const [vw, vh] = snap.split("x").map(Number);
  return { vw, vh };
}

export function App() {
  const el = useRef({} as Elements);
  const bind: Bind = (key) => (node) => {
    if (node) el.current[key] = node;
  };
  useStudioHotkeys();
  const pgEverOpened = useVoicePlaygroundSelector((s) => s.everOpened, false);
  const { vw, vh } = useViewport();
  const desktop = isDesktopViewport(vw, vh);
  const [rawSideW, setSideW] = useStoredSize("studio.sideWidth"),
    [rawEditH, setEditH] = useStoredSize("studio.timelineHeight"),
    [rawLibW, setLibW] = useStoredSize("studio.libWidth"),
    [rawLessonsW, setLessonsW] = useStoredSize("studio.lessonsWidth"),
    [rawReviewW, setReviewW] = useStoredSize("studio.reviewWidth");
  const sideW = sanitizeStoredSize(rawSideW, SIDE_MIN),
    libW = sanitizeStoredSize(rawLibW, LIB_MIN),
    lessonsLibW = sanitizeStoredSize(rawLessonsW, LIB_MIN),
    lessonsSideW = sanitizeStoredSize(rawLessonsW, SIDE_MIN),
    editH = sanitizeStoredSize(rawEditH, EDIT_MIN),
    reviewW = sanitizeStoredSize(rawReviewW, REVIEW_MIN, false);
  const sideCell = useRef<HTMLDivElement>(null),
    libCell = useRef<HTMLDivElement>(null),
    reviewCell = useRef<HTMLDivElement>(null);
  const editable = useEditable(),
    wideScreen = useWide(),
    lib = useStudio((s) => s.lib),
    side = useStudio((s) => s.side),
    lessonDeckTargetW = useLessons((s) =>
      s.subTab === "inspector"
        ? 800
        : !s.open && s.folder.length === 0
          ? null
          : s.open
            ? Math.min(1200, Math.max(800, (s.folder.length + 1) * 192 + 600))
            : Math.min(960, Math.max(540, (s.folder.length + 1) * 192 + 128)),
    );
  const { showLibrary, showDetails, showSideOnRight, wideAttr } = wideLayout({
    wideScreen,
    editable,
  });
  const lessonsInLibrary = showLibrary && lib === "lessons";
  const lessonsWideSide =
    showSideOnRight && desktop && side === "lessons" && lessonDeckTargetW !== null;
  // Keep Stage geometry stable across the Deck trail, Reader and Inspector.
  const effRawLibW = lessonsInLibrary ? (lessonsLibW ?? LESSONS_LIBRARY_WIDTH) : libW;
  const effRawSideW =
    lessonsWideSide && lessonDeckTargetW !== null
      ? lessonsSideW === null
        ? Math.min(900, Math.max(540, lessonDeckTargetW))
        : lessonsSideW
      : sideW;
  const review = useStudio((s) => s.review);
  const sideTab = useStudio((s) => s.side);
  const libraryTab = useStudio((s) => s.lib);
  const cliPanelMode = useCliStore((s) => s.panelMode);
  const cliSelected = showLibrary ? libraryTab === "cli" : sideTab === "cli";
  const cliExpanded = !review && cliSelected && cliPanelMode === "expanded";
  useEffect(() => {
    if (!cliSelected && cliPanelMode === "expanded") cliStore.setState({ panelMode: "embedded" });
  }, [cliSelected, cliPanelMode]);
  const inspectorActive = useLessons((s) => s.subTab === "inspector");
  const focusedLessons =
    !showLibrary && side === "lessons" && (inspectorActive || (desktop && vh < 640));
  const targetBounds = clampSplitterLayout({
    vw,
    vh,
    wideAttr,
    rawLibW: effRawLibW,
    rawSideW: effRawSideW,
    rawEditH: editH,
    rawReviewW: reviewW,
    editMin: EDIT_MIN,
  });
  const trailKey = useLessons(lessonTrailKey);
  const animateDeckFold = useLessons((s) => s.foldingTrail === trailKey);
  const desiredLibPx =
    targetBounds.libW === 0 ? 0 : Math.min(targetBounds.libW ?? 400, targetBounds.libMax);
  const desiredSidePx =
    targetBounds.sideW === 0 ? 0 : Math.min(targetBounds.sideW ?? 360, targetBounds.sideMax);
  const sideLatch = useDeckShrinkLatch({
    desiredW: desiredSidePx,
    trailKey,
    animate: animateDeckFold,
    active:
      !inspectorActive &&
      showSideOnRight &&
      desktop &&
      side === "lessons" &&
      targetBounds.sideW !== 0,
  });
  const bounds =
    sideLatch.lockW !== null
      ? clampSplitterLayout({
          vw,
          vh,
          wideAttr,
          rawLibW: effRawLibW,
          rawSideW: sideLatch.paneW,
          rawEditH: editH,
          rawReviewW: reviewW,
          editMin: EDIT_MIN,
        })
      : targetBounds;
  const px = (n: number | null) => (n === null ? undefined : `${n}px`);
  const room: CSSProperties = {
    "--side-w": px(bounds.sideW),
    "--lib-w": px(bounds.libW),
    "--edit-h": px(bounds.editH),
    "--review-w": px(bounds.reviewW),
    "--lib-max": `${bounds.libMax}px`,
    "--side-max": `${bounds.sideMax}px`,
    "--review-max": `${bounds.reviewMax}px`,
    "--edit-max": `${bounds.editMax}px`,
  };
  useBoot(el);
  return (
    <Toaster limit={3}>
      <TooltipProvider delay={500}>
        <div
          style={room}
          data-cli-side={(desktop && showSideOnRight && sideTab === "cli") || undefined}
          data-cli-expanded={cliExpanded ? (showLibrary ? "library" : "side") : undefined}
          data-side-folded={
            (desktop &&
              !focusedLessons &&
              (showSideOnRight || showDetails) &&
              bounds.sideW === 0) ||
            undefined
          }
          data-lib-folded={(showLibrary && bounds.libW === 0) || undefined}
          data-edit-folded={(desktop && bounds.editH === 0) || undefined}
          data-wide={review || cliExpanded ? undefined : wideAttr}
          data-review={review || undefined}
          data-lessons-focused={focusedLessons || undefined}
          className="bg-backdrop upright:gap-0 upright:bg-background upright:p-0 sideways:gap-0 sideways:bg-background sideways:p-0 upright:flex upright:flex-col sideways:grid-cols-[minmax(0,1fr)_min(36%,320px)] grid h-dvh grid-cols-[minmax(0,1fr)_min(var(--side-w,360px),var(--side-max,calc(100%_-_378px)))] grid-rows-[minmax(0,1fr)_auto_auto] gap-x-1.5 overflow-hidden p-1.5 text-sm data-cli-expanded:grid data-cli-expanded:grid-cols-[minmax(0,1fr)] data-cli-expanded:grid-rows-[minmax(0,1fr)] data-review:grid-cols-[min(var(--review-w,max(34rem,52%)),var(--review-max,calc(100%_-_378px)))_minmax(0,1fr)] data-review:grid-rows-[minmax(0,1fr)_auto] data-[wide=2]:grid-cols-[min(var(--lib-w,400px),var(--lib-max,calc(100%_-_378px)))_minmax(0,1fr)] data-[wide=3]:grid-cols-[min(var(--lib-w,400px),var(--lib-max,calc(100%_-_644px)))_minmax(0,1fr)_minmax(0,min(var(--side-w,340px),var(--side-max,calc(100%_-_644px))))]"
        >
          <Stage bind={bind} />
          <Transport />
          <TimelinePanel bind={bind} size={bounds.editH} />
          {showLibrary && <Library />}
          {(showSideOnRight || showDetails) && (
            <Side wide={showLibrary} desktop={desktop} lessonsLockW={sideLatch.lockW} />
          )}
          {review && <ReviewRoom />}
          <PasteAttributes />
          {/* Full-height Library on the left in wide mode; timeline pushed right beside it */}
          <div className="upright:hidden sideways:hidden pointer-events-none relative col-[1/-1] row-start-3 in-data-cli-expanded:hidden in-data-cli-side:col-[1] in-data-edit-folded:-top-[5px] in-data-lessons-focused:hidden in-data-review:hidden in-data-wide:col-[2/-1]">
            <Splitter
              label="Timeline height"
              across
              size={bounds.editH}
              measure={() => el.current.timeline?.getBoundingClientRect().height ?? 0}
              min={() => {
                const t = el.current.timeline,
                  list = t?.querySelector<HTMLElement>("[data-tracks-scroll]");
                if (!t || !list) return EDIT_MIN;
                const tr = t.getBoundingClientRect();
                return measureTimelineMin({
                  timelineTop: tr.top,
                  timelineHeight: tr.height,
                  tracksTop: list.getBoundingClientRect().top,
                  fallback: EDIT_MIN,
                });
              }} // the head that stays put and two rows
              max={() => bounds.editMax}
              set={setEditH}
              className="pointer-events-auto -top-px" // the middle of the gap over the timeline
            />
          </div>
          {showLibrary && (
            <div
              ref={libCell}
              className="pointer-events-none relative z-30 col-start-1 row-[1/-1] in-data-cli-expanded:hidden in-data-review:hidden"
            >
              <Splitter
                key={lessonsInLibrary ? "lessons" : "library"}
                label="Library width"
                across={false}
                before
                size={bounds.libW ?? desiredLibPx}
                measure={() => libCell.current?.offsetWidth ?? desiredLibPx}
                min={() => LIB_MIN}
                max={() => bounds.libMax}
                set={lessonsInLibrary ? setLessonsW : setLibW}
                className="pointer-events-auto -right-[7px]"
              />
            </div>
          )}
          {review && (
            <div
              ref={reviewCell}
              className="upright:hidden sideways:hidden pointer-events-none relative z-30 col-start-1 row-span-2 row-start-1 in-data-cli-expanded:hidden"
            >
              <Splitter
                label="Review width"
                across={false}
                before
                fold={false}
                size={bounds.reviewW}
                measure={() => reviewCell.current?.offsetWidth ?? 580}
                min={() => REVIEW_MIN}
                max={() => bounds.reviewMax}
                set={setReviewW}
                className="pointer-events-auto -right-[7px]"
              />
            </div>
          )}
          {(showSideOnRight || showDetails) && (
            <div
              ref={sideCell}
              className="upright:hidden sideways:hidden pointer-events-none relative z-30 col-start-2 row-span-2 row-start-1 in-data-cli-expanded:hidden in-data-cli-side:row-span-3 in-data-lessons-focused:hidden in-data-review:hidden in-data-wide:col-start-3"
            >
              <Splitter
                key={lessonsWideSide ? "lessons-side" : "side"}
                label="Panel width"
                across={false}
                size={bounds.sideW}
                measure={() => sideCell.current?.offsetWidth ?? (showDetails ? 340 : 360)}
                min={() => SIDE_MIN}
                max={() => bounds.sideMax}
                set={lessonsWideSide ? setLessonsW : setSideW}
                className="pointer-events-auto -left-[7px]"
              />
            </div>
          )}
        </div>
        <audio ref={bind("audio")} preload="auto" />
        {pgEverOpened && (
          <Suspense fallback={null}>
            <VoicePlaygroundWorkbenchDialog />
          </Suspense>
        )}
      </TooltipProvider>
    </Toaster>
  );
}
