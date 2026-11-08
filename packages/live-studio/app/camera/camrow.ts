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
import { BLADE_CURSOR } from "../components/cursor";
import { easeFn } from "../core/ease";
import { shotIndex } from "../core/film";
import { S } from "../core/state";
import { get, noSnap, say } from "../core/store";
import { r3, snapTo, stamp } from "../core/time";
import { seek, setPlaying } from "../playback/transport";
import { bladeLine } from "../timeline/blade";
import { keyReach, PICK, REACH, sized, UI_FONT } from "../timeline/canvas";
import { alongWith, type Along, inBox, NONE, pickAcross, picked } from "../timeline/across";
import { boxEnd, boxMove, boxStart } from "../timeline/rowbox";
import { holdView, marks, onPlayhead, timeAt, timelineWheel, view } from "../timeline/timeline";
import { animOf, lenOf, pickShot, shotSpan } from "./anim";
import { together } from "../core/doc";
import { type CamKey, DEFAULT_EASE, edit, groupRoom, holds, keys, movable, preview, previewRoll, restore, rollable, rollCut, rollRoom, room, setKey, shiftCamKeys, snapshot, splitShot } from "./cam";
import { shotsDoc } from "./shots";

const COLOR = {
  bg: "#100F0F", block: "#164F4A", hover: "#1A5A54", head: "#123E3A", text: "#E6E4D9", dim: "#9FBDB8",
  speed: "rgba(208,162,21,.32)", speedLine: "#D0A215", key: "#E6E4D9", cut: "#878580", anim: "rgba(255,252,240,.55)",
};
const PAD = 2, HEAD = 15, BAND = 4, FOOT = 3; // FOOT: room under the bands for the picked outline

let xs: number[] = []; // each key's x as last drawn, for the pointer
let hover = -1; // the block under the pointer
const picks = () => { const { camKey: k, camPicks: ps } = get(); return ps.length ? ps : k !== null ? [k] : []; };

// The block a key belongs to: a cut opens its shot, any other key on a cut's second is the last of the shot before
const owner = (i: number) => shotIndex(Math.max(0, keys[i].cut ? keys[i].t : keys[i].t - 1e-4));
const shotAtX = (x: number, w: number) => { const t = timeAt(x, w); return t < 0 || t > DURATION || !SHOTS_OUT.length ? -1 : shotIndex(t); };

const drawSpeed = (g: CanvasRenderingContext2D, x0: number, x1: number, ease: CamKey["ease"], top: number, floor: number) => {
  const f = easeFn(ease, DEFAULT_EASE);
  if (!f) return;
  const n = Math.max(8, Math.min(120, Math.round(x1 - x0))), d = 1 / n, speed: number[] = [];
  for (let j = 0; j <= n; j++) { const x = Math.min(1 - d / 2, Math.max(d / 2, j * d)); speed.push(Math.max(0, (f(x + d / 2) - f(x - d / 2)) / d)); }
  const peak = Math.max(1e-6, ...speed), y = (s: number) => floor - (s / peak) * (floor - top);
  g.beginPath(); g.moveTo(x0, floor);
  speed.forEach((s, j) => g.lineTo(x0 + (j / n) * (x1 - x0), y(s)));
  g.lineTo(x1, floor); g.closePath();
  g.fillStyle = COLOR.speed; g.fill();
  g.beginPath(); speed.forEach((s, j) => (j ? g.lineTo : g.moveTo).call(g, x0 + (j / n) * (x1 - x0), y(s)));
  g.strokeStyle = COLOR.speedLine; g.lineWidth = 1; g.stroke();
};

