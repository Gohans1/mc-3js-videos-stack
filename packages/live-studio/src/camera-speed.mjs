import { bisector } from "./bisect.mjs";

const segmentAt = bisector((s) => s.to).right;
const RAD_TO_DEG = 180 / Math.PI;
const SENSOR_WIDTH_MM = 36;
const DEFAULT_FOV = 50;
const WIDTH_RULE_SECONDS = 7;
const FAST_FOV_DEG_PER_SEC = 15;
const FOV_POP_DEG = 1.5;
const TURN_POP_DEG = 0.5;
const POS_POP_STEP = 0.25;
const POP_RATIO = 4;

export const cameraSpeed = (clock, from, to, ease, t) => {
  const segment = clock?.segments[segmentAt(clock.segments, t)];
  if (to <= from || (clock && (!segment || segment.kind === "freeze" || segment.blank))) return 0;
  const source = clock ? clock.sourceAt(t) : t;
  if (source < from || source > to) return 0;
  const u = (source - from) / (to - from),
    a = Math.max(0, u - 1e-4),
    b = Math.min(1, u + 1e-4);
  const rate = segment
    ? segment.rate0 +
      ((segment.rate1 - segment.rate0) * (source - segment.sourceFrom)) /
        (segment.sourceTo - segment.sourceFrom)
    : 1;
  return Math.max(0, ((ease(b) - ease(a)) / ((b - a) * (to - from))) * rate);
};

const isVec3 = (v) =>
  Array.isArray(v) &&
  v.length >= 3 &&
  v.slice(0, 3).every((n) => typeof n === "number" && Number.isFinite(n));

const dist3 = (a, b) =>
  isVec3(a) && isVec3(b) ? Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) : 0;

const median = (xs) => {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
};

const lerp = (a, b, u) => a + (b - a) * u;
const lerpVec3 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];

export function viewVectorAngleDeg(p1, l1, p2, l2) {
  if (!isVec3(p1) || !isVec3(l1) || !isVec3(p2) || !isVec3(l2)) return 0;
  const ax = l1[0] - p1[0],
    ay = l1[1] - p1[1],
    az = l1[2] - p1[2];
  const bx = l2[0] - p2[0],
    by = l2[1] - p2[1],
    bz = l2[2] - p2[2];
  const na = Math.hypot(ax, ay, az),
    nb = Math.hypot(bx, by, bz);
  if (na <= 1e-8 || nb <= 1e-8) return 0;
  const dot = (ax * bx + ay * by + az * bz) / (na * nb);
  return Math.acos(Math.max(-1, Math.min(1, dot))) * RAD_TO_DEG;
}

export function resolveKeyFov(keys, idx, aspect = 16 / 9, defaultFov = DEFAULT_FOV) {
  if (!Array.isArray(keys) || !keys.length) return defaultFov;
  const end = Math.max(0, Math.min(idx, keys.length - 1));
  let cur = defaultFov;
  for (let i = 0; i <= end; i++) {
    const k = keys[i];
    if (!k) continue;
    if (typeof k.fov === "number" && Number.isFinite(k.fov)) {
      cur = k.fov;
    } else if (typeof k.mm === "number" && Number.isFinite(k.mm) && k.mm > 0) {
      cur = 2 * Math.atan(SENSOR_WIDTH_MM / 2 / k.mm / aspect) * RAD_TO_DEG;
    }
  }
  return cur;
}

