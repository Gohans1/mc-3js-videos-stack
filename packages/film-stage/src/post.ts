import { N8AOPostPass } from "n8ao";
import {
  BlendFunction,
  BloomEffect,
  type DepthOfFieldEffect,
  Effect,
  EffectAttribute,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  VignetteEffect,
} from "postprocessing";
import * as THREE from "three";
import type { GodraysPass } from "three-good-godrays";

import { makeDof } from "./dof";
import { DitherEffect, hasGradeEffect, makeAdjustments, makeLayerAdjustments } from "./grade";
import { createGodraysPass, type GodraysHandle, type GodraysOptions } from "./lights";
import type { GodraysState } from "./lights-meta";
import {
  type AOConfig,
  type PostConfigOptions,
  type ResolvedPostConfig,
  resolvePostConfig,
  resolveScreenEffectConfig,
  type ScreenEffectOptions,
  type ScreenEffectPresetId,
} from "./post-meta";
import { toneMappingMode } from "./tone";

export * from "./post-meta";

export interface FilmRendererOptions {
  alpha?: boolean;
  antialias?: boolean;
  powerPreference?: WebGLPowerPreference;
  preserveDrawingBuffer?: boolean;
  pixelRatio?: number;
  shadowMap?: boolean;
  localClippingEnabled?: boolean;
  toneMappingExposure?: number;
}

export function createFilmRenderer(
  canvas: HTMLCanvasElement,
  W: number,
  H: number,
  opts: FilmRendererOptions = {},
): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: opts.alpha ?? false,
    antialias: opts.antialias ?? false,
    powerPreference: opts.powerPreference ?? "high-performance",
    preserveDrawingBuffer: opts.preserveDrawingBuffer ?? true,
  });
  if (opts.pixelRatio !== undefined) renderer.setPixelRatio(opts.pixelRatio);
  renderer.setSize(W, H, false);
  renderer.shadowMap.enabled = opts.shadowMap ?? true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.localClippingEnabled = opts.localClippingEnabled ?? true;
  renderer.toneMapping = THREE.NoToneMapping;
  if (opts.toneMappingExposure !== undefined) {
    renderer.toneMappingExposure = opts.toneMappingExposure;
  }
  return renderer;
}

const SCREEN_MODE_INDEX: Record<ScreenEffectPresetId, number> = {
  cctv: 0,
  "vhs-crt": 1,
  "night-vision": 2,
  thermal: 3,
};

