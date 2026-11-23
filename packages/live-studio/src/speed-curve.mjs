const lerp = (a, b, u) => a + (b - a) * u;
const clampRate = (r) => Math.max(0.1, Math.min(10, r));
const valueAt = ([a, b, c, d], u) =>
  (1 - u) ** 3 * a + 3 * (1 - u) ** 2 * u * b + 3 * (1 - u) * u * u * c + u ** 3 * d;
const slopeAt = ([a, b, c, d], u) =>
  3 * ((1 - u) ** 2 * (b - a) + 2 * (1 - u) * u * (c - b) + u * u * (d - c));

export const hasSpeedCuts = (value) => !!value?.cuts && Object.keys(value.cuts).length > 0;

export const cutRatesAt = (value, index) => {
  const pair = value?.cuts?.[String(index)];
  return Array.isArray(pair) && pair.length === 2 ? pair : null;
};

export const pointInRate = (value, index) => {
  const pair = cutRatesAt(value, index);
  return pair ? +pair[0] : +value.curve[index][1];
};

export const pointOutRate = (value, index) => {
  const pair = cutRatesAt(value, index);
  return pair ? +pair[1] : +value.curve[index][1];
};

const controls = (value, i) => {
  const a = pointOutRate(value, i),
    b = pointInRate(value, i + 1);
  return [a, ...(value.handles?.[i] ?? [lerp(a, b, 1 / 3), lerp(a, b, 2 / 3)]), b];
};

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
  if (curve.length === 1 || u <= curve[0][0]) return pointOutRate(value, 0);
  const last = curve[curve.length - 1];
  if (u >= last[0]) return pointInRate(value, curve.length - 1);
  const i = Math.min(
    curve.length - 2,
    Math.max(
      0,
      curve.findLastIndex((p) => p[0] <= u),
    ),
  );
  const a = curve[i][0],
    b = curve[i + 1][0];
  if (b <= a) return pointOutRate(value, i);
  return valueAt(controls(value, i), Math.max(0, Math.min(1, (u - a) / (b - a))));
};

export const normalizeSpeedCuts = (length, cuts = {}) => {
  const out = {};
  if (!cuts || typeof cuts !== "object" || Array.isArray(cuts) || length < 3) return out;
  for (const [rawKey, pair] of Object.entries(cuts)) {
    const idx = Number(rawKey);
    if (
      !Number.isInteger(idx) ||
      idx <= 0 ||
      idx >= length - 1 ||
      !Array.isArray(pair) ||
      pair.length !== 2
    ) {
      continue;
    }
    const left = +pair[0],
      right = +pair[1];
    if (!Number.isFinite(left) || !Number.isFinite(right)) continue;
    out[String(idx)] = [clampRate(left), clampRate(right)];
  }
  return out;
};

const cutIndices = (cuts) =>
  Object.keys(cuts)
    .map(Number)
    .sort((a, b) => a - b);

export const cropSpeedCurve = (value, from, to) => {
  const curve = [],
    handles = [],
    segStartIdx = [];
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
    segStartIdx.push([i, start, a === left]);
    curve.push([(b - from) / (to - from), end]);
    handles.push([start + (slopeAt(p, u) * (v - u)) / 3, end - (slopeAt(p, v) * (v - u)) / 3]);
  }
  const cuts = {};
  if (hasSpeedCuts(value) && curve.length > 2) {
    for (let k = 1; k < curve.length - 1; k++) {
      const segInfo = segStartIdx[k];
      if (!segInfo?.[2]) continue;
      const origPair = cutRatesAt(value, segInfo[0]);
      if (origPair) {
        const pair = [clampRate(+origPair[0]), clampRate(+origPair[1])];
        cuts[String(k)] = pair;
        curve[k][1] = clampRate((pair[0] + pair[1]) / 2);
      }
    }
  }
  return {
    curve,
    ...(value.handles && { handles }),
    ...(Object.keys(cuts).length && { cuts }),
  };
};

export const buildSpeedCurve = (curve, cuts = {}) => {
  const cleanCurve = curve.map((p) => [+p[0], clampRate(+p[1])]);
  const norm = normalizeSpeedCuts(cleanCurve.length, cuts);
  const indices = cutIndices(norm);
  if (!indices.length) return smoothSpeedCurve(cleanCurve);
  const bounds = [0, ...indices, cleanCurve.length - 1];
  const handles = [];
  for (let b = 0; b < bounds.length - 1; b++) {
    const s = bounds[b],
      e = bounds[b + 1];
    const runPts = cleanCurve.slice(s, e + 1).map((p, offset) => {
      const idx = s + offset;
      const pair = norm[String(idx)];
      if (!pair) return p;
      if (offset === 0) return [p[0], pair[1]];
      if (offset === e - s) return [p[0], pair[0]];
      return p;
    });
    handles.push(...smoothSpeedCurve(runPts).handles);
  }
  return { curve: cleanCurve, handles, cuts: norm };
};

