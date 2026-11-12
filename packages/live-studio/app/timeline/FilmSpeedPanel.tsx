import { ArrowRight, CircleSlash, SlidersHorizontal, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { sampleSpeedCurve, smoothSpeedCurve } from "../../src/speed-curve.mjs";
import { timing, timingClock } from "../../src/timing-state.mjs";
import { freezesOf } from "../../src/timing.mjs";
import { shownShot } from "../camera/anim";
import { CameraEasePanel } from "../camera/SpeedPanel";
import {
  FieldRow,
  Reset,
  SaveStatus,
  Section,
  Segmented,
  SliderRow,
  ValueBox,
} from "../components/inspector";
import { S } from "../core/state";
import { useStudio } from "../core/store";
import { useFrame } from "../core/useFrame";
import { SpeedCurve } from "./SpeedCurve";
import {
  removeFreeze,
  setFreezeDuration,
  setShotSpeed,
  shotSpeed,
  shotVelocity,
  sourceShot,
  timingDoc,
} from "./timing";
import { VelocityPanel } from "./VelocityPanel";

type Curve = [number, number][];
const presets: { title: string; curve: Curve }[] = [
  {
    title: "Montage",
    curve: [
      [0, 1],
      [0.3, 4],
      [0.55, 1],
      [0.7, 0.3],
      [1, 1],
    ],
  },
  {
    title: "Hero",
    curve: [
      [0, 1],
      [0.25, 3],
      [0.45, 0.3],
      [0.65, 3],
      [1, 1],
    ],
  },
  {
    title: "Bullet",
    curve: [
      [0, 3],
      [0.25, 3],
      [0.5, 0.3],
      [0.75, 3],
      [1, 3],
    ],
  },
  {
    title: "Jump cut",
    curve: [
      [0, 0.5],
      [0.3, 0.5],
      [0.5, 5],
      [0.7, 0.5],
      [1, 0.5],
    ],
  },
  {
    title: "Flash in",
    curve: [
      [0, 4],
      [0.3, 4],
      [0.7, 1],
      [1, 1],
    ],
  },
  {
    title: "Flash out",
    curve: [
      [0, 1],
      [0.3, 1],
      [0.7, 4],
      [1, 4],
    ],
  },
];
const flat: Curve = [
  [0, 1],
  [0.25, 1],
  [0.5, 1],
  [0.75, 1],
  [1, 1],
];
const sameCurve = (a: Curve, b: Curve | undefined) =>
  !!b && a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);
