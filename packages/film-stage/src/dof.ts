import { blurPx, dofParams } from "film-kit/lens";
import { DepthOfFieldEffect, type EffectComposer, EffectPass, KernelSize } from "postprocessing";
import type { Camera } from "three";

export { blurPx };

export type DofUpdate = {
  fstop?: number;
  focusDistance?: number;
  mm?: number;
  widthPx?: number;
  heightPx?: number;
};

/** Physical shallow depth-of-field pass placed pre-Bloom/AgX, bypassed at zero GPU cost when fstop <= 0. */
export function makeDof(
  composer: EffectComposer,
  camera: Camera,
  { draft = false }: { draft?: boolean } = {},
) {
  const effect = new DepthOfFieldEffect(camera, {
    focusDistance: 3,
    focusRange: 2,
    bokehScale: 0,
    resolutionScale: draft ? 0.35 : 0.5,
  });
  effect.target = null;
  // the near CoC is blurred so a soft foreground's edge spreads over what is behind it, then scaled by the blur's radius
  // (bokehScale, up to 48 px): a wider kernel let a table's edge swallow the subject standing on it
  effect.blurPass.kernelSize = KernelSize.VERY_SMALL;
  const pass = new EffectPass(camera, effect);
  composer.addPass(pass);
  pass.enabled = false;

  const update = ({ fstop = 0, focusDistance = 3, mm = 50, widthPx, heightPx }: DofUpdate = {}) => {
    if (!(fstop > 0) || !Number.isFinite(fstop)) {
      effect.bokehScale = 0;
      pass.enabled = false;
      return false;
    }
    const p = dofParams({ mm, fstop, focus: focusDistance, widthPx, heightPx });
    // the CoC shader shares the camera's matrices but copied its near and far once, at construction; a rig that sets them
    // per frame (projectCamera) would otherwise have every depth read back at the wrong distance and blur the focus plane
    effect.cocMaterial.adoptCameraSettings(camera);
    effect.cocMaterial.focusDistance = p.focusDistance;
    effect.cocMaterial.focusRange = p.focusRange;
    effect.bokehScale = p.bokehScale;
    pass.enabled = p.bokehScale > 1e-4;
    return pass.enabled;
  };

  const dispose = () => {
    effect.dispose();
    pass.dispose();
  };

  return { pass, effect, update, dispose };
}
