import { blurPx } from "film-kit/lens";
import * as THREE from "three";

import { type Ratio, sizeOf } from "../src/frame.ts";
import { cameraTimesAt, timingClock } from "../src/timing-state.mjs";
import { pairOf } from "./target.ts";

export type Vec3Tuple = [number, number, number];

export interface ProbeBounds {
  min: Vec3Tuple;
  max: Vec3Tuple;
  size: Vec3Tuple;
  center: Vec3Tuple;
}

export interface ProbeScreen {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  inView: boolean;
  behind?: boolean;
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
  blurPx?: number;
}

export interface ProbeReport {
  t: number;
  sceneT: number;
  camera: {
    p: Vec3Tuple;
    l: Vec3Tuple;
    up?: Vec3Tuple;
    roll?: number;
    fov: number | null;
    mode: "inspect" | "film";
    focus?: { m: number; target: string | null; fstop: number; mm: number };
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
  objects?: ([THREE.Object3D, string] | THREE.Object3D)[];
  bones?: Record<string, THREE.Object3D>;
  optics?: { mm?: number; fstop?: number; focusM?: number; focusTarget?: string };
}

type ProbeRender = ((t: number) => void | Promise<void>) & {
  renderFrame?: (t: number) => void | Promise<void>;
  tools?: ProbeTools;
};

interface ProbeConfig {
  inspect?:
    | [number, number, number, number, number, number, number]
    | [number, number, number, number, number, number, number, number]
    | null;
  ratio?: Ratio;
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
  const objectEntries = (tools.objects ?? []).map(pairOf) as [THREE.Object3D, string][];
  const objectLabels = new Map<THREE.Object3D, string>();
  for (const [obj, label] of objectEntries) {
    if (obj && !objectLabels.has(obj)) objectLabels.set(obj, label);
  }
  const boneNames = new Map<THREE.Object3D, string[]>();
  const addBone = (key: string, obj: THREE.Object3D | undefined) => {
    if (!obj || typeof obj !== "object") return;
    const list = boneNames.get(obj);
    if (list) {
      if (!list.includes(key)) list.push(key);
    } else boneNames.set(obj, [key]);
  };
  for (const [key, obj] of Object.entries(tools.bones ?? {})) addBone(key, obj);
  const indexUserBones = (owner: THREE.Object3D) => {
    const map = owner.userData?.bones;
    if (!map || typeof map !== "object") return;
    for (const [key, bone] of Object.entries(map as Record<string, THREE.Object3D>)) {
      if (bone && typeof bone === "object" && "isObject3D" in bone) addBone(key, bone);
    }
  };
  for (const [obj] of objectEntries) indexUserBones(obj);