const drawBlock = (g: CanvasRenderingContext2D, i: number, X: (s: number) => number, w: number, h: number, on: boolean) => {
  const [s, e] = shotSpan(i), x0 = X(s) + 1, x1 = X(e) - 1;
  if (x1 < 0 || x0 > w || x1 - x0 < 1) return;
  const y0 = PAD, y1 = h - PAD, cx0 = Math.max(-4, x0), cx1 = Math.min(w + 4, x1), bw = cx1 - cx0;
  g.save();
  g.beginPath(); g.roundRect(cx0, y0, bw, y1 - y0, 4); g.clip();
  g.fillStyle = hover === i ? COLOR.hover : COLOR.block; g.fillRect(cx0, y0, bw, y1 - y0);
  g.fillStyle = COLOR.head; g.fillRect(cx0, y0, bw, HEAD);
  if (bw > 24) {
    const name = S.comments[i] || `Shot ${i}`, left = Math.max(x0, 0) + 5, mid = y0 + HEAD / 2 + 0.5;
    g.font = `500 11px ${UI_FONT}`; g.fillStyle = COLOR.text; g.fillText(`${i}  ${name}`, left, mid);
    const nw = g.measureText(`${i}  ${name}`).width;
    g.font = `11px ${UI_FONT}`; g.fillStyle = COLOR.dim; g.fillText(`${(e - s).toFixed(1)}s`, left + nw + 8, mid);
  }
  // The camera's speed between this shot's keys
  const top = y0 + HEAD + 3, foot = y1 - FOOT - BAND, floor = foot - 2;
  for (let k = 1; k < keys.length; k++) {
    const k0 = keys[k - 1], k1 = keys[k];
    if (k1.cut || k1.t <= k0.t || k0.t < s - 1e-6 || k1.t > e + 1e-6) continue;
    const a = X(k0.t), b = X(k1.t);
    if (b < 0 || a > w) continue;
    if (holds(k0, k1)) {
      g.fillStyle = COLOR.cut; g.fillRect(Math.max(cx0, a), floor - 1, Math.min(cx1, b) - Math.max(cx0, a), 1);
      if (b - a > 70) { g.font = `11px ${UI_FONT}`; g.fillStyle = COLOR.dim; g.fillText("hold", Math.max(cx0, a) + 10, (top + floor) / 2); }
      continue;
    }
    drawSpeed(g, a, b, k1.ease, top, floor);
  }
  // In, Out, Combo at the foot of the block, each as long as it runs
  const an = animOf(i);
  g.fillStyle = COLOR.anim;
  if (an.combo) { g.setLineDash([3, 3]); g.strokeStyle = COLOR.anim; g.lineWidth = BAND; g.beginPath(); g.moveTo(cx0, foot + BAND / 2); g.lineTo(cx1, foot + BAND / 2); g.stroke(); g.setLineDash([]); }
  if (an.in) g.fillRect(x0, foot, Math.max(3, X(s + lenOf(i, "in")) - x0), BAND);
  if (an.out) { const a = X(e - lenOf(i, "out")); g.fillRect(a, foot, Math.max(3, x1 - a), BAND); }
  g.restore();
  if (on || get().shotPick === i) { g.strokeStyle = PICK; g.lineWidth = 2; g.beginPath(); g.roundRect(cx0 + 1, y0 + 1, bw - 2, y1 - y0 - 2, 3); g.stroke(); }
};

export const drawCamRow = () => {
  const c = S.el?.camrow;
  if (!c || !get().cam || !c.getClientRects().length) return;
  const { g, w, h } = sized(c);
  if (!c.width) return;
  const { a, v } = view(), X = (s: number) => ((s - a) / v) * w, picked = new Set(picks());
  g.fillStyle = COLOR.bg; g.fillRect(0, 0, w, h);
  g.textBaseline = "middle";
  // A block is picked when all its keys that move are: what the box picks, as CapCut's box picks whole clips
  const all = SHOTS_OUT.map(() => true), any = SHOTS_OUT.map(() => false);
  keys.forEach((_, i) => { if (!movable(i)) return; const j = owner(i); any[j] = true; if (!picked.has(i)) all[j] = false; });
  SHOTS_OUT.forEach((_, i) => drawBlock(g, i, X, w, h, any[i] && all[i]));
  xs = keys.map((k) => X(k.t));
  const y = PAD + HEAD + (h - PAD * 2 - HEAD - BAND - FOOT) / 2, r = 5;
  keys.forEach((k, i) => {
    const x = xs[i];
    if (x < -REACH || x > w + REACH) return;
    g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath();
    g.fillStyle = k.cut || i === 0 ? COLOR.cut : COLOR.key; g.fill();
    if (picked.has(i)) { g.strokeStyle = PICK; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y - r - 3); g.lineTo(x + r + 3, y); g.lineTo(x, y + r + 3); g.lineTo(x - r - 3, y); g.closePath(); g.stroke(); }
  });
  if (get().blade && bladeLine.row === "cam") {
    const x = Math.round(X(bladeLine.t));
    g.fillStyle = "#000"; g.fillRect(x - 1, 0, 3, h);
    g.fillStyle = "#FFFCF0"; g.fillRect(x, 0, 1, h);
  }
  const t = X(S.t);
  g.fillStyle = "#000"; g.fillRect(t - 2, 0, 4, h);
  g.fillStyle = "#EC8B49"; g.fillRect(t - 1, 0, 2, h);
};

