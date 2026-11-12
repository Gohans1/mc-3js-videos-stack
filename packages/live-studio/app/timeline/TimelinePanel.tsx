import { useLayoutEffect } from "react";

// The timeline canvases share one time axis and scroll container; overlays sit above the main Camera track.
// timeline/timeline.ts draws the ruler and the voice and action rows and handles scrubbing, picking and zoom; camera/camrow.ts the camera row (its canvas and menu in CameraTrack.tsx); keys/keyrows.ts the key rows (names in KeyHeads); sound/lanes.ts the tracks (their right-click menu in ClipMenu.tsx), whose names, mute and lock sit in the column on the left (TrackHeads). That column
// runs the whole height so every row shares one time axis. At the right, the master meter (sound/AudioMeter.tsx)
import { cn } from "@/lib/utils";

import { CameraTrack } from "../camera/CameraTrack";
import { LayerTrack } from "../camera/LayerTrack";
import { Splitter, useStoredSize } from "../components/Splitter";
import type { Bind } from "../core/state";
import { useStudio } from "../core/store";
import { KeyHeads } from "../keys/KeyHeads";
import { AudioMeter } from "../sound/AudioMeter";
import { ClipMenu } from "../sound/ClipMenu";
import { TrackHeads } from "../sound/TrackHeads";
import { TextHeads } from "../text/TextHeads";
import { boxPick } from "./rowbox";
import { ROW_MAX, ROW_MIN, rowLayout, RULER_H, setRowLayout } from "./rows";
import { drawTimelines } from "./timeline";
import { TimelineBar } from "./TimelineBar";

