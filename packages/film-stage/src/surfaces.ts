import * as THREE from "three";
import { Reflector } from "three/addons/objects/Reflector.js";

export type WaterPresetName =
  | "ocean"
  | "lake"
  | "pool"
  | "dark-sea"
  | "tropical"
  | "river"
  | "lava"
  | "toxic";

export interface WaterPreset {
  readonly color: string;
  readonly roughness: number;
  readonly metalness: number;
  readonly clearcoat: number;
  readonly clearcoatRoughness: number;
  readonly envMapIntensity: number;
  readonly normalStrength: number;
  readonly waveScale: number;
  readonly flowSpeed: readonly [number, number];
  readonly emissive?: string;
  readonly emissiveIntensity?: number;
  readonly opacity?: number;
  readonly doubleSide?: boolean;
}

export const WATER_PRESETS: Readonly<Record<WaterPresetName, WaterPreset>> = {
  ocean: {
    color: "#1f4f66",
    roughness: 0.2,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.16,
    envMapIntensity: 1.2,
    normalStrength: 0.7,
    waveScale: 0.24,
    flowSpeed: [0.012, 0.03],
  },
  lake: {
    color: "#27585e",
    roughness: 0.14,
    metalness: 0,
    clearcoat: 0.9,
    clearcoatRoughness: 0.1,
    envMapIntensity: 1.1,
    normalStrength: 0.35,
    waveScale: 0.18,
    flowSpeed: [0.005, 0.011],
  },
  pool: {
    color: "#2ea8b8",
    roughness: 0.08,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.0,
    normalStrength: 0.28,
    waveScale: 0.45,
    flowSpeed: [0.008, 0.016],
  },
  "dark-sea": {
    color: "#0b1d2a",
    roughness: 0.24,
    metalness: 0.05,
    clearcoat: 1,
    clearcoatRoughness: 0.18,
    envMapIntensity: 1.35,
    normalStrength: 0.9,
    waveScale: 0.28,
    flowSpeed: [0.018, 0.042],
  },
  tropical: {
    color: "#1cb6c6",
    roughness: 0.1,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.15,
    normalStrength: 0.38,
    waveScale: 0.32,
    flowSpeed: [0.01, 0.022],
    opacity: 0.88,
    doubleSide: true,
  },
  river: {
    color: "#255754",
    roughness: 0.18,
    metalness: 0,
    clearcoat: 0.9,
    clearcoatRoughness: 0.14,
    envMapIntensity: 1.1,
    normalStrength: 0.55,
    waveScale: 0.36,
    flowSpeed: [0.008, 0.085],
  },
  lava: {
    color: "#260b05",
    roughness: 0.65,
    metalness: 0.05,
    clearcoat: 0.15,
    clearcoatRoughness: 0.45,
    envMapIntensity: 0.4,
    normalStrength: 0.8,
    waveScale: 0.16,
    flowSpeed: [0.003, 0.007],
    emissive: "#ff4d0a",
    emissiveIntensity: 3.2,
  },
  toxic: {
    color: "#1b3d12",
    roughness: 0.3,
    metalness: 0.02,
    clearcoat: 0.65,
    clearcoatRoughness: 0.22,
    envMapIntensity: 0.9,
    normalStrength: 0.45,
    waveScale: 0.3,
    flowSpeed: [0.006, 0.012],
    emissive: "#6cff1a",
    emissiveIntensity: 1.4,
  },
};

export interface WaterSurfaceOptions {
  preset?: WaterPresetName;
  size?: number | readonly [number, number];
  color?: THREE.ColorRepresentation;
  roughness?: number;
  metalness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  envMapIntensity?: number;
  normalStrength?: number;
  waveScale?: number;
  flowSpeed?: number | readonly [number, number];
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  opacity?: number;
  depthWrite?: boolean;
  doubleSide?: boolean;
  textureSize?: number;
  y?: number;
  receiveShadow?: boolean;
}

export interface WaterSurfaceHandle {
  mesh: THREE.Mesh;
  material: THREE.MeshPhysicalMaterial;
  update: (t: number) => void;
  dispose: () => void;
}

const RIPPLE_WAVES: readonly (readonly [number, number, number, number])[] = [
  [3, 1, 1.0, 0.3],
  [1, 4, 0.7, 1.7],
  [5, -2, 0.45, 2.9],
  [-4, 5, 0.35, 0.8],
  [7, 3, 0.25, 4.1],
  [-2, 9, 0.18, 5.3],
];

