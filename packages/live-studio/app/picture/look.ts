// What lies under a point of the picture, in words a note can carry ("character, left hand", "chair"), and where it is
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
  for (let c = o; c; c = c.parent) if (!c.visible) return false;
  return true;
};
const firstMaterial = (o: THREE.Object3D) => [(o as THREE.Mesh).material].flat()[0];
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
  const byMat = (tools.materials ?? []).find(([mat]) => mat === firstMaterial(hit.object));
  if (byMat) return byMat[1];
  const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null;
  if (n && n.y > 0.7) return "top of an object";
  return hit.object.name || "unnamed object";
};
export const lookAtClick = (x: number, y: number) => {
  const tools = S.tools!;
  ray.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), tools.camera);
  const hit = ray.intersectObjects(tools.scene.children, true).find((h) => {
    if (!(h.object as THREE.Mesh).isMesh || !shown(h.object)) return false;
    const m = firstMaterial(h.object);
    return !(m.transparent && !m.depthWrite);
  });
  if (!hit) return { what: "empty space" };
  return { what: whatIs(hit), world: hit.point.toArray().map((v) => +v.toFixed(3)) };
};