// size: the height the creator dragged it to (App), null for the default. As in CapCut only the head stays put (the tools, the
// ruler); every row under the ruler scrolls as one list, and a press on its empty space picks nothing (rowbox.ts clear)
export function TimelinePanel({ bind, size }: { bind: Bind; size: number | null }) {
  const sound = useStudio((s) => s.sound),
    text = useStudio((s) => s.text),
    cam = useStudio((s) => s.cam),
    keys = useStudio((s) => !!s.keyFiles?.length);
  const voiceClips = useStudio((s) => s.voiceClips);
  const [shotsH, setShotsH] = useStoredSize("studio.row.shots"),
    [voiceH, setVoiceH] = useStoredSize("studio.row.voice"),
    [actionH, setActionH] = useStoredSize("studio.row.action");
  const L = rowLayout({ shots: shotsH, voice: voiceH, action: actionH }, sound, cam, !voiceClips);
  const { shots, voice, action, voiceY, actionY, height } = L;
  useLayoutEffect(() => {
    setRowLayout({ shots, voice, action, voiceY, actionY, height });
    drawTimelines();
  }, [shots, voice, action, voiceY, actionY, height]);
  // Each row's bottom edge in the name column sizes it, as a track's edge does in CapCut
  const rows = [
    ...(cam
      ? []
      : [
          {
            label: "Shots",
            y: L.shots / 2,
            edge: L.shots + 1,
            size: shotsH,
            now: L.shots,
            set: setShotsH,
            min: ROW_MIN.shots,
            max: ROW_MAX.shots,
          },
        ]),
    ...(voiceClips
      ? []
      : [
          {
            label: "Voice",
            y: L.voiceY + L.voice / 2,
            edge: L.actionY - 1,
            size: voiceH,
            now: L.voice,
            set: setVoiceH,
            min: ROW_MIN.voice,
            max: ROW_MAX.voice,
          },
        ]),
    {
      label: "Action",
      y: L.actionY + L.action / 2,
      edge: L.actionY + L.action,
      size: actionH,
      now: L.action,
      set: setActionH,
      min: ROW_MIN.action,
      max: ROW_MAX.action,
    },
  ];
  return (
    <div
      ref={bind("timeline")}
      className={cn(
        "bg-background upright:mt-0 sideways:mt-0 relative col-[1/-1] row-start-3 mt-1.5 grid h-[var(--edit-h,max(20rem,42dvh))] min-w-0 grid-cols-[7.5rem_minmax(0,1fr)_auto] grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden rounded-lg px-3 pt-2 pb-3 select-none in-data-review:hidden",
        "upright:h-auto upright:flex-none upright:grid-cols-[5.5rem_minmax(0,1fr)] upright:grid-rows-none upright:overflow-visible upright:rounded-none upright:pt-0 sideways:col-[1] sideways:block sideways:h-auto sideways:rounded-none sideways:pt-0 sideways:pb-1.5",
        size === 0 ? "pb-0" : "upright:min-h-0 sideways:min-h-0 min-h-72",
      )}
    >
      <TimelineBar />
      <span aria-hidden className="bg-background sideways:hidden rounded-tl-md" />
      <canvas
        ref={bind("ruler")}
        title="Time: click or drag to jump, Ctrl+scroll to zoom"
        aria-label="Time ruler: click or drag to jump, Ctrl+scroll to zoom"
        style={{ "--ruler-h": `${RULER_H}px` }}
        className="sideways:rounded-md block h-(--ruler-h) w-full cursor-ew-resize touch-none rounded-tr-md"
      />
      <div
        data-tracks-scroll
        onPointerDown={(e) => {
          if (
            e.button === 0 &&
            e.currentTarget.contains(e.target as Node) &&
            !(e.target as Element).closest("button, input, canvas, [role=separator]")
          )
            boxPick.clear();
        }}
        className="sideways:hidden upright:max-h-86 relative col-span-2 grid min-h-0 grid-cols-subgrid content-start overflow-x-hidden overflow-y-auto overscroll-contain rounded-b-md"
      >
        <LayerTrack />
        {/* Always in the page, so the engine has their canvases from the start; shown once the film turns out to have them */}
        <div className={cn("col-span-2 mt-1 grid grid-cols-subgrid", !text && "hidden")}>
          <TextHeads />
          <canvas
            ref={bind("textrow")}
            aria-label="Text tracks: click an item to edit it, drag to move or retime it, drag its edges to trim, drag on empty space to select several"
            className="block w-full touch-none"
          />
        </div>
        <div className={cn("col-span-2 mt-1 grid grid-cols-subgrid", !cam && "hidden")}>
          <span className="border-track-line bg-track-head text-ui text-label self-stretch border-e ps-1.5 leading-12 font-medium">
            Camera
          </span>
          <CameraTrack bind={bind} shown={cam} />
        </div>
        <div className={cn("col-span-2 grid grid-cols-subgrid", (cam || text) && "mt-1")}>
          <div className="border-track-line bg-track-head text-ui text-label relative border-e font-medium">
            {rows.map((r) => (
              <div key={r.label}>
                <span
                  aria-hidden
                  style={{ "--y": `${r.y}px` }}
                  className="absolute top-(--y) -translate-y-1/2 ps-1.5"
                >
                  {r.label}
                </span>
                <div
                  style={{ "--y": `${r.edge}px` }}
                  className="border-background absolute inset-x-0 top-(--y) border-b"
                >
                  <Splitter
                    label={`${r.label} row height`}
                    across
                    before
                    fold={false}
                    step={4}
                    size={r.size}
                    measure={() => r.now}
                    min={() => r.min}
                    max={() => r.max}
                    set={r.set}
                    lineClassName="right-auto w-[200vw]"
                  />
                </div>
              </div>
            ))}
          </div>
          <canvas
            ref={bind("detail")}
            title={`${voiceClips ? "Action" : "Voice and action"}: click empty space to move the playhead there, drag to select, Ctrl+scroll to zoom`}
            aria-label={`${voiceClips ? "Action row" : "Voice and action rows"}: click empty space to move the playhead there, drag the playhead line to scrub, Ctrl+scroll to zoom`}
            style={{ "--h": `${L.height}px` }}
            className="block h-(--h) w-full touch-none"
          />
        </div>
        <div className={cn("col-span-2 mt-1 grid grid-cols-subgrid", !keys && "hidden")}>
          <KeyHeads />
          <canvas
            ref={bind("keyrows")}
            aria-label="Keyframe tracks for Steve and props: click a diamond to edit it, drag to retime, drag on empty space to select several"
            className="block w-full cursor-default touch-none"
          />
        </div>
        <div className={cn("col-span-2 mt-1 grid grid-cols-subgrid", !sound && "hidden")}>
          <TrackHeads />
          <ClipMenu bind={bind} />
        </div>
        {/* The box dragged over the rows (rowbox.ts), drawn as the rows' own boxes are */}
        <div
          ref={bind("rowbox")}
          aria-hidden
          className="border-primary bg-primary/14 pointer-events-none absolute hidden border"
        />
      </div>
      <AudioMeter />
      {/* CapCut's preview axis, from the ruler down the rows (peek.ts) */}
      <div
        ref={bind("peek")}
        aria-hidden
        hidden
        className="bg-peek pointer-events-none absolute left-0 z-3 w-px -translate-x-px ring-1 ring-black"
      />
      {/* CapCut's snapping line, where a dragged edge meets a mark (snapline.ts) */}
      <div
        ref={bind("snap")}
        aria-hidden
        hidden
        className="bg-snap pointer-events-none absolute left-0 z-3 w-px"
      />
    </div>
  );
}
