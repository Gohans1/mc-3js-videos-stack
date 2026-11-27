export type ToneMapName = "agx" | "neutral" | "aces";

export type AOQualityMode =
  | "Performance"
  | "Low"
  | "Medium"
  | "High"
  | "Ultra"
  | "Neural-Low"
  | "Neural-Medium"
  | "Neural-High";

export interface BloomConfig {
  intensity: number;
  luminanceThreshold: number;
  luminanceSmoothing: number;
  mipmapBlur: boolean;
  radius?: number;
}

export interface VignetteConfig {
  offset: number;
  darkness: number;
}

export interface AOConfig {
  aoRadius: number;
  distanceFalloff: number;
  intensity: number;
  halfRes?: boolean;
  qualityMode?: AOQualityMode;
  color?: string | number;
}

export interface LookdevProfile {
  toneMapping: ToneMapName;
  bloom: BloomConfig;
  vignette: VignetteConfig | false;
  ao: AOConfig;
  saturation: number;
  dither: number;
}

export const LOOKDEV_PROFILES = {
  "explainer-clean": {
    toneMapping: "neutral",
    bloom: {
      intensity: 0.25,
      luminanceThreshold: 4.0,
      luminanceSmoothing: 0.2,
      mipmapBlur: true,
    },
    vignette: false,
    ao: { aoRadius: 0.8, distanceFalloff: 1.0, intensity: 1.8 },
    saturation: 0,
    dither: 50,
  },
  cinematic: {
    toneMapping: "agx",
    bloom: {
      intensity: 0.45,
      luminanceThreshold: 1.2,
      luminanceSmoothing: 0.25,
      mipmapBlur: true,
    },
    vignette: false,
    ao: { aoRadius: 0.5, distanceFalloff: 0.8, intensity: 2.0 },
    saturation: 0,
    dither: 35,
  },
  "outdoor-natural": {
    toneMapping: "agx",
    bloom: {
      intensity: 0.35,
      luminanceThreshold: 3.8,
      luminanceSmoothing: 0.25,
      mipmapBlur: true,
    },
    vignette: false,
    ao: { aoRadius: 0.8, distanceFalloff: 1.0, intensity: 2.0 },
    saturation: 0,
    dither: 35,
  },
  "neon-night": {
    toneMapping: "neutral",
    bloom: {
      intensity: 0.7,
      luminanceThreshold: 0.85,
      luminanceSmoothing: 0.25,
      mipmapBlur: true,
      radius: 0.7,
    },
    vignette: { offset: 0.32, darkness: 0.4 },
    ao: { aoRadius: 0.8, distanceFalloff: 0.8, intensity: 2.0 },
    saturation: 0,
    dither: 45,
  },
  "outdoor-vivid": {
    toneMapping: "neutral",
    bloom: {
      intensity: 0.3,
      luminanceThreshold: 3.5,
      luminanceSmoothing: 0.25,
      mipmapBlur: true,
    },
    vignette: false,
    ao: { aoRadius: 0.7, distanceFalloff: 1.0, intensity: 1.8 },
    saturation: 0.08,
    dither: 30,
  },
  "medical-clinical": {
    toneMapping: "neutral",
    bloom: {
      intensity: 0.18,
      luminanceThreshold: 4.5,
      luminanceSmoothing: 0.2,
      mipmapBlur: true,
    },
    vignette: false,
    ao: { aoRadius: 0.5, distanceFalloff: 0.8, intensity: 1.6 },
    saturation: -0.04,
    dither: 45,
  },
  "xray-cutaway": {
    toneMapping: "neutral",
    bloom: {
      intensity: 0.55,
      luminanceThreshold: 1.0,
      luminanceSmoothing: 0.25,
      mipmapBlur: true,
      radius: 0.75,
    },
    vignette: { offset: 0.35, darkness: 0.35 },
    ao: { aoRadius: 0.6, distanceFalloff: 0.8, intensity: 1.6 },
    saturation: 0.05,
    dither: 50,
  },
  "horror-dark": {
    toneMapping: "agx",
    bloom: {
      intensity: 0.5,
      luminanceThreshold: 1.0,
      luminanceSmoothing: 0.3,
      mipmapBlur: true,
    },
    vignette: { offset: 0.26, darkness: 0.58 },
    ao: { aoRadius: 0.9, distanceFalloff: 0.9, intensity: 2.6 },
    saturation: -0.18,
    dither: 50,
  },
  "documentary-grit": {
    toneMapping: "agx",
    bloom: {
      intensity: 0.28,
      luminanceThreshold: 2.2,
      luminanceSmoothing: 0.25,
      mipmapBlur: true,
    },
    vignette: { offset: 0.34, darkness: 0.32 },
    ao: { aoRadius: 0.7, distanceFalloff: 0.9, intensity: 2.2 },
    saturation: -0.1,
    dither: 40,
  },
  "warm-nostalgic": {
    toneMapping: "agx",
    bloom: {
      intensity: 0.5,
      luminanceThreshold: 1.4,
      luminanceSmoothing: 0.3,
      mipmapBlur: true,
      radius: 0.85,
    },
    vignette: { offset: 0.3, darkness: 0.38 },
    ao: { aoRadius: 0.6, distanceFalloff: 0.9, intensity: 1.9 },
    saturation: 0.06,
    dither: 40,
  },
  "underwater-deep": {
    toneMapping: "agx",
    bloom: {
      intensity: 0.45,
      luminanceThreshold: 1.5,
      luminanceSmoothing: 0.3,
      mipmapBlur: true,
    },
    vignette: { offset: 0.28, darkness: 0.45 },
    ao: { aoRadius: 1.0, distanceFalloff: 1.0, intensity: 2.2 },
    saturation: 0.04,
    dither: 50,
  },
  "space-crisp": {
    toneMapping: "neutral",
    bloom: {
      intensity: 0.6,
      luminanceThreshold: 1.3,
      luminanceSmoothing: 0.2,
      mipmapBlur: true,
      radius: 0.65,
    },
    vignette: false,
    ao: { aoRadius: 0.6, distanceFalloff: 0.8, intensity: 1.5 },
    saturation: 0,
    dither: 45,
  },
} as const satisfies Record<string, LookdevProfile>;

