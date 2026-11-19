import { MAX_FOV, MIN_FOV } from "film-kit/lens";
import { fovOf, mmOf, SHAKES } from "film-stage/camera";

import { Button } from "@/components/ui/button";

import { SliderRow } from "../components/inspector";
import { S } from "../core/state";
import { say, set, useStudio } from "../core/store";
import { seekExact, setPlaying } from "../playback/transport";
import {
  cameraKeyFrameTime,
  edit,
  keys,
  lensAspectAt,
  type LensField,
  opticsOfKey,
  preview,
  resetDof,
  resetLensField,
  resetShake,
  restore,
  setFocus,
  setFstop,
  setHandheld,
  setLens,
  snapshot,
  writeLens,
} from "./cam";
import {
  FocalLengthRow,
  FocusControls,
  HandheldControls,
  type HandheldUiValue,
} from "./OpticsWidgets";

const doc = { snapshot, restore };
const DEG = 180 / Math.PI;

export function CameraOptics({
  index: i,
  section = "basic",
}: {
  index: number;
  section?: "basic" | "advanced";
}) {
  useStudio((s) => s.ready);
  const key = keys[i];
  const optics = opticsOfKey(i);
  const aspect = lensAspectAt(key.t);
  const mm = optics.mm ?? mmOf(optics.fov, aspect);
  const disabled = !!key.locked;
  const field = (name: LensField, scale = 1) => ({
    doc,
    disabled,
    preview: (value: number) => preview((rows) => writeLens(rows[i], name, value / scale)),
    save: (value: number) => setLens(i, name, value / scale),
  });
  const applyMm = (value: number) => {
    const fov = fovOf(value, aspect);
    if (!(fov >= MIN_FOV && fov <= MAX_FOV))
      return say("Enter a positive focal length that gives a usable field of view");
    setLens(i, "mm", value);
  };
  const pickingFocus = useStudio((s) => s.pickFocus === i);

  const handleSelectShake = (choice: string) => {
    if (choice === "inherit") setHandheld(i, undefined);
    else if (choice === "off") setHandheld(i, false);
    else {
      const shakeName = SHAKES.find((name) => name === choice);
      if (shakeName) setHandheld(i, shakeName);
    }
  };
  const handleUpdateShake = (shake: HandheldUiValue, prop: keyof HandheldUiValue, value: number) =>
    setHandheld(i, { ...shake, [prop]: value });

  if (section === "advanced") {
    return (
      <HandheldControls
        authored={key.handheld}
        effective={optics.handheld}
        includeInherit
        section="advanced"
        disabled={disabled}
        onSelectPreset={handleSelectShake}
        onUpdateField={handleUpdateShake}
        onResetAll={() => setHandheld(i, undefined)}
      />
    );
  }

  return (
    <>
      <SliderRow
        label="FOV"
        value={optics.fov}
        min={MIN_FOV}
        max={MAX_FOV}
        step={0.1}
        digits={1}
        unit="°"
        hint={key.fov === undefined && key.mm === undefined ? "From shot" : undefined}
        reset={{
          label: "Reset FOV to default",
          disabled: disabled || (key.fov === undefined && key.mm === undefined),
          onClick: () => resetLensField(i, "fov"),
        }}
        {...field("fov")}
        onTextSave={(text) => {
          if (!/mm$/i.test(text)) return false;
          const value = Number(text.slice(0, -2).trim().replace(",", "."));
          applyMm(value);
          return true;
        }}
      />
      <FocalLengthRow
        mm={mm}
        disabled={disabled}
        onApplyMm={applyMm}
        reset={{
          label: "Reset focal length to default",
          disabled: disabled || (key.fov === undefined && key.mm === undefined),
          onClick: () => resetLensField(i, "fov"),
        }}
      />
      <SliderRow
        label="Aperture"
        value={optics.fstop}
        min={0}
        max={32}
        digits={1}
        step={0.1}
        unit="f"
        reset={{
          label: "Reset aperture to default",
          disabled: disabled || key.fstop === undefined,
          onClick: () => setFstop(i, undefined),
        }}
        {...field("fstop")}
        hint={optics.fstop === 0 ? "Deep focus" : key.fstop === undefined ? "From shot" : undefined}
      />
      <FocusControls
        syncKey={String(i)}
        authoredFocus={key.focus}
        effectiveFocus={optics.focus}
        disabled={disabled}
        pickingFocus={pickingFocus}
        fromShotNote
        onTogglePickFocus={() => {
          if (pickingFocus) {
            set({ pickFocus: null });
            return;
          }
          if (S.playing) setPlaying(false);
          seekExact(cameraKeyFrameTime(i));
          set({ pickFocus: i, cameraPick: null });
        }}
        onCommitFocus={(next) => setFocus(i, next)}
        onPreviewFocus={(next) => setFocus(i, next, preview)}
        snapshotFn={snapshot}
        restoreFn={restore}
        resetLabel="Reset focus to default"
      />
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="quiet"
          disabled={disabled || (key.fstop === undefined && key.focus === undefined)}
          onClick={() => resetDof(i)}
        >
          Reset aperture & focus
        </Button>
      </div>
      <SliderRow
        label="Roll"
        value={optics.roll * DEG}
        min={-180}
        max={180}
        step={0.5}
        digits={1}
        unit="°"
        origin={0}
        reset={{
          label: "Reset Roll to default",
          disabled: disabled || key.roll === undefined,
          onClick: () => resetLensField(i, "roll"),
        }}
        {...field("roll", DEG)}
      />
      <SliderRow
        label="Sway"
        value={optics.wave}
        min={0}
        max={3}
        step={0.05}
        digits={2}
        unit="×"
        reset={{
          label: "Reset Sway to default",
          disabled: disabled || key.wave === undefined,
          onClick: () => resetLensField(i, "wave"),
        }}
        {...field("wave")}
      />
      <SliderRow
        label="Walking bob"
        value={optics.bob}
        min={0}
        max={3}
        step={0.05}
        digits={2}
        unit="×"
        reset={{
          label: "Reset step bob to default",
          disabled: disabled || key.bob === undefined,
          onClick: () => resetLensField(i, "bob"),
        }}
        {...field("bob")}
      />
      <HandheldControls
        authored={key.handheld}
        effective={optics.handheld}
        includeInherit
        section="basic"
        disabled={disabled}
        onSelectPreset={handleSelectShake}
        onUpdateField={handleUpdateShake}
        onResetAll={() => setHandheld(i, undefined)}
      />
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="quiet"
          disabled={
            disabled ||
            (key.handheld === undefined && key.wave === undefined && key.bob === undefined)
          }
          onClick={() => resetShake(i)}
        >
          Reset handheld & bob
        </Button>
      </div>
    </>
  );
}
export { S, edit };
