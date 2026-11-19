import { type CameraRig, ORTHOGRAPHIC_DEPTH } from "film-stage/camera";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { type Shutter } from "../../src/shutter";
import { FieldRow, Section, Segmented, ValueBox } from "../components/inspector";
import { S } from "../core/state";
import { get, say, showError, useStudio } from "../core/store";
import { cutWarnings } from "../picture/camera-monitor";
import { readSceneFrame } from "../picture/render";
import { vectorPoint } from "./cam";
import { cancelCameraPick, continuityShotMatches, startContinuityPick } from "./camera-framing";
import { activeCameraRig, visibleCameraShotFrame } from "./camera-rig";
import { buildCameraRail } from "./camera-rail-edit";
import {
  applyCameraRecipe,
  beatsToCameraHits,
  CAMERA_RECIPES,
  type CameraRecipe,
} from "./shot-authoring";
import { type ShotRow, shotsDoc } from "./shots";

const SETUPS = [
  { id: "target", title: "2-node" },
  { id: "one-node", title: "1-node" },
  { id: "tangent", title: "Along path" },
] as const;
const AXES = [
  { id: "native", title: "Native" },
  { id: "horizontal", title: "Horizontal" },
  { id: "vertical", title: "Vertical" },
] as const;
const SHUTTER = [
  { id: "open", title: "Open" },
  { id: "center", title: "Center" },
  { id: "close", title: "Close" },
] as const;

function ContinuityControls({ row, shot }: { row: ShotRow; shot: number }) {
  const pick = useStudio((s) => s.cameraPick);
  const ready = useStudio((s) => s.ready);
  useStudio((s) => s.camRev);
  useStudio((s) => s.timingRev);
  const active = pick?.target === "continuity" && continuityShotMatches(row, pick);
  const { id, t } = row;
  useEffect(
    () => () => {
      const current = get().cameraPick;
      if (current?.target === "continuity" && continuityShotMatches({ id, t }, current))
        cancelCameraPick();
    },
    [id, t],
  );
  return (
    <>
      <p className="text-muted-foreground text-xs">
        {active
          ? `Click the ${pick.first ? "second" : "first"} point on the line of action. Esc cancels.`
          : "Pick two points along the line of action to check the cut into this shot."}
      </p>
      <p role="status" className="text-alarm text-xs empty:hidden">
        {ready && cutWarnings(shot).join(" · ")}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant={active ? "secondary" : "quiet"}
          size="sm"
          aria-pressed={active}
          disabled={!ready}
          onClick={() => (active ? cancelCameraPick() : startContinuityPick(row))}
        >
          {active ? "Cancel axis pick" : "Pick 180° axis"}
        </Button>
        {row.continuityAxis && (
          <Button
            variant="quiet"
            size="sm"
            onClick={() => {
              if (active) cancelCameraPick();
              shotsDoc.edit((rows) => {
                const target = rows.find((shot) => continuityShotMatches(shot, row));
                if (target) delete target.continuityAxis;
              });
            }}
          >
            Clear 180° axis
          </Button>
        )}
      </div>
    </>
  );
}

