// CHECK=probe:<t> or CHECK=probe:<filter>,<t> (heard seconds), built in for every film:
// evaluates draw(t) once (honoring INSPECT= Free Cam when set) and reports world positions, Box3 bounds,
// bone/empty local +Y/+Z axes, camera distances, and normalized [0..1] screen rects to renders/probe_<t>s.json.
import * as THREE from "three";

import { cameraTimesAt, timingClock } from "../src/timing-state.mjs";

export type Vec3Tuple = [number, number, number];

export interface ProbeBounds {
  min: Vec3Tuple;
  max: Vec3Tuple;
  size: Vec3Tuple;
}

export interface ProbeScreen {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  inView: boolean;
  behind?: boolean;
  /** how far the box reaches past each frame edge, in frame widths/heights; only the edges it crosses */
  past?: Partial<Record<"left" | "top" | "right" | "bottom", number>>;
}

export interface ProbeTarget {
  name: string;
  visible: boolean;
  worldPos: Vec3Tuple;
  bounds: ProbeBounds | null;
  axes?: { y: Vec3Tuple; z: Vec3Tuple };
  cameraDist: number;
  screen: ProbeScreen;
}

export interface ProbeReport {
  t: number;
  sceneT: number;
  camera: {
    p: Vec3Tuple;
    l: Vec3Tuple;
    fov: number | null;
    mode: "inspect" | "film";
  };
  targets: ProbeTarget[];
}

export interface ProbeTools {
  scene?: THREE.Scene;
  camera?: THREE.Camera;
  free?: {
    on: boolean;
    p: THREE.Vector3;
    l: THREE.Vector3;
    fov: number;
    [key: string]: unknown;
  };
  look?: THREE.Vector3 | { x: number; y: number; z: number };
  objects?: [THREE.Object3D, string][];
  bones?: Record<string, THREE.Object3D>;
}

type ProbeRender = ((t: number) => void | Promise<void>) & {
  renderFrame?: (t: number) => void | Promise<void>;
  tools?: ProbeTools;
};

interface ProbeConfig {
  inspect?: [number, number, number, number, number, number, number] | null;
}

const round4 = (n: number): number => {
  if (!Number.isFinite(n) || Math.abs(n) < 1e-9) return 0;
  const r = Math.round(n * 1e4) / 1e4;
  return Object.is(r, -0) ? 0 : r;
};

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

const vec3 = (v: { x: number; y: number; z: number }): Vec3Tuple => [
  round4(v.x),
  round4(v.y),
  round4(v.z),
];

const isWorldVisible = (obj: THREE.Object3D): boolean => {
  for (let cur: THREE.Object3D | null = obj; cur; cur = cur.parent) {
    if (!cur.visible) return false;
  }
  return true;
};

