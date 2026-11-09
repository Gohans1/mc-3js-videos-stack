// The sound tracks under the timeline, CapCut style, on the same seconds as the stretch drawn above them (timeline.ts): one row
// per track of audio.json (sound/tracks.ts), its name, mute and lock in the column beside it (sound/TrackHeads.tsx).
// A clip is dragged to move (up or down onto another track, or below the last one for a new track), by an edge to trim, and
// snaps to the playhead, cuts, words and other clips' edges (Shift: no snap), CapCut's line showing where (timeline/snapline.ts). The inset handle below each end of the label under the
// pointer or picked drags its fade in or out, as in CapCut and Premiere. A box dragged over empty space picks every clip
// it touches (Shift/Ctrl add to the pick), and the keys of the other rows it crosses (timeline/rowbox.ts, across.ts); dragging
// one picked clip moves all of it, and with Alt held copies of the clips alone (CapCut's drag to duplicate). A click on empty space
// drops the pick and moves the playhead there (rowbox.ts boxEnd); a touch dragged over empty space scrubs instead.
// A sound from the library is dragged in from the side panel (startCarry) or added at the playhead with its + button.
// In split mode (blade.ts) a click on a clip cuts it there instead.
import { DURATION, SHOTS_OUT as SHOTS } from "film/scene";
import { FPS, makeSnapper, r3, snappedTo, snapTo, stamp } from "../core/time";
import { S } from "../core/state";
import { type ClipRef } from "./slice";
import { get, noSnap, say } from "../core/store";
import { BLADE_CURSOR } from "../components/cursor";
import { bladeLine } from "../timeline/blade";
import { addClip, allClips, clipOf, cutBefore, edit, lanes, locked, peaksOf, picked, preview, restore, seconds, setClips, snapshot, span, splitClips } from "./sound";
import { together } from "../core/doc";
import { alongWith, type Along, inBox, pickAcross, picked as across } from "../timeline/across";
import { drawPlayhead, sized, tone, UI_FONT } from "../timeline/canvas";
import { boxEnd, boxMove, boxStart } from "../timeline/rowbox";
import { snapLine } from "../timeline/snapline";
import { holdView, marks, onPlayhead, timeAt, timelineWheel, view } from "../timeline/timeline";
import { addTrack, placeShift, same } from "./tracks";
import { seek, setPlaying } from "../playback/transport";
import { gainAt, gainPoints, GAIN_KEY_EPS, shiftGainTime, toggleGainKey } from "./gain";

// sound/TrackHeads.tsx lays its rows out on these
export const TRACK_H = 52, TOP = 2, ADD_H = 24;
const CLIP_H = 48, LABEL_H = 16;
// CapCut 9.7's audio clip, measured off the dev's screenshot (index.css --clip-audio and the rest): a navy clip, its level in
// 1 px cyan bars from the bottom, the name on a lighter tag. A bar within 1 dB of full scale gets an orange cap and one past it a
// red tip, Final Cut Pro's documented warning, which CapCut's look follows
const NEAR = 10 ** (-1 / 20);
const EDGE = 6, KNOB = 7; // KNOB: how near a fade handle the pointer must be, in px

type Box = { ref: ClipRef; x0: number; x1: number; y0: number; y1: number };
let boxes: Box[] = [];
let drop: { row: number; at: number } | null = null; // row = tracks.length: below the last track, a new one
let hover: ClipRef | null = null;
let floating: { refs: ClipRef[]; dy: number } | null = null;
const gainY = (gain: number) => LABEL_H + 5 + (1 - Math.max(0, Math.min(1, (gain + 60) / 96))) * (CLIP_H - LABEL_H - 9);
const fadeX = (x0: number, x1: number, x: number) => Math.max(x0 + 5, Math.min(x1 - 5, x));

const tracks = () => lanes?.tracks ?? [];
export const lanesHeight = () => TOP + tracks().length * TRACK_H + ADD_H;
const rowY = (k: number) => TOP + k * TRACK_H;
// The row under y; tracks.length is the strip below the last track, where a new one starts
const rowAt = (y: number) => Math.max(0, Math.min(tracks().length, Math.floor((y - TOP) / TRACK_H)));
const rowOf = (c: ClipRef) => tracks().findIndex((t) => t.id === clipOf(c)?.track);

