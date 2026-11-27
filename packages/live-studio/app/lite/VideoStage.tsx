import { AlertCircle, Columns2, RefreshCw } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { activeStageNotes, type PinLike, resolvePinLayout } from "../notes/pinfade.ts";
import {
  compareStageAspect,
  compareVideoUrl,
  composeMatchesStageSpace,
  noteMatchesStageSpace,
} from "../picture/compare-video-model.ts";
import { drawInkCanvas, type SavedInkEntry } from "./ink.ts";
import { inkSpan, noteState } from "./model.ts";
import { playback } from "./playback.ts";
import { createStagePointerHandler } from "./stage-pointer.ts";
import {
  lite,
  liteCatalogErrorOf,
  liteCatalogLoadedOf,
  liteCatalogVideosOf,
  liteComposeOf,
  liteDraftOf,
  liteInkMarksOf,
  liteInkToolOf,
  liteNoteSavingOf,
  liteVideoErrorOf,
  liteVideoMetaOf,
  liteVideoPathOf,
  liteVideoReloadSeqOf,
  useLite,
} from "./store.ts";
import type { Mark } from "./types.ts";

export function VideoStage() {
  const videos = useLite(liteCatalogVideosOf);
  const videosLoaded = useLite(liteCatalogLoadedOf);
  const selectedPath = useLite(liteVideoPathOf);
  const videoMeta = useLite(liteVideoMetaOf);
  const videoError = useLite(liteVideoErrorOf);
  const videoReloadSeq = useLite(liteVideoReloadSeqOf);
  const catalogError = useLite(liteCatalogErrorOf);
  const ratio = useLite((s) => s.film.ratio);
  const duration = useLite((s) => s.film.duration);
  const muted = useLite((s) => s.muted);
  const notes = useLite((s) => s.notes);
  const compose = useLite(liteComposeOf);
  const draft = useLite(liteDraftOf);
  const inkMarks = useLite(liteInkMarksOf);
  const inkRev = useLite((s) => s.inkRev);

  const activeItem = useMemo(
    () => videos.find((v) => v.path === selectedPath) ?? null,
    [videos, selectedPath],
  );
  const videoSrc = activeItem ? compareVideoUrl(activeItem) : undefined;
  const matchedMeta = activeItem && videoMeta?.path === activeItem.path ? videoMeta : null;
  const aspect = useMemo(
    () =>
      compareStageAspect(
        activeItem,
        matchedMeta?.width ?? 0,
        matchedMeta?.height ?? 0,
        ratio,
      ),
    [activeItem, matchedMeta?.width, matchedMeta?.height, ratio],
  );

  const viewRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pinsRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const liveMarkRef = useRef<Mark | null>(null);
  const stageSizeRef = useRef({ width: 0, height: 0 });
  const pinCacheRef = useRef<{
    sig: string;
    frameEls: HTMLDivElement[];
    pinEls: HTMLDivElement[];
  }>({ sig: "", frameEls: [], pinEls: [] });
  const pointerHandlerRef = useRef<ReturnType<typeof createStagePointerHandler> | null>(null);

  const savedInkEntries = useMemo<SavedInkEntry[]>(() => {
    const source = activeItem
      ? {
          category: activeItem.category,
          layout: activeItem.layoutExact
            ? activeItem.layout
            : (matchedMeta?.layout ?? activeItem.layout),
        }
      : null;
    const out: SavedInkEntry[] = [];
    for (const note of notes) {
      if (noteState(note) !== "open" || !note.marks?.length || note.freeCam) continue;
      if (!noteMatchesStageSpace(note, true, source)) continue;
      const span = inkSpan(note.marks);
      if (span) out.push({ note, span });
    }
    return out;
  }, [notes, activeItem, matchedMeta?.layout]);

  const openNotesSorted = useMemo(() => {
    return notes
      .filter((n) => noteState(n) === "open")
      .map((n) => ({ n, t: n.t }))
      .sort((a, b) => a.t - b.t);
  }, [notes]);

  const fitStage = useCallback(() => {
    const view = viewRef.current;
    const stage = stageRef.current;
    if (!view || !stage) return;
    const r = view.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const [w, h] = aspect;
    const s = Math.min(r.width / w, r.height / h);
    const nextW = Math.floor(s * w);
    const nextH = Math.floor(s * h);
    stage.style.width = `${nextW}px`;
    stage.style.height = `${nextH}px`;
    stageSizeRef.current = { width: nextW, height: nextH };
  }, [aspect]);

  const renderOverlays = useCallback(
    (now: number) => {
      const spaceMatches =
        compose?.kind === "create"
          ? composeMatchesStageSpace(compose, true, activeItem?.path ?? null)
          : false;
      const liveMark = liveMarkRef.current;
      const baseDraftMarks = spaceMatches ? inkMarks : [];
      const draftMarks = liveMark ? [...baseDraftMarks, liveMark] : baseDraftMarks;
      const ownPin: PinLike | null =
        compose?.kind === "create" && spaceMatches && compose.pin ? compose.pin : null;

      const inkCanvas = inkRef.current;
      if (inkCanvas) {
        drawInkCanvas(inkCanvas, {
          now,
          saved: savedInkEntries,
          draftMarks,
          draftLabel: draft,
          hasDraftPin: Boolean(ownPin),
          width: stageSizeRef.current.width,
          height: stageSizeRef.current.height,
        });
      }

      const box = pinsRef.current;
      if (!box) return;
      const source = activeItem
        ? {
            category: activeItem.category,
            layout: activeItem.layoutExact
              ? activeItem.layout
              : (matchedMeta?.layout ?? activeItem.layout),
          }
        : null;
      const { pins: here, frame: frameNotes } = activeStageNotes(
        openNotesSorted,
        now,
        1,
        (n) => noteMatchesStageSpace(n, true, source),
      );

      if (!here.length && !frameNotes.length && !ownPin) {
        if (box.childElementCount > 0) box.textContent = "";
        pinCacheRef.current = { sig: "", frameEls: [], pinEls: [] };
        return;
      }

      const want: { id: string; pin: PinLike; text: string; fade: number; saved: boolean }[] =
        here.map((p) => ({
          id: p.id,
          pin: p.pin,
          text: p.text,
          fade: p.fade,
          saved: true,
        }));
      if (ownPin) {
        want.push({
          id: "__own__",
          pin: ownPin,
          text: draft.trim() || ownPin.what,
          fade: 1,
          saved: false,
        });
      }

      const bw = stageSizeRef.current.width || box.clientWidth;
      const bh = stageSizeRef.current.height || box.clientHeight;
      const sig = `${bw}x${bh}|F:${frameNotes.map((f) => `${f.id}:${f.text}`).join(",")}|P:${want
        .map((p) => `${p.saved ? 1 : 0}:${p.id}:${p.pin.x}:${p.pin.y}:${p.text}`)
        .join(",")}`;

      if (sig === pinCacheRef.current.sig) {
        frameNotes.forEach((f, idx) => {
          const el = pinCacheRef.current.frameEls[idx];
          if (el) el.style.opacity = f.fade < 1 ? String(f.fade) : "";
        });
        want.forEach((p, idx) => {
          const el = pinCacheRef.current.pinEls[idx];
          if (el) el.style.opacity = p.fade < 1 ? String(p.fade) : "";
        });
        return;
      }

      box.textContent = "";
      const frameEls: HTMLDivElement[] = [];
      if (frameNotes.length) {
        const stack = document.createElement("div");
        stack.className = "pin-stack";
        for (const f of frameNotes) {
          const el = document.createElement("div");
          el.className = "pin-frame";
          if (f.fade < 1) el.style.opacity = String(f.fade);
          const dot = document.createElement("span");
          dot.className = "pin-frame-dot";
          const span = document.createElement("span");
          span.textContent = f.text;
          el.append(dot, span);
          stack.append(el);
          frameEls.push(el);
        }
        box.append(stack);
      }

      const pinEls: HTMLDivElement[] = [];
      if (want.length) {
        const items: {
          d: HTMLDivElement;
          px: number;
          py: number;
          saved: boolean;
          words: HTMLElement | null;
        }[] = [];

        for (const p of want) {
          const px = Number.isFinite(p.pin.x) ? Math.max(0.02, Math.min(0.98, p.pin.x)) : 0.04;
          const py = Number.isFinite(p.pin.y) ? Math.max(0.03, Math.min(0.97, p.pin.y)) : 0.06;
          const d = document.createElement("div");
          d.className = p.saved ? "pin saved" : "pin";
          d.style.left = `${px * 100}%`;
          d.style.top = `${py * 100}%`;
          if (p.fade < 1) d.style.opacity = String(p.fade);
          let wordsEl: HTMLElement | null = null;
          if (p.text) {
            wordsEl = document.createElement("i");
            wordsEl.textContent = p.text;
            if (py > 0.88) wordsEl.className = "up";
            d.append(wordsEl);
          }
          box.append(d);
          pinEls.push(d);
          items.push({ d, px, py, saved: p.saved, words: wordsEl });
        }

        if (bw > 0 && bh > 0) {
          const layout = resolvePinLayout(
            items.map(({ px, py, saved, words }) => ({
              x: px,
              y: py,
              labelWidth: words?.offsetWidth ?? 0,
              labelHeight: words?.offsetHeight ?? 0,
              dotRadius: saved ? 8 : 11,
            })),
            bw,
            bh,
          );
          items.forEach(({ d, words }, idx) => {
            const l = layout[idx]!;
            if (l.dotDx || l.dotDy) d.style.translate = `${l.dotDx}px ${l.dotDy}px`;
            if (words) {
              words.classList.remove("up");
              words.style.top = "50%";
              words.style.bottom = "auto";
              words.style.translate = `${l.labelX}px ${l.labelY}px`;
            }
          });
        }
      }

      pinCacheRef.current = { sig, frameEls, pinEls };
    },
    [savedInkEntries, openNotesSorted, activeItem, matchedMeta?.layout, compose, draft, inkMarks],
  );

  const renderOverlaysRef = useRef(renderOverlays);
  useEffect(() => {
    renderOverlaysRef.current = renderOverlays;
  }, [renderOverlays]);

  useEffect(() => {
    playback.attach(videoRef.current);
    return () => playback.attach(null);
  }, []);

  useEffect(() => {
    playback.setFilmDuration(duration);
  }, [duration]);

  useEffect(() => {
    playback.setClip(activeItem?.startSec ?? 0);
  }, [videoSrc, activeItem?.startSec]);

  useEffect(() => {
    if (videoReloadSeq === 0) return;
    const video = videoRef.current;
    if (video?.getAttribute("src")) video.load();
  }, [videoReloadSeq]);

  useEffect(() => {
    if (videoSrc) return;
    playback.pause();
    const video = videoRef.current;
    if (video && (video.hasAttribute("src") || video.readyState > 0)) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  }, [videoSrc]);

  useEffect(() => {
    if (!compose) pointerHandlerRef.current?.reset();
  }, [compose, selectedPath]);

  useEffect(() => {
    fitStage();
    renderOverlaysRef.current(playback.t);
    const view = viewRef.current;
    if (!view || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(() => {
      fitStage();
      renderOverlaysRef.current(playback.t);
    });
    ro.observe(view);
    return () => ro.disconnect();
  }, [fitStage]);

  useEffect(() => {
    renderOverlays(playback.t);
    return playback.subscribeTime((t) => renderOverlays(t));
  }, [renderOverlays, inkRev]);

  useEffect(() => {
    const canvas = inkRef.current;
    if (!canvas) return;

    const handler = createStagePointerHandler({
      getRect: () => canvas.getBoundingClientRect(),
      getContext: () => {
        const item = lite.activeVideo();
        const state = lite.store.getState();
        if (!item || liteVideoErrorOf(state)) return null;
        return {
          category: item.category,
          layout: lite.activeLayout(),
          noteSaving: liteNoteSavingOf(state),
          isEditing: state.composeState.status === "edit",
        };
      },
      getInkTool: () => liteInkToolOf(lite.store.getState()),
      getPlaybackTime: () => playback.t,
      isPlaying: () => playback.isPlaying,
      pause: () => playback.pause(),
      ensureComposeForDraw: (wasPlaying) => {
        if (lite.store.getState().composeState.status === "closed") {
          lite.openCreateNote(null, playback.t, wasPlaying, { autoFocus: false });
        }
      },
      openPin: (pin, t, wasPlaying) => {
        lite.openCreateNote(pin, t, wasPlaying);
      },
      getMarks: () => liteInkMarksOf(lite.store.getState()),
      setMarks: (marks) => lite.setInkMarks(marks),
      getLiveMark: () => liveMarkRef.current,
      setLiveMark: (mark) => {
        liveMarkRef.current = mark;
      },
      renderOverlays: () => renderOverlaysRef.current(playback.t),
      capturePointer: (pointerId) => {
        try {
          canvas.setPointerCapture(pointerId);
        } catch {}
      },
    });
    pointerHandlerRef.current = handler;

    const onDown = (e: PointerEvent) => {
      if (handler.onDown(e)) e.preventDefault();
    };
    const onMove = (e: PointerEvent) => handler.onMove(e);
    const onUp = (e: PointerEvent) => handler.onUp(e);
    const onCancel = (e: PointerEvent) => handler.onCancel(e);
    const onBlur = () => handler.reset();

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("lostpointercapture", onCancel);
    window.addEventListener("blur", onBlur);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("lostpointercapture", onCancel);
      window.removeEventListener("blur", onBlur);
      handler.reset();
      if (pointerHandlerRef.current === handler) pointerHandlerRef.current = null;
    };
  }, []);

  const showEmpty = !activeItem || Boolean(videoError);
  const errorText = videoError ?? catalogError;
  const frameAspectStyle = { "--frame": `${aspect[0]} / ${aspect[1]}` } as CSSProperties;

  return (
    <div
      style={frameAspectStyle}
      className="max-md:portrait:phone-picture-h relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-black max-md:portrait:aspect-(--frame) max-md:portrait:w-full max-md:portrait:flex-initial max-md:landscape:flex-1 md:flex-1"
    >
      <div
        ref={viewRef}
        className="@container relative flex min-h-0 w-full flex-1 items-center justify-center"
      >
        <div
          ref={stageRef}
          data-lite-stage
          className="bg-stage @container relative flex-none overflow-hidden"
        >
          <video
            ref={videoRef}
            data-video-path={activeItem?.path}
            src={videoSrc}
            muted={muted}
            playsInline
            preload="auto"
            crossOrigin="anonymous"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              lite.onVideoMetadata(v.videoWidth, v.videoHeight, Number.isFinite(v.duration) ? v.duration : 0);
              playback.onLoadedMetadata(v);
              fitStage();
            }}
            onPlay={() => playback.onPlay()}
            onPause={() => playback.onPause()}
            onEnded={() => playback.onPause()}
            onSeeked={() => playback.onSeeked()}
            onError={() => {
              if (!activeItem) return;
              playback.pause();
              lite.onVideoError(`Could not decode ${activeItem.name}. Check that it is a valid MP4.`);
            }}
            className={cn(
              "pointer-events-none absolute inset-0 block size-full object-fill",
              !videoSrc && "hidden",
            )}
          />
          <div
            ref={pinsRef}
            data-lite-pins
            className="pointer-events-none absolute inset-0 z-4 overflow-hidden"
          />
          <canvas
            ref={inkRef}
            data-lite-ink
            aria-label="Video frame: tap to pin or drag to draw"
            className="absolute inset-0 z-5 block size-full cursor-crosshair touch-none"
          />
        </div>

        {showEmpty && (
          <div
            data-lite-video-empty
            className="pointer-events-auto absolute inset-0 z-6 grid place-items-center p-3"
          >
            <div className="bg-card/95 border-hairline-strong flex w-full max-w-xs flex-col gap-2.5 rounded-xl border p-4 shadow-lg">
              <div className="flex items-start gap-2">
                {errorText ? (
                  <AlertCircle aria-hidden className="text-warn-text mt-0.5 size-4 shrink-0" />
                ) : (
                  <Columns2 aria-hidden className="text-primary-text mt-0.5 size-4 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-foreground text-sm font-semibold">
                    {errorText
                      ? "Could not load video"
                      : !videosLoaded
                        ? "Loading videos…"
                        : "No rendered videos yet"}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                    {errorText
                      ? errorText
                      : !videosLoaded
                        ? "Scanning renders/reference/, renders/, and references/."
                        : "Render a compare or draft MP4, then tap refresh."}
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void lite.refreshAll()}
                className="self-start"
              >
                <RefreshCw aria-hidden data-icon="inline-start" />
                Refresh
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
