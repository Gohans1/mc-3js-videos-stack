import * as THREE from "three";

export type ParticlePresetName =
  | "rain"
  | "snow"
  | "dust-motes"
  | "embers"
  | "bubbles"
  | "marine-snow"
  | "smoke-steam"
  | "sand-ash";

export type ParticleSpriteKind = "soft" | "puff" | "ring" | "streak" | "chunk";

export interface ParticlePreset {
  readonly color: string;
  readonly emissiveGain: number;
  readonly opacity: number;
  readonly count: number;
  readonly bounds: readonly [number, number, number];
  readonly velocity: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  readonly sway: number;
  readonly swayFreq: number;
  readonly spin: number;
  readonly additive: boolean;
  readonly kind: ParticleSpriteKind;
}

export const PARTICLE_PRESETS: Readonly<Record<ParticlePresetName, ParticlePreset>> = {
  rain: {
    color: "#c8dff0",
    emissiveGain: 1.0,
    opacity: 0.45,
    count: 420,
    bounds: [22, 16, 22],
    velocity: [0.35, -14.0, 0.15],
    scale: [0.018, 0.58, 0.018],
    sway: 0.04,
    swayFreq: 1.2,
    spin: 0,
    additive: false,
    kind: "streak",
  },
  snow: {
    color: "#f4f8ff",
    emissiveGain: 1.0,
    opacity: 0.85,
    count: 320,
    bounds: [24, 16, 24],
    velocity: [0.35, -1.4, 0.2],
    scale: [0.065, 0.065, 0.065],
    sway: 0.65,
    swayFreq: 1.1,
    spin: 0.8,
    additive: false,
    kind: "soft",
  },
  "dust-motes": {
    color: "#ffe9c2",
    emissiveGain: 1.4,
    opacity: 0.55,
    count: 180,
    bounds: [14, 8, 14],
    velocity: [0.06, 0.04, -0.05],
    scale: [0.035, 0.035, 0.035],
    sway: 0.45,
    swayFreq: 0.55,
    spin: 0.3,
    additive: true,
    kind: "soft",
  },
  embers: {
    color: "#ff6b1a",
    emissiveGain: 3.0,
    opacity: 0.9,
    count: 160,
    bounds: [16, 12, 16],
    velocity: [0.25, 1.8, 0.15],
    scale: [0.045, 0.075, 0.045],
    sway: 0.7,
    swayFreq: 1.9,
    spin: 1.5,
    additive: true,
    kind: "soft",
  },
  bubbles: {
    color: "#bfefff",
    emissiveGain: 1.1,
    opacity: 0.52,
    count: 180,
    bounds: [16, 14, 16],
    velocity: [0.05, 1.35, 0.05],
    scale: [0.06, 0.06, 0.06],
    sway: 0.35,
    swayFreq: 1.6,
    spin: 0.4,
    additive: false,
    kind: "ring",
  },
  "marine-snow": {
    color: "#9ec9d4",
    emissiveGain: 1.0,
    opacity: 0.45,
    count: 260,
    bounds: [18, 14, 18],
    velocity: [0.03, -0.28, -0.02],
    scale: [0.032, 0.032, 0.032],
    sway: 0.25,
    swayFreq: 0.45,
    spin: 0.25,
    additive: false,
    kind: "soft",
  },
  "smoke-steam": {
    color: "#dfe4ea",
    emissiveGain: 1.0,
    opacity: 0.28,
    count: 72,
    bounds: [14, 10, 14],
    velocity: [0.18, 0.95, 0.1],
    scale: [0.65, 0.65, 0.65],
    sway: 0.4,
    swayFreq: 0.6,
    spin: 0.35,
    additive: false,
    kind: "puff",
  },
  "sand-ash": {
    color: "#c8b394",
    emissiveGain: 1.0,
    opacity: 0.6,
    count: 340,
    bounds: [22, 12, 22],
    velocity: [4.8, -0.65, 1.2],
    scale: [0.042, 0.03, 0.042],
    sway: 0.35,
    swayFreq: 1.7,
    spin: 2.0,
    additive: false,
    kind: "soft",
  },
};

export interface ParticleFieldOptions {
  preset?: ParticlePresetName;
  count?: number;
  bounds?: readonly [number, number, number];
  origin?: readonly [number, number, number];
  velocity?: readonly [number, number, number];
  scale?: number | readonly [number, number, number];
  color?: THREE.ColorRepresentation;
  emissiveGain?: number;
  opacity?: number;
  sway?: number;
  nearHideRadius?: number;
  seed?: number;
  textureSize?: number;
  additive?: boolean;
}