const SCREEN_EFFECT_FRAG = `
uniform int uMode;
uniform float uTime;
uniform float uIntensity;
uniform float uScanlines;
uniform float uGrain;
uniform float uVignette;
uniform float uChromatic;
uniform float uTracking;
uniform vec3 uTint;

vec3 screenToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 screenToLinear(vec3 c) {
  return mix(c / 12.92, pow((max(c, vec3(0.0)) + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

float screenHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 thermalRamp(float t) {
  vec3 c0 = vec3(0.04, 0.02, 0.22);
  vec3 c1 = vec3(0.55, 0.06, 0.48);
  vec3 c2 = vec3(0.95, 0.36, 0.04);
  vec3 c3 = vec3(1.0, 0.88, 0.16);
  vec3 c4 = vec3(1.0, 1.0, 0.98);
  float s = clamp(t, 0.0, 1.0) * 4.0;
  if (s < 1.0) return mix(c0, c1, s);
  if (s < 2.0) return mix(c1, c2, s - 1.0);
  if (s < 3.0) return mix(c2, c3, s - 2.0);
  return mix(c3, c4, s - 3.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (uIntensity <= 0.0) {
    outputColor = inputColor;
    return;
  }

  vec3 baseLin = clamp(inputColor.rgb, 0.0, 1.0);
  vec3 srcLin = baseLin;

  if (uChromatic > 0.0 || uTracking > 0.0) {
    float bandPos = fract(uTime * 0.18);
    float bandDist = abs(uv.y - bandPos);
    float trackMask = (1.0 - smoothstep(0.0, 0.06, bandDist)) * uTracking;
    float jitter = (screenHash(vec2(floor(uv.y * 180.0), floor(uTime * 24.0))) - 0.5) * 0.012 * trackMask;
    vec2 sampleUv = vec2(clamp(uv.x + jitter, 0.0, 1.0), uv.y);
    float ca = uChromatic + trackMask * 0.006;
    float r = texture2D(inputBuffer, vec2(clamp(sampleUv.x - ca, 0.0, 1.0), sampleUv.y)).r;
    float g = texture2D(inputBuffer, sampleUv).g;
    float b = texture2D(inputBuffer, vec2(clamp(sampleUv.x + ca, 0.0, 1.0), sampleUv.y)).b;
    srcLin = clamp(vec3(r, g, b), 0.0, 1.0);
  }

  vec3 s = screenToSrgb(srcLin);
  float lum = dot(s, vec3(0.2126, 0.7152, 0.0722));
  vec3 fx = s;

  if (uMode == 0) {
    float mono = clamp((lum - 0.5) * 1.18 + 0.5, 0.0, 1.0);
    fx = mix(vec3(mono), s, 0.12) * uTint;
  } else if (uMode == 1) {
    fx = s * uTint;
  } else if (uMode == 2) {
    float amp = clamp(pow(clamp(lum * 1.85, 0.0, 1.0), 0.72), 0.0, 1.0);
    fx = vec3(amp) * uTint;
  } else {
    float heat = clamp(pow(lum, 0.88), 0.0, 1.0);
    fx = thermalRamp(heat) * uTint;
  }

  if (uTracking > 0.0) {
    float bandPos = fract(uTime * 0.18);
    float trackBar = (1.0 - smoothstep(0.0, 0.04, abs(uv.y - bandPos))) * uTracking;
    fx += vec3(trackBar * 0.18);
  }

  float scanPhase = sin(gl_FragCoord.y * 3.14159265);
  fx *= 1.0 - uScanlines * (0.5 - 0.5 * scanPhase);

  float qTime = floor(uTime * 24.0) * 0.0416667;
  float n = screenHash(gl_FragCoord.xy + vec2(qTime * 97.3, qTime * 53.1)) - 0.5;
  fx += vec3(n * uGrain);

  vec2 centered = (uv - 0.5) * vec2(aspect, 1.0);
  float rNorm = length(centered) / max(0.5 * length(vec2(aspect, 1.0)), 0.0001);
  float vig = uMode == 2
    ? 1.0 - smoothstep(0.62, 0.98, rNorm) * uVignette
    : 1.0 - smoothstep(0.35, 1.15, rNorm) * uVignette;
  fx = clamp(fx * vig, 0.0, 1.0);

  vec3 outLin = mix(baseLin, screenToLinear(fx), clamp(uIntensity, 0.0, 1.0));
  outputColor = vec4(outLin, inputColor.a);
}
`;

export interface ScreenEffectHandle {
  readonly preset: ScreenEffectPresetId;
  effect: Effect;
  update: (t: number) => void;
  setIntensity: (v: number) => void;
  dispose: () => void;
}

export function createScreenEffect(
  preset: ScreenEffectPresetId,
  opts: ScreenEffectOptions = {},
): ScreenEffectHandle {
  const cfg = resolveScreenEffectConfig(preset, opts);
  const modeIndex = SCREEN_MODE_INDEX[preset];
  const needsConvolution = cfg.chromaticAberration > 0 || cfg.tracking > 0;
  const effect = new Effect(`ScreenEffect:${preset}`, SCREEN_EFFECT_FRAG, {
    blendFunction: BlendFunction.SRC,
    attributes: needsConvolution ? EffectAttribute.CONVOLUTION : EffectAttribute.NONE,
    uniforms: new Map<string, THREE.Uniform>([
      ["uMode", new THREE.Uniform(modeIndex)],
      ["uTime", new THREE.Uniform(0)],
      ["uIntensity", new THREE.Uniform(cfg.intensity)],
      ["uScanlines", new THREE.Uniform(cfg.scanlines)],
      ["uGrain", new THREE.Uniform(cfg.grain)],
      ["uVignette", new THREE.Uniform(cfg.vignette)],
      ["uChromatic", new THREE.Uniform(cfg.chromaticAberration)],
      ["uTracking", new THREE.Uniform(cfg.tracking)],
      ["uTint", new THREE.Uniform(new THREE.Vector3(cfg.tint[0], cfg.tint[1], cfg.tint[2]))],
    ]),
  });

  let disposed = false;

  return {
    preset,
    effect,
    update(t: number) {
      effect.uniforms.get("uTime")!.value = Number.isFinite(t) ? t : 0;
    },
    setIntensity(v: number) {
      if (!Number.isFinite(v)) return;
      effect.uniforms.get("uIntensity")!.value = Math.min(1, Math.max(0, v));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      effect.dispose();
    },
  };
}

