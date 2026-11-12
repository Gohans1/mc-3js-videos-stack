// How a title looks at a moment of its In and Out: lookOf folds the item's two voices (titles-catalog.ts, or a film's own with a
// step) into one Look (alpha, offsets in heights of the text, scale, rotation, blur, clip, per-word or per-letter phase, tint) that
// titles.ts draws. Pure: the same item and phase give the same Look.
import { easeOf, EASES, expOut, lmix } from "./camera";
import { DEFAULT_TINT, isShapeKind, type TitleVoice } from "./titles-catalog";
import { clamp01, cubicOut, inOutLengths, type Phase, type Timed } from "./titles-text";

type Curve = (x: number) => number;
type Eases = Record<string, Curve>;
type Side = "in" | "out";
export interface TitleFx {
  fx?: string;
  len?: number;
  ease?: string | number[] | Curve;
  stagger?: number;
  tint?: string;
  // 2 or 3: the voice moves on twos or threes of the 30 fps film clock (Cinetic's held frames)
  hold?: number;
  [k: string]: unknown;
}
export interface TitleItem extends Timed {
  kind?: string;
  in?: TitleFx;
  out?: TitleFx;
  [k: string]: unknown;
}
export interface Look {
  alpha: number;
  dx: number;
  dy: number;
  scaleX: number;
  scaleY: number;
  rot: number;
  blur: number;
  tracking: number;
  show: number;
  caret: boolean;
  clip: { kind: "line" } | { kind: "wipe" | "centre"; p: number } | null;
  wordMode: string | null;
  wordPhase: number;
  stagger: number;
  tint: string | null;
  tintMix: number;
  sweepAt: number;
  scramble: number | null;
  splitX: number;
  unit: "word" | "letter";
  echo: number;
  echoGap: number;
  echoFade: number;
  count: number | null;
  fontHop: number | null;
}
export interface CustomVoice extends Partial<TitleVoice> {
  id: string;
  step?: (st: Look, p: number, cfg: TitleFx, it: TitleItem) => void;
}
export interface TitleExtra {
  eases?: Eases;
  text?: { in?: CustomVoice[]; out?: CustomVoice[] };
  shape?: { in?: CustomVoice[]; out?: CustomVoice[] };
  [k: string]: unknown;
}

const BURST_TYPE = expOut(3.2);

// `hold` counts frames of live-studio's 30 fps film clock (Cinetic on-twos / on-threes)
const FILM_FPS = 30;
// len: the seconds the In or Out really runs, after phaseOf shrinks both to fit a short item
const heldPhase = (rawP: number, cfg: TitleFx, len: number) => {
  const p = clamp01(rawP);
  const hold = Math.round(Number(cfg.hold) || 1);
  if (hold < 2 || p >= 1) return p;
  const frames = Math.max(1, len * FILM_FPS);
  return Math.min(1, (Math.floor((p * frames) / hold + 1e-6) * hold) / frames);
};

const ARC_X = easeOf([0.187, 0.876, 0.421, 0.986]);
const FLIP_TO_FLAT = easeOf([0.2, 0.9, 0.3, 1.05]);
const COUNT_LAND = expOut(4.5);
const GROW_OUT = expOut(5);

const curveFn = (spec: TitleFx["ease"], extraEases?: Eases): Curve => {
  if (typeof spec === "function") return spec;
  if (Array.isArray(spec)) return easeOf(spec);
  if (spec === undefined) return cubicOut;
  if (typeof extraEases?.[spec] === "function") return extraEases[spec];
  if (spec === "linear") return EASES.linear;
  if (spec === "smooth") return EASES.smooth;
  if (spec === "snap") return EASES.snapOut;
  if (spec === "glide") return EASES.glideOut;
  if (spec === "launch") return EASES.launchIn;
  return (EASES as Record<string, Curve>)[spec] ?? cubicOut;
};

const easedSlot = (p: number, cfg: TitleFx, side: Side, autoFn: Curve, extraEases?: Eases) => {
  const raw = clamp01(p);
  if (raw <= 0 || raw >= 1) return raw;
  const hasCustom = cfg?.ease && cfg.ease !== "auto";
  if (side === "in") return (hasCustom ? curveFn(cfg.ease, extraEases) : autoFn)(raw);
  const q = 1 - raw;
  return 1 - (hasCustom ? curveFn(cfg.ease, extraEases) : autoFn)(q);
};