export function projectBoundsToScreen(
  box: THREE.Box3 | null,
  worldPos: THREE.Vector3,
  camera: THREE.Camera,
): ProbeScreen {
  const vp = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );

  if (!box || box.isEmpty()) {
    const clip = new THREE.Vector4(worldPos.x, worldPos.y, worldPos.z, 1).applyMatrix4(vp);
    if (clip.w <= 1e-6 || clip.z + clip.w < 0) {
      return { x0: 0, y0: 0, x1: 0, y1: 0, inView: false, behind: true };
    }
    const ndcX = clip.x / clip.w;
    const ndcY = clip.y / clip.w;
    const ndcZ = clip.z / clip.w;
    const sx = (ndcX + 1) / 2;
    const sy = (1 - ndcY) / 2;
    const inView = sx >= 0 && sx <= 1 && sy >= 0 && sy <= 1 && ndcZ >= -1 && ndcZ <= 1;
    const cx = round4(clamp01(sx));
    const cy = round4(clamp01(sy));
    return { x0: cx, y0: cy, x1: cx, y1: cy, inView };
  }

  const xs = [box.min.x, box.max.x];
  const ys = [box.min.y, box.max.y];
  const zs = [box.min.z, box.max.z];
  const clips: THREE.Vector4[] = [];
  for (let i = 0; i < 8; i++) {
    clips.push(
      new THREE.Vector4(xs[i & 1], ys[(i >> 1) & 1], zs[(i >> 2) & 1], 1).applyMatrix4(vp),
    );
  }

  // Keep corners on/in front of the near plane (z + w >= 0) and clip straddling AABB edges against it
  // so corners behind the camera never invert sign after perspective divide.
  const front: THREE.Vector4[] = [];
  for (const c of clips) {
    if (c.w > 1e-6 && c.z + c.w >= 0) front.push(c);
  }
  for (let a = 0; a < 8; a++) {
    for (const bit of [1, 2, 4]) {
      if ((a & bit) !== 0) continue;
      const b = a | bit;
      const ca = clips[a];
      const cb = clips[b];
      const da = ca.z + ca.w;
      const db = cb.z + cb.w;
      if (da >= 0 !== db >= 0) {
        const alpha = da / (da - db);
        const inter = new THREE.Vector4().lerpVectors(ca, cb, alpha);
        if (inter.w > 1e-6) front.push(inter);
      }
    }
  }

  if (!front.length) {
    return { x0: 0, y0: 0, x1: 0, y1: 0, inView: false, behind: true };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  for (const c of front) {
    const sx = (c.x / c.w + 1) / 2;
    const sy = (1 - c.y / c.w) / 2;
    const ndcZ = c.z / c.w;
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
    if (ndcZ < minZ) minZ = ndcZ;
  }

  const inView = maxX >= 0 && minX <= 1 && maxY >= 0 && minY <= 1 && minZ <= 1;
  const past: NonNullable<ProbeScreen["past"]> = {};
  // a box the near plane cuts (a room around the camera) reaches past every edge without bound: nothing to say
  if (inView && clips.every((c) => c.w > 1e-6 && c.z + c.w >= 0)) {
    if (minY < 0) past.top = round4(-minY);
    if (maxX > 1) past.right = round4(maxX - 1);
    if (maxY > 1) past.bottom = round4(maxY - 1);
    if (minX < 0) past.left = round4(-minX);
  }
  return {
    x0: round4(clamp01(minX)),
    y0: round4(clamp01(minY)),
    x1: round4(clamp01(maxX)),
    y1: round4(clamp01(maxY)),
    inView,
    ...(Object.keys(past).length ? { past } : {}),
  };
}

