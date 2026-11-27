import type { AssetsInput } from "block-model-renderer";
import * as THREE from "three";

import { BLOCK_HARDNESS, NEEDS_CORRECT_TOOL } from "./block-hardness";
import { assetJson, loadBmr, type ModelRendererApi, texture } from "./model";

export { BLOCK_HARDNESS, NEEDS_CORRECT_TOOL };

type Vec3 = readonly [number, number, number];

const bare = (id: string) => (id.startsWith("minecraft:") ? id.slice(10) : id);

export function blockHardness(id: string): number | undefined {
  return BLOCK_HARDNESS[bare(id)];
}

export type ToolMaterial = "wooden" | "stone" | "copper" | "iron" | "golden" | "diamond" | "netherite";
export type DiggerKind = "pickaxe" | "axe" | "shovel" | "hoe";
export type MiningTool = "hand" | "shears" | `${ToolMaterial}_${DiggerKind | "sword"}`;

export const TOOL_SPEED: Readonly<Record<ToolMaterial, number>> = {
  wooden: 2,
  stone: 4,
  copper: 5,
  iron: 6,
  golden: 12,
  diamond: 8,
  netherite: 9,
};

const INCORRECT_TAG: Record<ToolMaterial, string> = {
  wooden: "incorrect_for_wooden_tool",
  stone: "incorrect_for_stone_tool",
  copper: "incorrect_for_copper_tool",
  iron: "incorrect_for_iron_tool",
  golden: "incorrect_for_gold_tool",
  diamond: "incorrect_for_diamond_tool",
  netherite: "incorrect_for_netherite_tool",
};

const TAG_NAMES = [
  ...(["pickaxe", "axe", "shovel", "hoe"] as const).map((k) => `mineable/${k}`),
  ...Object.values(INCORRECT_TAG),
  "sword_efficient",
  "sword_instantly_mines",
  "shears_extreme_breaking_speed",
  "shears_major_breaking_speed",
  "shears_minor_breaking_speed",
];

export interface MiningTags {
  has: (tag: string, block: string) => boolean;
}

export async function miningTags(
  sources: AssetsInput,
  opts: { renderer?: ModelRendererApi } = {},
): Promise<MiningTags> {
  const bmr = opts.renderer ?? (await loadBmr());
  const cache = new Map<string, Promise<Set<string>>>();
  const load = (name: string): Promise<Set<string>> => {
    let hit = cache.get(name);
    if (!hit) {
      hit = (async () => {
        const json = await assetJson(sources, `data/minecraft/tags/block/${name}.json`, bmr, true);
        const out = new Set<string>();
        for (const raw of (json.values as unknown[] | undefined) ?? []) {
          const v = typeof raw === "string" ? raw : String((raw as { id: string }).id);
          if (v.startsWith("#")) for (const b of await load(bare(v.slice(1)))) out.add(b);
          else out.add(bare(v));
        }
        return out;
      })();
      cache.set(name, hit);
    }
    return hit;
  };
  const sets = new Map(
    await Promise.all(TAG_NAMES.map(async (n) => [n, await load(n)] as const)),
  );
  return { has: (tag, block) => sets.get(tag)?.has(bare(block)) ?? false };
}

interface Rule {
  tag: string;
  speed?: number;
  correct?: boolean;
}

const MAX_FLOAT = 3.4028235e38;

function toolRules(tool: MiningTool): Rule[] {
  if (tool === "hand") return [];
  if (tool === "shears")
    return [
      { tag: "=cobweb", speed: 15, correct: true },
      { tag: "shears_extreme_breaking_speed", speed: 15 },
      { tag: "shears_major_breaking_speed", speed: 5 },
      { tag: "shears_minor_breaking_speed", speed: 2 },
    ];
  const cut = tool.lastIndexOf("_");
  const material = tool.slice(0, cut) as ToolMaterial;
  const kind = tool.slice(cut + 1) as DiggerKind | "sword";
  if (kind === "sword")
    return [
      { tag: "=cobweb", speed: 15, correct: true },
      { tag: "sword_instantly_mines", speed: MAX_FLOAT },
      { tag: "sword_efficient", speed: 1.5 },
    ];
  return [
    { tag: INCORRECT_TAG[material], correct: false },
    { tag: `mineable/${kind}`, speed: TOOL_SPEED[material], correct: true },
  ];
}

