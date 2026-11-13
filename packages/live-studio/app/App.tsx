import { type CSSProperties, useRef } from "react";

import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";

import { Splitter, useStoredSize } from "./components/Splitter";
import type { Bind, Elements } from "./core/state";
import { useStudio } from "./core/store";
import { ReviewRoom } from "./notes/ReviewRoom";
import { Stage } from "./picture/Stage";
import { useBoot } from "./shell/boot";
import { Library, Side, useEditable, useWide } from "./shell/Side";
import { Transport } from "./shell/Transport";
import { useStudioHotkeys } from "./shell/useStudioHotkeys";
import { PasteAttributes } from "./timeline/PasteAttributes";
import { TimelinePanel } from "./timeline/TimelinePanel";

export function App() {
  const el = useRef({} as Elements);
  const bind: Bind = (key) => (node) => {
    if (node) el.current[key] = node;
  };
  useStudioHotkeys();
  const [sideW, setSideW] = useStoredSize("studio.sideWidth"),
    [editH, setEditH] = useStoredSize("studio.timelineHeight"),
    [libW, setLibW] = useStoredSize("studio.libWidth");
  const sideCell = useRef<HTMLDivElement>(null),
    libCell = useRef<HTMLDivElement>(null);
  const editable = useEditable(),
    wide = useWide() && editable; // three columns only when there is something to show details of
  const review = useStudio((s) => s.review);
  const px = (n: number | null) => (n === null ? undefined : `${n}px`);
  const room: CSSProperties = { "--side-w": px(sideW), "--lib-w": px(libW), "--edit-h": px(editH) };
  useBoot(el);
  return (
    <Toaster limit={3}>
      <TooltipProvider delay={500}>
        <div
          style={room}
          data-side-folded={sideW === 0 || undefined}
          data-lib-folded={(wide && libW === 0) || undefined}
          data-wide={(wide && !review) || undefined}
          data-review={review || undefined}
          className="bg-backdrop upright:gap-0 upright:bg-background upright:p-0 sideways:gap-0 sideways:bg-background sideways:p-0 upright:flex upright:flex-col sideways:grid-cols-[minmax(0,1fr)_min(36%,320px)] grid h-dvh grid-cols-[minmax(0,1fr)_var(--side-w,360px)] grid-rows-[minmax(0,1fr)_auto_auto] gap-x-1.5 p-1.5 text-sm data-review:grid-cols-[minmax(0,1fr)_minmax(26rem,46%)] data-review:grid-rows-[minmax(0,1fr)_auto] data-wide:grid-cols-[var(--lib-w,400px)_minmax(0,1fr)_var(--side-w,340px)]"
        >
          <Stage bind={bind} />
          <Transport />
          <TimelinePanel bind={bind} size={editH} />
          {wide && <Library />}
          <Side wide={wide} />
          {review && <ReviewRoom />}
          <PasteAttributes />
          {/* CapCut's layout: picture and its controls with the details column beside them, the timeline across the whole width */}
          <div className="upright:hidden sideways:hidden pointer-events-none relative col-[1/-1] row-start-3 in-data-review:hidden">
            <Splitter
              label="Timeline height"
              across
              size={editH}
              measure={() => el.current.timeline?.getBoundingClientRect().height ?? 0}
              min={() => {
                const t = el.current.timeline,
                  list = t?.querySelector<HTMLElement>("[data-tracks-scroll]");
                return t && list
                  ? list.getBoundingClientRect().top - t.getBoundingClientRect().top + 64 + 12
                  : 300;
              }} // the head that stays put and two rows
              max={() => innerHeight - 220}
              set={setEditH}
              className="pointer-events-auto -top-px" // the middle of the gap over the timeline
            />
          </div>
          {wide && (
            <div
              ref={libCell}
              className="pointer-events-none relative col-start-1 row-span-2 row-start-1 in-data-review:hidden"
            >
              <Splitter
                label="Library width"
                across={false}
                before
                size={libW}
                measure={() => libCell.current?.offsetWidth ?? 400}
                min={() => 260}
                max={() => Math.min(640, innerWidth * 0.35)}
                set={setLibW}
                className="pointer-events-auto -right-[7px]"
              />
            </div>
          )}
          <div
            ref={sideCell}
            className="upright:hidden sideways:hidden pointer-events-none relative col-start-2 row-span-2 row-start-1 in-data-review:hidden in-data-wide:col-start-3"
          >
            <Splitter
              label="Panel width"
              across={false}
              size={sideW}
              measure={() => sideCell.current?.offsetWidth ?? 360}
              min={() => 260}
              max={() => Math.min(900, innerWidth * 0.6)}
              set={setSideW}
              className="pointer-events-auto -left-[7px]"
            />
          </div>
        </div>
        <audio ref={bind("audio")} preload="auto" />
      </TooltipProvider>
    </Toaster>
  );
}
