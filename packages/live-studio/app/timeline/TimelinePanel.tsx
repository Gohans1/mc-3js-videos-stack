// The timeline canvases: the whole film, the stretch around the playhead, and under it the camera keys, the film's other keys
// (Steve, props) and the sound tracks the creator edits by hand. timeline/timeline.ts draws the first two and handles scrubbing,
// picking and zoom; camera/camrow.ts the camera row (its canvas and menu in CameraTrack.tsx); keys/keyrows.ts the key rows (names in KeyHeads); sound/lanes.ts the tracks (their right-click menu in ClipMenu.tsx), whose names, mute and lock sit in the column on the left (TrackHeads). That column
// runs the whole height so every row shares one time axis. At the right, the master meter (sound/AudioMeter.tsx)
import { cn } from "cn";
import { useLayoutEffect } from "react";
import type { Bind } from "../core/state";
import { ROW_MAX, ROW_MIN, RULER_H, rowLayout, setRowLayout, WORDS_H } from "./rows";
import { useStudio } from "../core/store";
import { CameraTrack } from "../camera/CameraTrack";
import { drawTimelines } from "./timeline";
import { KeyHeads } from "../keys/KeyHeads";
import { Splitter, useStoredSize } from "../components/Splitter";
import { TimelineBar } from "./TimelineBar";
import { TrackHeads } from "../sound/TrackHeads";
import { ClipMenu } from "../sound/ClipMenu";
import { AudioMeter } from "../sound/AudioMeter";
import { ROW_H } from "../text/textrow";