export interface MiningOptions {
  tool?: MiningTool;
  efficiency?: number;
  haste?: number;
  miningFatigue?: number;
  underwater?: boolean;
  aquaAffinity?: boolean;
  onGround?: boolean;
  hardness?: number;
  needsCorrectTool?: boolean;
}

const f32 = Math.fround;

export function destroyProgress(block: string, tags: MiningTags, o: MiningOptions = {}): number {
  const id = bare(block);
  const hardness = o.hardness ?? blockHardness(id);
  if (hardness === undefined)
    throw new Error(`no hardness for ${block}; pass { hardness } for blocks outside the game`);
  if (hardness === -1) return 0;
  const rules = toolRules(o.tool ?? "hand");
  const matches = (r: Rule) => (r.tag.startsWith("=") ? r.tag.slice(1) === id : tags.has(r.tag, id));
  let speed = f32(rules.find((r) => r.speed !== undefined && matches(r))?.speed ?? 1);
  if (speed > 1 && o.efficiency) speed = f32(speed + o.efficiency * o.efficiency + 1);
  if (o.haste) speed = f32(speed * f32(1 + f32(o.haste * f32(0.2))));
  if (o.miningFatigue) speed = f32(speed * f32(0.3 ** o.miningFatigue));
  if (o.underwater && !o.aquaAffinity) speed = f32(speed * f32(0.2));
  if (o.onGround === false) speed = f32(speed / 5);
  const correct = rules.find((r) => r.correct !== undefined && matches(r))?.correct ?? false;
  const needsTool = o.needsCorrectTool ?? NEEDS_CORRECT_TOOL.has(id);
  return f32(f32(speed / f32(hardness)) / (!needsTool || correct ? 30 : 100));
}

export const crackStage = (progress: number) => (progress > 0 ? Math.trunc(f32(progress * 10)) : -1);

const MAX_TICKS = 2 ** 20;

export interface BreakPlan {
  perTick: number;
  ticks: number;
  seconds: number;
  progressAt: (tick: number) => number;
  stageAt: (tick: number) => number;
}

export function breakPlan(block: string, tags: MiningTags, o: MiningOptions = {}): BreakPlan {
  const perTick = destroyProgress(block, tags, o);
  const sums = [0];
  let ticks = perTick >= 1 ? 0 : Infinity;
  if (perTick > 0 && perTick < 1)
    while (sums.length <= MAX_TICKS) {
      const last = sums[sums.length - 1]!;
      const next = f32(last + perTick);
      if (next === last) break;
      sums.push(next);
      if (next >= 1) {
        ticks = sums.length - 1;
        break;
      }
    }
  const progressAt = (tick: number) => {
    const k = Math.floor(tick);
    if (k <= 0) return 0;
    if (k >= ticks) return 1;
    return sums[Math.min(k, sums.length - 1)]!;
  };
  return {
    perTick,
    ticks,
    seconds: ticks / 20,
    progressAt,
    stageAt: (tick) => (Math.floor(tick) >= ticks ? -1 : crackStage(progressAt(tick))),
  };
}

const FACES: readonly [Vec3, THREE.Quaternion][] = [
  [[0, -1, 0], new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0))],
  [[0, 1, 0], new THREE.Quaternion()],
  [[0, 0, -1], new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, Math.PI))],
  [[0, 0, 1], new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0))],
  [[-1, 0, 0], new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, Math.PI / 2))],
  [[1, 0, 0], new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, -Math.PI / 2))],
];
const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const scratch = new THREE.Vector3();

export function decalUv(local: Vec3, [nx, ny, nz]: Vec3): [number, number] {
  let face = FACES[2]!;
  let best = 1.4e-45;
  for (const f of FACES) {
    const d = nx * f[0][0] + ny * f[0][1] + nz * f[0][2];
    if (d > best) [best, face] = [d, f];
  }
  scratch
    .set(local[0], local[1], local[2])
    .applyAxisAngle(Y, Math.PI)
    .applyAxisAngle(X, -Math.PI / 2)
    .applyQuaternion(face[1]);
  return [-scratch.x, -scratch.y];
}

