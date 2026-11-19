import { easeOf } from "./camera-meta";

export type Vec3 = [number, number, number];
export type FogMode = "none" | "linear" | "exp2";
export type PracticalKind = "point" | "spot";

export interface PracticalFlickerConfig {
  rate?: number;
  speed?: number;
  amount?: number;
  seed?: number;
}

export type PracticalFlicker = boolean | PracticalFlickerConfig;

export interface KeyLightState {
  enabled: boolean;
  color: string;
  intensity: number;
  azimuth: number;
  elevation: number;
  shadowRadius: number;
  castShadow: boolean;
}

export interface FillLightState {
  enabled: boolean;
  color: string;
  intensity: number;
  azimuth: number;
  elevation: number;
  negativeFill: boolean;
}

export interface RimLightState {
  enabled: boolean;
  color: string;
  intensity: number;
  azimuth: number;
  elevation: number;
}

export interface WorldLightState {
  skyColor: string;
  groundColor: string;
  ambientIntensity: number;
  background: string | null;
}

export interface FogState {
  mode: FogMode;
  color: string;
  near: number;
  far: number;
  density: number;
}

export interface PracticalState {
  id: string;
  name: string;
  kind: PracticalKind;
  at: Vec3;
  target?: Vec3;
  color: string;
  intensity: number;
  distance: number;
  decay: number;
  angle?: number;
  penumbra?: number;
  flicker?: PracticalFlicker;
}

export interface GodraysState {
  enabled: boolean;
  density: number;
  maxDensity: number;
  edgeStrength: number;
  edgeRadius: number;
  raymarchSteps: number;
  blur: boolean;
  weight: number;
  color?: string;
}

export interface LightsState {
  target?: Vec3;
  key: KeyLightState;
  fill: FillLightState;
  rim: RimLightState;
  world: WorldLightState;
  fog: FogState;
  practicals: PracticalState[];
  godrays: GodraysState;
}

export type LightEase = string | readonly [number, number, number, number];

export interface LightKey {
  id?: string;
  t: number;
  cut?: boolean;
  ease?: LightEase;
  preset?: LightPresetId | (string & {});
  target?: Vec3;
  key?: Partial<KeyLightState>;
  fill?: Partial<FillLightState>;
  rim?: Partial<RimLightState>;
  world?: Partial<WorldLightState>;
  fog?: Partial<FogState>;
  practicals?: PracticalState[];
  godrays?: Partial<GodraysState>;
}

export interface LightsDoc {
  target?: Vec3;
  keys: LightKey[];
}

export type LightPresetId =
  | "golden-hour"
  | "fluorescent-hall"
  | "noir-night"
  | "warm-hearth"
  | "overcast-doc"
  | "studio-three-point";

export interface LightPreset {
  id: LightPresetId;
  title: string;
  tip: string;
  state: LightsState;
}

export const KELVIN_CHIPS: readonly { label: string; k: number }[] = [
  { label: "1900K", k: 1900 },
  { label: "2700K", k: 2700 },
  { label: "3200K", k: 3200 },
  { label: "4500K", k: 4500 },
  { label: "5600K", k: 5600 },
  { label: "6500K", k: 6500 },
  { label: "9000K", k: 9000 },
];

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
const mixVec3 = (a: Vec3, b: Vec3, u: number): Vec3 => [
  lerp(a[0], b[0], u),
  lerp(a[1], b[1], u),
  lerp(a[2], b[2], u),
];

const byteHex = (v: number): string => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");

/** Convert a correlated color temperature in Kelvin [1000..40000] to `#rrggbb`. */
export function kelvinToHex(kelvin: number): string {
  const temp = clamp(Number.isFinite(kelvin) ? kelvin : 5600, 1000, 40000) / 100;
  const r = temp <= 66 ? 255 : 329.698727446 * (temp - 60) ** -0.1332047592;
  const g =
    temp <= 66
      ? 99.4708025861 * Math.log(temp) - 161.1195681661
      : 288.1221695283 * (temp - 60) ** -0.0755148492;
  const b =
    temp >= 66 ? 255 : temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  return `#${byteHex(r)}${byteHex(g)}${byteHex(b)}`;
}

const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

const linearToSrgb = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.max(0, c) ** (1 / 2.4) - 0.055;

function normalizeHex(color: string | undefined, fallback: string): string {
  if (!color) return fallback;
  const m = color.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return fallback;
  const raw = m[1].toLowerCase();
  return raw.length === 3 ? `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}` : `#${raw}`;
}