export function buildMainPassEffects(parts: {
  bloom?: Effect | null;
  vignette?: Effect | null;
  toneMapping: Effect;
  tone: Effect;
  dither?: Effect | null;
  hasAfterToneMap?: boolean;
}): Effect[] {
  const effects: Effect[] = [];
  if (parts.bloom) effects.push(parts.bloom);
  if (parts.vignette) effects.push(parts.vignette);
  effects.push(parts.toneMapping);
  effects.push(parts.tone);
  if (parts.dither && !parts.hasAfterToneMap) effects.push(parts.dither);
  return effects;
}

export function batchAfterToneMapEffects(
  effects: readonly Effect[],
  dither: Effect | null = null,
): Effect[][] {
  const batches: Effect[][] = [];
  let current: Effect[] = [];
  let minAttrInCurrent = Number.POSITIVE_INFINITY;

  for (const effect of effects) {
    const attr = effect.getAttributes();
    const isConv = (attr & EffectAttribute.CONVOLUTION) !== 0;
    if (current.length > 0 && (isConv || attr > minAttrInCurrent)) {
      batches.push(current);
      current = [effect];
      minAttrInCurrent = attr;
    } else {
      current.push(effect);
      if (attr < minAttrInCurrent) minAttrInCurrent = attr;
    }
  }
  if (current.length > 0) batches.push(current);
  if (dither && batches.length > 0) batches[batches.length - 1]!.push(dither);
  return batches;
}

export function syncDofCamera(effect: DepthOfFieldEffect, camera: THREE.Camera): void {
  effect.mainCamera = camera;
}

interface GodraysPassInternals {
  props?: { camera: THREE.PerspectiveCamera };
  compositorPass?: {
    sceneCamera: THREE.PerspectiveCamera;
    fullscreenMaterial?: { uniforms?: Record<string, THREE.IUniform> };
  };
  illumPass?: {
    material?: { uniforms?: Record<string, THREE.IUniform> };
  };
}

export function syncGodraysCamera(pass: GodraysPass, camera: THREE.PerspectiveCamera): void {
  const internal = pass as unknown as GodraysPassInternals;
  if (internal.props) internal.props.camera = camera;
  if (internal.compositorPass) {
    internal.compositorPass.sceneCamera = camera;
    const compUniforms = internal.compositorPass.fullscreenMaterial?.uniforms;
    if (compUniforms?.near) compUniforms.near.value = camera.near;
    if (compUniforms?.far) compUniforms.far.value = camera.far;
  }
  const illumUniforms = internal.illumPass?.material?.uniforms;
  if (illumUniforms) {
    if (illumUniforms.cameraPos) illumUniforms.cameraPos.value = camera.position;
    if (illumUniforms.cameraProjectionMatrixInv) {
      illumUniforms.cameraProjectionMatrixInv.value = camera.projectionMatrixInverse;
    }
    if (illumUniforms.cameraMatrixWorld) illumUniforms.cameraMatrixWorld.value = camera.matrixWorld;
    if (illumUniforms.near) illumUniforms.near.value = camera.near;
    if (illumUniforms.far) illumUniforms.far.value = camera.far;
  }
}

interface DisposableLike {
  dispose?: () => void;
}

interface QuadLike {
  material?: DisposableLike | null;
}

interface N8AOInternals {
  writeTargetInternal?: DisposableLike | null;
  readTargetInternal?: DisposableLike | null;
  outputTargetInternal?: DisposableLike | null;
  accumulationRenderTarget?: DisposableLike | null;
  bluenoise?: DisposableLike | null;
  depthDownsampleTarget?: DisposableLike | null;
  depthDownsampleQuad?: QuadLike | null;
  transparencyRenderTargetDWFalse?: DisposableLike | null;
  transparencyRenderTargetDWTrue?: DisposableLike | null;
  depthCopyPass?: QuadLike | null;
  effectShaderQuad?: QuadLike | null;
  poissonBlurQuad?: QuadLike | null;
  standardDenoiseMaterial?: DisposableLike | null;
  neuralDenoiseMaterial?: DisposableLike | null;
  effectCompositerQuad?: QuadLike | null;
  copyQuad?: QuadLike | null;
  accumulationQuad?: QuadLike | null;
  configureEffectCompositer?: (depthBufferType: number, ortho: boolean) => void;
}