export interface ParticleFieldHandle {
  mesh: THREE.InstancedMesh;
  material: THREE.MeshBasicMaterial;
  update: (t: number, camera?: THREE.Camera) => void;
  follow: (camera: THREE.Camera) => void;
  setIntensity: (v: number) => void;
  dispose: () => void;
}

const TAU = Math.PI * 2;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const finiteOr = (v: number | undefined, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const positiveOr = (v: number | undefined, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;

const wrapCentered = (v: number, span: number): number => {
  const w = (((v % span) + span * 1.5) % span) - span * 0.5;
  return w === 0 ? 0 : w;
};

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / Math.max(1e-6, e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash01(seed: number, a: number, b: number): number {
  let h = (seed ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function buildParticleSpriteTexture(
  kind: ParticleSpriteKind,
  size: number,
  seed: number,
): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const octaves: { n: number; v: Float32Array }[] = [];
  if (kind === "puff") {
    const rand = createMulberry32(seed + 101);
    for (let o = 0; o < 3; o++) {
      const n = 4 << o;
      const v = new Float32Array((n + 1) * (n + 1));
      for (let i = 0; i < v.length; i++) v[i] = rand();
      octaves.push({ n, v });
    }
  }

  const smoothLerp = (a: number, b: number, t: number): number =>
    a + (b - a) * (t * t * (3 - 2 * t));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size - 0.5) * 2;
      const v = ((y + 0.5) / size - 0.5) * 2;
      const r = Math.hypot(u, v);
      let alpha = 0;

      if (kind === "soft") {
        alpha = r >= 1 ? 0 : Math.pow(1 - r * r, 2.2);
      } else if (kind === "streak") {
        const ax = Math.max(0, 1 - Math.abs(u) * 1.45);
        const ay = Math.max(0, 1 - Math.abs(v));
        alpha = Math.pow(ax, 1.8) * Math.pow(ay, 1.3);
      } else if (kind === "chunk") {
        const ax = 1 - smoothstep(0.82, 0.96, Math.abs(u));
        const ay = 1 - smoothstep(0.82, 0.96, Math.abs(v));
        alpha = ax * ay;
      } else if (kind === "ring") {
        if (r < 1) {
          const rim = Math.exp(-Math.pow((r - 0.72) / 0.14, 2));
          const body = (1 - r * r) * 0.22;
          const glint = Math.exp(-Math.pow(Math.hypot(u + 0.28, v - 0.28) / 0.16, 2)) * 0.85;
          alpha = clamp(rim + body + glint, 0, 1) * (1 - r * r * 0.35);
        }
      } else {
        if (r < 1) {
          let f = 0;
          let amp = 0.5;
          for (let o = 0; o < octaves.length; o++) {
            const { n, v: grid } = octaves[o];
            const fx = (x / size) * n;
            const fy = (y / size) * n;
            const ix = Math.floor(fx);
            const iy = Math.floor(fy);
            const row0 = iy * (n + 1);
            const row1 = (iy + 1) * (n + 1);
            const top = smoothLerp(grid[row0 + ix], grid[row0 + ix + 1], fx - ix);
            const bot = smoothLerp(grid[row1 + ix], grid[row1 + ix + 1], fx - ix);
            f += amp * smoothLerp(top, bot, fy - iy);
            amp *= 0.5;
          }
          alpha = clamp((f - 0.25) * 1.8, 0, 1) * Math.pow(1 - r * r, 1.6);
        }
      }

      const idx = (y * size + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = Math.round(clamp(alpha, 0, 1) * 255);
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export function createParticleField(opts: ParticleFieldOptions = {}): ParticleFieldHandle {
  const presetName = opts.preset ?? "dust-motes";
  if (!Object.hasOwn(PARTICLE_PRESETS, presetName)) {
    throw new Error(
      `Unknown particle preset ${JSON.stringify(presetName)}; expected ${Object.keys(PARTICLE_PRESETS).join(" | ")}`,
    );
  }
  const preset = PARTICLE_PRESETS[presetName];

  const maxCount = Math.max(1, Math.round(positiveOr(opts.count, preset.count)));
  const bx = positiveOr(opts.bounds?.[0], preset.bounds[0]);
  const by = positiveOr(opts.bounds?.[1], preset.bounds[1]);
  const bz = positiveOr(opts.bounds?.[2], preset.bounds[2]);
  const vx = finiteOr(opts.velocity?.[0], preset.velocity[0]);
  const vy = finiteOr(opts.velocity?.[1], preset.velocity[1]);
  const vz = finiteOr(opts.velocity?.[2], preset.velocity[2]);
  const sway = Math.max(0, finiteOr(opts.sway, preset.sway));
  const nearHideRadius = Math.max(0, finiteOr(opts.nearHideRadius, 0.35));
  const nearHideSq = nearHideRadius * nearHideRadius;
  const seed = Math.round(finiteOr(opts.seed, 11));
  const textureSize = Math.max(16, Math.round(positiveOr(opts.textureSize, 64)));
  const baseOpacity = clamp(finiteOr(opts.opacity, preset.opacity), 0, 1);
  const emissiveGain = Math.max(0, finiteOr(opts.emissiveGain, preset.emissiveGain));
  const additive = opts.additive ?? preset.additive;

  const [sx, sy, sz] =
    typeof opts.scale === "number"
      ? [
          positiveOr(opts.scale, preset.scale[0]),
          positiveOr(opts.scale, preset.scale[1]),
          positiveOr(opts.scale, preset.scale[2]),
        ]
      : opts.scale
        ? [
            positiveOr(opts.scale[0], preset.scale[0]),
            positiveOr(opts.scale[1], preset.scale[1]),
            positiveOr(opts.scale[2], preset.scale[2]),
          ]
        : preset.scale;

  const texture = buildParticleSpriteTexture(preset.kind, textureSize, seed);
  const color = new THREE.Color(opts.color ?? preset.color).multiplyScalar(emissiveGain);
  const material = new THREE.MeshBasicMaterial({
    color,
    map: texture,
    transparent: true,
    opacity: baseOpacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });

  const geometry = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(geometry, material, maxCount);
  mesh.name = `particles-${presetName}`;
  mesh.frustumCulled = false;

  const rand = createMulberry32(seed);
  const baseX = new Float32Array(maxCount);
  const baseY = new Float32Array(maxCount);
  const baseZ = new Float32Array(maxCount);
  const speedMul = new Float32Array(maxCount);
  const sizeMul = new Float32Array(maxCount);
  const phase = new Float32Array(maxCount);
  const roll = new Float32Array(maxCount);

  for (let i = 0; i < maxCount; i++) {
    baseX[i] = (rand() - 0.5) * bx;
    baseY[i] = (rand() - 0.5) * by;
    baseZ[i] = (rand() - 0.5) * bz;
    speedMul[i] = 0.75 + rand() * 0.55;
    sizeMul[i] = 0.65 + rand() * 0.75;
    phase[i] = rand() * TAU;
    roll[i] = rand() * TAU;
  }

  const center = new THREE.Vector3(
    finiteOr(opts.origin?.[0], 0),
    finiteOr(opts.origin?.[1], 0),
    finiteOr(opts.origin?.[2], 0),
  );
  const camPos = new THREE.Vector3();
  const camQuat = new THREE.Quaternion();
  const useOrigin = opts.origin !== undefined;
  let hasCamera = false;
  let lastTime = 0;

  const dummyMatrix = new THREE.Matrix4();
  const dummyPos = new THREE.Vector3();
  const dummyQuat = new THREE.Quaternion();
  const spinQuat = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const yAxis = new THREE.Vector3(0, 1, 0);
  const dummyScale = new THREE.Vector3();

  const captureCamera = (camera: THREE.Camera): void => {
    camera.updateWorldMatrix(true, false);
    camera.getWorldPosition(camPos);
    camera.getWorldQuaternion(camQuat);
    hasCamera = true;
    if (!useOrigin) {
      center.copy(camPos);
    }
  };

  const applyFrame = (t: number): void => {
    const time = Number.isFinite(t) ? t : 0;
    lastTime = time;
    const cx = center.x;
    const cy = center.y;
    const cz = center.z;
    const isStreak = preset.kind === "streak";

    for (let i = 0; i < maxCount; i++) {
      const sm = speedMul[i];
      const ph = phase[i];
      const rawX = baseX[i] + vx * sm * time + Math.sin(time * preset.swayFreq + ph) * sway;
      const rawY = baseY[i] + vy * sm * time;
      const rawZ =
        baseZ[i] + vz * sm * time + Math.cos(time * preset.swayFreq * 0.87 + ph * 1.3) * sway;

      const wx = cx + wrapCentered(rawX - cx, bx);
      const wy = cy + wrapCentered(rawY - cy, by);
      const wz = cz + wrapCentered(rawZ - cz, bz);

      dummyPos.set(wx, wy, wz);

      if (hasCamera && nearHideSq > 0) {
        const dx = wx - camPos.x;
        const dy = wy - camPos.y;
        const dz = wz - camPos.z;
        if (dx * dx + dy * dy + dz * dz < nearHideSq) {
          dummyScale.set(0, 0, 0);
          dummyQuat.identity();
          dummyMatrix.compose(dummyPos, dummyQuat, dummyScale);
          mesh.setMatrixAt(i, dummyMatrix);
          continue;
        }
      }

      if (isStreak) {
        const yaw = hasCamera ? Math.atan2(camPos.x - wx, camPos.z - wz) : 0;
        dummyQuat.setFromAxisAngle(yAxis, yaw);
      } else {
        if (hasCamera) dummyQuat.copy(camQuat);
        else dummyQuat.identity();
        if (preset.spin !== 0) {
          spinQuat.setFromAxisAngle(zAxis, roll[i] + preset.spin * sm * time);
          dummyQuat.multiply(spinQuat);
        }
      }

      const sc = sizeMul[i];
      dummyScale.set(sx * sc, sy * sc, sz * sc);
      dummyMatrix.compose(dummyPos, dummyQuat, dummyScale);
      mesh.setMatrixAt(i, dummyMatrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  };

  applyFrame(0);

  const update = (t: number, camera?: THREE.Camera): void => {
    if (camera) captureCamera(camera);
    applyFrame(t);
  };

  const follow = (camera: THREE.Camera): void => {
    captureCamera(camera);
    applyFrame(lastTime);
  };

  const setIntensity = (v: number): void => {
    if (!Number.isFinite(v)) return;
    const clamped = Math.max(0, v);
    const active = Math.round(maxCount * clamp(clamped, 0, 1));
    mesh.count = active;
    mesh.visible = active > 0;
    material.opacity = clamp(baseOpacity * clamped, 0, 1);
  };

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    mesh.removeFromParent();
    mesh.dispose();
    geometry.dispose();
    material.dispose();
    texture.dispose();
  };

  return { mesh, material, update, follow, setIntensity, dispose };
}

export type EmitterPresetName =
  | "sparks"
  | "dust-puff"
  | "splash"
  | "stream"
  | "steam-jet"
  | "debris"
  | "confetti";

export type EmitterMode = "burst" | "stream";

export interface EmitterPreset {
  readonly mode: EmitterMode;
  readonly color: string;
  readonly emissiveGain: number;
  readonly opacity: number;
  readonly count: number;
  readonly direction: readonly [number, number, number];
  readonly spread: number;
  readonly speed: readonly [number, number];
  readonly gravity: number;
  readonly drag: number;
  readonly lifetime: number;
  readonly size: readonly [number, number, number];
  readonly grow: number;
  readonly spin: number;
  readonly velocityAligned: boolean;
  readonly streakScale: number;
  readonly additive: boolean;
  readonly multiColor: boolean;
  readonly kind: ParticleSpriteKind;
}

export const EMITTER_PRESETS: Readonly<Record<EmitterPresetName, EmitterPreset>> = {
  sparks: {
    mode: "burst",
    color: "#ff9b2e",
    emissiveGain: 3.5,
    opacity: 0.95,
    count: 72,
    direction: [0, 1, 0],
    spread: 1.1,
    speed: [3.5, 8.5],
    gravity: -9.8,
    drag: 1.2,
    lifetime: 0.65,
    size: [0.025, 0.14, 0.025],
    grow: -0.7,
    spin: 0,
    velocityAligned: true,
    streakScale: 0.25,
    additive: true,
    multiColor: false,
    kind: "streak",
  },
  "dust-puff": {
    mode: "burst",
    color: "#c8bca8",
    emissiveGain: 1.0,
    opacity: 0.45,
    count: 40,
    direction: [0, 0.4, 0],
    spread: 1.45,
    speed: [0.8, 2.6],
    gravity: -0.35,
    drag: 2.8,
    lifetime: 1.4,
    size: [0.38, 0.38, 0.38],
    grow: 1.6,
    spin: 0.6,
    velocityAligned: false,
    streakScale: 0,
    additive: false,
    multiColor: false,
    kind: "puff",
  },
  splash: {
    mode: "burst",
    color: "#cceeff",
    emissiveGain: 1.1,
    opacity: 0.72,
    count: 64,
    direction: [0, 1, 0],
    spread: 0.85,
    speed: [2.5, 6.0],
    gravity: -12.0,
    drag: 0.4,
    lifetime: 0.85,
    size: [0.035, 0.12, 0.035],
    grow: -0.5,
    spin: 0,
    velocityAligned: true,
    streakScale: 0.2,
    additive: false,
    multiColor: false,
    kind: "streak",
  },
  stream: {
    mode: "stream",
    color: "#bfe6ff",
    emissiveGain: 1.05,
    opacity: 0.68,
    count: 96,
    direction: [0, 0.25, 1],
    spread: 0.12,
    speed: [4.5, 6.2],
    gravity: -9.8,
    drag: 0.2,
    lifetime: 1.1,
    size: [0.04, 0.16, 0.04],
    grow: -0.25,
    spin: 0,
    velocityAligned: true,
    streakScale: 0.22,
    additive: false,
    multiColor: false,
    kind: "streak",
  },
  "steam-jet": {
    mode: "stream",
    color: "#e8eef2",
    emissiveGain: 1.0,
    opacity: 0.36,
    count: 48,
    direction: [0, 1, 0],
    spread: 0.28,
    speed: [1.8, 3.4],
    gravity: 0.4,
    drag: 1.4,
    lifetime: 1.6,
    size: [0.28, 0.28, 0.28],
    grow: 2.0,
    spin: 0.7,
    velocityAligned: false,
    streakScale: 0,
    additive: false,
    multiColor: false,
    kind: "puff",
  },
  debris: {
    mode: "burst",
    color: "#6b655e",
    emissiveGain: 1.0,
    opacity: 0.95,
    count: 48,
    direction: [0, 1, 0],
    spread: 1.15,
    speed: [2.5, 7.5],
    gravity: -11.5,
    drag: 0.35,
    lifetime: 1.3,
    size: [0.09, 0.09, 0.09],
    grow: -0.45,
    spin: 5.5,
    velocityAligned: false,
    streakScale: 0,
    additive: false,
    multiColor: false,
    kind: "chunk",
  },
  confetti: {
    mode: "burst",
    color: "#ffffff",
    emissiveGain: 1.1,
    opacity: 0.95,
    count: 90,
    direction: [0, 1, 0],
    spread: 0.9,
    speed: [3.0, 6.5],
    gravity: -2.2,
    drag: 2.4,
    lifetime: 2.8,
    size: [0.075, 0.11, 0.075],
    grow: -0.2,
    spin: 6.5,
    velocityAligned: false,
    streakScale: 0,
    additive: false,
    multiColor: true,
    kind: "chunk",
  },
};

export type Vec3Input = readonly [number, number, number] | THREE.Vector3;

export interface ParticleEmitterOptions {
  preset?: EmitterPresetName;
  mode?: EmitterMode;
  triggerAt?: number | readonly number[];
  origin?: readonly [number, number, number];
  direction?: readonly [number, number, number];
  spread?: number;
  speed?: number | readonly [number, number];
  gravity?: number;
  drag?: number;
  lifetime?: number;
  size?: number | readonly [number, number, number];
  count?: number;
  color?: THREE.ColorRepresentation;
  emissiveGain?: number;
  opacity?: number;
  seed?: number;
  textureSize?: number;
  prewarm?: boolean;
}

export interface ParticleEmitterHandle {
  mesh: THREE.InstancedMesh;
  material: THREE.MeshBasicMaterial;
  update: (t: number, camera?: THREE.Camera) => void;
  setOrigin: (at: Vec3Input) => void;
  setIntensity: (v: number) => void;
  dispose: () => void;
}

const CONFETTI_PALETTE: readonly number[] = [
  0xff4757, 0xffa502, 0x2ed573, 0x1e90ff, 0xe84393, 0xfeca57, 0x00d2d3,
];

function buildCrossedQuadGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
    -0.5, -0.5, 0,
    0.5, -0.5, 0,
    0.5, 0.5, 0,
    -0.5, 0.5, 0,
    0, -0.5, -0.5,
    0, -0.5, 0.5,
    0, 0.5, 0.5,
    0, 0.5, -0.5,
  ]);
  const uvs = new Float32Array([
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
  ]);
  const indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function computeConeBasis(dir: THREE.Vector3): {
  forward: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
} {
  const forward = dir.lengthSq() > 1e-8 ? dir.clone().normalize() : new THREE.Vector3(0, 1, 0);
  const ref = Math.abs(forward.y) < 0.98 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const right = new THREE.Vector3().crossVectors(ref, forward).normalize();
  const up = new THREE.Vector3().crossVectors(forward, right).normalize();
  return { forward, right, up };
}

export function createParticleEmitter(opts: ParticleEmitterOptions = {}): ParticleEmitterHandle {
  const presetName = opts.preset ?? "sparks";
  if (!Object.hasOwn(EMITTER_PRESETS, presetName)) {
    throw new Error(
      `Unknown emitter preset ${JSON.stringify(presetName)}; expected ${Object.keys(EMITTER_PRESETS).join(" | ")}`,
    );
  }
  const preset = EMITTER_PRESETS[presetName];

  const mode = opts.mode ?? preset.mode;
  const maxCount = Math.max(1, Math.round(positiveOr(opts.count, preset.count)));
  const lifetime = positiveOr(opts.lifetime, preset.lifetime);
  const spread = Math.max(0, finiteOr(opts.spread, preset.spread));
  const gravity = finiteOr(opts.gravity, preset.gravity);
  const drag = Math.max(0, finiteOr(opts.drag, preset.drag));
  const seed = Math.round(finiteOr(opts.seed, 23));
  const textureSize = Math.max(16, Math.round(positiveOr(opts.textureSize, 64)));
  const baseOpacity = clamp(finiteOr(opts.opacity, preset.opacity), 0, 1);
  const emissiveGain = Math.max(0, finiteOr(opts.emissiveGain, preset.emissiveGain));
  const prewarm = opts.prewarm ?? (mode === "stream" && opts.triggerAt === undefined);

  const [speedMin, speedMax] =
    typeof opts.speed === "number"
      ? [positiveOr(opts.speed, preset.speed[0]), positiveOr(opts.speed, preset.speed[1])]
      : opts.speed
        ? [positiveOr(opts.speed[0], preset.speed[0]), positiveOr(opts.speed[1], preset.speed[1])]
        : preset.speed;
  const speedHi = Math.max(speedMin, speedMax);

  const [sx, sy, sz] =
    typeof opts.size === "number"
      ? [
          positiveOr(opts.size, preset.size[0]),
          positiveOr(opts.size, preset.size[1]),
          positiveOr(opts.size, preset.size[2]),
        ]
      : opts.size
        ? [
            positiveOr(opts.size[0], preset.size[0]),
            positiveOr(opts.size[1], preset.size[1]),
            positiveOr(opts.size[2], preset.size[2]),
          ]
        : preset.size;

  const rawTriggers =
    opts.triggerAt === undefined
      ? [0]
      : typeof opts.triggerAt === "number"
        ? [finiteOr(opts.triggerAt, 0)]
        : opts.triggerAt.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const triggers = rawTriggers.length > 0 ? rawTriggers : [0];

  const dirVec = new THREE.Vector3(
    finiteOr(opts.direction?.[0], preset.direction[0]),
    finiteOr(opts.direction?.[1], preset.direction[1]),
    finiteOr(opts.direction?.[2], preset.direction[2]),
  );
  const { forward, right, up } = computeConeBasis(dirVec);

  const origin = new THREE.Vector3(
    finiteOr(opts.origin?.[0], 0),
    finiteOr(opts.origin?.[1], 0),
    finiteOr(opts.origin?.[2], 0),
  );

  const texture = buildParticleSpriteTexture(preset.kind, textureSize, seed);
  const baseColor = new THREE.Color(opts.color ?? preset.color);
  const materialColor =
    preset.multiColor && opts.color === undefined
      ? new THREE.Color(0xffffff).multiplyScalar(emissiveGain)
      : baseColor.clone().multiplyScalar(emissiveGain);
  const material = new THREE.MeshBasicMaterial({
    color: materialColor,
    map: texture,
    transparent: true,
    opacity: baseOpacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: preset.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });

  const geometry = preset.velocityAligned
    ? buildCrossedQuadGeometry()
    : new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(geometry, material, maxCount);
  mesh.name = `emitter-${presetName}`;
  mesh.frustumCulled = false;

  const hasPerInstanceColor = preset.multiColor || preset.additive;
  if (hasPerInstanceColor) {
    mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(maxCount * 3).fill(1),
      3,
    );
  }

  const rand = createMulberry32(seed);
  const dirTheta = new Float32Array(maxCount);
  const dirPhi = new Float32Array(maxCount);
  const spdFrac = new Float32Array(maxCount);
  const lifeFrac = new Float32Array(maxCount);
  const spawnFrac = new Float32Array(maxCount);
  const sizeMul = new Float32Array(maxCount);
  const rotAxisX = new Float32Array(maxCount);
  const rotAxisY = new Float32Array(maxCount);
  const rotAxisZ = new Float32Array(maxCount);
  const rotStart = new Float32Array(maxCount);
  const paletteIdx = new Uint8Array(maxCount);

  for (let i = 0; i < maxCount; i++) {
    dirTheta[i] = rand() * TAU;
    dirPhi[i] = Math.sqrt(rand()) * spread;
    spdFrac[i] = rand();
    lifeFrac[i] = 0.65 + rand() * 0.35;
    spawnFrac[i] =
      mode === "stream"
        ? (i * 0.6180339887498949 + rand() * (0.5 / maxCount)) % 1
        : rand() * 0.08;
    sizeMul[i] = 0.65 + rand() * 0.7;
    const ax = rand() * 2 - 1;
    const ay = rand() * 2 - 1;
    const az = rand() * 2 - 1;
    const inv = 1 / Math.max(1e-5, Math.hypot(ax, ay, az));
    rotAxisX[i] = ax * inv;
    rotAxisY[i] = ay * inv;
    rotAxisZ[i] = az * inv;
    rotStart[i] = rand() * TAU;
    paletteIdx[i] = Math.floor(rand() * CONFETTI_PALETTE.length);
  }

  const dummyMatrix = new THREE.Matrix4();
  const dummyPos = new THREE.Vector3();
  const dummyQuat = new THREE.Quaternion();
  const camQuat = new THREE.Quaternion();
  const spinQuat = new THREE.Quaternion();
  const dummyScale = new THREE.Vector3();
  const velDir = new THREE.Vector3();
  const spinAxis = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const zAxis = new THREE.Vector3(0, 0, 1);
  const tmpColor = new THREE.Color();

  const setZeroInstance = (i: number): void => {
    dummyScale.set(0, 0, 0);
    dummyQuat.identity();
    dummyMatrix.compose(origin, dummyQuat, dummyScale);
    mesh.setMatrixAt(i, dummyMatrix);
  };

  const evalFrame = (t: number, camera?: THREE.Camera): void => {
    const time = Number.isFinite(t) ? t : 0;
    const billboardPuff = Boolean(camera && !preset.velocityAligned && preset.kind === "puff");
    if (billboardPuff && camera) {
      camera.updateWorldMatrix(true, false);
      camera.getWorldQuaternion(camQuat);
    }

    let burstTrigger = Number.NaN;
    if (mode === "burst") {
      for (let k = triggers.length - 1; k >= 0; k--) {
        if (time >= triggers[k]) {
          burstTrigger = triggers[k];
          break;
        }
      }
    }

    const streamStart = triggers[0];

    for (let i = 0; i < maxCount; i++) {
      let age = -1;
      let cycle = 0;
      let pLife = lifetime;

      if (mode === "burst") {
        if (!Number.isFinite(burstTrigger)) {
          setZeroInstance(i);
          continue;
        }
        const delay = spawnFrac[i] * lifetime;
        pLife = Math.max(1e-4, Math.min(lifetime - delay, lifetime * lifeFrac[i]));
        age = time - burstTrigger - delay;
        if (age < 0 || age >= pLife) {
          setZeroInstance(i);
          continue;
        }
      } else {
        if (time < streamStart) {
          setZeroInstance(i);
          continue;
        }
        const phaseOffset = spawnFrac[i] * lifetime;
        const rel = prewarm ? time - streamStart + phaseOffset : time - streamStart - phaseOffset;
        if (rel < 0) {
          setZeroInstance(i);
          continue;
        }
        cycle = Math.floor(rel / lifetime);
        age = rel - cycle * lifetime;
        pLife = Math.max(1e-4, lifetime * lifeFrac[i]);
        if (age >= pLife) {
          setZeroInstance(i);
          continue;
        }
      }

      const theta = cycle === 0 ? dirTheta[i] : hash01(seed, i, cycle * 3) * TAU;
      const phi =
        cycle === 0 ? dirPhi[i] : Math.sqrt(hash01(seed, i, cycle * 3 + 1)) * spread;
      const spd =
        speedMin +
        (cycle === 0 ? spdFrac[i] : hash01(seed, i, cycle * 3 + 2)) * (speedHi - speedMin);

      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      const v0x = (forward.x * cosPhi + (right.x * cosT + up.x * sinT) * sinPhi) * spd;
      const v0y = (forward.y * cosPhi + (right.y * cosT + up.y * sinT) * sinPhi) * spd;
      const v0z = (forward.z * cosPhi + (right.z * cosT + up.z * sinT) * sinPhi) * spd;

      let px: number;
      let py: number;
      let pz: number;
      let vxNow: number;
      let vyNow: number;
      let vzNow: number;

      if (drag > 1e-4) {
        const expTerm = Math.exp(-drag * age);
        const a = (1 - expTerm) / drag;
        const b = (age - a) / drag;
        px = origin.x + v0x * a;
        py = origin.y + v0y * a + gravity * b;
        pz = origin.z + v0z * a;
        vxNow = v0x * expTerm;
        vyNow = v0y * expTerm + gravity * a;
        vzNow = v0z * expTerm;
      } else {
        px = origin.x + v0x * age;
        py = origin.y + v0y * age + 0.5 * gravity * age * age;
        pz = origin.z + v0z * age;
        vxNow = v0x;
        vyNow = v0y + gravity * age;
        vzNow = v0z;
      }

      const u = clamp(age / pLife, 0, 1);
      const fadeIn = smoothstep(0, 0.08, u);
      const fadeOut = 1 - smoothstep(0.65, 1, u);
      const env = fadeIn * fadeOut;

      const growth = Math.max(0.05, 1 + preset.grow * u);
      const sc = sizeMul[i] * growth * (preset.grow < 0 ? fadeIn * (1 - u * 0.85) : env);

      dummyPos.set(px, py, pz);

      if (preset.velocityAligned) {
        const speedNow = Math.hypot(vxNow, vyNow, vzNow);
        if (speedNow > 1e-4) {
          velDir.set(vxNow / speedNow, vyNow / speedNow, vzNow / speedNow);
          dummyQuat.setFromUnitVectors(yAxis, velDir);
        } else {
          dummyQuat.identity();
        }
        const stretch = 1 + speedNow * preset.streakScale;
        dummyScale.set(sx * sc, sy * sc * stretch, sz * sc);
      } else if (billboardPuff) {
        dummyQuat.copy(camQuat);
        if (preset.spin !== 0) {
          spinQuat.setFromAxisAngle(zAxis, rotStart[i] + preset.spin * age);
          dummyQuat.multiply(spinQuat);
        }
        dummyScale.set(sx * sc, sy * sc, sz * sc);
      } else {
        if (preset.spin !== 0) {
          spinAxis.set(rotAxisX[i], rotAxisY[i], rotAxisZ[i]);
          dummyQuat.setFromAxisAngle(spinAxis, rotStart[i] + preset.spin * age);
        } else {
          dummyQuat.identity();
        }
        dummyScale.set(sx * sc, sy * sc, sz * sc);
      }

      dummyMatrix.compose(dummyPos, dummyQuat, dummyScale);
      mesh.setMatrixAt(i, dummyMatrix);

      if (hasPerInstanceColor) {
        if (preset.multiColor) {
          tmpColor.setHex(CONFETTI_PALETTE[paletteIdx[i]]);
        } else {
          tmpColor.setRGB(1, 1, 1).multiplyScalar(env);
        }
        mesh.setColorAt(i, tmpColor);
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  evalFrame(0);

  const update = (t: number, camera?: THREE.Camera): void => {
    evalFrame(t, camera);
  };

  const setOrigin = (at: Vec3Input): void => {
    if (at instanceof THREE.Vector3) {
      origin.copy(at);
    } else {
      origin.set(finiteOr(at[0], 0), finiteOr(at[1], 0), finiteOr(at[2], 0));
    }
  };

  const setIntensity = (v: number): void => {
    if (!Number.isFinite(v)) return;
    const clamped = Math.max(0, v);
    const active = Math.round(maxCount * clamp(clamped, 0, 1));
    mesh.count = active;
    mesh.visible = active > 0;
    material.opacity = clamp(baseOpacity * clamped, 0, 1);
  };

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    mesh.removeFromParent();
    mesh.dispose();
    geometry.dispose();
    material.dispose();
    texture.dispose();
  };

  return { mesh, material, update, setOrigin, setIntensity, dispose };
}
