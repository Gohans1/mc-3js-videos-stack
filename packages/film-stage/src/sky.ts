import * as THREE from "three";

export type Vec3Tuple = readonly [number, number, number];
export type Vec2Tuple = readonly [number, number];

export type SkyPresetId =
  | "daylight"
  | "golden-hour"
  | "overcast"
  | "dusk"
  | "night"
  | "dawn"
  | "stormy"
  | "city-night"
  | "underwater"
  | "space"
  | "arctic"
  | "desert";

export interface SkyDomeSpec {
  zenith?: THREE.ColorRepresentation;
  horizon?: THREE.ColorRepresentation;
  ground?: THREE.ColorRepresentation;
  sunDir?: Vec3Tuple | THREE.Vector3;
  sunGlow?: number;
  sunColor?: THREE.ColorRepresentation;
  horizonPower?: number;
}

export interface SkyDomeOptions extends SkyDomeSpec {
  preset?: SkyPresetId;
  radius?: number;
  widthSegments?: number;
  heightSegments?: number;
}

export interface SkyDomeUniforms {
  zenith: { value: THREE.Color };
  horizon: { value: THREE.Color };
  ground: { value: THREE.Color };
  sunDir: { value: THREE.Vector3 };
  sunGlow: { value: number };
  sunColor: { value: THREE.Color };
  horizonPower: { value: number };
}

export interface SkyDomeHandle {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  material: THREE.ShaderMaterial;
  uniforms: SkyDomeUniforms;
  set: (patch: SkyDomeSpec) => void;
  follow: (camera: THREE.Object3D | THREE.Vector3) => void;
  dispose: () => void;
}

export const SKY_PRESETS: Record<
  SkyPresetId,
  {
    zenith: string;
    horizon: string;
    ground: string;
    sunDir: Vec3Tuple;
    sunGlow: number;
    sunColor: string;
    horizonPower: number;
  }
> = {
  daylight: {
    zenith: "#3e78c4",
    horizon: "#d5e4f0",
    ground: "#6b6a5e",
    sunDir: [-0.45, 0.72, -0.52],
    sunGlow: 0.65,
    sunColor: "#fff4dc",
    horizonPower: 0.45,
  },
  "golden-hour": {
    zenith: "#3c5f94",
    horizon: "#eab888",
    ground: "#5c4534",
    sunDir: [-0.68, 0.22, -0.7],
    sunGlow: 1.15,
    sunColor: "#ffd291",
    horizonPower: 0.52,
  },
  overcast: {
    zenith: "#98a8b8",
    horizon: "#cfd8e0",
    ground: "#5b5f63",
    sunDir: [0.2, 0.9, 0.3],
    sunGlow: 0.15,
    sunColor: "#f0f4f8",
    horizonPower: 0.6,
  },
  dusk: {
    zenith: "#1c2848",
    horizon: "#c97b68",
    ground: "#2a222b",
    sunDir: [-0.72, 0.1, -0.68],
    sunGlow: 0.75,
    sunColor: "#ff9b6a",
    horizonPower: 0.42,
  },
  night: {
    zenith: "#070c18",
    horizon: "#19263d",
    ground: "#0c1018",
    sunDir: [0.4, 0.6, -0.68],
    sunGlow: 0.25,
    sunColor: "#9cc2ff",
    horizonPower: 0.55,
  },
  dawn: {
    zenith: "#334d82",
    horizon: "#f2b8a0",
    ground: "#4f3e44",
    sunDir: [0.72, 0.16, -0.67],
    sunGlow: 0.9,
    sunColor: "#ffcfa6",
    horizonPower: 0.48,
  },
  stormy: {
    zenith: "#2c3846",
    horizon: "#667584",
    ground: "#2a3138",
    sunDir: [-0.25, 0.75, 0.6],
    sunGlow: 0.1,
    sunColor: "#b8cadb",
    horizonPower: 0.58,
  },
  "city-night": {
    zenith: "#090e1f",
    horizon: "#2b2442",
    ground: "#12101c",
    sunDir: [0.3, 0.45, -0.84],
    sunGlow: 0.2,
    sunColor: "#a898ff",
    horizonPower: 0.38,
  },
  underwater: {
    zenith: "#4fd0e6",
    horizon: "#156d84",
    ground: "#062230",
    sunDir: [0.1, 0.98, 0.14],
    sunGlow: 0.7,
    sunColor: "#a6f6ff",
    horizonPower: 0.5,
  },
  space: {
    zenith: "#010205",
    horizon: "#03050c",
    ground: "#010204",
    sunDir: [-0.6, 0.4, -0.7],
    sunGlow: 0.35,
    sunColor: "#ffffff",
    horizonPower: 0.7,
  },
  arctic: {
    zenith: "#5a8ec9",
    horizon: "#dceaf4",
    ground: "#b2c6d9",
    sunDir: [-0.62, 0.32, -0.71],
    sunGlow: 0.55,
    sunColor: "#f0f7ff",
    horizonPower: 0.44,
  },
  desert: {
    zenith: "#2d6bb8",
    horizon: "#ecd4aa",
    ground: "#a87e4c",
    sunDir: [0.32, 0.85, 0.42],
    sunGlow: 0.85,
    sunColor: "#fff0c8",
    horizonPower: 0.4,
  },
};

