import { curveMonotoneX } from "d3-shape";

const lerp = (a, b, u) => a + (b - a) * u;
const valueAt = ([a, b, c, d], u) =>
  (1 - u) ** 3 * a + 3 * (1 - u) ** 2 * u * b + 3 * (1 - u) * u * u * c + u ** 3 * d;
const slopeAt = ([a, b, c, d], u) =>
  3 * ((1 - u) ** 2 * (b - a) + 2 * (1 - u) * u * (c - b) + u * u * (d - c));
const controls = (value, i) => {
  const a = value.curve[i][1],
    b = value.curve[i + 1][1];
  return [a, ...(value.handles?.[i] ?? [lerp(a, b, 1 / 3), lerp(a, b, 2 / 3)]), b];
};

export const smoothSpeedCurve = (curve) => {
  const handles = [];
  let last = curve[0][1];
  const path = curveMonotoneX({
    moveTo: (_x, y) => {
      last = y;
    },
    lineTo: (_x, y) => {
      handles.push([lerp(last, y, 1 / 3), lerp(last, y, 2 / 3)]);
      last = y;
    },
    bezierCurveTo: (_x1, y1, _x2, y2, _x, y) => {
      handles.push([y1, y2]);
      last = y;
    },
    closePath: () => {},
  });
  path.lineStart();
  curve.forEach(([x, y]) => path.point(x, y));
  path.lineEnd();
  return { curve, handles };
};

export const sampleSpeedCurve = (value, u) => {
  const i = Math.min(
    value.curve.length - 2,
    Math.max(
      0,
      value.curve.findLastIndex((p) => p[0] <= u),
    ),
  );
  const a = value.curve[i][0],
    b = value.curve[i + 1][0];
  return valueAt(controls(value, i), Math.max(0, Math.min(1, (u - a) / (b - a))));
};

export const cropSpeedCurve = (value, from, to) => {
  const curve = [],
    handles = [];
  for (let i = 0; i < value.curve.length - 1; i++) {
    const left = value.curve[i][0],
      right = value.curve[i + 1][0],
      a = Math.max(from, left),
      b = Math.min(to, right);
    if (b <= a) continue;
    const p = controls(value, i),
      u = (a - left) / (right - left),
      v = (b - left) / (right - left);
    const start = valueAt(p, u),
      end = valueAt(p, v);
    if (!curve.length) curve.push([0, start]);
    curve.push([(b - from) / (to - from), end]);
    handles.push([start + (slopeAt(p, u) * (v - u)) / 3, end - (slopeAt(p, v) * (v - u)) / 3]);
  }
  return { curve, ...(value.handles && { handles }) };
};

// D3 supplies the monotone tangents. The Bézier convex hull bounds the linear rate error to 1 ppm;
// the same flattened rates drive preview, export and Rubber Band, so their clocks cannot diverge.
export const flattenSpeedCurve = (value) => {
  if (!value.handles) return value.curve;
  const out = [value.curve[0]];
  const append = (a, b, p, depth = 0) => {
    const error = Math.max(
      Math.abs(p[1] - lerp(p[0], p[3], 1 / 3)),
      Math.abs(p[2] - lerp(p[0], p[3], 2 / 3)),
    );
    if (depth >= 18 || error <= Math.min(...p) * 1e-6) {
      out.push([b, p[3]]);
      return;
    }
    const ab = (p[0] + p[1]) / 2,
      bc = (p[1] + p[2]) / 2,
      cd = (p[2] + p[3]) / 2;
    const abc = (ab + bc) / 2,
      bcd = (bc + cd) / 2,
      mid = (abc + bcd) / 2,
      x = (a + b) / 2;
    append(a, x, [p[0], ab, abc, mid], depth + 1);
    append(x, b, [mid, bcd, cd, p[3]], depth + 1);
  };
  for (let i = 0; i < value.curve.length - 1; i++)
    append(value.curve[i][0], value.curve[i + 1][0], controls(value, i));
  return out;
};