function parseHexLinear(hex: string): [number, number, number] {
  const clean = normalizeHex(hex, "#ffffff").slice(1);
  return [
    srgbToLinear(parseInt(clean.slice(0, 2), 16) / 255),
    srgbToLinear(parseInt(clean.slice(2, 4), 16) / 255),
    srgbToLinear(parseInt(clean.slice(4, 6), 16) / 255),
  ];
}

function mixHexLinear(a: string, b: string, u: number): string {
  if (a === b) return normalizeHex(a, a);
  const [ar, ag, ab] = parseHexLinear(a);
  const [br, bg, bb] = parseHexLinear(b);
  const r = linearToSrgb(clamp(lerp(ar, br, u), 0, 1)) * 255;
  const g = linearToSrgb(clamp(lerp(ag, bg, u), 0, 1)) * 255;
  const bl = linearToSrgb(clamp(lerp(ab, bb, u), 0, 1)) * 255;
  return `#${byteHex(r)}${byteHex(g)}${byteHex(bl)}`;
}

function mixAngleDeg(a: number, b: number, u: number): number {
  const diff = ((((b - a) % 360) + 540) % 360) - 180;
  return ((((a + diff * u + 180) % 360) + 360) % 360) - 180;
}

export const DEFAULT_LIGHTS: LightsState = {
  key: {
    enabled: true,
    color: "#fff4e4",
    intensity: 2.4,
    azimuth: 42,
    elevation: 38,
    shadowRadius: 2.5,
    castShadow: true,
  },
  fill: {
    enabled: true,
    color: "#c9dcf2",
    intensity: 0.9,
    azimuth: -55,
    elevation: 24,
    negativeFill: false,
  },
  rim: {
    enabled: true,
    color: "#e8f0ff",
    intensity: 1.5,
    azimuth: 155,
    elevation: 30,
  },
  world: {
    skyColor: "#dfe6f0",
    groundColor: "#3a3026",
    ambientIntensity: 0.7,
    background: null,
  },
  fog: {
    mode: "none",
    color: "#c8d4e0",
    near: 10,
    far: 45,
    density: 0.02,
  },
  practicals: [],
  godrays: {
    enabled: false,
    density: 0.015,
    maxDensity: 0.5,
    edgeStrength: 2,
    edgeRadius: 2,
    raymarchSteps: 60,
    blur: true,
    weight: 1,
  },
};