export const DESTROY_STAGES = 10;

export interface BlockCrack {
  set: (stage: number) => void;
  dispose: () => void;
}

export interface BlockCracks {
  stages: THREE.Texture[];
  attach: (block: THREE.Object3D, opts?: { origin?: Vec3 }) => BlockCrack;
  dispose: () => void;
}

const crackMaterial = (map: THREE.Texture) =>
  new THREE.ShaderMaterial({
    uniforms: { map: { value: map } },
    vertexShader: `varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: `uniform sampler2D map;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(map, vUv);
  if (c.a < 0.1) discard;
  gl_FragColor = sRGBTransferEOTF(vec4(2.0 * c.rgb, 1.0));
  #include <colorspace_fragment>
}`,
    transparent: true,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -10,
    blending: THREE.CustomBlending,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.ZeroFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.ZeroFactor,
    toneMapped: false,
    fog: false,
  });

export async function createBlockCracks(
  sources: AssetsInput,
  opts: { renderer?: ModelRendererApi } = {},
): Promise<BlockCracks> {
  const bmr = opts.renderer ?? (await loadBmr());
  const stages = await Promise.all(
    Array.from({ length: DESTROY_STAGES }, (_, i) =>
      texture(sources, `block/destroy_stage_${i}`, { renderer: bmr }),
    ),
  );
  for (const t of stages)
    Object.assign(t, {
      colorSpace: THREE.NoColorSpace,
      flipY: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      needsUpdate: true,
    });
  const materials = stages.map(crackMaterial);
  const toBlock = new THREE.Matrix4();
  const normalToBlock = new THREE.Matrix3();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();

  return {
    stages,
    attach(block, attachOpts = {}) {
      const [ox, oy, oz] = attachOpts.origin ?? [0.5, 0.5, 0.5];
      block.updateWorldMatrix(true, true);
      const inverse = block.matrixWorld.clone().invert();
      const meshes: THREE.Mesh[] = [];
      block.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh && !m.userData.crack)
          meshes.push(m);
      });
      const decals = meshes.map((mesh) => {
        toBlock.multiplyMatrices(inverse, mesh.matrixWorld);
        normalToBlock.getNormalMatrix(toBlock);
        const g = mesh.geometry.clone();
        for (const key of Object.keys(g.attributes)) if (key !== "position") g.deleteAttribute(key);
        if (!mesh.geometry.attributes.normal) g.computeVertexNormals();
        const normals = mesh.geometry.attributes.normal ?? g.attributes.normal!;
        const pos = g.attributes.position!;
        const uv = new Float32Array(pos.count * 2);
        for (let i = 0; i < pos.count; i++) {
          p.fromBufferAttribute(pos, i).applyMatrix4(toBlock);
          n.fromBufferAttribute(normals, i).applyMatrix3(normalToBlock).normalize();
          const [u, v] = decalUv([p.x + ox, p.y + oy, p.z + oz], [n.x, n.y, n.z]);
          uv[i * 2] = u;
          uv[i * 2 + 1] = v;
        }
        g.deleteAttribute("normal");
        g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
        const decal = new THREE.Mesh(g, materials[0]);
        decal.name = "crack";
        decal.userData.crack = true;
        decal.visible = false;
        decal.renderOrder = mesh.renderOrder + 1;
        mesh.add(decal);
        return decal;
      });
      return {
        set(stage) {
          const s = Math.trunc(stage);
          for (const d of decals) {
            d.visible = s >= 0 && s < DESTROY_STAGES;
            if (d.visible) d.material = materials[s]!;
          }
        },
        dispose() {
          for (const d of decals) {
            d.removeFromParent();
            d.geometry.dispose();
          }
        },
      };
    },
    dispose() {
      for (const m of materials) m.dispose();
      for (const t of stages) t.dispose();
    },
  };
}
