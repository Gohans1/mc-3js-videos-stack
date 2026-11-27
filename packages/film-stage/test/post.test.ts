import { describe, expect, it } from "bun:test";

import {
  BloomEffect,
  EffectAttribute,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  ToneMappingEffect,
  VignetteEffect,
} from "postprocessing";
import * as THREE from "three";

import { makeDof } from "../src/dof";
import { DitherEffect } from "../src/grade";
import { createGodraysPass } from "../src/lights";
import {
  batchAfterToneMapEffects,
  buildMainPassEffects,
  createScreenEffect,
  syncDofCamera,
  syncGodraysCamera,
} from "../src/post";
import {
  LOOKDEV_PROFILE_IDS,
  LOOKDEV_PROFILES,
  type LookdevProfileId,
  resolvePostConfig,
  resolveScreenEffectConfig,
  SCREEN_EFFECT_PRESET_IDS,
  SCREEN_EFFECT_PRESETS,
  type ScreenEffectPresetId,
} from "../src/post-meta";

describe("LOOKDEV_PROFILES", () => {
  it("exposes all twelve canonical lookdev profile IDs", () => {
    expect(LOOKDEV_PROFILE_IDS).toEqual([
      "explainer-clean",
      "cinematic",
      "outdoor-natural",
      "neon-night",
      "outdoor-vivid",
      "medical-clinical",
      "xray-cutaway",
      "horror-dark",
      "documentary-grit",
      "warm-nostalgic",
      "underwater-deep",
      "space-crisp",
    ]);
  });

  it("enforces valid lookdev invariants and anti-banding dither (25-50) across all 12 profiles", () => {
    for (const id of LOOKDEV_PROFILE_IDS) {
      const p = LOOKDEV_PROFILES[id];
      expect(["agx", "neutral", "aces"]).toContain(p.toneMapping);
      expect(p.dither).toBeGreaterThanOrEqual(25);
      expect(p.dither).toBeLessThanOrEqual(50);
      expect(p.bloom.mipmapBlur).toBe(true);
      expect(p.bloom.intensity).toBeGreaterThan(0);
      expect(p.bloom.luminanceThreshold).toBeGreaterThan(0);
      expect(p.ao.aoRadius).toBeGreaterThan(0);
      expect(p.ao.distanceFalloff).toBeGreaterThan(0);
      expect(p.ao.intensity).toBeGreaterThan(0);
      if (p.vignette !== false) {
        expect(p.vignette.offset).toBeGreaterThan(0);
        expect(p.vignette.darkness).toBeGreaterThan(0);
      }
    }
  });

  it("differentiates clean/daylight profiles from moody/emissive profiles meaningfully", () => {
    expect(LOOKDEV_PROFILES["explainer-clean"].toneMapping).toBe("neutral");
    expect(LOOKDEV_PROFILES["explainer-clean"].bloom.luminanceThreshold).toBeGreaterThanOrEqual(3.5);
    expect(LOOKDEV_PROFILES["explainer-clean"].vignette).toBe(false);

    expect(LOOKDEV_PROFILES["outdoor-natural"].toneMapping).toBe("agx");
    expect(LOOKDEV_PROFILES["outdoor-natural"].bloom.luminanceThreshold).toBeGreaterThanOrEqual(3.5);

    expect(LOOKDEV_PROFILES.cinematic.toneMapping).toBe("agx");
    expect(LOOKDEV_PROFILES.cinematic.bloom.luminanceThreshold).toBeLessThan(2.0);

    expect(LOOKDEV_PROFILES["neon-night"].bloom.luminanceThreshold).toBeLessThan(1.0);
    expect(LOOKDEV_PROFILES["neon-night"].bloom.intensity).toBeGreaterThan(
      LOOKDEV_PROFILES["explainer-clean"].bloom.intensity,
    );
    expect(LOOKDEV_PROFILES["neon-night"].vignette).not.toBe(false);

    expect(LOOKDEV_PROFILES["horror-dark"].vignette).not.toBe(false);
    expect(LOOKDEV_PROFILES["xray-cutaway"].bloom.luminanceThreshold).toBeLessThanOrEqual(1.2);
    expect(LOOKDEV_PROFILES["medical-clinical"].vignette).toBe(false);
    expect(LOOKDEV_PROFILES["space-crisp"].vignette).toBe(false);
  });
});

