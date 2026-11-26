import * as THREE from "three";

import type { makePlayer } from "./player";
import { EXPRESSIONS, type ExpressionName, FEELINGS } from "./toon-expressions";
import { clamp, clamp01, cubic, type G, lerp, type P, quad, ribbon, roundRect, smoothstep } from "./toon-geom";
import { MARKS, MOUTHS, SHAPES } from "./toon-shapes";
import type { Brow, CuteRange, Eye, Face, FaceSpec, Layer, Mark, Mouth, SideSpec, ToonStyle } from "./toon-types";

export { EXPRESSION_GROUPS, EXPRESSIONS, FEELINGS, isToonFaceName } from "./toon-expressions";
export type { ExpressionGroup, ExpressionName, FeelingName } from "./toon-expressions";
export { listToonExpressions } from "./toon-catalog";
export type { ToonExpressionEntry, ToonExpressionFilters } from "./toon-catalog";
export { ribbon } from "./toon-geom";
export type * from "./toon-types";

const REST = {
  brow: { y: 0, tilt: 0, curve: 1, x: 0, len: 1, thick: 1 } as Brow,
  eye: { open: 1, low: 0, look: [0, 0], pupil: 1, size: 1, tilt: 0, closed: 1, shine: 0, wet: 0, shape: "eye" } as Eye,
  mouth: {
    x: 0,
    y: 0,
    width: 1,
    curve: 0.3,
    open: 0,
    teeth: 0,
    lower: 0,
    tongue: 0,
    skew: 0,
    round: 0,
    shape: "mouth",
  } as Mouth,
};

const clone = <T>(o: T): T => structuredClone(o);

const check = (part: string, given: object, rest: object) => {
  for (const k of Object.keys(given))
    if (!(k in rest))
      throw new Error(
        `toon face: unknown field "${part}.${k}" (${part} takes ${Object.keys(rest).join(", ")})`,
      );
};

const onSide = (face: Face, side: "L" | "R", spec: SideSpec) => {
  if (spec.brow) {
    check("brow", spec.brow, REST.brow);
    Object.assign(face.brows[side], spec.brow);
  }
  if (spec.eye) {
    check("eye", spec.eye, REST.eye);
    Object.assign(face.eyes[side], clone(spec.eye));
  }
};

const SPEC_KEYS = ["from", "brow", "eye", "mouth", "extras", "L", "R"];

export function resolveFace(spec: string | FaceSpec | Face = {}, depth = 0): Face {
  if (typeof spec === "string") {
    if (!Object.hasOwn(EXPRESSIONS, spec))
      throw new Error(`toon face: no expression "${spec}" (${Object.keys(EXPRESSIONS).join(", ")})`);
    return resolveFace(EXPRESSIONS[spec]!, depth);
  }
  if ("brows" in spec) return clone(spec);
  if (depth > 8) throw new Error(`toon face: "from" chain deeper than 8 (a loop?)`);
  for (const k of Object.keys(spec))
    if (!SPEC_KEYS.includes(k))
      throw new Error(`toon face: unknown field "${k}" (a face takes ${SPEC_KEYS.join(", ")})`);
  const face: Face = spec.from
    ? resolveFace(spec.from, depth + 1)
    : {
        brows: { L: clone(REST.brow), R: clone(REST.brow) },
        eyes: { L: clone(REST.eye), R: clone(REST.eye) },
        mouth: clone(REST.mouth),
        extras: {},
      };
  for (const side of ["L", "R"] as const) onSide(face, side, spec);
  if (spec.L) onSide(face, "L", spec.L);
  if (spec.R) onSide(face, "R", spec.R);
  if (spec.mouth) {
    check("mouth", spec.mouth, REST.mouth);
    Object.assign(face.mouth, spec.mouth);
  }
  if (spec.extras) Object.assign(face.extras, spec.extras);
  return face;
}

type Tree = number | string | Tree[] | { [k: string]: Tree };
const blendTree = (a: Tree, b: Tree, k: number): Tree => {
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * k;
  if (Array.isArray(a) && Array.isArray(b)) return a.map((x, i) => blendTree(x, b[i]!, k));
  if (typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const out: Record<string, Tree> = {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (key in a && key in b) out[key] = blendTree(a[key]!, b[key]!, k);
      else {
        const v = blendTree(a[key] ?? 0, b[key] ?? 0, k);
        if (v !== 0) out[key] = v;
      }
    }
    return out;
  }
  return k < 0.5 ? a : b;
};

