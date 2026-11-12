import { Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { sampleSpeedCurve, type SpeedCurveValue } from "../../src/speed-curve.mjs";
import { ValueBox } from "../components/inspector";

type Curve = [number, number][];
type Gesture =
  | { status: "idle" }
  | {
      status: "dragging";
      index: number;
      snapshot: string;
      restore: (s: string) => void;
      curve: Curve;
      latest: Curve;
    };
const xOf = (x: number) => 12 + x * 256,
  yOf = (rate: number) => 80 - Math.log10(rate) * 64;
export function SpeedCurve({
  value,
  handles,
  playhead,
  doc,
  preview,
  save,
}: {
  value: Curve;
  handles?: SpeedCurveValue["handles"];
  playhead: number;
  doc: { snapshot: () => string; restore: (s: string) => void };
  preview: (v: Curve) => void;
  save: (v: Curve) => void;
}) {
  const [selected, select] = useState(0),
    gesture = useRef<Gesture>({ status: "idle" });
  useEffect(
    () => () => {
      const g = gesture.current;
      if (g.status === "dragging") {
        gesture.current = { status: "idle" };
        g.restore(g.snapshot);
      }
    },
    [],
  );
  const selectedIndex = Math.min(selected, value.length - 1);
  const finish = (cancel = false) => {
    const g = gesture.current;
    if (g.status !== "dragging") return;
    gesture.current = { status: "idle" };
    g.restore(g.snapshot);
    if (!cancel && JSON.stringify(g.latest) !== JSON.stringify(g.curve)) save(g.latest);
  };
  const changeRate = (rate: number) => {
    const next = structuredClone(value);
    next[selectedIndex][1] = rate;
    save(next);
  };
  return (
    <>
      <svg
        viewBox="0 0 280 160"
        aria-label="Speed curve editor"
        className="w-full touch-none"
        onPointerMove={(e) => {
          const g = gesture.current;
          if (g.status !== "dragging") return;
          const r = e.currentTarget.getBoundingClientRect(),
            i = g.index,
            next = structuredClone(g.curve);
          const x = (((e.clientX - r.left) / r.width) * 280 - 12) / 256;
          next[i] = [
            i === 0
              ? 0
              : i === next.length - 1
                ? 1
                : Math.max(next[i - 1][0] + 0.01, Math.min(next[i + 1][0] - 0.01, x)),
            Math.max(0.1, Math.min(10, 10 ** ((80 - ((e.clientY - r.top) / r.height) * 160) / 64))),
          ];
          g.latest = next;
          doc.restore(g.snapshot);
          preview(next);
        }}
        onPointerUp={() => finish()}
        onPointerCancel={() => finish(true)}
        onLostPointerCapture={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            finish(true);
          }
        }}
      >
        {[0.1, 0.316, 1, 3.16, 10].map((rate) => (
          <path
            key={rate}
            d={`M12 ${yOf(rate)}H268`}
            className="stroke-raised-4"
            strokeDasharray="3 2"
          />
        ))}
        {[0.1, 1, 10].map((rate) => (
          <text
            key={rate}
            x="15"
            y={yOf(rate) + (rate === 10 ? 10 : -4)}
            className="fill-muted-foreground text-xs"
          >
            {rate}×
          </text>
        ))}
        <polyline
          points={Array.from(
            { length: 257 },
            (_, i) =>
              `${xOf(i / 256)},${yOf(sampleSpeedCurve({ curve: value, handles }, i / 256))}`,
          ).join(" ")}
          fill="none"
          className="stroke-foreground"
          strokeWidth="1.5"
        />
        {playhead >= 0 && playhead <= 1 && (
          <path d={`M${xOf(playhead)} 12V148`} className="stroke-foreground" strokeWidth="1" />
        )}
        {value.map(([x, rate], i) => (
          <g
            key={i}
            role="slider"
            tabIndex={0}
            aria-label={`Speed point ${i + 1}`}
            aria-orientation="vertical"
            aria-valuemin={0.1}
            aria-valuemax={10}
            aria-valuenow={rate}
            aria-valuetext={`${rate.toFixed(2)} times at ${Math.round(x * 100)} percent`}
            className="group cursor-ns-resize outline-none"
            onFocus={() => select(i)}
            onPointerDown={(e) => {
              e.preventDefault();
              select(i);
              e.currentTarget.focus();
              e.currentTarget.setPointerCapture(e.pointerId);
              gesture.current = {
                status: "dragging",
                index: i,
                snapshot: doc.snapshot(),
                restore: doc.restore,
                curve: structuredClone(value),
                latest: value,
              };
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                changeRate(Math.max(0.1, Math.min(10, rate + (e.key === "ArrowUp" ? 0.1 : -0.1))));
              }
            }}
          >
            <rect x={xOf(x) - 12} y={yOf(rate) - 12} width="24" height="24" fill="transparent" />
            <rect
              x={xOf(x) - 4}
              y={yOf(rate) - 7}
              width="8"
              height="14"
              rx="2"
              className={`${i === selectedIndex ? "fill-foreground" : "fill-muted-foreground"} group-focus-visible:stroke-primary`}
            />
            <path d={`M${xOf(x)} ${yOf(rate) - 7}v14`} className="stroke-curve" strokeWidth="2" />
          </g>
        ))}
      </svg>
      <div className="flex items-center justify-end gap-1.5 border-t px-2 py-2">
        <ValueBox
          name="Point speed"
          value={value[selectedIndex][1]}
          min={0.1}
          max={10}
          step={0.1}
          digits={2}
          unit="×"
          onSave={changeRate}
        />
        <span className="flex-1" />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            save([
              [0, 1],
              [0.25, 1],
              [0.5, 1],
              [0.75, 1],
              [1, 1],
            ]);
            select(0);
          }}
        >
          <RotateCcw />
          Reset
        </Button>
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label="Add speed point"
          disabled={value.length >= 20}
          onClick={() => {
            const i = Math.min(selectedIndex, value.length - 2),
              next = structuredClone(value),
              at = (value[i][0] + value[i + 1][0]) / 2;
            next.splice(i + 1, 0, [at, sampleSpeedCurve({ curve: value, handles }, at)]);
            save(next);
            select(i + 1);
          }}
        >
          <Plus />
        </Button>
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label="Delete speed point"
          disabled={selectedIndex === 0 || selectedIndex === value.length - 1}
          onClick={() => {
            save(value.filter((_, i) => i !== selectedIndex));
            select(selectedIndex - 1);
          }}
        >
          <Minus />
        </Button>
      </div>
    </>
  );
}