describe("resolvePostConfig", () => {
  it("defaults to cinematic with standard pipeline flags when called with no arguments", () => {
    const cfg = resolvePostConfig();
    expect(cfg.profile).toBe("cinematic");
    expect(cfg.toneMapping).toBe(LOOKDEV_PROFILES.cinematic.toneMapping);
    expect(cfg.bloom).toEqual(LOOKDEV_PROFILES.cinematic.bloom);
    expect(cfg.ao).toEqual(LOOKDEV_PROFILES.cinematic.ao);
    expect(cfg.dither).toBe(LOOKDEV_PROFILES.cinematic.dither);
    expect(cfg.multisampling).toBe(4);
    expect(cfg.smaa).toBe(true);
    expect(cfg.dof).toBe(true);
    expect(cfg.draft).toBe(false);
  });

  it("merges partial overrides onto the chosen profile without mutating LOOKDEV_PROFILES", () => {
    const originalBloomIntensity = LOOKDEV_PROFILES["explainer-clean"].bloom.intensity;
    const originalAoRadius = LOOKDEV_PROFILES["explainer-clean"].ao.aoRadius;
    const cfg = resolvePostConfig({
      profile: "explainer-clean",
      bloom: { intensity: 0.4 },
      ao: { aoRadius: 1.0 },
      saturation: 0.15,
      draft: true,
    });

    expect(cfg.toneMapping).toBe("neutral");
    expect(cfg.bloom).toEqual({
      ...LOOKDEV_PROFILES["explainer-clean"].bloom,
      intensity: 0.4,
    });
    expect(cfg.ao).toEqual({
      ...LOOKDEV_PROFILES["explainer-clean"].ao,
      aoRadius: 1.0,
    });
    expect(cfg.saturation).toBe(0.15);
    expect(cfg.dither).toBe(LOOKDEV_PROFILES["explainer-clean"].dither);
    expect(cfg.draft).toBe(true);

    expect(LOOKDEV_PROFILES["explainer-clean"].bloom.intensity).toBe(originalBloomIntensity);
    expect(LOOKDEV_PROFILES["explainer-clean"].ao.aoRadius).toBe(originalAoRadius);
  });

  it("allows explicitly overriding dither to 0 to disable TPDF dither", () => {
    const cfg = resolvePostConfig({ profile: "explainer-clean", dither: 0 });
    expect(cfg.dither).toBe(0);
  });

  it("enables vignette with sensible defaults when overriding a profile whose vignette is false", () => {
    const cfg = resolvePostConfig({
      profile: "cinematic",
      vignette: { darkness: 0.45 },
    });
    expect(cfg.vignette).toEqual({ offset: 0.3, darkness: 0.45 });
  });

  it("merges partial vignette overrides onto neon-night defaults and allows disabling with false", () => {
    const tweaked = resolvePostConfig({
      profile: "neon-night",
      vignette: { darkness: 0.6 },
    });
    expect(tweaked.vignette).toEqual({
      offset: LOOKDEV_PROFILES["neon-night"].vignette.offset,
      darkness: 0.6,
    });

    const disabled = resolvePostConfig({
      profile: "neon-night",
      vignette: false,
      bloom: false,
      ao: false,
      dof: false,
      smaa: false,
    });
    expect(disabled.vignette).toBe(false);
    expect(disabled.bloom).toBe(false);
    expect(disabled.ao).toBe(false);
    expect(disabled.dof).toBe(false);
    expect(disabled.smaa).toBe(false);
  });

  it("ignores undefined override fields instead of erasing profile defaults", () => {
    const cfg = resolvePostConfig({
      profile: "neon-night",
      toneMapping: undefined,
      bloom: { intensity: undefined, radius: 0.5 },
      ao: { aoRadius: undefined, intensity: 2.5 },
      dither: undefined,
    });
    expect(cfg.toneMapping).toBe(LOOKDEV_PROFILES["neon-night"].toneMapping);
    expect(cfg.bloom).toEqual({
      ...LOOKDEV_PROFILES["neon-night"].bloom,
      radius: 0.5,
    });
    expect(cfg.ao).toEqual({
      ...LOOKDEV_PROFILES["neon-night"].ao,
      intensity: 2.5,
    });
    expect(cfg.dither).toBe(LOOKDEV_PROFILES["neon-night"].dither);
  });

  it("throws a helpful error listing valid profile IDs for unknown profile names", () => {
    expect(() => resolvePostConfig({ profile: "sci-fi" as LookdevProfileId })).toThrow(
      /explainer-clean.*cinematic.*outdoor-natural.*neon-night.*space-crisp/,
    );
    expect(() => resolvePostConfig({ profile: "" as LookdevProfileId })).toThrow(
      /Unknown lookdev profile/,
    );
  });

  it("throws a helpful error for invalid toneMapping override", () => {
    expect(() => resolvePostConfig({ toneMapping: "filmic" as "agx" })).toThrow(
      /agx.*neutral.*aces/,
    );
  });

  it("clamps negative dither, guards non-finite saturation, and preserves multisampling 0 cleanly", () => {
    const cfg = resolvePostConfig({
      dither: -10,
      multisampling: 0,
      saturation: Number.NaN,
    });
    expect(cfg.dither).toBe(0);
    expect(cfg.multisampling).toBe(0);
    expect(cfg.saturation).toBe(0);
  });
});