// size: the height the creator dragged it to (App), null for the default. As in CapCut only the head stays put (the tools, the
// whole film, the ruler); every row under the ruler (shots, voice, action, camera, keys, sound tracks) scrolls as one list
export function TimelinePanel({ bind, size }: { bind: Bind; size: number | null }) {
  const sound = useStudio((s) => s.sound), text = useStudio((s) => s.text), cam = useStudio((s) => s.cam), keys = useStudio((s) => !!s.keyFiles?.length);
  const [shotsH, setShotsH] = useStoredSize("studio.row.shots"), [voiceH, setVoiceH] = useStoredSize("studio.row.voice"), [actionH, setActionH] = useStoredSize("studio.row.action");
  const L = rowLayout({ shots: shotsH, voice: voiceH, action: actionH }, sound, cam);
  useLayoutEffect(() => { setRowLayout(L); drawTimelines(); }, [L.shots, L.voice, L.action, L.height]);
  // Each row's bottom edge in the name column sizes it, as a track's edge does in CapCut
  const rows = [
    ...cam ? [] : [{ label: "Shots", y: L.shots / 2, edge: L.shots + 1, size: shotsH, now: L.shots, set: setShotsH, min: ROW_MIN.shots, max: ROW_MAX.shots }],
    { label: "Voice", y: L.voiceY + (L.voice - WORDS_H) / 2, edge: L.actionY - 1, size: voiceH, now: L.voice, set: setVoiceH, min: ROW_MIN.voice, max: ROW_MAX.voice },
    { label: "Action", y: L.actionY + 7, edge: L.actionY + L.action, size: actionH, now: L.action, set: setActionH, min: ROW_MIN.action, max: ROW_MAX.action },
  ];
  return (
    <div
      ref={bind("timeline")}
      className={cn(
        "relative col-[1/-1] row-start-3 grid h-[var(--edit-h,max(20rem,42dvh))] min-w-0 select-none grid-cols-[7.5rem_minmax(0,1fr)_auto] grid-rows-[auto_auto_auto_minmax(0,1fr)] overflow-hidden border-t px-3 pt-2 pb-3",
        "upright:h-auto upright:flex-none upright:grid-cols-[5.5rem_minmax(0,1fr)] upright:grid-rows-none upright:overflow-visible upright:border-t-0 upright:pt-0 sideways:col-[1] sideways:block sideways:h-auto sideways:border-t-0 sideways:pt-0 sideways:pb-1.5",
        size === 0 ? "pb-0" : "min-h-72 upright:min-h-0 sideways:min-h-0",
      )}
    >
      <TimelineBar />
      <span className="mb-1.5 self-center ps-1.5 text-[13px] font-medium text-label sideways:hidden">Overview</span>
      <canvas ref={bind("over")} title="Whole film: click or drag to jump" aria-label="Whole film: click or drag to jump" className="mb-1.5 block h-6 w-full cursor-ew-resize touch-none rounded-md pointer-coarse:h-7 sideways:mb-0" />
      <span aria-hidden className="rounded-tl-md bg-background sideways:hidden" />
      <canvas ref={bind("ruler")} title="Time: click or drag to jump, Ctrl+scroll to zoom" aria-label="Time ruler: click or drag to jump, Ctrl+scroll to zoom" style={{ height: RULER_H }} className="block w-full cursor-ew-resize touch-none rounded-tr-md sideways:hidden" />
      <div data-tracks-scroll className="relative col-span-2 grid min-h-0 grid-cols-subgrid content-start overflow-x-hidden overflow-y-auto overscroll-contain rounded-b-md sideways:hidden upright:max-h-86">
        <div className="relative bg-background text-[13px] font-medium text-label">
          {rows.map((r) => (
            <div key={r.label}>
              <span aria-hidden style={{ top: r.y }} className="absolute -translate-y-1/2 ps-1.5">{r.label}</span>
              <div style={{ top: r.edge }} className="absolute inset-x-0">
                <Splitter label={`${r.label} row height`} across before fold={false} step={4} size={r.size} measure={() => r.now} min={() => r.min} max={() => r.max} set={r.set} lineClassName="right-auto w-[200vw]" />
              </div>
            </div>
          ))}
        </div>
        <canvas ref={bind("detail")} title="Around the playhead: drag the playhead line to scrub, click the ruler to jump, Ctrl+scroll to zoom" aria-label="Around the playhead: drag the playhead line to scrub, click the ruler to jump, Ctrl+scroll to zoom" style={{ height: L.height }} className="block w-full touch-none" />
        {/* Always in the page, so the engine has their canvases from the start; shown once the film turns out to have them.
            CapCut's text tracks sit over its main track, as here over the camera row */}
        <div className={cn("col-span-2 grid grid-cols-subgrid border-t border-black", !text && "hidden")}>
          <span style={{ lineHeight: `${ROW_H}px` }} className="self-end bg-background ps-1.5 text-[13px] font-medium text-label">Text</span>
          <canvas ref={bind("textrow")} aria-label="Text tracks: click an item to edit it, drag to move or retime it, drag its edges to trim, drag on empty space to select several" className="block w-full touch-none" />
        </div>
        <span className={cn("self-center border-t border-black bg-background ps-1.5 text-[13px] leading-12 font-medium text-label", !cam && "hidden")}>Camera</span>
        <CameraTrack bind={bind} shown={cam} />
        <div className={cn("col-span-2 grid grid-cols-subgrid border-t border-black", !keys && "hidden")}>
          <KeyHeads />
          <canvas
            ref={bind("keyrows")}
            aria-label="Keyframe tracks for Steve and props: click a diamond to edit it, drag to retime, drag on empty space to select several"
            className="block w-full touch-none"
          />
        </div>
        <div className={cn("col-span-2 grid grid-cols-subgrid border-t border-black", !sound && "hidden")}>
          <TrackHeads />
          <ClipMenu bind={bind} />
        </div>
        {/* The box dragged from the Shots row down to the Camera row (rowbox.ts), drawn as the rows' own boxes are */}
        <div ref={bind("rowbox")} aria-hidden className="pointer-events-none absolute hidden border border-primary bg-primary/14" />
      </div>
      <AudioMeter />
      {/* CapCut's preview axis, from the ruler down the rows (peek.ts) */}
      <div ref={bind("peek")} aria-hidden hidden className="pointer-events-none absolute left-0 z-3 w-px -translate-x-px bg-peek shadow-[0_0_0_1px_#000]" />
    </div>
  );
}