export function collectProbeTargets(
  tools: ProbeTools,
  filter = "",
): { obj: THREE.Object3D; name: string }[] {
  const objectLabels = new Map<THREE.Object3D, string>();
  for (const [obj, label] of tools.objects ?? []) {
    if (obj && !objectLabels.has(obj)) objectLabels.set(obj, label);
  }
  const boneNames = new Map<THREE.Object3D, string[]>();
  for (const [key, obj] of Object.entries(tools.bones ?? {})) {
    if (!obj) continue;
    const list = boneNames.get(obj);
    if (list) list.push(key);
    else boneNames.set(obj, [key]);
  }

  const trimmed = filter.trim();
  if (!trimmed) {
    const out: { obj: THREE.Object3D; name: string }[] = [];
    const seen = new Set<THREE.Object3D>();
    for (const [obj, label] of tools.objects ?? []) {
      if (!obj || seen.has(obj)) continue;
      seen.add(obj);
      out.push({ obj, name: label || obj.name || obj.type });
    }
    return out;
  }

  const terms = trimmed
    .split("|")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const wildcard = terms.includes("*");

  const ownIds = (obj: THREE.Object3D): string[] => {
    const ids: string[] = [];
    const label = objectLabels.get(obj);
    if (label) ids.push(label.toLowerCase());
    if (obj.name) ids.push(obj.name.toLowerCase());
    for (const b of boneNames.get(obj) ?? []) ids.push(b.toLowerCase());
    return ids;
  };

  const matchesTerm = (obj: THREE.Object3D, term: string): boolean => {
    const ids = ownIds(obj);
    if (!ids.length) return false;
    if (ids.some((id) => id.includes(term))) return true;
    if (!term.includes(".")) return false;
    const segs = term.split(".");
    if (segs.some((s) => !s)) return false;
    const leafSeg = segs[segs.length - 1];
    if (!ids.some((id) => id.includes(leafSeg))) return false;
    const ancestors: string[][] = [];
    for (let p = obj.parent; p; p = p.parent) {
      const pIds = ownIds(p);
      if (pIds.length) ancestors.push(pIds);
    }
    ancestors.reverse();
    let ai = 0;
    for (let si = 0; si < segs.length - 1; si++) {
      const want = segs[si];
      while (ai < ancestors.length && !ancestors[ai].some((id) => id.includes(want))) ai++;
      if (ai >= ancestors.length) return false;
      ai++;
    }
    return true;
  };

  const ordered: THREE.Object3D[] = [];
  const seen = new Set<THREE.Object3D>();
  const add = (obj: THREE.Object3D | undefined) => {
    if (!obj || seen.has(obj)) return;
    seen.add(obj);
    ordered.push(obj);
  };
  for (const [obj] of tools.objects ?? []) add(obj);
  for (const obj of Object.values(tools.bones ?? {})) add(obj);
  tools.scene?.traverse((obj) => {
    if (obj === tools.scene) return;
    if (objectLabels.has(obj) || boneNames.has(obj) || obj.name) add(obj);
  });

  const out: { obj: THREE.Object3D; name: string }[] = [];
  for (const obj of ordered) {
    const isCamera = Boolean((obj as THREE.Camera).isCamera);
    const matched = wildcard
      ? !isCamera || objectLabels.has(obj)
      : terms.some((term) => matchesTerm(obj, term));
    if (!matched) continue;
    const name = objectLabels.get(obj) ?? (obj.name || boneNames.get(obj)?.[0] || obj.type);
    out.push({ obj, name });
  }

  // Disambiguate colliding base names (e.g. two actors both exposing a "Head" bone)
  const countNames = (list: { name: string }[]) => {
    const map = new Map<string, number>();
    for (const entry of list) map.set(entry.name, (map.get(entry.name) ?? 0) + 1);
    return map;
  };
  const counts = countNames(out);
  if ([...counts.values()].some((c) => c > 1)) {
    const findOwner = (obj: THREE.Object3D): { obj: THREE.Object3D; label: string } | null => {
      for (let p = obj.parent; p; p = p.parent) {
        const label = objectLabels.get(p);
        if (label) return { obj: p, label };
      }
      return null;
    };
    const findNamedParent = (
      obj: THREE.Object3D,
      stopAt: THREE.Object3D | null = null,
    ): string | null => {
      for (let p = obj.parent; p && p !== stopAt; p = p.parent) {
        if (p.name) return p.name;
      }
      return null;
    };
    const baseNames = out.map((entry) => entry.name);
    for (let i = 0; i < out.length; i++) {
      const entry = out[i];
      if ((counts.get(baseNames[i]) ?? 0) <= 1) continue;
      const owner = findOwner(entry.obj);
      if (owner) {
        entry.name = `${owner.label}.${baseNames[i]}`;
        continue;
      }
      const uniqueBone = boneNames.get(entry.obj)?.find((k) => k !== baseNames[i]);
      if (uniqueBone) {
        entry.name = uniqueBone;
        continue;
      }
      const parentName = findNamedParent(entry.obj);
      if (parentName) entry.name = `${parentName}.${baseNames[i]}`;
    }
    const afterCounts = countNames(out);
    if ([...afterCounts.values()].some((c) => c > 1)) {
      for (let i = 0; i < out.length; i++) {
        const entry = out[i];
        if ((afterCounts.get(entry.name) ?? 0) <= 1) continue;
        const uniqueBone = boneNames.get(entry.obj)?.find((k) => k !== baseNames[i]);
        if (uniqueBone) {
          entry.name = uniqueBone;
          continue;
        }
        const owner = findOwner(entry.obj);
        const parentName = findNamedParent(entry.obj, owner?.obj ?? null);
        if (owner && parentName) entry.name = `${owner.label}.${parentName}.${baseNames[i]}`;
      }
    }
  }
  return out;
}

const isFiniteBox = (b: THREE.Box3): boolean =>
  Number.isFinite(b.min.x) &&
  Number.isFinite(b.min.y) &&
  Number.isFinite(b.min.z) &&
  Number.isFinite(b.max.x) &&
  Number.isFinite(b.max.y) &&
  Number.isFinite(b.max.z);

