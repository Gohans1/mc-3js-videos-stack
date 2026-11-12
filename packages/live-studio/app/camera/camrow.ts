import { EDIT } from "film/edit";
// The camera row under the timeline, on the same seconds as the stretch above it, laid out as CapCut's main track: each shot is
// a block (its name and length in the header) holding a diamond per camera key (camera/cam.ts) and, between two keys, the
// camera's speed through that span as its ease spends it (high: fast, flat on the floor: standing still). A shot's In and Out
// show as bands at the foot of its block, a Combo as a band the whole way. A click picks a shot (its Camera and Animation tabs)
// and leaves the playhead where it is; the playhead moves only when grabbed by its line (a touch drag scrubs anywhere). A mouse
// drag draws the box over the rows (timeline/rowbox.ts) that picks the keys it covers, Shift/Ctrl+click adds or drops one;
// dragging a picked key moves them all (cam.ts groupRoom) with whatever else the box picked on other rows (timeline/across.ts),
// Delete removes them. A diamond is dragged to retime it inside its
// shot, snapping to frames, the playhead and words (Shift: no snap); a click on one brings the playhead to it. The gap between two blocks is the cut: it drags too when the film keeps its shots as data (cam.ts
// rollCut), the shots on both sides giving and taking. Right-click a block for its menu (CameraTrack.tsx).
// In split mode (blade.ts) a click splits the shot there: the playhead goes to it, so the new shot's first frame shows.
import { DURATION, SHOTS_OUT } from "film/scene";

import { cameraSpeed } from "../../src/camera-speed.mjs";
import { timing, timingClock } from "../../src/timing-state.mjs";
import {
  compileTiming,
  frameVisible,
  freezeRange,
  freezesOf,
  moveFreeze,
  playRanges,
} from "../../src/timing.mjs";
import { BLADE_CURSOR } from "../components/cursor";
import { together } from "../core/doc";
import { easeFn } from "../core/ease";
import { shotIndex } from "../core/film";
import { transitionSelection } from "../core/selection";
import { S } from "../core/state";
import { get, noSnap, say, set } from "../core/store";
import { makeSnapper, r3, snappedTo, snapTo, stamp } from "../core/time";
import { seek, setPlaying } from "../playback/transport";
import { beatTimes } from "../sound/sound";
import { type Along, alongWith, inBox, pickAcross, picked } from "../timeline/across";
import { bladeLine } from "../timeline/blade";
import { drawPlayhead, keyReach, REACH, sized, tone, UI_FONT } from "../timeline/canvas";
import { boxEnd, boxMove, boxStart } from "../timeline/rowbox";
import { snapLine } from "../timeline/snapline";
import { holdView, marks, onPlayhead, timeAt, timelineWheel, view } from "../timeline/timeline";
import {
  relocateFreeze,
  setFreezeDuration,
  shotSpeed,
  shotVelocity,
  sourceShot,
  timingDoc,
} from "../timeline/timing";
import {
  animOf,
  clockOf,
  lenOf,
  metricsOf,
  pickShot,
  setAmount,
  shotSourceOf,
  shotSpan,
} from "./anim";
import {
  animBandOnSegment,
  type AnimHandleCandidate,
  clampHandleX,
  disambiguateSeamSlot,
  pickAnimEdge,
} from "./anim-math";
import {
  type CamKey,
  DEFAULT_EASE,
  edit,
  groupRoom,
  holds,
  keys,
  movable,
  preview,
  previewRoll,
  restore,
  rollable,
  rollCut,
  rollRoom,
  room,
  setKey,
  shiftCamKeys,
  snapshot,
  splitShot,
} from "./cam";
import { shotsDoc } from "./shots";
import {
  pickTransition,
  setTransitionDuration,
  setTransitionEdge,
  transitionDuration,
  transitionOf,
  transitionSpan,
} from "./transitions";

// A shot is CapCut's video clip: its teal, a lighter tag holding its name, its other words dimmer on the clip (index.css tokens)
const ANIM_LIGHT = "rgba(255,255,255,.55)"; // the band under a shot that animates in or out
const PAD = 2,
  HEAD = 15,
  BAND = 4,
  FOOT = 3; // FOOT: room under the bands for the picked outline
const TRANSITION_TOP = HEAD + 1;

const transitionBox = (i: number, w: number) => {
  const { a, v } = view(),
    [from, to] = transitionSpan(i),
    center = (((from + to) / 2 - a) / v) * w,
    width = Math.max(14, ((to - from) / v) * w);
  return { left: center - width / 2, right: center + width / 2 };
};
const transitionUnder = (x: number, y: number, w: number) => {
  if (y < TRANSITION_TOP) return -1;
  return SHOTS_OUT.findIndex((_, i) => {
    if (!transitionOf(i)) return false;
    const b = transitionBox(i, w);
    return x >= b.left && x <= b.right;
  });
};
export const cutAtPointer = (e: { clientX: number }) => {
  const r = S.el.camrow.getBoundingClientRect(),
    x = e.clientX - r.left,
    { a, v } = view();
  let best = -1,
    distance = 24;
  SHOTS_OUT.forEach((shot, i) => {
    const d = Math.abs(((shot.t - a) / v) * r.width - x);
    if (i && d < distance) {
      best = i;
      distance = d;
    }
  });
  return best;
};