const snapPoints = () => [S.t, ...S.voiceOut.flatMap((l) => l.words.map((w) => w.s))];
const snapped = (s: number, perPx: number, off: boolean) => snapTo(s, snapPoints(), perPx, off, true);
// The key under x: the nearest within reach; of a shot's last key and the cut on the same second, the cut when it can roll (its
// last key goes with it), else the last key
const keyAt = (x: number, touch: boolean) => {
  const reach = keyReach(touch);
  let best = -1, d = reach;
  xs.forEach((kx, i) => { const e = Math.abs(kx - x) - (rollable(i) ? 0.6 : movable(i) ? 0.5 : 0); if (e <= d) { d = e; best = i; } });
  return best;
};

// As on the key rows: the playhead line comes first over the keys and cuts behind it, except the picked key
const keyUnder = (x: number, w: number, touch: boolean) => { const i = keyAt(x, touch); return i >= 0 && onPlayhead(x, w, touch) && !picks().includes(i) ? -1 : i; };

// The shot block under a right-click, for its menu (CameraTrack.tsx); -1 off the film
export const shotAtPointer = (e: { clientX: number }) => {
  const c = S.el.camrow, r = c.getBoundingClientRect();
  return shotAtX(e.clientX - r.left, r.width);
};

// The box over the rows (rowbox.ts), once it reaches this row, picks every block it touches with all its keys, as CapCut's box
// picks every clip it touches; a click on a diamond (Shift or Ctrl adds) picks one key
const keysInBox = (r: { x0: number; x1: number; y0: number; y1: number }) => {
  const c = S.el.camrow.getBoundingClientRect();
  if (!c.height || r.y1 < c.top || r.y0 > c.bottom || !SHOTS_OUT.length) return [];
  const t0 = timeAt(r.x0 - c.left, c.width), t1 = timeAt(r.x1 - c.left, c.width);
  if (t1 < 0 || t0 > DURATION) return [];
  const a = shotIndex(Math.max(0, t0)), b = shotIndex(Math.min(DURATION - 1e-3, t1));
  return keys.flatMap((_, i) => { const j = owner(i); return j >= a && j <= b ? [i] : []; });
};

