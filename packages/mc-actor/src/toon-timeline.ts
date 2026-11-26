import { z } from "zod";

import { EXPRESSIONS, isToonFaceName, type ExpressionName, type FeelingName } from "./toon-expressions";
import { blendFace, feel, resolveFace } from "./toon-face";
import { smoothstep } from "./toon-geom";
import type { Face, FaceSpec } from "./toon-types";

export type TimelineFaceName = ExpressionName | FeelingName | `custom/${string}`;

export const isTimelineFaceName = (name: string): name is TimelineFaceName =>
  isToonFaceName(name) || /^custom\/[\w-]+$/.test(name);

const FaceKey = z.strictObject({
  t: z.number().min(0),
  face: z.union([
    z.custom<TimelineFaceName>(
      (value) => typeof value === "string" && isTimelineFaceName(value),
      "Use a stock preset, intensity family, or custom/<name>. Search bun run find --kind face.",
    ),
    z.null(),
  ]),
  k: z.number().min(0).max(1).optional(),
  blend: z.number().min(0).optional(),
});

export type ToonFaceKey = z.infer<typeof FaceKey>;
export const FACE_BLEND = 0.2;
export const FaceTimeline = z.record(z.string().min(1), z.array(FaceKey)).superRefine((tracks, ctx) => {
  for (const [actor, keys] of Object.entries(tracks)) {
    for (let i = 1; i < keys.length; i++) {
      if (keys[i]!.t < keys[i - 1]!.t)
        ctx.addIssue({ code: "custom", path: [actor, i, "t"], message: "Face keys must be in time order." });
    }
  }
});

export function toonFaceAt(
  keys: readonly ToonFaceKey[] | undefined,
  t: number,
  custom: Readonly<Record<string, FaceSpec | Face>> = {},
  onMissing?: (id: string) => void,
): Face | null {
  if (!keys?.length) return null;
  const i = keys.findLastIndex((key) => key.t <= t);
  const current = keys[i];
  if (!current?.face) return null;

  const posed = (key: ToonFaceKey, name: TimelineFaceName) => {
    if (!name.startsWith("custom/"))
      return (key.k ?? 1) === 1 && Object.hasOwn(EXPRESSIONS, name)
        ? resolveFace(name)
        : feel(name, key.k ?? 1);
    const id = name.slice("custom/".length);
    if (!Object.hasOwn(custom, id)) {
      onMissing?.(id);
      return null;
    }
    const face = resolveFace(custom[id]);
    return key.k === undefined || key.k === 1 ? face : blendFace(resolveFace("neutral"), face, key.k);
  };
  const target = posed(current, current.face);
  const previous = keys[i - 1];
  const duration = Math.min(current.blend ?? FACE_BLEND, (keys[i + 1]?.t ?? Infinity) - current.t);
  if (!target || !previous?.face || duration <= 0 || t >= current.t + duration) return target;
  const start = posed(previous, previous.face);
  return start ? blendFace(start, target, smoothstep(0, duration, t - current.t)) : target;
}
