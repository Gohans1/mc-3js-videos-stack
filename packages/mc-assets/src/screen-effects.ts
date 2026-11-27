import type { AssetsInput } from "block-model-renderer";
import * as THREE from "three";

import { animatedTexture, loadBmr, type ModelRendererApi, texture } from "./model";
import type { Vec3 } from "./particles";
import type { SkyState } from "./sky";

export const FLUID_FOV_SCALE = 0.85714287;

export const hudFov = (inFluid: boolean) => 70 * (inFluid ? FLUID_FOV_SCALE : 1);

const DEG = 180 / Math.PI;
const forward = new THREE.Vector3();

export function viewAngles(camera: THREE.Camera): { yaw: number; pitch: number } {
  camera.getWorldDirection(forward);
  return {
    yaw: Math.atan2(-forward.x, forward.z) * DEG,
    pitch: Math.asin(Math.max(-1, Math.min(1, -forward.y))) * DEG,
  };
}

export const lightBrightness = (level: number, ambient = 0) => {
  const f = Math.min(15, Math.max(0, Math.floor(level))) / 15;
  const g = f / (4 - 3 * f);
  return ambient + g * (1 - ambient);
};

export function waterOverlay(o: {
  light?: number;
  yaw?: number;
  pitch?: number;
  ambient?: number;
}) {
  return {
    brightness: lightBrightness(o.light ?? 15, o.ambient),
    alpha: 0.1,
    u: -(o.yaw ?? 0) / 64,
    v: (o.pitch ?? 0) / 64,
  };
}

type Quad = [Vec3, Vec3, Vec3, Vec3];

export function fireQuads(): [Quad, Quad] {
  const quad = (side: 1 | -1): Quad => {
    const m = new THREE.Matrix4()
      .makeTranslation(0.24 * side, -0.3, 0)
      .multiply(new THREE.Matrix4().makeRotationY(-0.17453292 * side));
    const corners: [number, number][] = [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ];
    return corners.map(([x, y]) => {
      const p = new THREE.Vector3(x, y, -0.5).applyMatrix4(m);
      return [p.x, p.y, p.z] as Vec3;
    }) as Quad;
  };
  return [quad(1), quad(-1)];
}

const NEAREST_OVERLAY = 0.4;

export function placeOnCamera(group: THREE.Object3D, camera: THREE.PerspectiveCamera, fov: number) {
  const half = (deg: number) => Math.tan((deg * Math.PI) / 360);
  const k = half(camera.getEffectiveFOV()) / half(fov);
  const s = Math.max(1, (camera.near * 1.5) / NEAREST_OVERLAY);
  group.position.set(0, 0, 0);
  group.quaternion.identity();
  group.scale.set(k * s, k * s, s);
}

export interface ScreenEffectState {
  underwater?: boolean | { light?: number; yaw?: number; pitch?: number };
  inLava?: boolean;
  onFire?: boolean;
}

export interface ScreenEffectsOptions {
  sky?: { state: Pick<SkyState, "skyLightLevel"> };
  renderer?: ModelRendererApi;
  name?: string;
}

export interface ScreenEffects {
  group: THREE.Group;
  update: (t: number, camera: THREE.PerspectiveCamera, state: ScreenEffectState) => void;
  dispose: () => void;
}

const overlayMaterial = (map: THREE.Texture) =>
  new THREE.MeshBasicMaterial({
    map,
    vertexColors: true,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });

const quadGeometry = (corners: readonly Vec3[]) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(corners.flat()), 3));
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(8), 2));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(16), 4));
  g.setIndex([0, 1, 2, 2, 3, 0]);
  return g;
};

const setQuad = (
  g: THREE.BufferGeometry,
  [u0, v0, u1, v1]: [number, number, number, number],
  rgba: [number, number, number, number],
) => {
  (g.attributes.uv!.array as Float32Array).set([u0, v0, u1, v0, u1, v1, u0, v1]);
  const color = g.attributes.color!.array as Float32Array;
  for (let i = 0; i < 4; i++) color.set(rgba, i * 4);
  g.attributes.uv!.needsUpdate = true;
  g.attributes.color!.needsUpdate = true;
};

const pixelTexture = (t: THREE.Texture) => {
  Object.assign(t, {
    flipY: false,
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestFilter,
    generateMipmaps: false,
    anisotropy: 1,
  });
  t.needsUpdate = true;
  return t;
};

export async function createScreenEffects(
  sources: AssetsInput,
  opts: ScreenEffectsOptions = {},
): Promise<ScreenEffects> {
  const bmr = opts.renderer ?? (await loadBmr());
  const [underwater, fire] = await Promise.all([
    texture(sources, "misc/underwater", { renderer: bmr }),
    animatedTexture(sources, "block/fire_1", { renderer: bmr }),
  ]);
  pixelTexture(underwater);
  for (const f of fire.frames) pixelTexture(f);

  const group = new THREE.Group();
  group.name = opts.name ?? "minecraft-screen-effects";
  const add = (
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.MeshBasicMaterial,
    order: number,
  ) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1e6 + order;
    mesh.visible = false;
    group.add(mesh);
    return mesh;
  };
  const water = add(
    "underwater",
    quadGeometry([
      [-1, -1, -0.5],
      [1, -1, -0.5],
      [1, 1, -0.5],
      [-1, 1, -0.5],
    ]),
    overlayMaterial(underwater),
    0,
  );
  const fireMaterial = overlayMaterial(fire.frames[0]!);
  const flames = fireQuads().map((q, i) => {
    const mesh = add(`fire-${i}`, quadGeometry(q), fireMaterial, 1 + i);
    setQuad(mesh.geometry, [1, 1, 0, 0], [1, 1, 1, 229 / 255]);
    return mesh;
  });
  const lit = new THREE.Color();

  return {
    group,
    update(t, camera, state) {
      const inFluid = Boolean(state.underwater) || state.inLava === true;
      placeOnCamera(group, camera, hudFov(inFluid));
      water.visible = Boolean(state.underwater);
      if (water.visible) {
        const given = typeof state.underwater === "object" ? state.underwater : {};
        const angles = viewAngles(camera);
        const o = waterOverlay({
          light: given.light ?? opts.sky?.state.skyLightLevel ?? 15,
          yaw: given.yaw ?? angles.yaw,
          pitch: given.pitch ?? angles.pitch,
        });
        lit.setRGB(o.brightness, o.brightness, o.brightness, THREE.SRGBColorSpace);
        setQuad(water.geometry, [o.u + 4, o.v + 4, o.u, o.v], [lit.r, lit.g, lit.b, o.alpha]);
      }
      const burning = state.onFire === true || state.inLava === true;
      for (const f of flames) f.visible = burning;
      if (burning) {
        fireMaterial.map = fire.frames[fire.frameAt(t)]!;
      }
    },
    dispose() {
      for (const m of group.children as THREE.Mesh[]) m.geometry.dispose();
      (water.material as THREE.Material).dispose();
      fireMaterial.dispose();
      underwater.dispose();
      fire.dispose();
    },
  };
}
