import { onClipActivity, paintActivityMark } from "../activity/timeline-activity";
import { BLADE_CURSOR } from "../components/cursor";
import { together } from "../core/doc";
import { DURATION, SHOTS_OUT as SHOTS } from "../core/filmMeta";
import { S } from "../core/state";
import { get, noSnap, say } from "../core/store";
import { FPS, makeSnapper, r3, snappedTo, snapTo, stamp } from "../core/time";
import { seek, setPlaying } from "../playback/transport";
import { type Along, alongWith, inBox, pickAcross, picked as across } from "../timeline/across";
import { bladeLine } from "../timeline/blade";
import { sized, type Tone, tone, UI_FONT } from "../timeline/canvas";
import { boxEnd, boxMove, boxStart } from "../timeline/rowbox";
import { snapLine } from "../timeline/snapline";
import { holdView, marks, onPlayhead, timeAt, timelineWheel, view } from "../timeline/timeline";
import { isElementShown, onShownResize } from "../timeline/visible";
import { GAIN_KEY_EPS, gainAt, gainPoints, toggleGainKey } from "./gain";
import { shotCutOverlaps } from "./jlcut";
import { ADD_H, laneLayout, rowAt, TOP, TRACK_H } from "./lane-layout";
import { canWarmProcessed } from "./mixer";
import { needsProcessing, processed, processSpec } from "./processed";
import { type ClipRef } from "./slice";
import {
  addClip,
  allClips,
  audioItemId,
  beatTimes,
  clipBeats,
  clipOf,
  clipTrackRole,
  customTrackSplitIndex,
  cutAfter,
  cutBefore,
  edit,
  lanes,
  locked,
  type OneShot,
  peaksOf,
  picked,
  preview,
  restore,
  setClips,
  snapshot,
  span,
  splitClips,
  trackRoleOf,
} from "./sound";
import { addRoleTrack, placeShift, same, type TrackRole } from "./tracks";
import { cachedVoiceClipLabel } from "./voice-client";

const CLIP_H = 48,
  LABEL_H = 16;
const NEAR = 10 ** (-1 / 20);
const EDGE = 6,
  KNOB = 7;

type Box = { ref: ClipRef; x0: number; x1: number; y0: number; y1: number };
let boxes: Box[] = [];
let drop: { row: number; at: number } | null = null;
let hover: ClipRef | null = null;
let floating: { refs: ClipRef[]; grabbed: ClipRef; clientY: number; grabOffsetY: number } | null =
  null;
const gainY = (gain: number) =>
  LABEL_H + 5 + (1 - Math.max(0, Math.min(1, (gain + 60) / 96))) * (CLIP_H - LABEL_H - 9);
const fadeX = (x0: number, x1: number, x: number) => Math.max(x0 + 5, Math.min(x1 - 5, x));

const tracks = () => lanes?.tracks ?? [];

const ROLE_CLIP_TONES: Record<TrackRole, { body: Tone; tag: Tone; wave: Tone }> = {
  voice: { body: "clip-voice", tag: "clip-voice-tag", wave: "clip-voice-wave" },
  bgm: { body: "clip-bgm", tag: "clip-bgm-tag", wave: "clip-bgm-wave" },
  whoosh: { body: "clip-audio", tag: "clip-audio-tag", wave: "clip-wave" },
  riser: { body: "clip-riser", tag: "clip-riser-tag", wave: "clip-riser-wave" },
  "pop-ui": { body: "clip-pop", tag: "clip-pop-tag", wave: "clip-pop-wave" },
  impact: { body: "clip-impact", tag: "clip-impact-tag", wave: "clip-impact-wave" },
  ambience: { body: "clip-ambience", tag: "clip-ambience-tag", wave: "clip-ambience-wave" },
  custom: { body: "clip-custom", tag: "clip-custom-tag", wave: "clip-custom-wave" },
};

const clipPalette = (ref: ClipRef) => {
  const c = clipOf(ref);
  if (!c) return ROLE_CLIP_TONES.whoosh;
  if (c.dialogue || (lanes?.narration && c.name === lanes.narration)) return ROLE_CLIP_TONES.voice;
  const track = tracks().find((t) => t.id === c.track);
  const role = track ? trackRoleOf(track) : clipTrackRole(ref);
  return ROLE_CLIP_TONES[role];
};

