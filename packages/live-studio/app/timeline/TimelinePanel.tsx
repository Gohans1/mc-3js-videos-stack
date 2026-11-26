import { useLayoutEffect } from "react";

import { cn } from "@/lib/utils";

import { useLitAny } from "../activity/activity";
import { CameraTrack } from "../camera/CameraTrack";
import { LayerTrack } from "../camera/LayerTrack";
import { Splitter, useStoredSize } from "../components/Splitter";
import { sanitizeStoredSize } from "../components/splitter-layout";
import type { Bind } from "../core/state";
import { useStudio } from "../core/store";
import { KeyHeads } from "../keys/KeyHeads";
import { OpenFilmTrack } from "../openfilm/Track";
import { AudioMeter } from "../sound/AudioMeter";
import { ClipMenu } from "../sound/ClipMenu";
import { TrackHeads } from "../sound/TrackHeads";
import { TextHeads } from "../text/TextHeads";
import { ROW_MAX, ROW_MIN, rowLayout, RULER_H, setRowLayout } from "./rows";
import { drawTimelines, invalidateRects } from "./timeline";
import { TimelineBar } from "./TimelineBar";

const clampRowHeight = (v: number | null, min: number, max: number) => {
  const s = sanitizeStoredSize(v, min, false);
  return s === null ? null : Math.min(max, s);
};

export function TimelinePanel({ bind }: { bind: Bind }) {
  const sound = useStudio((s) => s.sound),
    layers = useStudio((s) => s.layers),
    text = useStudio((s) => s.text),
    cam = useStudio((s) => s.cam),
    keys = useStudio((s) => !!s.keyFiles?.length);
  const cameraLit = useLitAny(["tab:cam", "tab:speed", "tab:transition"]);
  const voiceClips = useStudio((s) => s.voiceClips);
  const [rawShotsH, setShotsH] = useStoredSize("studio.row.shots"),
    [rawVoiceH, setVoiceH] = useStoredSize("studio.row.voice"),
    [rawActionH, setActionH] = useStoredSize("studio.row.action");
  const shotsH = clampRowHeight(rawShotsH, ROW_MIN.shots, ROW_MAX.shots),
    voiceH = clampRowHeight(rawVoiceH, ROW_MIN.voice, ROW_MAX.voice),
    actionH = clampRowHeight(rawActionH, ROW_MIN.action, ROW_MAX.action);
  const L = rowLayout({ shots: shotsH, voice: voiceH, action: actionH }, sound, cam, !voiceClips);
  const { shots, voice, action, voiceY, actionY, height } = L;
  useLayoutEffect(() => {
    invalidateRects();
    setRowLayout({ shots, voice, action, voiceY, actionY, height });
    drawTimelines();
  }, [shots, voice, action, voiceY, actionY, height, layers, text, cam, keys, sound]);
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
        "bg-background upright:mt-0 sideways:mt-0 relative col-[1/-1] row-start-3 mt-1.5 h-[min(var(--edit-h,max(20rem,42dvh)),var(--edit-max,calc(100dvh-220px)))] min-h-0 min-w-0 overflow-hidden rounded-lg select-none in-data-cli-expanded:hidden in-data-cli-side:col-[1] in-data-edit-folded:hidden in-data-inspector-active:hidden in-data-lessons-focused:hidden in-data-review:hidden in-data-wide:col-[2/-1]",
        "upright:h-auto upright:flex-none upright:overflow-visible upright:rounded-none upright:in-data-inspector-active:hidden sideways:col-[1] sideways:h-auto sideways:rounded-none",
      )}
    >
      <div
        className={cn(
          "grid size-full min-h-0 min-w-0 grid-cols-[8.75rem_minmax(0,1fr)_auto] grid-rows-[auto_auto_minmax(0,1fr)] px-3 pt-2 pb-2",
          "upright:h-auto upright:grid-cols-[5.5rem_minmax(0,1fr)] upright:grid-rows-none upright:pt-0 sideways:block sideways:h-auto sideways:pt-0 sideways:pb-1.5",
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
          className="sideways:hidden upright:max-h-24 relative col-span-2 grid min-h-0 grid-cols-subgrid content-start overflow-x-hidden overflow-y-auto overscroll-contain rounded-b-md pb-1"
        >
          <LayerTrack />
          <OpenFilmTrack />
          <div className={cn("col-span-2 mt-1 grid grid-cols-subgrid", !text && "hidden")}>
            <TextHeads />
            <canvas
              ref={bind("textrow")}
              aria-label="Text tracks: click an item to edit it, drag to move or retime it, drag its edges to trim, drag on empty space to select several"
              className="block w-full touch-none"
            />
          </div>
          <div className={cn("col-span-2 mt-1 grid grid-cols-subgrid", !cam && "hidden")}>
            <span
              data-ai-lit={cameraLit || undefined}
              className="border-track-line bg-track-head text-ui text-label self-stretch border-e ps-1.5 leading-12 font-medium"
            >
              Camera
            </span>
            <CameraTrack bind={bind} shown={cam} />
          </div>
          <div
            className={cn("col-span-2 grid grid-cols-subgrid", (layers || cam || text) && "mt-1")}
          >
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
              title={`${voiceClips ? "Action" : "Voice and action"}: click to move the playhead there, drag to select, Ctrl+scroll to zoom`}
              aria-label={`${voiceClips ? "Action row" : "Voice and action rows"}: click to move the playhead there, drag the playhead line to scrub, Ctrl+scroll to zoom`}
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
          <div
            ref={bind("rowbox")}
            aria-hidden
            className="border-primary bg-primary/14 pointer-events-none absolute hidden border"
          />
        </div>
        <AudioMeter />
      </div>
      <div
        ref={bind("ai")}
        aria-hidden
        hidden
        className="pointer-events-none absolute left-0 z-1 overflow-hidden"
      />
      <div
        ref={bind("playhead")}
        aria-hidden
        hidden
        className="pointer-events-none absolute left-0 z-2 bg-(--playhead)"
      />
      <div
        ref={bind("peek")}
        aria-hidden
        hidden
        className="bg-peek ring-stage pointer-events-none absolute left-0 z-3 w-px -translate-x-px ring-1"
      />
      <div
        ref={bind("snap")}
        aria-hidden
        hidden
        className="bg-snap pointer-events-none absolute left-0 z-3 w-px"
      />
    </div>
  );
}
