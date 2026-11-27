import { useEffect, useLayoutEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Tip } from "../components/Tip";
import { type Bind, S } from "../core/state";
import { set, useStudio } from "../core/store";
import { StageNoteComposer } from "../notes/Compose";
import { InkBar } from "../notes/InkBar";
import { OptionChips } from "../options/OptionChips";
import { reloadNow } from "../playback/transport";
import { FullscreenTransport } from "../shell/FullscreenTransport";
import { BlindAudioCurtain } from "./BlindAudioCurtain";
import { ColorScriptStrip } from "./ColorScript";
import { AngleGrid, CompareOverlay } from "./Compare";
import {
  handleCompareReferenceError,
  handleCompareVideoError,
  handleCompareVideoLoadedMetadata,
  loadCompareReferenceAudio,
  syncCompareReferenceAudio,
} from "./compare-video";
import { compareReferenceItem, compareVideoUrl } from "./compare-video-model";
import { CompareVideoBar, CompareVideoEmpty } from "./CompareVideoBar";
import { valueCheckLabel } from "./director-eye";
import { ExposureLegend } from "./ExposureLegend";
import { FilmView } from "./FilmView";
import { FreeCameraControls } from "./FreeCameraControls";
import { GhostHud, GhostOverlay } from "./GhostOverlay";
import { Guides } from "./Guides";
import { Oscilloscope } from "./Oscilloscope";
import { stageFit } from "./pointer";
import { ShotList } from "./ShotList";

function Badges() {
  const free = useStudio((s) => s.free),
    final = useStudio((s) => s.final),
    night = useStudio((s) => s.nightVision),
    valueCheck = useStudio((s) => s.valueCheck),
    muted = useStudio((s) => s.muted),
    compareVideoMode = useStudio((s) => s.compareVideoMode);
  const contract = useStudio((s) => s.contract.length),
    status = useStudio((s) => s.status),
    newBuild = useStudio((s) => s.newBuild);
  return (
    <div className="upright:mr-25 upright:min-h-5.5 sideways:mr-25 sideways:min-h-5.5 mr-45 flex min-h-8.5 flex-wrap items-start gap-1.5 self-stretch">
      {!compareVideoMode && free && (
        <Badge variant="alarm" render={<b />}>
          FREE CAMERA
        </Badge>
      )}
      {!compareVideoMode && free && night && (
        <Badge variant="alarm" render={<b />}>
          NIGHT VISION
        </Badge>
      )}
      {!compareVideoMode && final && (
        <Badge variant="alarm" render={<b />}>
          FINAL QUALITY
        </Badge>
      )}
      {valueCheck !== "off" && (
        <Badge
          variant="check"
          render={<b />}
          title="Viewport value check only — film grade and renders are unchanged"
        >
          {valueCheckLabel(valueCheck)}
        </Badge>
      )}
      {muted && (
        <Badge variant="check" render={<b />} title="Audio muted for picture-only review (Alt+M)">
          MUTED
        </Badge>
      )}
      {contract > 0 && (
        <Badge variant="alarm" render={<b />}>
          FILM CONTRACT ERRORS ({contract})
        </Badge>
      )}
      {newBuild && (
        <Tip label="The film's code changed. Reloads at this second; your draft note stays">
          <Button size="md" className="pointer-events-auto h-7" onClick={reloadNow}>
            New version · Reload
          </Button>
        </Tip>
      )}
      <span
        role="status"
        className="bg-scrim-strong max-w-full truncate rounded-md px-2 py-px text-xs empty:hidden"
      >
        {status}
      </span>
    </div>
  );
}

