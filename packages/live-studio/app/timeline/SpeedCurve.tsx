import { Link2, Minus, Plus, RotateCcw, Unlink2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import {
  buildSpeedCurve,
  cutRatesAt,
  moveSpeedPoint,
  normalizeSpeedCuts,
  pointInRate,
  pointOutRate,
  remapSpeedCutsOnInsert,
  remapSpeedCutsOnRemove,
  sampleSpeedCurve,
  type SpeedCurveValue,
  toggleSpeedCut,
} from "../../src/speed-curve.mjs";
import { ValueBox } from "../components/inspector";
import { Tip } from "../components/Tip";

type Curve = [number, number][];
type PointSide = "both" | "left" | "right";
type Selection = { index: number; side: PointSide };
type Gesture =
  | { status: "idle" }
  | {
      status: "point";
      index: number;
      side: PointSide;
      snapshot: string;
      restore: (s: string) => void;
      initial: SpeedCurveValue;
      latest: SpeedCurveValue;
    };

const xOf = (x: number) => 12 + x * 256,
  yOf = (rate: number) => 80 - Math.log10(rate) * 64,
  nudgeRate = (rate: number, key: string) =>
    Math.max(0.1, Math.min(10, Number((rate + (key === "ArrowUp" ? 0.1 : -0.1)).toFixed(2)))),
  rateFromClientY = (clientY: number, rect: DOMRect) =>
    Math.max(0.1, Math.min(10, 10 ** ((80 - ((clientY - rect.top) / rect.height) * 160) / 64)));

const sampleSegmentPoints = (value: SpeedCurveValue, startSeg: number, endSeg: number) => {
  const { curve } = value;
  const x0 = curve[startSeg][0];
  const x1 = curve[endSeg][0];
  const span = x1 - x0;
  const steps = Math.max(24, Math.round(span * 256));
  const leftPad = cutRatesAt(value, startSeg) ? 3.5 : 0;
  const rightPad = cutRatesAt(value, endSeg) ? 3.5 : 0;
  const pts: string[] = [`${xOf(x0) + leftPad},${yOf(pointOutRate(value, startSeg))}`];
  for (let s = 1; s < steps; s++) {
    const u = x0 + (span * s) / steps;
    pts.push(`${xOf(u)},${yOf(sampleSpeedCurve(value, u))}`);
  }
  pts.push(`${xOf(x1) - rightPad},${yOf(pointInRate(value, endSeg))}`);
  return pts.join(" ");
};

export function SpeedCurve({
  value,
  handles,
  cuts,
  playhead,
  doc,
  preview,
  save,
}: {
  value: Curve;
  handles?: SpeedCurveValue["handles"];
  cuts?: SpeedCurveValue["cuts"];
  playhead: number;
  doc: { snapshot: () => string; restore: (s: string) => void };
  preview: (v: SpeedCurveValue) => void;
  save: (v: SpeedCurveValue) => void;
}) {
  const [selected, select] = useState<Selection>({ index: 0, side: "both" }),
    svgRef = useRef<SVGSVGElement>(null),
    gesture = useRef<Gesture>({ status: "idle" });
  useEffect(
    () => () => {
      const g = gesture.current;
      if (g.status !== "idle") {
        gesture.current = { status: "idle" };
        g.restore(g.snapshot);
      }
    },
    [],
  );

  const normCuts = normalizeSpeedCuts(value.length, cuts);
  const currentValue: SpeedCurveValue = {
    curve: value,
    ...(handles ? { handles } : {}),
    ...(Object.keys(normCuts).length ? { cuts: normCuts } : {}),
  };
  const selectedIndex = Math.min(selected.index, value.length - 1);
  const selectedCut = cutRatesAt(currentValue, selectedIndex);
  const isInterior = selectedIndex > 0 && selectedIndex < value.length - 1;
  const isSplit = !!selectedCut;
  const activeSide: PointSide = isSplit
    ? selected.side === "both"
      ? "right"
      : selected.side
    : "both";
  const selectedRate =
    activeSide === "left"
      ? pointInRate(currentValue, selectedIndex)
      : activeSide === "right"
        ? pointOutRate(currentValue, selectedIndex)
        : value[selectedIndex][1];

  const finish = (cancel = false) => {
    const g = gesture.current;
    if (g.status === "idle") return;
    gesture.current = { status: "idle" };
    g.restore(g.snapshot);
    if (!cancel && JSON.stringify(g.latest) !== JSON.stringify(g.initial)) save(g.latest);
  };

  const changeRate = (rate: number, index = selectedIndex, side: PointSide = activeSide) => {
    save(moveSpeedPoint(currentValue, index, [value[index][0], rate], side));
  };

  const toggleSplitAt = (index: number, sideHint: PointSide = activeSide) => {
    if (index <= 0 || index >= value.length - 1) return;
    const wasSplit = !!cutRatesAt(currentValue, index);
    const joinSide = sideHint === "left" ? "left" : "right";
    save(toggleSpeedCut(currentValue, index, joinSide));
    select({ index, side: wasSplit ? "both" : joinSide });
  };

  const startDrag = (e: React.PointerEvent<SVGGElement>, i: number, side: PointSide) => {
    e.preventDefault();
    e.stopPropagation();
    let dragInitial = structuredClone(currentValue);
    let dragSide: PointSide = side;
    if (side === "both" && e.altKey && i > 0 && i < value.length - 1 && !normCuts[String(i)]) {
      const svg = e.currentTarget.ownerSVGElement;
      const rect = svg?.getBoundingClientRect();
      const svgX = rect ? ((e.clientX - rect.left) / rect.width) * 280 : xOf(value[i][0]);
      dragSide = svgX < xOf(value[i][0]) ? "left" : "right";
      dragInitial = toggleSpeedCut(dragInitial, i);
    }
    select({ index: i, side: dragSide });
    e.currentTarget.focus();
    try {
      (svgRef.current ?? e.currentTarget).setPointerCapture(e.pointerId);
    } catch {}
    gesture.current = {
      status: "point",
      index: i,
      side: dragSide,
      snapshot: doc.snapshot(),
      restore: doc.restore,
      initial: dragInitial,
      latest: dragInitial,
    };
  };

  const cutBoundaries = value
    .map((_, i) => i)
    .filter((i) => i > 0 && i < value.length - 1 && !!normCuts[String(i)]);
  const runBounds = [0, ...cutBoundaries, value.length - 1];
  const segments = runBounds.slice(0, -1).map((s, idx) => ({
    s,
    e: runBounds[idx + 1],
    points: sampleSegmentPoints(currentValue, s, runBounds[idx + 1]),
  }));

  return (
    <>
      <svg
        ref={svgRef}
        viewBox="0 0 280 160"
        aria-label="Speed curve editor"
        className="w-full touch-none"
        onPointerMove={(e) => {
          const g = gesture.current;
          if (g.status === "idle") return;
          const r = e.currentTarget.getBoundingClientRect();
          const i = g.index;
          const curve = g.initial.curve;
          const rawX = (((e.clientX - r.left) / r.width) * 280 - 12) / 256;
          const clampedX =
            i === 0
              ? 0
              : i === curve.length - 1
                ? 1
                : Math.max(curve[i - 1][0] + 0.01, Math.min(curve[i + 1][0] - 0.01, rawX));
          const next = moveSpeedPoint(
            g.initial,
            i,
            [clampedX, rateFromClientY(e.clientY, r)],
            g.side,
          );
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
        {segments.map(({ s, e, points }) => (
          <polyline
            key={`${s}-${e}`}
            points={points}
            fill="none"
            className="stroke-foreground"
            strokeWidth="1.5"
          />
        ))}
        {playhead >= 0 && playhead <= 1 && (
          <path d={`M${xOf(playhead)} 12V148`} className="stroke-foreground" strokeWidth="1" />
        )}
        {value.map(([x, rate], i) => {
          const cx = xOf(x);
          const pair = cutRatesAt(currentValue, i);
          const broken = !!pair;
          const isPointSelected = i === selectedIndex;

          if (broken) {
            const leftRate = pair[0];
            const rightRate = pair[1];
            const cyL = yOf(leftRate);
            const cyR = yOf(rightRate);
            const leftSelected = isPointSelected && activeSide === "left";
            const rightSelected = isPointSelected && activeSide === "right";
            const minY = Math.min(cyL, cyR);
            const maxY = Math.max(cyL, cyR);
            const badgeY =
              minY > 30 ? minY - 18 : maxY < 130 ? maxY + 18 : Math.round((minY + maxY) / 2);
            return (
              <g key={i}>
                {Math.abs(cyL - cyR) > 1 && (
                  <line
                    x1={cx}
                    y1={cyL}
                    x2={cx}
                    y2={cyR}
                    className="stroke-muted-foreground/50"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                  />
                )}
                <g
                  role="slider"
                  tabIndex={0}
                  aria-label={`Speed point ${i + 1} incoming`}
                  aria-orientation="vertical"
                  aria-valuemin={0.1}
                  aria-valuemax={10}
                  aria-valuenow={leftRate}
                  aria-valuetext={`${leftRate.toFixed(2)} times incoming at ${Math.round(x * 100)} percent`}
                  className="group cursor-ns-resize outline-none"
                  onFocus={() => select({ index: i, side: "left" })}
                  onPointerDown={(e) => startDrag(e, i, "left")}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                      e.preventDefault();
                      changeRate(nudgeRate(leftRate, e.key), i, "left");
                    }
                  }}
                >
                  <rect x={cx - 14} y={cyL - 12} width="14" height="24" fill="transparent" />
                  <path
                    d={`M${cx - 3.5} ${cyL - 7}h-2.5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2.5Z`}
                    className={`${leftSelected ? "fill-foreground stroke-primary" : "fill-foreground/85 stroke-curve-bg"} group-focus-visible:stroke-primary`}
                    strokeWidth={leftSelected ? "1.3" : "0.9"}
                  />
                </g>
                <g
                  role="slider"
                  tabIndex={0}
                  aria-label={`Speed point ${i + 1} outgoing`}
                  aria-orientation="vertical"
                  aria-valuemin={0.1}
                  aria-valuemax={10}
                  aria-valuenow={rightRate}
                  aria-valuetext={`${rightRate.toFixed(2)} times outgoing at ${Math.round(x * 100)} percent`}
                  className="group cursor-ns-resize outline-none"
                  onFocus={() => select({ index: i, side: "right" })}
                  onPointerDown={(e) => startDrag(e, i, "right")}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                      e.preventDefault();
                      changeRate(nudgeRate(rightRate, e.key), i, "right");
                    }
                  }}
                >
                  <rect x={cx} y={cyR - 12} width="14" height="24" fill="transparent" />
                  <path
                    d={`M${cx + 3.5} ${cyR - 7}h2.5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2.5Z`}
                    className={`${rightSelected ? "fill-foreground stroke-primary" : "fill-foreground/85 stroke-curve-bg"} group-focus-visible:stroke-primary`}
                    strokeWidth={rightSelected ? "1.3" : "0.9"}
                  />
                </g>
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`Reconnect speed point ${i + 1}`}
                  className="cursor-pointer outline-none"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => toggleSplitAt(i, activeSide)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleSplitAt(i, activeSide);
                    }
                  }}
                >
                  <rect
                    x={cx - 8}
                    y={badgeY - 8}
                    width="16"
                    height="16"
                    rx="4"
                    className="fill-raised-2 stroke-border hover:stroke-primary"
                    strokeWidth="1"
                  />
                  <Unlink2
                    x={cx - 5}
                    y={badgeY - 5}
                    width={10}
                    height={10}
                    className="text-foreground pointer-events-none"
                  />
                </g>
              </g>
            );
          }

          const cy = yOf(rate);
          const canSplitNode = i > 0 && i < value.length - 1;
          const badgeY = cy > 30 ? cy - 18 : cy + 18;
          return (
            <g key={i}>
              <g
                role="slider"
                tabIndex={0}
                aria-label={`Speed point ${i + 1}`}
                aria-orientation="vertical"
                aria-valuemin={0.1}
                aria-valuemax={10}
                aria-valuenow={rate}
                aria-valuetext={`${rate.toFixed(2)} times at ${Math.round(x * 100)} percent`}
                className="group cursor-ns-resize outline-none"
                onFocus={() => select({ index: i, side: "both" })}
                onPointerDown={(e) => startDrag(e, i, "both")}
                onDoubleClick={(e) => {
                  if (!canSplitNode) return;
                  e.stopPropagation();
                  toggleSplitAt(i, "right");
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    e.preventDefault();
                    changeRate(nudgeRate(rate, e.key), i, "both");
                  }
                }}
              >
                <rect x={cx - 12} y={cy - 12} width="24" height="24" fill="transparent" />
                <rect
                  x={cx - 4.5}
                  y={cy - 7}
                  width="9"
                  height="14"
                  rx="2"
                  className={`${isPointSelected ? "fill-foreground" : "fill-muted-foreground"} group-focus-visible:stroke-primary`}
                />
                <path d={`M${cx} ${cy - 7}v14`} className="stroke-curve-bg" strokeWidth="1.5" />
              </g>
              {canSplitNode && isPointSelected && (
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`Split speed point ${i + 1}`}
                  className="cursor-pointer outline-none"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => toggleSplitAt(i, "right")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleSplitAt(i, "right");
                    }
                  }}
                >
                  <rect
                    x={cx - 8}
                    y={badgeY - 8}
                    width="16"
                    height="16"
                    rx="4"
                    className="fill-raised-2 stroke-border hover:stroke-primary"
                    strokeWidth="1"
                  />
                  <Link2
                    x={cx - 5}
                    y={badgeY - 5}
                    width={10}
                    height={10}
                    className="text-muted-foreground hover:text-foreground pointer-events-none"
                  />
                </g>
              )}
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap items-center justify-end gap-1 border-t px-2 py-2">
        <ValueBox
          name={
            activeSide === "left"
              ? "Point speed (in)"
              : activeSide === "right"
                ? "Point speed (out)"
                : "Point speed"
          }
          value={selectedRate}
          min={0.1}
          max={10}
          step={0.1}
          digits={2}
          unit="×"
          onSave={(r) => changeRate(r)}
        />
        <span className="flex-1" />
        <Tip
          label={
            isSplit
              ? "Reconnect left & right halves together"
              : "Split white halves so incoming & outgoing speeds separate independently (or Alt+Drag / double-click point)"
          }
        >
          <Button
            variant={isSplit ? "default" : "secondary"}
            size="sm"
            aria-label={isSplit ? "Reconnect speed point halves" : "Split speed point halves"}
            aria-pressed={isSplit}
            disabled={!isInterior}
            onClick={() => toggleSplitAt(selectedIndex, activeSide)}
          >
            {isSplit ? <Unlink2 aria-hidden /> : <Link2 aria-hidden />}
            {isSplit ? "Split" : "Link"}
          </Button>
        </Tip>
        <Tip label="Reset custom curve points back to flat 1x">
          <Button
            variant="secondary"
            size="sm"
            disabled={
              Object.keys(normCuts).length === 0 &&
              value.length === 5 &&
              value.every(
                ([x, y], idx) => Math.abs(x - idx * 0.25) < 1e-4 && Math.abs(y - 1) < 1e-4,
              ) &&
              (!handles ||
                handles.every(([a, b]) => Math.abs(a - 1) < 1e-4 && Math.abs(b - 1) < 1e-4))
            }
            onClick={() => {
              save(
                buildSpeedCurve([
                  [0, 1],
                  [0.25, 1],
                  [0.5, 1],
                  [0.75, 1],
                  [1, 1],
                ]),
              );
              select({ index: 0, side: "both" });
            }}
          >
            <RotateCcw aria-hidden />
            Reset
          </Button>
        </Tip>
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label="Add speed point"
          disabled={value.length >= 20}
          onClick={() => {
            const i = Math.min(selectedIndex, value.length - 2),
              nextCurve = structuredClone(value),
              at = (value[i][0] + value[i + 1][0]) / 2;
            nextCurve.splice(i + 1, 0, [at, sampleSpeedCurve(currentValue, at)]);
            const nextCuts = remapSpeedCutsOnInsert(normCuts, i + 1, nextCurve.length);
            save(buildSpeedCurve(nextCurve, nextCuts));
            select({ index: i + 1, side: "both" });
          }}
        >
          <Plus aria-hidden />
        </Button>
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label="Delete speed point"
          disabled={selectedIndex === 0 || selectedIndex === value.length - 1}
          onClick={() => {
            const nextCurve = value.filter((_, i) => i !== selectedIndex);
            const nextCuts = remapSpeedCutsOnRemove(normCuts, selectedIndex, nextCurve.length);
            save(buildSpeedCurve(nextCurve, nextCuts));
            select({ index: selectedIndex - 1, side: "both" });
          }}
        >
          <Minus aria-hidden />
        </Button>
      </div>
    </>
  );
}