export const LIGHT_PRESETS: Record<LightPresetId, LightPreset> = {
  "golden-hour": {
    id: "golden-hour",
    title: "Golden Hour",
    tip: "Low warm 3400K sun casting long shadows with cool sky fill and sun shafts.",
    state: {
      key: {
        enabled: true,
        color: kelvinToHex(3400),
        intensity: 3.1,
        azimuth: 38,
        elevation: 15,
        shadowRadius: 2,
        castShadow: true,
      },
      fill: {
        enabled: true,
        color: kelvinToHex(8200),
        intensity: 0.85,
        azimuth: -125,
        elevation: 28,
        negativeFill: false,
      },
      rim: {
        enabled: true,
        color: "#ffd194",
        intensity: 1.9,
        azimuth: 165,
        elevation: 18,
      },
      world: {
        skyColor: "#9ebce0",
        groundColor: "#5e3d28",
        ambientIntensity: 0.65,
        background: "#1c202a",
      },
      fog: {
        mode: "exp2",
        color: "#d9a97c",
        near: 10,
        far: 45,
        density: 0.018,
      },
      practicals: [],
      godrays: {
        enabled: true,
        density: 0.016,
        maxDensity: 0.45,
        edgeStrength: 2.2,
        edgeRadius: 2.5,
        raymarchSteps: 60,
        blur: true,
        weight: 0.9,
        color: "#ffd099",
      },
    },
  },
  "fluorescent-hall": {
    id: "fluorescent-hall",
    title: "Fluorescent Hall",
    tip: "Cool sterile 4800K overhead cast with flat broad fill and zero haze.",
    state: {
      key: {
        enabled: true,
        color: "#ecf7f1",
        intensity: 2.1,
        azimuth: 10,
        elevation: 68,
        shadowRadius: 3.5,
        castShadow: true,
      },
      fill: {
        enabled: true,
        color: "#d8eae5",
        intensity: 1.45,
        azimuth: -95,
        elevation: 45,
        negativeFill: false,
      },
      rim: {
        enabled: true,
        color: "#e4f5f0",
        intensity: 0.8,
        azimuth: 175,
        elevation: 50,
      },
      world: {
        skyColor: "#dde8e4",
        groundColor: "#485250",
        ambientIntensity: 0.9,
        background: "#131718",
      },
      fog: {
        mode: "none",
        color: "#cfd8d5",
        near: 14,
        far: 55,
        density: 0.008,
      },
      practicals: [],
      godrays: { ...DEFAULT_LIGHTS.godrays, enabled: false },
    },
  },
  "noir-night": {
    id: "noir-night",
    title: "Noir Night",
    tip: "Crisp cool moonlight key, negative fill shadows, and sharp rim edge.",
    state: {
      key: {
        enabled: true,
        color: kelvinToHex(8200),
        intensity: 2.2,
        azimuth: -42,
        elevation: 40,
        shadowRadius: 1.5,
        castShadow: true,
      },
      fill: {
        enabled: true,
        color: "#294066",
        intensity: 0.3,
        azimuth: 75,
        elevation: 18,
        negativeFill: true,
      },
      rim: {
        enabled: true,
        color: "#cfe2ff",
        intensity: 2.3,
        azimuth: 145,
        elevation: 32,
      },
      world: {
        skyColor: "#24344d",
        groundColor: "#0e1118",
        ambientIntensity: 0.28,
        background: "#06080d",
      },
      fog: {
        mode: "exp2",
        color: "#0e1522",
        near: 8,
        far: 34,
        density: 0.028,
      },
      practicals: [],
      godrays: {
        enabled: true,
        density: 0.012,
        maxDensity: 0.35,
        edgeStrength: 2,
        edgeRadius: 2,
        raymarchSteps: 60,
        blur: true,
        weight: 0.75,
        color: "#9bc2ff",
      },
    },
  },
  "warm-hearth": {
    id: "warm-hearth",
    title: "Warm Hearth",
    tip: "Intimate 2400K amber interior glow with gentle warm bounce.",
    state: {
      key: {
        enabled: true,
        color: kelvinToHex(2400),
        intensity: 2.0,
        azimuth: 52,
        elevation: 24,
        shadowRadius: 4,
        castShadow: true,
      },
      fill: {
        enabled: true,
        color: "#574854",
        intensity: 0.65,
        azimuth: -70,
        elevation: 22,
        negativeFill: false,
      },
      rim: {
        enabled: true,
        color: "#ffb66e",
        intensity: 1.35,
        azimuth: 150,
        elevation: 25,
      },
      world: {
        skyColor: "#75513c",
        groundColor: "#2e1d14",
        ambientIntensity: 0.52,
        background: "#160e0a",
      },
      fog: {
        mode: "linear",
        color: "#3d261a",
        near: 10,
        far: 38,
        density: 0.015,
      },
      practicals: [],
      godrays: { ...DEFAULT_LIGHTS.godrays, enabled: false },
    },
  },
  "overcast-doc": {
    id: "overcast-doc",
    title: "Overcast Doc",
    tip: "Diffused 6500K sky light, soft shadow penumbra, natural documentary contrast.",
    state: {
      key: {
        enabled: true,
        color: kelvinToHex(6500),
        intensity: 1.7,
        azimuth: 25,
        elevation: 54,
        shadowRadius: 5.5,
        castShadow: true,
      },
      fill: {
        enabled: true,
        color: "#dde6f2",
        intensity: 1.35,
        azimuth: -80,
        elevation: 36,
        negativeFill: false,
      },
      rim: {
        enabled: true,
        color: "#edf3fc",
        intensity: 0.85,
        azimuth: 165,
        elevation: 42,
      },
      world: {
        skyColor: "#d5e0ec",
        groundColor: "#4b4f54",
        ambientIntensity: 0.85,
        background: "#9fb0c2",
      },
      fog: {
        mode: "linear",
        color: "#b7c4d1",
        near: 14,
        far: 60,
        density: 0.012,
      },
      practicals: [],
      godrays: { ...DEFAULT_LIGHTS.godrays, enabled: false },
    },
  },
  "studio-three-point": {
    id: "studio-three-point",
    title: "Studio Three-Point",
    tip: "Classic 5600K key, cool fill, and crisp rim separation.",
    state: {
      ...DEFAULT_LIGHTS,
      key: { ...DEFAULT_LIGHTS.key, color: kelvinToHex(5600), intensity: 2.45 },
      fill: { ...DEFAULT_LIGHTS.fill, color: "#bdd6f2", intensity: 0.95 },
      rim: { ...DEFAULT_LIGHTS.rim, color: "#eef4ff", intensity: 1.65 },
      world: { ...DEFAULT_LIGHTS.world, ambientIntensity: 0.65 },
      fog: { ...DEFAULT_LIGHTS.fog, mode: "none" },
      practicals: [],
      godrays: { ...DEFAULT_LIGHTS.godrays, enabled: false },
    },
  },
};

