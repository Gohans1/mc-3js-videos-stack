import { makeOpenFilmLayers } from "film-stage/openfilm";
import { makeTransitions } from "film-stage/transitions";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

import type { Recipe } from "./state";

export function OpenFilmPreview({
  recipe,
  props,
}: {
  recipe: Recipe;
  props: Record<string, unknown>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const paint = useRef<((t: number) => void) | null>(null);
  const [progress, setProgress] = useState(0.4),
    [error, setError] = useState("");
  const progressRef = useRef(0.4);
  useEffect(() => {
    if (!canvas.current || ["look", "group"].includes(recipe.render)) return;
    const renderer = new THREE.WebGLRenderer({
      canvas: canvas.current,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(320, 180, false);
    const layers = makeOpenFilmLayers(renderer, [recipe]);
    const transition = makeTransitions(
      renderer,
      (_t, shot = 0) => {
        renderer.setClearColor(shot ? 0x2966ac : 0xb98035);
        renderer.clear();
      },
      () => [{ t: 0 }, { t: 1, transition: { fx: `of:${recipe.id}`, len: 1, props } }],
      () => 2,
      { on: false },
    );
    type PreviewLoopState =
      | { kind: "idle" }
      | { kind: "running"; promise: Promise<void>; queued: number | null }
      | { kind: "disposed" };
    let loop: PreviewLoopState = { kind: "idle" };
    const currentLoop = () => loop;
    const renderFrame = async (p: number) => {
      if (recipe.cat === "transition") {
        await transition.prepareFrame(0.5 + p * 0.999);
        if (currentLoop().kind === "disposed") return;
        transition(0.5 + p * 0.999);
      } else {
        renderer.setClearColor(0x30343c);
        renderer.clear();
        const duration = (recipe.durationMs ?? 3000) / 1000;
        await layers.render(
          [{ id: "preview", asset: recipe.id, from: 0, to: duration, ...props }],
          Math.min(p, 0.999999) * duration,
        );
      }
    };
    const startLoop = (initial: number) => {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      loop = { kind: "running", promise, queued: initial };
      void (async () => {
        try {
          while (true) {
            const state = currentLoop();
            if (state.kind !== "running" || state.queued === null) break;
            const p = state.queued;
            state.queued = null;
            await renderFrame(p);
          }
        } catch (e) {
          if (currentLoop().kind !== "disposed") setError(String((e as Error).message));
        } finally {
          const state = currentLoop();
          if (state.kind === "running") {
            const nextQueued = state.queued;
            loop = { kind: "idle" };
            resolve();
            if (nextQueued !== null) startLoop(nextQueued);
          } else {
            resolve();
          }
        }
      })();
    };
    paint.current = (p) => {
      if (loop.kind === "disposed") return;
      if (loop.kind === "running") {
        loop.queued = p;
        return;
      }
      startLoop(p);
    };
    setError("");
    paint.current(progressRef.current);
    return () => {
      const inflight = loop.kind === "running" ? loop.promise : null;
      loop = { kind: "disposed" };
      paint.current = null;
      void (inflight ?? Promise.resolve()).finally(() => {
        layers.dispose();
        transition.disposeTransitions();
        renderer.dispose();
      });
    };
  }, [recipe, props]);
  return (
    <figure className="space-y-2">
      {recipe.render === "look" ? (
        <img
          alt={`${recipe.title} color sample`}
          className="max-h-44 w-full object-contain"
          src={`/_openfilm/library/${recipe.sample}`}
        />
      ) : recipe.render === "group" ? (
        <video
          aria-label={`${recipe.title} template preview`}
          className="max-h-44 w-full"
          src={`/_openfilm/library/${recipe.id}/preview.mp4`}
          controls
          muted
          preload="metadata"
        />
      ) : (
        <>
          <canvas
            ref={canvas}
            aria-label={`${recipe.title} preview in Three.js`}
            className="bg-picture aspect-video w-full rounded"
          />
          <label className="text-muted-foreground flex items-center gap-2 text-xs">
            Preview time
            <input
              className="min-w-0 flex-1"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={progress}
              onChange={(e) => {
                const value = Number(e.target.value);
                progressRef.current = value;
                setProgress(value);
                paint.current?.(value);
              }}
            />
          </label>
        </>
      )}
      {error && (
        <figcaption role="alert" className="text-destructive text-xs">
          {error}
        </figcaption>
      )}
    </figure>
  );
}
