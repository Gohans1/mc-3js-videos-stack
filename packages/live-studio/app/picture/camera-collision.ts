import * as THREE from "three";

import { capsuleHits, raycastSurface, surface } from "../../checks/contact.mjs";
import { S } from "../core/state";

export const EYE_HEIGHT = 1.62;
const RADIUS = 0.14;
const STEP = 0.3;
const DOWN = new THREE.Vector3(0, -1, 0);
export const cameraSurfaces = () => {
  const tools = S.tools;
  if (!tools) return [];
  const out: ReturnType<typeof surface>[] = [];
  tools.scene.updateMatrixWorld(true);
  tools.scene.traverseVisible((object) => {
    if (
      !(object instanceof THREE.Mesh) ||
      object instanceof THREE.SkinnedMesh ||
      !object.geometry.attributes.position
    )
      return;
    for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent)
      if (parent === tools.rig) return;
    const materials = [object.material].flat();
    if (
      !materials.some(
        (material) => material.visible && (!material.transparent || material.opacity >= 0.5),
      )
    )
      return;
    const side = materials.some((m) => m.side === THREE.DoubleSide)
      ? THREE.DoubleSide
      : materials.every((m) => m.side === THREE.BackSide)
        ? THREE.BackSide
        : THREE.FrontSide;
    const add = (matrix: THREE.Matrix4) =>
      out.push(surface(object.geometry, matrix, { side, label: object.name }));
    if (object instanceof THREE.InstancedMesh) {
      const instance = new THREE.Matrix4();
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, instance);
        add(object.matrixWorld.clone().multiply(instance));
      }
    } else add(object.matrixWorld.clone());
  });
  return out;
};
type Surface = ReturnType<typeof surface>;
const capsule = (eye: THREE.Vector3) =>
  new THREE.Line3(
    eye.clone().addScaledVector(DOWN, EYE_HEIGHT - RADIUS),
    eye.clone().addScaledVector(DOWN, RADIUS),
  );
export const floorAt = (
  eye: THREE.Vector3,
  surfaces: Surface[],
  maxDrop = 0.65,
  startAboveFeet = STEP,
) => {
  const from = eye.clone().addScaledVector(DOWN, EYE_HEIGHT - startAboveFeet);
  const hit = raycastSurface(new THREE.Ray(from, DOWN), surfaces, startAboveFeet + maxDrop);
  return hit && hit.normal.y > 0.45 ? hit.point.y + EYE_HEIGHT : null;
};
export const walkPosition = (eye: THREE.Vector3, motion: THREE.Vector3, surfaces: Surface[]) => {
  const wanted = motion.clone().setY(0);
  const parts = Math.max(1, Math.ceil(wanted.length() / (RADIUS / 2)));
  const move = wanted.divideScalar(parts);
  const next = eye.clone();
  const tryWalk = (dx: number, dz: number) => {
    const candidate = next.clone().add(new THREE.Vector3(dx, 0, dz));
    const y = floorAt(candidate, surfaces);
    if (y === null || y - next.y > STEP) return false;
    candidate.y = y;
    if (capsuleHits(capsule(candidate), RADIUS, surfaces)) return false;
    next.copy(candidate);
    return true;
  };
  for (let i = 0; i < parts; i++) {
    if (tryWalk(move.x, move.z)) continue;
    if (move.x) tryWalk(move.x, 0);
    if (move.z) tryWalk(0, move.z);
  }
  return next;
};