const TAU = Math.PI * 2;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const finiteOr = (v: number | undefined, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const positiveOr = (v: number | undefined, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;

const normalizeZero = (v: number): number => (v === 0 ? 0 : v);

function buildRippleNormalData(size: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0;
      let dy = 0;
      for (let w = 0; w < RIPPLE_WAVES.length; w++) {
        const [kx, ky, amp, phase] = RIPPLE_WAVES[w];
        const s = Math.cos(((kx * x + ky * y) / size) * TAU + phase) * amp;
        dx += s * kx;
        dy += s * ky;
      }
      const nx = -dx * 0.09;
      const ny = -dy * 0.09;
      const invLen = 1 / Math.hypot(nx, ny, 1);
      const idx = (y * size + x) * 4;
      data[idx] = Math.round((nx * invLen * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.round((ny * invLen * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.round((invLen * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }
  return data;
}

function createRippleNormalTexture(data: Uint8Array, size: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export function createWaterSurface(opts: WaterSurfaceOptions = {}): WaterSurfaceHandle {
  const presetName = opts.preset ?? "ocean";
  if (!Object.hasOwn(WATER_PRESETS, presetName)) {
    throw new Error(
      `Unknown water preset ${JSON.stringify(presetName)}; expected ${Object.keys(WATER_PRESETS).join(" | ")}`,
    );
  }
  const preset = WATER_PRESETS[presetName];

  const [width, depth] = Array.isArray(opts.size)
    ? [positiveOr(opts.size[0], 600), positiveOr(opts.size[1], 600)]
    : [
        positiveOr(opts.size as number | undefined, 600),
        positiveOr(opts.size as number | undefined, 600),
      ];

  const texSize = Math.max(16, Math.round(positiveOr(opts.textureSize, 256)));
  const waveScale = positiveOr(opts.waveScale, preset.waveScale);
  const normalStrength = Math.max(0, finiteOr(opts.normalStrength, preset.normalStrength));
  const opacity = clamp(finiteOr(opts.opacity, preset.opacity ?? 1), 0, 1);
  const doubleSide = opts.doubleSide ?? preset.doubleSide ?? false;
  const emissive = opts.emissive ?? preset.emissive;
  const emissiveIntensity = Math.max(
    0,
    finiteOr(opts.emissiveIntensity, preset.emissiveIntensity ?? (emissive !== undefined ? 1 : 0)),
  );

  const [vx, vy] =
    typeof opts.flowSpeed === "number"
      ? [
          finiteOr(opts.flowSpeed, preset.flowSpeed[0]),
          finiteOr(opts.flowSpeed, preset.flowSpeed[1]),
        ]
      : opts.flowSpeed
        ? [
            finiteOr(opts.flowSpeed[0], preset.flowSpeed[0]),
            finiteOr(opts.flowSpeed[1], preset.flowSpeed[1]),
          ]
        : preset.flowSpeed;

  const normalData = buildRippleNormalData(texSize);
  const normalMap = createRippleNormalTexture(normalData, texSize);
  const clearcoatNormalMap = createRippleNormalTexture(normalData, texSize);

  normalMap.repeat.set(Math.max(1e-3, width * waveScale), Math.max(1e-3, depth * waveScale));
  clearcoatNormalMap.repeat.set(
    Math.max(1e-3, width * waveScale * 0.73),
    Math.max(1e-3, depth * waveScale * 0.73),
  );

  const material = new THREE.MeshPhysicalMaterial({
    color: opts.color ?? preset.color,
    roughness: clamp(finiteOr(opts.roughness, preset.roughness), 0, 1),
    metalness: clamp(finiteOr(opts.metalness, preset.metalness), 0, 1),
    clearcoat: clamp(finiteOr(opts.clearcoat, preset.clearcoat), 0, 1),
    clearcoatRoughness: clamp(finiteOr(opts.clearcoatRoughness, preset.clearcoatRoughness), 0, 1),
    envMapIntensity: Math.max(0, finiteOr(opts.envMapIntensity, preset.envMapIntensity)),
    normalMap,
    normalScale: new THREE.Vector2(normalStrength, normalStrength),
    clearcoatNormalMap,
    clearcoatNormalScale: new THREE.Vector2(normalStrength * 0.6, normalStrength * 0.6),
    transparent: opacity < 1,
    opacity,
    depthWrite: opts.depthWrite ?? opacity >= 1,
    side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    ...(emissive !== undefined ? { emissive, emissiveIntensity } : {}),
  });

  const geometry = new THREE.PlaneGeometry(width, depth);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "water-surface";
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = finiteOr(opts.y, 0);
  mesh.receiveShadow = opts.receiveShadow ?? true;

  const update = (t: number): void => {
    const time = Number.isFinite(t) ? t : 0;
    normalMap.offset.set(normalizeZero(time * vx), normalizeZero(time * vy));
    clearcoatNormalMap.offset.set(
      normalizeZero(-time * vx * 0.65 + 0.37),
      normalizeZero(time * vy * 0.8 + 0.19),
    );
  };
  update(0);

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    mesh.removeFromParent();
    geometry.dispose();
    material.dispose();
    normalMap.dispose();
    clearcoatNormalMap.dispose();
  };

  return { mesh, material, update, dispose };
}

export interface WetGroundOptions {
  width?: number;
  depth?: number;
  strength?: number;
  smear?: number;
  tint?: THREE.ColorRepresentation;
  res?: number;
  puddleScale?: number;
  puddleThreshold?: number;
  multisample?: number;
  clipBias?: number;
  y?: number;
}

export interface WetGroundHandle {
  mesh: Reflector;
  setStrength: (v: number) => void;
  setSmear: (v: number) => void;
  dispose: () => void;
}

const WET_GROUND_SHADER = {
  name: "WetGround",
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    strength: { value: 0.5 },
    smear: { value: 0.035 },
    puddleScale: { value: 0.9 },
    puddleThreshold: { value: 0.35 },
  },
  vertexShader: `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }
  `,
  fragmentShader: `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform float smear;
    uniform float puddleScale;
    uniform float puddleThreshold;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <logdepthbuf_pars_fragment>
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
        f.y
      );
    }
    void main() {
      #include <logdepthbuf_fragment>
      vec2 uv = vUv.xy / max(vUv.w, 1e-5);
      vec3 sum = vec3(0.0);
      float wsum = 0.0;
      for (int i = -4; i <= 4; i++) {
        float w = 1.0 - abs(float(i)) / 5.0;
        sum += texture2D(tDiffuse, uv + vec2(0.0, float(i) * smear / 4.0)).rgb * w;
        wsum += w;
      }
      vec3 refl = (sum / wsum) * color;
      float pNoise = noise(vWorld.xz * puddleScale) * 0.7 + noise(vWorld.xz * (puddleScale * 3.44)) * 0.3;
      float puddles = smoothstep(puddleThreshold, min(1.0, puddleThreshold + 0.4), pNoise);
      vec3 rawV = isOrthographic
        ? vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2])
        : (cameraPosition - vWorld);
      vec3 view = length(rawV) > 1e-5 ? normalize(rawV) : vec3(0.0, 1.0, 0.0);
      float fresnel = 0.04 + 0.96 * pow(1.0 - clamp(view.y, 0.0, 1.0), 5.0);
      float a = clamp(strength * mix(0.45, 1.0, puddles) * clamp(fresnel * 3.0, 0.0, 1.0), 0.0, 1.0);
      gl_FragColor = vec4(refl, a);
    }
  `,
};

export function createWetGround(opts: WetGroundOptions = {}): WetGroundHandle {
  const width = positiveOr(opts.width, 40);
  const depth = positiveOr(opts.depth, 40);
  const res = Math.max(16, Math.round(positiveOr(opts.res, 1024)));
  const multisample = Math.max(0, Math.round(finiteOr(opts.multisample, 4)));
  const clipBias = Math.max(0, finiteOr(opts.clipBias, 0.003));

  const geometry = new THREE.PlaneGeometry(width, depth);
  const mesh = new Reflector(geometry, {
    shader: WET_GROUND_SHADER,
    color: new THREE.Color(opts.tint ?? "#ffffff"),
    textureWidth: res,
    textureHeight: res,
    clipBias,
    multisample,
  });

  const material = mesh.material as THREE.ShaderMaterial;
  material.transparent = true;
  material.depthWrite = false;
  material.uniforms.strength.value = Math.max(0, finiteOr(opts.strength, 0.5));
  material.uniforms.smear.value = Math.max(0, finiteOr(opts.smear, 0.035));
  material.uniforms.puddleScale.value = positiveOr(opts.puddleScale, 0.9);
  material.uniforms.puddleThreshold.value = clamp(finiteOr(opts.puddleThreshold, 0.35), 0, 0.99);

  mesh.name = "wet-ground";
  mesh.userData.treatAsOpaque = true;
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = finiteOr(opts.y, 0.002);
  mesh.receiveShadow = false;

  const setStrength = (v: number): void => {
    if (!Number.isFinite(v)) return;
    material.uniforms.strength.value = Math.max(0, v);
  };

  const setSmear = (v: number): void => {
    if (!Number.isFinite(v)) return;
    material.uniforms.smear.value = Math.max(0, v);
  };

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    mesh.removeFromParent();
    mesh.dispose();
    geometry.dispose();
  };

  return { mesh, setStrength, setSmear, dispose };
}

export type HazeOrigin = readonly [number, number] | readonly [number, number, number];

export interface HazeLayerOptions {
  span?: number;
  count?: number;
  layers?: number;
  layerSpacing?: number;
  seed?: number;
  color?: THREE.ColorRepresentation;
  opacity?: number;
  sizeRange?: readonly [number, number];
  textureSize?: number;
  variants?: number;
  y?: number;
}

export interface HazeLayerHandle {
  group: THREE.Group;
  follow: (camera: THREE.Camera, origin?: HazeOrigin) => void;
  setOpacity: (v: number) => void;
  dispose: () => void;
}

function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildWispTexture(seed: number, size: number): THREE.DataTexture {
  const rand = createMulberry32(seed);
  const octaves: { n: number; v: Float32Array }[] = [];
  for (let o = 0; o < 4; o++) {
    const n = 4 << o;
    const v = new Float32Array((n + 1) * (n + 1));
    for (let i = 0; i < v.length; i++) v[i] = rand();
    octaves.push({ n, v });
  }

  const smoothLerp = (a: number, b: number, t: number): number =>
    a + (b - a) * (t * t * (3 - 2 * t));

  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let f = 0;
      let amp = 0.5;
      for (let o = 0; o < octaves.length; o++) {
        const { n, v } = octaves[o];
        const fx = (x / size) * n;
        const fy = (y / size) * n;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const row0 = iy * (n + 1);
        const row1 = (iy + 1) * (n + 1);
        const top = smoothLerp(v[row0 + ix], v[row0 + ix + 1], fx - ix);
        const bot = smoothLerp(v[row1 + ix], v[row1 + ix + 1], fx - ix);
        f += amp * smoothLerp(top, bot, fy - iy);
        amp *= 0.5;
      }
      const r = Math.hypot(x / size - 0.5, y / size - 0.5) * 2;
      const alpha = clamp((f - 0.42) * 2.6, 0, 1) * Math.max(0, 1 - r * r);
      const idx = (y * size + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = Math.round(alpha * 255);
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

export function createHazeLayer(opts: HazeLayerOptions = {}): HazeLayerHandle {
  const span = positiveOr(opts.span, 2400);
  const count = Math.max(1, Math.round(positiveOr(opts.count, 90)));
  const layers = Math.max(1, Math.round(positiveOr(opts.layers, 2)));
  const layerSpacing = positiveOr(opts.layerSpacing, 7);
  const seed = Math.round(finiteOr(opts.seed, 5));
  const opacity = clamp(finiteOr(opts.opacity, 0.55), 0, 1);
  const textureSize = Math.max(16, Math.round(positiveOr(opts.textureSize, 128)));
  const variants = Math.max(1, Math.round(positiveOr(opts.variants, 4)));
  const minSize = positiveOr(opts.sizeRange?.[0], 60);
  const maxSize = Math.max(minSize, positiveOr(opts.sizeRange?.[1], 280));

  const group = new THREE.Group();
  group.name = "haze-layer";
  group.position.y = finiteOr(opts.y, 0);

  const textures: THREE.DataTexture[] = [];
  const materials: THREE.MeshBasicMaterial[] = [];
  for (let i = 0; i < variants; i++) {
    const tex = buildWispTexture(seed * 10 + i, textureSize);
    textures.push(tex);
    materials.push(
      new THREE.MeshBasicMaterial({
        map: tex,
        color: opts.color ?? "#f3efe6",
        transparent: true,
        opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
  }

  const quad = new THREE.PlaneGeometry(1, 1);
  quad.rotateX(-Math.PI / 2);

  const rand = createMulberry32(seed);
  for (let i = 0; i < count; i++) {
    const size = minSize + rand() * (maxSize - minSize);
    const x = (rand() - 0.5) * span;
    const z = (rand() - 0.5) * span;
    const yaw = rand() * TAU;
    for (let layer = 0; layer < layers; layer++) {
      const dy = layer === 0 ? 0 : layer * layerSpacing + rand() * 6;
      const mat = materials[Math.floor(rand() * materials.length)];
      const mesh = new THREE.Mesh(quad, mat);
      mesh.scale.set(size * (0.8 + rand() * 0.6), 1, size);
      mesh.position.set(x, dy, z);
      mesh.rotation.y = yaw;
      group.add(mesh);
    }
  }

  const snap = (v: number): number => normalizeZero(Math.round(v / span) * span);
  const camPos = new THREE.Vector3();

  const follow = (camera: THREE.Camera, origin?: HazeOrigin): void => {
    camera.updateWorldMatrix(true, false);
    camera.getWorldPosition(camPos);
    const ox = origin ? finiteOr(origin[0], 0) : 0;
    const hasY = origin !== undefined && origin.length === 3;
    const oz = origin ? finiteOr(hasY ? origin[2] : origin[1], 0) : 0;
    group.position.x = normalizeZero(snap(camPos.x - ox) + ox);
    group.position.z = normalizeZero(snap(camPos.z - oz) + oz);
    if (hasY) {
      group.position.y = normalizeZero(finiteOr(origin[1], group.position.y));
    }
  };

  const setOpacity = (v: number): void => {
    if (!Number.isFinite(v)) return;
    const next = clamp(v, 0, 1);
    for (let i = 0; i < materials.length; i++) {
      materials[i].opacity = next;
    }
  };

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    group.removeFromParent();
    group.clear();
    quad.dispose();
    for (let i = 0; i < materials.length; i++) materials[i].dispose();
    for (let i = 0; i < textures.length; i++) textures[i].dispose();
  };

  return { group, follow, setOpacity, dispose };
}

export type MaterialPresetName =
  | "matte-plaster"
  | "polished-steel"
  | "brushed-metal"
  | "clear-glass"
  | "frosted-glass"
  | "car-paint"
  | "fabric"
  | "wet-surface"
  | "concrete"
  | "asphalt"
  | "raw-wood"
  | "polished-wood"
  | "ceramic"
  | "matte-plastic"
  | "glossy-plastic"
  | "rubber"
  | "leather"
  | "chrome"
  | "gold"
  | "brass"
  | "rusted-metal"
  | "skin-organic"
  | "wet-organic"
  | "ice"
  | "snow"
  | "foliage"
  | "tinted-glass"
  | "emissive-neon"
  | "emissive-screen";

export const MATERIAL_PRESETS: Readonly<
  Record<MaterialPresetName, Readonly<THREE.MeshPhysicalMaterialParameters>>
> = {
  "matte-plaster": {
    roughness: 0.92,
    diffuseRoughness: 0.85,
    metalness: 0,
  },
  "polished-steel": {
    metalness: 0.96,
    roughness: 0.14,
    clearcoat: 0.2,
  },
  "brushed-metal": {
    metalness: 0.9,
    roughness: 0.34,
    anisotropy: 0.5,
  },
  "clear-glass": {
    transparent: true,
    opacity: 0.32,
    roughness: 0.04,
    metalness: 0,
    ior: 1.5,
    clearcoat: 1,
    depthWrite: false,
  },
  "frosted-glass": {
    transparent: true,
    opacity: 0.55,
    roughness: 0.32,
    ior: 1.5,
    clearcoat: 0.4,
    depthWrite: false,
  },
  "car-paint": {
    metalness: 0.35,
    roughness: 0.28,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  },
  fabric: {
    roughness: 0.92,
    metalness: 0,
    sheen: 0.75,
    sheenColor: "#ffffff",
    sheenRoughness: 0.7,
    diffuseRoughness: 0.5,
  },
  "wet-surface": {
    roughness: 0.25,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  },
  concrete: {
    color: "#8e908f",
    roughness: 0.94,
    diffuseRoughness: 0.9,
    metalness: 0,
  },
  asphalt: {
    color: "#2b2d30",
    roughness: 0.9,
    diffuseRoughness: 0.85,
    metalness: 0,
  },
  "raw-wood": {
    color: "#8c6543",
    roughness: 0.84,
    diffuseRoughness: 0.65,
    metalness: 0,
  },
  "polished-wood": {
    color: "#6e4729",
    roughness: 0.35,
    metalness: 0,
    clearcoat: 0.85,
    clearcoatRoughness: 0.14,
  },
  ceramic: {
    color: "#eceae4",
    roughness: 0.16,
    metalness: 0,
    clearcoat: 0.9,
    clearcoatRoughness: 0.08,
    ior: 1.54,
  },
  "matte-plastic": {
    roughness: 0.58,
    diffuseRoughness: 0.3,
    metalness: 0,
    ior: 1.46,
  },
  "glossy-plastic": {
    roughness: 0.15,
    metalness: 0,
    clearcoat: 0.8,
    clearcoatRoughness: 0.1,
    ior: 1.49,
  },
  rubber: {
    color: "#222326",
    roughness: 0.86,
    diffuseRoughness: 0.55,
    metalness: 0,
    ior: 1.52,
  },
  leather: {
    color: "#4a2e1f",
    roughness: 0.55,
    metalness: 0,
    sheen: 0.3,
    sheenColor: "#8a6852",
    sheenRoughness: 0.65,
    clearcoat: 0.18,
    clearcoatRoughness: 0.4,
  },
  chrome: {
    color: "#e6eaef",
    metalness: 1.0,
    roughness: 0.05,
    clearcoat: 0.15,
  },
  gold: {
    color: "#f5c542",
    metalness: 1.0,
    roughness: 0.16,
  },
  brass: {
    color: "#c9a24b",
    metalness: 0.95,
    roughness: 0.24,
    anisotropy: 0.25,
  },
  "rusted-metal": {
    color: "#7a3b1e",
    metalness: 0.25,
    roughness: 0.88,
    diffuseRoughness: 0.75,
  },
  "skin-organic": {
    color: "#d6a488",
    roughness: 0.54,
    diffuseRoughness: 0.45,
    metalness: 0,
    sheen: 0.25,
    sheenColor: "#f2d2be",
    sheenRoughness: 0.65,
    ior: 1.4,
  },
  "wet-organic": {
    color: "#9c2d2d",
    roughness: 0.32,
    metalness: 0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
    ior: 1.38,
  },
  ice: {
    color: "#c9ecff",
    transparent: true,
    opacity: 0.68,
    roughness: 0.12,
    metalness: 0,
    ior: 1.31,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
    depthWrite: false,
  },
  snow: {
    color: "#f2f6fa",
    roughness: 0.88,
    diffuseRoughness: 0.8,
    metalness: 0,
    sheen: 0.4,
    sheenColor: "#ffffff",
    sheenRoughness: 0.6,
  },
  foliage: {
    color: "#3d6e35",
    roughness: 0.68,
    diffuseRoughness: 0.55,
    metalness: 0,
    sheen: 0.2,
    sheenColor: "#88b86a",
    sheenRoughness: 0.7,
  },
  "tinted-glass": {
    color: "#263845",
    transparent: true,
    opacity: 0.48,
    roughness: 0.06,
    metalness: 0,
    ior: 1.52,
    clearcoat: 1.0,
    depthWrite: false,
  },
  "emissive-neon": {
    color: "#141418",
    emissive: "#00f0ff",
    emissiveIntensity: 3.5,
    roughness: 0.25,
    metalness: 0,
  },
  "emissive-screen": {
    color: "#0b0e14",
    emissive: "#c8e6ff",
    emissiveIntensity: 1.8,
    roughness: 0.14,
    metalness: 0,
    clearcoat: 0.9,
    clearcoatRoughness: 0.06,
  },
};

export const MATERIAL_PRESET_IDS: readonly MaterialPresetName[] = Object.keys(
  MATERIAL_PRESETS,
) as MaterialPresetName[];

export function createPhysicalMaterial(
  preset: MaterialPresetName,
  overrides: THREE.MeshPhysicalMaterialParameters = {},
): THREE.MeshPhysicalMaterial {
  if (!Object.hasOwn(MATERIAL_PRESETS, preset)) {
    throw new Error(
      `Unknown material preset ${JSON.stringify(preset)}; expected ${MATERIAL_PRESET_IDS.join(" | ")}`,
    );
  }
  const base = MATERIAL_PRESETS[preset];
  return new THREE.MeshPhysicalMaterial({ ...base, ...overrides });
}

export type XRayPresetName =
  | "xray-cyan"
  | "xray-amber"
  | "xray-red"
  | "hologram-green"
  | "ghost-shell";

export interface XRayPreset {
  readonly rimColor: string;
  readonly coreColor: string;
  readonly fresnelPower: number;
  readonly intensity: number;
  readonly coreOpacity: number;
  readonly rimOpacity: number;
  readonly pulse: number;
  readonly pulseSpeed: number;
  readonly additive: boolean;
}

export const XRAY_PRESETS: Readonly<Record<XRayPresetName, XRayPreset>> = {
  "xray-cyan": {
    rimColor: "#38e8ff",
    coreColor: "#072840",
    fresnelPower: 2.2,
    intensity: 1.6,
    coreOpacity: 0.1,
    rimOpacity: 0.9,
    pulse: 0.25,
    pulseSpeed: 3.2,
    additive: true,
  },
  "xray-amber": {
    rimColor: "#ffb338",
    coreColor: "#331804",
    fresnelPower: 2.2,
    intensity: 1.6,
    coreOpacity: 0.1,
    rimOpacity: 0.9,
    pulse: 0.25,
    pulseSpeed: 3.0,
    additive: true,
  },
  "xray-red": {
    rimColor: "#ff384c",
    coreColor: "#33050a",
    fresnelPower: 2.0,
    intensity: 1.8,
    coreOpacity: 0.12,
    rimOpacity: 0.95,
    pulse: 0.4,
    pulseSpeed: 4.5,
    additive: true,
  },
  "hologram-green": {
    rimColor: "#38ff9c",
    coreColor: "#052e1a",
    fresnelPower: 1.8,
    intensity: 1.5,
    coreOpacity: 0.12,
    rimOpacity: 0.88,
    pulse: 0.5,
    pulseSpeed: 3.8,
    additive: true,
  },
  "ghost-shell": {
    rimColor: "#d8e8ff",
    coreColor: "#6d88a8",
    fresnelPower: 2.4,
    intensity: 1.0,
    coreOpacity: 0.08,
    rimOpacity: 0.72,
    pulse: 0,
    pulseSpeed: 2.0,
    additive: false,
  },
};

export interface XRayMaterialOptions {
  preset?: XRayPresetName;
  rimColor?: THREE.ColorRepresentation;
  coreColor?: THREE.ColorRepresentation;
  fresnelPower?: number;
  intensity?: number;
  opacity?: number;
  coreOpacity?: number;
  rimOpacity?: number;
  pulse?: number;
  pulseSpeed?: number;
  additive?: boolean;
  doubleSide?: boolean;
  clippingPlanes?: THREE.Plane[];
}

export interface XRayMaterial extends THREE.ShaderMaterial {
  update: (t: number) => void;
  setPulse: (v: number) => void;
}

const XRAY_VERTEX_SHADER = `
  #include <common>
  #include <skinning_pars_vertex>
  #include <clipping_planes_pars_vertex>
  varying vec3 vNormalView;
  varying vec3 vViewPos;
  varying float vWorldY;
  void main() {
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
    vec4 mvPosition = viewMatrix * worldPos;
    vec3 nv = normalMatrix * objectNormal;
    vNormalView = length(nv) > 0.0001 ? normalize(nv) : vec3(0.0, 0.0, 1.0);
    vViewPos = -mvPosition.xyz;
    vWorldY = worldPos.y;
    gl_Position = projectionMatrix * mvPosition;
    #include <clipping_planes_vertex>
  }
`;

const XRAY_FRAGMENT_SHADER = `
  uniform vec3 uRimColor;
  uniform vec3 uCoreColor;
  uniform float uFresnelPower;
  uniform float uIntensity;
  uniform float uOpacity;
  uniform float uCoreOpacity;
  uniform float uRimOpacity;
  uniform float uPulse;
  uniform float uPulseSpeed;
  uniform float uTime;
  varying vec3 vNormalView;
  varying vec3 vViewPos;
  varying float vWorldY;
  #include <clipping_planes_pars_fragment>
  void main() {
    #include <clipping_planes_fragment>
    vec3 viewDir = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPos);
    float ndotv = clamp(abs(dot(normalize(vNormalView), viewDir)), 0.0, 1.0);
    float fresnel = pow(1.0 - ndotv, uFresnelPower);
    float wave = 1.0 + uPulse * 0.35 * sin(uTime * uPulseSpeed + vWorldY * 3.0);
    vec3 col = mix(uCoreColor, uRimColor, fresnel) * uIntensity * wave;
    float alpha = clamp(mix(uCoreOpacity, uRimOpacity, fresnel) * uOpacity, 0.0, 1.0);
    if (alpha < 0.001) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

export function createXRayMaterial(opts: XRayMaterialOptions = {}): XRayMaterial {
  const presetName = opts.preset ?? "xray-cyan";
  if (!Object.hasOwn(XRAY_PRESETS, presetName)) {
    throw new Error(
      `Unknown xray preset ${JSON.stringify(presetName)}; expected ${Object.keys(XRAY_PRESETS).join(" | ")}`,
    );
  }
  const preset = XRAY_PRESETS[presetName];

  const additive = opts.additive ?? preset.additive;
  const material = new THREE.ShaderMaterial({
    name: `xray-${presetName}`,
    uniforms: {
      uRimColor: { value: new THREE.Color(opts.rimColor ?? preset.rimColor) },
      uCoreColor: { value: new THREE.Color(opts.coreColor ?? preset.coreColor) },
      uFresnelPower: { value: positiveOr(opts.fresnelPower, preset.fresnelPower) },
      uIntensity: { value: Math.max(0, finiteOr(opts.intensity, preset.intensity)) },
      uOpacity: { value: clamp(finiteOr(opts.opacity, 1), 0, 1) },
      uCoreOpacity: { value: clamp(finiteOr(opts.coreOpacity, preset.coreOpacity), 0, 1) },
      uRimOpacity: { value: clamp(finiteOr(opts.rimOpacity, preset.rimOpacity), 0, 1) },
      uPulse: { value: clamp(finiteOr(opts.pulse, preset.pulse), 0, 1) },
      uPulseSpeed: { value: Math.max(0, finiteOr(opts.pulseSpeed, preset.pulseSpeed)) },
      uTime: { value: 0 },
    },
    vertexShader: XRAY_VERTEX_SHADER,
    fragmentShader: XRAY_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: opts.doubleSide === false ? THREE.FrontSide : THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    clipping: true,
    clippingPlanes: opts.clippingPlanes ?? [],
  }) as XRayMaterial;

  material.update = (t: number): void => {
    material.uniforms.uTime.value = Number.isFinite(t) ? t : 0;
  };

  material.setPulse = (v: number): void => {
    if (!Number.isFinite(v)) return;
    material.uniforms.uPulse.value = clamp(v, 0, 1);
  };

  return material;
}

export interface VolumetricBeamOptions {
  length?: number;
  topRadius?: number;
  bottomRadius?: number;
  radius?: number;
  color?: THREE.ColorRepresentation;
  intensity?: number;
  opacity?: number;
  attenuation?: number;
  edgePower?: number;
  radialSegments?: number;
}

export interface VolumetricBeamHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  setIntensity: (v: number) => void;
  dispose: () => void;
}

const VOLUMETRIC_BEAM_VERTEX = `
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewPos;
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vViewPos = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const VOLUMETRIC_BEAM_FRAGMENT = `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uOpacity;
  uniform float uAttenuation;
  uniform float uEdgePower;
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewPos;
  void main() {
    vec3 viewDir = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPos);
    float ndotv = clamp(abs(dot(normalize(vNormalView), viewDir)), 0.0, 1.0);
    float edge = pow(ndotv, uEdgePower);
    float tipFade = 1.0 - smoothstep(0.92, 1.0, vUv.y);
    float axial = pow(clamp(vUv.y, 0.0, 1.0), uAttenuation) * tipFade;
    float mask = edge * axial;
    float a = clamp(mask * uOpacity, 0.0, 1.0);
    if (a < 0.001) discard;
    gl_FragColor = vec4(uColor * uIntensity, a);
  }
`;

export function createVolumetricBeam(opts: VolumetricBeamOptions = {}): VolumetricBeamHandle {
  const length = positiveOr(opts.length, 10);
  const topRadius = Math.max(0.01, finiteOr(opts.topRadius, 0.15));
  const bottomRadius = positiveOr(opts.bottomRadius ?? opts.radius, 2.5);
  const radialSegments = Math.max(12, Math.round(positiveOr(opts.radialSegments, 32)));

  const geometry = new THREE.CylinderGeometry(
    topRadius,
    bottomRadius,
    length,
    radialSegments,
    1,
    true,
  );
  geometry.translate(0, -length * 0.5, 0);

  const material = new THREE.ShaderMaterial({
    name: "volumetric-beam",
    uniforms: {
      uColor: { value: new THREE.Color(opts.color ?? "#fff4dc") },
      uIntensity: { value: Math.max(0, finiteOr(opts.intensity, 1.0)) },
      uOpacity: { value: clamp(finiteOr(opts.opacity, 0.35), 0, 1) },
      uAttenuation: { value: positiveOr(opts.attenuation, 1.8) },
      uEdgePower: { value: positiveOr(opts.edgePower, 2.2) },
    },
    vertexShader: VOLUMETRIC_BEAM_VERTEX,
    fragmentShader: VOLUMETRIC_BEAM_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "volumetric-beam";

  const setIntensity = (v: number): void => {
    if (!Number.isFinite(v)) return;
    material.uniforms.uIntensity.value = Math.max(0, v);
  };

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    mesh.removeFromParent();
    geometry.dispose();
    material.dispose();
  };

  return { mesh, material, setIntensity, dispose };
}

export interface CausticsPlaneOptions {
  size?: number | readonly [number, number];
  color?: THREE.ColorRepresentation;
  intensity?: number;
  scale?: number;
  speed?: number;
  sharpness?: number;
  y?: number;
  doubleSide?: boolean;
}

export interface CausticsPlaneHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  update: (t: number) => void;
  setIntensity: (v: number) => void;
  dispose: () => void;
}

const CAUSTICS_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CAUSTICS_FRAGMENT = `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uScale;
  uniform float uSpeed;
  uniform float uSharpness;
  uniform float uTime;
  varying vec2 vUv;
  float waveLayer(vec2 p, float t) {
    float a = sin(p.x * 1.7 + t * 1.1 + sin(p.y * 1.3 - t * 0.8));
    float b = sin(p.y * 1.9 - t * 0.9 + sin(p.x * 1.5 + t * 0.7));
    float c = sin((p.x + p.y) * 1.2 + t * 0.6);
    return 0.5 + 0.5 * (a + b + c) / 3.0;
  }
  void main() {
    float t = uTime * uSpeed;
    vec2 p1 = vUv * uScale + vec2(t * 0.14, t * 0.11);
    vec2 p2 = vUv * (uScale * 1.37) + vec2(-t * 0.12, t * 0.16);
    float w = 1.0 - abs(waveLayer(p1, t) - waveLayer(p2, -t * 0.85));
    float caustic = pow(clamp(w, 0.0, 1.0), uSharpness);
    float r = length(vUv - 0.5) * 2.0;
    float edgeFade = 1.0 - smoothstep(0.7, 1.0, r);
    float level = caustic * edgeFade;
    float a = clamp(level, 0.0, 1.0);
    if (a < 0.001) discard;
    gl_FragColor = vec4(uColor * uIntensity, a);
  }
`;

export function createCausticsPlane(opts: CausticsPlaneOptions = {}): CausticsPlaneHandle {
  const [width, depth] = Array.isArray(opts.size)
    ? [positiveOr(opts.size[0], 40), positiveOr(opts.size[1], 40)]
    : [
        positiveOr(opts.size as number | undefined, 40),
        positiveOr(opts.size as number | undefined, 40),
      ];

  const geometry = new THREE.PlaneGeometry(width, depth);
  const material = new THREE.ShaderMaterial({
    name: "caustics-plane",
    uniforms: {
      uColor: { value: new THREE.Color(opts.color ?? "#7be8ff") },
      uIntensity: { value: Math.max(0, finiteOr(opts.intensity, 0.8)) },
      uScale: { value: positiveOr(opts.scale, 10) },
      uSpeed: { value: Math.max(0, finiteOr(opts.speed, 1.0)) },
      uSharpness: { value: positiveOr(opts.sharpness, 6.0) },
      uTime: { value: 0 },
    },
    vertexShader: CAUSTICS_VERTEX,
    fragmentShader: CAUSTICS_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "caustics-plane";
  mesh.userData.treatAsOpaque = true;
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = finiteOr(opts.y, 0.02);

  const update = (t: number): void => {
    material.uniforms.uTime.value = Number.isFinite(t) ? t : 0;
  };

  const setIntensity = (v: number): void => {
    if (!Number.isFinite(v)) return;
    material.uniforms.uIntensity.value = Math.max(0, v);
  };

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    mesh.removeFromParent();
    geometry.dispose();
    material.dispose();
  };

  return { mesh, material, update, setIntensity, dispose };
}

export type FlamePresetName =
  | "torch"
  | "campfire"
  | "candle"
  | "burner"
  | "thruster"
  | "wildfire";

export interface FlamePreset {
  readonly coreColor: string;
  readonly midColor: string;
  readonly tipColor: string;
  readonly width: number;
  readonly height: number;
  readonly intensity: number;
  readonly speed: number;
  readonly turbulence: number;
}

export const FLAME_PRESETS: Readonly<Record<FlamePresetName, FlamePreset>> = {
  torch: {
    coreColor: "#fff4c8",
    midColor: "#ff8c1a",
    tipColor: "#d9260a",
    width: 0.42,
    height: 0.95,
    intensity: 2.2,
    speed: 3.4,
    turbulence: 0.45,
  },
  campfire: {
    coreColor: "#fff0b8",
    midColor: "#ff7b14",
    tipColor: "#cc1f08",
    width: 1.25,
    height: 1.65,
    intensity: 2.4,
    speed: 2.6,
    turbulence: 0.55,
  },
  candle: {
    coreColor: "#fff8dc",
    midColor: "#ffb038",
    tipColor: "#e65210",
    width: 0.08,
    height: 0.22,
    intensity: 1.8,
    speed: 2.0,
    turbulence: 0.16,
  },
  burner: {
    coreColor: "#eef9ff",
    midColor: "#30a8ff",
    tipColor: "#1448ff",
    width: 0.18,
    height: 0.45,
    intensity: 2.6,
    speed: 5.5,
    turbulence: 0.18,
  },
  thruster: {
    coreColor: "#ffffff",
    midColor: "#52c4ff",
    tipColor: "#ff6e24",
    width: 0.55,
    height: 2.4,
    intensity: 3.8,
    speed: 9.0,
    turbulence: 0.22,
  },
  wildfire: {
    coreColor: "#ffe8a0",
    midColor: "#ff660d",
    tipColor: "#b81406",
    width: 3.2,
    height: 3.8,
    intensity: 2.8,
    speed: 3.0,
    turbulence: 0.72,
  },
};

export interface FlameOptions {
  preset?: FlamePresetName;
  width?: number;
  height?: number;
  coreColor?: THREE.ColorRepresentation;
  midColor?: THREE.ColorRepresentation;
  tipColor?: THREE.ColorRepresentation;
  intensity?: number;
  speed?: number;
  turbulence?: number;
  seed?: number;
}

export interface FlameHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  update: (t: number) => void;
  setIntensity: (v: number) => void;
  dispose: () => void;
}

const FLAME_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FLAME_FRAGMENT = `
  uniform vec3 uCoreColor;
  uniform vec3 uMidColor;
  uniform vec3 uTipColor;
  uniform float uIntensity;
  uniform float uSpeed;
  uniform float uTurbulence;
  uniform float uSeed;
  uniform float uTime;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }
  float fbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      sum += amp * noise(p);
      p = p * 2.03 + vec2(17.1, 31.7);
      amp *= 0.5;
    }
    return sum;
  }
  void main() {
    float t = uTime * uSpeed;
    float y = clamp(vUv.y, 0.0, 1.0);
    float sway = (fbm(vec2(y * 2.8 + uSeed, t * 0.65)) - 0.5) * uTurbulence * y;
    float x = (vUv.x - 0.5) * 2.0 + sway;
    float n = fbm(vec2(vUv.x * 3.6 + uSeed, y * 4.2 - t));
    float taper = mix(1.0, 0.12, pow(y, 1.15));
    float dist = abs(x) / max(taper, 0.05);
    float baseMask = smoothstep(0.0, 0.14, y) * (1.0 - smoothstep(0.25, 1.0, y));
    float tongues = smoothstep(0.22, 0.85, (1.0 - dist) + (n - 0.45) * (0.65 + uTurbulence));
    float shape = clamp(tongues * baseMask, 0.0, 1.0);
    float core = clamp(smoothstep(0.45, 0.92, shape * (1.15 - y * 0.7)), 0.0, 1.0);
    vec3 col = mix(uTipColor, uMidColor, smoothstep(0.08, 0.55, shape));
    col = mix(col, uCoreColor, core);
    float flicker = 0.9 + 0.1 * sin(t * 2.3 + uSeed * 6.2831);
    float a = clamp(shape, 0.0, 1.0);
    if (a < 0.001) discard;
    gl_FragColor = vec4(col * uIntensity * flicker, a);
  }
`;

function buildCrossedFlameGeometry(width: number, height: number): THREE.BufferGeometry {
  const planes = 3;
  const positions = new Float32Array(planes * 4 * 3);
  const uvs = new Float32Array(planes * 4 * 2);
  const indices: number[] = [];
  const halfW = width * 0.5;

  for (let p = 0; p < planes; p++) {
    const angle = (p * Math.PI) / planes;
    const cx = Math.cos(angle) * halfW;
    const cz = Math.sin(angle) * halfW;
    const vBase = p * 4;
    const pOff = vBase * 3;
    const uOff = vBase * 2;

    positions[pOff] = -cx;
    positions[pOff + 1] = 0;
    positions[pOff + 2] = -cz;
    positions[pOff + 3] = cx;
    positions[pOff + 4] = 0;
    positions[pOff + 5] = cz;
    positions[pOff + 6] = cx;
    positions[pOff + 7] = height;
    positions[pOff + 8] = cz;
    positions[pOff + 9] = -cx;
    positions[pOff + 10] = height;
    positions[pOff + 11] = -cz;

    uvs[uOff] = 0;
    uvs[uOff + 1] = 0;
    uvs[uOff + 2] = 1;
    uvs[uOff + 3] = 0;
    uvs[uOff + 4] = 1;
    uvs[uOff + 5] = 1;
    uvs[uOff + 6] = 0;
    uvs[uOff + 7] = 1;

    indices.push(vBase, vBase + 1, vBase + 2, vBase, vBase + 2, vBase + 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

export function createFlame(opts: FlameOptions = {}): FlameHandle {
  const presetName = opts.preset ?? "torch";
  if (!Object.hasOwn(FLAME_PRESETS, presetName)) {
    throw new Error(
      `Unknown flame preset ${JSON.stringify(presetName)}; expected ${Object.keys(FLAME_PRESETS).join(" | ")}`,
    );
  }
  const preset = FLAME_PRESETS[presetName];

  const width = positiveOr(opts.width, preset.width);
  const height = positiveOr(opts.height, preset.height);
  const geometry = buildCrossedFlameGeometry(width, height);

  const material = new THREE.ShaderMaterial({
    name: `flame-${presetName}`,
    uniforms: {
      uCoreColor: { value: new THREE.Color(opts.coreColor ?? preset.coreColor) },
      uMidColor: { value: new THREE.Color(opts.midColor ?? preset.midColor) },
      uTipColor: { value: new THREE.Color(opts.tipColor ?? preset.tipColor) },
      uIntensity: { value: Math.max(0, finiteOr(opts.intensity, preset.intensity)) },
      uSpeed: { value: Math.max(0, finiteOr(opts.speed, preset.speed)) },
      uTurbulence: { value: Math.max(0, finiteOr(opts.turbulence, preset.turbulence)) },
      uSeed: { value: finiteOr(opts.seed, 1.37) },
      uTime: { value: 0 },
    },
    vertexShader: FLAME_VERTEX,
    fragmentShader: FLAME_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `flame-${presetName}`;

  const update = (t: number): void => {
    material.uniforms.uTime.value = Number.isFinite(t) ? t : 0;
  };

  const setIntensity = (v: number): void => {
    if (!Number.isFinite(v)) return;
    material.uniforms.uIntensity.value = Math.max(0, v);
  };

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    mesh.removeFromParent();
    geometry.dispose();
    material.dispose();
  };

  return { mesh, material, update, setIntensity, dispose };
}