let xs: number[] = []; // each key's x as last drawn, for the pointer
let hover = -1; // the block under the pointer
let freezeGhost: { index: number; from: number; to: number } | null = null;
const picks = () => {
  const { camKey: k, camPicks: ps } = get();
  return ps.length ? ps : k !== null ? [k] : [];
};

// The block a key belongs to: a cut opens its shot, any other key on a cut's second is the last of the shot before
const owner = (i: number) => shotIndex(Math.max(0, keys[i].cut ? keys[i].t : keys[i].t - 1e-4));
const shotAtX = (x: number, w: number) => {
  const t = timeAt(x, w);
  return t < 0 ||
    t > DURATION ||
    !SHOTS_OUT.length ||
    (get().timing && !frameVisible(timingClock, t))
    ? -1
    : shotIndex(t);
};

const drawSpeed = (
  g: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  from: number,
  to: number,
  ease: CamKey["ease"],
  top: number,
  floor: number,
) => {
  const f = easeFn(ease, DEFAULT_EASE);
  if (!f) return;
  const n = Math.max(8, Math.min(120, Math.round(x1 - x0))),
    speed: number[] = [],
    { a, v } = view(),
    w = S.el.camrow.clientWidth;
  for (let j = 0; j <= n; j++) {
    const t = a + ((x0 + Math.min(j / n, 1 - 1e-7) * (x1 - x0)) / w) * v;
    speed.push(cameraSpeed(get().timing ? timingClock : null, from, to, f, t));
  }
  const peak = Math.max(1e-6, ...speed),
    y = (s: number) => floor - (s / peak) * (floor - top);
  g.beginPath();
  g.moveTo(x0, floor);
  speed.forEach((s, j) => g.lineTo(x0 + (j / n) * (x1 - x0), y(s)));
  g.lineTo(x1, floor);
  g.closePath();
  g.globalAlpha = 0.32;
  g.fillStyle = tone("warn");
  g.fill();
  g.globalAlpha = 1;
  g.beginPath();
  speed.forEach((s, j) => (j ? g.lineTo : g.moveTo).call(g, x0 + (j / n) * (x1 - x0), y(s)));
  g.strokeStyle = tone("warn");
  g.lineWidth = 1;
  g.stroke();
};

// In and Out bands trim from their inner edge (CapCut's animation handles): handles only hit-test when visible on a picked or
// hovered shot, map cleanly across timing speed/freezes, and disambiguate when In and Out meet in the middle of a shot
const bandTop = (h: number) => h - PAD - FOOT - BAND;
const animHandles = (w: number): AnimHandleCandidate[] => {
  const { a, v } = view(),
    X = (s: number) => ((s - a) / v) * w,
    clock = clockOf();
  const out: AnimHandleCandidate[] = [];
  SHOTS_OUT.forEach((_, i) => {
    const an = animOf(i);
    if (!an.in && !an.out) return;
    const src = shotSourceOf(i),
      m = metricsOf(i),
      [start, end] = shotSpan(i),
      [from, to] = sourceShot(i);
    const ranges = clock
      ? playRanges(timingClock, from, to)
      : [{ sourceFrom: src[0], sourceTo: src[1], from: start, to: end }];
    for (const seg of ranges) {
      for (const slot of ["in", "out"] as const) {
        const band = animBandOnSegment(src, clock, m, seg, slot);
        if (!band || band.handleAt === null) continue;
        out.push({
          i,
          slot,
          x: X(band.handleAt),
          anchor: slot === "in" ? m.inSpan[0] : m.outSpan[1],
        });
      }
    }
  });
  return out;
};
const animEdgeAt = (x: number, y: number, w: number, h: number, touch: boolean) => {
  if (y < bandTop(h) - (touch ? 10 : 5)) return null;
  const { shotPick, shotPicks } = get();
  const active = new Set<number>(shotPicks);
  if (shotPick !== null) active.add(shotPick);
  if (hover >= 0) active.add(hover);
  return pickAnimEdge(animHandles(w), x, touch ? 12 : 6, active, shotPick, hover);
};