function disposeN8AO(pass: N8AOPostPass | null): void {
  if (!pass) return;
  const internals = pass as unknown as N8AOInternals;
  const resources: (DisposableLike | null | undefined)[] = [
    internals.writeTargetInternal,
    internals.readTargetInternal,
    internals.outputTargetInternal,
    internals.accumulationRenderTarget,
    internals.bluenoise,
    internals.depthDownsampleTarget,
    internals.transparencyRenderTargetDWFalse,
    internals.transparencyRenderTargetDWTrue,
    internals.standardDenoiseMaterial,
    internals.neuralDenoiseMaterial,
  ];
  for (const res of resources) res?.dispose?.();
  const quads: (QuadLike | null | undefined)[] = [
    internals.depthDownsampleQuad,
    internals.depthCopyPass,
    internals.effectShaderQuad,
    internals.poissonBlurQuad,
    internals.effectCompositerQuad,
    internals.copyQuad,
    internals.accumulationQuad,
  ];
  for (const quad of quads) quad?.material?.dispose?.();
  pass.dispose();
}

export interface PostPipelineOptions extends PostConfigOptions {
  width?: number;
  height?: number;
  godraysLight?: THREE.Light | null;
  godraysOptions?: GodraysOptions & { enabled?: boolean };
  afterToneMap?: Effect[];
}

export interface PostSyncCameraOptions {
  aoEnabled?: boolean;
}

export interface PostRenderOptions extends PostSyncCameraOptions {
  deltaTime?: number;
  clear?: boolean;
}

export interface PostPipeline {
  composer: EffectComposer;
  readonly ao: N8AOPostPass | null;
  dof: ReturnType<typeof makeDof> | null;
  godrays: GodraysHandle | null;
  bloom: BloomEffect | null;
  tone: HueSaturationEffect;
  vignette: VignetteEffect | null;
  adjust: ReturnType<typeof makeAdjustments>;
  layerAdjust: ReturnType<typeof makeLayerAdjustments>;
  config: ResolvedPostConfig;
  syncCamera: (cam: THREE.Camera, opts?: PostSyncCameraOptions) => void;
  render: (cam?: THREE.Camera, opts?: PostRenderOptions) => void;
  setSize: (w: number, h: number) => void;
  dispose: () => void;
}

