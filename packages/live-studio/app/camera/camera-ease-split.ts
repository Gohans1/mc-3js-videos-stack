import { CAMERA_CHANNELS, type CameraChannel } from "film-stage/camera";

import { type Bezier, type Ease, KNOWN_BEZIERS } from "../core/ease-math";
import type { CamKey } from "./cam";

type Vec2 = [number, number];
const defaultPath: Bezier = [1 / 3, 2 / 15, 2 / 3, 13 / 15];
const defaultOptics: Bezier = [1 / 3, 0, 2 / 3, 1];

const curveOf = (ease: Ease): Bezier | undefined => {
  if (Array.isArray(ease)) return ease;
  if (ease === "smooth") return defaultPath;
  return Object.hasOwn(KNOWN_BEZIERS, ease) ? KNOWN_BEZIERS[ease] : undefined;
};

const lerp = ([ax, ay]: Vec2, [bx, by]: Vec2, t: number): Vec2 => [
  ax + (bx - ax) * t,
  ay + (by - ay) * t,
];

const divide = (ease: Ease, time: number): [Ease, Ease] | null => {
  if (ease === "linear") return [ease, ease];
  const curve = curveOf(ease);
  if (!curve) return null;
  const [x1, y1, x2, y2] = curve;
  if ([y1, y2].some((y) => y < 0 || y > 1)) return null;

  let lo = 0,
    hi = 1;
  for (let n = 0; n < 48; n++) {
    const u = (lo + hi) / 2;
    const v = 1 - u;
    const x = 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u;
    if (x < time) lo = u;
    else hi = u;
  }

  const u = (lo + hi) / 2;
  const a = lerp([0, 0], [x1, y1], u);
  const b = lerp([x1, y1], [x2, y2], u);
  const c = lerp([x2, y2], [1, 1], u);
  const d = lerp(a, b, u);
  const e = lerp(b, c, u);
  const [x, y] = lerp(d, e, u);
  if (!(x > 0 && x < 1 && y > 0 && y < 1)) return null;
  const left: Bezier = [a[0] / x, a[1] / y, d[0] / x, d[1] / y];
  const right: Bezier = [
    (e[0] - x) / (1 - x),
    (e[1] - y) / (1 - y),
    (c[0] - x) / (1 - x),
    (c[1] - y) / (1 - y),
  ];
  if ([left[0], left[2], right[0], right[2]].some((value) => value < 0 || value > 1)) return null;
  return [left, right];
};

export const divideCameraEase = (key: CamKey, time: number) => {
  if (!(time > 0 && time < 1)) return null;
  const base = divide(key.ease ?? defaultPath, time);
  if (!base) return null;
  const left: Partial<Record<CameraChannel, Ease>> = {};
  const right: Partial<Record<CameraChannel, Ease>> = {};
  for (const channel of CAMERA_CHANNELS) {
    const spatial = channel === "position" || channel === "aim";
    const original =
      key.easeChannels?.[channel] ??
      (!spatial && key.ease === undefined ? defaultOptics : undefined);
    if (original === undefined) continue;
    const parts = divide(original, time);
    if (!parts) return null;
    [left[channel], right[channel]] = parts;
  }
  const hasOverrides = Object.keys(left).length > 0;
  return {
    left: { ease: base[0], easeChannels: hasOverrides ? left : undefined },
    right: { ease: base[1], easeChannels: hasOverrides ? right : undefined },
  };
};