export const blendFace = (a: Face, b: Face, k: number): Face =>
  blendTree(a as unknown as Tree, b as unknown as Tree, k) as unknown as Face;

const accumulate = (
  acc: Tree | undefined,
  rest: Tree | undefined,
  f: Tree,
  w: number,
  won: Map<string, number>,
  path: string,
): Tree => {
  if (typeof f === "number") return (typeof acc === "number" ? acc : 0) + w * (f - (typeof rest === "number" ? rest : 0));
  if (typeof f === "string") {
    if (f === rest || w <= (won.get(path) ?? 0)) return acc ?? f;
    won.set(path, w);
    return f;
  }
  if (Array.isArray(f))
    return f.map((x, i) => accumulate((acc as Tree[])[i], (rest as Tree[])[i], x, w, won, `${path}.${i}`));
  const into = { ...(acc as Record<string, Tree>) },
    from = (rest ?? {}) as Record<string, Tree>;
  for (const key of Object.keys(f)) into[key] = accumulate(into[key], from[key], f[key]!, w, won, `${path}.${key}`);
  return into;
};

export function mix(...layers: [string | FaceSpec | Face, number][]): Face {
  const rest = resolveFace({}) as unknown as Tree,
    won = new Map<string, number>();
  let face = rest;
  for (const [spec, w] of layers)
    face = accumulate(face, rest, resolveFace(spec) as unknown as Tree, clamp01(w), won, "");
  return face as unknown as Face;
}

export const INTENSITY = { light: 1 / 3, medium: 2 / 3, strong: 1 } as const;
export type Intensity = number | keyof typeof INTENSITY;

export function feel(name: string, intensity: Intensity = 1, from: string | FaceSpec | Face = "neutral"): Face {
  const given = typeof intensity === "number" ? intensity : INTENSITY[intensity];
  if (given === undefined || !Number.isFinite(given))
    throw new Error(`toon face: no intensity "${intensity}" (a number 0..1 or ${Object.keys(INTENSITY).join(", ")})`);
  const k = clamp01(given);
  const ladder = Object.hasOwn(FEELINGS, name) ? FEELINGS[name] : undefined;
  if (!ladder) {
    if (!Object.hasOwn(EXPRESSIONS, name))
      throw new Error(
        `toon face: no feeling or expression "${name}" (feelings: ${Object.keys(FEELINGS).join(", ")}; expressions: ${Object.keys(EXPRESSIONS).join(", ")})`,
      );
    return blendFace(resolveFace(from), resolveFace(name), k);
  }
  const stops = [resolveFace(from), ...ladder.map((rung) => resolveFace(rung))];
  const x = k * ladder.length,
    i = Math.min(ladder.length - 1, Math.floor(x));
  return blendFace(stops[i]!, stops[i + 1]!, x - i);
}

const OPEN_EYE_GLYPHS = new Set(["heart", "star", "gem", "spiral", "dot"]);

export const withBlink = (face: Face, k: number, line = 0.05): Face => {
  const out = clone(face);
  const t = clamp01(k);
  for (const e of [out.eyes.L, out.eyes.R]) {
    if (e.shape === "wince" || e.shape === "x") continue;
    if (t >= 0.7 && OPEN_EYE_GLYPHS.has(e.shape)) {
      e.shape = "eye";
      e.open = 0;
      e.closed = line;
      continue;
    }
    e.closed = lerp(e.closed, line, t * clamp01(e.open * 8));
    e.open *= 1 - t;
  }
  return out;
};

const GAME_MOUTH = { width: 2.4, open: 1.5, tongue: 0.55 };

export const talk = (face: Face, [w = 0, h = 0, teeth = 0, tongue = 0]: number[]): Face => {
  const open = h > 0.02;
  if (!open && w <= 0) return clone(face);
  const out = clone(face);
  Object.assign(out.mouth, {
    width: w / GAME_MOUTH.width,
    open: open ? h / GAME_MOUTH.open : 0,
    teeth: open ? Math.min(1, teeth / h) : 0,
    tongue: open ? Math.min(1, tongue / GAME_MOUTH.tongue) : 0,
    round: 0,
    shape: "mouth",
  });
  return out;
};

type GameMood = Record<string, number | Record<string, number> | undefined>;
const GAME_REST_OPEN = 0.9;
const slant = (t: number) => (t > 0 ? t * 0.5 : t * 1.5);