export const LIGHT_PRESET_IDS = Object.keys(LIGHT_PRESETS) as LightPresetId[];

function clonePractical(p: PracticalState): PracticalState {
  return {
    ...p,
    at: [...p.at] as Vec3,
    ...(p.target ? { target: [...p.target] as Vec3 } : {}),
    ...(typeof p.flicker === "object" && p.flicker !== null ? { flicker: { ...p.flicker } } : {}),
  };
}

export function cloneLightsState(s: LightsState): LightsState {
  return {
    ...(s.target ? { target: [...s.target] as Vec3 } : {}),
    key: { ...s.key },
    fill: { ...s.fill },
    rim: { ...s.rim },
    world: { ...s.world },
    fog: { ...s.fog },
    practicals: s.practicals.map(clonePractical),
    godrays: { ...s.godrays },
  };
}

function mergeStates(base: LightsState, patch: LightKey, docTarget?: Vec3): LightsState {
  const target = patch.target ?? base.target ?? docTarget;
  return {
    ...(target ? { target: [...target] as Vec3 } : {}),
    key: { ...base.key, ...patch.key },
    fill: { ...base.fill, ...patch.fill },
    rim: { ...base.rim, ...patch.rim },
    world: { ...base.world, ...patch.world },
    fog: { ...base.fog, ...patch.fog },
    practicals: (patch.practicals ?? base.practicals).map(clonePractical),
    godrays: { ...base.godrays, ...patch.godrays },
  };
}

export function normalizeLightsDoc(input: LightsDoc | LightKey[] | null | undefined): LightsDoc {
  if (!input) return { keys: [] };
  if (Array.isArray(input)) return { keys: input };
  return {
    ...(input.target ? { target: [...input.target] as Vec3 } : {}),
    keys: Array.isArray(input.keys) ? input.keys : [],
  };
}

export interface ResolvedLightKey {
  t: number;
  cut: boolean;
  ease?: LightEase;
  state: LightsState;
}

const resolvedCache = new WeakMap<
  object,
  {
    keysRef: LightKey[];
    target: Vec3 | undefined;
    len: number;
    first: LightKey | undefined;
    last: LightKey | undefined;
    resolved: ResolvedLightKey[];
  }
>();

/** Resolve carried-forward state at every sorted keyframe, resetting cleanly on `cut: true` or presets. */
export function resolveLightKeys(
  input: LightsDoc | LightKey[] | null | undefined,
): ResolvedLightKey[] {
  const doc = normalizeLightsDoc(input);
  if (doc.keys.length === 0) return [];
  if (input && typeof input === "object") {
    const rawKeys = Array.isArray(input) ? input : input.keys;
    const rawTarget = Array.isArray(input) ? undefined : input.target;
    const cached = resolvedCache.get(input);
    if (
      cached &&
      cached.keysRef === rawKeys &&
      cached.target === rawTarget &&
      cached.len === rawKeys.length &&
      cached.first === rawKeys[0] &&
      cached.last === rawKeys[rawKeys.length - 1]
    ) {
      return cached.resolved;
    }
  }
  const sorted = [...doc.keys].sort((a, b) => a.t - b.t);
  const out: ResolvedLightKey[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const key = sorted[i];
    const presetState =
      key.preset && key.preset in LIGHT_PRESETS
        ? LIGHT_PRESETS[key.preset as LightPresetId].state
        : null;
    const base =
      i === 0 || key.cut
        ? cloneLightsState(presetState ?? DEFAULT_LIGHTS)
        : presetState
          ? cloneLightsState(presetState)
          : cloneLightsState(out[i - 1].state);
    out.push({
      t: key.t,
      cut: !!key.cut,
      ease: key.ease,
      state: mergeStates(base, key, doc.target),
    });
  }
  if (input && typeof input === "object") {
    const rawKeys = Array.isArray(input) ? input : input.keys;
    const rawTarget = Array.isArray(input) ? undefined : input.target;
    if (Array.isArray(rawKeys)) {
      resolvedCache.set(input, {
        keysRef: rawKeys,
        target: rawTarget,
        len: rawKeys.length,
        first: rawKeys[0],
        last: rawKeys[rawKeys.length - 1],
        resolved: out,
      });
    }
  }
  return out;
}