export function CameraShotSettings({ shot }: { shot: number }) {
  const editable = useStudio((s) => s.shots);
  useStudio((s) => s.shotsRev);
  const ready = useStudio((s) => s.ready);
  const row = shotsDoc.data?.[shot];
  if (!editable || !row) return null;
  const rig = row.camera ?? {},
    shutter = row.shutter ?? {};
  const effectiveRail = activeCameraRig(shot)?.rail;
  const camera = (part: Partial<CameraRig>) =>
    shotsDoc.edit((rows) => {
      if (rows[shot]?.id === row.id) rows[shot].camera = { ...rows[shot].camera, ...part };
    });
  const updateShutter = (part: Partial<Shutter>) =>
    shotsDoc.edit((rows) => {
      if (rows[shot]?.id === row.id) rows[shot].shutter = { ...rows[shot].shutter, ...part };
    });
  const orientation = (look: NonNullable<CameraRig["look"]>) => {
    if (look === "one-node" && effectiveRail) return;
    if (look !== "one-node") return camera({ look, position: undefined });
    const t = visibleCameraShotFrame(shot, S.t);
    if (t === undefined) return say("Show this shot in the timeline before capturing its camera position");
    void readSceneFrame(t, () => {
      const source = S.tools?.camera;
      const clean = S.tools?.cameraSample?.().p;
      if (source)
        camera({ look, position: Array.isArray(clean) ? clean : vectorPoint(source.position) });
    }).catch(showError);
  };
  const setAxis = (mode: "native" | "horizontal" | "vertical") =>
    camera({
      fovAxis: mode === "native" ? undefined : { mode, aspect: S.tools?.camera?.aspect || 16 / 9 },
    });
  const offset = (id: "lensShift" | "frameOffset", axis: number, v: number) => {
    const next = [...(rig[id] ?? [0, 0])] as [number, number];
    next[axis] = v / 100;
    camera({ [id]: next });
  };
  const far = rig.far ?? 500,
    near = rig.near ?? 0.02;
  return (
    <>
      <Section title="Camera recipes" closed>
        <FieldRow label="Recipe">
          <Select<CameraRecipe>
            value={null}
            items={CAMERA_RECIPES.map(({ id, label }) => ({ value: id, label }))}
            onValueChange={(id) => {
              if (id) applyCameraRecipe(shot, id);
            }}
          >
            <SelectTrigger aria-label="Apply camera recipe">
              <SelectValue placeholder="Choose a recipe" />
            </SelectTrigger>
            <SelectContent>
              {CAMERA_RECIPES.map(({ id, label }) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
        <Button variant="secondary" size="sm" onClick={() => beatsToCameraHits(shot)}>
          Beats to camera hits
        </Button>
      </Section>
      {ready && row.camera && Object.keys(row.camera).length > 0 && !S.tools?.cameraRig && (
        <p className="text-muted-foreground px-3 py-2 text-xs">
          This film uses a renderer that ignores its saved camera rig.
        </p>
      )}
      {S.tools?.cameraRig && (
        <Section title="Camera rig" closed>
          {!S.tools.cameraProjection && rig.projection === "orthographic" && (
            <p className="text-muted-foreground text-xs">
              This film’s renderer uses perspective even with orthographic projection saved.
            </p>
          )}
          {!S.tools.cameraRails && (rig.rail || rig.extrapolation === "linear") && (
            <p className="text-muted-foreground text-xs">
              This film’s renderer ignores saved camera rails and path extrapolation.
            </p>
          )}
          {S.tools.cameraProjection && (
            <>
              <Segmented
                label="Projection"
                items={[
                  { id: "perspective", title: "Perspective" },
                  { id: "orthographic", title: "Orthographic" },
                ]}
                value={rig.projection ?? "perspective"}
                onChange={(projection: CameraRig["projection"]) => camera({ projection })}
              />
              {rig.projection === "orthographic" && (
                <FieldRow label="Orthographic reference distance">
                  <ValueBox
                    name="Orthographic reference distance"
                    value={rig.orthographicDepth ?? ORTHOGRAPHIC_DEPTH}
                    min={0.1}
                    step={0.1}
                    digits={1}
                    unit="m"
                    onSave={(orthographicDepth) => camera({ orthographicDepth })}
                  />
                </FieldRow>
              )}
            </>
          )}
          {S.tools.cameraRails && (
            <>
              <Segmented
                label="Path ends"
                items={[
                  { id: "hold", title: "Hold" },
                  { id: "linear", title: "Linear extrapolation" },
                ]}
                value={rig.extrapolation ?? "hold"}
                onChange={(extrapolation: CameraRig["extrapolation"]) => camera({ extrapolation })}
              />
              <FieldRow label="Camera rail">
                {rig.rail ? (
                  <Button variant="quiet" size="sm" onClick={() => camera({ rail: undefined })}>
                    Remove rail
                  </Button>
                ) : (
                  <Button
                    variant="quiet"
                    size="sm"
                    disabled={rig.look === "one-node"}
                    onClick={() => buildCameraRail(shot)}
                  >
                    Build rail from keys
                  </Button>
                )}
              </FieldRow>
            </>
          )}
          <Segmented
            label="Aim mode"
            items={effectiveRail ? SETUPS.filter(({ id }) => id !== "one-node") : [...SETUPS]}
            value={rig.look ?? "target"}
            onChange={orientation}
          />
          <FieldRow label="Lookahead">
            <ValueBox
              name="Aim lookahead"
              value={rig.lead ?? 0}
              min={-2}
              max={2}
              step={0.05}
              digits={2}
              unit="s"
              onSave={(lead) => camera({ lead })}
            />
          </FieldRow>
          <FieldRow label="Auto-banking">
            <ValueBox
              name="Auto banking"
              value={rig.bank ?? 0}
              min={-5}
              max={5}
              step={0.1}
              digits={1}
              unit="×"
              onSave={(bank) => camera({ bank })}
            />
          </FieldRow>
          <FieldRow label="Up vector">
            {(["X", "Y", "Z"] as const).map((axis, i) => (
              <ValueBox
                key={axis}
                name={"Up vector " + axis}
                value={(rig.up ?? [0, 1, 0])[i]}
                min={-1}
                max={1}
                step={0.1}
                digits={2}
                onSave={(value) => {
                  const up = [...(rig.up ?? [0, 1, 0])] as [number, number, number];
                  up[i] = value;
                  camera({ up });
                }}
              />
            ))}
          </FieldRow>
          {(
            [
              { id: "frameOffset", label: "Frame offset" },
              { id: "lensShift", label: "Lens shift" },
            ] as const
          ).map(({ id, label }) => (
            <FieldRow key={id} label={label}>
              {(["X", "Y"] as const).map((axis, i) => (
                <ValueBox
                  key={axis}
                  name={label + " " + axis}
                  value={(rig[id]?.[i] ?? 0) * 100}
                  min={-100}
                  max={100}
                  step={1}
                  digits={1}
                  unit="%"
                  onSave={(v) => offset(id, i, v)}
                />
              ))}
            </FieldRow>
          ))}
          <Segmented
            label="FOV axis lock"
            items={[...AXES]}
            value={rig.fovAxis?.mode ?? "native"}
            onChange={setAxis}
          />
          <FieldRow label="Clip near / far">
            <ValueBox
              name="Clip near"
              value={near}
              min={0.001}
              max={far - 0.01}
              step={0.01}
              digits={3}
              unit="m"
              onSave={(near) => camera({ near })}
            />
            <ValueBox
              name="Clip far"
              value={far}
              min={near + 0.01}
              max={10000}
              step={10}
              digits={2}
              unit="m"
              onSave={(far) => camera({ far })}
            />
          </FieldRow>
          {S.tools.cameraGroups?.map((group) => {
            const hiding = rig.hideGroups ?? [];
            return (
              <label key={group} className="flex items-center gap-2 text-xs">
                <Checkbox
                  aria-label={"Hide " + group}
                  checked={hiding.includes(group)}
                  onCheckedChange={(on) =>
                    camera({
                      hideGroups: on ? [...hiding, group] : hiding.filter((name) => name !== group),
                    })
                  }
                />
                Hide {group}
              </label>
            );
          })}
          <Button
            variant="quiet"
            size="sm"
            disabled={!row.camera}
            onClick={() =>
              shotsDoc.edit((rows) => {
                if (rows[shot]?.id === row.id) delete rows[shot].camera;
              })
            }
          >
            Reset camera rig
          </Button>
        </Section>
      )}
      {shot > 0 && (
        <Section title="Continuity" closed>
          <ContinuityControls row={row} shot={shot} />
        </Section>
      )}
      <Section title="Shutter" closed>
        <FieldRow label="Shutter angle">
          <ValueBox
            name="Shutter angle"
            value={shutter.angle ?? 180}
            min={0}
            max={360}
            step={5}
            digits={0}
            unit="°"
            onSave={(angle) => updateShutter({ angle })}
          />
        </FieldRow>
        <Segmented
          label="Shutter timing"
          items={[...SHUTTER]}
          value={shutter.timing ?? "open"}
          onChange={(timing) => updateShutter({ timing })}
        />
        <FieldRow label="Shutter phase">
          <ValueBox
            name="Shutter phase"
            value={shutter.phase ?? 0}
            min={-1}
            max={1}
            step={0.05}
            digits={2}
            unit="fr"
            onSave={(phase) => updateShutter({ phase })}
          />
        </FieldRow>
        {S.tools?.apertureSampling && (
          <FieldRow label="Final DOF samples">
            <ValueBox
              name="Final aperture samples"
              value={shutter.apertureSamples ?? 1}
              min={1}
              max={32}
              step={1}
              digits={0}
              onSave={(apertureSamples) => updateShutter({ apertureSamples })}
            />
          </FieldRow>
        )}
        <Button
          variant="quiet"
          size="sm"
          disabled={!row.shutter}
          onClick={() =>
            shotsDoc.edit((rows) => {
              if (rows[shot]?.id === row.id) delete rows[shot].shutter;
            })
          }
        >
          Reset shutter
        </Button>
      </Section>
    </>
  );
}