const drawClip = (
  g: CanvasRenderingContext2D,
  ref: ClipRef,
  x0: number,
  x1: number,
  y: number,
  w: number,
  cuts: readonly number[],
) => {
  const c = clipOf(ref)!,
    on = picked(ref),
    pal = clipPalette(ref);
  const cx0 = Math.max(-2, x0),
    cx1 = Math.min(w + 2, x1);
  g.fillStyle = tone(pal.body);
  g.beginPath();
  g.roundRect(cx0, y, Math.max(2, cx1 - cx0), CLIP_H, 4);
  g.fill();
  if (c.muted) {
    g.save();
    g.strokeStyle = tone("muted-foreground");
    g.lineWidth = 1;
    g.setLineDash([4, 3]);
    g.beginPath();
    g.roundRect(cx0 + 0.5, y + 0.5, Math.max(2, cx1 - cx0) - 1, CLIP_H - 1, 4);
    g.stroke();
    g.restore();
  }
  const [from, to] = span(ref),
    altered = needsProcessing(c),
    px = (x1 - x0) / Math.max(1e-3, to - from);
  const p = altered
    ? canWarmProcessed(from, to)
      ? processed(processSpec(c, to - from, ref.list === "beds"))?.peaks
      : undefined
    : peaksOf(c.name);
  if (p && x1 - x0 > 6) {
    const start = altered ? 0 : (c.start ?? 0),
      n = p.peaks.length,
      room = CLIP_H - LABEL_H - 3,
      base = y + CLIP_H - 1;
    const at = (x: number) => {
      const s = (x - x0) / px + start;
      return Math.floor(
        (ref.list === "beds" && !altered ? ((s % (n * p.step)) + n * p.step) % (n * p.step) : s) /
          p.step,
      );
    };
    for (let x = Math.max(Math.ceil(cx0) + 1, 1); x < cx1 - 1; x += 2) {
      const i0 = at(x),
        i1 = Math.max(i0, at(x + 2) - 1);
      let v = 0;
      for (let i = i0; i <= i1 && i < n; i++) if (i >= 0 && p.peaks[i] > v) v = p.peaks[i];
      v *= 10 ** (gainAt(c, (x - x0) / px) / 20);
      if (v <= 0) continue;
      const bar = Math.max(1, Math.min(1, v) * room);
      g.fillStyle = tone(pal.wave);
      g.fillRect(x, base - bar, 1, bar);
      if (v >= NEAR) {
        g.fillStyle = tone("level-near");
        g.fillRect(x, base - bar, 1, 2);
      }
      if (v > 1) {
        g.fillStyle = tone("level-over");
        g.fillRect(x, base - bar - 1, 1, 1);
      }
    }
  }
  const fi = c.fadeIn ?? 0,
    fo = c.fadeOut ?? 0;
  g.fillStyle = tone("fade-shade");
  if (fi > 0) {
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x0 + fi * px, y);
    g.lineTo(x0, y + CLIP_H);
    g.fill();
  }
  if (fo > 0) {
    g.beginPath();
    g.moveTo(x1, y);
    g.lineTo(x1 - fo * px, y);
    g.lineTo(x1, y + CLIP_H);
    g.fill();
  }
  if (on || (hover && same(hover, ref))) {
    const from = Math.max(0, (cx0 - x0) / px),
      to = Math.min(span(ref)[1] - span(ref)[0], (cx1 - x0) / px);
    g.strokeStyle = tone("gain-curve");
    g.lineWidth = 1;
    g.beginPath();
    for (const [i, k] of gainPoints(c, from, to).entries()) {
      const x = x0 + k.t * px,
        yy = y + gainY(k.gain);
      if (i) g.lineTo(x, yy);
      else g.moveTo(x, yy);
    }
    g.stroke();
    if (on)
      for (const k of c.gainKeys ?? []) {
        const x = x0 + k.t * px,
          yy = y + gainY(k.gain);
        if (k.t < 0 || k.t > span(ref)[1] - span(ref)[0] || x < 0 || x > w) continue;
        g.fillStyle = tone(Math.abs(S.t - span(ref)[0] - k.t) < GAIN_KEY_EPS ? "primary" : "pick");
        g.beginPath();
        g.moveTo(x, yy - 3.5);
        g.lineTo(x + 3.5, yy);
        g.lineTo(x, yy + 3.5);
        g.lineTo(x - 3.5, yy);
        g.closePath();
        g.fill();
      }
  }
  if ((on || (hover && same(hover, ref))) && x1 - x0 > KNOB * 4 && !locked(ref)) {
    g.fillStyle = tone(pal.body);
    g.strokeStyle = tone("pick");
    g.lineWidth = 1.5;
    for (const hx of [x0 + fi * px, x1 - fo * px]) {
      g.beginPath();
      g.arc(fadeX(x0, x1, hx), y + LABEL_H + 5, 3, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }
  const overlap = shotCutOverlaps(from, to, cuts);
  if (overlap.jLead || overlap.lTrail) {
    g.save();
    g.beginPath();
    g.rect(cx0, y, Math.max(0, cx1 - cx0 - 2), CLIP_H);
    g.clip();
    const paintOverhang = (
      cutTime: number,
      side: "j" | "l",
      tag: string,
      colorToken: "beat-sound" | "in-out",
    ) => {
      const cutX = Math.max(cx0, Math.min(cx1, x0 + (cutTime - from) * px));
      const spanW = side === "j" ? cutX - cx0 : cx1 - cutX;
      if (spanW <= 2) return;
      g.fillStyle = tone(colorToken);
      g.globalAlpha = 0.22;
      g.fillRect(side === "j" ? cx0 : cutX, y, spanW, CLIP_H);
      g.strokeStyle = tone(colorToken);
      g.globalAlpha = 0.85;
      g.lineWidth = 1;
      g.beginPath();
      g.setLineDash([2, 2]);
      g.moveTo(cutX, y + 1);
      g.lineTo(cutX, y + CLIP_H - 1);
      g.stroke();
      g.setLineDash([]);
      if (g.measureText(tag).width + 8 <= spanW) {
        g.globalAlpha = 0.95;
        g.fillStyle = tone(colorToken);
        g.fillText(tag, (side === "j" ? cx0 : cutX) + 4, y + CLIP_H - 7);
      }
    };
    if (overlap.jLead) {
      paintOverhang(overlap.jLead.cut, "j", `J -${overlap.jLead.amount.toFixed(1)}s`, "beat-sound");
    }
    if (overlap.lTrail) {
      paintOverhang(overlap.lTrail.cut, "l", `L +${overlap.lTrail.amount.toFixed(1)}s`, "in-out");
    }
    g.restore();
  }
  if (c.try) {
    g.fillStyle = tone("warn");
    g.fillRect(cx0, y + CLIP_H - 2, Math.min(10, cx1 - cx0), 2);
  }
  g.save();
  g.beginPath();
  g.rect(cx0, y, cx1 - cx0 - 2, CLIP_H);
  g.clip();
  const baseLabel =
    ref.list === "sfx" && lanes?.narration && c.name === lanes.narration
      ? cachedVoiceClipLabel(c as OneShot)
      : c.name;
  const label = c.muted ? `${baseLabel} · Off` : baseLabel;
  const lx = Math.max(x0, 0) + 3,
    maxTagW = Math.max(0, cx1 - lx - 4);
  if (maxTagW > 8) {
    const tw = Math.min(maxTagW - 8, g.measureText(label).width);
    g.fillStyle = tone(pal.tag);
    g.beginPath();
    g.roundRect(lx, y + 2, Math.max(8, tw + 8), LABEL_H - 2, 3);
    g.fill();
    g.fillStyle = tone("clip-label");
    g.fillText(label, lx + 4, y + 1 + LABEL_H / 2);
  }
  g.restore();
  const id = audioItemId(ref.list, c);
  if (id) paintActivityMark(g, "sound", id, cx0, y + CLIP_H - 2, cx1 - cx0);
  if (on) {
    g.strokeStyle = tone("pick");
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(cx0 - 1, y - 1, cx1 - cx0 + 2, CLIP_H + 2, 4);
    g.stroke();
  }
  g.fillStyle = tone("primary");
  for (const t of clipBeats(ref)) {
    const x = x0 + t * px;
    if (x < 0 || x > w) continue;
    g.beginPath();
    g.moveTo(x - 3.5, y - 9);
    g.lineTo(x + 3.5, y - 9);
    g.lineTo(x + 3.5, y - 4);
    g.lineTo(x, y - 1);
    g.lineTo(x - 3.5, y - 4);
    g.closePath();
    g.fill();
  }
};

export const drawLanes = () => {
  const c = S.el?.lanes;
  if (!c || !lanes || !isElementShown(c)) return;
  const { rows, rowsByTrack, bottom } = laneLayout(lanes),
    height = bottom + ADD_H;
  if (c.style.height !== `${height}px`) c.style.height = `${height}px`;
  const { g, w, h } = sized(c);
  if (!c.width) return;
  const { a, v } = view(),
    X = (s: number) => ((s - a) / v) * w;
  g.fillStyle = tone("background");
  g.fillRect(0, 0, w, h);
  g.fillStyle = tone("track");
  g.fillRect(0, 0, w, bottom);
  g.fillStyle = tone("background");
  for (const row of rows) g.fillRect(0, row.top + row.height - 1, w, 1);
  const splitIdx = customTrackSplitIndex();
  if (splitIdx > 0 && splitIdx < rows.length) {
    g.fillStyle = tone("hairline-strong");
    g.fillRect(0, rows[splitIdx].top - 1, w, 2);
  }
  g.fillStyle = tone("grid");
  for (const s of SHOTS) if (s.t > a && s.t < a + v) g.fillRect(X(s.t), 0, 1, h);
  g.font = `12px ${UI_FONT}`;
  g.textBaseline = "middle";
  boxes = [];
  const lit = get().soundLit,
    litSet = lit ? new Set(lit) : null,
    solo = get().solo,
    cuts = SHOTS.map((s) => s.t).filter((t) => t > 0);
  for (const ref of allClips()) {
    const [s, e] = span(ref),
      clip = clipOf(ref)!,
      row = rowsByTrack.get(clip.track);
    if (!row || e <= s || e < a || s > a + v) continue;
    const x0 = X(s),
      x1 = Math.max(x0 + 4, X(e)),
      y = row.top + row.height - (TRACK_H + CLIP_H) / 2,
      t = row.track,
      shine = litSet !== null && litSet.has(clip.name);
    g.globalAlpha =
      t.mute || clip.muted || (solo.length && !solo.includes(t.id)) || (litSet !== null && !shine)
        ? 0.35
        : 1;
    if (floating?.refs.some((r) => same(r, ref))) {
      g.fillStyle = tone("raised-3");
      g.beginPath();
      g.roundRect(x0, y, x1 - x0, CLIP_H, 4);
      g.fill();
    } else drawClip(g, ref, x0, x1, y, w, cuts);
    g.globalAlpha = 1;
    if (shine) {
      g.strokeStyle = tone("pick");
      g.lineWidth = 1.5;
      g.beginPath();
      g.roundRect(
        Math.max(-2, x0) - 1.5,
        y - 1.5,
        Math.min(w + 2, x1) - Math.max(-2, x0) + 3,
        CLIP_H + 3,
        4,
      );
      g.stroke();
    }
    boxes.push({ ref, x0, x1, y0: y, y1: y + CLIP_H });
  }
  if (floating) {
    const grabbed = boxes.find((b) => same(b.ref, floating!.grabbed));
    if (grabbed) {
      const dy =
        floating.clientY - c.getBoundingClientRect().top - floating.grabOffsetY - grabbed.y0;
      for (const b of boxes)
        if (floating.refs.some((r) => same(r, b.ref)))
          drawClip(g, b.ref, b.x0, b.x1, b.y0 + dy, w, cuts);
    }
  }
  if (!rows.length) {
    g.fillStyle = tone("muted-foreground");
    g.fillText("Drag a sound here from the Audio tab", 8, TOP + ADD_H / 2);
  }
  if (drop) {
    const x = X(drop.at),
      row = rows[drop.row],
      y = row?.top ?? bottom,
      hh = row?.height ?? ADD_H;
    g.globalAlpha = 0.18;
    g.fillStyle = tone("primary");
    g.fillRect(0, y, w, hh);
    g.globalAlpha = 1;
    g.fillStyle = tone("primary");
    g.fillRect(x - 1, y, 2, hh);
  }
  if (get().blade && bladeLine.row === "lanes") {
    const x = Math.round(X(bladeLine.t));
    g.fillStyle = tone("stage");
    g.fillRect(x - 1, bladeLine.y0 - 3, 3, bladeLine.y1 - bladeLine.y0 + 6);
    g.fillStyle = tone("pick");
    g.fillRect(x, bladeLine.y0 - 2, 1, bladeLine.y1 - bladeLine.y0 + 4);
  }
};

const snapPoints = (skip: ClipRef[]) => {
  const out = [S.t, ...SHOTS.map((s) => s.t), ...beatTimes(skip)];
  for (const l of S.voiceOut) for (const word of l.words) out.push(word.s);
  for (const r of allClips()) if (!skip.some((k) => same(k, r))) out.push(...span(r));
  return out;
};

const hit = (x: number, y: number, touch: boolean) => {
  const reach = touch ? 8 : 0;
  return (
    boxes.findLast(
      (b) =>
        x >= b.x0 - reach && x <= b.x1 + reach && y >= b.y0 - reach / 2 && y <= b.y1 + reach / 2,
    ) ?? null
  );
};
export const clipAtPointer = (e: { clientX: number; clientY: number }) => {
  const r = S.el.lanes.getBoundingClientRect();
  return hit(e.clientX - r.left, e.clientY - r.top, false)?.ref ?? null;
};
const knobAt = (b: Box, x: number, y: number, touch: boolean): "fadeIn" | "fadeOut" | null => {
  const c = clipOf(b.ref)!,
    [from, to] = span(b.ref),
    px = (b.x1 - b.x0) / Math.max(1e-3, to - from),
    r = touch ? KNOB * 2 : KNOB;
  if (b.x1 - b.x0 <= KNOB * 4 || Math.abs(y - b.y0 - LABEL_H - 5) > r) return null;
  const di = Math.abs(x - fadeX(b.x0, b.x1, b.x0 + (c.fadeIn ?? 0) * px)),
    dout = Math.abs(x - fadeX(b.x0, b.x1, b.x1 - (c.fadeOut ?? 0) * px));
  return Math.min(di, dout) > r ? null : di <= dout ? "fadeIn" : "fadeOut";
};
const clipsInBox = (m: { x0: number; x1: number; y0: number; y1: number }) => {
  const r = S.el.lanes.getBoundingClientRect();
  if (!r.height) return [];
  const x0 = m.x0 - r.left,
    x1 = m.x1 - r.left,
    y0 = m.y0 - r.top,
    y1 = m.y1 - r.top;
  return boxes
    .filter((b) => b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1 && !locked(b.ref))
    .map((b) => b.ref);
};

type Drag = {
  ref: ClipRef;
  group: ClipRef[];
  mode: "move" | "start" | "end" | "fadeIn" | "fadeOut" | "gain" | "gain-key";
  gainKey: number | null;
  x: number;
  y: number;
  snap: string;
  from: number;
  to: number;
  pts: number[];
  moved: boolean;
  alone: boolean;
  x0: number;
  x1: number;
  y0: number;
  copy: boolean;
  moving: ClipRef[];
  along: Along | null;
  shift: number;
  magnet: ReturnType<typeof makeSnapper>;
};

export const attachLanes = () => {
  onClipActivity("sound", drawLanes);
  const c = S.el.lanes;
  marks.lanes = drawLanes;
  inBox.clips = clipsInBox;
  const local = (e: PointerEvent) => {
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width };
  };
  type LanesGesture =
    | { kind: "idle" }
    | { kind: "scrub"; resume: boolean }
    | { kind: "box"; add: boolean }
    | ({ kind: "drag"; pointer: number; lastPointer: PointerEvent | null } & Drag);

  let gesture: LanesGesture = { kind: "idle" };
  const localTime = (b: Pick<Box, "x0" | "x1" | "ref">, x: number) =>
    ((x - b.x0) / (b.x1 - b.x0)) * (span(b.ref)[1] - span(b.ref)[0]);
  const onGain = (b: Box, x: number, y: number) =>
    (picked(b.ref) || (!!hover && same(hover, b.ref))) &&
    Math.abs(y - b.y0 - gainY(gainAt(clipOf(b.ref)!, localTime(b, x)))) <= 3;
  const gainKeyAt = (b: Box, x: number, y: number, touch: boolean) => {
    if (!picked(b.ref)) return null;
    const duration = span(b.ref)[1] - span(b.ref)[0],
      reach = touch ? 12 : 7;
    const i =
      clipOf(b.ref)!.gainKeys?.findIndex(
        (k) =>
          k.t >= 0 &&
          k.t <= duration &&
          Math.abs(x - b.x0 - (k.t / duration) * (b.x1 - b.x0)) <= reach &&
          Math.abs(y - b.y0 - gainY(k.gain)) <= reach,
      ) ?? -1;
    return i >= 0 ? i : null;
  };
  const playheadGrab = (b: Box | null, x: number, y: number, w: number, touch: boolean) =>
    onPlayhead(x, w, touch) &&
    (!b ||
      (x > b.x0 + EDGE &&
        x < b.x1 - EDGE &&
        gainKeyAt(b, x, y, touch) === null &&
        !knobAt(b, x, y, touch) &&
        !onGain(b, x, y)));
  const bladeTime = (ref: ClipRef, x: number, w: number, off: boolean) =>
    snapTo(timeAt(x, w), snapPoints([ref]), view().v / w, off, true);

  c.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const { x, y, w } = local(e),
      touch = e.pointerType === "touch",
      b = hit(x, y, touch),
      add = e.shiftKey || e.ctrlKey || e.metaKey;
    const markerBox = boxes.findLast(
      (b) => y >= b.y0 - 11 && y < b.y0 - 1 && x >= b.x0 - 5 && x <= b.x1 + 5,
    );
    if (!add && markerBox) {
      const [from, to] = span(markerBox.ref),
        mark = clipBeats(markerBox.ref).find(
          (t) =>
            Math.abs(x - markerBox.x0 - (t / (to - from)) * (markerBox.x1 - markerBox.x0)) <
            (touch ? 10 : 5),
        );
      if (mark !== undefined) {
        setClips([markerBox.ref]);
        seek(from + mark);
        return;
      }
    }
    if (get().blade) {
      if (!b) return;
      if (locked(b.ref)) {
        say("This track is locked. Unlock it in the track header to cut it");
        return;
      }
      splitClips([b.ref], bladeTime(b.ref, x, w, noSnap(e)));
      return;
    }
    c.setPointerCapture(e.pointerId);
    const grab = !add && playheadGrab(b, x, y, w, touch);
    if (!b || grab) {
      if (touch || grab) {
        if (!grab) {
          setClips([]);
          if (w) seek(Math.max(0, Math.min(DURATION, timeAt(x, w))));
        }
        gesture = { kind: "scrub", resume: S.playing };
        holdView(true);
        if (S.playing) setPlaying(false);
      } else {
        gesture = { kind: "box", add };
        boxStart(e, add);
      }
      return;
    }
    if (add) {
      const p = across();
      pickAcross({
        ...p,
        clips: picked(b.ref) ? p.clips.filter((q) => !same(q, b.ref)) : [...p.clips, b.ref],
      });
      return;
    }
    if (locked(b.ref)) {
      setClips([b.ref]);
      if (w) seek(Math.max(0, Math.min(DURATION, timeAt(x, w))));
      say("This track is locked. Unlock it in the track header to edit");
      return;
    }
    const was = picked(b.ref);
    if (!was) setClips([b.ref]);
    const group = get().clips.filter((r) => !locked(r)),
      along = was ? alongWith("clips") : null,
      many = group.length > 1 || !!along;
    const edge = touch ? 10 : EDGE,
      wide = b.x1 - b.x0 > edge * 3,
      knob = many ? null : knobAt(b, x, y, touch);
    const gainKey = many ? null : gainKeyAt(b, x, y, touch);
    const mode =
      gainKey !== null
        ? "gain-key"
        : (knob ??
          (many || !wide
            ? "move"
            : x <= b.x0 + edge
              ? "start"
              : x >= b.x1 - edge
                ? "end"
                : onGain(b, x, y)
                  ? "gain"
                  : "move"));
    const [from, to] = span(b.ref);
    if (gainKey !== null) seek(from + clipOf(b.ref)!.gainKeys![gainKey].t);
    gesture = {
      kind: "drag",
      pointer: e.pointerId,
      lastPointer: e,
      ref: b.ref,
      group,
      mode,
      gainKey,
      x,
      y,
      snap: snapshot(),
      from,
      to,
      pts: snapPoints(group),
      moved: false,
      alone: was && many,
      x0: b.x0,
      x1: b.x1,
      y0: b.y0,
      copy: false,
      moving: group,
      along,
      shift: 0,
      magnet: makeSnapper(),
    };
  });

  const edgeScroll = (e: PointerEvent) => {
    const box = c.closest<HTMLElement>("[data-tracks-scroll]"),
      r = box?.getBoundingClientRect();
    if (!box || !r) return;
    if (e.clientY > r.bottom - 18) box.scrollTop += 10;
    else if (e.clientY < r.top + 18) box.scrollTop -= 10;
  };
  const move = (e: PointerEvent, scroll = true) => {
    if (gesture.kind === "drag") {
      gesture.lastPointer = e;
      if (gesture.moved && scroll) edgeScroll(e);
    }
    const { x, y, w } = local(e),
      { v } = view(),
      perPx = v / w;
    if (gesture.kind === "scrub") {
      seek(timeAt(x, w));
      return;
    }
    if (gesture.kind === "box") {
      boxMove(e);
      return;
    }
    if (gesture.kind === "idle" && get().blade) {
      const b = hit(x, y, false);
      c.style.cursor = !b ? "default" : locked(b.ref) ? "not-allowed" : BLADE_CURSOR;
      bladeLine.row = b && !locked(b.ref) ? "lanes" : null;
      if (b) Object.assign(bladeLine, { t: bladeTime(b.ref, x, w, noSnap(e)), y0: b.y0, y1: b.y1 });
      drawLanes();
      return;
    }
    if (gesture.kind !== "drag") {
      const b = hit(x, y, false),
        edge =
          b &&
          get().clips.length < 2 &&
          b.x1 - b.x0 > EDGE * 3 &&
          (x <= b.x0 + EDGE || x >= b.x1 - EDGE);
      const knob = b && get().clips.length < 2 && !locked(b.ref) && knobAt(b, x, y, false);
      c.style.cursor = playheadGrab(b, x, y, w, false)
        ? "ew-resize"
        : !b
          ? "default"
          : locked(b.ref)
            ? "not-allowed"
            : gainKeyAt(b, x, y, false) !== null
              ? "default"
              : knob
                ? "ew-resize"
                : edge
                  ? "col-resize"
                  : onGain(b, x, y)
                    ? "ns-resize"
                    : "default";
      if (hover && b ? !same(hover, b.ref) : hover !== (b?.ref ?? null)) {
        hover = b?.ref ?? null;
        drawLanes();
      }
      return;
    }
    const drag = gesture;
    if (
      !drag.moved &&
      Math.abs(x - drag.x) < 3 &&
      Math.abs(y - drag.y) < (drag.mode.startsWith("gain") ? 1 : 6)
    )
      return;
    if (!drag.moved) drag.copy = e.altKey && drag.mode === "move" && !drag.along;
    drag.moved = true;
    c.style.cursor = drag.copy
      ? "copy"
      : drag.mode === "move" || drag.mode === "gain-key"
        ? "default"
        : drag.mode === "gain"
          ? "ns-resize"
          : drag.mode.startsWith("fade")
            ? "ew-resize"
            : "col-resize";
    const d = (x - drag.x) * perPx,
      off = noSnap(e),
      { ref, group, from, to, pts } = drag;
    restore(drag.snap);
    if (drag.mode === "gain" || drag.mode === "gain-key") {
      const change = (((drag.y - y) * 96) / (CLIP_H - LABEL_H - 9)) * (e.shiftKey ? 0.1 : 1),
        c0 = clipOf(ref)!;
      const key = drag.gainKey,
        base =
          key === null
            ? gainAt(c0, localTime({ x0: drag.x0, x1: drag.x1, ref }, drag.x))
            : c0.gainKeys![key].gain;
      const gain = Math.round(Math.max(-60, Math.min(36, base + change)) * 10) / 10;
      const u =
        key === null
          ? null
          : r3(
              Math.max(
                0,
                (c0.gainKeys![key - 1]?.t ?? -1 / FPS) + 1 / FPS,
                Math.min(
                  to - from,
                  (c0.gainKeys![key + 1]?.t ?? to - from + 1 / FPS) - 1 / FPS,
                  Math.round((c0.gainKeys![key].t + d) * FPS) / FPS,
                ),
              ),
            );
      preview((l) => {
        const c = l[ref.list][ref.i];
        if (key !== null) {
          c.gainKeys![key] = { t: u!, gain };
        } else if (c.gainKeys?.length) {
          for (const k of c.gainKeys)
            k.gain = Math.round(Math.max(-60, Math.min(36, k.gain + gain - base)) * 10) / 10;
        } else c.gain = gain;
      });
      if (u !== null) seek(from + u);
      say(`Volume: ${gain.toFixed(1)} dB (Shift: fine adjustment)`, 1500);
      return;
    }
    if (drag.mode === "fadeIn" || drag.mode === "fadeOut") {
      const key = drag.mode,
        other = (clipOf(ref)![key === "fadeIn" ? "fadeOut" : "fadeIn"] as number | undefined) ?? 0;
      const raw = (clipOf(ref)![key] ?? 0) + (key === "fadeIn" ? d : -d),
        len = Math.max(0, Math.min(to - from - other, raw));
      preview((l) => {
        (l[ref.list][ref.i] as Record<string, unknown>)[key] = Math.round(len * 100) / 100;
      });
      say(
        `${clipOf(ref)!.name}: ${key === "fadeIn" ? "fade in" : "fade out"} ${len.toFixed(2)} s`,
        1500,
      );
      return;
    }
    let target: number | null = null,
      valid = true;
    preview((l) => {
      if (drag.mode === "move") {
        const moving = (drag.moving = drag.copy
          ? group.map((r): ClipRef => {
              const list = l[r.list] as unknown[];
              list.push(structuredClone(list[r.i]));
              return { list: r.list, i: list.length - 1 };
            })
          : group);
        const snapped = drag.magnet(from + d, [0, to - from], pts, perPx, off);
        target = snapped.target;
        const starts = moving.map((r) => span(r)[0]);
        const room = drag.along?.room ?? [-Infinity, Infinity];
        const layout = laneLayout(lanes),
          rows = moving.map((r) => layout.rowsByTrack.get(clipOf(r)?.track)?.index ?? -1),
          n = l.tracks.length;
        const dk = Math.max(
          -Math.min(...rows),
          Math.min(n - Math.max(...rows), rowAt(layout.rows, y) - rowAt(layout.rows, drag.y)),
        );
        const fresh = rows.some((k) => k + dk === n)
          ? addRoleTrack(l, clipTrackRole(ref), n).id
          : "";
        moving.forEach((r, k) => {
          if (dk) l[r.list][r.i].track = rows[k] + dk === n ? fresh : l.tracks[rows[k] + dk].id;
        });
        const shift = placeShift(l, moving, span, snapped.time - from, [
          Math.max(-Math.min(...starts), room[0]),
          Math.min(DURATION - 0.05 - Math.max(...starts), room[1]),
        ]);
        if (shift === null) {
          valid = false;
          return;
        }
        drag.shift = shift;
        const grabbed = moving[group.findIndex((r) => same(r, ref))];
        floating = { refs: moving, grabbed, clientY: e.clientY, grabOffsetY: drag.y - drag.y0 };
        moving.forEach((r) => {
          const e = l[r.list][r.i] as { from?: number; to?: number; at?: number; track?: string };
          if (r.list === "beds") {
            const len = e.to! - e.from!;
            e.from = r3(e.from! + shift);
            e.to = r3(e.from + len);
          } else e.at = r3(e.at! + shift);
        });
      } else if (drag.mode === "end") {
        const snapped = drag.magnet(to + d, [0], pts, perPx, off);
        target = snapped.target;
        const neighbours = allClips()
          .filter((r) => !same(r, ref) && clipOf(r)!.track === clipOf(ref)!.track)
          .map(span);
        const next = Math.min(
          Infinity,
          ...neighbours.filter(([a]) => a >= to - 0.02).map(([a]) => a),
        );
        const e2 = Math.min(next, Math.max(from + 1 / FPS, snapped.time));
        cutAfter(l[ref.list][ref.i], ref.list, e2);
      } else {
        const snapped = drag.magnet(from + d, [0], pts, perPx, off);
        target = snapped.target;
        const neighbours = allClips()
          .filter((r) => !same(r, ref) && clipOf(r)!.track === clipOf(ref)!.track)
          .map(span);
        const prev = Math.max(
          0,
          ...neighbours.filter(([, b]) => b <= from + 0.02).map(([, b]) => b),
        );
        const s0 = Math.max(prev, Math.min(to - 1 / FPS, snapped.time));
        cutBefore(l[ref.list][ref.i], ref.list, s0);
      }
    });
    if (!valid) {
      restore(drag.snap);
      drag.moving = group;
      drag.shift = 0;
      floating = { refs: group, grabbed: ref, clientY: e.clientY, grabOffsetY: drag.y - drag.y0 };
      c.style.cursor = "not-allowed";
      drawLanes();
    }
    if (drag.mode === "move") drag.along?.preview(drag.shift);
    const others = drag.mode === "move" ? group.length - 1 + (drag.along?.count ?? 0) : 0;
    const [a0, a1] = span(drag.moving[group.indexOf(ref)] ?? ref),
      many = others ? ` + ${others} more` : "";
    snapLine(
      target === null || !valid
        ? null
        : snappedTo(drag.mode === "move" ? [a0, a1] : drag.mode === "start" ? [a0] : [a1], [
            target,
          ]),
    );
    say(
      `${drag.copy ? "Copy of " : ""}${clipOf(ref)!.name}${many}: ${stamp(a0)} → ${stamp(a1)}${off ? "" : " (Shift: no snapping)"}`,
      1500,
    );
  };
  c.addEventListener("pointermove", move);
  c.closest("[data-tracks-scroll]")?.addEventListener(
    "scroll",
    () => {
      if (gesture.kind === "drag" && gesture.moved && gesture.mode === "move" && gesture.lastPointer)
        move(gesture.lastPointer, false);
    },
    { passive: true },
  );

  const up = (e: PointerEvent) => {
    if (gesture.kind === "drag" && e.type === "pointerup" && gesture.moved && gesture.mode === "move")
      move(e, false);
    const active = gesture;
    gesture = { kind: "idle" };
    if (active.kind === "scrub") {
      holdView(false);
      if (active.resume) setPlaying(true);
      return;
    }
    if (active.kind === "box") {
      boxEnd(e);
      return;
    }
    if (active.kind !== "drag") return;
    snapLine(null);
    floating = null;
    const { snap, moved, alone, ref, copy, moving, along, shift, gainKey } = active;
    c.style.cursor = "";
    if (!moved) {
      if (e.type === "pointerup") {
        if (alone) setClips([ref]);
        if (gainKey === null) {
          const { x, w } = local(e);
          if (w) seek(Math.max(0, Math.min(DURATION, timeAt(x, w))));
        }
      }
      return;
    }
    const after = snapshot(),
      projected = structuredClone(lanes!);
    restore(snap);
    along?.restore();
    if (after === snap || e.type !== "pointerup") {
      drawLanes();
      return;
    }
    together(() => {
      edit((l) => {
        l.beds = projected.beds;
        l.sfx = projected.sfx;
        l.tracks = projected.tracks;
      });
      along?.commit(Math.round(shift * 1000) / 1000);
    });
    if (copy) setClips(moving);
  };
  c.addEventListener("pointerup", up);
  c.addEventListener("dblclick", (e) => {
    const r = c.getBoundingClientRect(),
      x = e.clientX - r.left,
      y = e.clientY - r.top,
      b = hit(x, y, false);
    if (!b || locked(b.ref) || !onGain(b, x, y)) return;
    const t = r3(
      Math.max(
        0,
        Math.min(span(b.ref)[1] - span(b.ref)[0], Math.round(localTime(b, x) * FPS) / FPS),
      ),
    );
    edit((l) => toggleGainKey(l[b.ref.list][b.ref.i], t));
    seek(span(b.ref)[0] + t);
  });
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || gesture.kind !== "drag") return;
      const active = gesture;
      gesture = { kind: "idle" };
      e.preventDefault();
      e.stopPropagation();
      snapLine(null);
      floating = null;
      restore(active.snap);
      active.along?.restore();
      c.style.cursor = "";
      if (c.hasPointerCapture(active.pointer)) c.releasePointerCapture(active.pointer);
      drawLanes();
    },
    true,
  );
  c.addEventListener("pointerleave", () => {
    if (bladeLine.row === "lanes") {
      bladeLine.row = null;
      drawLanes();
    }
    if (hover && gesture.kind !== "drag") {
      hover = null;
      drawLanes();
    }
  });
  c.addEventListener("pointercancel", up);
  c.addEventListener("lostpointercapture", up);
  c.addEventListener("wheel", timelineWheel, { passive: false });
  onShownResize(c, drawLanes);
};

const overLanes = (e: PointerEvent) => {
  const c = S.el.lanes,
    r = c.getBoundingClientRect();
  if (
    !r.width ||
    e.clientX < r.left ||
    e.clientX > r.right ||
    e.clientY < r.top - 8 ||
    e.clientY > r.bottom + 8
  )
    return null;
  const { a, v } = view(),
    x = e.clientX - r.left;
  return {
    row: rowAt(laneLayout(lanes).rows, e.clientY - r.top),
    at: Math.max(
      0,
      Math.min(
        DURATION - 0.05,
        snapTo(a + (x / r.width) * v, snapPoints([]), v / r.width, noSnap(e)),
      ),
    ),
  };
};
export const startCarry = (name: string, e: PointerEvent) => {
  const ghost = document.createElement("div");
  ghost.className = "carry";
  ghost.textContent = name;
  document.body.append(ghost);
  const where = (d: NonNullable<typeof drop>) =>
    d.row < tracks().length ? tracks()[d.row].name : "new track";
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
