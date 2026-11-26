import {
  drawToonFace,
  drawToonMarks,
  type Face,
  feel,
  INTENSITY,
  REF_ALEX,
  toonStyle,
  withBlink,
} from "mc-actor/toon-face";
import { isTimelineFaceName } from "mc-actor/toon-timeline";
import { useLayoutEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";

import { S } from "../core/state";
import { useStudio } from "../core/store";
import { faceRows, putFaceKey } from "../keys/keys";
import { type ExpressionEntry, expressionLabel } from "./expression-library";

const style = toonStyle();
const faceSize = 8;
const viewSize = faceSize * 2;

export function FaceSwatch({
  face,
  size,
  label,
  className,
}: {
  face: Face;
  size: number;
  label?: string;
  className: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    const scale = size / viewSize;
    ctx.setTransform(scale, 0, 0, scale, size / 4, size / 4);
    ctx.fillStyle = REF_ALEX.skin.tones.skin;
    ctx.fillRect(0, 0, faceSize, faceSize);
    drawToonFace(ctx, face, style);
    drawToonMarks(ctx, face, style);
    ctx.resetTransform();
  }, [face, size]);
  return (
    <canvas
      ref={canvas}
      width={size}
      height={size}
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

export function ExpressionPreview({
  entry,
  category,
  actor,
  onActorChange,
}: {
  entry: ExpressionEntry;
  category: string;
  actor: string | null;
  onActorChange: (actor: string | null) => void;
}) {
  const [intensity, setIntensity] = useState(entry.kind === "ramp" ? INTENSITY.medium : 1);
  const [blink, setBlink] = useState(false);
  useStudio((s) => s.keysRev);
  const rows = faceRows();
  const row = rows.find(({ id }) => id === actor) ?? rows[0];
  const base = feel(entry.name, intensity);
  const face = blink ? withBlink(base, 1) : base;
  const title = expressionLabel(entry.name);
  const percent = Math.round(intensity * 100);

  function setPercent(value: number | readonly number[]) {
    if (typeof value !== "number") return;
    const stop =
      entry.kind === "ramp"
        ? Object.values(INTENSITY).find((level) => Math.round(level * 100) === value)
        : undefined;
    setIntensity(stop ?? value / 100);
  }

  return (
    <Card size="sm" role="region" aria-label="Expression preview" className="min-w-0 flex-none">
      <CardHeader>
        <CardTitle role="heading" aria-level={3} className="wrap-anywhere">
          {title}
        </CardTitle>
        {entry.kind === "preset" && entry.description && <CardDescription>{entry.description}</CardDescription>}
        <CardAction>
          <Badge variant="secondary">{entry.kind === "ramp" ? "Intensity ramp" : category}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-3">
          <FaceSwatch
            face={face}
            size={256}
            label={`${title} preview at ${percent}% intensity${blink ? ", eyes closed" : ""}`}
            className="bg-backdrop size-24 shrink-0 rounded-md"
          />
          <div className="flex min-w-32 flex-1 flex-col gap-2">
            <div className="flex flex-col gap-1">
              <div className="text-label flex justify-between gap-2 text-xs">
                <span>Intensity</span>
                <span className="tabular-nums">{percent}%</span>
              </div>
              <Slider
                aria-label="Expression intensity (%)"
                value={percent}
                onValueChange={setPercent}
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {entry.kind === "ramp" &&
                Object.entries(INTENSITY).map(([level, value], index) => (
                  <Button
                    key={level}
                    variant="tab"
                    size="xs"
                    aria-label={`${expressionLabel(level)}: ${expressionLabel(entry.stops[index] ?? "")}`}
                    aria-pressed={intensity === value}
                    onClick={() => setIntensity(value)}
                  >
                    {expressionLabel(level)}
                  </Button>
                ))}
              <Button variant="tab" size="xs" aria-pressed={blink} onClick={() => setBlink(!blink)}>
                Close eyes
              </Button>
            </div>
          </div>
        </div>
        {row && isTimelineFaceName(entry.name) && (
          <div className="flex flex-wrap items-center gap-2">
            {rows.length > 1 && (
              <Select value={row.id} onValueChange={onActorChange} items={rows.map(({ id, label }) => ({ value: id, label }))}>
                <SelectTrigger aria-label="Face actor"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {rows.map(({ id, label }) => <SelectItem key={id} value={id}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Button variant="secondary" size="sm" onClick={() => {
              if (isTimelineFaceName(entry.name)) putFaceKey(row, S.t, entry.name, intensity);
            }}>
              Add face key at playhead
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