function interpolatePractical(
  a: PracticalState | undefined,
  b: PracticalState | undefined,
  u: number,
): PracticalState {
  if (a && !b) {
    return {
      ...clonePractical(a),
      intensity: Math.max(0, a.intensity * clamp(1 - u, 0, 1)),
    };
  }
  if (!a && b) {
    return {
      ...clonePractical(b),
      intensity: Math.max(0, b.intensity * clamp(u, 0, 1)),
    };
  }
  const pa = a!,
    pb = b!;
  const chosen = u < 0.5 ? pa : pb;
  const targetA = pa.target ?? pa.at;
  const targetB = pb.target ?? pb.at;
  return {
    id: pa.id,
    name: chosen.name,
    kind: chosen.kind,
    at: mixVec3(pa.at, pb.at, u),
    ...(pa.target || pb.target ? { target: mixVec3(targetA, targetB, u) } : {}),
    color: mixHexLinear(pa.color, pb.color, u),
    intensity: Math.max(0, lerp(pa.intensity, pb.intensity, u)),
    distance: Math.max(0, lerp(pa.distance, pb.distance, u)),
    decay: clamp(lerp(pa.decay, pb.decay, u), 0, 10),
    ...(pa.angle !== undefined || pb.angle !== undefined
      ? { angle: clamp(lerp(pa.angle ?? 45, pb.angle ?? 45, u), 1, 89) }
      : {}),
    ...(pa.penumbra !== undefined || pb.penumbra !== undefined
      ? { penumbra: clamp(lerp(pa.penumbra ?? 0.3, pb.penumbra ?? 0.3, u), 0, 1) }
      : {}),
    ...(chosen.flicker !== undefined
      ? {
          flicker:
            typeof chosen.flicker === "object" && chosen.flicker !== null
              ? { ...chosen.flicker }
              : chosen.flicker,
        }
      : {}),
  };
}

