import type { Tools } from "film/scene";
import type { Object3D } from "three";

import type { CameraPose, Vec3 } from "../app/sound/spatial";
import { findTarget, pairOf } from "./target";

type TargetTools = Partial<Pick<Tools, "scene" | "camera" | "bones" | "objects" | "targets">>;

const registeredNames = (tools: TargetTools | null | undefined): string[] => [
  ...(tools?.targets ?? []).map((target) => target.id),
  ...(tools?.objects ?? []).map((entry) => pairOf(entry)[1]),
  ...Object.keys(tools?.bones ?? {}),
];

export function sceneSpatialNames(tools: TargetTools | null | undefined): string[] {
  const names = new Set(registeredNames(tools));
  tools?.scene?.traverse?.((object) => {
    if (object.name) names.add(object.name);
  });
  return [...names].filter((name) => name && name.toLowerCase() !== "cam");
}

const spatialObject = (tools: TargetTools, name: string): Object3D | null =>
  tools.targets?.find((target) => target.id === name)?.objects[0] ??
  findTarget(tools, name) ??
  null;

export function sceneSpatialPosition(
  tools: TargetTools | null | undefined,
  name: string,
): Vec3 | null {
  if (!tools || !name || name.toLowerCase() === "cam") return null;
  let object = spatialObject(tools, name);
  if (!object) {
    const matches = [...new Set(registeredNames(tools))].filter(
      (label) => label.toLowerCase() === name.toLowerCase(),
    );
    if (matches.length === 1) object = spatialObject(tools, matches[0]);
  }
  object?.updateWorldMatrix?.(true, false);
  const m = object?.matrixWorld?.elements;
  return m && m.slice(12, 15).every(Number.isFinite) ? [m[12], m[13], m[14]] : null;
}

export function sceneSpatialCamera(tools: TargetTools | null | undefined): CameraPose | null {
  const camera = tools?.camera;
  camera?.updateWorldMatrix?.(true, false);
  const m = camera?.matrixWorld?.elements;
  if (!m || !m.every(Number.isFinite)) return null;
  return {
    p: [m[12], m[13], m[14]],
    l: [m[12] - m[8], m[13] - m[9], m[14] - m[10]],
    up: [m[4], m[5], m[6]],
  };
}
