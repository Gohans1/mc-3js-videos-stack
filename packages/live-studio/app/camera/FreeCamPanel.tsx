import { mmOf, SHAKES } from "film-stage/camera";
import {
  ArrowDown,
  LockKeyhole,
  LockKeyholeOpen,
  MoonStar,
  Move3d,
  PersonStanding,
  Plane,
  Redo2,
  Save,
  Undo2,
} from "lucide-react";

import { Button } from "@/components/ui/button";

import { FieldRow, Reset, Section, SliderRow } from "../components/inspector";
import { NumberField } from "../components/NumberField";
import { Tip } from "../components/Tip";
import { engine } from "../core/engine";
import { FLY_SPEED } from "../core/prefs";
import { S } from "../core/state";
import { set, setPref, useStudio } from "../core/store";
import { useFrameKey } from "../core/useFrameKey";
import {
  applyFreeToKeyframe,
  axisView,
  defaultFreeFov,
  ensureFreeActive,
  FREE_LENS_DEFAULTS,
  freeHistoryCounts,
  isCustomFreeFov,
  resetFreeDof,
  resetFreeFeel,
  resetFreeFov,
  resetFreeLensAll,
  restoreFreeView,
  setFreeBob,
  setFreeFocus,
  setFreeFstop,
  setFreeHandheld,
  setFreeLock,
  setFreeLook,
  setFreeMm,
  setFreeNavigation,
  setFreePoseCoordinate,
  startFreePick,
} from "../picture/freecam";
import {
  FreeCamFovSlider,
  FreeCamRollSlider,
  FreeCamSwaySlider,
  freeDoc,
} from "../picture/FreeCamLens";
import { cancelCameraPick } from "./camera-framing";
import {
  FocalLengthRow,
  FocusControls,
  HandheldControls,
  type HandheldUiValue,
} from "./OpticsWidgets";

const AXES = ["X", "Y", "Z"] as const;