function PreviewStartup({ status }: { status: string }) {
  const [elapsed, setElapsed] = useState(() => Math.floor(performance.now() / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(Math.floor(performance.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="pointer-events-none absolute inset-0 z-4 grid place-items-center px-4">
      <div className="bg-popover text-popover-foreground border-border w-full max-w-66 rounded-lg border px-4 py-3 shadow-lg">
        <p role="status" className="text-sm font-medium">
          {status}
        </p>
        <div className="mt-2 flex items-center gap-3" aria-hidden="true">
          <div className="bg-muted h-0.5 flex-1 overflow-hidden rounded-full">
            <div className="bg-primary h-full w-1/2 motion-safe:animate-pulse" />
          </div>
          <span className="text-muted-foreground text-xs tabular-nums">{elapsed}s</span>
        </div>
      </div>
    </div>
  );
}

export function Stage({ bind, phone = false }: { bind: Bind; phone?: boolean }) {
  const loading = useStudio((s) => s.loading),
    ready = useStudio((s) => s.ready),
    error = useStudio((s) => s.error);
  const ink = useStudio((s) => s.ink),
    free = useStudio((s) => s.free);
  const compareVideoMode = useStudio((s) => s.compareVideoMode);
  const compareVideos = useStudio((s) => s.compareCatalog.videos);
  const compareVideoPath = useStudio((s) =>
    s.compareVideo.status === "none" ? null : s.compareVideo.path,
  );
  const preferredReference = useStudio((s) => s.compareCatalog.canBuild.ref);
  const compareVideoMeta = useStudio((s) =>
    s.compareVideo.status === "loading" || s.compareVideo.status === "ready"
      ? s.compareVideo.meta
      : null,
  );
  const activeCompareItem =
    compareVideoMode && compareVideoPath
      ? (compareVideos.find((v) => v.path === compareVideoPath) ?? null)
      : null;
  const compareVideoSrc =
    !phone && activeCompareItem ? compareVideoUrl(activeCompareItem) : undefined;
  const reference = !phone
    ? compareReferenceItem(activeCompareItem, compareVideos, preferredReference)
    : null;
  const referencePath = reference?.path;
  const referenceSrc = reference ? compareVideoUrl(reference) : undefined;
  useEffect(() => {
    if (!referenceSrc || !referencePath) {
      S.el?.compareReferenceAudio?.load();
      return;
    }
    const controller = new AbortController();
    void loadCompareReferenceAudio(referencePath, referenceSrc, controller.signal);
    return () => controller.abort();
  }, [referencePath, referenceSrc]);
  useEffect(() => {
    if (compareVideoSrc) return;
    const video = S.el?.compareVideo;
    if (!video || (!video.getAttribute("src") && video.readyState === 0)) return;
    video.pause();
    video.removeAttribute("src");
    video.load();
  }, [compareVideoSrc]);
  const savedPreview = useStudio((s) => s.preview);
  const preview = phone ? null : savedPreview;
  const mode = useStudio((s) => s.filmView);
  const split = !phone && !compareVideoMode && free && mode === "split";
  const clean = !!preview?.clean;
  useLayoutEffect(stageFit, [
    split,
    compareVideoMode,
    compareVideoPath,
    compareVideoMeta?.width,
    compareVideoMeta?.height,
  ]);
  const pickingCamera = useStudio((s) => s.cameraPick !== null);
  const pickFocus = useStudio((s) => s.pickFocus !== null);
  const valueCheck = useStudio((s) => s.valueCheck);
  const blindAudio = useStudio((s) => s.blindAudio);
  return (
    <div
      className={
        phone
          ? "portrait:phone-picture-h relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-black portrait:aspect-(--frame) portrait:w-full portrait:flex-initial landscape:flex-1"
          : "bg-background upright:rounded-none sideways:rounded-none upright:bg-black sideways:bg-black upright:aspect-(--frame) upright:max-h-[62vh] upright:w-full upright:flex-none relative col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-t-lg in-data-cli-expanded:hidden in-data-inspector-active:hidden in-data-lessons-focused:hidden in-data-review:col-start-2 in-data-wide:col-start-2"
      }
    >
      {!phone && (
        <svg aria-hidden className="pointer-events-none absolute size-0 overflow-hidden">
          <defs>
            <filter
              id="director-eye-rec709"
              x="0%"
              y="0%"
              width="100%"
              height="100%"
              colorInterpolationFilters="sRGB"
            >
              <feColorMatrix
                type="matrix"
                values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0"
              />
            </filter>
            <filter
              id="director-eye-silhouette"
              x="0%"
              y="0%"
              width="100%"
              height="100%"
              colorInterpolationFilters="sRGB"
            >
              <feColorMatrix
                type="matrix"
                values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0"
              />
              <feComponentTransfer>
                <feFuncR type="linear" slope={3.6} intercept={-1.3} />
                <feFuncG type="linear" slope={3.6} intercept={-1.3} />
                <feFuncB type="linear" slope={3.6} intercept={-1.3} />
              </feComponentTransfer>
            </filter>
          </defs>
        </svg>
      )}
      {!phone && compareVideoMode && !clean && <CompareVideoBar />}
      {!phone && (
        <audio
          ref={bind("compareReferenceAudio")}
          src={referenceSrc}
          preload="metadata"
          onLoadedMetadata={() => syncCompareReferenceAudio()}
          onSeeked={() => syncCompareReferenceAudio()}
          onError={(e) => handleCompareReferenceError(e.currentTarget)}
        />
      )}
      <div
        ref={bind("view")}
        className="@container relative flex min-h-0 w-full flex-1 items-center justify-center"
      >
        <div
          data-preview-pane
          className={cn(
            "flex h-full min-h-0 min-w-0 flex-none items-center justify-center overflow-hidden",
            split ? "mr-auto w-1/2" : "w-full",
          )}
        >
          <div
            ref={bind("stage")}
            data-clean={clean || undefined}
            data-compare-video-mode={compareVideoMode || undefined}
            data-preview-mirror={preview?.mirror || undefined}
            className={cn(
              "bg-stage @container relative flex-none [transform:var(--preview-transform)] overflow-hidden",
              clean && "[&_[data-studio-overlay]]:hidden",
            )}
            style={
              preview
                ? {
                    "--preview-transform":
                      "translate(" +
                      preview.panX +
                      "px," +
                      preview.panY +
                      "px) scale(" +
                      (preview.zoom * (preview.mirror ? -1 : 1)) / 100 +
                      "," +
                      preview.zoom / 100 +
                      ")",
                  }
                : undefined
            }
          >
            <div
              data-value-check={!phone && !clean && valueCheck !== "off" ? valueCheck : undefined}
              className="absolute inset-0"
            >
              {!phone && (
                <video
                  ref={bind("compareVideo")}
                  data-compare-path={activeCompareItem?.path}
                  src={compareVideoSrc}
                  playsInline
                  preload="auto"
                  crossOrigin="anonymous"
                  onLoadedMetadata={(e) => {
                    handleCompareVideoLoadedMetadata(e.currentTarget);
                    stageFit();
                  }}
                  onSeeked={() => {
                    if (compareVideoMode && !S.playing) S.dirty = true;
                  }}
                  onError={(e) => handleCompareVideoError(e.currentTarget)}
                  className={cn(
                    "pointer-events-none absolute inset-0 block size-full object-fill",
                    (!compareVideoMode || !compareVideoSrc) && "hidden",
                  )}
                />
              )}
              <canvas
                ref={bind("canvas")}
                className={cn(
                  "absolute inset-0 block size-full touch-none",
                  preview && preview.zoom > 100 && "[image-rendering:pixelated]",
                  compareVideoMode
                    ? "cursor-crosshair opacity-0"
                    : pickingCamera || pickFocus
                      ? "cursor-crosshair"
                      : free
                        ? "cursor-grab"
                        : "cursor-default",
                )}
              />
              <canvas
                ref={bind("final")}
                hidden
                className={cn(
                  "pointer-events-none absolute inset-0 block size-full",
                  preview && preview.zoom > 100 && "[image-rendering:pixelated]",
                  compareVideoMode && "hidden",
                )}
              />
              <canvas
                ref={bind("shutter")}
                hidden
                className={cn(
                  "pointer-events-none absolute inset-0 block size-full",
                  preview && preview.zoom > 100 && "[image-rendering:pixelated]",
                  compareVideoMode && "hidden",
                )}
              />
              {!phone && !clean && !compareVideoMode && <GhostOverlay />}
            </div>
            <canvas
              ref={bind("inspection")}
              hidden={compareVideoMode || !preview || clean || preview.layers === "off"}
              className="pointer-events-none absolute inset-0 size-full [image-rendering:pixelated]"
            />
            {!clean && !compareVideoMode && <Guides />}
            {!clean && !compareVideoMode && <CompareOverlay />}
            <div
              ref={bind("horizon")}
              hidden={compareVideoMode || !preview?.horizon || clean}
              data-horizon
              className="viewport-horizon data-level:bg-primary pointer-events-none absolute top-1/2 left-1/2 z-6 h-0.5 w-1/4 bg-white shadow-sm"
              aria-label="Horizon level"
            />
            <div
              ref={bind("textsel")}
              hidden={compareVideoMode}
              data-studio-overlay
              data-text-selection
              aria-hidden
              className="pointer-events-none absolute inset-0 z-3 *:absolute *:inset-0 *:size-full *:overflow-visible"
            />
            <div
              ref={bind("pins")}
              data-studio-overlay
              className="pointer-events-none absolute inset-0 z-4 overflow-hidden"
            />
            <svg
              data-studio-overlay
              data-page-selection
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-0 z-3 size-full overflow-visible",
                compareVideoMode && "hidden",
              )}
            >
              <polygon fill="none" stroke="var(--picture)" strokeWidth="1.5" />
            </svg>
            <canvas
              ref={bind("ink")}
              data-studio-overlay
              className={cn(
                "absolute inset-0 z-5 block size-full touch-none",
                ink ? "cursor-crosshair" : "pointer-events-none",
              )}
            />
            <div data-studio-overlay className={cn("stage-caption", compareVideoMode && "hidden")}>
              <span ref={bind("caption")} className="stage-caption-text" />
            </div>
          </div>
        </div>
        {!phone && compareVideoMode && <CompareVideoEmpty />}
        {!phone && <StageNoteComposer />}
        {!phone && !clean && <InkBar />}
        {!phone && !clean && !compareVideoMode && <AngleGrid />}
        {!phone && !clean && !compareVideoMode && <ShotList />}
        {!phone && !clean && !compareVideoMode && <ExposureLegend />}
        <div ref={bind("clock")} hidden={phone || clean} className="stage-clock">
          00:00.000
        </div>
        <div className="upright:inset-x-1.5 upright:top-1.5 sideways:inset-x-1.5 sideways:top-1.5 pointer-events-none absolute inset-x-2.5 top-2.5 z-2 flex flex-col items-start gap-1">
          <div
            ref={bind("hud")}
            hidden={phone || clean || compareVideoMode}
            className="stage-hud"
          />
          {!phone && !clean && <Badges />}
        </div>
        <div hidden={phone || compareVideoMode} className="contents">
          <div hidden={clean} className="contents">
            <OptionChips ref={bind("chips")} />
          </div>
          <FilmView bind={bind} phone={phone} />
        </div>
        {!phone && !clean && !compareVideoMode && <FreeCameraControls />}
        <canvas
          ref={bind("minimap")}
          hidden={compareVideoMode || !preview?.minimap || clean}
          aria-label="Camera minimap, top view with world axes"
          className="bg-scrim-strong border-border pointer-events-none absolute top-24 right-3 z-4 size-28 rounded-lg border"
        />
        {!phone && !clean && !compareVideoMode && <GhostHud />}
        {!phone && <BlindAudioCurtain />}
        {!phone && <FullscreenTransport />}
        {loading && !ready && !compareVideoMode && <PreviewStartup status={loading} />}
        {!phone && loading && ready && (
          <div
            role="status"
            className="bg-scrim absolute top-12.5 left-3 z-2 rounded-md px-2 py-0.5"
          >
            {loading}
          </div>
        )}
      </div>
      <div hidden={blindAudio} className="contents">
        {!phone && <ColorScriptStrip />}
        <div hidden={phone || compareVideoMode} className="contents">
          <Oscilloscope bind={bind} />
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="bg-alarm-bg absolute inset-3 z-5 flex flex-col gap-2 rounded-lg p-3"
        >
          <pre className="min-h-0 flex-1 overflow-auto font-mono text-xs whitespace-pre-wrap">
            {error}
          </pre>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => location.reload()}>
              Reload
            </Button>
            <Button variant="outline" size="sm" onClick={() => set({ error: null })}>
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