export const attachCamRow = () => {
  const c = S.el.camrow;
  marks.cam = drawCamRow;
  inBox.cam = keysInBox;
  const local = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height }; };
  // group: the picked keys that move with the one held (just it when it is alone)
  let drag: { i: number; group: number[]; along: Along | null; x: number; t: number; snap: string; shots: string; roll: boolean; moved: boolean } | null = null;
  let scrub: { resume: boolean } | null = null;
  // A press on a block: a click picks the shot, a mouse drag draws the box over the rows (rowbox.ts), a touch drag scrubs
  let press: { x: number; y: number; touch: boolean; shot: number; add: boolean } | null = null;

  const startScrub = () => { scrub = { resume: S.playing }; holdView(true); if (S.playing) setPlaying(false); };
  c.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const { x, y, w } = local(e), touch = e.pointerType === "touch", i = keyUnder(x, w, touch), add = e.shiftKey || e.ctrlKey || e.metaKey;
    if (get().blade) {
      if (S.playing) setPlaying(false);
      seek(snapped(timeAt(x, w), view().v / w, noSnap(e)));
      splitShot();
      return;
    }
    c.setPointerCapture(e.pointerId);
    if (i < 0) {
      if (onPlayhead(x, w, touch)) { startScrub(); return; }
      press = { x, y, touch, shot: shotAtX(x, w), add };
      if (!touch) boxStart(e, add);
      return;
    }
    if (add) { const p = picked(); pickAcross({ ...p, cam: p.cam.includes(i) ? p.cam.filter((k) => k !== i) : [...p.cam, i] }); return; }
    const along = movable(i) && picks().includes(i) ? alongWith("cam") : null, group = (picks().length > 1 || along) && picks().includes(i) ? picks() : [i];
    if (group.length === 1 && !along) setKey(i);
    if (movable(i) || rollable(i)) drag = { i, group, along, x, t: keys[i].t, snap: snapshot(), shots: shotsDoc.snapshot(), roll: !movable(i), moved: false };
    else { seek(keys[i].t); say(i === 0 ? "The film's first keyframe stays at 0" : "This film keeps its shots in code (no shotsTimeline). Ask the AI to move the cut"); }
  });
  c.addEventListener("pointermove", (e) => {
    const { x, y, w } = local(e), { v } = view();
    if (scrub) { seek(timeAt(x, w)); return; }
    if (press) {
      if (!press.touch) { boxMove(e); return; }
      if (Math.hypot(x - press.x, y - press.y) >= 4) { press = null; startScrub(); seek(timeAt(x, w)); }
      return;
    }
    if (!drag && get().blade) {
      c.style.cursor = get().shots ? BLADE_CURSOR : "not-allowed";
      Object.assign(bladeLine, { row: get().shots ? "cam" : null, t: snapped(timeAt(x, w), v / w, noSnap(e)) });
      drawCamRow();
      return;
    }
    if (!drag) {
      const i = keyUnder(x, w, false), s = shotAtX(x, w);
      c.style.cursor = i < 0 ? (onPlayhead(x, w, false) ? "ew-resize" : "default") : rollable(i) ? "ew-resize" : movable(i) ? "grab" : "default";
      if (s !== hover) { hover = s; drawCamRow(); }
      return;
    }
    if (!drag.moved && Math.abs(x - drag.x) < 3) return;
    drag.moved = true;
    c.style.cursor = drag.roll ? "ew-resize" : "grabbing";
    restore(drag.snap);
    shotsDoc.restore(drag.shots);
    const i = drag.i, to = snapped(drag.t + ((x - drag.x) / w) * v, v / w, noSnap(e));
    if (drag.group.length > 1 || drag.along) {
      const [lo, hi] = groupRoom(drag.group), { along } = drag, d = Math.max(lo, along?.room[0] ?? lo, Math.min(hi, along?.room[1] ?? hi, to - drag.t));
      shiftCamKeys(drag.group, d, preview);
      along?.preview(d);
      say(`${drag.group.length + (along?.count ?? 0)} ${along ? "picks" : "keyframes"} ${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(2)} s${noSnap(e) ? "" : " (Shift: no snapping)"}`, 1500);
      return;
    }
    const [lo, hi] = drag.roll ? rollRoom(i) : room(i), t = Math.max(lo, Math.min(hi, to));
    if (drag.roll) previewRoll(i, t);
    else preview((ks) => { ks[i].t = Math.round(t * 1000) / 1000; });
    say(`${drag.roll ? "Cut" : "Keyframe"} ${stamp(drag.t)} → ${stamp(t)}${noSnap(e) ? "" : " (Shift: no snapping)"}`, 1500);
  });
  const up = () => {
    if (press) {
      const { shot, add } = press;
      press = null;
      if (boxEnd()) return;
      if (!add) { pickAcross(NONE); pickShot(shot < 0 ? null : shot); }
      return;
    }
    if (scrub) { const r = scrub.resume; scrub = null; holdView(false); if (r) setPlaying(true); return; }
    if (!drag) return;
    const { snap, shots, roll, moved, i, group, along, t: was } = drag;
    drag = null;
    c.style.cursor = "";
    // A plain click brings the picture to the key, so the Camera tab and the frame show the same moment; on a picked group it
    // picks that key alone, as CapCut does
    if (!moved) { if (group.length > 1 || along) setKey(i); seek(keys[i].t); return; }
    const t = keys[i].t;
    restore(snap);
    shotsDoc.restore(shots);
    along?.restore();
    if (along) together(() => { shiftCamKeys(group, r3(t - was)); along.commit(r3(t - was)); });
    else if (group.length > 1) shiftCamKeys(group, r3(t - was));
    else if (roll) rollCut(i, t);
    else edit((ks) => { ks[i].t = t; });
  };
  c.addEventListener("pointerup", up);
  c.addEventListener("pointercancel", up);
  c.addEventListener("lostpointercapture", up);
  c.addEventListener("pointerleave", () => {
    const was = hover;
    hover = -1;
    if (bladeLine.row === "cam") bladeLine.row = null;
    if (was >= 0 || get().blade) drawCamRow();
  });
  c.addEventListener("wheel", timelineWheel, { passive: false });
  new ResizeObserver(drawCamRow).observe(c);
};