export function FreeCamPanel() {
  useStudio((s) => s.ready);
  useStudio((s) => s.freePoseRev);
  useStudio((s) => s.freeHistoryRev);
  const free = useStudio((s) => s.free);
  const locked = useStudio((s) => s.freeLocked);
  const walk = useStudio((s) => s.freeNavigation === "walk");
  const night = useStudio((s) => s.nightVision);
  const freeLook = useStudio((s) => s.freeLook);
  const flySpeed = useStudio((s) => s.flySpeed);
  const fov = useStudio((s) => s.freeFov);
  const roll = useStudio((s) => s.freeRoll);
  const wave = useStudio((s) => s.freeWave);
  const bob = useStudio((s) => s.freeBob);
  const fstop = useStudio((s) => s.freeFstop);
  const focus = useStudio((s) => s.freeFocus);
  const handheld = useStudio((s) => s.freeHandheld);
  const pick = useStudio((s) => s.cameraPick);
  const pickFocus = useStudio((s) => s.pickFocus === "free");

  useFrameKey(() => {
    const cam = S.tools?.free;
    if (!cam?.on) return isCustomFreeFov() ? "off" : `off:${defaultFreeFov()}`;
    return `${cam.p.x.toFixed(3)},${cam.p.y.toFixed(3)},${cam.p.z.toFixed(3)}|${cam.l.x.toFixed(3)},${cam.l.y.toFixed(3)},${cam.l.z.toFixed(3)}`;
  });

  const defFov = defaultFreeFov();
  const effectiveFov = !free && !isCustomFreeFov() ? defFov : fov;
  const aspect = S.tools?.camera?.aspect || 16 / 9;
  const mm = mmOf(effectiveFov, aspect);
  const history = freeHistoryCounts();
  const f = S.tools?.free;
  const pos = f?.p ? [f.p.x, f.p.y, f.p.z] : [0, 0, 0];
  const aim = f?.l ? [f.l.x, f.l.y, f.l.z] : [0, 0, 0];

  const isAllDefault =
    Math.abs(effectiveFov - defFov) < 0.05 &&
    Math.abs(roll - FREE_LENS_DEFAULTS.roll) < 1e-3 &&
    Math.abs(wave - FREE_LENS_DEFAULTS.wave) < 1e-3 &&
    Math.abs(bob - FREE_LENS_DEFAULTS.bob) < 1e-3 &&
    Math.abs(fstop - FREE_LENS_DEFAULTS.fstop) < 1e-3 &&
    focus === undefined &&
    !handheld;

  const handleSelectShake = (choice: string) => {
    ensureFreeActive();
    if (choice === "off") setFreeHandheld(false);
    else {
      const shakeName = SHAKES.find((name) => name === choice);
      if (shakeName) setFreeHandheld(shakeName);
    }
  };
  const handleUpdateShake = (
    shake: HandheldUiValue,
    prop: keyof HandheldUiValue,
    value: number,
  ) => {
    ensureFreeActive();
    setFreeHandheld({ ...shake, [prop]: value });
  };

  return (
    <div className="flex flex-col gap-2">
      {!free && (
        <div className="bg-card mx-3 flex flex-col gap-2 rounded-lg border p-3">
          <p className="text-ui text-muted-foreground">
            Move freely around the scene without changing keyframes until you apply.
          </p>
          <Button size="sm" onClick={() => engine.setFree(true)}>
            <Move3d data-icon="inline-start" aria-hidden />
            Enter Free camera (F)
          </Button>
        </div>
      )}

      <Section
        title="Free camera"
        right={
          <Reset
            label="Reset free camera lens and feel to default"
            disabled={isAllDefault}
            onClick={resetFreeLensAll}
          />
        }
      >
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant={free ? "default" : "secondary"}
            aria-pressed={free}
            onClick={() => engine.setFree(!free)}
          >
            <Move3d data-icon="inline-start" aria-hidden />
            Free camera
          </Button>
          <Button
            size="sm"
            variant={night ? "default" : "quiet"}
            aria-pressed={night}
            onClick={() => {
              ensureFreeActive();
              setPref("nightVision", !night);
            }}
          >
            <MoonStar data-icon="inline-start" aria-hidden />
            Night vision
          </Button>
          <Button
            size="sm"
            variant={walk ? "default" : "quiet"}
            aria-pressed={walk}
            disabled={locked}
            onClick={() => {
              ensureFreeActive();
              setFreeNavigation(walk ? "fly" : "walk");
            }}
          >
            {walk ? (
              <PersonStanding data-icon="inline-start" aria-hidden />
            ) : (
              <Plane data-icon="inline-start" aria-hidden />
            )}
            {walk ? "Walk 1.62m" : "Fly"}
          </Button>
          <Button
            size="sm"
            variant={locked ? "default" : "quiet"}
            aria-pressed={locked}
            onClick={() => {
              ensureFreeActive();
              setFreeLock(!locked);
            }}
          >
            {locked ? (
              <LockKeyhole data-icon="inline-start" aria-hidden />
            ) : (
              <LockKeyholeOpen data-icon="inline-start" aria-hidden />
            )}
            Lock view
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="quiet"
            aria-label="Free cam history back"
            disabled={!free || locked || history.back === 0}
            onClick={() => restoreFreeView(-1)}
          >
            <Undo2 data-icon="inline-start" aria-hidden />
            Back
          </Button>
          <Button
            size="sm"
            variant="quiet"
            aria-label="Free cam history forward"
            disabled={!free || locked || history.forward === 0}
            onClick={() => restoreFreeView(1)}
          >
            <Redo2 data-icon="inline-start" aria-hidden />
            Forward
          </Button>
          <span className="flex-1" />
          <Button
            size="sm"
            variant="quiet"
            disabled={locked}
            onClick={() => {
              ensureFreeActive();
              axisView("top");
            }}
          >
            <ArrowDown data-icon="inline-start" aria-hidden />
            Top
          </Button>
          <Button
            size="sm"
            variant="quiet"
            disabled={locked}
            onClick={() => {
              ensureFreeActive();
              axisView("front");
            }}
          >
            Front
          </Button>
          <Button
            size="sm"
            variant="quiet"
            disabled={locked}
            onClick={() => {
              ensureFreeActive();
              axisView("side");
            }}
          >
            Side
          </Button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Tip label="Save framing, lens, aperture, focus, roll, and shake into the current or new keyframe (Shift+K)">
            <Button
              size="sm"
              variant="default"
              className="flex-1"
              disabled={!free}
              onClick={() => applyFreeToKeyframe()}
            >
              <Save data-icon="inline-start" aria-hidden />
              Apply to keyframe
            </Button>
          </Tip>
        </div>

        <FreeCamFovSlider onAutoEnter={ensureFreeActive} />
        <FocalLengthRow
          mm={mm}
          onApplyMm={(v) => {
            ensureFreeActive();
            setFreeMm(v);
          }}
          reset={{
            label: "Reset free camera focal length to default",
            disabled: Math.abs(effectiveFov - defFov) < 0.05,
            onClick: resetFreeFov,
          }}
        />
        <SliderRow
          label="Aperture"
          value={fstop}
          min={0}
          max={32}
          digits={1}
          step={0.1}
          unit="f"
          doc={freeDoc}
          preview={(v) => {
            ensureFreeActive();
            setFreeFstop(v);
          }}
          save={(v) => {
            ensureFreeActive();
            setFreeFstop(v);
          }}
          reset={{
            label: "Reset free camera aperture to default",
            disabled: fstop <= 1e-3,
            onClick: () => setFreeFstop(FREE_LENS_DEFAULTS.fstop),
          }}
          hint={fstop === 0 ? "Deep focus" : undefined}
        />
        <FocusControls
          syncKey="free"
          authoredFocus={focus}
          effectiveFocus={focus}
          pickingFocus={pickFocus}
          onTogglePickFocus={() => {
            if (pickFocus) {
              set({ pickFocus: null });
              return;
            }
            ensureFreeActive();
            set({ pickFocus: "free", cameraPick: null });
          }}
          onCommitFocus={(next) => {
            ensureFreeActive();
            setFreeFocus(next);
          }}
          onPreviewFocus={(next) => {
            ensureFreeActive();
            setFreeFocus(next);
          }}
          snapshotFn={freeDoc.snapshot}
          restoreFn={freeDoc.restore}
          resetLabel="Reset free camera focus to default"
        />
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="quiet"
            disabled={fstop <= 1e-3 && focus === undefined}
            onClick={resetFreeDof}
          >
            Reset aperture & focus
          </Button>
        </div>
        <FreeCamRollSlider onAutoEnter={ensureFreeActive} />
        <FreeCamSwaySlider onAutoEnter={ensureFreeActive} />
        <SliderRow
          label="Walking bob"
          value={bob}
          min={0}
          max={3}
          step={0.05}
          digits={2}
          unit="×"
          doc={freeDoc}
          preview={(v) => {
            ensureFreeActive();
            setFreeBob(v);
          }}
          save={(v) => {
            ensureFreeActive();
            setFreeBob(v);
          }}
          reset={{
            label: "Reset free camera bob to default",
            disabled: Math.abs(bob - FREE_LENS_DEFAULTS.bob) < 1e-3,
            onClick: () => setFreeBob(FREE_LENS_DEFAULTS.bob),
          }}
        />
        <HandheldControls
          authored={handheld}
          effective={handheld}
          section="basic"
          onSelectPreset={handleSelectShake}
          onUpdateField={handleUpdateShake}
          onResetAll={() => setFreeHandheld(false)}
        />
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="quiet"
            disabled={
              Math.abs(wave - FREE_LENS_DEFAULTS.wave) < 1e-3 &&
              Math.abs(bob - FREE_LENS_DEFAULTS.bob) < 1e-3 &&
              !handheld
            }
            onClick={resetFreeFeel}
          >
            Reset handheld & bob
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant={pick?.target === "free" && pick.field === "l" ? "default" : "secondary"}
            size="sm"
            aria-pressed={pick?.target === "free" && pick.field === "l"}
            onClick={() => {
              if (pick?.target === "free" && pick.field === "l") cancelCameraPick();
              else startFreePick("l");
            }}
          >
            Pick aim point
          </Button>
        </div>
      </Section>

      <Section title="Advanced" closed>
        <SliderRow
          label="Fly speed"
          value={flySpeed}
          min={FLY_SPEED.min}
          max={FLY_SPEED.max}
          step={0.5}
          digits={1}
          unit="m/s"
          doc={{
            snapshot: () => String(flySpeed),
            restore: (s) => setPref("flySpeed", Number(s) || FLY_SPEED.start),
          }}
          preview={(v) => setPref("flySpeed", v)}
          save={(v) => setPref("flySpeed", v)}
          reset={{
            label: "Reset fly speed to default",
            disabled: Math.abs(flySpeed - FLY_SPEED.start) < 1e-3,
            onClick: () => setPref("flySpeed", FLY_SPEED.start),
          }}
        />
        <FieldRow
          label="Overlays"
          nav={
            <Reset
              compact
              label="Reset preview film overlays to default"
              disabled={freeLook}
              onClick={() => {
                ensureFreeActive();
                setFreeLook(true);
              }}
            />
          }
        >
          <Button
            size="sm"
            variant={freeLook ? "default" : "quiet"}
            aria-pressed={freeLook}
            onClick={() => {
              ensureFreeActive();
              setFreeLook(!freeLook);
            }}
          >
            Preview film overlays
          </Button>
        </FieldRow>
        {(
          [
            { field: "p", title: "Position", values: pos },
            { field: "l", title: "Aim", values: aim },
          ] as const
        ).map(({ field, title, values }) => (
          <div key={field} className="flex flex-col gap-1">
            <span className="text-ui text-foreground/90">{title}</span>
            <div className="grid grid-cols-3 gap-1.5">
              {AXES.map((axis, idx) => (
                <label
                  key={axis}
                  className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs"
                >
                  {axis}
                  <NumberField
                    name={`Free cam ${title} ${axis}`}
                    size="sm"
                    value={values[idx]}
                    step={0.05}
                    digits={3}
                    className="min-w-0"
                    onSave={(next) => {
                      if (next !== undefined) setFreePoseCoordinate(field, idx as 0 | 1 | 2, next);
                    }}
                  />
                </label>
              ))}
            </div>
          </div>
        ))}
        <HandheldControls
          authored={handheld}
          effective={handheld}
          section="advanced"
          onSelectPreset={handleSelectShake}
          onUpdateField={handleUpdateShake}
          onResetAll={() => setFreeHandheld(false)}
        />
      </Section>
    </div>
  );
}
