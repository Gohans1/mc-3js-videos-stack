// Shared Free Camera lens controls (FOV, Roll, Sway) reused by both Settings > Camera and the Camera panel when Free Camera is active.
import { SliderRow } from "../components/inspector";
import { S } from "../core/state";
import { set, useStudio } from "../core/store";
import {
  defaultFreeFov,
  FREE_LENS_DEFAULTS,
  resetFreeFov,
  setFreeFov,
  setFreeRoll,
  setFreeWave,
} from "./freecam";

const DEG = 180 / Math.PI;

const freeDoc = {
  snapshot: () => {
    const f = S.tools?.free;
    return JSON.stringify({
      fov: f?.fov ?? FREE_LENS_DEFAULTS.fov,
      roll: f?.roll ?? FREE_LENS_DEFAULTS.roll,
      wave: f?.wave ?? FREE_LENS_DEFAULTS.wave,
    });
  },
  restore: (snap: string) => {
    try {
      const next = JSON.parse(snap) as { fov: number; roll: number; wave: number };
      const f = S.tools?.free;
      if (f) {
        f.fov = next.fov;
        f.roll = next.roll;
        f.wave = next.wave;
      }
      set({ freeFov: next.fov, freeRoll: next.roll, freeWave: next.wave });
    } catch {}
  },
};

export function FreeCamLensFields() {
  const fov = useStudio((s) => s.freeFov);
  const roll = useStudio((s) => s.freeRoll);
  const wave = useStudio((s) => s.freeWave);
  const defFov = defaultFreeFov();
  return (
    <>
      <SliderRow
        label="Free cam FOV"
        value={fov}
        min={10}
        max={120}
        step={1}
        digits={0}
        unit="°"
        doc={freeDoc}
        preview={(v) => setFreeFov(v)}
        save={(v) => setFreeFov(v)}
        reset={{
          label: "Reset free camera FOV to default",
          disabled: Math.abs(fov - defFov) < 0.05,
          onClick: resetFreeFov,
        }}
      />
      <SliderRow
        label="Free cam Roll"
        value={Math.round(roll * DEG * 10) / 10}
        min={-45}
        max={45}
        step={0.5}
        digits={1}
        unit="°"
        origin={0}
        doc={freeDoc}
        preview={(v) => setFreeRoll(v / DEG)}
        save={(v) => setFreeRoll(v / DEG)}
        reset={{
          label: "Reset free camera Roll to default",
          disabled: Math.abs(roll) < 1e-3,
          onClick: () => setFreeRoll(FREE_LENS_DEFAULTS.roll),
        }}
      />
      <SliderRow
        label="Free cam Sway"
        value={wave}
        min={0}
        max={3}
        step={0.05}
        digits={2}
        unit="×"
        doc={freeDoc}
        preview={(v) => setFreeWave(v)}
        save={(v) => setFreeWave(v)}
        reset={{
          label: "Reset free camera Sway to default",
          disabled: Math.abs(wave - FREE_LENS_DEFAULTS.wave) < 1e-3,
          onClick: () => setFreeWave(FREE_LENS_DEFAULTS.wave),
        }}
        hint="Free camera drift: 0 holds still, 1 matches the film's drift"
      />
    </>
  );
}