export type LookdevProfileId = keyof typeof LOOKDEV_PROFILES;

export const LOOKDEV_PROFILE_IDS = Object.keys(LOOKDEV_PROFILES) as LookdevProfileId[];

const VALID_TONE_MAPS: readonly ToneMapName[] = ["agx", "neutral", "aces"];
const DEFAULT_VIGNETTE: VignetteConfig = { offset: 0.3, darkness: 0.45 };

export interface PostConfigOptions {
  profile?: LookdevProfileId;
  toneMapping?: ToneMapName;
  bloom?: Partial<BloomConfig> | false;
  vignette?: Partial<VignetteConfig> | false;
  ao?: Partial<AOConfig> | false;
  saturation?: number;
  dither?: number;
  multisampling?: number;
  smaa?: boolean;
  dof?: boolean;
  draft?: boolean;
}

export interface ResolvedPostConfig {
  profile: LookdevProfileId;
  toneMapping: ToneMapName;
  bloom: BloomConfig | false;
  vignette: VignetteConfig | false;
  ao: AOConfig | false;
  saturation: number;
  dither: number;
  multisampling: number;
  smaa: boolean;
  dof: boolean;
  draft: boolean;
}

function mergeDefined<T extends object>(base: T, overrides?: Partial<T>): T {
  const out = { ...base };
  if (!overrides) return out;
  for (const [k, v] of Object.entries(overrides) as [keyof T, T[keyof T]][]) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function resolvePostConfig(opts: PostConfigOptions = {}): ResolvedPostConfig {
  const profileId: LookdevProfileId = opts.profile === undefined ? "cinematic" : opts.profile;
  if (typeof profileId !== "string" || !Object.hasOwn(LOOKDEV_PROFILES, profileId)) {
    throw new Error(
      `Unknown lookdev profile ${JSON.stringify(opts.profile)}. Expected one of: ${LOOKDEV_PROFILE_IDS.join(", ")}`,
    );
  }
  const base: LookdevProfile = LOOKDEV_PROFILES[profileId];

  const toneMapping = opts.toneMapping ?? base.toneMapping;
  if (typeof toneMapping !== "string" || !VALID_TONE_MAPS.includes(toneMapping)) {
    throw new Error(
      `Unknown toneMapping ${JSON.stringify(opts.toneMapping)}. Expected one of: ${VALID_TONE_MAPS.join(", ")}`,
    );
  }

  const bloom: BloomConfig | false =
    opts.bloom === false ? false : mergeDefined<BloomConfig>({ ...base.bloom }, opts.bloom);

  const vignette: VignetteConfig | false =
    opts.vignette === false
      ? false
      : opts.vignette === undefined
        ? base.vignette
          ? { ...base.vignette }
          : false
        : mergeDefined<VignetteConfig>(
            base.vignette ? { ...base.vignette } : { ...DEFAULT_VIGNETTE },
            opts.vignette,
          );

  const ao: AOConfig | false =
    opts.ao === false ? false : mergeDefined<AOConfig>({ ...base.ao }, opts.ao);

  const rawDither = opts.dither ?? base.dither;
  const dither = Number.isFinite(rawDither) ? Math.max(0, rawDither) : 0;

  const rawMsaa = opts.multisampling ?? 4;
  const multisampling = Number.isFinite(rawMsaa) ? Math.max(0, Math.floor(rawMsaa)) : 4;

  const rawSat = opts.saturation ?? base.saturation;
  const saturation = Number.isFinite(rawSat) ? rawSat : base.saturation;

  return {
    profile: profileId,
    toneMapping,
    bloom,
    vignette,
    ao,
    saturation,
    dither,
    multisampling,
    smaa: opts.smaa ?? true,
    dof: opts.dof ?? true,
    draft: opts.draft ?? false,
  };
}

export type ScreenEffectPresetId = "cctv" | "vhs-crt" | "night-vision" | "thermal";

export interface ScreenEffectPreset {
  readonly intensity: number;
  readonly scanlines: number;
  readonly grain: number;
  readonly vignette: number;
  readonly chromaticAberration: number;
  readonly tracking: number;
  readonly tint: readonly [number, number, number];
}

export const SCREEN_EFFECT_PRESETS = {
  cctv: {
    intensity: 1,
    scanlines: 0.28,
    grain: 0.12,
    vignette: 0.35,
    chromaticAberration: 0,
    tracking: 0,
    tint: [0.8, 0.96, 0.86],
  },
  "vhs-crt": {
    intensity: 1,
    scanlines: 0.22,
    grain: 0.1,
    vignette: 0.3,
    chromaticAberration: 0.0045,
    tracking: 0.35,
    tint: [1, 0.99, 0.97],
  },
  "night-vision": {
    intensity: 1,
    scanlines: 0.14,
    grain: 0.16,
    vignette: 0.72,
    chromaticAberration: 0,
    tracking: 0,
    tint: [0.18, 1, 0.28],
  },
  thermal: {
    intensity: 1,
    scanlines: 0.08,
    grain: 0.06,
    vignette: 0.25,
    chromaticAberration: 0,
    tracking: 0,
    tint: [1, 1, 1],
  },
} as const satisfies Record<ScreenEffectPresetId, ScreenEffectPreset>;

export const SCREEN_EFFECT_PRESET_IDS = Object.keys(
  SCREEN_EFFECT_PRESETS,
) as ScreenEffectPresetId[];

export interface ScreenEffectOptions {
  intensity?: number;
  scanlines?: number;
  grain?: number;
  vignette?: number;
  chromaticAberration?: number;
  tracking?: number;
  tint?: readonly [number, number, number];
}

const clampUnit = (v: number, fallback: number): number =>
  Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

const nonNeg = (v: number, fallback: number): number =>
  Number.isFinite(v) ? Math.max(0, v) : fallback;

export function resolveScreenEffectConfig(
  preset: ScreenEffectPresetId,
  opts: ScreenEffectOptions = {},
): ScreenEffectPreset {
  if (typeof preset !== "string" || !Object.hasOwn(SCREEN_EFFECT_PRESETS, preset)) {
    throw new Error(
      `Unknown screen effect preset ${JSON.stringify(preset)}. Expected one of: ${SCREEN_EFFECT_PRESET_IDS.join(", ")}`,
    );
  }
  const base = SCREEN_EFFECT_PRESETS[preset];
  const tint: readonly [number, number, number] = opts.tint
    ? [
        nonNeg(opts.tint[0], base.tint[0]),
        nonNeg(opts.tint[1], base.tint[1]),
        nonNeg(opts.tint[2], base.tint[2]),
      ]
    : [...base.tint];
  return {
    intensity: clampUnit(opts.intensity ?? base.intensity, base.intensity),
    scanlines: clampUnit(opts.scanlines ?? base.scanlines, base.scanlines),
    grain: clampUnit(opts.grain ?? base.grain, base.grain),
    vignette: clampUnit(opts.vignette ?? base.vignette, base.vignette),
    chromaticAberration: nonNeg(
      opts.chromaticAberration ?? base.chromaticAberration,
      base.chromaticAberration,
    ),
    tracking: clampUnit(opts.tracking ?? base.tracking, base.tracking),
    tint,
  };
}
