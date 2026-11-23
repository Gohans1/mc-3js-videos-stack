import * as THREE from "three";

import { S } from "../core/state";

const ray = new THREE.Raycaster();
const BONE_PARTS: [RegExp, string][] = [
  [/Head|Neck/, "head"],
  [/Left.*Hand|LeftHand/, "left hand"],
  [/Right.*Hand|RightHand/, "right hand"],
  [/LeftFoot|LeftToe/, "left foot"],
  [/RightFoot|RightToe/, "right foot"],
  [/LeftForeArm|LeftArm|LeftShoulder/, "left arm"],
  [/RightForeArm|RightArm|RightShoulder/, "right arm"],
  [/LeftUpLeg|LeftLeg/, "left leg"],
  [/RightUpLeg|RightLeg/, "right leg"],
  [/Spine|Hips/, "body"],
];
const shown = (o: THREE.Object3D | null) => {
  for (let c = o; c; c = c.parent) if (!c.visible || c.userData?.noPick === true) return false;
  return true;
};
const materialsOf = (o: THREE.Object3D): THREE.Material[] => {
  const mat = (o as THREE.Mesh).material;
  return Array.isArray(mat) ? mat : mat ? [mat] : [];
};
const firstMaterial = (o: THREE.Object3D) => materialsOf(o)[0];
const materialPickable = (m: THREE.Material | null | undefined) => {
  if (!m) return true;
  if (m.visible === false || m.colorWrite === false) return false;
  if (m.transparent && (m.opacity <= 0 || !m.depthWrite)) return false;
  return true;
};
const hitMaterial = (h: THREE.Intersection) => {
  const mat = (h.object as THREE.Mesh).material;
  if (!Array.isArray(mat)) return mat;
  const idx = h.face?.materialIndex;
  return typeof idx === "number" && idx >= 0 && idx < mat.length ? mat[idx] : mat[0];
};
const hitPickable = (h: THREE.Intersection) => {
  if (!(h.object as THREE.Mesh).isMesh || !shown(h.object)) return false;
  const mat = (h.object as THREE.Mesh).material;
  if (Array.isArray(mat)) {
    if (mat.length === 0) return true;
    const idx = h.face?.materialIndex;
    if (typeof idx === "number" && idx >= 0 && idx < mat.length) return materialPickable(mat[idx]);
    return mat.some(materialPickable);
  }
  return materialPickable(mat);
};
const whatIs = (hit: THREE.Intersection) => {
  const tools = S.tools!;
  let found: [THREE.Object3D, string] | null = null;
  for (let c: THREE.Object3D | null = hit.object; c && !found; c = c.parent)
    found = (tools.objects ?? []).find(([obj]) => obj === c) ?? null;
  if (found && found[0] === tools.rig && tools.bones) {
    let best = "",
      d = 1e9;
    const v = new THREE.Vector3();
    for (const n in tools.bones) {
      const e = tools.bones[n].getWorldPosition(v).distanceToSquared(hit.point);
      if (e < d) {
        d = e;
        best = n;
      }
    }
    const part = BONE_PARTS.find(([re]) => re.test(best))?.[1];
    return part ? `character, ${part}` : "character";
  }
  if (found) return found[1];
  const byMat = (tools.materials ?? []).find(
    ([mat]) => mat === (hitMaterial(hit) ?? firstMaterial(hit.object)),
  );
  if (byMat) return byMat[1];
  const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null;
  if (n && n.y > 0.7) return "top of an object";
  return hit.object.name || "unnamed object";
};
const round3 = (v: number) => +v.toFixed(3) || 0;
export const lookAtClick = (x: number, y: number) => {
  const tools = S.tools!;
  ray.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), tools.camera);
  const hit = ray.intersectObjects(tools.scene.children, true).find(hitPickable);
  if (!hit) return { what: "empty space" };
  return {
    what: whatIs(hit),
    world: hit.point.toArray().map(round3) as [number, number, number],
  };
};
export const lookOnPlane = (x: number, y: number, planeY = 0): [number, number, number] | null => {
  const camera = S.tools?.camera;
  if (!camera) return null;
  ray.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), camera);
  const target = new THREE.Vector3();
  if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY), target))
    return null;
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y) || !Number.isFinite(target.z))
    return null;
  return target.toArray().map(round3) as [number, number, number];
};