export function fromGame(mood: GameMood, mouth: number[], blink = 0, look: number[] = [0, 0]): Face {
  const n = (v: unknown, d: number) => (typeof v === "number" ? v : d);
  const side = (s: "L" | "R"): SideSpec => {
    const ov = (mood[s] ?? {}) as Record<string, number>;
    return {
      brow: { y: n(ov.y ?? mood.y, 0) * 0.8, tilt: slant(n(ov.tilt ?? mood.tilt, 0)) },
      eye: {
        open: (n(ov.open ?? mood.open, GAME_REST_OPEN) / GAME_REST_OPEN) * (1 - blink),
        low: n(ov.squint ?? mood.squint, 0),
        pupil: n(ov.pupil ?? mood.pupil, 1),
        look: [look[0] ?? 0, look[1] ?? 0],
      },
    };
  };
  const face = resolveFace({ L: side("L"), R: side("R"), mouth: { curve: n(mood.smile, 0) } });
  return talk(face, mouth);
}


const eyeFrame = (e: Eye, side: -1 | 1, S: ToonStyle) => {
  const E = S.eye,
    out = side,
    k = e.size;
  const cx = 4 + side * E.x,
    w = E.w * k;
  const at = (y: number) => E.irisY + (y - E.irisY) * k;
  const top = at(E.top),
    peak = at(E.peak),
    bottom = at(E.bottom);
  const inX = cx - (out * w) / 2,
    outX = cx + (out * w) / 2;
  const shut = 1 - clamp01(e.open),
    wide = Math.max(0, e.open - 1) * 0.6 * k,
    slant = e.tilt / 30;
  const lowLift = e.low * 0.55 * k;
  const floor = bottom - lowLift + E.sink * shut * k;
  const endIn = lerp(top, floor, shut * 0.92) - wide - slant * 0.35 * k,
    endOut = lerp(top, floor, shut * 0.92) - wide + slant * 0.2 * k,
    apex = lerp(peak, floor, shut * 0.95) - wide * 1.2;
  const iris = E.iris * e.pupil * k;
  const room = w / 2 - iris / 2;
  const ix = cx - out * E.converge * k + e.look[0] * room,
    iy = E.irisY - e.look[1] * 0.35 * k + E.sink * shut * 0.5 * k;
  return { E, out, k, cx, w, at, peak, bottom, inX, outX, slant, lowLift, floor, endIn, endOut, apex, iris, ix, iy };
};