export function attributeCamKeySpan(keys, t, timing = null) {
  if (!Array.isArray(keys) || !keys.length) return null;
  const queryT = timing?.sourceAt ? timing.sourceAt(t) : t;
  if (keys.length === 1 || queryT <= keys[0].t) {
    return {
      span: [0, keys.length > 1 && !keys[1]?.cut ? 1 : 0],
      keyRow: 0,
      t0: keys[0].t,
      t1: keys[keys.length > 1 && !keys[1]?.cut ? 1 : 0].t,
    };
  }
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i],
      b = keys[i + 1];
    if (queryT > b.t + 1e-9) continue;
    if (b.cut) {
      const toA = Math.abs(queryT - a.t),
        toB = Math.abs(b.t - queryT);
      if (toB <= toA) {
        const nextEnd = i + 2 < keys.length && !keys[i + 2]?.cut ? i + 2 : i + 1;
        return { span: [i + 1, nextEnd], keyRow: i + 1, t0: b.t, t1: keys[nextEnd].t };
      }
      return { span: [i, i], keyRow: i, t0: a.t, t1: a.t };
    }
    const keyRow = Math.abs(queryT - a.t) <= Math.abs(b.t - queryT) ? i : i + 1;
    return { span: [i, i + 1], keyRow, t0: a.t, t1: b.t };
  }
  const last = keys.length - 1;
  const prev = !keys[last]?.cut && last > 0 ? last - 1 : last;
  return { span: [prev, last], keyRow: last, t0: keys[prev].t, t1: keys[last].t };
}

function sampleTimelinePoints(keys, { from, to, aspect, defaultFov, sampleRate, evaluator }) {
  const minT = from ?? keys[0].t;
  const maxT = to ?? keys[keys.length - 1].t;
  const samples = [];

  // Build continuous shot slices split at cut:true keys so evaluators like cameraAt never bleed across equal-t cuts.
  const spanSegs = [];
  let segStart = 0;
  for (let i = 0; i < keys.length; i++) {
    if (i > 0 && keys[i].cut) {
      const slice = keys.slice(segStart, i);
      for (let k = segStart; k < i - 1; k++) spanSegs[k] = slice;
      segStart = i;
    }
  }
  const tailSlice = keys.slice(segStart);
  for (let k = segStart; k < keys.length - 1; k++) spanSegs[k] = tailSlice;

  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i],
      b = keys[i + 1];
    if (b.cut) continue;
    const s0 = Math.max(a.t, minT),
      s1 = Math.min(b.t, maxT);
    if (s1 <= s0 + 1e-6) continue;
    const segKeys = spanSegs[i] ?? keys;
    const nextIsEqualCut = Boolean(keys[i + 2]?.cut && Math.abs(keys[i + 2].t - b.t) < 1e-6);
    const f0 = resolveKeyFov(keys, i, aspect, defaultFov);
    const f1 = resolveKeyFov(keys, i + 1, aspect, defaultFov);
    const steps = Math.max(2, Math.ceil((s1 - s0) * sampleRate));
    for (let j = 0; j <= steps; j++) {
      // Avoid duplicating exact boundary samples on the second half unless a cut separates them.
      if (
        j === 0 &&
        samples.length &&
        samples[samples.length - 1].span[1] === i &&
        Math.abs(samples[samples.length - 1].t - s0) < 1e-6
      ) {
        continue;
      }
      const rawT = s0 + ((s1 - s0) * j) / steps;
      const evalT = nextIsEqualCut && j === steps ? Math.max(s0, rawT - 1e-5) : rawT;
      const u = b.t > a.t ? (rawT - a.t) / (b.t - a.t) : 0;
      let p, l, fov;
      if (evaluator) {
        const res = evaluator(evalT, aspect, segKeys);
        p = res.p;
        l = res.l;
        fov = res.fov ?? lerp(f0, f1, u);
      } else {
        p = lerpVec3(a.p, b.p, u);
        l = lerpVec3(a.l, b.l, u);
        fov = lerp(f0, f1, u);
      }
      const span = [i, i + 1];
      const keyRow = Math.abs(rawT - a.t) <= Math.abs(b.t - rawT) ? i : i + 1;
      samples.push({ t: rawT, p, l, fov, span, keyRow, boundaryCut: j === 0 && Boolean(a.cut) });
    }
  }
  return samples;
}