export function createPostPipeline(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  perspectiveCamera: THREE.Camera,
  opts: PostPipelineOptions = {},
): PostPipeline {
  const config = resolvePostConfig(opts);
  const rendererSize = renderer.getSize(new THREE.Vector2());
  const initialW = opts.width ?? Math.max(1, Math.floor(rendererSize.x));
  const initialH = opts.height ?? Math.max(1, Math.floor(rendererSize.y));

  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
    multisampling: config.multisampling,
  });
  if (opts.width !== undefined || opts.height !== undefined) {
    composer.setSize(initialW, initialH, false);
  }
  const renderPass = new RenderPass(scene, perspectiveCamera);
  composer.addPass(renderPass);

  const dbSize = new THREE.Vector2();
  const makeAO = (cam: THREE.Camera, aoCfg: AOConfig): N8AOPostPass => {
    const isOrtho = Boolean((cam as THREE.OrthographicCamera).isOrthographicCamera);
    renderer.getDrawingBufferSize(dbSize);
    const pass = new N8AOPostPass(scene, cam, Math.max(1, dbSize.x), Math.max(1, dbSize.y));
    const qualityMode = aoCfg.qualityMode ?? (config.draft ? "Medium" : "High");
    pass.setQualityMode(qualityMode);
    pass.configuration.aoRadius = aoCfg.aoRadius;
    pass.configuration.distanceFalloff = aoCfg.distanceFalloff;
    pass.configuration.intensity = aoCfg.intensity;
    if (aoCfg.color !== undefined) {
      pass.configuration.color = new THREE.Color(aoCfg.color).convertLinearToSRGB();
    }
    const wantsHalfRes = aoCfg.halfRes ?? (config.draft && !qualityMode.startsWith("Neural-"));
    if (wantsHalfRes !== pass.configuration.halfRes) {
      pass.configuration.halfRes = wantsHalfRes;
    } else if (isOrtho) {
      (pass as unknown as N8AOInternals).configureEffectCompositer?.(
        pass.configuration.depthBufferType,
        true,
      );
    }
    pass.outputTargetInternal.texture.type = THREE.HalfFloatType;
    return pass;
  };

  let perspAO: N8AOPostPass | null = null;
  let orthoAO: N8AOPostPass | null = null;
  let isCurrentOrtho = Boolean((perspectiveCamera as THREE.OrthographicCamera).isOrthographicCamera);

  if (config.ao !== false) {
    const initialAO = makeAO(perspectiveCamera, config.ao);
    if (isCurrentOrtho) orthoAO = initialAO;
    else perspAO = initialAO;
    composer.addPass(initialAO);
  }

  if (config.smaa) {
    composer.addPass(new EffectPass(perspectiveCamera, new SMAAEffect()));
  }

  const rawDof = config.dof ? makeDof(composer, perspectiveCamera, { draft: config.draft }) : null;

  let composerCamera: THREE.Camera = perspectiveCamera;
  let dofCamera: THREE.Camera = perspectiveCamera;
  let dofNear = (perspectiveCamera as THREE.PerspectiveCamera).near ?? Number.NaN;
  let dofFar = (perspectiveCamera as THREE.PerspectiveCamera).far ?? Number.NaN;

  const syncDofIfNeeded = (cam: THREE.Camera, force = false) => {
    if (!rawDof) return;
    const camNear = (cam as THREE.PerspectiveCamera).near ?? Number.NaN;
    const camFar = (cam as THREE.PerspectiveCamera).far ?? Number.NaN;
    if (force || cam !== dofCamera || camNear !== dofNear || camFar !== dofFar) {
      syncDofCamera(rawDof.effect, cam);
      dofCamera = cam;
      dofNear = camNear;
      dofFar = camFar;
    }
  };

  const dof: ReturnType<typeof makeDof> | null = rawDof
    ? {
        pass: rawDof.pass,
        effect: rawDof.effect,
        update(dofOpts) {
          if ((rawDof.effect as unknown as { camera?: THREE.Camera }).camera !== composerCamera) {
            syncDofIfNeeded(composerCamera);
          }
          const enabled = rawDof.update(dofOpts);
          if (enabled) syncDofIfNeeded(composerCamera);
          return enabled;
        },
        dispose: rawDof.dispose,
      }
    : null;

  const bloom =
    config.bloom === false
      ? null
      : new BloomEffect({
          intensity: config.bloom.intensity,
          luminanceThreshold: config.bloom.luminanceThreshold,
          luminanceSmoothing: config.bloom.luminanceSmoothing,
          mipmapBlur: config.bloom.mipmapBlur,
          ...(config.bloom.radius !== undefined ? { radius: config.bloom.radius } : {}),
        });
  const tone = new HueSaturationEffect({ saturation: config.saturation });
  const vignette =
    config.vignette === false
      ? null
      : new VignetteEffect({
          offset: config.vignette.offset,
          darkness: config.vignette.darkness,
        });
  const toneMapping = new ToneMappingEffect({ mode: toneMappingMode(config.toneMapping) });
  const dither = config.dither > 0 ? new DitherEffect(config.dither) : null;
  const hasAfterToneMap = Boolean(opts.afterToneMap && opts.afterToneMap.length > 0);

  const mainEffects = buildMainPassEffects({
    bloom,
    vignette,
    toneMapping,
    tone,
    dither,
    hasAfterToneMap,
  });
  const mainPass = new EffectPass(perspectiveCamera, ...mainEffects);
  composer.addPass(mainPass);

  type GodraysLifecycle =
    | { kind: "unsupported" }
    | { kind: "pending"; pendingState: { state: GodraysState; fallbackColor?: string } | null }
    | {
        kind: "active";
        handle: GodraysHandle;
        wanted: boolean;
        camera: THREE.PerspectiveCamera;
        near: number;
        far: number;
      }
    | { kind: "disposed" };

  const godraysLight = opts.godraysLight ?? null;
  const godraysLightCapable = Boolean(
    godraysLight &&
      ((godraysLight as THREE.DirectionalLight).isDirectionalLight ||
        (godraysLight as THREE.PointLight).isPointLight) &&
      (godraysLight as THREE.DirectionalLight).shadow,
  );
  let godraysLifecycle: GodraysLifecycle = godraysLightCapable
    ? { kind: "pending", pendingState: null }
    : { kind: "unsupported" };

  const ensureGodrays = (cam: THREE.Camera): boolean => {
    if (godraysLifecycle.kind !== "pending" || !godraysLight) return false;
    if (!(cam as THREE.PerspectiveCamera).isPerspectiveCamera) return false;
    const perspCam = cam as THREE.PerspectiveCamera;
    const created = createGodraysPass(godraysLight, perspCam, {
      enabled: false,
      ...opts.godraysOptions,
    });
    if (!created.supported || !created.pass) {
      godraysLifecycle = { kind: "unsupported" };
      return false;
    }
    const mainIdx = composer.passes.indexOf(mainPass);
    if (mainIdx >= 0) composer.addPass(created.pass, mainIdx);
    else composer.addPass(created.pass);
    const pendingState = godraysLifecycle.pendingState;
    if (pendingState) {
      created.update(pendingState.state, pendingState.fallbackColor);
    }
    godraysLifecycle = {
      kind: "active",
      handle: created,
      wanted: Boolean(created.pass.enabled),
      camera: perspCam,
      near: perspCam.near,
      far: perspCam.far,
    };
    return true;
  };

  ensureGodrays(perspectiveCamera);

  const godrays: GodraysHandle | null = godraysLight
    ? {
        get supported() {
          if (godraysLifecycle.kind === "active") return godraysLifecycle.handle.supported;
          return godraysLifecycle.kind === "pending";
        },
        get pass() {
          return godraysLifecycle.kind === "active" ? godraysLifecycle.handle.pass : null;
        },
        update(state, fallbackColor) {
          if (godraysLifecycle.kind === "disposed" || godraysLifecycle.kind === "unsupported")
            return;
          if (godraysLifecycle.kind === "pending") {
            godraysLifecycle = {
              kind: "pending",
              pendingState: { state: { ...state }, fallbackColor },
            };
            return;
          }
          godraysLifecycle.handle.update(state, fallbackColor);
          godraysLifecycle.wanted = Boolean(godraysLifecycle.handle.pass?.enabled);
          if (isCurrentOrtho && godraysLifecycle.handle.pass) {
            godraysLifecycle.handle.pass.enabled = false;
          }
        },
        dispose() {
          if (godraysLifecycle.kind === "active") {
            const pass = godraysLifecycle.handle.pass;
            if (pass) composer.removePass(pass);
            godraysLifecycle.handle.dispose();
          }
          godraysLifecycle = { kind: "disposed" };
        },
      }
    : null;

  if (hasAfterToneMap && opts.afterToneMap) {
    for (const batch of batchAfterToneMapEffects(opts.afterToneMap, dither)) {
      composer.addPass(new EffectPass(perspectiveCamera, ...batch));
    }
  }

  const rawAdjust = makeAdjustments(composer, perspectiveCamera, {
    tailDithered: true,
  });
  const syncDither = () => {
    if (!dither) return;
    dither.amount = rawAdjust.isActive() ? 0 : config.dither;
  };
  const adjust = ((...args: Parameters<typeof rawAdjust>) => {
    rawAdjust(...args);
    syncDither();
  }) as ReturnType<typeof makeAdjustments>;
  adjust.prepare = rawAdjust.prepare;
  adjust.dispose = rawAdjust.dispose;
  adjust.isActive = rawAdjust.isActive;

  let rawLayerAdjust: ReturnType<typeof makeLayerAdjustments> | null = null;
  const ensureLayerAdjust = () => {
    rawLayerAdjust ??= makeLayerAdjustments(renderer);
    return rawLayerAdjust;
  };
  const layerAdjust = ((layers, t, bypass) => {
    if (bypass || !layers.some(({ grade: g }) => hasGradeEffect(g))) return;
    ensureLayerAdjust()(layers, t, bypass);
  }) as ReturnType<typeof makeLayerAdjustments>;
  layerAdjust.prepare = (settings) => {
    if (!settings.some((g) => Boolean(g))) return Promise.resolve();
    return ensureLayerAdjust().prepare(settings);
  };
  layerAdjust.dispose = () => {
    rawLayerAdjust?.dispose();
    rawLayerAdjust = null;
  };

  let passCount = -1;
  let disposed = false;

  const copyLiveAOConfig = (source: N8AOPostPass | null, target: N8AOPostPass) => {
    if (!source) return;
    target.configuration.aoRadius = source.configuration.aoRadius;
    target.configuration.distanceFalloff = source.configuration.distanceFalloff;
    target.configuration.intensity = source.configuration.intensity;
    target.configuration.color.copy(source.configuration.color);
  };

  const insertAONext = (pass: N8AOPostPass) => {
    const anchor = perspAO ?? orthoAO;
    const anchorIdx = anchor ? composer.passes.indexOf(anchor) : -1;
    const insertIdx =
      anchorIdx >= 0 ? anchorIdx + 1 : composer.passes.indexOf(renderPass) + 1;
    composer.addPass(pass, insertIdx);
  };

  const syncCamera = (cam: THREE.Camera, syncOpts?: PostSyncCameraOptions) => {
    const wasOrtho = isCurrentOrtho;
    const isOrtho = Boolean((cam as THREE.OrthographicCamera).isOrthographicCamera);
    isCurrentOrtho = isOrtho;
    const aoWanted = syncOpts?.aoEnabled ?? true;

    if (config.ao !== false) {
      if (isOrtho) {
        if (aoWanted && !orthoAO) {
          const nextPass = makeAO(cam, config.ao);
          copyLiveAOConfig(perspAO, nextPass);
          insertAONext(nextPass);
          orthoAO = nextPass;
        }
        if (perspAO) perspAO.enabled = false;
        if (orthoAO) {
          orthoAO.camera = cam;
          orthoAO.enabled = aoWanted;
        }
      } else {
        if (aoWanted && !perspAO) {
          const nextPass = makeAO(cam, config.ao);
          copyLiveAOConfig(orthoAO, nextPass);
          insertAONext(nextPass);
          perspAO = nextPass;
        }
        if (orthoAO) orthoAO.enabled = false;
        if (perspAO) {
          perspAO.camera = cam;
          perspAO.enabled = aoWanted;
        }
      }
    }

    if (isOrtho) {
      if (godraysLifecycle.kind === "active" && godraysLifecycle.handle.pass) {
        if (!wasOrtho) godraysLifecycle.wanted = godraysLifecycle.handle.pass.enabled;
        godraysLifecycle.handle.pass.enabled = false;
      }
    } else {
      const justCreated = ensureGodrays(cam);
      if (godraysLifecycle.kind === "active" && godraysLifecycle.handle.pass) {
        if (wasOrtho && !justCreated) {
          godraysLifecycle.handle.pass.enabled = godraysLifecycle.wanted;
        }
        if ((cam as THREE.PerspectiveCamera).isPerspectiveCamera) {
          const perspCam = cam as THREE.PerspectiveCamera;
          if (
            perspCam !== godraysLifecycle.camera ||
            perspCam.near !== godraysLifecycle.near ||
            perspCam.far !== godraysLifecycle.far
          ) {
            syncGodraysCamera(godraysLifecycle.handle.pass, perspCam);
            godraysLifecycle.camera = perspCam;
            godraysLifecycle.near = perspCam.near;
            godraysLifecycle.far = perspCam.far;
          }
        }
      }
    }

    if (composerCamera !== cam || passCount !== composer.passes.length) {
      composer.setMainCamera(cam);
      composerCamera = cam;
      passCount = composer.passes.length;
    }

    if (rawDof?.pass.enabled) {
      syncDofIfNeeded(cam);
    }
  };

  const render = (cam?: THREE.Camera, renderOpts?: PostRenderOptions) => {
    syncCamera(cam ?? composerCamera, renderOpts);
    syncDither();
    if (renderOpts?.clear !== false) renderer.clear();
    composer.render(renderOpts?.deltaTime ?? 0);
  };

  const setSize = (w: number, h: number) => {
    composer.setSize(w, h, false);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    adjust.dispose();
    layerAdjust.dispose();
    dof?.dispose();
    godrays?.dispose();
    disposeN8AO(perspAO);
    disposeN8AO(orthoAO);
    perspAO = null;
    orthoAO = null;
    composer.dispose();
  };

  return {
    composer,
    get ao() {
      return isCurrentOrtho ? (orthoAO ?? perspAO) : (perspAO ?? orthoAO);
    },
    dof,
    godrays,
    bloom,
    tone,
    vignette,
    adjust,
    layerAdjust,
    config,
    syncCamera,
    render,
    setSize,
    dispose,
  };
}