function drawEye(g: G, e: Eye, side: -1 | 1, S: ToonStyle) {
  const { E, out, k, cx, w, at, peak, bottom, inX, outX, slant, lowLift, floor, endIn, endOut, apex, iris, ix, iy } =
    eyeFrame(e, side, S);
  if (e.shape !== "eye") {
    const shape = S.shapes[e.shape];
    if (!shape)
      throw new Error(`toon face: no eye shape "${e.shape}" (${["eye", ...Object.keys(S.shapes)].join(", ")})`);
    shape(g, { cx, cy: E.irisY, w, h: bottom - peak, side, eye: e, style: S });
    return;
  }
  const lidC = (8 * apex - endIn - endOut) / 6;
  const lid: [P, P, P, P] = [
    [inX, endIn],
    [lerp(inX, outX, 0.25), lidC],
    [lerp(inX, outX, 0.75), lidC],
    [outX, endOut],
  ];
  const seen = smoothstep(0.04, 0.07, e.open);
  if (seen > 0) {
    g.save();
    g.globalAlpha *= seen;
    const fit = (floor - Math.max(endIn, endOut)) * 0.5;
    const r = Math.max(0, Math.min(E.r * k, fit)),
      ro = Math.max(0, Math.min(E.rOut * k, fit));
    const lift = lowLift * 0.7,
      wave = E.wave * k;
    const outFoot = outX - out * ro,
      inFoot = inX + out * r;
    g.beginPath();
    g.moveTo(...lid[0]);
    g.bezierCurveTo(...lid[1], ...lid[2], ...lid[3]);
    g.lineTo(outX, floor - ro);
    g.quadraticCurveTo(outX, floor, outFoot, floor);
    g.quadraticCurveTo(lerp(outFoot, cx, 0.45), floor + wave - lift, cx, floor - wave - lift);
    g.quadraticCurveTo(lerp(inFoot, cx, 0.45), floor + wave - lift, inFoot, floor);
    g.quadraticCurveTo(inX, floor, inX, floor - r);
    g.closePath();
    g.fillStyle = S.color.sclera;
    g.fill();
    g.clip();
    if (iris > 0.02) {
      roundRect(g, ix - iris / 2, iy - iris / 2, iris, iris, iris * 0.08);
      g.fillStyle = S.color.iris;
      g.fill();
      if (e.shine > 0) {
        g.fillStyle = `rgba(255,255,255,${0.95 * clamp01(e.shine)})`;
        for (const [dx, dy, r] of [
          [-0.2, -0.2, 0.2],
          [0.22, 0.2, 0.09],
        ] as const) {
          g.beginPath();
          g.arc(ix + dx * iris, iy + dy * iris, r * iris, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    if (e.wet > 0) {
      const pool = floor - 0.5 * clamp01(e.wet) * k;
      g.beginPath();
      g.moveTo(inX - out * 0.1, floor + 0.1);
      for (let i = 0; i <= 12; i++) g.lineTo(lerp(inX, outX, i / 12), pool + 0.04 * Math.sin(i * 1.7));
      g.lineTo(outX + out * 0.1, floor + 0.1);
      g.closePath();
      g.fillStyle = S.color.tear;
      g.globalAlpha *= 0.7;
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.9)";
      roundRect(g, lerp(inX, outX, 0.55) - 0.25, pool + 0.08, 0.5, 0.07, 0.035);
      g.fill();
    }
    g.restore();
    g.save();
    g.globalAlpha *= seen;
    g.fillStyle = S.color.lash;
    const lash = cubic([inX - out * 0.05 * k, endIn + 0.02], lid[1], lid[2], lid[3], 20);
    const along = (E.hookX * 0.6 * k) / (Math.abs(outX - lid[2][0]) || 1);
    const hook = quad(
      [outX, endOut],
      [outX + (outX - lid[2][0]) * along, endOut + (endOut - lid[2][1]) * along],
      [outX + out * E.hookX * k, endOut + E.hookY * k],
      8,
    ).slice(1);
    ribbon(g, [...lash, ...hook], E.lash * k, 0.9);
    g.restore();
  }
  if (seen < 1) {
    g.save();
    g.globalAlpha *= 1 - seen;
    g.fillStyle = S.color.lash;
    const arch = clamp01(e.closed),
      flat = 1 - Math.min(1, Math.abs(e.closed));
    const mid = at(E.closedY + E.closedDrop * flat) - slant * 0.1 * k,
      half = ((E.closedW + E.closedSpread * flat) / 2) * k,
      ccx = cx + out * E.closedShift * arch * k;
    const a: P = [ccx - out * half, mid - (E.closedTilt * arch) / 2],
      b: P = [ccx + out * half, mid + (E.closedTilt * arch) / 2];
    ribbon(g, quad(a, [ccx, mid - 2 * E.closedH * e.closed * k], b, 20), E.lash * k, 0.85);
    g.restore();
  }
}

const browLine = (b: Brow, side: -1 | 1, S: ToonStyle) => {
  const B = S.brow,
    out = side,
    len = B.len * b.len;
  const cx = 4 + side * (B.x + b.x),
    cy = B.y - b.y;
  const t = ((B.tilt + b.tilt) * Math.PI) / 180;
  const dx = (Math.cos(t) * len) / 2,
    dy = (Math.sin(t) * len) / 2;
  const inP: P = [cx - out * dx, cy - dy],
    outP: P = [cx + out * dx, cy + dy];
  const bend = b.curve * B.arch * 2;
  const ctrl: P = [cx - out * Math.sin(t) * bend, cy - Math.cos(t) * bend];
  return { inP, ctrl, outP };
};

function drawBrow(g: G, b: Brow, side: -1 | 1, S: ToonStyle) {
  const { inP, ctrl, outP } = browLine(b, side, S);
  g.fillStyle = S.color.brow;
  ribbon(g, quad(inP, ctrl, outP, 18), S.brow.thick * b.thick, 0.9);
}

const mouthLine = (m: Mouth, S: ToonStyle) => {
  const M = S.mouth;
  const W = M.width * m.width * (1 - 0.4 * m.round),
    H = M.open * Math.max(0, m.open) * (1 + 0.3 * m.round);
  const cx = 4 + m.x,
    cy = M.y - m.y,
    lift = m.curve * M.lift;
  const L: P = [cx - W / 2, cy - lift + m.skew * M.lift * 0.8],
    R: P = [cx + W / 2, cy - lift - m.skew * M.lift * 0.8];
  const kTop = W * (0.28 - 0.08 * m.round),
    kBot = W * (0.06 + 0.22 * m.round);
  const topMid = cy + m.curve * M.sag;
  return { W, H, cx, L, R, kTop, kBot, topMid };
};

function drawMouth(g: G, m: Mouth, S: ToonStyle) {
  const M = S.mouth;
  if (m.shape !== "mouth") {
    const shape = S.mouths[m.shape];
    if (!shape)
      throw new Error(`toon face: no mouth shape "${m.shape}" (${["mouth", ...Object.keys(S.mouths)].join(", ")})`);
    shape(g, {
      cx: 4 + m.x,
      cy: M.y - m.y,
      w: M.width * m.width,
      h: M.open * Math.max(0, m.open),
      lift: m.curve * M.lift,
      mouth: m,
      style: S,
    });
    return;
  }
  const { W, H, cx, L, R, kTop, kBot, topMid } = mouthLine(m, S);
  const topC = (8 * topMid - L[1] - R[1]) / 6,
    botC = (8 * (topMid + H) - L[1] - R[1]) / 6;
  const top = (dy = 0): [P, P, P, P] => [
    [L[0], L[1] + dy],
    [L[0] + kTop, topC + dy],
    [R[0] - kTop, topC + dy],
    [R[0], R[1] + dy],
  ];
  if (H < 0.04) {
    g.fillStyle = S.color.line;
    ribbon(g, cubic(...top()), M.line, 0.55);
    return;
  }
  g.save();
  g.beginPath();
  const [a, c1, c2, b] = top();
  g.moveTo(...a);
  g.bezierCurveTo(...c1, ...c2, ...b);
  g.bezierCurveTo(R[0] - kBot, botC, L[0] + kBot, botC, L[0], L[1]);
  g.closePath();
  g.fillStyle = S.color.mouth;
  g.fill();
  g.clip();
  if (m.tongue > 0) {
    g.beginPath();
    const rx = W * 0.24 * Math.sqrt(m.tongue),
      ry = H * 0.34 * m.tongue;
    g.ellipse(cx + (L[1] - R[1]) * 0.3, topMid + H * 1.02, rx, ry, 0, 0, Math.PI * 2);
    g.fillStyle = S.color.tongue;
    g.fill();
  }
  g.fillStyle = S.color.teeth;
  if (m.lower > 0) {
    const lh = H * m.lower;
    g.beginPath();
    g.moveTo(L[0], L[1]);
    g.bezierCurveTo(L[0] + kBot, botC - lh, R[0] - kBot, botC - lh, R[0], R[1]);
    g.lineTo(R[0], R[1] + H * 3);
    g.lineTo(L[0], L[1] + H * 3);
    g.closePath();
    g.fill();
  }
  if (m.teeth > 0) {
    const th = H * m.teeth;
    g.beginPath();
    g.moveTo(a[0], a[1] - 1);
    g.lineTo(b[0], b[1] - 1);
    g.lineTo(b[0], b[1] + th);
    g.bezierCurveTo(c2[0], c2[1] + th, c1[0], c1[1] + th, a[0], a[1] + th);
    g.closePath();
    g.fill();
  }
  g.restore();
}

export function cuteFace(face: Face, c: CuteRange, restTilt = TOON.brow.tilt): Face {
  const f = clone(face);
  for (const b of [f.brows.L, f.brows.R]) {
    b.tilt = clamp(restTilt + b.tilt, c.browTilt[0], c.browTilt[1]) - restTilt;
    b.curve = Math.max(c.browCurve, b.curve);
  }
  for (const e of [f.eyes.L, f.eyes.R]) {
    e.pupil = e.pupil > 0 ? Math.max(c.pupil, e.pupil) : 0;
    e.tilt = clamp(e.tilt, -c.eyeTilt, c.eyeTilt);
    e.low = Math.min(c.low, e.low);
  }
  f.mouth.width = Math.min(c.mouthWidth, f.mouth.width);
  f.mouth.skew = clamp(f.mouth.skew, -c.skew, c.skew);
  return f;
}

const marksOf = (face: Face, S: ToonStyle, at: Mark["at"]) => {
  const out: [Mark, number][] = [];
  for (const [name, k] of Object.entries(face.extras)) {
    const mark = S.marks[name];
    if (!mark) throw new Error(`toon face: no mark "${name}" (${Object.keys(S.marks).join(", ")})`);
    if (mark.at === at && k > 0) out.push([mark, k]);
  }
  return out;
};

export function drawToonFace(g: G, given: Face, S: ToonStyle) {
  const face = S.cute ? cuteFace(given, S.cute, S.brow.tilt) : given;
  for (const [mark, k] of marksOf(face, S, "under")) mark.draw(g, k, face, S);
  drawBrow(g, face.brows.R, -1, S);
  drawBrow(g, face.brows.L, 1, S);
  drawEye(g, face.eyes.R, -1, S);
  drawEye(g, face.eyes.L, 1, S);
  drawMouth(g, face.mouth, S);
  for (const [mark, k] of marksOf(face, S, "over")) mark.draw(g, k, face, S);
  for (const layer of S.layers) layer(g, face, S);
}

export function toonLandmarks(given: Face, S: ToonStyle = TOON): Record<string, P> {
  const face = S.cute ? cuteFace(given, S.cute, S.brow.tilt) : given;
  const out: Record<string, P> = {};
  for (const [side, s] of [["R", -1], ["L", 1]] as const) {
    const b = browLine(face.brows[side], s, S);
    out[`brow ${side} inner`] = b.inP;
    out[`brow ${side} arch`] = b.ctrl;
    out[`brow ${side} outer`] = b.outP;
    const e = eyeFrame({ ...face.eyes[side], open: 1, look: [0, 0] }, s, S);
    out[`lid ${side} inner`] = [e.inX, e.endIn];
    out[`lid ${side} outer`] = [e.outX, e.endOut];
    out[`lid ${side} lower`] = [e.cx, e.floor];
    out[`pupil ${side}`] = [e.ix + e.iris / 2, e.iy + e.iris / 2];
  }
  const m = mouthLine({ ...face.mouth, width: 1, open: 0, round: 0 }, S);
  out["mouth R corner"] = m.L;
  out["mouth middle"] = [m.cx, m.topMid];
  out["mouth L corner"] = m.R;
  return out;
}

export function drawToonMarks(g: G, face: Face, S: ToonStyle): boolean {
  const marks = marksOf(face, S, "around");
  for (const [mark, k] of marks) mark.draw(g, k, face, S);
  return marks.length > 0;
}

export const TOON: ToonStyle = {
  size: 1024,
  color: {
    sclera: "#eef0e2",
    iris: "#26a818",
    lash: "#26261f",
    brow: "#e68b06",
    mouth: "#6e2317",
    teeth: "#f1f0e3",
    tongue: "#e03a3a",
    line: "#5e2a1f",
    blush: "#ff7f8a",
    tear: "#8fd3ff",
    sweat: "#8fd0ff",
    gloom: "#5b4a8f",
    vein: "#e0302d",
    heart: "#ec3550",
    star: "#ffd23c",
    gem: "#5ce1e6",
    pale: "#6f7ff0",
    sick: "#7cc957",
    bags: "#9a7bb8",
    puff: "#ffffff",
    exclaim: "#ff5145",
    question: "#ffffff",
    zzz: "#dceaff",
    bulb: "#ffd84a",
    note: "#5b3f99",
    cloud: "#9aa3b6",
    soul: "#f4f7ff",
  },
  eye: {
    x: 2.12,
    w: 2.25,
    top: 3.53,
    peak: 3.22,
    bottom: 5.1,
    r: 0.38,
    rOut: 0.45,
    wave: 0.05,
    lash: 0.19,
    hookX: 0.27,
    hookY: 0.3,
    iris: 0.97,
    irisY: 4.22,
    converge: 0.45,
    closedY: 4.51,
    closedW: 2.18,
    closedH: 0.56,
    closedTilt: 0.22,
    closedShift: 0.08,
    sink: 0.21,
    closedDrop: 0.75,
    closedSpread: 0.32,
  },
  brow: { x: 2.31, y: 1.77, len: 2.03, tilt: 23, thick: 0.31, arch: 0.17 },
  mouth: { y: 6.67, width: 3.0, open: 1.0, lift: 0.2, sag: 0.1, line: 0.12 },
  cute: { pupil: 0.85, browTilt: [-14, 45], browCurve: 0.35, eyeTilt: 8, low: 0.3, mouthWidth: 1.1, skew: 0.35 },
  shapes: SHAPES,
  mouths: MOUTHS,
  marks: MARKS,
  layers: [],
};

type Overrides = { [K in keyof ToonStyle]?: ToonStyle[K] extends unknown[] ? ToonStyle[K] : Partial<ToonStyle[K]> | ToonStyle[K] };
export const toonStyle = (o: Overrides = {}, base: ToonStyle = TOON): ToonStyle => ({
  size: o.size ?? base.size,
  color: { ...base.color, ...(o.color as object) },
  eye: { ...base.eye, ...(o.eye as object) },
  brow: { ...base.brow, ...(o.brow as object) },
  mouth: { ...base.mouth, ...(o.mouth as object) },
  cute: o.cute === null ? null : o.cute ? { ...(base.cute ?? TOON.cute!), ...o.cute } : base.cute,
  shapes: { ...base.shapes, ...(o.shapes as object) },
  mouths: { ...base.mouths, ...(o.mouths as object) },
  marks: { ...base.marks, ...(o.marks as object) },
  layers: [...base.layers, ...((o.layers as Layer[]) ?? [])],
});


export const ERASE = (x: number, y: number) => y >= 4 && x >= 1 && x <= 6;

const facePixels = (ctx: CanvasRenderingContext2D) => {
  const s = Math.max(1, Math.round(ctx.canvas.width / 64));
  const d = ctx.getImageData(8 * s, 8 * s, 8 * s, 8 * s).data;
  return (x: number, y: number) => {
    const i = (y * s * 8 * s + x * s) * 4;
    return new THREE.Color().setRGB(d[i]! / 255, d[i + 1]! / 255, d[i + 2]! / 255, THREE.SRGBColorSpace);
  };
};
const median = (cs: THREE.Color[]) =>
  [...cs].sort((a, b) => a.getHSL({ h: 0, s: 0, l: 0 }).l - b.getHSL({ h: 0, s: 0, l: 0 }).l)[cs.length >> 1]!;

const COLS = [0, 1, 2, 3, 4, 5, 6, 7];

const tones = (ctx: CanvasRenderingContext2D, vivid = 0) => {
  const px = facePixels(ctx);
  return {
    skin: median(COLS.slice(1, 7).map((x) => px(x, 5))).offsetHSL(0, vivid, 0),
    hair: median(COLS.map((x) => px(x, 0))).offsetHSL(0, vivid, 0),
  };
};

export interface SkinPrep {
  flat?: boolean;
  vivid?: number;
  erase?: ((x: number, y: number) => boolean) | false;
  tones?: { hair?: string; skin?: string };
}

export function prepareSkin(
  ctx: CanvasRenderingContext2D,
  { flat = true, vivid = 0.12, erase = ERASE, tones: given = {} }: SkinPrep = {},
) {
  const s = Math.max(1, Math.round(ctx.canvas.width / 64));
  const read = tones(ctx, vivid);
  const skin = given.skin ? new THREE.Color(given.skin) : read.skin,
    hair = given.hair ? new THREE.Color(given.hair) : read.hair;
  if (flat) {
    const img = ctx.getImageData(0, 0, 64 * s, 16 * s),
      d = img.data;
    const bytes = [skin, hair].map((c) => {
      const h = c.getHex(THREE.SRGBColorSpace);
      return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
    });
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3]! < 128) continue;
      const near = bytes
        .map((t) => (d[i]! - t[0]!) ** 2 + (d[i + 1]! - t[1]!) ** 2 + (d[i + 2]! - t[2]!) ** 2)
        .reduce((best, dist, k, all) => (dist < all[best]! ? k : best), 0);
      [d[i], d[i + 1], d[i + 2]] = bytes[near]!;
    }
    ctx.putImageData(img, 0, 0);
  }
  if (erase) {
    ctx.fillStyle = `#${skin.getHexString(THREE.SRGBColorSpace)}`;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (erase(x, y)) ctx.fillRect((8 + x) * s, (8 + y) * s, s, s);
  }
}
const chroma = (c: THREE.Color) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);

