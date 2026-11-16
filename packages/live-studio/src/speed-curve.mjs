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

// Steffen (1990) monotone cubic Hermite slopes, matching d3-shape curveMonotoneX without pulling d3-shape into boot chunks
const sign = (x) => (x < 0 ? -1 : 1);
const slope3 = (x0, y0, x1, y1, x2, y2) => {
  const h0 = x1 - x0,
    h1 = x2 - x1,
    s0 = (y1 - y0) / (h0 || (h1 < 0 && -0)),
    s1 = (y2 - y1) / (h1 || (h0 < 0 && -0)),
    p = (s0 * h1 + s1 * h0) / (h0 + h1);
  return (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
};
const slope2 = (x0, y0, x1, y1, t) => {
  const h = x1 - x0;
  return h ? (3 * ((y1 - y0) / h) - t) / 2 : t;
};

export const smoothSpeedCurve = (curve) => {
  const out = [],
    handles = [];
  let x0 = NaN,
    x1 = NaN,
    y0 = NaN,
    y1 = NaN,
    t0 = NaN,
    point = 0;
  const emitSegment = (s0, s1) => {
    const dx = (x1 - x0) / 3;
    handles.push([y0 + dx * s0, y1 - dx * s1]);
  };
  for (let i = 0; i < curve.length; i++) {
    const x = +curve[i][0],
      y = +curve[i][1];
    if (x === x1 && y === y1) continue;
    out.push([x, y]);
    let t1 = NaN;
    if (point === 0) point = 1;
    else if (point === 1) point = 2;
    else if (point === 2) {
      point = 3;
      t1 = slope3(x0, y0, x1, y1, x, y);
      emitSegment(slope2(x0, y0, x1, y1, t1), t1);
    } else {
      t1 = slope3(x0, y0, x1, y1, x, y);
      emitSegment(t0, t1);
    }
    x0 = x1;
    x1 = x;
    y0 = y1;
    y1 = y;
    t0 = t1;
  }
  if (point === 2) handles.push([lerp(y0, y1, 1 / 3), lerp(y0, y1, 2 / 3)]);
  else if (point === 3) emitSegment(t0, slope2(x0, y0, x1, y1, t0));
  return { curve: out, handles };
};

export const sampleSpeedCurve = (value, u) => {
  const curve = value?.curve;
  if (!curve?.length) return 1;
  if (curve.length === 1 || u <= curve[0][0]) return +curve[0][1];
  const last = curve[curve.length - 1];
  if (u >= last[0]) return +last[1];
  const i = Math.min(
    curve.length - 2,
    Math.max(
      0,
      curve.findLastIndex((p) => p[0] <= u),
    ),
  );
  const a = curve[i][0],
    b = curve[i + 1][0];
  if (b <= a) return +curve[i][1];
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
