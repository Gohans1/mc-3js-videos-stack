import * as THREE from "three";

export interface TargetRow {
  edit: string;
  path: string[];
}
export type TransformMode = "translate" | "rotate" | "scale";
export interface TargetTransform {
  at: number[];
  rot: number[];
  scale: number;
}
export interface TransformBinding {
  row: TargetRow;
  axes: Partial<Record<TransformMode, [boolean, boolean, boolean]>>;
  read(key: Record<string, unknown>): TargetTransform;
  write(key: Record<string, unknown>, value: TargetTransform): void;
}
export interface SceneTarget {
  id: string;
  title: string;
  objects: THREE.Object3D[];
  rows: TargetRow[];
  transform?: TransformBinding;
}

export const matchesRow = (binding: TargetRow, edit: string, path: string[]) =>
  binding.edit === edit && binding.path.every((p, i) => path[i] === p);

const isVec3 = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x));
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// Auto-wires a 3D gizmo when a scene target omits explicit read/write and its key carries standard `at: [x, y, z]`
// (plus optional `rot: [rx, ry, rz]`, `yaw: number`, `scale: number`), writing back only the fields already present on the key
export const inferTargetTransform = (
  row: TargetRow,
  sampleKey: Record<string, unknown> | undefined,
): TransformBinding | undefined => {
  if (!sampleKey || !isVec3(sampleKey.at)) return undefined;
  const hasRot = isVec3(sampleKey.rot),
    hasYaw = !hasRot && isNum(sampleKey.yaw),
    hasScale = isNum(sampleKey.scale);
  const axes: TransformBinding["axes"] = {
    translate: [true, true, true],
    ...(hasRot ? { rotate: [true, true, true] } : hasYaw ? { rotate: [false, true, false] } : {}),
    ...(hasScale ? { scale: [true, true, true] } : {}),
  };
  return {
    row,
    axes,
    read: (key) => ({
      at: isVec3(key.at) ? [...key.at] : [0, 0, 0],
      rot: isVec3(key.rot) ? [...key.rot] : [0, isNum(key.yaw) ? key.yaw : 0, 0],
      scale: isNum(key.scale) ? key.scale : 1,
    }),
    write: (key, value) => {
      key.at = value.at;
      if (hasRot || isVec3(key.rot)) key.rot = value.rot;
      else if (hasYaw || isNum(key.yaw)) key.yaw = value.rot[1];
      if (hasScale || isNum(key.scale)) key.scale = value.scale;
    },
  };
};

export const targetsForKeys = <T extends { rows: TargetRow[] }>(
  targets: T[],
  picks: { f: number; path: string[] }[],
  files: { edit: string }[],
) =>
  targets.filter((t) =>
    t.rows.some((r) => picks.some((p) => matchesRow(r, files[p.f]?.edit, p.path))),
  );

const shown = (object: THREE.Object3D) => {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
};
const partBox = new THREE.Box3();
// Box3.setFromObject includes hidden variants; selection must bound only what this frame actually draws.
export const boundsOf = (objects: THREE.Object3D[], box = new THREE.Box3()) => {
  box.makeEmpty();
  for (const root of objects) {
    if (!shown(root)) continue;
    root.updateWorldMatrix(true, true);
    root.traverseVisible((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const posed = mesh as THREE.SkinnedMesh;
      if (posed.isSkinnedMesh) {
        posed.computeBoundingBox();
        partBox.copy(posed.boundingBox!);
      } else {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        partBox.copy(mesh.geometry.boundingBox!);
      }
      box.union(partBox.applyMatrix4(mesh.matrixWorld));
    });
  }
  return box;
};

const ray = new THREE.Raycaster(),
  pointer = new THREE.Vector2();
export const hitTarget = <T extends { objects: THREE.Object3D[] }>(
  scene: THREE.Scene,
  camera: THREE.Camera,
  targets: T[],
  x: number,
  y: number,
): T | null => {
  ray.setFromCamera(pointer.set(x * 2 - 1, 1 - y * 2), camera);
  for (const hit of ray.intersectObjects(scene.children, true)) {
    const mesh = hit.object as THREE.Mesh;
    if (!mesh.isMesh || !shown(mesh)) continue;
    const material = Array.isArray(mesh.material)
      ? mesh.material[hit.face?.materialIndex ?? 0]
      : mesh.material;
    if (
      !material?.visible ||
      material.opacity === 0 ||
      (material.transparent && !material.depthWrite)
    )
      continue;
    for (let object: THREE.Object3D | null = mesh; object; object = object.parent) {
      const target = targets.find((t) => t.objects.includes(object!));
      if (target) return target;
    }
    return null;
  }
  return null;
};