const drawClip = (g: CanvasRenderingContext2D, ref: ClipRef, x0: number, x1: number, y: number, w: number) => {
  const c = clipOf(ref)!, on = picked(ref);
  const cx0 = Math.max(-2, x0), cx1 = Math.min(w + 2, x1);
  g.fillStyle = tone("clip-audio");
  g.beginPath(); g.roundRect(cx0, y, Math.max(2, cx1 - cx0), CLIP_H, 4); g.fill();
  // The file's level, scaled by the clip's gain so a quiet clip looks quiet: each bar the loudest peak of the 2 px it stands for
  const p = peaksOf(c.name), [from, to] = span(ref), px = (x1 - x0) / Math.max(1e-3, to - from);
  if (p && x1 - x0 > 6) {
    const start = c.start ?? 0, n = p.peaks.length, room = CLIP_H - LABEL_H - 3, base = y + CLIP_H - 1;
    const at = (x: number) => { const s = (x - x0) / px + start; return Math.floor((ref.list === "beds" ? ((s % (n * p.step)) + n * p.step) % (n * p.step) : s) / p.step); }; // a bed loops its file
    for (let x = Math.max(Math.ceil(cx0) + 1, 1); x < cx1 - 1; x += 2) {
      const i0 = at(x), i1 = Math.max(i0, at(x + 2) - 1);
      let v = 0;
      for (let i = i0; i <= i1 && i < n; i++) if (i >= 0 && p.peaks[i] > v) v = p.peaks[i];
      v *= 10 ** (gainAt(c, (x - x0) / px) / 20);
      if (v <= 0) continue;
      const bar = Math.max(1, Math.min(1, v) * room);
      g.fillStyle = tone("clip-wave"); g.fillRect(x, base - bar, 1, bar);
      if (v >= NEAR) { g.fillStyle = tone("level-near"); g.fillRect(x, base - bar, 1, 2); }
      if (v > 1) { g.fillStyle = tone("level-over"); g.fillRect(x, base - bar - 1, 1, 1); }
    }
  }
  // Fades as a darkened corner, with their handles on the clip the pointer is over or that is picked
  const fi = c.fadeIn ?? 0, fo = c.fadeOut ?? 0;
  g.fillStyle = "rgba(0,0,0,.45)";
  if (fi > 0) { g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + fi * px, y); g.lineTo(x0, y + CLIP_H); g.fill(); }
  if (fo > 0) { g.beginPath(); g.moveTo(x1, y); g.lineTo(x1 - fo * px, y); g.lineTo(x1, y + CLIP_H); g.fill(); }
  if (on || (hover && same(hover, ref))) {
    const from = Math.max(0, (cx0 - x0) / px), to = Math.min(span(ref)[1] - span(ref)[0], (cx1 - x0) / px);
    g.strokeStyle = "rgba(255,255,255,.65)"; g.lineWidth = 1; g.beginPath();
    for (const [i, k] of gainPoints(c, from, to).entries()) { const x = x0 + k.t * px, yy = y + gainY(k.gain); if (i) g.lineTo(x, yy); else g.moveTo(x, yy); }
    g.stroke();
    if (on) for (const k of c.gainKeys ?? []) {
      const x = x0 + k.t * px, yy = y + gainY(k.gain);
      if (k.t < 0 || k.t > span(ref)[1] - span(ref)[0] || x < 0 || x > w) continue;
      g.fillStyle = tone(Math.abs(S.t - span(ref)[0] - k.t) < GAIN_KEY_EPS ? "primary" : "pick");
      g.beginPath(); g.moveTo(x, yy - 3.5); g.lineTo(x + 3.5, yy); g.lineTo(x, yy + 3.5); g.lineTo(x - 3.5, yy); g.closePath(); g.fill();
    }
  }
  if ((on || (hover && same(hover, ref))) && x1 - x0 > KNOB * 4 && !locked(ref)) {
    g.fillStyle = tone("clip-audio"); g.strokeStyle = tone("pick"); g.lineWidth = 1.5;
    for (const hx of [x0 + fi * px, x1 - fo * px]) { g.beginPath(); g.arc(fadeX(x0, x1, hx), y + LABEL_H + 5, 3, 0, Math.PI * 2); g.fill(); g.stroke(); }
  }
  if (c.try) { g.fillStyle = tone("warn"); g.fillRect(cx0, y + CLIP_H - 2, Math.min(10, cx1 - cx0), 2); }
  g.save(); g.beginPath(); g.rect(cx0, y, cx1 - cx0 - 2, CLIP_H); g.clip();
  const lx = Math.max(x0, 0) + 3, tw = g.measureText(c.name).width;
  g.fillStyle = tone("clip-audio-tag"); g.beginPath(); g.roundRect(lx, y + 2, tw + 8, LABEL_H - 2, 3); g.fill();
  g.fillStyle = tone("clip-label"); g.fillText(c.name, lx + 4, y + 1 + LABEL_H / 2);
  g.restore();
  // Outside the clip, on the dark track, so the clip's own edge and fade handles stay seen
  if (on) { g.strokeStyle = tone("pick"); g.lineWidth = 2; g.beginPath(); g.roundRect(cx0 - 1, y - 1, cx1 - cx0 + 2, CLIP_H + 2, 4); g.stroke(); }
};

