import * as THREE from "three";

export interface TargetRow { edit: string; path: string[] }
export interface SceneTarget { id: string; title: string; objects: THREE.Object3D[]; rows: TargetRow[] }

export const matchesRow = (binding: TargetRow, edit: string, path: string[]) => binding.edit === edit && binding.path.every((p, i) => path[i] === p);

export const targetsForKeys = <T extends { rows: TargetRow[] }>(targets: T[], picks: { f: number; path: string[] }[], files: { edit: string }[]) => targets.filter((t) => t.rows.some((r) => picks.some((p) => matchesRow(r, files[p.f]?.edit, p.path))));

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
      if (posed.isSkinnedMesh) { posed.computeBoundingBox(); partBox.copy(posed.boundingBox!); }
      else { if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox(); partBox.copy(mesh.geometry.boundingBox!); }
      box.union(partBox.applyMatrix4(mesh.matrixWorld));
    });
  }
  return box;
};

const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
export const hitTarget = <T extends { objects: THREE.Object3D[] }>(scene: THREE.Scene, camera: THREE.Camera, targets: T[], x: number, y: number): T | null => {
  ray.setFromCamera(pointer.set(x * 2 - 1, 1 - y * 2), camera);
  for (const hit of ray.intersectObjects(scene.children, true)) {
    const mesh = hit.object as THREE.Mesh;
    if (!mesh.isMesh || !shown(mesh)) continue;
    const material = Array.isArray(mesh.material) ? mesh.material[hit.face?.materialIndex ?? 0] : mesh.material;
    if (!material?.visible || material.opacity === 0 || (material.transparent && !material.depthWrite)) continue;
    for (let object: THREE.Object3D | null = mesh; object; object = object.parent) {
      const target = targets.find((t) => t.objects.includes(object!));
      if (target) return target;
    }
    return null;
  }
  return null;
};