export function colorsFromSkin(ctx: CanvasRenderingContext2D): Partial<ToonStyle["color"]> {
  const px = facePixels(ctx);
  const hsl = { h: 0, s: 0, l: 0 };
  const skin = median(COLS.map((x) => px(x, 5)));
  const unlike = (c: THREE.Color) => Math.hypot(c.r - skin.r, c.g - skin.g, c.b - skin.b) * (0.3 + chroma(c));
  const swatches = COLS.map((x) => px(x, 4));
  const withoutSclera = swatches.filter((c) => Math.min(c.r, c.g, c.b) < 0.8);
  const iris = (withoutSclera.length ? withoutSclera : swatches).reduce(
    (a, b) => (unlike(b) > unlike(a) ? b : a),
  );
  iris.getHSL(hsl, THREE.SRGBColorSpace);
  const irisOut = new THREE.Color().setHSL(hsl.h, Math.min(0.62, hsl.s * 1.3), 0.32, THREE.SRGBColorSpace);
  tones(ctx, 0.12).hair.getHSL(hsl);
  const brow = new THREE.Color().setHSL(hsl.h - 0.01, Math.min(1, hsl.s + 0.1), Math.max(0.08, hsl.l - 0.12));
  const hex = (c: THREE.Color) => `#${c.getHexString(THREE.SRGBColorSpace)}`;
  return {
    iris: hex(irisOut),
    brow: hex(brow),
  };
}