export const SKY_PRESET_IDS = Object.keys(SKY_PRESETS) as SkyPresetId[];

const SKY_VERT = `varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = `uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 ground;
uniform vec3 sunDir;
uniform float sunGlow;
uniform vec3 sunColor;
uniform float horizonPower;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float up = max(d.y, 0.0);
  vec3 col = mix(horizon, zenith, pow(up, max(horizonPower, 0.01)));
  col = mix(col, ground, smoothstep(0.0, 0.08, -d.y));
  float s = max(dot(d, normalize(sunDir)), 0.0);
  col += sunColor * max(sunGlow, 0.0) * (0.35 * pow(s, 8.0) + 0.9 * pow(s, 64.0));
  gl_FragColor = vec4(col, 1.0);
}`;

const finiteOr = (v: number | undefined, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

function setNormalizedDir(target: THREE.Vector3, dir: Vec3Tuple | THREE.Vector3): void {
  const x = dir instanceof THREE.Vector3 ? dir.x : dir[0];
  const y = dir instanceof THREE.Vector3 ? dir.y : dir[1];
  const z = dir instanceof THREE.Vector3 ? dir.z : dir[2];
  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
    target.set(x, y, z);
    if (target.lengthSq() > 1e-12) {
      target.normalize();
      return;
    }
  }
  target.set(0, 1, 0);
}

function readWorldPos(out: THREE.Vector3, camera: THREE.Object3D | THREE.Vector3): THREE.Vector3 {
  if (camera instanceof THREE.Vector3) return out.copy(camera);
  camera.updateWorldMatrix(true, false);
  return camera.getWorldPosition(out);
}

export function createSkyDome(opts: SkyDomeOptions = {}): SkyDomeHandle {
  let base = SKY_PRESETS.daylight;
  if (opts.preset !== undefined) {
    if (!Object.hasOwn(SKY_PRESETS, opts.preset)) {
      throw new Error(
        `Unknown sky preset ${JSON.stringify(opts.preset)}; expected ${SKY_PRESET_IDS.join(" | ")}`,
      );
    }
    base = SKY_PRESETS[opts.preset];
  }

  const uniforms: SkyDomeUniforms = {
    zenith: { value: new THREE.Color(opts.zenith ?? base.zenith) },
    horizon: { value: new THREE.Color(opts.horizon ?? base.horizon) },
    ground: {
      value: new THREE.Color(
        opts.ground ??
          (opts.preset === undefined && opts.horizon !== undefined ? opts.horizon : base.ground),
      ),
    },
    sunDir: { value: new THREE.Vector3() },
    sunGlow: { value: Math.max(0, finiteOr(opts.sunGlow, base.sunGlow)) },
    sunColor: { value: new THREE.Color(opts.sunColor ?? base.sunColor) },
    horizonPower: { value: Math.max(0.05, finiteOr(opts.horizonPower, base.horizonPower)) },
  };
  setNormalizedDir(uniforms.sunDir.value, opts.sunDir ?? base.sunDir);

  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    depthFunc: THREE.LessEqualDepth,
    fog: false,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
  });

  const geometry = new THREE.SphereGeometry(
    Math.max(1, finiteOr(opts.radius, 450)),
    Math.max(8, Math.round(finiteOr(opts.widthSegments, 48))),
    Math.max(6, Math.round(finiteOr(opts.heightSegments, 24))),
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = "sky-dome";

  let disposed = false;

  return {
    mesh,
    material,
    uniforms,
    set(patch: SkyDomeSpec) {
      if (patch.zenith !== undefined) uniforms.zenith.value.set(patch.zenith);
      if (patch.horizon !== undefined) uniforms.horizon.value.set(patch.horizon);
      if (patch.ground !== undefined) uniforms.ground.value.set(patch.ground);
      if (patch.sunDir !== undefined) setNormalizedDir(uniforms.sunDir.value, patch.sunDir);
      if (patch.sunGlow !== undefined && Number.isFinite(patch.sunGlow)) {
        uniforms.sunGlow.value = Math.max(0, patch.sunGlow);
      }
      if (patch.sunColor !== undefined) uniforms.sunColor.value.set(patch.sunColor);
      if (patch.horizonPower !== undefined && Number.isFinite(patch.horizonPower)) {
        uniforms.horizonPower.value = Math.max(0.05, patch.horizonPower);
      }
    },
    follow(camera: THREE.Object3D | THREE.Vector3) {
      readWorldPos(mesh.position, camera);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}

export type StudioBackdropPresetId =
  | "explainer-cyan"
  | "explainer-blue"
  | "studio-light"
  | "medical-clean"
  | "cutaway-slate"
  | "dark-dramatic"
  | "warm-studio"
  | "neon-violet";

export interface StudioBackdropSpec {
  edge?: THREE.ColorRepresentation;
  halo?: THREE.ColorRepresentation;
  centre?: Vec2Tuple | THREE.Vector2;
  radius?: number;
  aspect?: number;
  power?: number;
  stretch?: number;
}

export interface StudioBackdropOptions extends StudioBackdropSpec {
  preset?: StudioBackdropPresetId;
}

export const BACKDROP_PRESETS: Record<
  StudioBackdropPresetId,
  {
    edge: string;
    halo: string;
    centre: Vec2Tuple;
    radius: number;
    power: number;
    stretch: number;
  }
> = {
  "explainer-cyan": {
    edge: "#33aec4",
    halo: "#b5c1c8",
    centre: [0.5, 0.48],
    radius: 0.58,
    power: 1.55,
    stretch: 0.8,
  },
  "explainer-blue": {
    edge: "#2a69b8",
    halo: "#a4c8ec",
    centre: [0.5, 0.46],
    radius: 0.62,
    power: 1.6,
    stretch: 0.85,
  },
  "studio-light": {
    edge: "#b2bcc6",
    halo: "#eef2f6",
    centre: [0.5, 0.45],
    radius: 0.68,
    power: 1.5,
    stretch: 1.0,
  },
  "medical-clean": {
    edge: "#8eb8c7",
    halo: "#e8f4f8",
    centre: [0.5, 0.45],
    radius: 0.66,
    power: 1.5,
    stretch: 0.92,
  },
  "cutaway-slate": {
    edge: "#111a26",
    halo: "#2d4860",
    centre: [0.5, 0.48],
    radius: 0.62,
    power: 1.75,
    stretch: 0.9,
  },
  "dark-dramatic": {
    edge: "#080a10",
    halo: "#222938",
    centre: [0.5, 0.46],
    radius: 0.58,
    power: 1.8,
    stretch: 0.95,
  },
  "warm-studio": {
    edge: "#594335",
    halo: "#d9b998",
    centre: [0.5, 0.46],
    radius: 0.64,
    power: 1.65,
    stretch: 0.92,
  },
  "neon-violet": {
    edge: "#140b29",
    halo: "#522585",
    centre: [0.5, 0.48],
    radius: 0.6,
    power: 1.7,
    stretch: 0.88,
  },
};

export const BACKDROP_PRESET_IDS = Object.keys(BACKDROP_PRESETS) as StudioBackdropPresetId[];

export interface StudioBackdropUniforms {
  edge: { value: THREE.Color };
  halo: { value: THREE.Color };
  centre: { value: THREE.Vector2 };
  radius: { value: number };
  aspect: { value: number };
  power: { value: number };
  stretch: { value: number };
}

export interface StudioBackdropHandle {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  material: THREE.ShaderMaterial;
  uniforms: StudioBackdropUniforms;
  set: (patch: StudioBackdropSpec) => void;
  setAspect: (aspect: number) => void;
  dispose: () => void;
}

const BACKDROP_VERT = `varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}`;

const BACKDROP_FRAG = `uniform vec3 edge;
uniform vec3 halo;
uniform vec2 centre;
uniform float radius;
uniform float aspect;
uniform float power;
uniform float stretch;
varying vec2 vUv;
void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) - centre;
  p.y *= stretch / max(aspect, 0.0001);
  float k = clamp(1.0 - length(p) / max(radius, 0.0001), 0.0, 1.0);
  float s = k * k * (3.0 - 2.0 * k);
  k = pow(s, max(power, 0.01));
  vec3 col = mix(edge, halo, clamp(k, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}`;

export function createStudioBackdrop(opts: StudioBackdropOptions = {}): StudioBackdropHandle {
  let base = BACKDROP_PRESETS["explainer-cyan"];
  if (opts.preset !== undefined) {
    if (!Object.hasOwn(BACKDROP_PRESETS, opts.preset)) {
      throw new Error(
        `Unknown backdrop preset ${JSON.stringify(opts.preset)}; expected ${BACKDROP_PRESET_IDS.join(" | ")}`,
      );
    }
    base = BACKDROP_PRESETS[opts.preset];
  }

  const centre =
    opts.centre instanceof THREE.Vector2
      ? new THREE.Vector2(
          finiteOr(opts.centre.x, base.centre[0]),
          finiteOr(opts.centre.y, base.centre[1]),
        )
      : new THREE.Vector2(
          finiteOr(opts.centre?.[0], base.centre[0]),
          finiteOr(opts.centre?.[1], base.centre[1]),
        );

  const uniforms: StudioBackdropUniforms = {
    edge: { value: new THREE.Color(opts.edge ?? base.edge) },
    halo: { value: new THREE.Color(opts.halo ?? base.halo) },
    centre: { value: centre },
    radius: { value: Math.max(1e-4, finiteOr(opts.radius, base.radius)) },
    aspect: { value: Math.max(1e-4, finiteOr(opts.aspect, 9 / 16)) },
    power: { value: Math.max(0.01, finiteOr(opts.power, base.power)) },
    stretch: { value: Math.max(0.01, finiteOr(opts.stretch, base.stretch)) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    depthWrite: false,
    depthTest: false,
    fog: false,
    vertexShader: BACKDROP_VERT,
    fragmentShader: BACKDROP_FRAG,
  });

  const geometry = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = "studio-backdrop";

  let disposed = false;

  return {
    mesh,
    material,
    uniforms,
    set(patch: StudioBackdropSpec) {
      if (patch.edge !== undefined) uniforms.edge.value.set(patch.edge);
      if (patch.halo !== undefined) uniforms.halo.value.set(patch.halo);
      if (patch.centre !== undefined) {
        const cx = patch.centre instanceof THREE.Vector2 ? patch.centre.x : patch.centre[0];
        const cy = patch.centre instanceof THREE.Vector2 ? patch.centre.y : patch.centre[1];
        uniforms.centre.value.set(
          finiteOr(cx, uniforms.centre.value.x),
          finiteOr(cy, uniforms.centre.value.y),
        );
      }
      if (patch.radius !== undefined && Number.isFinite(patch.radius)) {
        uniforms.radius.value = Math.max(1e-4, patch.radius);
      }
      if (patch.aspect !== undefined && Number.isFinite(patch.aspect)) {
        uniforms.aspect.value = Math.max(1e-4, patch.aspect);
      }
      if (patch.power !== undefined && Number.isFinite(patch.power)) {
        uniforms.power.value = Math.max(0.01, patch.power);
      }
      if (patch.stretch !== undefined && Number.isFinite(patch.stretch)) {
        uniforms.stretch.value = Math.max(0.01, patch.stretch);
      }
    },
    setAspect(aspect: number) {
      if (Number.isFinite(aspect)) uniforms.aspect.value = Math.max(1e-4, aspect);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}

export interface CloudLayerOptions {
  cell?: number;
  height?: number;
  gridSize?: number;
  altitude?: number;
  coverage?: number;
  seed?: number;
  opacity?: number;
  color?: THREE.ColorRepresentation;
  grid?: readonly (readonly (boolean | number)[])[];
  image?: { width: number; height: number; data: ArrayLike<number> };
  fade?: number;
  name?: string;
}

export interface CloudFollowOptions {
  y?: number;
  origin?: Vec2Tuple;
}

export interface CloudLayerHandle {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
  material: THREE.MeshBasicMaterial;
  uniforms: {
    cloudShift: { value: THREE.Vector2 };
    cloudSpan: { value: THREE.Vector2 };
    cloudFade: { value: number };
  };
  span: number;
  follow: (camera: THREE.Object3D | THREE.Vector3, opts?: CloudFollowOptions) => void;
  update: (t: number, wind?: Vec2Tuple) => void;
  dispose: () => void;
}

function hash2d(ix: number, iy: number, period: number, seed: number): number {
  const x = ((ix % period) + period) % period;
  const y = ((iy % period) + period) % period;
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function periodicNoise(u: number, v: number, freq: number, seed: number): number {
  const fx = u * freq;
  const fy = v * freq;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash2d(ix, iy, freq, seed);
  const b = hash2d(ix + 1, iy, freq, seed);
  const c = hash2d(ix, iy + 1, freq, seed);
  const d = hash2d(ix + 1, iy + 1, freq, seed);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

const CLOUD_FACES: ReadonlyArray<readonly [number, number, number, readonly Vec3Tuple[], number]> = [
  [1, 0, 0, [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], 0.9],
  [-1, 0, 0, [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], 0.9],
  [0, 1, 0, [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], 0.8],
  [0, -1, 0, [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], 0.8],
  [0, 0, 1, [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], 1.0],
  [0, 0, -1, [[1, 0, 0], [1, 0, 1], [0, 0, 1], [0, 0, 0]], 0.7],
];

const _camPos = new THREE.Vector3();

export function createCloudLayer(opts: CloudLayerOptions = {}): CloudLayerHandle {
  const cell = Math.max(0.5, finiteOr(opts.cell, 12));
  const height = Math.max(0.25, finiteOr(opts.height, 4));
  const opacity = Math.min(1, Math.max(0, finiteOr(opts.opacity, 0.8)));

  let rows: number;
  let cols: number;
  let filled: (x: number, z: number) => boolean;
  if (opts.image) {
    const { width, height: h, data } = opts.image;
    cols = width;
    rows = h;
    filled = (x, z) => (data[(z * width + x) * 4 + 3] ?? 0) >= 128;
  } else if (opts.grid) {
    const grid = opts.grid;
    rows = grid.length;
    cols = rows > 0 ? Math.max(0, ...grid.map((r) => r.length)) : 0;
    filled = (x, z) => {
      const v = grid[z]?.[x];
      return typeof v === "boolean" ? v : (v ?? 0) > 0.5;
    };
  } else {
    const gridSize = Math.max(4, Math.round(finiteOr(opts.gridSize, 24)));
    rows = cols = gridSize;
    const coverage = Math.min(1, Math.max(0, finiteOr(opts.coverage, 0.35)));
    const seed = finiteOr(opts.seed, 1);
    const values: number[] = [];
    for (let z = 0; z < gridSize; z++)
      for (let x = 0; x < gridSize; x++) {
        const u = x / gridSize;
        const v = z / gridSize;
        values.push(
          0.6 * periodicNoise(u, v, 4, seed) +
            0.3 * periodicNoise(u, v, 8, seed + 17) +
            0.1 * periodicNoise(u, v, 16, seed + 53),
        );
      }
    const ranked = values.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
    const on = new Set(ranked.slice(0, Math.round(values.length * coverage)).map((r) => r.i));
    filled = (x, z) => on.has(z * gridSize + x);
  }
  const at = (x: number, z: number) =>
    cols > 0 && rows > 0 && filled(((x % cols) + cols) % cols, ((z % rows) + rows) % rows);

  const shadeColor = new THREE.Color();
  const position: number[] = [];
  const color: number[] = [];
  const cellOrigin: number[] = [];
  const index: number[] = [];
  const fade = Math.max(0, finiteOr(opts.fade, 0));
  const repeat = (n: number) => (fade > 0 && n > 0 ? Math.max(1, Math.ceil((2 * fade) / (n * cell))) : 1);
  const nx = cols * repeat(cols);
  const nz = rows * repeat(rows);
  for (let z = 0; z < nz; z++)
    for (let x = 0; x < nx; x++) {
      if (!at(x, z)) continue;
      const ox = (x - nx / 2 + 0.5) * cell;
      const oz = (z - nz / 2 + 0.5) * cell;
      for (const [dx, dz, dy, corners, shade] of CLOUD_FACES) {
        if (!dy && at(x + dx, z + dz)) continue;
        const n = position.length / 3;
        for (const [cx, cy, cz] of corners) {
          position.push((cx - 0.5) * cell, cy * height, (cz - 0.5) * cell);
          shadeColor.setRGB(shade, shade, shade, THREE.SRGBColorSpace);
          color.push(shadeColor.r, shadeColor.g, shadeColor.b);
          cellOrigin.push(ox, oz);
        }
        index.push(n, n + 1, n + 2, n, n + 2, n + 3);
      }
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(color, 3));
  geometry.setAttribute("cloudCell", new THREE.Float32BufferAttribute(cellOrigin, 2));
  geometry.setIndex(index);
  geometry.addGroup(0, index.length, 0);
  geometry.addGroup(0, index.length, 1);

  const spanX = nx * cell;
  const spanZ = nz * cell;
  const uniforms = {
    cloudShift: { value: new THREE.Vector2() },
    cloudSpan: { value: new THREE.Vector2(spanX, spanZ) },
    cloudFade: { value: fade },
  };
  const material = new THREE.MeshBasicMaterial({
    color: opts.color ?? "#ffffff",
    vertexColors: true,
    transparent: true,
    opacity,
    depthWrite: true,
    depthFunc: THREE.LessEqualDepth,
  });
  const depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true });
  const wrapCells = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec2 cloudCell;\nuniform vec2 cloudShift;\nuniform vec2 cloudSpan;\nuniform float cloudFade;\nvarying float vCloudFade;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        transformed.xz += mod(cloudCell + cloudShift + 0.5 * cloudSpan, cloudSpan) - 0.5 * cloudSpan;
        vCloudFade = cloudFade > 0.0
          ? 1.0 - clamp(distance((modelMatrix * vec4(transformed, 1.0)).xyz, cameraPosition) / cloudFade, 0.0, 1.0)
          : 1.0;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vCloudFade;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.a *= vCloudFade;");
  };
  for (const m of [depthMaterial, material]) {
    m.onBeforeCompile = wrapCells;
    m.customProgramCacheKey = () => "film-stage-cloud-layer";
  }

  const mesh = new THREE.Mesh(geometry, [depthMaterial, material]);
  mesh.frustumCulled = false;
  mesh.name = opts.name ?? "cloud-layer";
  mesh.position.y = finiteOr(opts.altitude, 120);

  let originX = 0;
  let originZ = 0;
  let driftX = 0;
  let driftZ = 0;
  let disposed = false;
  const sync = () =>
    uniforms.cloudShift.value.set(
      originX + driftX - mesh.position.x,
      originZ + driftZ - mesh.position.z,
    );

  return {
    mesh,
    material,
    uniforms,
    span: Math.max(spanX, spanZ),
    follow(camera: THREE.Object3D | THREE.Vector3, followOpts: CloudFollowOptions = {}) {
      readWorldPos(_camPos, camera);
      mesh.position.x = _camPos.x;
      mesh.position.z = _camPos.z;
      originX = finiteOr(followOpts.origin?.[0], 0);
      originZ = finiteOr(followOpts.origin?.[1], 0);
      if (followOpts.y !== undefined && Number.isFinite(followOpts.y)) mesh.position.y = followOpts.y;
      sync();
    },
    update(t: number, wind: Vec2Tuple = [2, 0.5]) {
      const safeT = Number.isFinite(t) ? t : 0;
      driftX = safeT * finiteOr(wind[0], 2);
      driftZ = safeT * finiteOr(wind[1], 0.5);
      sync();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      depthMaterial.dispose();
    },
  };
}

export interface StarfieldOptions {
  count?: number;
  radius?: number;
  seed?: number;
  size?: number;
  brightness?: number;
  twinkleSpeed?: number;
  twinkleAmount?: number;
  minElevation?: number;
}

export interface StarfieldHandle {
  points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  material: THREE.ShaderMaterial;
  follow: (camera: THREE.Object3D | THREE.Vector3) => void;
  update: (t: number) => void;
  dispose: () => void;
}

const STAR_PALETTE: readonly Vec3Tuple[] = [
  [0.68, 0.82, 1.0],
  [0.88, 0.94, 1.0],
  [1.0, 0.98, 0.94],
  [1.0, 0.9, 0.72],
  [1.0, 0.76, 0.56],
];

const STAR_VERT = `attribute float aSize;
attribute float aPhase;
attribute vec3 aColor;
uniform float uTime;
uniform float uScale;
uniform float uTwinkleSpeed;
uniform float uTwinkleAmount;
varying vec3 vColor;
varying float vTwinkle;
void main() {
  vColor = aColor;
  float tw = 1.0 - uTwinkleAmount * (0.5 + 0.5 * sin(uTime * uTwinkleSpeed + aPhase));
  vTwinkle = tw;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  if (isOrthographic && mv.z > 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  gl_PointSize = max(1.0, aSize * uScale * (0.85 + 0.15 * tw));
  vec4 p = projectionMatrix * mv;
  gl_Position = p.xyww;
}`;

const STAR_FRAG = `uniform float uBrightness;
varying vec3 vColor;
varying float vTwinkle;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float glow = pow(1.0 - r, 2.2);
  float a = clamp(glow * vTwinkle, 0.0, 1.0);
  if (a < 0.001) discard;
  gl_FragColor = vec4(vColor * uBrightness, a);
}`;

function mulberry(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createStarfield(opts: StarfieldOptions = {}): StarfieldHandle {
  const count = Math.max(1, Math.round(finiteOr(opts.count, 1200)));
  const radius = Math.max(1, finiteOr(opts.radius, 400));
  const minY = Math.max(-1, Math.min(0.95, finiteOr(opts.minElevation, -1)));
  const rand = mulberry(finiteOr(opts.seed, 1));

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const u = rand();
    const y = minY + (1 - minY) * u;
    const phi = rand() * Math.PI * 2;
    const rHoriz = Math.sqrt(Math.max(0, 1 - y * y));
    positions[i * 3] = Math.cos(phi) * rHoriz * radius;
    positions[i * 3 + 1] = y * radius;
    positions[i * 3 + 2] = Math.sin(phi) * rHoriz * radius;

    const tint = STAR_PALETTE[Math.floor(rand() * STAR_PALETTE.length)];
    const mag = 0.45 + rand() ** 2 * 1.1;
    colors[i * 3] = tint[0] * mag;
    colors[i * 3 + 1] = tint[1] * mag;
    colors[i * 3 + 2] = tint[2] * mag;

    sizes[i] = 0.7 + rand() ** 2.4 * 2.3;
    phases[i] = rand() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uScale: { value: Math.max(0.5, finiteOr(opts.size, 2.2)) },
      uBrightness: { value: Math.max(0, finiteOr(opts.brightness, 1.4)) },
      uTwinkleSpeed: { value: Math.max(0, finiteOr(opts.twinkleSpeed, 1.8)) },
      uTwinkleAmount: { value: Math.min(1, Math.max(0, finiteOr(opts.twinkleAmount, 0.25))) },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    depthFunc: THREE.LessEqualDepth,
    fog: false,
    blending: THREE.AdditiveBlending,
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -998;
  points.name = "starfield";

  let disposed = false;

  return {
    points,
    material,
    follow(camera: THREE.Object3D | THREE.Vector3) {
      readWorldPos(points.position, camera);
    },
    update(t: number) {
      (material.uniforms.uTime as { value: number }).value = Number.isFinite(t) ? t : 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      points.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}

export type CelestialKind = "sun" | "moon";
export type CelestialShape = "round" | "square";

export interface CelestialDiscSpec {
  dir?: Vec3Tuple | THREE.Vector3;
  distance?: number;
  color?: THREE.ColorRepresentation;
  intensity?: number;
  halo?: number;
  shape?: CelestialShape;
}

export interface CelestialDiscOptions extends CelestialDiscSpec {
  kind?: CelestialKind;
  size?: number;
}

export interface CelestialDiscHandle {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  material: THREE.ShaderMaterial;
  set: (patch: CelestialDiscSpec) => void;
  follow: (camera: THREE.Object3D | THREE.Vector3) => void;
  dispose: () => void;
}

const DISC_VERT = `varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const DISC_FRAG = `uniform vec3 uColor;
uniform float uIntensity;
uniform float uHalo;
uniform float uSquare;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float dist = mix(length(p), max(abs(p.x), abs(p.y)), uSquare);
  float core = 1.0 - smoothstep(0.36, 0.42, dist);
  float glow = pow(clamp(1.0 - dist, 0.0, 1.0), 3.0) * max(uHalo, 0.0);
  float a = clamp(core + glow * 0.55, 0.0, 1.0);
  if (a < 0.001) discard;
  gl_FragColor = vec4(uColor * max(uIntensity, 0.0), a);
}`;

export function createCelestialDisc(opts: CelestialDiscOptions = {}): CelestialDiscHandle {
  const kind: CelestialKind = opts.kind ?? "sun";
  const shape: CelestialShape = opts.shape ?? "round";
  const dir = new THREE.Vector3();
  const anchor = new THREE.Vector3();
  setNormalizedDir(dir, opts.dir ?? (kind === "moon" ? [0.4, 0.6, -0.68] : [-0.45, 0.72, -0.52]));
  let distance = Math.max(1, finiteOr(opts.distance, 380));
  const size = Math.max(0.5, finiteOr(opts.size, kind === "moon" ? 26 : 38));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(opts.color ?? (kind === "moon" ? "#dbe9ff" : "#fff2d6")) },
      uIntensity: { value: Math.max(0, finiteOr(opts.intensity, kind === "moon" ? 1.8 : 4.5)) },
      uHalo: { value: Math.max(0, finiteOr(opts.halo, kind === "moon" ? 0.35 : 0.6)) },
      uSquare: { value: shape === "square" ? 1 : 0 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    depthFunc: THREE.LessEqualDepth,
    fog: false,
    blending: THREE.AdditiveBlending,
    vertexShader: DISC_VERT,
    fragmentShader: DISC_FRAG,
  });

  const geometry = new THREE.PlaneGeometry(size, size);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -999;
  mesh.name = `celestial-${kind}`;

  const syncTransform = () => {
    mesh.position.copy(anchor).addScaledVector(dir, distance);
    mesh.lookAt(anchor);
  };
  syncTransform();

  let disposed = false;

  return {
    mesh,
    material,
    set(patch: CelestialDiscSpec) {
      let moved = false;
      if (patch.dir !== undefined) {
        setNormalizedDir(dir, patch.dir);
        moved = true;
      }
      if (patch.distance !== undefined && Number.isFinite(patch.distance)) {
        distance = Math.max(1, patch.distance);
        moved = true;
      }
      if (moved) syncTransform();
      if (patch.color !== undefined) {
        (material.uniforms.uColor as { value: THREE.Color }).value.set(patch.color);
      }
      if (patch.intensity !== undefined && Number.isFinite(patch.intensity)) {
        (material.uniforms.uIntensity as { value: number }).value = Math.max(0, patch.intensity);
      }
      if (patch.halo !== undefined && Number.isFinite(patch.halo)) {
        (material.uniforms.uHalo as { value: number }).value = Math.max(0, patch.halo);
      }
      if (patch.shape !== undefined) {
        (material.uniforms.uSquare as { value: number }).value = patch.shape === "square" ? 1 : 0;
      }
    },
    follow(camera: THREE.Object3D | THREE.Vector3) {
      readWorldPos(anchor, camera);
      syncTransform();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