  const trimmed = filter.trim();
  if (!trimmed) {
    const out: { obj: THREE.Object3D; name: string }[] = [];
    const seen = new Set<THREE.Object3D>();
    for (const [obj, label] of objectEntries) {
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

  const matchId = (id: string, seg: string, exact: boolean): boolean =>
    exact ? id === seg : id.includes(seg);

  const matchesTerm = (obj: THREE.Object3D, term: string, exact: boolean): boolean => {
    const ids = ownIds(obj);
    if (!ids.length) return false;
    if (ids.some((id) => matchId(id, term, exact))) return true;
    if (!term.includes(".")) return false;
    const segs = term.split(".");
    if (segs.some((s) => !s)) return false;
    const leafSeg = segs[segs.length - 1];
    if (!ids.some((id) => matchId(id, leafSeg, exact))) return false;
    const ancestors: string[][] = [];
    for (let p = obj.parent; p; p = p.parent) {
      const pIds = ownIds(p);
      if (pIds.length) ancestors.push(pIds);
    }
    ancestors.reverse();
    const end = segs.length - 1;
    const matched = new Set([0]);
    for (const ancestor of ancestors) {
      const nextMatches = new Set<number>();
      for (const start of matched) {
        for (let next = start + 1; next <= end; next++) {
          const prefix = segs.slice(start, next).join(".");
          if (
            !ancestor.some((id) =>
              next === start + 1 ? matchId(id, prefix, exact) : id === prefix,
            )
          )
            continue;
          if (next === end) return true;
          nextMatches.add(next);
        }
      }
      for (const next of nextMatches) matched.add(next);
    }
    return false;
  };

  const ordered: THREE.Object3D[] = [];
  const seen = new Set<THREE.Object3D>();
  const add = (obj: THREE.Object3D | undefined) => {
    if (!obj || seen.has(obj)) return;
    seen.add(obj);
    ordered.push(obj);
  };
  for (const [obj] of objectEntries) add(obj);
  for (const obj of boneNames.keys()) add(obj);
  tools.scene?.traverse((obj) => {
    if (obj === tools.scene) return;
    indexUserBones(obj);
    if (objectLabels.has(obj) || boneNames.has(obj) || obj.name) add(obj);
  });
  for (const obj of boneNames.keys()) add(obj);

  const matchedObjs = new Set<THREE.Object3D>();
  if (wildcard) {
    for (const obj of ordered) {
      const isCamera = Boolean((obj as THREE.Camera).isCamera);
      if (!isCamera || objectLabels.has(obj)) matchedObjs.add(obj);
    }
  } else {
    for (const term of terms) {
      const exactHits = ordered.filter((obj) => matchesTerm(obj, term, true));
      const hits = exactHits.length
        ? exactHits
        : ordered.filter((obj) => matchesTerm(obj, term, false));
      for (const obj of hits) matchedObjs.add(obj);
    }
  }

  const out: { obj: THREE.Object3D; name: string }[] = [];
  for (const obj of ordered) {
    if (!matchedObjs.has(obj)) continue;
    const name = objectLabels.get(obj) ?? (obj.name || boneNames.get(obj)?.[0] || obj.type);
    out.push({ obj, name });
  }

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
  const center = empty ? worldPos : box.getCenter(new THREE.Vector3());
  const bounds: ProbeBounds | null = empty
    ? null
    : {
        min: vec3(box.min),
        max: vec3(box.max),
        size: vec3(box.getSize(new THREE.Vector3())),
        center: vec3(center),
      };
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
  const blur = item.blurPx !== undefined ? ` blur ${item.blurPx.toFixed(1)} px` : "";
  if (item.bounds) {
    const [cx, cy, cz] = item.bounds.center;
    const [px, py, pz] = item.worldPos;
    const centerText =
      Math.hypot(cx - px, cy - py, cz - pz) > 0.01 ? ` center=[${fmt3(item.bounds.center)}]` : "";
    return `  ${item.name}${vis} pos=[${fmt3(item.worldPos)}]${centerText} size=[${fmt3(item.bounds.size)}] dist=${item.cameraDist.toFixed(2)}m${blur} screen=${scr}${past}`;
  }
  const axesText = item.axes ? ` +Y=[${fmt3(item.axes.y)}] +Z=[${fmt3(item.axes.z)}]` : "";
  return `  ${item.name}${vis} pos=[${fmt3(item.worldPos)}]${axesText} dist=${item.cameraDist.toFixed(2)}m${blur} screen=${scr}${past}`;
};

export const probeCheck = (
  render: ProbeRender,
  cfg: ProbeConfig,
  postFn: (url: string, body: string) => Promise<unknown>,
) => {
  type SavedEntry = {
    obj: THREE.Object3D;
    baseName: string;
    ownerLabel: string | null;
    parentName: string | null;
    target: ProbeTarget;
  };
  const written = new Map<string, { report: ProbeReport; entries: SavedEntry[] }>();
  return async (filter = "", t = NaN): Promise<string[]> => {
    if (typeof filter !== "string" || !Number.isFinite(t) || t < 0) {
      return ["ERROR usage: --check probe:<t> or --check probe:<filter>,<t>"];
    }
    const tools = render.tools ?? {};
    if (!tools.scene || !tools.camera) {
      return ["ERROR --check probe requires draw.tools.scene and draw.tools.camera on the film"];
    }
    if (cfg.inspect && !tools.free) {
      return ["ERROR --inspect requires draw.tools.free on the film"];
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
    let measuredEntries: SavedEntry[] = [];
    try {
      if (cfg.inspect && free) {
        const [px, py, pz, lx, ly, lz, fov, roll] = cfg.inspect;
        Object.assign(free, { on: true, fov, ...(roll !== undefined ? { roll } : {}) });
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

      const { mm = 0, fstop = 0, focusM = 0, focusTarget } = tools.optics ?? {};
      const focus =
        fstop > 0 && focusM > 0 ? { m: focusM, target: focusTarget ?? null, fstop, mm } : undefined;
      const [width] = sizeOf(cfg.ratio ?? "16:9", 1920);
      const objectLabels = new Map<THREE.Object3D, string>();
      for (const entry of tools.objects ?? []) {
        const [obj, label] = pairOf(entry);
        if (obj && label && !objectLabels.has(obj)) objectLabels.set(obj, label);
      }
      const ownerOf = (obj: THREE.Object3D): { obj: THREE.Object3D; label: string } | null => {
        for (let p = obj.parent; p; p = p.parent) {
          const label = objectLabels.get(p);
          if (label) return { obj: p, label };
        }
        return null;
      };
      const parentNameOf = (obj: THREE.Object3D, stopAt: THREE.Object3D | null): string | null => {
        for (let p = obj.parent; p && p !== stopAt; p = p.parent) {
          if (p.name) return p.name;
        }
        return null;
      };
      measuredEntries = collectProbeTargets(tools, filter).map(({ obj, name }) => {
        const target = measureProbeTarget(obj, name, camera);
        if (focus)
          target.blurPx = round4(
            blurPx({ mm, fstop, focus: focusM, dist: target.cameraDist, width }),
          );
        const owner = ownerOf(obj);
        return {
          obj,
          baseName: name,
          ownerLabel: owner?.label ?? null,
          parentName: parentNameOf(obj, owner?.obj ?? null),
          target,
        };
      });
      const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(
        camera.getWorldQuaternion(new THREE.Quaternion()),
      );
      const camFwd = camera.getWorldDirection(new THREE.Vector3()).normalize();
      const refRight = new THREE.Vector3().crossVectors(camFwd, new THREE.Vector3(0, 1, 0));
      let camRoll = 0;
      if (refRight.lengthSq() >= 1e-8) {
        refRight.normalize();
        const refUp = new THREE.Vector3().crossVectors(refRight, camFwd).normalize();
        camRoll = round4(Math.atan2(-camUp.dot(refRight), camUp.dot(refUp)));
      }
      const targets = measuredEntries.map((e) => e.target);
      report = {
        t: round4(t),
        sceneT,
        camera: {
          p: vec3(camPos),
          l: camLook,
          up: vec3(camUp),
          roll: camRoll,
          fov,
          mode: cfg.inspect ? "inspect" : "film",
          ...(focus && { focus }),
        },
        targets,
      };
    } finally {
      if (free && savedFree) {
        for (const k of Object.keys(free)) {
          if (k !== "p" && k !== "l" && !(k in savedFree.scalars)) delete free[k];
        }
        Object.assign(free, savedFree.scalars);
        free.p.set(...savedFree.p);
        free.l.set(...savedFree.l);
      }
    }

    const fileName = `probe_${t}s.json`;
    const prev = written.get(fileName);
    const sameCamera =
      prev &&
      prev.report.camera.mode === report.camera.mode &&
      prev.report.camera.fov === report.camera.fov &&
      prev.report.camera.roll === report.camera.roll &&
      prev.report.camera.p.every((v, i) => v === report.camera.p[i]) &&
      prev.report.camera.l.every((v, i) => v === report.camera.l[i]) &&
      (prev.report.camera.up ?? []).every((v, i) => v === report.camera.up?.[i]);
    const mergedEntries: SavedEntry[] = sameCamera
      ? [
          ...prev.entries.filter((old) => !measuredEntries.some((cur) => cur.obj === old.obj)),
          ...measuredEntries,
        ]
      : measuredEntries;
    const baseCounts = new Map<string, number>();
    for (const e of mergedEntries) baseCounts.set(e.baseName, (baseCounts.get(e.baseName) ?? 0) + 1);
    const disambiguated = mergedEntries.map((e) => {
      if ((baseCounts.get(e.baseName) ?? 0) <= 1) return { ...e.target, name: e.baseName };
      if (e.ownerLabel && !e.baseName.startsWith(`${e.ownerLabel}.`)) {
        return { ...e.target, name: `${e.ownerLabel}.${e.baseName}` };
      }
      if (e.parentName && !e.baseName.startsWith(`${e.parentName}.`)) {
        return { ...e.target, name: `${e.parentName}.${e.baseName}` };
      }
      return { ...e.target, name: e.baseName };
    });
    const afterCounts = new Map<string, number>();
    for (const item of disambiguated)
      afterCounts.set(item.name, (afterCounts.get(item.name) ?? 0) + 1);
    const savedTargets = disambiguated.map((item, i) => {
      if ((afterCounts.get(item.name) ?? 0) <= 1) return item;
      const e = mergedEntries[i]!;
      if (e.ownerLabel && e.parentName) {
        const prefix = e.baseName.startsWith(`${e.ownerLabel}.`)
          ? e.parentName
          : `${e.ownerLabel}.${e.parentName}`;
        return { ...item, name: `${prefix}.${e.baseName}` };
      }
      return item;
    });
    const savedReport: ProbeReport = { ...report, targets: savedTargets };
    written.set(fileName, { report: savedReport, entries: mergedEntries });
    await postFn(`/still/${fileName}`, JSON.stringify(savedReport, null, 2));

    const savedByObj = new Map<THREE.Object3D, ProbeTarget>();
    for (let i = 0; i < mergedEntries.length; i++) {
      savedByObj.set(mergedEntries[i]!.obj, savedTargets[i]!);
    }
    const displayTargets = measuredEntries.map((e) => savedByObj.get(e.obj) ?? e.target);
    const lens = report.camera.focus;
    const rollStr =
      typeof report.camera.roll === "number" && Math.abs(report.camera.roll) > 1e-4
        ? ` roll=${report.camera.roll.toFixed(3)}`
        : "";
    const header = `probe t=${t}s (scene ${report.sceneT}s) cam=${report.camera.mode} p=[${fmt3(report.camera.p)}] l=[${fmt3(report.camera.l)}] fov=${report.camera.fov ?? "ortho"}${rollStr}${lens ? ` focus ${lens.m.toFixed(2)} m${lens.target ? ` on ${lens.target}` : ""}, f/${lens.fstop}, ${lens.mm} mm` : ""} (${displayTargets.length} target${displayTargets.length === 1 ? "" : "s"})`;
    const lines = [header, ...displayTargets.map(formatTargetLine)];
    if (!report.targets.length && filter.trim()) {
      const available =
        (tools.objects ?? []).map((entry) => pairOf(entry)[1]).join(", ") || "none";
      lines.push(
        `  no targets matched "${filter.trim()}" (draw.tools.objects: ${available}; use * for all named scene nodes)`,
      );
    }
    lines.push(`wrote renders/${fileName}`);
    return lines;
  };
};