describe("SCREEN_EFFECT_PRESETS and createScreenEffect", () => {
  it("exposes all four canonical screen effect preset IDs", () => {
    expect(SCREEN_EFFECT_PRESET_IDS).toEqual(["cctv", "vhs-crt", "night-vision", "thermal"]);
  });

  it("resolves partial overrides without mutating SCREEN_EFFECT_PRESETS and rejects unknown presets", () => {
    const cfg = resolveScreenEffectConfig("cctv", { intensity: 0.65, scanlines: 0.5 });
    expect(cfg.intensity).toBe(0.65);
    expect(cfg.scanlines).toBe(0.5);
    expect(SCREEN_EFFECT_PRESETS.cctv.intensity).not.toBe(0.65);

    const clamped = resolveScreenEffectConfig("thermal", { intensity: 5, grain: -2 });
    expect(clamped.intensity).toBe(1);
    expect(clamped.grain).toBe(0);

    expect(() => resolveScreenEffectConfig("sepia" as ScreenEffectPresetId)).toThrow(
      /cctv.*vhs-crt.*night-vision.*thermal/,
    );
  });

  it("constructs seek-independent screen effects for every preset with clean setIntensity and dispose", () => {
    for (const preset of SCREEN_EFFECT_PRESET_IDS) {
      const fx = createScreenEffect(preset);
      expect(fx.preset).toBe(preset);
      expect(fx.effect).toBeDefined();

      fx.update(3.25);
      const tA = fx.effect.uniforms.get("uTime")?.value;
      fx.update(9.0);
      fx.update(3.25);
      const tB = fx.effect.uniforms.get("uTime")?.value;
      expect(tA).toBe(3.25);
      expect(tB).toBe(tA);

      fx.update(Number.NaN);
      expect(fx.effect.uniforms.get("uTime")?.value).toBe(0);

      fx.setIntensity(0.4);
      expect(fx.effect.uniforms.get("uIntensity")?.value).toBeCloseTo(0.4, 6);
      fx.setIntensity(2);
      expect(fx.effect.uniforms.get("uIntensity")?.value).toBe(1);
      fx.setIntensity(-1);
      expect(fx.effect.uniforms.get("uIntensity")?.value).toBe(0);

      fx.dispose();
      fx.dispose();
    }
  });

  it("enables CONVOLUTION and sets chromatic/tracking uniforms when overridden on any preset", () => {
    const plain = createScreenEffect("cctv");
    expect(plain.effect.getAttributes() & EffectAttribute.CONVOLUTION).toBe(0);
    plain.dispose();

    const glitched = createScreenEffect("cctv", { chromaticAberration: 0.5, tracking: 0.2 });
    expect(glitched.effect.getAttributes() & EffectAttribute.CONVOLUTION).toBe(
      EffectAttribute.CONVOLUTION,
    );
    expect(glitched.effect.uniforms.get("uChromatic")?.value).toBeCloseTo(0.5, 6);
    expect(glitched.effect.uniforms.get("uTracking")?.value).toBeCloseTo(0.2, 6);
    glitched.dispose();
  });
});