export function analyzeCameraTimeline(keys, opts = {}) {
  const aspect = opts.aspect ?? 16 / 9;
  const defaultFov = opts.defaultFov ?? DEFAULT_FOV;
  const sampleRate = opts.sampleRate ?? 30;
  if (!Array.isArray(keys) || keys.length < 2) {
    const fov0 = resolveKeyFov(keys ?? [], 0, aspect, defaultFov);
    return {
      status: "pass",
      keyCount: keys?.length ?? 0,
      sampleCount: 0,
      range: { from: keys?.[0]?.t ?? 0, to: keys?.[0]?.t ?? 0 },
      posPeak: { v: 0, t: keys?.[0]?.t ?? 0, span: [0, 0], keyRow: 0 },
      turnPeak: { v: 0, t: keys?.[0]?.t ?? 0, widthSeconds: Infinity, span: [0, 0], keyRow: 0 },
      fovPeak: { v: 0, t: keys?.[0]?.t ?? 0, span: [0, 0], keyRow: 0 },
      widthSeconds: Infinity,
      fov: { from: fov0, to: fov0, min: fov0, max: fov0 },
      fastPans: [],
      fastFovs: [],
      pops: [],
      faults: [],
    };
  }

  const samples = sampleTimelinePoints(keys, {
    from: opts.from,
    to: opts.to,
    aspect,
    defaultFov,
    sampleRate,
    evaluator: opts.evaluator,
  });

  if (samples.length < 2) {
    const fov0 = resolveKeyFov(keys, 0, aspect, defaultFov);
    return {
      status: "pass",
      keyCount: keys.length,
      sampleCount: samples.length,
      range: { from: opts.from ?? keys[0].t, to: opts.to ?? keys[keys.length - 1].t },
      posPeak: {
        v: 0,
        t: samples[0]?.t ?? 0,
        span: samples[0]?.span ?? [0, 0],
        keyRow: samples[0]?.keyRow ?? 0,
      },
      turnPeak: {
        v: 0,
        t: samples[0]?.t ?? 0,
        widthSeconds: Infinity,
        span: samples[0]?.span ?? [0, 0],
        keyRow: samples[0]?.keyRow ?? 0,
      },
      fovPeak: {
        v: 0,
        t: samples[0]?.t ?? 0,
        span: samples[0]?.span ?? [0, 0],
        keyRow: samples[0]?.keyRow ?? 0,
      },
      widthSeconds: Infinity,
      fov: { from: fov0, to: fov0, min: fov0, max: fov0 },
      fastPans: [],
      fastFovs: [],
      pops: [],
      faults: [],
    };
  }

  const cuts = opts.cuts ?? [];
  const intervals = [];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1],
      cur = samples[i];
    const dt = cur.t - prev.t;
    const acrossCut =
      dt <= 1e-6 ||
      cur.boundaryCut ||
      prev.span[1] < cur.span[0] ||
      cuts.some((c) => prev.t < c && c <= cur.t);
    if (acrossCut) {
      intervals.push({
        dt: 0,
        posStep: 0,
        posRate: 0,
        turnStep: 0,
        turnRate: 0,
        fovStep: 0,
        fovRate: 0,
        cut: true,
      });
      continue;
    }
    const posStep = dist3(prev.p, cur.p);
    const turnStep = viewVectorAngleDeg(prev.p, prev.l, cur.p, cur.l);
    const fovStep = Math.abs(cur.fov - prev.fov);
    intervals.push({
      dt,
      t: (prev.t + cur.t) / 2,
      span: cur.span,
      keyRow: cur.keyRow,
      fov: (prev.fov + cur.fov) / 2,
      fromFov: prev.fov,
      toFov: cur.fov,
      posStep,
      posRate: posStep / dt,
      turnStep,
      turnRate: turnStep / dt,
      fovStep,
      fovRate: fovStep / dt,
      cut: false,
    });
  }

  const hfovAt = (fov) => 2 * Math.atan(Math.tan(fov / RAD_TO_DEG / 2) * aspect) * RAD_TO_DEG;

  let posPeak = { v: 0, t: samples[0].t, span: samples[0].span, keyRow: samples[0].keyRow };
  let turnPeak = {
    v: 0,
    t: samples[0].t,
    widthSeconds: Infinity,
    span: samples[0].span,
    keyRow: samples[0].keyRow,
  };
  let fovPeak = { v: 0, t: samples[0].t, span: samples[0].span, keyRow: samples[0].keyRow };
  const fastPans = [];
  const fastFovs = [];
  const pops = [];

  for (let i = 0; i < intervals.length; i++) {
    const iv = intervals[i];
    if (iv.cut) continue;
    if (iv.posRate > posPeak.v)
      posPeak = { v: iv.posRate, t: iv.t, span: iv.span, keyRow: iv.keyRow };
    if (iv.turnRate > turnPeak.v) {
      const ws = iv.turnRate > 0 ? hfovAt(iv.fov) / iv.turnRate : Infinity;
      turnPeak = { v: iv.turnRate, t: iv.t, widthSeconds: ws, span: iv.span, keyRow: iv.keyRow };
    }
    if (iv.fovRate > fovPeak.v)
      fovPeak = { v: iv.fovRate, t: iv.t, span: iv.span, keyRow: iv.keyRow };

    const wide = hfovAt(iv.fov);
    const ws = iv.turnRate > 0 ? wide / iv.turnRate : Infinity;
    if (iv.turnRate >= 0.5 && ws < WIDTH_RULE_SECONDS) {
      fastPans.push({
        t: iv.t,
        speed: iv.turnRate,
        widthSeconds: ws,
        span: iv.span,
        keyRow: iv.keyRow,
      });
    }
    if (iv.fovRate > FAST_FOV_DEG_PER_SEC) {
      fastFovs.push({
        t: iv.t,
        rate: iv.fovRate,
        fromFov: iv.fromFov,
        toFov: iv.toFov,
        span: iv.span,
        keyRow: iv.keyRow,
      });
    }

    const neighbors = (field) => {
      const vals = [];
      for (let off = -3; off <= 3; off++) {
        if (!off) continue;
        const n = intervals[i + off];
        if (n && !n.cut) vals.push(n[field]);
      }
      return median(vals);
    };

    const aroundPos = neighbors("posStep");
    if (iv.posStep >= POS_POP_STEP && iv.posStep > POP_RATIO * Math.max(aroundPos, 0.02)) {
      pops.push({
        kind: "pos",
        t: iv.t,
        step: iv.posStep,
        around: aroundPos,
        span: iv.span,
        keyRow: iv.keyRow,
      });
    }
    const aroundTurn = neighbors("turnStep");
    if (iv.turnStep >= TURN_POP_DEG && iv.turnStep > POP_RATIO * Math.max(aroundTurn, 0.05)) {
      pops.push({
        kind: "turn",
        t: iv.t,
        step: iv.turnStep,
        around: aroundTurn,
        span: iv.span,
        keyRow: iv.keyRow,
      });
    }
    const aroundFov = neighbors("fovStep");
    if (iv.fovStep >= FOV_POP_DEG && iv.fovStep > POP_RATIO * Math.max(aroundFov, 0.05)) {
      pops.push({
        kind: "fov",
        t: iv.t,
        step: iv.fovStep,
        around: aroundFov,
        span: iv.span,
        keyRow: iv.keyRow,
      });
    }
  }

  // Collapse per-sample alerts into one representative peak per offending key span so reports stay crisp.
  const dedupeSpan = (items, score) => {
    const bySpan = new Map();
    for (const item of items) {
      const key = item.span.join("->");
      const prev = bySpan.get(key);
      if (!prev || score(item) > score(prev)) bySpan.set(key, item);
    }
    return [...bySpan.values()];
  };

  const panSpans = dedupeSpan(fastPans, (x) => x.speed);
  const fovSpans = dedupeSpan(fastFovs, (x) => x.rate);
  const faults = [];
  for (const p of pops) {
    faults.push(
      `${p.kind} pop at ${p.t.toFixed(2)}s (keys [${p.span[0]}->${p.span[1]}], row ${p.keyRow})`,
    );
  }
  for (const pan of panSpans) {
    faults.push(
      `fast pan ${pan.speed.toFixed(1)} deg/s (width in ${pan.widthSeconds.toFixed(1)}s < ${WIDTH_RULE_SECONDS}s) at ${pan.t.toFixed(2)}s (keys [${pan.span[0]}->${pan.span[1]}], row ${pan.keyRow})`,
    );
  }
  for (const fov of fovSpans) {
    faults.push(
      `fast FOV change ${fov.rate.toFixed(1)} deg/s at ${fov.t.toFixed(2)}s (keys [${fov.span[0]}->${fov.span[1]}], row ${fov.keyRow})`,
    );
  }

  const fovs = samples.map((s) => s.fov);
  const severe =
    pops.length > 0 ||
    (Number.isFinite(turnPeak.widthSeconds) && turnPeak.widthSeconds < 0.7) ||
    fovPeak.v >= 120;
  const status = severe ? "fail" : faults.length ? "warn" : "pass";

  return {
    status,
    keyCount: keys.length,
    sampleCount: samples.length,
    range: { from: samples[0].t, to: samples[samples.length - 1].t },
    posPeak,
    turnPeak,
    fovPeak,
    widthSeconds: turnPeak.widthSeconds,
    fov: {
      from: fovs[0],
      to: fovs[fovs.length - 1],
      min: Math.min(...fovs),
      max: Math.max(...fovs),
    },
    fastPans: panSpans,
    fastFovs: fovSpans,
    pops,
    faults,
  };
}