export const drawLanes = () => {
  const c = S.el?.lanes;
  if (!c || !lanes || !c.getClientRects().length) return;
  const height = lanesHeight();
  if (c.style.height !== `${height}px`) c.style.height = `${height}px`; // the resize observer draws it at that size
  const { g, w, h } = sized(c);
  if (!c.width) return;
  const { a, v } = view(), X = (s: number) => ((s - a) / v) * w, ts = tracks();
  // Each track's row a step lighter than the empty space under the last, as CapCut's
  g.fillStyle = tone("background"); g.fillRect(0, 0, w, h);
  g.fillStyle = tone("track"); g.fillRect(0, 0, w, TOP + ts.length * TRACK_H);
  g.fillStyle = tone("background");
  for (let i = 1; i <= ts.length; i++) g.fillRect(0, rowY(i) - 1, w, 1);
  // Cuts, faint, so a sound can be put on one by eye
  g.fillStyle = tone("grid");
  for (const s of SHOTS) if (s.t > a && s.t < a + v) g.fillRect(X(s.t), 0, 1, h);
  g.font = `12px ${UI_FONT}`; g.textBaseline = "middle";
  boxes = [];
  // A library sound under the pointer: its clips stay bright and ringed, the rest step back
  const lit = get().soundLit, solo = get().solo;
  for (const ref of allClips()) {
    const [s, e] = span(ref), k = rowOf(ref);
    if (k < 0 || e < a || s > a + v) continue;
    const x0 = X(s), x1 = Math.max(x0 + 4, X(e)), y = rowY(k) + (TRACK_H - CLIP_H) / 2, t = ts[k], shine = lit !== null && clipOf(ref)!.name === lit;
    g.globalAlpha = t.mute || (solo.length && !solo.includes(t.id)) || (lit !== null && !shine) ? 0.35 : 1;
    if (floating?.refs.some((r) => same(r, ref))) {
      g.fillStyle = tone("raised-3"); g.beginPath(); g.roundRect(x0, y, x1 - x0, CLIP_H, 4); g.fill();
    } else drawClip(g, ref, x0, x1, y, w);
    g.globalAlpha = 1;
    if (shine) { g.strokeStyle = tone("pick"); g.lineWidth = 1.5; g.beginPath(); g.roundRect(Math.max(-2, x0) - 1.5, y - 1.5, Math.min(w + 2, x1) - Math.max(-2, x0) + 3, CLIP_H + 3, 4); g.stroke(); }
    boxes.push({ ref, x0, x1, y0: y, y1: y + CLIP_H });
  }
  if (floating) for (const b of boxes) if (floating.refs.some((r) => same(r, b.ref))) drawClip(g, b.ref, b.x0, b.x1, b.y0 + floating.dy, w);
  // The strip under the last track takes a dropped clip as a new track. As in CapCut it stays blank and lights only under a drag;
  // words show only while there is no track at all, as CapCut's empty timeline asks for its first clip
  if (!ts.length) { g.fillStyle = tone("muted-foreground"); g.fillText("Drag a sound here from the Audio tab", 8, rowY(0) + ADD_H / 2); }
  if (drop) {
    const x = X(drop.at), y = rowY(drop.row), hh = drop.row === ts.length ? ADD_H : TRACK_H;
    g.globalAlpha = 0.18; g.fillStyle = tone("primary"); g.fillRect(0, y, w, hh); g.globalAlpha = 1;
    g.fillStyle = tone("primary"); g.fillRect(x - 1, y, 2, hh);
  }
  if (get().blade && bladeLine.row === "lanes") {
    const x = Math.round(X(bladeLine.t));
    g.fillStyle = "#000"; g.fillRect(x - 1, bladeLine.y0 - 3, 3, bladeLine.y1 - bladeLine.y0 + 6);
    g.fillStyle = tone("pick"); g.fillRect(x, bladeLine.y0 - 2, 1, bladeLine.y1 - bladeLine.y0 + 4);
  }
  drawPlayhead(g, X(S.t), h);
};

