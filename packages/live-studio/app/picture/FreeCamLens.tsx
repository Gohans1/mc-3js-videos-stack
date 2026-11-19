// Shared Free Camera lens controls (FOV, Roll, Sway) reused by Settings > Camera and FreeCamPanel.
import { MAX_FOV, MIN_FOV } from "film-kit/lens";

import { SliderRow } from "../components/inspector";
import { S, wake } from "../core/state";
import { get, set, useStudio } from "../core/store";
import { useFrameKey } from "../core/useFrameKey";
import {
  defaultFreeFov,
  FREE_LENS_DEFAULTS,
  type FreeTouchedSnapshot,
  getFreeTouchedSnapshot,
  isCustomFreeFov,
  resetFreeFov,
  restoreFreeTouchedState,
  setFreeFov,
  setFreeMm,
  setFreeRoll,
  setFreeWave,
} from "./freecam";

const DEG = 180 / Math.PI;

export const freeDoc = {
  snapshot: () => {
    const f = S.tools?.free;
    const fov = isCustomFreeFov() || f?.on ? (f?.fov ?? get().freeFov) : defaultFreeFov();
    return JSON.stringify({
      fov,
      roll: f?.roll ?? FREE_LENS_DEFAULTS.roll,
      wave: f?.wave ?? FREE_LENS_DEFAULTS.wave,
      bob: f?.bob ?? FREE_LENS_DEFAULTS.bob,
      fstop: f?.fstop ?? FREE_LENS_DEFAULTS.fstop,
      focus: f?.focus ?? FREE_LENS_DEFAULTS.focus,
      handheld: f?.handheld ?? FREE_LENS_DEFAULTS.handheld,
      ...getFreeTouchedSnapshot(),
    });
  },
  restore: (snap: string) => {
    try {
      const next = JSON.parse(snap) as {
        fov: number;
        roll: number;
        wave: number;
        bob?: number;
        fstop?: number;
        focus?: unknown;
        handheld?: unknown;
      } & Partial<FreeTouchedSnapshot>;
      const f = S.tools?.free;
      if (f) {
        f.fov = next.fov;
        f.roll = next.roll;
        f.wave = next.wave;
        f.bob = next.bob ?? FREE_LENS_DEFAULTS.bob;
        f.fstop = next.fstop ?? FREE_LENS_DEFAULTS.fstop;
        f.focus = next.focus;
        f.handheld = next.handheld ?? FREE_LENS_DEFAULTS.handheld;
      }
      restoreFreeTouchedState(next);
      set({
        freeFov: next.fov,
        freeRoll: next.roll,
        freeWave: next.wave,
        freeBob: next.bob ?? FREE_LENS_DEFAULTS.bob,
        freeFstop: next.fstop ?? FREE_LENS_DEFAULTS.fstop,
        freeFocus: next.focus as typeof FREE_LENS_DEFAULTS.focus,
        freeHandheld: next.handheld ?? FREE_LENS_DEFAULTS.handheld,
      });
      S.dirty = true;
      S.finalAt = -1;
      wake("render");
    } catch {}
  },
};

export function FreeCamFovSlider({ onAutoEnter }: { onAutoEnter?: () => void } = {}) {
  useStudio((s) => s.ready);
  const free = useStudio((s) => s.free);
  useStudio((s) => s.freePoseRev);
  const storeFov = useStudio((s) => s.freeFov);
  useFrameKey(() => (S.tools?.free.on ? "" : defaultFreeFov()));
  const defFov = defaultFreeFov();
  const fov = !free && !isCustomFreeFov() ? defFov : storeFov;
  return (
    <SliderRow
      label="Free cam FOV"
      value={fov}
      min={MIN_FOV}
      max={MAX_FOV}
      step={0.1}
      digits={1}
      unit="°"
      doc={freeDoc}
      preview={(v) => {
        onAutoEnter?.();
        setFreeFov(v);
      }}
      save={(v) => {
        onAutoEnter?.();
        setFreeFov(v);
      }}
      onTextSave={(text) => {
        if (!/mm$/i.test(text)) return false;
        const value = Number(text.slice(0, -2).trim().replace(",", "."));
        onAutoEnter?.();
        setFreeMm(value);
        return true;
      }}
      reset={{
        label: "Reset free camera FOV to default",
        disabled: Math.abs(fov - defFov) < 0.05,
        onClick: resetFreeFov,
      }}
    />
  );
}

export function FreeCamRollSlider({ onAutoEnter }: { onAutoEnter?: () => void } = {}) {
  const roll = useStudio((s) => s.freeRoll);
  return (
    <SliderRow
      label="Free cam Roll"
      value={Math.round(roll * DEG * 10) / 10}
      min={-180}
      max={180}
      step={0.5}
      digits={1}
      unit="°"
      origin={0}
      doc={freeDoc}
      preview={(v) => {
        onAutoEnter?.();
        setFreeRoll(v / DEG);
      }}
      save={(v) => {
        onAutoEnter?.();
        setFreeRoll(v / DEG);
      }}
      reset={{
        label: "Reset free camera Roll to default",
        disabled: Math.abs(roll) < 1e-3,
        onClick: () => setFreeRoll(FREE_LENS_DEFAULTS.roll),
      }}
    />
  );
}

export function FreeCamSwaySlider({ onAutoEnter }: { onAutoEnter?: () => void } = {}) {
  const wave = useStudio((s) => s.freeWave);
  return (
    <SliderRow
      label="Free cam Sway"
      value={wave}
      min={0}
      max={3}
      step={0.05}
      digits={2}
      unit="×"
      doc={freeDoc}
      preview={(v) => {
        onAutoEnter?.();
        setFreeWave(v);
      }}
      save={(v) => {
        onAutoEnter?.();
        setFreeWave(v);
      }}
      reset={{
        label: "Reset free camera Sway to default",
        disabled: Math.abs(wave - FREE_LENS_DEFAULTS.wave) < 1e-3,
        onClick: () => setFreeWave(FREE_LENS_DEFAULTS.wave),
      }}
      hint="Free camera drift: 0 holds still, 1 matches the film's drift"
    />
  );
}

export function FreeCamLensFields() {
  return (
    <>
      <FreeCamFovSlider />
      <FreeCamRollSlider />
      <FreeCamSwaySlider />
    </>
  );
}