// Compute world AABB over visible descendants while still measuring the root target itself
// (so probing a hidden root reports its bounds with visible: false), recomputing dynamic bounds.
export function computeVisibleBounds(obj: THREE.Object3D): THREE.Box3 {
  obj.updateWorldMatrix(true, true);
  const out = new THREE.Box3();
  const tmp = new THREE.Box3();
  const unionBox = (box: THREE.Box3 | null, matrix: THREE.Matrix4) => {
    if (!box || box.isEmpty()) return;
    tmp.copy(box).applyMatrix4(matrix);
    if (isFiniteBox(tmp)) out.union(tmp);
  };
  const visit = (node: THREE.Object3D) => {
    if ((node as THREE.SkinnedMesh).isSkinnedMesh) {
      const sm = node as THREE.SkinnedMesh;
      if (
        sm.skeleton &&
        sm.geometry?.getAttribute("position") &&
        sm.geometry.getAttribute("skinIndex") &&
        sm.geometry.getAttribute("skinWeight")
      ) {
        sm.updateMatrixWorld(true);
        if (sm.matrixWorld.determinant() !== 0) {
          sm.skeleton.bones.forEach((b) => b.updateWorldMatrix(true, false));
          sm.computeBoundingBox();
          unionBox(sm.boundingBox, sm.matrixWorld);
        }
      }
    } else if ((node as THREE.InstancedMesh).isInstancedMesh) {
      const im = node as THREE.InstancedMesh;
      if (im.count > 0) {
        im.computeBoundingBox();
        unionBox(im.boundingBox, im.matrixWorld);
      }
    } else if ((node as THREE.BatchedMesh).isBatchedMesh) {
      const bm = node as THREE.BatchedMesh;
      bm.computeBoundingBox();
      unionBox(bm.boundingBox, bm.matrixWorld);
    } else if (
      (node as THREE.Mesh).isMesh ||
      (node as THREE.Line).isLine ||
      (node as THREE.Points).isPoints ||
      (node as THREE.Sprite).isSprite
    ) {
      const geom = (node as THREE.Mesh | THREE.Line | THREE.Points | THREE.Sprite).geometry;
      if (geom) {
        if (!geom.boundingBox) geom.computeBoundingBox();
        unionBox(geom.boundingBox, node.matrixWorld);
      }
    }
    for (const child of node.children) {
      if (child.visible) visit(child);
    }
  };
  visit(obj);
  return out;
}

export function measureProbeTarget(
  obj: THREE.Object3D,
  name: string,
  camera: THREE.Camera,
): ProbeTarget {
  const camPos = camera.getWorldPosition(new THREE.Vector3());
  const box = computeVisibleBounds(obj);
  const worldPos = obj.getWorldPosition(new THREE.Vector3());
  const empty = box.isEmpty();
  const bounds: ProbeBounds | null = empty
    ? null
    : {
        min: vec3(box.min),
        max: vec3(box.max),
        size: vec3(box.getSize(new THREE.Vector3())),
      };
  const center = empty ? worldPos : box.getCenter(new THREE.Vector3());
  const isBone = Boolean((obj as THREE.Bone).isBone);
  let axes: { y: Vec3Tuple; z: Vec3Tuple } | undefined;
  if (empty || isBone) {
    const yAxis = new THREE.Vector3().setFromMatrixColumn(obj.matrixWorld, 1);
    if (yAxis.lengthSq() > 0) yAxis.normalize();
    const zAxis = new THREE.Vector3().setFromMatrixColumn(obj.matrixWorld, 2);
    if (zAxis.lengthSq() > 0) zAxis.normalize();
    axes = { y: vec3(yAxis), z: vec3(zAxis) };
  }
  return {
    name,
    visible: isWorldVisible(obj),
    worldPos: vec3(worldPos),
    bounds,
    ...(axes ? { axes } : {}),
    cameraDist: round4(camPos.distanceTo(center)),
    screen: projectBoundsToScreen(empty ? null : box, worldPos, camera),
  };
}

const fmt3 = (v: Vec3Tuple): string => v.map((n) => n.toFixed(2)).join(",");

const formatTargetLine = (item: ProbeTarget): string => {
  const vis = item.visible ? "" : " [hidden]";
  const scr = item.screen.inView
    ? `[${item.screen.x0.toFixed(2)},${item.screen.y0.toFixed(2)}..${item.screen.x1.toFixed(2)},${item.screen.y1.toFixed(2)}]`
    : item.screen.behind
      ? "behind"
      : "offscreen";
  const past = Object.entries(item.screen.past ?? {})
    .map(([edge, by]) => ` past ${edge} ${by.toFixed(2)}`)
    .join("");
  if (item.bounds) {
    return `  ${item.name}${vis} pos=[${fmt3(item.worldPos)}] size=[${fmt3(item.bounds.size)}] dist=${item.cameraDist.toFixed(2)}m screen=${scr}${past}`;
  }
  const axesText = item.axes ? ` +Y=[${fmt3(item.axes.y)}] +Z=[${fmt3(item.axes.z)}]` : "";
  return `  ${item.name}${vis} pos=[${fmt3(item.worldPos)}]${axesText} dist=${item.cameraDist.toFixed(2)}m screen=${scr}${past}`;
};