const drawBlock = (
  g: CanvasRenderingContext2D,
  i: number,
  span: { sourceFrom: number; sourceTo: number; from: number; to: number },
  X: (s: number) => number,
  w: number,
  h: number,
  on: boolean,
) => {
  const { sourceFrom: rawFrom, sourceTo: rawTo, from: s, to: e } = span,
    x0 = X(s) + 1,
    x1 = X(e) - 1;
  if (x1 < 0 || x0 > w || x1 - x0 < 1) return;
  const y0 = PAD,
    y1 = h - PAD,
    cx0 = Math.max(-4, x0),
    cx1 = Math.min(w + 4, x1),
    bw = cx1 - cx0;
  g.save();
  g.beginPath();
  g.roundRect(cx0, y0, bw, y1 - y0, 4);
  g.clip();
  g.fillStyle = tone(hover === i ? "clip-video-hover" : "clip-video");
  g.fillRect(cx0, y0, bw, y1 - y0);
  if (bw > 24) {
    const name = `${i}  ${S.comments[i] || `Shot ${i}`}`,
      left = Math.max(x0, 0) + 3,
      mid = y0 + HEAD / 2 + 1;
    g.font = `11px ${UI_FONT}`;
    const nw = g.measureText(name).width;
    g.fillStyle = tone("clip-video-tag");
    g.beginPath();
    g.roundRect(left, y0 + 2, nw + 8, HEAD - 2, 3);
    g.fill();
    g.fillStyle = tone("clip-label");
    g.fillText(name, left + 4, mid);
    const speed = get().timing ? shotSpeed(i) : null,
      velocity = speed && shotVelocity(i);
    const label = speed
      ? velocity?.enabled !== false && velocity
        ? "Velocity"
        : speed.curve
          ? "Curve"
          : `${speed.rate?.toFixed(2)}×`
      : "";
    g.fillStyle = tone("clip-video-text");
    g.fillText(`${label ? `Speed ${label} · ` : ""}${(e - s).toFixed(1)}s`, left + nw + 14, mid);
  }
  // The camera's speed between this shot's keys
  const top = y0 + HEAD + 3,
    foot = y1 - FOOT - BAND,
    floor = foot - 2;
  const sourceKeys = EDIT.cam as CamKey[];
  for (let k = 1; k < sourceKeys.length; k++) {
    const k0 = sourceKeys[k - 1],
      k1 = sourceKeys[k];
    if (k1.cut || k1.t <= k0.t || k1.t <= rawFrom || k0.t >= rawTo) continue;
    const a = X(timingClock.outputAt(Math.max(k0.t, rawFrom))),
      b = X(timingClock.outputAt(Math.min(k1.t, rawTo), "before"));
    if (b < 0 || a > w) continue;
    if (holds(k0, k1)) {
      g.fillStyle = tone("muted-foreground");
      g.fillRect(Math.max(cx0, a), floor - 1, Math.min(cx1, b) - Math.max(cx0, a), 1);
      if (b - a > 70) {
        g.font = `11px ${UI_FONT}`;
        g.fillStyle = tone("clip-video-text");
        g.fillText("hold", Math.max(cx0, a) + 10, (top + floor) / 2);
      }
      continue;
    }
    drawSpeed(g, a, b, k0.t, k1.t, k1.ease, top, floor);
  }
  // In, Out, Combo at the foot of the block, mapped across timing speed and freezes
  const an = animOf(i),
    clock = clockOf(),
    src = shotSourceOf(i),
    m = metricsOf(i);
  const inBand = animBandOnSegment(src, clock, m, span, "in");
  const outBand = animBandOnSegment(src, clock, m, span, "out");
  g.fillStyle = ANIM_LIGHT;
  if (an.combo) {
    g.setLineDash([3, 3]);
    g.strokeStyle = ANIM_LIGHT;
    g.lineWidth = BAND;
    g.beginPath();
    g.moveTo(cx0, foot + BAND / 2);
    g.lineTo(cx1, foot + BAND / 2);
    g.stroke();
    g.setLineDash([]);
  }
  if (inBand) {
    const bx0 = Math.max(x0, X(inBand.from)),
      bx1 = Math.min(x1, X(inBand.to));
    if (bx1 > bx0) g.fillRect(bx0, foot, Math.max(3, bx1 - bx0), BAND);
  }
  if (outBand) {
    const bx0 = Math.max(x0, X(outBand.from)),
      bx1 = Math.min(x1, X(outBand.to));
    if (bx1 > bx0) g.fillRect(Math.min(bx0, x1 - 3), foot, Math.max(3, bx1 - bx0), BAND);
  }
  // The trim handles on the picked or hovered shot, clamped inside [x0, x1] so 100%-duration handles stay visible
  if (get().shotPick === i || get().shotPicks.includes(i) || hover === i) {
    g.fillStyle = tone("pick");
    if (inBand && inBand.handleAt !== null)
      g.fillRect(clampHandleX(X(inBand.handleAt), x0, x1), foot - 2, 3, BAND + 3);
    if (outBand && outBand.handleAt !== null)
      g.fillRect(clampHandleX(X(outBand.handleAt), x0, x1), foot - 2, 3, BAND + 3);
  }
  g.restore();
  if (on || get().shotPick === i || get().shotPicks.includes(i)) {
    g.strokeStyle = tone("pick");
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(cx0 + 1, y0 + 1, bw - 2, y1 - y0 - 2, 3);
    g.stroke();
  }
};