function interpolateLights(a: LightsState, b: LightsState, u: number): LightsState {
  const half = u >= 0.5;
  const byId = new Map<string, PracticalState>(b.practicals.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const practicals: PracticalState[] = [];

  for (const pa of a.practicals) {
    seen.add(pa.id);
    practicals.push(interpolatePractical(pa, byId.get(pa.id), u));
  }
  for (const pb of b.practicals) {
    if (!seen.has(pb.id)) practicals.push(interpolatePractical(undefined, pb, u));
  }

  const target = a.target && b.target ? mixVec3(a.target, b.target, u) : half ? b.target : a.target;
  const background =
    a.world.background && b.world.background
      ? mixHexLinear(a.world.background, b.world.background, u)
      : half
        ? b.world.background
        : a.world.background;
  const raysColor =
    a.godrays.color && b.godrays.color
      ? mixHexLinear(a.godrays.color, b.godrays.color, u)
      : half
        ? b.godrays.color
        : a.godrays.color;

  return {
    ...(target ? { target } : {}),
    key: {
      enabled: half ? b.key.enabled : a.key.enabled,
      color: mixHexLinear(a.key.color, b.key.color, u),
      intensity: Math.max(0, lerp(a.key.intensity, b.key.intensity, u)),
      azimuth: mixAngleDeg(a.key.azimuth, b.key.azimuth, u),
      elevation: clamp(lerp(a.key.elevation, b.key.elevation, u), -90, 90),
      shadowRadius: clamp(lerp(a.key.shadowRadius, b.key.shadowRadius, u), 0, 32),
      castShadow: half ? b.key.castShadow : a.key.castShadow,
    },
    fill: {
      enabled: half ? b.fill.enabled : a.fill.enabled,
      color: mixHexLinear(a.fill.color, b.fill.color, u),
      intensity: Math.max(0, lerp(a.fill.intensity, b.fill.intensity, u)),
      azimuth: mixAngleDeg(a.fill.azimuth, b.fill.azimuth, u),
      elevation: clamp(lerp(a.fill.elevation, b.fill.elevation, u), -90, 90),
      negativeFill: half ? b.fill.negativeFill : a.fill.negativeFill,
    },
    rim: {
      enabled: half ? b.rim.enabled : a.rim.enabled,
      color: mixHexLinear(a.rim.color, b.rim.color, u),
      intensity: Math.max(0, lerp(a.rim.intensity, b.rim.intensity, u)),
      azimuth: mixAngleDeg(a.rim.azimuth, b.rim.azimuth, u),
      elevation: clamp(lerp(a.rim.elevation, b.rim.elevation, u), -90, 90),
    },
    world: {
      skyColor: mixHexLinear(a.world.skyColor, b.world.skyColor, u),
      groundColor: mixHexLinear(a.world.groundColor, b.world.groundColor, u),
      ambientIntensity: clamp(lerp(a.world.ambientIntensity, b.world.ambientIntensity, u), 0, 10),
      background,
    },
    fog: {
      mode: half ? b.fog.mode : a.fog.mode,
      color: mixHexLinear(a.fog.color, b.fog.color, u),
      near: Math.max(0, lerp(a.fog.near, b.fog.near, u)),
      far: Math.max(0, lerp(a.fog.far, b.fog.far, u)),
      density: clamp(lerp(a.fog.density, b.fog.density, u), 0, 2),
    },
    practicals,
    godrays: {
      enabled: half ? b.godrays.enabled : a.godrays.enabled,
      density: clamp(lerp(a.godrays.density, b.godrays.density, u), 0, 1),
      maxDensity: clamp(lerp(a.godrays.maxDensity, b.godrays.maxDensity, u), 0, 1),
      edgeStrength: clamp(lerp(a.godrays.edgeStrength, b.godrays.edgeStrength, u), 0, 20),
      edgeRadius: clamp(lerp(a.godrays.edgeRadius, b.godrays.edgeRadius, u), 0, 20),
      raymarchSteps: clamp(
        Math.round(lerp(a.godrays.raymarchSteps, b.godrays.raymarchSteps, u)),
        4,
        240,
      ),
      blur: half ? b.godrays.blur : a.godrays.blur,
      weight: clamp(lerp(a.godrays.weight, b.godrays.weight, u), 0, 5),
      ...(raysColor ? { color: raysColor } : {}),
    },
  };
}

/** Pure deterministic evaluation `f(t)` of lighting keyframes, returning defaults when absent. */
export function lightsAt(input: LightsDoc | LightKey[] | null | undefined, t: number): LightsState {
  const resolved = resolveLightKeys(input);
  if (resolved.length === 0) return cloneLightsState(DEFAULT_LIGHTS);
  if (t < resolved[0].t) return cloneLightsState(resolved[0].state);
  const last = resolved[resolved.length - 1];
  if (t >= last.t) return cloneLightsState(last.state);

  let idx = 0;
  for (let i = 0; i < resolved.length - 1; i++) {
    if (t >= resolved[i].t && t < resolved[i + 1].t) {
      idx = i;
      break;
    }
  }
  const a = resolved[idx];
  const b = resolved[idx + 1];
  if (b.cut || b.t <= a.t) return cloneLightsState(a.state);

  const raw = clamp((t - a.t) / (b.t - a.t), 0, 1);
  const u = easeOf(b.ease)(raw);
  return interpolateLights(a.state, b.state, u);
}

function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 10000;
}

const fract = (x: number): number => x - Math.floor(x);
const seededNoise = (n: number, seed: number): number =>
  fract(Math.sin(n * 127.1 + seed * 311.7) * 43758.5453123);

/** Seeded deterministic practical intensity at time `t` (never uses `Math.random`). */
export function practicalIntensityAt(p: PracticalState, t: number, fallbackSeed = 0): number {
  if (!p.flicker) return Math.max(0, p.intensity);
  const cfg = p.flicker === true ? {} : p.flicker;
  const rate = Math.max(0.1, cfg.rate ?? cfg.speed ?? 8);
  const amount = clamp(cfg.amount ?? 0.25, 0, 1);
  const seed = cfg.seed ?? (p.id ? hashSeed(p.id) : fallbackSeed);
  const phase = t * rate;
  const n = Math.floor(phase);
  const f = phase - n;
  const u = f * f * (3 - 2 * f);
  const v = lerp(seededNoise(n, seed), seededNoise(n + 1, seed), u);
  return Math.max(0, p.intensity * (1 + (v * 2 - 1) * amount));
}
