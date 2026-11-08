import { type CSSProperties, useEffect, useRef } from "react";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { start } from "./start";
import type { Bind, Elements } from "./core/state";
import { set, showError } from "./core/store";
import { Library, Side, useEditable, useWide } from "./shell/Side";
import { Splitter, useStoredSize } from "./components/Splitter";
import { Stage } from "./picture/Stage";
import { TimelinePanel } from "./timeline/TimelinePanel";
import { PasteAttributes } from "./timeline/PasteAttributes";
import { Transport } from "./shell/Transport";
import { useStudioHotkeys } from "./shell/useStudioHotkeys";

let started = false;

// A button keeps focus after a mouse click, and Space would then press it instead of playing. From the keyboard focus stays,
// so Space presses the control as usual. A popup trigger keeps focus while its popup is open: the popup needs it
const dropClickFocus = (e: MouseEvent) => {
  if (!e.detail) return;
  // Judged once the browser is done with the click: a label passes it on to its switch, which takes focus only then. By that
  // time React has drawn the result too, so a trigger whose popup this click closed shows aria-expanded="false"
  setTimeout(() => {
    const at = document.activeElement;
    if (at instanceof HTMLElement && at.matches("button, summary, [role=tab], [role=switch], [role=checkbox], [role=radio]") && !at.matches("[aria-haspopup][aria-expanded=true]")) at.blur();
  });
};

export function App() {
  const el = useRef({} as Elements);
  const bind: Bind = (key) => (node) => { if (node) el.current[key] = node; };
  useStudioHotkeys();
  const [sideW, setSideW] = useStoredSize("studio.sideWidth"), [editH, setEditH] = useStoredSize("studio.timelineHeight"), [libW, setLibW] = useStoredSize("studio.libWidth");
  const sideCell = useRef<HTMLDivElement>(null), libCell = useRef<HTMLDivElement>(null);
  const editable = useEditable(), wide = useWide() && editable; // three columns only when there is something to show details of
  const px = (n: number | null) => (n === null ? undefined : `${n}px`);
  const room = { "--side-w": px(sideW), "--lib-w": px(libW), "--edit-h": px(editH) } as CSSProperties;
  useEffect(() => {
    if (started) return;
    started = true;
    start(el.current).catch((e: Error) => { showError(e); set({ loading: "" }); });
    addEventListener("click", dropClickFocus);
    // A slider keeps focus after a drag too, and its arrows would then move it instead of stepping the film
    addEventListener("pointerup", () => { const at = document.activeElement; if (at instanceof HTMLInputElement && at.type === "range") at.blur(); });
    // Chrome reports a ResizeObserver that skipped a frame as an error; it isn't one
    addEventListener("error", (e) => { if (!e.message.startsWith("ResizeObserver loop")) showError(e.error ?? e.message); });
    addEventListener("unhandledrejection", (e) => showError(e.reason));
  }, []);
  return (
    <Toaster limit={3}>
      <TooltipProvider delay={500}>
      <div
        style={room}
        data-side-folded={sideW === 0 || undefined}
        data-lib-folded={(wide && libW === 0) || undefined}
        data-wide={wide || undefined}
        className="grid h-dvh grid-cols-[minmax(0,1fr)_var(--side-w,360px)] grid-rows-[minmax(0,1fr)_auto_auto] gap-x-1.5 bg-backdrop p-1.5 text-sm upright:gap-0 upright:bg-background upright:p-0 sideways:gap-0 sideways:bg-background sideways:p-0 upright:flex upright:flex-col sideways:grid-cols-[minmax(0,1fr)_min(36%,320px)] data-wide:grid-cols-[var(--lib-w,400px)_minmax(0,1fr)_var(--side-w,340px)]"
      >
        <Stage bind={bind} />
        <Transport />
        <TimelinePanel bind={bind} size={editH} />
        {wide && <Library />}
        <Side wide={wide} />
        <PasteAttributes />
        {/* CapCut's layout: picture and its controls with the details column beside them, the timeline across the whole width */}
        <div className="pointer-events-none relative col-[1/-1] row-start-3 upright:hidden sideways:hidden">
          <Splitter
            label="Timeline height"
            across
            size={editH}
            measure={() => el.current.timeline?.getBoundingClientRect().height ?? 0}
            min={() => { const t = el.current.timeline, list = t?.querySelector<HTMLElement>("[data-tracks-scroll]"); return t && list ? list.getBoundingClientRect().top - t.getBoundingClientRect().top + 64 + 12 : 300; }} // the head that stays put and two rows
            max={() => innerHeight - 220}
            set={setEditH}
            className="pointer-events-auto -top-px" // the middle of the gap over the timeline
          />
        </div>
        {wide && (
          <div ref={libCell} className="pointer-events-none relative col-start-1 row-span-2 row-start-1">
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
        <div ref={sideCell} className="pointer-events-none relative col-start-2 row-span-2 row-start-1 upright:hidden sideways:hidden in-data-wide:col-start-3">
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