export const drawCamRow = () => {
  const c = S.el?.camrow;
  if (!c || !get().cam || !c.getClientRects().length) return;
  const { g, w, h } = sized(c);
  if (!c.width) return;
  const { a, v } = view(),
    X = (s: number) => ((s - a) / v) * w,
    picked = new Set(picks());
  g.fillStyle = tone("main-track");
  g.fillRect(0, 0, w, h);
  g.textBaseline = "middle";
  // Fixed opening keys still represent selectable shots, including a static first shot.
  const all = SHOTS_OUT.map(() => true),
    any = SHOTS_OUT.map(() => false);
  keys.forEach((_, i) => {
    const j = owner(i);
    any[j] = true;
    if (!picked.has(i)) all[j] = false;
  });
  SHOTS_OUT.forEach((_, i) => {
    const [from, to] = sourceShot(i),
      [start, end] = shotSpan(i);
    const ranges = get().timing
      ? playRanges(timingClock, from, to)
      : [{ sourceFrom: from, sourceTo: to, from: start, to: end }];
    for (const span of ranges) drawBlock(g, i, span, X, w, h, any[i] && all[i]);
  });
  xs = keys.map((k) => X(k.t));
  const y = PAD + HEAD + (h - PAD * 2 - HEAD - BAND - FOOT) / 2,
    r = 5;
  keys.forEach((k, i) => {
    const x = xs[i];
    if (x < -REACH || x > w + REACH) return;
    g.beginPath();
    g.moveTo(x, y - r);
    g.lineTo(x + r, y);
    g.lineTo(x, y + r);
    g.lineTo(x - r, y);
    closePathAndFill(g, k.cut || i === 0 ? tone("muted-foreground") : tone("foreground"));
    if (picked.has(i)) {
      g.strokeStyle = tone("pick");
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, y - r - 3);
      g.lineTo(x + r + 3, y);
      g.lineTo(x, y + r + 3);
      g.lineTo(x - r - 3, y);
      g.closePath();
      g.stroke();
    }
  });
  SHOTS_OUT.forEach((_, i) => {
    if (!transitionOf(i)) return;
    const { left, right } = transitionBox(i, w),
      on = get().side === "transition" && get().shotPick === i;
    if (right < 0 || left > w) return;
    g.fillStyle = tone("raised-3");
    g.fillRect(left, TRANSITION_TOP, right - left, h - TRANSITION_TOP - PAD);
    g.strokeStyle = tone(on ? "pick" : "muted-foreground");
    g.lineWidth = on ? 2 : 1;
    g.strokeRect(left + 1, TRANSITION_TOP + 1, right - left - 2, h - TRANSITION_TOP - PAD - 2);
    const cx = (left + right) / 2,
      cy = (TRANSITION_TOP + h - PAD) / 2;
    g.strokeStyle = tone("foreground");
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(cx - 3, cy - 4);
    g.lineTo(cx + 3, cy + 4);
    g.moveTo(cx + 3, cy - 4);
    g.lineTo(cx - 3, cy + 4);
    g.stroke();
    if (on && right - left > 18) {
      g.fillStyle = tone("pick");
      g.fillRect(left + 3, cy - 5, 2, 10);
      g.fillRect(right - 5, cy - 5, 2, 10);
    }
  });
  if (timing.main || timing.freezes?.some((f) => f.blank || f.padBefore || f.padAfter))
    for (const s of timingClock.segments)
      if (s.kind === "freeze" && s.blank) {
        g.fillStyle = tone("main-track");
        g.fillRect(X(s.from), 0, X(s.to) - X(s.from), h);
      }
  for (const [i, freeze] of freezesOf(timing).entries()) {
    const [from, to] = freezeRange(timing, timingClock, i),
      left = X(from) + 1,
      width = X(to) - left - 1;
    if (
      freeze.blank ||
      width < 1 ||
      left > w ||
      left + width < 0 ||
      (!timing.main && !timingClock.visible(freeze.at))
    )
      continue;
    g.save();
    if (freezeGhost?.index === i) g.globalAlpha = 0.3;
    g.beginPath();
    g.roundRect(left, PAD, width, h - PAD * 2, 3);
    g.clip();
    g.fillStyle = tone("clip-video");
    g.fillRect(left, PAD, width, h - PAD * 2);
    g.fillStyle = tone("clip-label");
    g.font = `11px ${UI_FONT}`;
    g.fillText(`Freeze · ${freeze.duration.toFixed(1)}s`, left + 4, PAD + HEAD / 2 + 1);
    g.restore();
    g.strokeStyle = tone(get().freezePick === i ? "pick" : "raised-2");
    g.lineWidth = get().freezePick === i ? 2 : 1;
    g.strokeRect(left + 1, PAD + 1, width - 2, h - PAD * 2 - 2);
  }
  if (freezeGhost) {
    const left = X(freezeGhost.from) + 1,
      width = X(freezeGhost.to) - left - 1;
    g.fillStyle = tone("clip-video");
    g.strokeStyle = tone("pick");
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(left, PAD, Math.max(2, width), h - PAD * 2, 3);
    g.fill();
    g.stroke();
    g.save();
    g.clip();
    g.fillStyle = tone("clip-label");
    g.font = `11px ${UI_FONT}`;
    g.fillText(
      `Freeze · ${(freezeGhost.to - freezeGhost.from).toFixed(1)}s`,
      left + 4,
      PAD + HEAD / 2 + 1,
    );
    g.restore();
  }
  if (get().blade && bladeLine.row === "cam") {
    const x = Math.round(X(bladeLine.t));
    g.fillStyle = "#000";
    g.fillRect(x - 1, 0, 3, h);
    g.fillStyle = tone("pick");
    g.fillRect(x, 0, 1, h);
  }
  drawPlayhead(g, X(S.t), h);
};
const closePathAndFill = (g: CanvasRenderingContext2D, style: string) => {
  g.closePath();
  g.fillStyle = style;
  g.fill();
};