export function CurvePicture({ curve }: { curve: Curve }) {
  const smooth = smoothSpeedCurve(curve);
  const points = Array.from(
    { length: 65 },
    (_, i) => `${4 + (i / 64) * 40},${24 - Math.log10(sampleSpeedCurve(smooth, i / 64)) * 18}`,
  ).join(" ");
  return (
    <svg aria-hidden viewBox="0 0 48 48" className="size-full">
      <path d="M4 24H44" className="stroke-raised-4" strokeDasharray="2 2" />
      <polyline
        points={points}
        fill="none"
        className="stroke-warn"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function FilmSpeedPanel() {
  const enabled = useStudio((s) => s.timing),
    freezePick = useStudio((s) => s.freezePick),
    saved = useStudio((s) => s.timingSaved);
  useStudio((s) => s.timingRev);
  useStudio((s) => s.shotPick);
  useFrame();
  const [tab, setTab] = useState<"standard" | "curve" | "velocity">("standard");
  const speedPreview = useRef<string | null>(null);
  const speedDoc = {
    snapshot: () => (speedPreview.current = timingDoc.snapshot()),
    restore: (snap: string) => {
      timingDoc.restore(snap);
      speedPreview.current = null;
    },
  };
  // The scroller lives here, not in CameraEasePanel: inside the Camera tab's own scroller a second overscroll-contain one swallowed the wheel
  if (!enabled)
    return (
      <div
        data-arrow-scroll
        className="scroll-fade flex min-h-0 flex-1 flex-col overflow-auto overscroll-contain pb-3 *:shrink-0"
      >
        <CameraEasePanel />
      </div>
    );
  const freezes = freezesOf(timing);
  const freeze = freezePick === null ? null : freezes[freezePick];
  if (freeze && !freeze.blank)
    return (
      <Section
        title="Freeze frame"
        right={
          <Button
            variant="quiet"
            size="icon"
            aria-label="Delete freeze frame"
            onClick={() => removeFreeze(freezePick!)}
          >
            <Trash2 />
          </Button>
        }
      >
        <SaveStatus state={saved} hideWhenIdle className="block pb-1" />
        <FieldRow label="Duration">
          <ValueBox
            name="Freeze duration"
            value={freeze.duration}
            step={1 / 30}
            digits={2}
            unit="s"
            min={1 / 30}
            max={600}
            onSave={(v) => setFreezeDuration(freezePick!, v)}
          />
        </FieldRow>
      </Section>
    );
  const shot = shownShot(),
    speed = shotSpeed(shot),
    [from, to] = sourceShot(shot);
  const rate = speed?.rate ?? 1,
    curve = shotVelocity(shot) ? undefined : speed?.curve;
  if (to <= from)
    return (
      <p className="text-ui text-muted-foreground px-3">
        Select a clip on the Camera track to change its speed.
      </p>
    );
  const duration = timingClock.outputAt(to, "before") - timingClock.outputAt(from);
  const held = freezes.reduce(
    (sum, f) =>
      sum +
      (!f.blank && f.at > from && f.at < to
        ? f.duration + (f.padBefore ?? 0) + (f.padAfter ?? 0)
        : 0),
    0,
  );
  const matched = presets.find((p) => sameCurve(p.curve, curve))?.title;
  return (
    <div
      data-arrow-scroll
      className="scroll-fade flex min-h-0 flex-1 flex-col overflow-auto overscroll-contain pb-3 *:shrink-0"
    >
      <SaveStatus state={saved} hideWhenIdle className="block px-3 pb-1" />
      <Segmented
        className="mx-3 mb-3"
        label="Speed mode"
        value={tab}
        onChange={setTab}
        items={[
          { id: "standard", title: "Standard" },
          { id: "curve", title: "Curve" },
          { id: "velocity", title: "Velocity effects" },
        ]}
      />
      {tab === "standard" && (
        <Section
          title="Speed"
          right={<Reset label="Reset speed" onClick={() => setShotSpeed(shot, null)} />}
        >
          <SliderRow
            label="Shot speed"
            value={rate}
            min={0.1}
            max={10}
            step={0.01}
            digits={2}
            unit="×"
            doc={speedDoc}
            preview={(v) => {
              if (speedPreview.current) timingDoc.restore(speedPreview.current);
              setShotSpeed(shot, { rate: v }, true);
            }}
            save={(v) => setShotSpeed(shot, { rate: v })}
          />
          <FieldRow label="Duration">
            <span className="text-ui tabular-nums">{(to - from).toFixed(2)}s</span>
            <ArrowRight className="text-muted-foreground mx-2 size-4 flex-1" />
            <ValueBox
              name="Shot duration"
              value={duration}
              step={1 / 30}
              digits={2}
              unit="s"
              min={(to - from) / 10 + held}
              max={(to - from) * 10 + held}
              onSave={(v) =>
                setShotSpeed(shot, { rate: Math.max(0.1, Math.min(10, (to - from) / (v - held))) })
              }
            />
          </FieldRow>
        </Section>
      )}
      {tab === "curve" && (
        <>
          <ul aria-label="Speed curves" className="grid grid-cols-4 gap-x-2.5 gap-y-3 px-3 py-2">
            {[
              { title: "None", curve: null },
              { title: "Custom", curve: curve ?? flat },
              ...presets,
            ].map((p) => {
              const selected =
                p.title === "None"
                  ? !speed || !!shotVelocity(shot)
                  : p.title === "Custom"
                    ? !!curve && !matched
                    : matched === p.title;
              return (
                <li key={p.title} className="flex min-w-0 flex-col items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Speed curve ${p.title}`}
                    aria-pressed={selected}
                    onClick={() =>
                      setShotSpeed(
                        shot,
                        p.curve ? smoothSpeedCurve(structuredClone(p.curve)) : null,
                      )
                    }
                    className="bg-raised-2 text-warn hover:ring-border focus-visible:ring-ring aria-pressed:ring-primary relative grid aspect-square w-full place-items-center overflow-hidden rounded-md ring-2 ring-transparent outline-none"
                  >
                    {p.title === "None" ? (
                      <CircleSlash className="text-muted-foreground size-6" />
                    ) : p.title === "Custom" ? (
                      <SlidersHorizontal className="size-6" />
                    ) : (
                      <CurvePicture curve={p.curve!} />
                    )}
                  </button>
                  <span className="w-full truncate text-center text-xs">{p.title}</span>
                </li>
              );
            })}
          </ul>
          {curve && (
            <div className="bg-curve mx-3 my-3 overflow-hidden rounded-md">
              <p className="text-ui flex justify-between border-b px-3 py-2 tabular-nums">
                <span>Duration</span>
                <span>
                  {(to - from).toFixed(2)}s → {duration.toFixed(2)}s
                </span>
              </p>
              <SpeedCurve
                key={shot}
                value={curve}
                handles={speed?.handles}
                playhead={(timingClock.sourceAt(S.t) - from) / (to - from)}
                doc={timingDoc}
                preview={(value) => setShotSpeed(shot, smoothSpeedCurve(value), true)}
                save={(value) => setShotSpeed(shot, smoothSpeedCurve(value))}
              />
            </div>
          )}
        </>
      )}
      {tab === "velocity" && <VelocityPanel key={shot} shot={shot} />}
    </div>
  );
}
