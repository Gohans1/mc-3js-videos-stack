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
  shadowExtent?: number;
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
  | "studio-three-point"
  | "daylight-exterior"
  | "bedroom-night"
  | "diner-warm"
  | "office-daylight"
  | "moonlit-exterior"
  | "studio-void"
  | "hospital-clinical"
  | "neon-city"
  | "dusk-twilight"
  | "storm-rain"
  | "underwater-shallow"
  | "underwater-deep"
  | "space-orbit"
  | "xray-cutaway"
  | "dramatic-diorama"
  | "arctic-snow"
  | "desert-harsh"
  | "forest-canopy"
  | "fire-hazard"
  | "cabin-interior";

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
        shadowRadius: 3.5,
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
  "daylight-exterior": {
    id: "daylight-exterior",
    title: "Daylight Exterior",
    tip: "Crisp daytime sun with open blue sky bounce for roads, streets, and beaches.",
    state: {
      key: {
        enabled: true,
        color: kelvinToHex(5400),
        intensity: 3.0,
        azimuth: -42,
        elevation: 48,
        shadowRadius: 2.2,
        castShadow: true,
      },
      fill: {
        enabled: true,
        color: "#b8d6f5",
        intensity: 0.75,
        azimuth: 120,
        elevation: 32,
        negativeFill: false,
      },
      rim: {
        enabled: true,
        color: "#fff2dc",
        intensity: 1.1,
        azimuth: 160,
        elevation: 24,
      },
      world: {
        skyColor: "#cfe4f8",
        groundColor: "#5c564a",
        ambientIntensity: 0.75,
        background: "#c8dceb",
      },
      fog: {
        mode: "linear",
        color: "#d4e3ee",
        near: 35,
        far: 180,
        density: 0.006,
      },
      practicals: [],
      godrays: { ...DEFAULT_LIGHTS.godrays, enabled: false },
    },
  },
  "bedroom-night": {
    id: "bedroom-night",
    title: "Bedroom Night",
    tip: "Cool moonlight window spill with intimate shadows for night interiors.",
    state: {
      key: {
        enabled: true,
        color: "#8ab2e8",
        intensity: 1.35,
        azimuth: -50,
        elevation: 32,
        shadowRadius: 2.8,
        castShadow: true,
      },
      fill: {
        enabled: true,
        color: "#2a3b58",
        intensity: 0.35,
        azimuth: 95,
        elevation: 20,
        negativeFill: true,
      },
      rim: {
        enabled: true,
        color: "#b7d4ff",
        intensity: 1.25,
        azimuth: 145,
        elevation: 26,
      },
      world: {
        skyColor: "#263650",
        groundColor: "#14161e",
        ambientIntensity: 0.32,
        background: "#090d16",
      },
      fog: {
        mode: "none",
        color: "#111826",
        near: 8,
        far: 32,
        density: 0.02,
      },
      practicals: [],
      godrays: { ...DEFAULT_LIGHTS.godrays, enabled: false },
    },
  },
  "diner-warm": {
    id: "diner-warm",
    title: "Diner Warm",
    tip: "Warm overhead tungsten interior with cozy amber bounce for cafes and kitchens.",
    state: {
      key: {
        enabled: true,
        color: kelvinToHex(3200),
        intensity: 2.35,
        azimuth: 34,
        elevation: 58,
        shadowRadius: 3.0,
        castShadow: true,
      },
      fill: {
        enabled: true,
        color: "#f2c99b",
        intensity: 0.85,
        azimuth: -115,
        elevation: 30,
        negativeFill: false,
      },
      rim: {
        enabled: true,
        color: "#ffd6a0",
        intensity: 1.2,
        azimuth: 162,
        elevation: 28,
      },
      world: {
        skyColor: "#e6c9a8",
        groundColor: "#4a3324",
        ambientIntensity: 0.72,
        background: "#1a130e",
      },
      fog: {
        mode: "none",
        color: "#38281d",
        near: 12,
        far: 45,
        density: 0.01,
      },
      practicals: [],
      godrays: { ...DEFAULT_LIGHTS.godrays, enabled: false },
    },
  },
  "office-daylight": {
    id: "office-daylight",
    title: "Office Daylight",
    tip: "Crisp side window sun with clean neutral overhead office and classroom fill.",
    state: {
      key: {
        enabled: true,
        color: "#fff5e6",
        intensity: 2.4,
        azimuth: -62,
        elevation: 44,
        shadowRadius: 2.6,
        castShadow: true,
      },
      fill: {
        enabled: true,
        color: "#dce8f5",
        intensity: 1.15,
        azimuth: 85,
        elevation: 52,
        negativeFill: false,
      },
      rim: {
        enabled: true,
        color: "#edf4ff",
        intensity: 0.9,
        azimuth: 170,
        elevation: 36,
      },
      world: {
        skyColor: "#e8eff5",
        groundColor: "#5a5248",
        ambientIntensity: 0.88,
        background: "#cfdcea",
      },
      fog: {
        mode: "linear",
        color: "#cfdcea",
        near: 32,
        far: 140,
        density: 0.008,
      },
      practicals: [],
      godrays: { ...DEFAULT_LIGHTS.godrays, enabled: false },
    },
  },
  "moonlit-exterior": {
    id: "moonlit-exterior",
    title: "Moonlit Exterior",
    tip: "Open night sky moonlight key with cool horizon haze and crisp rim silhouette.",
    state: {
      key: {
        enabled: true,
        color: kelvinToHex(8500),
        intensity: 1.85,
        azimuth: -36,
        elevation: 42,
        shadowRadius: 2.0,
        castShadow: true,
      },
      fill: {
        enabled: true,
        color: "#304a73",
        intensity: 0.4,
        azimuth: 110,
        elevation: 24,
        negativeFill: false,
      },
      rim: {
        enabled: true,
        color: "#c8e0ff",
        intensity: 1.8,
        azimuth: 150,
        elevation: 26,
      },
      world: {
        skyColor: "#243a5e",
        groundColor: "#111622",
        ambientIntensity: 0.38,
        background: "#0a101d",
      },
      fog: {
        mode: "exp2",
        color: "#152036",
        near: 12,
        far: 65,
        density: 0.018,
      },
      practicals: [],
      godrays: { ...DEFAULT_LIGHTS.godrays, enabled: false },
    },
  },
  "studio-void": {
    id: "studio-void",
    title: "Studio Void",
    tip: "Bright clean explainer lighting with soft front key and gentle halo separation.",
    state: {
      key: {
        enabled: true,
        color: "#fff7ee",
        intensity: 2.6,
        azimuth: -28,
        elevation: 50,
        shadowRadius: 3.2,
        castShadow: true,
      },
      fill: {
        enabled: true,
        color: "#e6f2f6",
        intensity: 0.95,
        azimuth: 75,
        elevation: 30,
        negativeFill: false,
      },
      rim: {
        enabled: true,
        color: "#e8f6ff",
        intensity: 1.25,
        azimuth: 162,
        elevation: 32,
      },
      world: {
        skyColor: "#eef4f5",
        groundColor: "#4a4f52",
        ambientIntensity: 0.85,
        background: null,
      },
      fog: {
        mode: "none",
        color: "#b5c1c8",
        near: 18,
        far: 80,
        density: 0.01,
      },
      practicals: [],
      godrays: { ...DEFAULT_LIGHTS.godrays, enabled: false },
    },
  },
  "hospital-clinical": {
    id: "hospital-clinical",
    title: "Hospital Clinical",
    tip: "Clean sterile 5800K overhead medical light with soft cyan-white fill.",
    state: {
      key: {
        enabled: true,
        color: "#f2fbff",
        intensity: 2.35,
        azimuth: 14,
        elevation: 66,
        shadowRadius: 3.2,
        castShadow: true,
      },
      fill: {
        enabled: true,
        color: "#dceff5",
        intensity: 1.35,
        azimuth: -90,
        elevation: 44,
        negativeFill: false,
      },
      rim: {
        enabled: true,
        color: "#e8f8ff",
        intensity: 0.9,
        azimuth: 170,
        elevation: 46,
      },
      world: {
        skyColor: "#e6f2f7",
        groundColor: "#58666e",
        ambientIntensity: 0.95,
        background: "#dce7ec",
      },
      fog: {
        mode: "none",
        color: "#dce7ec",
        near: 16,
        far: 65,
        density: 0.008,
      },
      practicals: [],
      godrays: { ...DEFAULT_LIGHTS.godrays, enabled: false },
    },
  },
  "neon-city": {
    id: "neon-city",
    title: "Neon City",
    tip: "Electric magenta-cyan street night with deep negative shadows and rim glow.",
    state: {
      key: {
        enabled: true,
        color: "#7ad6ff",
        intensity: 2.0,
        azimuth: -48,
        elevation: 34,
        shadowRadius: 1.8,
        castShadow: true,
      },
      fill: {
        enabled: true,
        color: "#ff5ca8",
        intensity: 0.85,
        azimuth: 82,
        elevation: 20,
        negativeFill: true,
      },
      rim: {
        enabled: true,
        color: "#ff72c6",
        intensity: 2.2,
        azimuth: 148,
        elevation: 28,
      },
      world: {
        skyColor: "#1d2747",
        groundColor: "#160d1f",
        ambientIntensity: 0.34,
        background: "#080a16",
      },
      fog: {
        mode: "exp2",
        color: "#14162c",
        near: 10,
        far: 48,
        density: 0.022,
      },
      practicals: [],
      godrays: { ...DEFAULT_LIGHTS.godrays, enabled: false },
    },
  },
  "dusk-twilight": {
    id: "dusk-twilight",
    title: "Dusk Twilight",
    tip: "Low coral-amber horizon key balanced against deep indigo zenith fill.",
    state: {
      key: {
        enabled: true,
        color: "#ff9d6e",
        intensity: 2.25,
        azimuth: 48,
        elevation: 12,
        shadowRadius: 2.4,
        castShadow: true,
      },
      fill: {
        enabled: true,
        color: "#4d679e",
        intensity: 0.8,
        azimuth: -120,
        elevation: 34,
        negativeFill: false,
      },
      rim: {
        enabled: true,
        color: "#ffb485",
        intensity: 1.65,
        azimuth: 164,
        elevation: 16,
      },
      world: {
        skyColor: "#506494",
        groundColor: "#2d2229",
        ambientIntensity: 0.52,
        background: "#1c2036",
      },
      fog: {
        mode: "exp2",
        color: "#6b5463",
        near: 14,
        far: 60,
        density: 0.015,
      },
      practicals: [],
      godrays: { ...DEFAULT_LIGHTS.godrays, enabled: false },
    },
  },
  "storm-rain": {
    id: "storm-rain",
    title: "Storm Rain",
    tip: "Moody cold overcast storm light with dense mist and crisp wet specular rim.",
    state: {
      key: {
        enabled: true,
        color: "#a8bed4",
        intensity: 1.55,
        azimuth: -30,
        elevation: 50,
        shadowRadius: 3.6,
        castShadow: true,
      },
      fill: {
        enabled: true,
        color: "#5f758a",
        intensity: 0.9,
        azimuth: 110,
        elevation: 36,
        negativeFill: false,
      },
      rim: {
        enabled: true,
        color: "#c8ddf0",
        intensity: 1.35,
        azimuth: 155,
        elevation: 30,
      },
      world: {
        skyColor: "#63768a",
        groundColor: "#262d34",
        ambientIntensity: 0.58,
        background: "#354250",
      },
      fog: {
        mode: "exp2",
        color: "#4a5a6a",
        near: 8,
        far: 42,
        density: 0.026,
      },
      practicals: [],
      godrays: { ...DEFAULT_LIGHTS.godrays, enabled: false },
    },
  },
  "underwater-shallow": {
    id: "underwater-shallow",
    title: "Underwater Shallow",
    tip: "Sunlit turquoise overhead rays with bright aqua scatter and soft seabed bounce.",
    state: {
      key: {
        enabled: true,
        color: "#9ef2ff",
        intensity: 2.4,
        azimuth: 18,
        elevation: 68,
        shadowRadius: 3.4,
        castShadow: true,
      },
      fill: {
        enabled: true,
        color: "#36a8c4",
        intensity: 1.0,
        azimuth: -100,
        elevation: 28,
        negativeFill: false,
      },
      rim: {
        enabled: true,
        color: "#b8fbff",
        intensity: 1.3,
        azimuth: 160,
        elevation: 44,
      },
      world: {
        skyColor: "#46b8cf",
        groundColor: "#1d5866",
        ambientIntensity: 0.72,
        background: "#166d85",
      },
      fog: {
        mode: "exp2",
        color: "#1b7890",
        near: 4,
        far: 28,
        density: 0.036,
      },
      practicals: [],
      godrays: {
        enabled: true,
        density: 0.018,
        maxDensity: 0.45,
        edgeStrength: 2.0,
        edgeRadius: 2.2,
        raymarchSteps: 60,
        blur: true,
        weight: 0.85,
        color: "#8ff2ff",
      },
    },
  },
  "underwater-deep": {
    id: "underwater-deep",
    title: "Underwater Deep",
    tip: "Abyssal cobalt-teal gloom with faint top-down attenuation and dense depth fog.",
    state: {
      key: {
        enabled: true,
        color: "#3b88b8",
        intensity: 1.25,
        azimuth: 0,
        elevation: 78,
        shadowRadius: 3.5,
        castShadow: true,
      },
      fill: {
        enabled: true,
        color: "#12344d",
        intensity: 0.45,
        azimuth: -90,
        elevation: 22,
        negativeFill: true,
      },
      rim: {
        enabled: true,
        color: "#5ec4e8",
        intensity: 1.4,
        azimuth: 155,
        elevation: 36,
      },
      world: {
        skyColor: "#143d59",
        groundColor: "#06111c",
        ambientIntensity: 0.34,
        background: "#051424",
      },
      fog: {
        mode: "exp2",
        color: "#071b2e",
        near: 3,
        far: 22,
        density: 0.055,
      },
      practicals: [],
      godrays: { ...DEFAULT_LIGHTS.godrays, enabled: false },
    },
  },
  "space-orbit": {
    id: "space-orbit",
    title: "Space Orbit",
    tip: "Razor-sharp unfiltered solar key, black vacuum shadows, and subtle earthshine rim.",
    state: {
      key: {
        enabled: true,
        color: "#ffffff",
        intensity: 3.6,
        azimuth: -54,
        elevation: 26,
        shadowRadius: 1.2,
        castShadow: true,
      },
      fill: {
        enabled: true,
        color: "#2a4e80",
        intensity: 0.25,
        azimuth: 120,
        elevation: -18,
        negativeFill: true,
      },
      rim: {
        enabled: true,
        color: "#78b4ff",
        intensity: 1.3,
        azimuth: 145,
        elevation: -12,
      },
      world: {
        skyColor: "#0d1626",
        groundColor: "#06080d",
        ambientIntensity: 0.14,
        background: "#020308",
      },
      fog: {
        mode: "none",
        color: "#020308",
        near: 50,
        far: 300,
        density: 0,
      },
      practicals: [],
      godrays: { ...DEFAULT_LIGHTS.godrays, enabled: false },
    },
  },
  "xray-cutaway": {
    id: "xray-cutaway",
    title: "X-Ray Cutaway",
    tip: "Dark anatomical inspection stage with crisp cyan edge separation and clean visibility.",
    state: {
      key: {
        enabled: true,
        color: "#d8f2ff",
        intensity: 1.85,
        azimuth: -35,
        elevation: 48,
        shadowRadius: 2.2,
        castShadow: true,
      },
      fill: {
        enabled: true,
        color: "#4c96b8",
        intensity: 0.75,
        azimuth: 95,
        elevation: 24,
        negativeFill: false,
      },
      rim: {
        enabled: true,
        color: "#78e6ff",
        intensity: 2.1,
        azimuth: 158,
        elevation: 28,
      },
      world: {
        skyColor: "#263848",
        groundColor: "#111820",
        ambientIntensity: 0.48,
        background: "#0c131c",
      },
      fog: {
        mode: "none",
        color: "#0c131c",
        near: 14,
        far: 60,
        density: 0.01,
      },
      practicals: [],
      godrays: { ...DEFAULT_LIGHTS.godrays, enabled: false },
    },
  },
  "dramatic-diorama": {
    id: "dramatic-diorama",
    title: "Dramatic Diorama",
    tip: "High-contrast tabletop spotlight look with warm key, negative fill, and bold rim.",
    state: {
      key: {
        enabled: true,
        color: "#ffeed4",
        intensity: 3.0,
        azimuth: -44,
        elevation: 46,
        shadowRadius: 2.0,
        castShadow: true,
      },
      fill: {
        enabled: true,
        color: "#3f536e",
        intensity: 0.45,
        azimuth: 105,
        elevation: 22,
        negativeFill: true,
      },
      rim: {
        enabled: true,
        color: "#d6e6ff",
        intensity: 2.1,
        azimuth: 150,
        elevation: 34,
      },
      world: {
        skyColor: "#2b3340",
        groundColor: "#14161c",
        ambientIntensity: 0.34,
        background: "#0e1117",
      },
      fog: {
        mode: "none",
        color: "#0e1117",
        near: 12,
        far: 48,
        density: 0.012,
      },
      practicals: [],
      godrays: { ...DEFAULT_LIGHTS.godrays, enabled: false },
    },
  },
  "arctic-snow": {
    id: "arctic-snow",
    title: "Arctic Snow",
    tip: "Low crisp polar sun with luminous snow ground bounce and pale icy horizon mist.",
    state: {
      key: {
        enabled: true,
        color: "#f2f8ff",
        intensity: 2.65,
        azimuth: -38,
        elevation: 24,
        shadowRadius: 2.2,
        castShadow: true,
      },
      fill: {
        enabled: true,
        color: "#b4d6f8",
        intensity: 1.25,
        azimuth: 115,
        elevation: 36,
        negativeFill: false,
      },
      rim: {
        enabled: true,
        color: "#e6f4ff",
        intensity: 1.35,
        azimuth: 162,
        elevation: 20,
      },
      world: {
        skyColor: "#cfe4f8",
        groundColor: "#a8bed4",
        ambientIntensity: 0.92,
        background: "#d5e6f4",
      },
      fog: {
        mode: "linear",
        color: "#d7e6f2",
        near: 24,
        far: 140,
        density: 0.01,
      },
      practicals: [],
      godrays: { ...DEFAULT_LIGHTS.godrays, enabled: false },
    },
  },
  "desert-harsh": {
    id: "desert-harsh",
    title: "Desert Harsh",
    tip: "Blazing high sun, crisp hard shadows, and hot ochre sand bounce.",
    state: {
      key: {
        enabled: true,
        color: "#fff0d2",
        intensity: 3.45,
        azimuth: 28,
        elevation: 62,
        shadowRadius: 1.5,
        castShadow: true,
      },
      fill: {
        enabled: true,
        color: "#d9b484",
        intensity: 0.85,
        azimuth: -110,
        elevation: 24,
        negativeFill: false,
      },
      rim: {
        enabled: true,
        color: "#ffe4b5",
        intensity: 1.2,
        azimuth: 166,
        elevation: 30,
      },
      world: {
        skyColor: "#b8d6f0",
        groundColor: "#9c7344",
        ambientIntensity: 0.72,
        background: "#e4cfa8",
      },
      fog: {
        mode: "linear",
        color: "#e3cca6",
        near: 30,
        far: 170,
        density: 0.008,
      },
      practicals: [],
      godrays: { ...DEFAULT_LIGHTS.godrays, enabled: false },
    },
  },
  "forest-canopy": {
    id: "forest-canopy",
    title: "Forest Canopy",
    tip: "Dappled warm shafts filtered through green foliage with mossy ground bounce.",
    state: {
      key: {
        enabled: true,
        color: "#f5ebc6",
        intensity: 2.35,
        azimuth: 40,
        elevation: 46,
        shadowRadius: 3.0,
        castShadow: true,
      },
      fill: {
        enabled: true,
        color: "#6b996e",
        intensity: 0.8,
        azimuth: -105,
        elevation: 28,
        negativeFill: false,
      },
      rim: {
        enabled: true,
        color: "#dff0b8",
        intensity: 1.35,
        azimuth: 158,
        elevation: 32,
      },
      world: {
        skyColor: "#8cb08a",
        groundColor: "#334229",
        ambientIntensity: 0.62,
        background: "#2e402c",
      },
      fog: {
        mode: "exp2",
        color: "#6a8068",
        near: 12,
        far: 65,
        density: 0.016,
      },
      practicals: [],
      godrays: {
        enabled: true,
        density: 0.015,
        maxDensity: 0.4,
        edgeStrength: 2.0,
        edgeRadius: 2.4,
        raymarchSteps: 60,
        blur: true,
        weight: 0.8,
        color: "#edf2c4",
      },
    },
  },
  "fire-hazard": {
    id: "fire-hazard",
    title: "Fire Hazard",
    tip: "Fierce orange-red flame key with smoky dark shadows and ember rim.",
    state: {
      key: {
        enabled: true,
        color: "#ff7a2e",
        intensity: 2.9,
        azimuth: 54,
        elevation: 18,
        shadowRadius: 2.6,
        castShadow: true,
      },
      fill: {
        enabled: true,
        color: "#6b2918",
        intensity: 0.55,
        azimuth: -95,
        elevation: 22,
        negativeFill: true,
      },
      rim: {
        enabled: true,
        color: "#ffb14a",
        intensity: 2.0,
        azimuth: 146,
        elevation: 20,
      },
      world: {
        skyColor: "#422119",
        groundColor: "#1c0e0a",
        ambientIntensity: 0.4,
        background: "#140907",
      },
      fog: {
        mode: "exp2",
        color: "#2b1610",
        near: 6,
        far: 32,
        density: 0.032,
      },
      practicals: [],
      godrays: { ...DEFAULT_LIGHTS.godrays, enabled: false },
    },
  },
  "cabin-interior": {
    id: "cabin-interior",
    title: "Cabin Interior",
    tip: "Cozy timber tungsten key with warm wood bounce and subtle cool window fill.",
    state: {
      key: {
        enabled: true,
        color: kelvinToHex(2800),
        intensity: 2.15,
        azimuth: 46,
        elevation: 36,
        shadowRadius: 3.0,
        castShadow: true,
      },
      fill: {
        enabled: true,
        color: "#8aa4c2",
        intensity: 0.55,
        azimuth: -105,
        elevation: 26,
        negativeFill: false,
      },
      rim: {
        enabled: true,
        color: "#ffc98c",
        intensity: 1.25,
        azimuth: 156,
        elevation: 28,
      },
      world: {
        skyColor: "#8c6b4e",
        groundColor: "#362519",
        ambientIntensity: 0.56,
        background: "#1c130d",
      },
      fog: {
        mode: "none",
        color: "#36261c",
        near: 12,
        far: 44,
        density: 0.012,
      },
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

export function resolveLightKeys(
  input: LightsDoc | LightKey[] | null | undefined,
): ResolvedLightKey[] {
  const doc = normalizeLightsDoc(input);
  if (doc.keys.length === 0) return [];
  const sorted = [...doc.keys].sort((a, b) => a.t - b.t || Number(!!a.cut) - Number(!!b.cut));
  const out: ResolvedLightKey[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const key = sorted[i];
    const presetState =
      key.preset && Object.hasOwn(LIGHT_PRESETS, key.preset)
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
  const targetA: Vec3 = pa.target ?? (pa.kind === "spot" ? [pa.at[0], 0, pa.at[2]] : pa.at);
  const targetB: Vec3 = pb.target ?? (pb.kind === "spot" ? [pb.at[0], 0, pb.at[2]] : pb.at);
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
  const shadowExtent =
    a.key.shadowExtent !== undefined && b.key.shadowExtent !== undefined
      ? Math.max(0.5, lerp(a.key.shadowExtent, b.key.shadowExtent, u))
      : half
        ? b.key.shadowExtent
        : a.key.shadowExtent;

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
      ...(shadowExtent !== undefined ? { shadowExtent } : {}),
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

export function lightsAt(input: LightsDoc | LightKey[] | null | undefined, t: number): LightsState {
  const resolved = resolveLightKeys(input);
  if (resolved.length === 0) return cloneLightsState(DEFAULT_LIGHTS);
  if (!Number.isFinite(t)) {
    return cloneLightsState(
      t === Infinity ? resolved[resolved.length - 1].state : resolved[0].state,
    );
  }
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

export function practicalIntensityAt(p: PracticalState, t: number, fallbackSeed = 0): number {
  const baseIntensity = Number.isFinite(p.intensity) ? Math.max(0, p.intensity) : 0;
  if (!p.flicker) return baseIntensity;
  const cfg = p.flicker === true ? {} : p.flicker;
  const rawRate = cfg.rate ?? cfg.speed ?? 8;
  const rate = Math.max(0.1, Number.isFinite(rawRate) ? rawRate : 8);
  const rawAmount = cfg.amount ?? 0.25;
  const amount = clamp(Number.isFinite(rawAmount) ? rawAmount : 0.25, 0, 1);
  const rawSeed = cfg.seed ?? (p.id ? hashSeed(p.id) : fallbackSeed);
  const seed = Number.isFinite(rawSeed) ? rawSeed : 0;
  const safeT = Number.isFinite(t) ? t : 0;
  const phase = safeT * rate;
  const n = Math.floor(phase);
  const f = phase - n;
  const u = f * f * (3 - 2 * f);
  const v = lerp(seededNoise(n, seed), seededNoise(n + 1, seed), u);
  return Math.max(0, baseIntensity * (1 + (v * 2 - 1) * amount));
}
