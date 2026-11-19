import { SHOT_SIZES, type ShotSize } from "film-kit/lens";
import { PRIME_LENSES } from "film-stage/camera";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { FieldRow, Section, ValueBox } from "../components/inspector";
import { NumberField } from "../components/NumberField";
import { S } from "../core/state";
import { get, showError, useStudio } from "../core/store";
import { SAME } from "../core/time";
import { seekExact, setPlaying } from "../playback/transport";
import {
  cameraKeyMatches,
  cameraKeySampleTime,
  cameraKeyShotIndex,
  edit,
  keys,
  railPositionForKey,
} from "./cam";
import {
  addVertigo,
  cameraCoordinates,
  cameraFitTargets,
  cancelCameraPick,
  changeCameraCoordinate,
  copyRelativeCamera,
  fitCameraBox,
  nudgeCamera,
  pasteRelativeCamera,
  selectCameraAnchor,
  startCameraPick,
  swapCameraLens,
} from "./camera-framing";
import { activeCameraRig } from "./camera-rig";
import type { CameraAimPick } from "./slice";

const axes = ["X", "Y", "Z"];
const nudgeAxes = [
  { id: "right", title: "Truck" },
  { id: "up", title: "Pedestal" },
  { id: "forward", title: "Dolly" },
] as const;