export const popCurve = (e: number) => {
  if (e >= 1) return 1;
  if (e < 0.68) return 0.88 + (0.15 * e) / 0.68; // 0.88 -> 1.03 crisp overshoot
  return 1.03 - (0.03 * (e - 0.68)) / 0.32; // settles onto 1.00
};

export const lookOf = (it: TitleItem, ph: Phase, extra?: TitleExtra): Look => {
  const lengths = inOutLengths(it);
  const st: Look = {
    alpha: 1,
    dx: 0,
    dy: 0,
    scaleX: 1,
    scaleY: 1,
    rot: 0,
    blur: 0,
    tracking: 0,
    show: 1,
    caret: false,
    clip: null,
    wordMode: null,
    wordPhase: 1,
    stagger: 0.4,
    tint: null,
    tintMix: 0,
    sweepAt: -1,
    scramble: null,
    splitX: 0,
    unit: "word",
    echo: 0,
    echoGap: 0,
    echoFade: 1,
    count: null,
    fontHop: null,
  };
  const slot = (p: number, cfg: TitleFx, side: Side, autoFn: Curve) =>
    easedSlot(p, cfg, side, autoFn, extra?.eases);
  const units = (mode: string, unit: Look["unit"], phase: number, stagger: number) => {
    st.wordMode = mode;
    st.unit = unit;
    st.wordPhase = phase;
    st.stagger = stagger;
  };
  const apply = (cfg: TitleFx, rawP: number, side: Side) => {
    const fx = cfg.fx;
    if (!fx) return;
    const len = lengths[side],
      p = heldPhase(rawP, cfg, len);
    if (p >= 1) return;
    const kindGroup = isShapeKind(it.kind) ? extra?.shape : extra?.text;
    const custom = kindGroup?.[side]?.find((v) => v.id === fx);
    if (custom?.step) {
      custom.step(st, p, cfg, it);
      return;
    }

    if (fx === "fade") {
      st.alpha *= slot(p, cfg, side, side === "in" ? cubicOut : (q) => 1 - cubicOut(1 - q));
    } else if (fx === "type" || fx === "undraw") {
      const e =
        fx === "undraw" ? slot(p, cfg, side, EASES.buildIn) : slot(p, cfg, side, EASES.linear);
      st.show = Math.min(st.show, e);
    } else if (fx === "easedType") {
      const e = slot(p, cfg, side, BURST_TYPE);
      st.show = Math.min(st.show, e);
      if (p > 0 && p < 0.995) st.caret = true;
    } else if (fx === "draw") {
      st.show = Math.min(st.show, slot(p, cfg, side, EASES.snapOut));
    } else if (fx === "spinDraw") {
      const e = slot(p, cfg, side, EASES.snapOut);
      st.show = Math.min(st.show, e);
      st.rot += (1 - e) * -28;
    } else if (fx === "up") {
      if (side === "in") {
        const e = slot(p, cfg, "in", cubicOut);
        st.alpha *= e;
        st.dy += (1 - e) * 0.6;
      } else {
        const e = slot(p, cfg, "out", EASES.buildIn);
        st.alpha *= clamp01(p * 1.35);
        st.dy -= (1 - e) * 0.65;
      }
    } else if (fx === "down") {
      if (side === "in") {
        const e = slot(p, cfg, "in", EASES.snapOut);
        st.alpha *= e;
        st.dy -= (1 - e) * 0.6;
      } else {
        const e = slot(p, cfg, "out", (q) => 1 - cubicOut(1 - q));
        st.alpha *= e;
        st.dy += (1 - e) * 0.6;
      }
    } else if (fx === "wordRise") {
      const e = slot(p, cfg, side, EASES.snapOut);
      st.alpha *= p <= 0 ? 0 : 0.68 + 0.32 * Math.min(1, p * 2.4);
      st.dy += (1 - e) * 0.52;
      st.blur += p < 0.35 ? (1 - p / 0.35) * 3.5 : 0;
      st.wordMode = "wordRise";
      st.wordPhase = p;
      st.stagger = cfg.stagger ?? 0.35;
      if (cfg.tint) {
        st.tint = cfg.tint;
        st.tintMix = Math.max(st.tintMix, 1 - e);
      }
    } else if (fx === "staggerWords") {
      const e = slot(p, cfg, side, EASES.glideOut);
      st.alpha *= p <= 0 ? 0 : Math.min(1, 0.35 + 0.65 * e);
      st.wordMode = "staggerWords";
      st.wordPhase = p;
      st.stagger = cfg.stagger ?? 0.45;
      if (cfg.tint) {
        st.tint = cfg.tint;
        st.tintMix = Math.max(st.tintMix, 1 - e);
      }
    } else if (fx === "wordDropOut") {
      const e = slot(p, cfg, side, EASES.buildIn);
      st.wordMode = "wordDropOut";
      st.wordPhase = e;
      st.stagger = cfg.stagger ?? 0.45;
      if (p <= 0) st.alpha = 0;
    } else if (fx === "clipRise") {
      const e = slot(p, cfg, side, EASES.snapOut);
      st.alpha *= p <= 0 ? 0 : Math.min(1, 0.45 + 0.55 * e);
      st.dy += (1 - e) * 0.95;
      st.clip = { kind: "line" };
    } else if (fx === "clipDrop") {
      const e = slot(p, cfg, side, EASES.buildIn);
      st.alpha *= p <= 0 ? 0 : Math.min(1, p * 2.2);
      st.dy += (1 - e) * 1.02;
      st.clip = { kind: "line" };
    } else if (fx === "clipUp") {
      const e = slot(p, cfg, side, EASES.buildIn);
      st.alpha *= p <= 0 ? 0 : Math.min(1, p * 2.2);
      st.dy -= (1 - e) * 1.02;
      st.clip = { kind: "line" };
    } else if (fx === "wipeIn") {
      const e = slot(p, cfg, side, EASES.glideOut);
      st.clip = { kind: "wipe", p: e };
      if (cfg.tint) {
        st.tint = cfg.tint;
        st.sweepAt = e;
      }
    } else if (fx === "centreUnmask") {
      const e = slot(p, cfg, side, EASES.snapOut);
      st.alpha *= p <= 0 ? 0 : 0.6 + 0.4 * e;
      st.tracking += (1 - e) * 0.05;
      st.clip = { kind: "centre", p: e };
    } else if (fx === "zoom") {
      const e = slot(p, cfg, side, side === "in" ? cubicOut : (q) => 1 - cubicOut(1 - q));
      st.alpha *= e;
      const s = 0.8 + 0.2 * e;
      st.scaleX *= s;
      st.scaleY *= s;
    } else if (fx === "oversize") {
      const e = slot(p, cfg, side, EASES.snapOut);
      st.alpha *= p <= 0 ? 0 : Math.min(1, 0.45 + 0.55 * Math.min(1, p * 2.2));
      const s = lmix(1.38, 1, e);
      st.scaleX *= s;
      st.scaleY *= s;
      st.blur += p < 0.6 ? ((0.6 - p) / 0.6) ** 1.6 * 10 : 0;
    } else if (fx === "popIn") {
      const e = slot(p, cfg, side, EASES.snapOut);
      st.alpha *= p <= 0 ? 0 : Math.min(1, p * 4);
      const s = popCurve(e);
      st.scaleX *= s;
      st.scaleY *= s;
    } else if (fx === "collapseOut") {
      const e = slot(p, cfg, side, EASES.launchIn);
      const s = lmix(0.86, 1, e);
      st.scaleX *= s;
      st.scaleY *= s;
      st.alpha *= p <= 0 ? 0 : 0.7 + 0.3 * e;
    } else if (fx === "expandFade") {
      const e = slot(p, cfg, side, EASES.glideOut);
      const s = lmix(1.26, 1, e);
      st.scaleX *= s;
      st.scaleY *= s;
      st.alpha *= e;
    } else if (fx === "whipLeft" || fx === "whipRight") {
      const e = slot(p, cfg, side, EASES.launchIn);
      const dir = fx === "whipLeft" ? -1 : 1;
      st.dx += dir * (1 - e) * 1.45;
      st.alpha *= p <= 0 ? 0 : Math.min(1, p * 3.2);
      st.blur += (1 - e) * 6;
    } else if (fx === "barrelIn" || fx === "barrelOut") {
      const e = slot(p, cfg, side, fx === "barrelIn" ? EASES.snapOut : EASES.buildIn);
      st.alpha *= e;
      st.scaleY *= 0.2 + 0.8 * e;
      st.scaleX *= 0.96 + 0.04 * e;
      st.dy += (fx === "barrelIn" ? 1 : -1) * (1 - e) * 0.22;
      st.blur += (1 - e) * 5;
    } else if (fx === "blur") {
      const e = slot(p, cfg, side, side === "in" ? cubicOut : (q) => 1 - cubicOut(1 - q));
      st.alpha *= e;
      st.blur += (1 - e) * 12;
    } else if (fx === "blurExit") {
      const e = slot(p, cfg, side, EASES.buildIn);
      st.alpha *= e;
      st.blur += (1 - e) * 22;
      const s = 0.95 + 0.05 * e;
      st.scaleX *= s;
      st.scaleY *= s;
    } else if (fx === "trackingIn") {
      const e = slot(p, cfg, side, EASES.snapOut);
      st.alpha *= p <= 0 ? 0 : Math.min(1, 0.35 + 0.65 * e);
      st.tracking += (1 - e) * 0.16;
    } else if (fx === "trackingOut") {
      const e = slot(p, cfg, side, EASES.launchIn);
      st.alpha *= e;
      st.tracking += (1 - e) * 0.18;
      const s = lmix(1.12, 1, e);
      st.scaleX *= s;
      st.scaleY *= s;
    } else if (fx === "inkIn") {
      const e = slot(p, cfg, side, EASES.snapOut);
      st.alpha *= p <= 0 ? 0 : Math.min(1, 0.52 + 0.48 * e);
      st.tint = cfg.tint || DEFAULT_TINT;
      st.tintMix = Math.max(st.tintMix, 1 - e);
      st.wordMode = "inkIn";
      st.wordPhase = p;
      st.stagger = cfg.stagger ?? 0.4;
    } else if (fx === "hueSweepIn") {
      const e = slot(p, cfg, side, EASES.glideOut);
      st.alpha *= p <= 0 ? 0 : Math.min(1, 0.4 + 0.6 * e);
      st.tint = cfg.tint || DEFAULT_TINT;
      st.sweepAt = e;
      st.clip = { kind: "wipe", p: Math.min(1, e * 1.15) };
    } else if (fx === "scramble" || fx === "scrambleOut") {
      const e = slot(p, cfg, side, fx === "scramble" ? EASES.glideOut : EASES.buildIn);
      st.alpha *= p <= 0 ? 0 : Math.min(1, p * 3.5);
      st.scramble = e;
    } else if (fx === "lineSplitIn" || fx === "lineSplitOut") {
      const e = slot(p, cfg, side, fx === "lineSplitIn" ? EASES.snapOut : EASES.launchIn);
      st.alpha *= p <= 0 ? 0 : Math.min(1, 0.35 + 0.65 * e);
      st.splitX += (1 - e) * 1.1;
    } else if (fx === "wordBuild") {
      units("wordBuild", "word", slot(p, cfg, side, EASES.linear), cfg.stagger ?? 0.7);
      if (p <= 0) st.alpha = 0;
    } else if (fx === "letterReveal") {
      const s = lmix(1.12, 1, slot(p, cfg, side, cubicOut));
      st.scaleX *= s;
      st.scaleY *= s;
      units("letterReveal", "letter", slot(p, cfg, side, EASES.linear), cfg.stagger ?? 0.6);
      if (cfg.tint) st.tint = cfg.tint;
      if (p <= 0) st.alpha = 0;
    } else if (fx === "assemble" || fx === "wordBounce") {
      const unit = fx === "assemble" ? "letter" : "word";
      units(
        fx,
        unit,
        slot(p, cfg, side, EASES.linear),
        cfg.stagger ?? (unit === "letter" ? 0.5 : 0.45),
      );
      if (p <= 0) st.alpha = 0;
    } else if (fx === "letterHide" || fx === "shatter") {
      const e = slot(p, cfg, side, EASES.buildIn);
      units(fx, "letter", e, cfg.stagger ?? (fx === "letterHide" ? 0.8 : 0.5));
      if (fx === "letterHide") st.dx += (1 - e) * 0.35;
      if (p <= 0) st.alpha = 0;
    } else if (fx === "flipUp" || fx === "flipAway") {
      const up = fx === "flipUp";
      const e = slot(p, cfg, side, up ? FLIP_TO_FLAT : EASES.launchIn);
      const c = Math.max(0.02, Math.cos(((up ? 70 : 52) * (1 - e) * Math.PI) / 180));
      st.scaleY *= c;
      // Hinged at the baseline: shrinking about the centre would lift the foot, so drop it back down
      st.dy += (1 - c) * 0.6;
      if (up) {
        st.dy += (1 - e) * 0.55;
        st.alpha *= p <= 0 ? 0 : Math.min(1, p * 4);
        if (!cfg.tint) {
          st.tint = "#8C8C8C";
          st.tintMix = Math.max(st.tintMix, clamp01(1 - e));
        }
      } else {
        st.alpha *= clamp01(e);
        st.blur += (1 - e) * 6;
      }
    } else if (fx === "gravityDrop") {
      const t = slot(p, cfg, side, EASES.linear),
        hit = 0.62,
        fall = 1.6,
        bounce = 0.4;
      const u = (t - hit) / (1 - hit);
      st.dy += t < hit ? -fall * (1 - (t / hit) ** 2) : -fall * bounce * bounce * 4 * u * (1 - u);
      // Squash only on the contact frames, volume kept
      const sq = Math.max(0, 1 - Math.abs(t - hit) / 0.06) * 0.12;
      st.scaleY *= 1 - sq;
      st.scaleX /= 1 - sq;
      st.dy += sq * 0.5;
      st.alpha *= Math.min(1, t * 8);
    } else if (fx === "gravityFall") {
      const q = 1 - slot(p, cfg, side, EASES.linear);
      st.dy += 2.2 * q * q;
      st.scaleY *= 1 + 0.07 * q;
      st.scaleX /= 1 + 0.07 * q;
      st.alpha *= Math.min(1, p * 6);
    } else if (fx === "pendulum") {
      const t = slot(p, cfg, side, EASES.linear);
      const deg = -55 * Math.exp(-3.2 * t) * Math.cos(2 * Math.PI * 1.75 * t) * (1 - t);
      const r = (deg * Math.PI) / 180;
      st.rot += deg;
      // Swing about the top edge, not the centre the canvas rotates around
      st.dx -= Math.sin(r) * 0.6;
      st.dy += (Math.cos(r) - 1) * 0.6;
      const s = 1 + 0.08 * (1 - cubicOut(t));
      st.scaleX *= s;
      st.scaleY *= s;
      st.alpha *= Math.min(1, t * 6);
    } else if (fx === "arcFlight") {
      const t = slot(p, cfg, side, EASES.linear),
        ex = ARC_X(t);
      st.dx -= (1 - ex) * 1.8;
      st.dy -= (1 - EASES.smooth(t)) * 0.9;
      const s = lmix(0.85, 1, ex) + 0.12 * Math.sin(Math.PI * t);
      st.scaleX *= s;
      st.scaleY *= s;
      st.rot += (1 - ex) * 16;
      st.alpha *= Math.min(1, t * 5);
    } else if (fx === "lensFly" || fx === "lensFlyOut") {
      const into = fx === "lensFly";
      const e = slot(p, cfg, side, into ? cubicOut : EASES.launchIn);
      const s = 3.2 ** (1 - e);
      st.scaleX *= s;
      st.scaleY *= s;
      st.blur += (1 - e) * 18;
      st.dx += (1 - e) * 0.5;
      st.dy += (1 - e) * 0.35;
      st.alpha *= into ? (p <= 0 ? 0 : 0.45 + 0.55 * e) : clamp01(e);
    } else if (fx === "echoIn" || fx === "echoOut") {
      const into = fx === "echoIn";
      const e = slot(p, cfg, side, EASES.linear);
      const hop = Math.min(3, Math.floor((into ? e : 1 - e) * 4)),
        gap = 0.45;
      st.dx += into ? -(3 - hop) * gap : hop * gap;
      st.echo = hop;
      st.echoGap = gap;
      if (into && hop === 3) st.echoFade = clamp01(1 - (e - 0.75) / 0.25);
      st.alpha *= p <= 0 ? 0 : into ? 1 : Math.min(1, p * 4);
    } else if (fx === "counter") {
      st.count = slot(p, cfg, side, COUNT_LAND);
    } else if (fx === "fontCycle") {
      const hops = Math.max(2, Math.round((len * FILM_FPS) / 3));
      st.fontHop = hops - Math.min(hops - 1, Math.floor(slot(p, cfg, side, EASES.linear) * hops));
      if (cfg.tint) {
        st.tint = cfg.tint;
        st.tintMix = st.fontHop % 2 ? 1 : 0;
      }
      if (p <= 0) st.alpha = 0;
    } else if (fx === "growDot") {
      const s = lmix(0.03, 1, slot(p, cfg, side, GROW_OUT));
      st.scaleX *= s;
      st.scaleY *= s;
      if (p <= 0) st.alpha = 0;
    } else {
      st.alpha *= slot(p, cfg, side, cubicOut);
    }
    if (cfg.tint && !st.tint) {
      const e = slot(p, cfg, side, cubicOut);
      st.tint = cfg.tint;
      st.tintMix = Math.max(st.tintMix, 1 - e);
    }
  };
  if (it.in?.fx) apply(it.in, ph.in, "in");
  if (it.out?.fx) apply(it.out, ph.out, "out");
  return st;
};