describe("batchAfterToneMapEffects", () => {
  it("splits multiple CONVOLUTION effects into separate EffectPasses and appends dither to the final batch without throwing", () => {
    const cam = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
    const vhsA = createScreenEffect("vhs-crt");
    const vhsB = createScreenEffect("vhs-crt");
    const cctv = createScreenEffect("cctv");
    const dither = new DitherEffect(40);

    const batches = batchAfterToneMapEffects([vhsA.effect, cctv.effect, vhsB.effect], dither);
    expect(batches.length).toBe(2);
    expect(batches[0]).toEqual([vhsA.effect, cctv.effect]);
    expect(batches[1]).toEqual([vhsB.effect, dither]);

    const passes = batches.map((batch) => new EffectPass(cam, ...batch));
    expect(passes.length).toBe(2);
    for (const p of passes) p.dispose();
    vhsA.dispose();
    vhsB.dispose();
    cctv.dispose();
    dither.dispose();
  });

  it("preserves exact execution order when a non-CONVOLUTION effect precedes a CONVOLUTION effect", () => {
    const cctv = createScreenEffect("cctv");
    const vhs = createScreenEffect("vhs-crt");
    const dither = new DitherEffect(40);

    const batches = batchAfterToneMapEffects([cctv.effect, vhs.effect], dither);
    expect(batches.length).toBe(2);
    expect(batches[0]).toEqual([cctv.effect]);
    expect(batches[1]).toEqual([vhs.effect, dither]);

    cctv.dispose();
    vhs.dispose();
    dither.dispose();
  });
});

describe("syncDofCamera", () => {
  it("updates DepthOfFieldEffect cocMaterial clip planes when switching between perspective cameras", () => {
    const perspA = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
    const perspB = new THREE.PerspectiveCamera(50, 16 / 9, 0.4, 320);
    perspB.updateProjectionMatrix();

    const passes: EffectPass[] = [];
    const fakeComposer = {
      passes,
      addPass(pass: EffectPass) {
        passes.push(pass);
      },
    } as unknown as EffectComposer;

    const dof = makeDof(fakeComposer, perspA, { draft: true });
    dof.update({ fstop: 1.8, focusDistance: 4, mm: 50, widthPx: 640 });

    syncDofCamera(dof.effect, perspB);
    const uniforms = dof.effect.cocMaterial.uniforms;
    expect(uniforms.cameraNear.value).toBeCloseTo(0.4, 6);
    expect(uniforms.cameraFar.value).toBeCloseTo(320, 6);

    dof.dispose();
  });

  it("keeps cocMaterial.version constant across repeated dof.update calls after switching to OrthographicCamera", () => {
    const persp = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
    const ortho = new THREE.OrthographicCamera(-4, 4, 2.25, -2.25, 0.2, 80);
    ortho.updateProjectionMatrix();

    const passes: EffectPass[] = [];
    const fakeComposer = {
      passes,
      addPass(pass: EffectPass) {
        passes.push(pass);
      },
    } as unknown as EffectComposer;

    const dof = makeDof(fakeComposer, persp, { draft: true });
    syncDofCamera(dof.effect, ortho);
    const versionAfterSwitch = dof.effect.cocMaterial.version;

    for (let i = 0; i < 5; i++) {
      dof.update({ fstop: 2.0, focusDistance: 5 + i * 0.2, mm: 50, widthPx: 640 });
    }
    expect(dof.effect.cocMaterial.version).toBe(versionAfterSwitch);
    expect(dof.effect.cocMaterial.defines.PERSPECTIVE_CAMERA).toBeUndefined();

    dof.dispose();
  });
});