export function CameraFraming({
  index: i,
  section = "basic",
}: {
  index: number;
  section?: "basic" | "advanced";
}) {
  useStudio((s) => s.ready);
  useStudio((s) => s.shotsRev);
  const key = keys[i];
  const pick = useStudio((state) => state.cameraPick);
  const [amount, setAmount] = useState(0.1);
  const [fit, setFit] = useState<string[]>([]);
  const disabled = !!key.locked;
  const rig = activeCameraRig(cameraKeyShotIndex(i));
  const tripod = rig?.look === "one-node";
  const onRail = !!rig?.rail;
  const parallel = rig?.projection === "orthographic";
  const railU = onRail ? (railPositionForKey(i) ?? 0) : 0;
  const candidates = S.tools?.cameraAnchors ?? [];
  const fitItems = [...cameraFitTargets().keys()];
  const anchorItems = [
    { value: "world", label: "World" },
    ...candidates.map(({ target, label }) => ({ value: target, label })),
  ];
  const sourceRow = key.__timing?.sourceRow;
  const cut = !!key.cut;
  useEffect(() => {
    if (section !== "basic") return;
    return () => {
      const current = get().cameraPick;
      if (
        current?.target === undefined &&
        current?.field === "l" &&
        current.id === key.id &&
        current.t === key.t &&
        current.sourceRow === sourceRow &&
        !!current.cut === cut
      )
        cancelCameraPick();
    };
  }, [section, key.id, key.t, sourceRow, cut, disabled]);
  const arm = (field: CameraAimPick["field"]) => {
    if (
      pick?.target === undefined &&
      pick?.field === field &&
      cameraKeyMatches(key, pick) &&
      Math.abs(pick.t - key.t) < SAME
    ) {
      cancelCameraPick();
      return;
    }
    if (S.playing) setPlaying(false);
    seekExact(cameraKeySampleTime(i));
    startCameraPick(i, field);
  };
  if (section === "advanced") {
    return (
      <div className="flex flex-col gap-2">
        {onRail && (
          <FieldRow label="Rail position">
            <ValueBox
              name="Rail position"
              value={railU}
              disabled={disabled || key.muted}
              min={0}
              max={1}
              step={0.01}
              digits={3}
              onSave={(railU) =>
                edit((rows) => {
                  rows[i].railU = railU;
                })
              }
            />
          </FieldRow>
        )}
        {(onRail ? (["l"] as const) : (["p", "l"] as const)).map((field) => {
          const title = field === "p" ? "Position" : "Aim";
          const point = key[field];
          const anchored = !Array.isArray(point);
          const target = anchored && typeof point.target === "string" ? point.target : null;
          const targetValue = target ?? (anchored ? "film" : "world");
          const items = anchorItems.some((item) => item.value === targetValue)
            ? anchorItems
            : [...anchorItems, { value: targetValue, label: target ?? "Film anchor" }];
          const coordinates = cameraCoordinates(point);
          return (
            <div key={field} className="flex flex-col gap-1">
              <FieldRow label={title}>
                <Select
                  items={items}
                  value={targetValue}
                  disabled={disabled || (!S.tools?.moveCameraAnchor && !anchored)}
                  onValueChange={(value) => {
                    if (value !== null && value !== "film")
                      selectCameraAnchor(i, field, value === "world" ? null : value);
                  }}
                >
                  <SelectTrigger aria-label={title + " anchor"} className="min-w-0 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {items.map(({ value, label }) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldRow>
              {target && (
                <label className="text-muted-foreground flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={!Array.isArray(point) && point.space === "view"}
                    disabled={disabled || !S.tools?.moveCameraAnchor}
                    onChange={(event) =>
                      selectCameraAnchor(i, field, target, event.target.checked ? "view" : "world")
                    }
                  />
                  {title} View Offset
                </label>
              )}
              <div className="grid grid-cols-3 gap-1.5">
                {coordinates.map((value, axis) => (
                  <label
                    key={axes[axis]}
                    className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs"
                  >
                    {axes[axis]}
                    <NumberField
                      name={title + (anchored ? " offset " : " ") + axes[axis]}
                      size="sm"
                      disabled={disabled}
                      value={value}
                      step={0.05}
                      digits={3}
                      className="min-w-0"
                      onSave={(next) => {
                        if (next !== undefined) changeCameraCoordinate(i, field, axis, next);
                      }}
                    />
                  </label>
                ))}
              </div>
            </div>
          );
        })}
        <FieldRow label="Swap lens">
          <Select<number>
            value={null}
            disabled={disabled || onRail || parallel}
            onValueChange={(value) => {
              if (value !== null) swapCameraLens(i, value);
            }}
          >
            <SelectTrigger aria-label="Swap lens and hold subject size" className="min-w-0 flex-1">
              <SelectValue placeholder="Keep subject size" />
            </SelectTrigger>
            <SelectContent>
              {PRIME_LENSES.map(({ mm }) => (
                <SelectItem key={mm} value={mm}>
                  {mm} mm
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled || onRail || parallel}
            onClick={() => addVertigo(i)}
          >
            Add Vertigo
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void copyRelativeCamera(i).catch(showError);
            }}
          >
            Copy relative
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={() => pasteRelativeCamera(i)}
          >
            Paste relative
          </Button>
        </div>
      </div>
    );
  }
  return (
    <Section title="Framing">
      <div className="flex flex-wrap gap-1.5">
        <Button
          variant={pick?.target === undefined && pick?.field === "l" ? "default" : "secondary"}
          size="sm"
          aria-pressed={pick?.target === undefined && pick?.field === "l"}
          disabled={disabled}
          onClick={() => arm("l")}
        >
          Pick aim point
        </Button>
      </div>
      <FieldRow label={tripod ? "Tripod move step" : "Move step"}>
        <ValueBox
          name="Camera move step"
          min={0.001}
          max={100}
          step={0.05}
          digits={3}
          unit="m"
          value={amount}
          onSave={setAmount}
          disabled={disabled || onRail}
        />
      </FieldRow>
      <div className="grid grid-cols-3 gap-1.5">
        {nudgeAxes.map(({ id, title }) => (
          <div key={id} className="text-muted-foreground grid grid-cols-2 gap-1 text-xs">
            <span className="col-span-2">{title}</span>
            <Button
              variant="secondary"
              size="sm"
              aria-label={title + " negative"}
              disabled={disabled || onRail}
              onClick={() => nudgeCamera(i, id, -amount)}
            >
              −
            </Button>
            <Button
              variant="secondary"
              size="sm"
              aria-label={title + " positive"}
              disabled={disabled || onRail}
              onClick={() => nudgeCamera(i, id, amount)}
            >
              +
            </Button>
          </div>
        ))}
      </div>
      {fitItems.length > 0 && !onRail && (
        <Section title="Fit box" closed>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Fit subjects">
            {fitItems.map((name) => (
              <Button
                key={name}
                size="sm"
                variant={fit.includes(name) ? "default" : "quiet"}
                aria-pressed={fit.includes(name)}
                disabled={disabled}
                onClick={() =>
                  setFit((old) =>
                    old.includes(name) ? old.filter((n) => n !== name) : [...old, name],
                  )
                }
              >
                {name}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Shot size">
            {(Object.keys(SHOT_SIZES) as ShotSize[]).map((size) => (
              <Button
                key={size}
                size="sm"
                variant="secondary"
                disabled={disabled || !fit.length}
                onClick={() => fitCameraBox(i, fit, size)}
              >
                {size}
              </Button>
            ))}
          </div>
        </Section>
      )}
    </Section>
  );
}
