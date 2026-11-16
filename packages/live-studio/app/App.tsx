import { type CSSProperties, lazy, Suspense, useRef, useSyncExternalStore } from "react";

import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";

import { Splitter, useStoredSize } from "./components/Splitter";
import {
  clampSplitterLayout,
  EDIT_MIN,
  LIB_MIN,
  measureTimelineMin,
  REVIEW_MIN,
  sanitizeStoredSize,
  SIDE_MIN,
  wideLayout,
} from "./components/splitter-layout";
import type { Bind, Elements } from "./core/state";
import { useStudio } from "./core/store";
import { Stage } from "./picture/Stage";

const ReviewRoom = lazy(() =>
  import("./shell/LazyPanels").then((m) => ({ default: m.ReviewRoom })),
);
import { useBoot } from "./shell/boot";
import { Library, Side, useEditable, useWide } from "./shell/Side";
import { Transport } from "./shell/Transport";
import { useStudioHotkeys } from "./shell/useStudioHotkeys";
import { PasteAttributes } from "./timeline/PasteAttributes";
import { TimelinePanel } from "./timeline/TimelinePanel";

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
  const { vw, vh } = useViewport();
  const desktop = !(vh <= 520 || vw <= 559 || (vw <= 820 && vh >= 521));
  const [rawSideW, setSideW] = useStoredSize("studio.sideWidth"),
    [rawEditH, setEditH] = useStoredSize("studio.timelineHeight"),
    [rawLibW, setLibW] = useStoredSize("studio.libWidth"),
    [rawReviewW, setReviewW] = useStoredSize("studio.reviewWidth");
  const sideW = sanitizeStoredSize(rawSideW, SIDE_MIN),
    libW = sanitizeStoredSize(rawLibW, LIB_MIN),
    editH = sanitizeStoredSize(rawEditH, EDIT_MIN),
    reviewW = sanitizeStoredSize(rawReviewW, REVIEW_MIN, false);
  const sideCell = useRef<HTMLDivElement>(null),
    libCell = useRef<HTMLDivElement>(null),
    reviewCell = useRef<HTMLDivElement>(null);
  const editable = useEditable(),
    wideScreen = useWide();
  const { showLibrary, showDetails, showSideOnRight, wideAttr } = wideLayout({
    wideScreen,
    editable,
  });
  const review = useStudio((s) => s.review);
  const bounds = clampSplitterLayout({
    vw,
    vh,
    wideAttr,
    rawLibW: libW,
    rawSideW: sideW,
    rawEditH: editH,
    rawReviewW: reviewW,
    editMin: EDIT_MIN,
  });
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
          data-side-folded={
            (desktop && (showSideOnRight || showDetails) && bounds.sideW === 0) || undefined
          }
          data-lib-folded={(showLibrary && bounds.libW === 0) || undefined}
          data-edit-folded={(desktop && bounds.editH === 0) || undefined}
          data-wide={review ? undefined : wideAttr}
          data-review={review || undefined}
          className="bg-backdrop upright:gap-0 upright:bg-background upright:p-0 sideways:gap-0 sideways:bg-background sideways:p-0 upright:flex upright:flex-col sideways:grid-cols-[minmax(0,1fr)_min(36%,320px)] grid h-dvh grid-cols-[minmax(0,1fr)_min(var(--side-w,360px),var(--side-max,calc(100%_-_378px)))] grid-rows-[minmax(0,1fr)_auto_auto] gap-x-1.5 overflow-hidden p-1.5 text-sm data-review:grid-cols-[min(var(--review-w,max(34rem,52%)),var(--review-max,calc(100%_-_378px)))_minmax(0,1fr)] data-review:grid-rows-[minmax(0,1fr)_auto] data-[wide=2]:grid-cols-[min(var(--lib-w,400px),var(--lib-max,calc(100%_-_378px)))_minmax(0,1fr)] data-[wide=3]:grid-cols-[min(var(--lib-w,400px),var(--lib-max,calc(100%_-_644px)))_minmax(0,1fr)_minmax(0,min(var(--side-w,340px),var(--side-max,calc(100%_-_644px))))]"
        >
          <Stage bind={bind} />
          <Transport />
          <TimelinePanel bind={bind} />
          {showLibrary && <Library />}
          {(showSideOnRight || showDetails) && <Side wide={showLibrary} />}
          {review && (
            <Suspense fallback={null}>
              <ReviewRoom />
            </Suspense>
          )}
          <PasteAttributes />
          {/* Full-height Library on the left in wide mode; timeline pushed right beside it */}
          <div className="upright:hidden sideways:hidden pointer-events-none relative col-[1/-1] row-start-3 in-data-edit-folded:-top-[5px] in-data-review:hidden in-data-wide:col-[2/-1]">
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
              className="pointer-events-none relative z-30 col-start-1 row-[1/-1] in-data-review:hidden"
            >
              <Splitter
                label="Library width"
                across={false}
                before
                size={bounds.libW}
                measure={() => libCell.current?.offsetWidth ?? 400}
                min={() => LIB_MIN}
                max={() => bounds.libMax}
                set={setLibW}
                className="pointer-events-auto -right-[7px]"
              />
            </div>
          )}
          {review && (
            <div
              ref={reviewCell}
              className="upright:hidden sideways:hidden pointer-events-none relative z-30 col-start-1 row-span-2 row-start-1"
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
              className="upright:hidden sideways:hidden pointer-events-none relative z-30 col-start-2 row-span-2 row-start-1 in-data-review:hidden in-data-wide:col-start-3"
            >
              <Splitter
                label="Panel width"
                across={false}
                size={bounds.sideW}
                measure={() => sideCell.current?.offsetWidth ?? (showDetails ? 340 : 360)}
                min={() => SIDE_MIN}
                max={() => bounds.sideMax}
                set={setSideW}
                className="pointer-events-auto -left-[7px]"
              />
            </div>
          )}
        </div>
        <audio ref={bind("audio")} preload="auto" />
      </TooltipProvider>
    </Toaster>
  );
}
