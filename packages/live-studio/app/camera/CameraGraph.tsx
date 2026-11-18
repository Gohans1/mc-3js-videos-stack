import { CAMERA_CHANNELS, type CameraChannel } from "film-stage/camera";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { clockForTimeline } from "../../src/timing-state.mjs";
import { CurveEditor } from "../components/EasePicker";
import { FieldRow, Section, Segmented, ValueBox } from "../components/inspector";
import { type Ease } from "../core/ease";
import { S } from "../core/state";
import { useStudio } from "../core/store";
import { stamp } from "../core/time";
import {
  addKeyHere,
  edit,
  keys,
  movable,
  pickCamKeys,
  preview,
  restore,
  seekCameraKey,
  snapshot,
} from "./cam";
import {
  contiguousPicks,
  equalizeGraphKeys,
  graphFalloff,
  type GraphSample,
  plotCameraGraph,
  reverseGraphKeys,
  scaleGraphTiming,
  scaleGraphValues,
  selectionInGraph,
} from "./camera-graph";

type Mode = "speed" | "value";
const W = 300,
  H = 142,
  LEFT = 38,
  TOP = 12,
  RIGHT = W - 9,
  BOTTOM = H - 21;
const titles: Record<CameraChannel, string> = {
  position: "Position",
  aim: "Aim",
  lens: "Lens (°)",
  dof: "Aperture",
  roll: "Roll (°)",
  shake: "Sway",
};
const channelItems = CAMERA_CHANNELS.map((value) => ({ value, label: titles[value] }));
const presets = [
  { value: "inherit", label: "Use key easing" },
  { value: "linear", label: "Linear" },
  { value: "inout", label: "Ease" },
  { value: "custom", label: "Custom curve" },
];
const graphDoc = { snapshot, restore };
const number = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