const posOf = (row) => row?.p ?? row?.at ?? row?.pos ?? row?.position ?? null;

function rotStepDeg(a, b) {
  if (isVec3(a?.p) && isVec3(a?.l) && isVec3(b?.p) && isVec3(b?.l)) {
    return viewVectorAngleDeg(a.p, a.l, b.p, b.l);
  }
  const fields = ["yaw", "pitch", "roll"];
  let maxDelta = 0;
  for (const f of fields) {
    if (typeof a?.[f] === "number" && typeof b?.[f] === "number") {
      let d = Math.abs(b[f] - a[f]);
      if (d > 180) d = 360 - (d % 360);
      if (d > maxDelta) maxDelta = d;
    }
  }
  if (isVec3(a?.rot) && isVec3(b?.rot)) {
    const vr = Math.max(
      Math.abs(b.rot[0] - a.rot[0]),
      Math.abs(b.rot[1] - a.rot[1]),
      Math.abs(b.rot[2] - a.rot[2]),
    );
    if (vr > maxDelta) maxDelta = vr;
  }
  return maxDelta;
}

export function analyzeKeyFileMotion(data, filePath = "", opts = {}) {
  const tracks = [];
  const visit = (node, path) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      const timed = node.every((k) => k && typeof k === "object" && typeof k.t === "number");
      if (timed && node.length >= 2) {
        let peakPos = { v: 0, t: node[0].t, rowFrom: 0, rowTo: 0 };
        let peakRot = { v: 0, t: node[0].t, rowFrom: 0, rowTo: 0 };
        for (let i = 1; i < node.length; i++) {
          const a = node[i - 1],
            b = node[i];
          if (b.cut) continue;
          if (opts.from !== undefined && b.t < opts.from) continue;
          if (opts.to !== undefined && a.t > opts.to) continue;
          const dt = b.t - a.t;
          if (!(dt > 1e-6)) continue;
          const pa = posOf(a),
            pb = posOf(b);
          const pv = pa && pb ? dist3(pa, pb) / dt : 0;
          const rv = rotStepDeg(a, b) / dt;
          if (pv > peakPos.v) peakPos = { v: pv, t: b.t, rowFrom: i - 1, rowTo: i };
          if (rv > peakRot.v) peakRot = { v: rv, t: b.t, rowFrom: i - 1, rowTo: i };
        }
        tracks.push({ path: path || "(root)", keyCount: node.length, peakPos, peakRot });
      }
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      visit(v, path ? `${path}.${k}` : k);
    }
  };
  visit(data, "");
  return { file: filePath, tracks };
}