// ---------- Snapping: the playhead, cuts, word starts and the edges of every clip not being moved
const snapPoints = (skip: ClipRef[]) => {
  const out = [S.t, ...SHOTS.map((s) => s.t)];
  for (const l of S.voiceOut) for (const word of l.words) out.push(word.s);
  for (const r of allClips()) if (!skip.some((k) => same(k, r))) out.push(...span(r));
  return out;
};

const hit = (x: number, y: number, touch: boolean) => {
  const reach = touch ? 8 : 0;
  return boxes.findLast((b) => x >= b.x0 - reach && x <= b.x1 + reach && y >= b.y0 - reach / 2 && y <= b.y1 + reach / 2) ?? null;
};
// The clip under a right-click (ClipMenu.tsx), null on empty space
export const clipAtPointer = (e: { clientX: number; clientY: number }) => {
  const r = S.el.lanes.getBoundingClientRect();
  return hit(e.clientX - r.left, e.clientY - r.top, false)?.ref ?? null;
};
// The fade handle under the pointer: the clip's top strip, near where its fade in ends or its fade out starts
const knobAt = (b: Box, x: number, y: number, touch: boolean): "fadeIn" | "fadeOut" | null => {
  const c = clipOf(b.ref)!, [from, to] = span(b.ref), px = (b.x1 - b.x0) / Math.max(1e-3, to - from), r = touch ? KNOB * 2 : KNOB;
  if (b.x1 - b.x0 <= KNOB * 4 || Math.abs(y - b.y0 - LABEL_H - 5) > r) return null;
  const di = Math.abs(x - fadeX(b.x0, b.x1, b.x0 + (c.fadeIn ?? 0) * px)), dout = Math.abs(x - fadeX(b.x0, b.x1, b.x1 - (c.fadeOut ?? 0) * px));
  return Math.min(di, dout) > r ? null : di <= dout ? "fadeIn" : "fadeOut";
};
const clipsInBox = (m: { x0: number; x1: number; y0: number; y1: number }) => {
  const r = S.el.lanes.getBoundingClientRect();
  if (!r.height) return [];
  const x0 = m.x0 - r.left, x1 = m.x1 - r.left, y0 = m.y0 - r.top, y1 = m.y1 - r.top;
  return boxes.filter((b) => b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1 && !locked(b.ref)).map((b) => b.ref);
};

type Drag = {
  ref: ClipRef; group: ClipRef[]; mode: "move" | "start" | "end" | "fadeIn" | "fadeOut" | "gain" | "gain-key"; gainKey: number | null; x: number; y: number; snap: string;
  from: number; to: number; pts: number[]; moved: boolean; alone: boolean; x0: number; x1: number;
  copy: boolean; // CapCut's drag to duplicate (Alt held as the drag starts): copies move, the clips stay
  moving: ClipRef[]; // the clips the drag moves: the pick, or its copies
  along: Along | null; shift: number; // the other rows' picks moving with the clips (timeline/across.ts), and by how much
  magnet: ReturnType<typeof makeSnapper>;
};