export function CameraGraph({ index }: { index: number }) {
  const revision = useStudio((s) => s.camRev);
  useStudio((s) => s.camPicks);
  const [channel, setChannel] = useState<CameraChannel>("position");
  const [axis, setAxis] = useState("0");
  const [mode, setMode] = useState<Mode>("speed");
  const [buffer, setBuffer] = useState<{
    channel: CameraChannel;
    axis: string;
    mode: Mode;
    data: GraphSample[];
  } | null>(null);
  const [timeScale, setTimeScale] = useState(100);
  const [valueScale, setValueScale] = useState(100);
  const [brush, setBrush] = useState(false);
  const [radius, setRadius] = useState(0.5);
  const stroke = useRef<{ t: number; y: number; revision: number } | null>(null);
  const at =
    index >= 0
      ? index
      : Math.max(
          0,
          keys.findLastIndex((key) => key.t <= S.t),
        );
  const first = Math.max(
    0,
    keys.findLastIndex((key, i) => i <= at && key.cut),
  );
  const cut = keys.findIndex((key, i) => i > first && key.cut);
  const end = cut < 0 ? keys.length : cut;
  const time = keys[at]?.t ?? S.t;
  const occurrence = clockForTimeline("cam").cameraSpans?.find(
    (span) => time >= span.from && time < span.to,
  );
  const rows = keys;
  const indices = useMemo(
    () =>
      occurrence
        ? rows.flatMap((key, i) => {
            const source = key.__timing?.source ?? key.t;
            return key.t >= occurrence.from &&
              key.t <= occurrence.to &&
              source >= occurrence.sourceFrom &&
              (key.cut ? source < occurrence.sourceTo : source <= occurrence.sourceTo)
              ? [i]
              : [];
          })
        : Array.from({ length: Math.max(0, end - first) }, (_, i) => first + i),
    [rows, occurrence, first, end],
  );
  const selected = selectionInGraph(indices);
  const group = contiguousPicks(selected);
  const data = useMemo(
    () => plotCameraGraph(indices, mode, channel, Number(axis)),
    [indices, mode, channel, axis],
  );
  const ghost =
    buffer?.channel === channel && buffer.axis === axis && buffer.mode === mode ? buffer.data : [];
  const start = keys[indices[0]]?.t ?? 0,
    stop = keys[indices.at(-1) ?? -1]?.t ?? start;
  let min = Infinity,
    max = -Infinity;
  for (const point of [...data, ...ghost]) {
    min = Math.min(min, point.value);
    max = Math.max(max, point.value);
  }
  const span = Math.max(0.001, max - min);
  const x = (t: number) => LEFT + ((t - start) / Math.max(0.001, stop - start)) * (RIGHT - LEFT);
  const y = (value: number) => BOTTOM - ((value - min) / span) * (BOTTOM - TOP);
  const line = (points: GraphSample[]) =>
    points.map(({ t, value }) => [x(t), y(value)].join(",")).join(" ");
  const setCurve = (curve: Ease | undefined, apply = edit) =>
    apply((rows) => {
      const key = rows[index];
      if (!key) return;
      const next = { ...key.easeChannels };
      if (curve === undefined) delete next[channel];
      else next[channel] = curve;
      if (Object.keys(next).length) key.easeChannels = next;
      else delete key.easeChannels;
    });
  const activeCurve = keys[index]?.easeChannels?.[channel];
  const preset =
    activeCurve === undefined
      ? "inherit"
      : typeof activeCurve === "string" && presets.some((item) => item.value === activeCurve)
        ? activeCurve
        : "custom";
  return (
    <Section title="Camera graph">
      <div className="flex flex-wrap gap-1.5">
        <Select
          items={channelItems}
          value={channel}
          onValueChange={(value) => {
            if (!value) return;
            setChannel(value);
            setMode(value === "position" || value === "aim" ? "speed" : "value");
          }}
        >
          <SelectTrigger aria-label="Graph channel" className="min-w-0 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {channelItems.map(({ value, label }) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Segmented
          label="Graph type"
          value={mode}
          items={[
            { id: "speed", title: "Speed" },
            { id: "value", title: "Value" },
          ]}
          onChange={setMode}
        />
      </div>
      {(channel === "position" || channel === "aim") && (
        <Segmented
          label="Graph axis"
          value={axis}
          items={["X", "Y", "Z"].map((title, i) => ({ id: String(i), title }))}
          onChange={setAxis}
        />
      )}
      {data.length ? (
        <svg
          viewBox={"0 0 " + W + " " + H}
          className="bg-backdrop w-full touch-none rounded select-none"
          aria-label={titles[channel] + " " + mode + " graph"}
          onPointerDown={(event) => {
            if (!brush || mode !== "value" || !selected.length || event.button !== 0) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const px = ((event.clientX - rect.left) / rect.width) * W;
            const p = Math.max(0, Math.min(1, (px - LEFT) / (RIGHT - LEFT)));
            stroke.current = { t: start + p * (stop - start), y: event.clientY, revision };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={(event) => {
            const begin = stroke.current;
            stroke.current = null;
            if (!begin || begin.revision !== revision) return;
            const height = event.currentTarget.getBoundingClientRect().height;
            const delta = ((((begin.y - event.clientY) / height) * H) / (BOTTOM - TOP)) * span;
            graphFalloff(selected, channel, Number(axis), begin.t, radius, delta);
          }}
          onPointerCancel={() => {
            stroke.current = null;
          }}
        >
          <path
            d={"M" + LEFT + " " + TOP + "V" + BOTTOM + "H" + RIGHT}
            className="stroke-muted-foreground/40 fill-none"
          />
          <text x={2} y={TOP + 5} className="fill-muted-foreground text-tag">
            {number(max)}
          </text>
          <text x={2} y={BOTTOM} className="fill-muted-foreground text-tag">
            {number(min)}
          </text>
          <text x={LEFT} y={H - 6} className="fill-muted-foreground text-tag">
            {stamp(start)}
          </text>
          <text x={RIGHT} y={H - 6} textAnchor="end" className="fill-muted-foreground text-tag">
            {stamp(stop)}
          </text>
          {ghost.length > 0 && (
            <polyline
              data-camera-graph-ghost
              points={line(ghost)}
              className="stroke-muted-foreground fill-none"
              strokeDasharray="3 3"
            />
          )}
          {group && (
            <rect
              x={x(keys[selected[0]].t)}
              width={x(keys[selected.at(-1)!].t) - x(keys[selected[0]].t)}
              y={TOP}
              height={BOTTOM - TOP}
              className="fill-primary/10 stroke-primary/50"
            />
          )}
          <polyline points={line(data)} className="stroke-primary fill-none" strokeWidth="1.5" />
          {indices.map((i) => {
            const t = keys[i].t;
            const value = data.find((sample) => sample.t === t)?.value ?? min;
            return (
              <circle
                key={i}
                cx={x(t)}
                cy={y(value)}
                r={4}
                role="button"
                tabIndex={0}
                aria-label={"Select keyframe " + (i + 1) + " at " + stamp(t)}
                className={
                  selected.includes(i)
                    ? "fill-primary stroke-foreground"
                    : "fill-foreground stroke-background"
                }
                onClick={(event) => {
                  if (brush && mode === "value") return;
                  if (!event.shiftKey) seekCameraKey(i);
                  else
                    pickCamKeys(
                      selected.includes(i) ? selected.filter((j) => j !== i) : [...selected, i],
                    );
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    seekCameraKey(i);
                  }
                }}
              />
            );
          })}
        </svg>
      ) : (
        <p className="text-muted-foreground text-xs">Add another keyframe to plot this shot.</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          disabled={!data.length}
          onClick={() =>
            ghost.length ? setBuffer(null) : setBuffer({ channel, axis, mode, data })
          }
        >
          {ghost.length ? "Clear buffer" : "Buffer ghost"}
        </Button>
        <Button variant="secondary" size="sm" onClick={addKeyHere}>
          Breakdown
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={!group}
          onClick={() => reverseGraphKeys(selected)}
        >
          Time reverse
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={!group || selected.length < 3}
          onClick={() => equalizeGraphKeys(selected)}
        >
          Equalize
        </Button>
      </div>
      {group && (
        <div className="flex flex-col gap-1" aria-label="Transform box">
          <FieldRow label="Time scale">
            <ValueBox
              name="Time scale"
              value={timeScale}
              onSave={setTimeScale}
              min={1}
              max={400}
              step={5}
              digits={0}
              unit="%"
            />
            <Button
              variant="quiet"
              size="sm"
              onClick={() => scaleGraphTiming(selected, timeScale / 100)}
            >
              Apply time
            </Button>
          </FieldRow>
          <FieldRow label="Value scale">
            <ValueBox
              name="Value scale"
              value={valueScale}
              onSave={setValueScale}
              min={-400}
              max={400}
              step={5}
              digits={0}
              unit="%"
            />
            <Button
              variant="quiet"
              size="sm"
              onClick={() => scaleGraphValues(selected, channel, Number(axis), valueScale / 100)}
            >
              Apply value
            </Button>
          </FieldRow>
        </div>
      )}
      {mode === "value" && (
        <FieldRow label="Falloff brush">
          <Button
            variant={brush ? "default" : "quiet"}
            size="sm"
            aria-pressed={brush}
            disabled={!selected.length}
            onClick={() => setBrush(!brush)}
          >
            Brush
          </Button>
          <ValueBox
            name="Falloff radius"
            value={radius}
            onSave={setRadius}
            min={0.033}
            step={0.1}
            digits={2}
            unit="s"
          />
        </FieldRow>
      )}
      {movable(index) && (
        <>
          <FieldRow label="Channel easing">
            <Select
              items={presets}
              value={preset}
              onValueChange={(value) => {
                if (value)
                  setCurve(
                    value === "inherit"
                      ? undefined
                      : value === "custom"
                        ? [1 / 3, 0, 2 / 3, 1]
                        : value,
                  );
              }}
            >
              <SelectTrigger className="min-w-0 flex-1" aria-label="Channel easing">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {presets.map(({ value, label }) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          {Array.isArray(activeCurve) && (
            <CurveEditor
              value={activeCurve}
              doc={graphDoc}
              preview={(value) => setCurve(value, preview)}
              onSave={(value) => setCurve(value)}
            />
          )}
        </>
      )}
    </Section>
  );
}
