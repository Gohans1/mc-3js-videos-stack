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
    let pending: number | null = null,
      stopped = false,
      running: Promise<void> | null = null;
    const run = async () => {
      while (pending !== null && !stopped) {
        const p = pending;
        pending = null;
        if (recipe.cat === "transition") {
          await transition.prepareFrame(0.5 + p * 0.999);
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
      }
    };
    paint.current = (p) => {
      pending = p;
      if (!running)
        running = run()
          .catch((e) => {
            if (!stopped) setError(String(e.message));
          })
          .finally(() => {
            running = null;
          });
    };
    setError("");
    paint.current(progressRef.current);
    return () => {
      stopped = true;
      paint.current = null;
      void (running ?? Promise.resolve()).finally(() => {
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