export const REF_ALEX = { skin: { tones: { hair: "#ecaa18", skin: "#eacda0" } }, derive: false } as const;

export interface ToonWear {
  mesh: THREE.Mesh;
  marks: THREE.Sprite;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  style: ToonStyle;
  readonly face: Face;
  set: (face: ExpressionName | FaceSpec | Face) => void;
  dispose: () => void;
}

export function wearToonFace(
  player: Pick<Awaited<ReturnType<typeof makePlayer>>, "faceFrame" | "skin" | "setFace" | "paintSkinOverlay">,
  {
    style = {},
    skin = {},
    derive = true,
    glow = 0.08,
    face = "neutral",
  }: {
    style?: Overrides;
    skin?: SkinPrep | false;
    derive?: boolean;
    glow?: number;
    face?: ExpressionName | FaceSpec | Face;
  } = {},
): ToonWear {
  if (derive && !player.skin) throw new Error("toon face: derive reads the player's skin canvas, which this player lacks");
  const S = toonStyle({ ...style, color: { ...(derive && player.skin ? colorsFromSkin(player.skin) : {}), ...style.color } });
  let current = resolveFace(face);
  let drawn = JSON.stringify(current);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S.size;
  const g = canvas.getContext("2d")!;
  const halo = document.createElement("canvas");
  halo.width = halo.height = S.size;
  const hg = halo.getContext("2d")!;
  const paint = (value: Face) => {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, S.size, S.size);
    g.scale(S.size / 8, S.size / 8);
    drawToonFace(g, value, S);
    hg.setTransform(1, 0, 0, 1, 0, 0);
    hg.clearRect(0, 0, S.size, S.size);
    hg.scale(S.size / 16, S.size / 16);
    hg.translate(4, 4);
    return drawToonMarks(hg, value, S);
  };
  const initiallyMarked = paint(current);
  player.setFace("skin");
  if (skin) player.paintSkinOverlay((ctx: CanvasRenderingContext2D) => prepareSkin(ctx, skin));
  const texture = new THREE.CanvasTexture(canvas);
  Object.assign(texture, { colorSpace: THREE.SRGBColorSpace, anisotropy: 8, premultiplyAlpha: true });
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    emissive: 0xffffff,
    emissiveMap: texture,
    emissiveIntensity: glow,
    roughness: 0.9,
    transparent: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -8,
  });
  const { px, add } = player.faceFrame;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(8 * px, 8 * px), material);
  mesh.name = "toonFace";
  mesh.receiveShadow = true;
  mesh.userData.landmarks = () => toonLandmarks(current, S);
  add(mesh, 0, 4, 0.04);
  const haloTexture = new THREE.CanvasTexture(halo);
  Object.assign(haloTexture, { colorSpace: THREE.SRGBColorSpace, premultiplyAlpha: true });
  const haloMaterial = new THREE.SpriteMaterial({
    map: haloTexture,
    transparent: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    depthWrite: false,
    toneMapped: false,
  });
  const marks = new THREE.Sprite(haloMaterial);
  marks.name = "toonMarks";
  marks.scale.set(16 * px, 16 * px, 1);
  marks.visible = initiallyMarked;
  add(marks, 0, 4, 0);
  return {
    mesh,
    marks,
    canvas,
    texture,
    style: S,
    get face() {
      return clone(current);
    },
    set(next) {
      const resolved = resolveFace(next);
      const key = JSON.stringify(resolved);
      if (key === drawn) return;
      try {
        marks.visible = paint(resolved);
      } catch (error) {
        paint(current);
        throw error;
      }
      current = resolved;
      drawn = key;
      texture.needsUpdate = true;
      haloTexture.needsUpdate = true;
    },
    dispose() {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
      marks.removeFromParent();
      haloMaterial.dispose();
      haloTexture.dispose();
      if (skin) player.paintSkinOverlay(null);
    },
  };
}