const snapPoints = () => [
  S.t,
  ...beatTimes(),
  ...S.voiceOut.flatMap((l) => l.words.map((w) => w.s)),
];
const freezeAt = (t: number) =>
  freezesOf(timing).findIndex((f, i) => {
    const [from, to] = freezeRange(timing, timingClock, i);
    return !f.blank && (Boolean(timing.main) || timingClock.visible(f.at)) && t >= from && t < to;
  });
const snapped = (s: number, perPx: number, off: boolean) =>
  snapTo(s, snapPoints(), perPx, off, true);
// The key under x: the nearest within reach; of a shot's last key and the cut on the same second, the cut when it can roll (its
// last key goes with it), else the last key
const keyAt = (x: number, touch: boolean) => {
  const reach = keyReach(touch);
  let best = -1,
    d = reach;
  xs.forEach((kx, i) => {
    const e = Math.abs(kx - x) - (rollable(i) ? 0.6 : movable(i) ? 0.5 : 0);
    if (e <= d) {
      d = e;
      best = i;
    }
  });
  return best;
};

// As on the key rows: the playhead line comes first over the keys and cuts behind it, except the picked key
const keyUnder = (x: number, w: number, touch: boolean) => {
  const i = keyAt(x, touch);
  return i >= 0 && onPlayhead(x, w, touch) && !picks().includes(i) ? -1 : i;
};

// The shot block under a right-click, for its menu (CameraTrack.tsx); -1 off the film
export const shotAtPointer = (e: { clientX: number }) => {
  const c = S.el.camrow,
    r = c.getBoundingClientRect();
  return shotAtX(e.clientX - r.left, r.width);
};

// The box over the rows (rowbox.ts), once it reaches this row, picks every block it touches with all its keys, as CapCut's box
// picks every clip it touches; a click on a diamond (Shift or Ctrl adds) picks one key
const shotsInBox = (r: { x0: number; x1: number; y0: number; y1: number }) => {
  const c = S.el.camrow.getBoundingClientRect();
  if (!c.height || r.y1 < c.top || r.y0 > c.bottom || !SHOTS_OUT.length) return [];
  const t0 = timeAt(r.x0 - c.left, c.width),
    t1 = timeAt(r.x1 - c.left, c.width);
  if (t1 < 0 || t0 > DURATION) return [];
  return SHOTS_OUT.flatMap((_, i) => {
    const [from, to] = sourceShot(i);
    return playRanges(timingClock, from, to).some((s) => s.from <= t1 && s.to >= t0) ? [i] : [];
  });
};