describe("syncGodraysCamera", () => {
  it("updates GodraysPass camera references and clip-plane uniforms when switching perspective cameras", () => {
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.castShadow = true;
    const perspA = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
    const perspB = new THREE.PerspectiveCamera(35, 16 / 9, 0.5, 450);
    perspB.position.set(3, 4, 5);
    perspB.updateMatrixWorld();
    perspB.updateProjectionMatrix();

    const handle = createGodraysPass(light, perspA, { enabled: false });
    expect(handle.supported).toBe(true);
    expect(handle.pass).not.toBeNull();

    syncGodraysCamera(handle.pass!, perspB);

    const internal = handle.pass as unknown as {
      props: { camera: THREE.PerspectiveCamera };
      compositorPass: {
        sceneCamera: THREE.PerspectiveCamera;
        fullscreenMaterial: { uniforms: Record<string, { value: unknown }> };
      };
      illumPass: {
        material: { uniforms: Record<string, { value: unknown }> };
      };
    };

    expect(internal.props.camera).toBe(perspB);
    expect(internal.compositorPass.sceneCamera).toBe(perspB);
    expect(internal.compositorPass.fullscreenMaterial.uniforms.near.value).toBe(0.5);
    expect(internal.compositorPass.fullscreenMaterial.uniforms.far.value).toBe(450);
    expect(internal.illumPass.material.uniforms.near.value).toBe(0.5);
    expect(internal.illumPass.material.uniforms.far.value).toBe(450);
    expect(internal.illumPass.material.uniforms.cameraPos.value).toBe(perspB.position);
    expect(internal.illumPass.material.uniforms.cameraMatrixWorld.value).toBe(perspB.matrixWorld);
    expect(internal.illumPass.material.uniforms.cameraProjectionMatrixInv.value).toBe(
      perspB.projectionMatrixInverse,
    );

    handle.dispose();
    expect(handle.pass).toBeNull();
  });

  it("reports unsupported when createGodraysPass is called directly with OrthographicCamera", () => {
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.castShadow = true;
    const ortho = new THREE.OrthographicCamera(-4, 4, 2.25, -2.25, 0.1, 100);
    const handle = createGodraysPass(light, ortho, { enabled: false });
    expect(handle.supported).toBe(false);
    expect(handle.pass).toBeNull();
    handle.dispose();
  });
});

describe("buildMainPassEffects", () => {
  it("places HueSaturationEffect (tone) strictly after ToneMappingEffect so HDR > 1.0 reaches tone mapping unclamped", () => {
    const bloom = new BloomEffect({ intensity: 0.4, luminanceThreshold: 1.2, mipmapBlur: true });
    const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.4 });
    const toneMapping = new ToneMappingEffect();
    const tone = new HueSaturationEffect({ saturation: 0 });
    const dither = new DitherEffect(40);

    const effects = buildMainPassEffects({
      bloom,
      vignette,
      toneMapping,
      tone,
      dither,
      hasAfterToneMap: false,
    });
    expect(effects).toEqual([bloom, vignette, toneMapping, tone, dither]);
    expect(effects.indexOf(tone)).toBeGreaterThan(effects.indexOf(toneMapping));

    const withAfter = buildMainPassEffects({
      bloom,
      vignette: null,
      toneMapping,
      tone,
      dither,
      hasAfterToneMap: true,
    });
    expect(withAfter).toEqual([bloom, toneMapping, tone]);

    const cam = new THREE.PerspectiveCamera();
    const pass = new EffectPass(cam, ...effects);
    const passEffects = (pass as unknown as { effects: unknown[] }).effects;
    expect(passEffects.indexOf(tone)).toBeGreaterThan(passEffects.indexOf(toneMapping));

    pass.dispose();
    bloom.dispose();
    vignette.dispose();
    toneMapping.dispose();
    tone.dispose();
    dither.dispose();
  });
});

describe("DitherEffect shared export", () => {
  it("scales TPDF amplitude in sRGB 8-bit units and exposes current amount", () => {
    const d = new DitherEffect();
    expect(d.uniforms.get("ditherAmp")?.value).toBe(0);
    d.amount = 50;
    expect(d.uniforms.get("ditherAmp")?.value).toBeCloseTo(1 / 255, 8);
    d.amount = -5;
    expect(d.uniforms.get("ditherAmp")?.value).toBe(0);
    d.dispose();
  });
});