export const probeCheck =
  (
    render: ProbeRender,
    cfg: ProbeConfig,
    postFn: (url: string, body: string) => Promise<unknown>,
  ) =>
  async (filter = "", t = NaN): Promise<string[]> => {
    if (typeof filter !== "string" || !Number.isFinite(t) || t < 0) {
      return ["ERROR usage: CHECK=probe:<t> or CHECK=probe:<filter>,<t>"];
    }
    const tools = render.tools ?? {};
    if (!tools.scene || !tools.camera) {
      return ["ERROR CHECK=probe requires draw.tools.scene and draw.tools.camera on the film"];
    }
    if (cfg.inspect && !tools.free) {
      return ["ERROR INSPECT requires draw.tools.free on the film"];
    }

    const free = cfg.inspect ? tools.free : null;
    const savedFree = free
      ? {
          scalars: Object.fromEntries(Object.entries(free).filter(([k]) => k !== "p" && k !== "l")),
          p: [free.p.x, free.p.y, free.p.z] as Vec3Tuple,
          l: [free.l.x, free.l.y, free.l.z] as Vec3Tuple,
        }
      : null;

    let report: ProbeReport;
    try {
      if (cfg.inspect && free) {
        const [px, py, pz, lx, ly, lz, fov] = cfg.inspect;
        Object.assign(free, { on: true, fov });
        free.p.set(px, py, pz);
        free.l.set(lx, ly, lz);
      }

      if (render.renderFrame) await render.renderFrame(t);
      else await render(t);

      const camera = tools.camera;
      tools.scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      if (
        "updateProjectionMatrix" in camera &&
        typeof (camera as THREE.PerspectiveCamera).updateProjectionMatrix === "function"
      ) {
        (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
      }

      const camPos = camera.getWorldPosition(new THREE.Vector3());
      const camLook = cfg.inspect
        ? ([round4(cfg.inspect[3]), round4(cfg.inspect[4]), round4(cfg.inspect[5])] as Vec3Tuple)
        : tools.look
          ? vec3(tools.look)
          : vec3(camera.getWorldDirection(new THREE.Vector3()).add(camPos));
      const fov =
        "isPerspectiveCamera" in camera && (camera as THREE.PerspectiveCamera).isPerspectiveCamera
          ? round4((camera as THREE.PerspectiveCamera).fov)
          : null;
      const sceneT = round4(timingClock.duration > 0 ? cameraTimesAt(t).world : t);

      const targets = collectProbeTargets(tools, filter).map(({ obj, name }) =>
        measureProbeTarget(obj, name, camera),
      );
      report = {
        t: round4(t),
        sceneT,
        camera: {
          p: vec3(camPos),
          l: camLook,
          fov,
          mode: cfg.inspect ? "inspect" : "film",
        },
        targets,
      };
    } finally {
      if (free && savedFree) {
        Object.assign(free, savedFree.scalars);
        free.p.set(...savedFree.p);
        free.l.set(...savedFree.l);
      }
    }

    const fileName = `probe_${t}s.json`;
    await postFn(`/still/${fileName}`, JSON.stringify(report, null, 2));

    const header = `probe t=${t}s (scene ${report.sceneT}s) cam=${report.camera.mode} p=[${fmt3(report.camera.p)}] l=[${fmt3(report.camera.l)}] fov=${report.camera.fov ?? "ortho"} (${report.targets.length} target${report.targets.length === 1 ? "" : "s"})`;
    const lines = [header, ...report.targets.map(formatTargetLine)];
    if (!report.targets.length && filter.trim()) {
      const available = (tools.objects ?? []).map(([, label]) => label).join(", ") || "none";
      lines.push(
        `  no targets matched "${filter.trim()}" (draw.tools.objects: ${available}; use * for all named scene nodes)`,
      );
    }
    lines.push(`wrote renders/${fileName}`);
    return lines;
  };