export const attachCamRow = () => {
  const c = S.el.camrow;
  marks.cam = drawCamRow;
  inBox.shots = shotsInBox;
  inBox.cam = (r) => {
    const shots = shotsInBox(r);
    return keys.flatMap((_, i) => (shots.includes(owner(i)) ? [i] : []));
  };
  const local = (e: PointerEvent) => {
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  };
  // group: the picked keys that move with the one held (just it when it is alone)
  let drag: {
    i: number;
    group: number[];
    along: Along | null;
    x: number;
    t: number;
    snap: string;
    shots: string;
    roll: boolean;
    moved: boolean;
    magnet: ReturnType<typeof makeSnapper>;
  } | null = null;
  let scrub: { resume: boolean } | null = null;
  let transitionDrag: {
    shot: number;
    pointer: number;
    edge: -1 | 0 | 1;
    x: number;
    len: number;
    snap: string;
  } | null = null;
  let animDrag: {
    i: number;
    slot: "in" | "out";
    anchor: number;
    inAnchor: number;
    outAnchor: number;
    seam: boolean;
    startX: number;
    pointer: number;
    want: number;
    was: number;
    wasIn: number;
    wasOut: number;
    snap: string;
  } | null = null;
  let freezeDrag: {
    i: number;
    pointer: number;
    edge: -1 | 1;
    x: number;
    duration: number;
    now: number;
    snap: string;
    secondsPerPixel: number;
  } | null = null;
  let freezeMove: {
    i: number;
    pointer: number;
    x: number;
    start: number;
    target: number;
    phase: "pending" | "dragging";
    magnet: ReturnType<typeof makeSnapper>;
  } | null = null;
  // A press on a block: a click picks the shot, a mouse drag draws the box over the rows (rowbox.ts), a touch drag scrubs
  let press: { x: number; y: number; touch: boolean; shot: number; add: boolean } | null = null;

  const startScrub = () => {
    scrub = { resume: S.playing };
    holdView(true);
    if (S.playing) setPlaying(false);
  };
  c.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const { x, y, w, h } = local(e),
      touch = e.pointerType === "touch",
      i = keyUnder(x, w, touch),
      add = e.shiftKey || e.ctrlKey || e.metaKey;
    if (get().blade) {
      if (S.playing) setPlaying(false);
      seek(snapped(timeAt(x, w), view().v / w, noSnap(e)));
      splitShot();
      return;
    }
    c.setPointerCapture(e.pointerId);
    const t = timeAt(x, w),
      freeze = freezeAt(t);
    if (freeze >= 0 && !onPlayhead(x, w, touch)) {
      set(transitionSelection({ kind: "freeze", index: freeze }, get().side));
      const f = freezesOf(timing)[freeze],
        [t0, t1] = freezeRange(timing, timingClock, freeze),
        reach = (view().v / w) * (touch ? 12 : 6);
      const edge = t - t0 < reach ? -1 : t1 - t < reach ? 1 : 0;
      holdView(true);
      if (S.playing) setPlaying(false);
      if (edge)
        freezeDrag = {
          i: freeze,
          pointer: e.pointerId,
          edge,
          x,
          duration: f.duration,
          now: f.duration,
          snap: timingDoc.snapshot(),
          secondsPerPixel: view().v / w,
        };
      else if (!timing.main)
        freezeMove = {
          i: freeze,
          pointer: e.pointerId,
          x,
          start: t0,
          target: t0,
          phase: "pending",
          magnet: makeSnapper(),
        };
      S.dirty = true;
      return;
    }
    const tr = transitionUnder(x, y, w);
    const edge = animEdgeAt(x, y, w, h, touch);
    const shotPicked = edge ? get().shotPick === edge.i || get().shotPicks.includes(edge.i) : false;
    // Band handles win when the shot is picked or there is no transition box directly over the cut; on an unpicked shot's cut,
    // clicking the transition box picks the transition instead of getting hijacked by a nearby handle
    if (edge && !onPlayhead(x, w, touch) && (tr <= 0 || shotPicked)) {
      set({
        ...transitionSelection({ kind: "shot", index: edge.i, side: "anim" }, get().side),
        animSlot: edge.slot,
      });
      S.dirty = true;
      holdView(true);
      if (S.playing) setPlaying(false);
      const wasIn = lenOf(edge.i, "in"),
        wasOut = lenOf(edge.i, "out"),
        was = edge.slot === "in" ? wasIn : wasOut;
      animDrag = {
        i: edge.i,
        slot: edge.slot,
        anchor: edge.anchor,
        inAnchor: edge.inAnchor ?? edge.anchor,
        outAnchor: edge.outAnchor ?? edge.anchor,
        seam: edge.seam,
        startX: x,
        pointer: e.pointerId,
        want: was,
        was,
        wasIn,
        wasOut,
        snap: shotsDoc.snapshot(),
      };
      c.style.cursor = "ew-resize";
      drawCamRow();
      return;
    }
    if (tr > 0 && !onPlayhead(x, w, touch)) {
      const b = transitionBox(tr, w),
        trEdge = x - b.left < 6 ? -1 : b.right - x < 6 ? 1 : 0;
      pickTransition(tr);
      transitionDrag = {
        shot: tr,
        pointer: e.pointerId,
        edge: trEdge,
        x,
        len: transitionDuration(tr),
        snap: shotsDoc.snapshot(),
      };
      drawCamRow();
      return;
    }
    if (i < 0) {
      if (onPlayhead(x, w, touch)) {
        startScrub();
        return;
      }
      press = { x, y, touch, shot: shotAtX(x, w), add };
      if (!touch) boxStart(e, add);
      return;
    }
    if (add) {
      const p = picked();
      pickAcross({
        ...p,
        shots: [],
        cam: p.cam.includes(i) ? p.cam.filter((k) => k !== i) : [...p.cam, i],
      });
      return;
    }
    const along = movable(i) && picks().includes(i) ? alongWith("cam") : null,
      group =
        movable(i) && (picks().length > 1 || along) && picks().includes(i)
          ? picks().filter(movable)
          : [i];
    if (group.length === 1 && !along) setKey(i);
    if (movable(i) || rollable(i))
      drag = {
        i,
        group,
        along,
        x,
        t: keys[i].t,
        snap: snapshot(),
        shots: shotsDoc.snapshot(),
        roll: !movable(i),
        moved: false,
        magnet: makeSnapper(),
      };
    else {
      seek(keys[i].t);
      say(
        i === 0
          ? "The film's first keyframe stays at 0"
          : "This film keeps its shots in code (no shotsTimeline). Ask the AI to move the cut",
      );
    }
  });
  c.addEventListener("pointermove", (e) => {
    if (animDrag) {
      if (e.pointerId !== animDrag.pointer) return;
      const { x, w } = local(e),
        d = animDrag;
      if (d.seam) {
        if (Math.abs(x - d.startX) < 1) return;
        d.slot = disambiguateSeamSlot(x - d.startX);
        d.anchor = d.slot === "in" ? d.inAnchor : d.outAnchor;
        d.was = d.slot === "in" ? d.wasIn : d.wasOut;
        d.want = d.was;
        d.seam = false;
        set({ animSlot: d.slot });
      }
      const want =
        Math.round(
          Math.max(0.1, d.slot === "in" ? timeAt(x, w) - d.anchor : d.anchor - timeAt(x, w)) * 100,
        ) / 100;
      shotsDoc.restore(d.snap);
      setAmount(d.i, d.slot, want, false);
      d.want = lenOf(d.i, d.slot);
      c.style.cursor = "ew-resize";
      say(`${d.slot === "in" ? "In" : "Out"} animation: ${d.want.toFixed(2)} s`, 1200);
      return;
    }
    if (freezeMove) {
      const { x, w } = local(e),
        d = freezeMove,
        perPx = view().v / w;
      if (d.phase === "pending" && Math.abs(x - d.x) < 3) return;
      d.phase = "dragging";
      const freezes = freezesOf(timing);
      const targets = [
        0,
        S.t,
        ...SHOTS_OUT.map((s) => s.t),
        ...freezes.flatMap((_, i) => (i === d.i ? [] : freezeRange(timing, timingClock, i))),
      ];
      const snap = d.magnet(
        Math.max(0, d.start + (x - d.x) * perPx),
        [0, freezes[d.i].duration],
        targets,
        perPx,
        noSnap(e),
        true,
      );
      d.target = snap.time;
      if (get().mainMagnet) {
        const boundaries = [
          0,
          timingClock.duration,
          ...SHOTS_OUT.flatMap((_, i) =>
            playRanges(timingClock, ...sourceShot(i)).flatMap((s) => [s.from, s.to]),
          ),
        ];
        const at = timeAt(x, w),
          nearest = boundaries.reduce((best, t) =>
            Math.abs(t - at) < Math.abs(best - at) ? t : best,
          );
        const [from, to] = freezeRange(timing, timingClock, d.i);
        d.target = nearest >= to ? nearest - (to - from) : nearest;
      }
      const candidate = structuredClone(timing),
        index = moveFreeze(candidate, d.i, d.target, timingClock.sourceDuration, get().mainMagnet);
      const [from, to] = freezeRange(
        candidate,
        compileTiming(candidate, timingClock.sourceDuration),
        index,
      );
      freezeGhost = { index: d.i, from, to };
      snapLine(
        get().mainMagnet
          ? from
          : snap.target === null
            ? null
            : snappedTo([from, to], [snap.target]),
      );
      c.style.cursor = "default";
      drawCamRow();
      return;
    }
    if (freezeDrag) {
      const { x } = local(e),
        d = freezeDrag;
      d.now = Math.max(
        1 / 30,
        Math.round((d.duration + (x - d.x) * d.secondsPerPixel * d.edge) * 30) / 30,
      );
      timingDoc.restore(d.snap);
      setFreezeDuration(d.i, d.now, true, d.edge);
      c.style.cursor = "ew-resize";
      return;
    }
    const { x, y, w, h } = local(e),
      { v } = view();
    if (transitionDrag) {
      const { shot, edge, x: start } = transitionDrag;
      if (edge && Math.abs(x - start) >= 2) setTransitionEdge(shot, edge, timeAt(x, w));
      return;
    }
    if (scrub) {
      seek(timeAt(x, w));
      return;
    }
    if (press) {
      if (!press.touch) {
        boxMove(e);
        return;
      }
      if (Math.hypot(x - press.x, y - press.y) >= 4) {
        press = null;
        startScrub();
        seek(timeAt(x, w));
      }
      return;
    }
    if (!drag && get().blade) {
      c.style.cursor = get().shots ? BLADE_CURSOR : "not-allowed";
      Object.assign(bladeLine, {
        row: get().shots ? "cam" : null,
        t: snapped(timeAt(x, w), v / w, noSnap(e)),
      });
      drawCamRow();
      return;
    }
    if (!drag) {
      const t = timeAt(x, w),
        f = freezeAt(t);
      if (f >= 0) {
        const [from, to] = freezeRange(timing, timingClock, f);
        c.style.cursor = (Math.min(t - from, to - t) / v) * w < 6 ? "ew-resize" : "default";
        return;
      }
      const s = shotAtX(x, w);
      if (s !== hover) {
        hover = s;
        drawCamRow();
      }
      const tr = transitionUnder(x, y, w);
      const edge = animEdgeAt(x, y, w, h, false);
      const shotPicked = edge
        ? get().shotPick === edge.i || get().shotPicks.includes(edge.i)
        : false;
      if (tr > 0 && !(edge && shotPicked) && !onPlayhead(x, w, false)) {
        const b = transitionBox(tr, w);
        c.style.cursor = x - b.left < 6 || b.right - x < 6 ? "ew-resize" : "pointer";
        return;
      }
      const i = keyUnder(x, w, false);
      c.style.cursor = edge
        ? "ew-resize"
        : i < 0
          ? onPlayhead(x, w, false)
            ? "ew-resize"
            : "default"
          : rollable(i)
            ? "ew-resize"
            : "default";
      return;
    }
    if (!drag.moved && Math.abs(x - drag.x) < 3) return;
    drag.moved = true;
    c.style.cursor = drag.roll ? "ew-resize" : "default";
    restore(drag.snap);
    shotsDoc.restore(drag.shots);
    const i = drag.i,
      snap = drag.magnet(
        drag.t + ((x - drag.x) / w) * v,
        [0],
        snapPoints(),
        v / w,
        noSnap(e),
        true,
      ),
      to = snap.time;
    if (drag.group.length > 1 || drag.along) {
      const [lo, hi] = groupRoom(drag.group),
        { along } = drag,
        d = Math.max(lo, along?.room[0] ?? lo, Math.min(hi, along?.room[1] ?? hi, to - drag.t));
      shiftCamKeys(drag.group, d, preview);
      along?.preview(d);
      snapLine(snap.target === null ? null : snappedTo([drag.t + d], [snap.target]));
      say(
        `${drag.group.length + (along?.count ?? 0)} ${along ? "picks" : "keyframes"} ${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(2)} s${noSnap(e) ? "" : " (Shift: no snapping)"}`,
        1500,
      );
      return;
    }
    const [lo, hi] = drag.roll ? rollRoom(i) : room(i),
      t = Math.max(lo, Math.min(hi, to));
    if (drag.roll) previewRoll(i, t);
    else
      preview((ks) => {
        ks[i].t = Math.round(t * 1000) / 1000;
      });
    snapLine(snap.target === null ? null : snappedTo([t], [snap.target]));
    say(
      `${drag.roll ? "Cut" : "Keyframe"} ${stamp(drag.t)} → ${stamp(t)}${noSnap(e) ? "" : " (Shift: no snapping)"}`,
      1500,
    );
  });
  const up = (e: PointerEvent) => {
    if (animDrag) {
      if (e.pointerId !== animDrag.pointer) return;
      const d = animDrag;
      animDrag = null;
      shotsDoc.restore(d.snap);
      if (e.type === "pointerup" && d.want !== d.was) setAmount(d.i, d.slot, d.want);
      holdView(false);
      c.style.cursor = "";
      drawCamRow();
      return;
    }
    if (freezeMove) {
      const d = freezeMove;
      freezeMove = null;
      freezeGhost = null;
      if (e.type === "pointerup" && d.phase === "dragging" && Math.abs(d.target - d.start) > 1e-6)
        relocateFreeze(d.i, d.target);
      holdView(false);
      snapLine(null);
      c.style.cursor = "";
      drawCamRow();
      return;
    }
    if (freezeDrag) {
      const d = freezeDrag;
      freezeDrag = null;
      timingDoc.restore(d.snap);
      if (e.type === "pointerup" && d.now !== d.duration)
        setFreezeDuration(d.i, d.now, false, d.edge);
      holdView(false);
      c.style.cursor = "";
      return;
    }
    if (transitionDrag) {
      const { shot, snap, len } = transitionDrag,
        now = transitionDuration(shot);
      transitionDrag = null;
      shotsDoc.restore(snap);
      if (now !== len && e.type === "pointerup") setTransitionDuration(shot, now);
      c.style.cursor = "";
      return;
    }
    if (press) {
      const { shot, add } = press;
      press = null;
      if (boxEnd()) return;
      if (e.type === "pointerup" && !add) {
        if (shot < 0) {
          set(transitionSelection({ kind: "none" }, get().side));
          S.dirty = true;
        } else pickShot(shot);
      }
      return;
    }
    if (scrub) {
      const r = scrub.resume;
      scrub = null;
      holdView(false);
      if (r) setPlaying(true);
      return;
    }
    if (!drag) return;
    snapLine(null);
    const { snap, shots, roll, moved, i, group, along, t: was } = drag;
    drag = null;
    c.style.cursor = "";
    // A plain click brings the picture to the key, so the Camera tab and the frame show the same moment; on a picked group it
    // picks that key alone, as CapCut does
    if (!moved) {
      if (group.length > 1 || along) setKey(i);
      seek(keys[i].t);
      return;
    }
    const t = keys[i].t;
    restore(snap);
    shotsDoc.restore(shots);
    along?.restore();
    if (e.type !== "pointerup" || t === was) return;
    if (along)
      together(() => {
        shiftCamKeys(group, r3(t - was));
        along.commit(r3(t - was));
      });
    else if (group.length > 1) shiftCamKeys(group, r3(t - was));
    else if (roll) rollCut(i, t);
    else
      edit((ks) => {
        ks[i].t = t;
      });
  };
  c.addEventListener("pointerup", up);
  c.addEventListener("pointercancel", up);
  c.addEventListener("lostpointercapture", up);
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || (!freezeDrag && !freezeMove && !transitionDrag && !animDrag))
        return;
      const pointer =
        freezeDrag?.pointer ?? freezeMove?.pointer ?? transitionDrag?.pointer ?? animDrag!.pointer;
      if (freezeMove) {
        freezeMove = null;
        freezeGhost = null;
        holdView(false);
        snapLine(null);
        drawCamRow();
      } else if (freezeDrag) {
        const d = freezeDrag;
        freezeDrag = null;
        timingDoc.restore(d.snap);
        holdView(false);
      } else if (transitionDrag) {
        const d = transitionDrag;
        transitionDrag = null;
        shotsDoc.restore(d.snap);
      } else if (animDrag) {
        const d = animDrag;
        animDrag = null;
        shotsDoc.restore(d.snap);
        holdView(false);
        drawCamRow();
      }
      c.style.cursor = "";
      if (c.hasPointerCapture(pointer)) c.releasePointerCapture(pointer);
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );
  c.addEventListener("pointerleave", () => {
    const was = hover;
    hover = -1;
    if (bladeLine.row === "cam") bladeLine.row = null;
    if (was >= 0 || get().blade) drawCamRow();
  });
  c.addEventListener("wheel", timelineWheel, { passive: false });
  new ResizeObserver(drawCamRow).observe(c);
};