export const attachLanes = () => {
  const c = S.el.lanes;
  marks.lanes = drawLanes;
  inBox.clips = clipsInBox;
  const local = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width }; };
  let drag: Drag | null = null;
  let scrub: { resume: boolean } | null = null;
  let box: { add: boolean } | null = null;
  const localTime = (b: Pick<Box, "x0" | "x1" | "ref">, x: number) => (x - b.x0) / (b.x1 - b.x0) * (span(b.ref)[1] - span(b.ref)[0]);
  const onGain = (b: Box, x: number, y: number) => (picked(b.ref) || !!hover && same(hover, b.ref)) && Math.abs(y - b.y0 - gainY(gainAt(clipOf(b.ref)!, localTime(b, x)))) <= 3;
  const gainKeyAt = (b: Box, x: number, y: number, touch: boolean) => {
    if (!picked(b.ref)) return null;
    const duration = span(b.ref)[1] - span(b.ref)[0], reach = touch ? 12 : 7;
    const i = clipOf(b.ref)!.gainKeys?.findIndex((k) => k.t >= 0 && k.t <= duration && Math.abs(x - b.x0 - k.t / duration * (b.x1 - b.x0)) <= reach && Math.abs(y - b.y0 - gainY(k.gain)) <= reach) ?? -1;
    return i >= 0 ? i : null;
  };
  // The playhead line over a clip's body is the playhead's; its trim edges and fade knobs stay the clip's
  const playheadGrab = (b: Box | null, x: number, y: number, w: number, touch: boolean) =>
    onPlayhead(x, w, touch) && (!b || (x > b.x0 + EDGE && x < b.x1 - EDGE && gainKeyAt(b, x, y, touch) === null && !knobAt(b, x, y, touch) && !onGain(b, x, y)));
  // Where a click cuts the clip under it: snapped to the playhead, cuts, words and other clips' edges, never to its own ends
  const bladeTime = (ref: ClipRef, x: number, w: number, off: boolean) => snapTo(timeAt(x, w), snapPoints([ref]), view().v / w, off, true);

  c.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const { x, y, w } = local(e), touch = e.pointerType === "touch", b = hit(x, y, touch), add = e.shiftKey || e.ctrlKey || e.metaKey;
    if (get().blade) {
      if (!b) return;
      if (locked(b.ref)) { say("This track is locked. Unlock it in the track header to cut it"); return; }
      splitClips([b.ref], bladeTime(b.ref, x, w, noSnap(e)));
      return;
    }
    c.setPointerCapture(e.pointerId);
    const grab = playheadGrab(b, x, y, w, touch);
    if (!b || grab) {
      if (touch || grab) {
        if (!grab) setClips([]);
        scrub = { resume: S.playing };
        holdView(true);
        if (S.playing) setPlaying(false);
      } else { box = { add }; boxStart(e, add); }
      return;
    }
    if (add) { const p = across(); pickAcross({ ...p, clips: picked(b.ref) ? p.clips.filter((q) => !same(q, b.ref)) : [...p.clips, b.ref] }); return; }
    if (locked(b.ref)) { setClips([b.ref]); say("This track is locked. Unlock it in the track header to edit"); return; }
    const was = picked(b.ref);
    if (!was) setClips([b.ref]);
    const group = get().clips.filter((r) => !locked(r)), along = was ? alongWith("clips") : null, many = group.length > 1 || !!along;
    const edge = touch ? 10 : EDGE, wide = b.x1 - b.x0 > edge * 3, knob = many ? null : knobAt(b, x, y, touch);
    const gainKey = many ? null : gainKeyAt(b, x, y, touch);
    const mode = gainKey !== null ? "gain-key" : knob ?? (many || !wide ? "move" : x <= b.x0 + edge ? "start" : x >= b.x1 - edge ? "end" : onGain(b, x, y) ? "gain" : "move");
    const [from, to] = span(b.ref);
    if (gainKey !== null) seek(from + clipOf(b.ref)!.gainKeys![gainKey].t);
    drag = { ref: b.ref, group, mode, gainKey, x, y, snap: snapshot(), from, to, pts: snapPoints(group), moved: false, alone: was && many, x0: b.x0, x1: b.x1, copy: false, moving: group, along, shift: 0, magnet: makeSnapper() };
  });

  // A drag near the top or bottom of the tracks' box scrolls it, so a clip can be taken to a track out of sight
  const edgeScroll = (e: PointerEvent) => {
    const box = c.closest<HTMLElement>("[data-tracks-scroll]"), r = box?.getBoundingClientRect();
    if (!box || !r) return;
    if (e.clientY > r.bottom - 18) box.scrollTop += 10; else if (e.clientY < r.top + 18) box.scrollTop -= 10;
  };
  c.addEventListener("pointermove", (e) => {
    if (drag?.moved) edgeScroll(e);
    const { x, y, w } = local(e), { v } = view(), perPx = v / w;
    if (scrub) { seek(timeAt(x, w)); return; }
    if (box) { boxMove(e); return; }
    if (!drag && get().blade) {
      const b = hit(x, y, false);
      c.style.cursor = !b ? "default" : locked(b.ref) ? "not-allowed" : BLADE_CURSOR;
      bladeLine.row = b && !locked(b.ref) ? "lanes" : null;
      if (b) Object.assign(bladeLine, { t: bladeTime(b.ref, x, w, noSnap(e)), y0: b.y0, y1: b.y1 });
      drawLanes();
      return;
    }
    if (!drag) {
      const b = hit(x, y, false), edge = b && get().clips.length < 2 && b.x1 - b.x0 > EDGE * 3 && (x <= b.x0 + EDGE || x >= b.x1 - EDGE);
      const knob = b && get().clips.length < 2 && !locked(b.ref) && knobAt(b, x, y, false);
      c.style.cursor = playheadGrab(b, x, y, w, false) ? "ew-resize" : !b ? "default" : locked(b.ref) ? "not-allowed" : gainKeyAt(b, x, y, false) !== null ? "default" : knob ? "ew-resize" : edge ? "col-resize" : onGain(b, x, y) ? "ns-resize" : "default";
      if ((hover && b ? !same(hover, b.ref) : hover !== (b?.ref ?? null))) { hover = b?.ref ?? null; drawLanes(); }
      return;
    }
    if (!drag.moved && Math.abs(x - drag.x) < 3 && Math.abs(y - drag.y) < (drag.mode.startsWith("gain") ? 1 : 6)) return;
    if (!drag.moved) drag.copy = e.altKey && drag.mode === "move" && !drag.along;
    drag.moved = true;
    c.style.cursor = drag.copy ? "copy" : drag.mode === "move" || drag.mode === "gain-key" ? "default" : drag.mode === "gain" ? "ns-resize" : drag.mode.startsWith("fade") ? "ew-resize" : "col-resize";
    const d = (x - drag.x) * perPx, off = noSnap(e), { ref, group, from, to, pts } = drag;
    restore(drag.snap);
    if (drag.mode === "gain" || drag.mode === "gain-key") {
      const change = (drag.y - y) * 96 / (CLIP_H - LABEL_H - 9) * (e.shiftKey ? .1 : 1), c0 = clipOf(ref)!;
      const key = drag.gainKey, base = key === null ? gainAt(c0, localTime({ x0: drag.x0, x1: drag.x1, ref }, drag.x)) : c0.gainKeys![key].gain;
      const gain = Math.round(Math.max(-60, Math.min(36, base + change)) * 10) / 10;
      const u = key === null ? null : r3(Math.max(0, (c0.gainKeys![key - 1]?.t ?? -1 / FPS) + 1 / FPS, Math.min(to - from, (c0.gainKeys![key + 1]?.t ?? to - from + 1 / FPS) - 1 / FPS, Math.round((c0.gainKeys![key].t + d) * FPS) / FPS)));
      preview((l) => {
        const c = l[ref.list][ref.i];
        if (key !== null) { c.gainKeys![key] = { t: u!, gain }; }
        else if (c.gainKeys?.length) { for (const k of c.gainKeys) k.gain = Math.round(Math.max(-60, Math.min(36, k.gain + gain - base)) * 10) / 10; }
        else c.gain = gain;
      });
      if (u !== null) seek(from + u);
      say(`Volume: ${gain.toFixed(1)} dB (Shift: fine adjustment)`, 1500);
      return;
    }
    if (drag.mode === "fadeIn" || drag.mode === "fadeOut") {
      const key = drag.mode, other = (clipOf(ref)![key === "fadeIn" ? "fadeOut" : "fadeIn"] as number | undefined) ?? 0;
      const raw = (clipOf(ref)![key] ?? 0) + (key === "fadeIn" ? d : -d), len = Math.max(0, Math.min(to - from - other, raw));
      preview((l) => { (l[ref.list][ref.i] as Record<string, unknown>)[key] = Math.round(len * 100) / 100; });
      say(`${clipOf(ref)!.name}: ${key === "fadeIn" ? "fade in" : "fade out"} ${len.toFixed(2)} s`, 1500);
      return;
    }
    let target: number | null = null, valid = true;
    preview((l) => {
      if (drag!.mode === "move") {
        // Copies of the pick go at the ends of their lists, the same each time the drag is redrawn from its snapshot
        const moving = drag!.moving = drag!.copy ? group.map((r): ClipRef => { const list = l[r.list] as unknown[]; list.push(structuredClone(list[r.i])); return { list: r.list, i: list.length - 1 }; }) : group;
        // The clip under the pointer snaps, by whichever end lands nearer a snap point; the rest of the pick moves as far
        const snapped = drag!.magnet(from + d, [0, to - from], pts, perPx, off);
        target = snapped.target;
        const starts = moving.map((r) => span(r)[0]);
        const room = drag!.along?.room ?? [-Infinity, Infinity];
        // Up or down by as many rows as the pointer went, the whole pick together, none past the strip for a new track
        const rows = moving.map(rowOf), n = l.tracks.length;
        const dk = Math.max(-Math.min(...rows), Math.min(n - Math.max(...rows), rowAt(y) - rowAt(drag!.y)));
        const fresh = rows.some((k) => k + dk === n) ? addTrack(l, ref.list).id : "";
        moving.forEach((r, k) => { if (dk) l[r.list][r.i].track = rows[k] + dk === n ? fresh : l.tracks[rows[k] + dk].id; });
        const shift = placeShift(l, moving, span, snapped.time - from, [Math.max(-Math.min(...starts), room[0]), Math.min(DURATION - 0.05 - Math.max(...starts), room[1])]);
        if (shift === null) { valid = false; return; }
        drag!.shift = shift;
        floating = { refs: moving, dy: y - drag!.y - dk * TRACK_H };
        moving.forEach((r) => {
          const e = l[r.list][r.i] as { from?: number; to?: number; at?: number; track?: string };
          if (r.list === "beds") { const len = e.to! - e.from!; e.from = r3(e.from! + shift); e.to = r3(e.from + len); } else e.at = r3(e.at! + shift);
        });
      } else if (drag!.mode === "end") {
        const snapped = drag!.magnet(to + d, [0], pts, perPx, off); target = snapped.target;
        const neighbours = allClips().filter((r) => !same(r, ref) && clipOf(r)!.track === clipOf(ref)!.track).map(span);
        const next = Math.min(Infinity, ...neighbours.filter(([a]) => a >= to - .02).map(([a]) => a));
        const file = ref.list === "sfx" ? seconds(clipOf(ref)!.name) : Infinity, e2 = Math.min(next, Math.max(from + 1 / FPS, snapped.time));
        if (ref.list === "beds") l.beds[ref.i].to = r3(e2);
        else { const s = l.sfx[ref.i]; s.length = r3(Math.min(e2 - from, file - (s.start ?? 0))); }
      } else {
        const snapped = drag!.magnet(from + d, [0], pts, perPx, off); target = snapped.target;
        const neighbours = allClips().filter((r) => !same(r, ref) && clipOf(r)!.track === clipOf(ref)!.track).map(span);
        const prev = Math.max(0, ...neighbours.filter(([, b]) => b <= from + .02).map(([, b]) => b));
        const s0 = Math.max(prev, Math.min(to - 1 / FPS, snapped.time));
        if (ref.list === "beds") cutBefore(l.beds[ref.i], "beds", s0);
        else {
          // A one-shot trimmed at its head starts later in its file, so what's left stays where it was
          const s = l.sfx[ref.i], into = r3(Math.max(0, (s.start ?? 0) + (s0 - from)));
          shiftGainTime(s, -(into - (s.start ?? 0)));
          s.at = r3(from + (into - (s.start ?? 0))); s.start = into; s.length = r3(to - s.at);
        }
      }
    });
    if (!valid) { floating = null; restore(drag.snap); drag.moving = group; drag.shift = 0; c.style.cursor = "not-allowed"; }
    if (drag.mode === "move") drag.along?.preview(drag.shift);
    const others = drag.mode === "move" ? group.length - 1 + (drag.along?.count ?? 0) : 0;
    const [a0, a1] = span(drag.moving[group.indexOf(ref)] ?? ref), many = others ? ` + ${others} more` : "";
    snapLine(target === null || !valid ? null : snappedTo(drag.mode === "move" ? [a0, a1] : drag.mode === "start" ? [a0] : [a1], [target]));
    say(`${drag.copy ? "Copy of " : ""}${clipOf(ref)!.name}${many}: ${stamp(a0)} → ${stamp(a1)}${off ? "" : " (Shift: no snapping)"}`, 1500);
  });

  const up = (e: PointerEvent) => {
    if (scrub) { const r = scrub.resume; scrub = null; holdView(false); if (r) setPlaying(true); return; }
    if (box) { box = null; boxEnd(e); return; }
    if (!drag) return;
    snapLine(null);
    floating = null;
    const { snap, moved, alone, ref, copy, moving, along, shift } = drag;
    drag = null;
    c.style.cursor = "";
    if (!moved) { if (alone && e.type === "pointerup") setClips([ref]); return; }
    const after = snapshot();
    restore(snap);
    along?.restore();
    if (after === snap || e.type !== "pointerup") { drawLanes(); return; }
    together(() => {
      edit((l) => { const now: typeof l = JSON.parse(after); l.beds = now.beds; l.sfx = now.sfx; l.tracks = now.tracks; });
      along?.commit(Math.round(shift * 1000) / 1000);
    });
    if (copy) setClips(moving); // as in CapCut, the copies are what is picked after
  };
  c.addEventListener("pointerup", up);
  c.addEventListener("dblclick", (e) => {
    const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, b = hit(x, y, false);
    if (!b || locked(b.ref) || !onGain(b, x, y)) return;
    const t = r3(Math.max(0, Math.min(span(b.ref)[1] - span(b.ref)[0], Math.round(localTime(b, x) * FPS) / FPS)));
    edit((l) => toggleGainKey(l[b.ref.list][b.ref.i], t)); seek(span(b.ref)[0] + t);
  });
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !drag?.mode.startsWith("gain")) return;
    e.preventDefault(); e.stopPropagation(); restore(drag.snap); drag = null; c.style.cursor = "";
  }, true);
  c.addEventListener("pointerleave", () => {
    if (bladeLine.row === "lanes") { bladeLine.row = null; drawLanes(); }
    if (hover && !drag) { hover = null; drawLanes(); }
  });
  c.addEventListener("pointercancel", up);
  c.addEventListener("lostpointercapture", up);
  c.addEventListener("wheel", timelineWheel, { passive: false });
  new ResizeObserver(drawLanes).observe(c);
};