export const remapSpeedCutsOnInsert = (cuts = {}, insertedIndex, nextLength) => {
  const out = {};
  for (const [k, v] of Object.entries(cuts)) {
    const idx = Number(k);
    if (!Number.isInteger(idx)) continue;
    const mapped = idx >= insertedIndex ? idx + 1 : idx;
    out[String(mapped)] = [...v];
  }
  return normalizeSpeedCuts(nextLength, out);
};

export const remapSpeedCutsOnRemove = (cuts = {}, removedIndex, nextLength) => {
  const out = {};
  for (const [k, v] of Object.entries(cuts)) {
    const idx = Number(k);
    if (!Number.isInteger(idx) || idx === removedIndex) continue;
    const mapped = idx > removedIndex ? idx - 1 : idx;
    out[String(mapped)] = [...v];
  }
  return normalizeSpeedCuts(nextLength, out);
};

export const toggleSpeedCut = (value, index, joinSide = "right") => {
  if (index <= 0 || index >= value.curve.length - 1) return value;
  const cuts = normalizeSpeedCuts(value.curve.length, value.cuts);
  const key = String(index);
  const nextCurve = value.curve.map((p) => [+p[0], clampRate(+p[1])]);
  const existing = cuts[key];
  if (existing) {
    nextCurve[index][1] = joinSide === "left" ? existing[0] : existing[1];
    delete cuts[key];
    const rebuilt = buildSpeedCurve(nextCurve, cuts);
    const bounds = [0, ...cutIndices(cuts), nextCurve.length - 1];
    const touched = new Set();
    for (let b = 0; b < bounds.length - 1; b++) {
      if (index > bounds[b] && index < bounds[b + 1]) {
        for (let seg = bounds[b]; seg < bounds[b + 1]; seg++) touched.add(seg);
      }
    }
    const handles = rebuilt.handles.map((h, seg) =>
      touched.has(seg) || !value.handles?.[seg] ? h : [...value.handles[seg]],
    );
    return {
      curve: rebuilt.curve,
      handles,
      ...(Object.keys(cuts).length ? { cuts } : {}),
    };
  }
  const r = clampRate(nextCurve[index][1]);
  const nextCuts = { ...cuts, [key]: [r, r] };
  const handles = value.handles
    ? value.handles.map((h) => [...h])
    : buildSpeedCurve(nextCurve, nextCuts).handles;
  return { curve: nextCurve, handles, cuts: nextCuts };
};

export const moveSpeedPoint = (prev, index, point, side = "both") => {
  const curve = prev.curve.map((p, idx) =>
    idx === index ? [point[0], side === "both" ? clampRate(point[1]) : p[1]] : [...p],
  );
  let cuts = normalizeSpeedCuts(curve.length, prev.cuts);
  const key = String(index);
  const isInterior = index > 0 && index < curve.length - 1;
  if (side !== "both" && isInterior) {
    const baseRate = clampRate(prev.curve[index][1]);
    const pair = cuts[key] ? [...cuts[key]] : [baseRate, baseRate];
    pair[side === "left" ? 0 : 1] = clampRate(point[1]);
    cuts = { ...cuts, [key]: pair };
    curve[index][1] = clampRate((pair[0] + pair[1]) / 2);
  } else if (cuts[key]) {
    const dy = clampRate(point[1]) - prev.curve[index][1];
    cuts = { ...cuts, [key]: [clampRate(cuts[key][0] + dy), clampRate(cuts[key][1] + dy)] };
  }

  const rebuilt = buildSpeedCurve(curve, cuts);
  const indices = cutIndices(cuts);
  if (!prev.handles?.length || !indices.length) return rebuilt;

  const xChanged = Math.abs(point[0] - prev.curve[index][0]) > 1e-9;
  const bounds = [0, ...indices, curve.length - 1];
  const touchedSegs = new Set();
  for (let b = 0; b < bounds.length - 1; b++) {
    const s = bounds[b],
      e = bounds[b + 1];
    if (side === "left" && !xChanged) {
      if (index === e) {
        for (let seg = s; seg < e; seg++) touchedSegs.add(seg);
      }
    } else if (side === "right" && !xChanged) {
      if (index === s) {
        for (let seg = s; seg < e; seg++) touchedSegs.add(seg);
      }
    } else if (index >= s && index <= e) {
      for (let seg = s; seg < e; seg++) touchedSegs.add(seg);
    }
  }
  const handles = rebuilt.handles.map((h, seg) =>
    touchedSegs.has(seg) || !prev.handles[seg] ? h : [...prev.handles[seg]],
  );
  return { curve: rebuilt.curve, handles, ...(Object.keys(cuts).length ? { cuts } : {}) };
};

export const flattenSpeedCurve = (value) => {
  if (!value.handles && !hasSpeedCuts(value)) return value.curve;
  const out = [[value.curve[0][0], pointOutRate(value, 0)]];
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
  for (let i = 0; i < value.curve.length - 1; i++) {
    const x0 = value.curve[i][0],
      start = pointOutRate(value, i),
      last = out[out.length - 1];
    if (!last || last[0] !== x0 || last[1] !== start) out.push([x0, start]);
    append(x0, value.curve[i + 1][0], controls(value, i));
  }
  return out;
};