// ---------- A sound carried from the library: a label follows the pointer, and letting go over a track puts it there
const overLanes = (e: PointerEvent) => {
  const c = S.el.lanes, r = c.getBoundingClientRect();
  if (!r.width || e.clientX < r.left || e.clientX > r.right || e.clientY < r.top - 8 || e.clientY > r.bottom + 8) return null;
  const { a, v } = view(), x = e.clientX - r.left;
  return { row: rowAt(e.clientY - r.top), at: Math.max(0, Math.min(DURATION - 0.05, snapTo(a + (x / r.width) * v, snapPoints([]), v / r.width, noSnap(e)))) };
};
export const startCarry = (name: string, e: PointerEvent) => {
  const ghost = document.createElement("div");
  ghost.className = "carry";
  ghost.textContent = name;
  document.body.append(ghost);
  const where = (d: NonNullable<typeof drop>) => (d.row < tracks().length ? tracks()[d.row].name : "new track");
  const move = (ev: PointerEvent) => {
    ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 8}px)`;
    drop = overLanes(ev);
    ghost.toggleAttribute("data-over", !!drop);
    ghost.textContent = drop ? `${name} → ${where(drop)} ${stamp(drop.at)}` : name;
    snapLine(drop && !noSnap(ev) ? snappedTo([drop.at], snapPoints([])) : null);
    drawLanes();
  };
  const end = (ev: PointerEvent) => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", end);
    removeEventListener("pointercancel", end);
    const place = ev.type === "pointerup" ? overLanes(ev) : null;
    ghost.remove();
    drop = null;
    snapLine(null);
    if (place) addClip(name, place.at, undefined, tracks()[place.row]?.id ?? "new");
    drawLanes();
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", end);
  addEventListener("pointercancel", end);
  move(e);
};
