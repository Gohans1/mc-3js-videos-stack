// The ruler and the stretch around the playhead under it, drawn on canvases: shot names (with no Camera row), each sentence's
// pace, the words, actions and sounds in lanes, option ranges and notes.
// Custom canvas on purpose: the waveform is drawn through the voice edit's time warp and the rows come from edit.json, which no
// waveform or timeline library models. The studio only reads this timeline; changes are made from notes, in edit.json. The sound
// lanes under it (sound/lanes.ts) are the one part the creator edits by hand, on the same seconds as the stretch drawn here.
import { applyEdit, DURATION, SHOTS_OUT as SHOTS } from "film/scene";
import { EDIT, fromSource, toSource } from "film/edit";
import { shotEnd, shotIndex } from "../core/film";
import { getFile } from "../core/net";
import { pad, stamp } from "../core/time";
import { stored } from "../core/storage";
import { drawPlayhead, sized, tone, UI_FONT } from "./canvas";
import { boxEnd, boxMove, boxPick, boxStart } from "./rowbox";
import { LANE_H, rows, SHOTS_STRIP, WORDS_H } from "./rows";
import { S } from "../core/state";
import { get, say, set, setPref } from "../core/store";
import { seek, setPlaying } from "../playback/transport";
import { skimSound } from "../sound/skim";

const SLOW_WPM = 130, FAST_WPM = 280, STILL = 6; // a sentence outside these reads as off pace; this long with nothing moving reads as stuck
const HOLDS = new Set(["zz", "note1", "code", "typing"]); // these say when something is shown, not that it moves


type Box = { type: "beat"; id: string; x0: number; x1: number; y0: number; y1: number } | { type: "line" | "gap"; i: number; x0: number; x1: number; y0: number; y1: number };
let boxes: Box[] = [];
let selected: { type: "beat"; id: string } | { type: "line"; i: number } | null = null;
let stuck: [number, number][] = [];
export const shown = () => Math.min(get().span, DURATION); // seconds the detail timeline shows
let frozenCentre: number | null = null;
// Where Alt+wheel slid the stretch (c), and the playhead then (t): it stays while the playhead stays or moves inside it, and
// goes once playing or a jump takes the playhead out of it, so the stretch follows the playhead again
let slid: { c: number; t: number } | null = null;
// What else the timelines mark, set by the parts that own it
export const marks = {
  notes: () => [] as { t: number; to?: number; done: boolean }[],
  optionRanges: () => [] as [number, number][],
  lanes: () => {}, // sound/lanes.ts draws its canvas whenever these do
  cam: () => {}, // and camera/camrow.ts its own
  keys: () => {}, // and keys/keyrows.ts the key rows
  text: () => {}, // and text/textrow.ts the text tracks
};

export const paceOf = (i: number) => {
  const l = S.voice.lines[i];
  if (!l || l.words.length < 4 || l.e <= l.s) return null;
  return (l.words.length / (l.e - l.s)) * 60 * (EDIT.voice.edits[i]?.speed ?? 1);
};
// Stretches where neither the camera nor anything in frame moves
const findStuck = () => {
  const out: [number, number][] = [];
  SHOTS.forEach((s, i) => {
    if (s.pull || s.walk || s.pan) return;
    const a = s.t, b = shotEnd(i);
    const moves = Object.entries(EDIT.beats)
      .filter(([id, m]) => m.kind === "motion" && (!HOLDS.has(id) || (id === "typing" && !s.hideMan)))
      .map(([, m]) => [fromSource(m.at), fromSource(m.at + m.dur)])
      .filter(([x, y]) => y > a && x < b)
      .sort((p, q) => p[0] - q[0]);
    let from = a;
    for (const [x, y] of moves) { if (x - from >= STILL) out.push([from, x]); from = Math.max(from, y); }
    if (b - from >= STILL) out.push([from, b]);
  });
  return out;
};
export const wordNear = (out: number) => {
  let best = null, d = 1e9;
  for (const l of S.voiceOut) for (const w of l.words) { const e = Math.abs(w.s - out); if (e < d) { d = e; best = w; } }
  return { word: best, gap: d };
};

const describeSelection = () => {
  if (selected?.type === "beat") {
    const b = EDIT.beats[selected.id], out = fromSource(b.at);
    set({ selection: [b.title, `${stamp(out)}, at the word "${wordNear(out).word?.w ?? ""}"`] });
  } else if (selected?.type === "line") {
    const i = selected.i, l = S.voice.lines[i], pace = paceOf(i), next = S.voice.lines[i + 1];
    set({ selection: [l.text, `${pace ? `${Math.round(pace)} words/min · ` : ""}${(next ? next.s - l.e : 0).toFixed(2)} s pause after`] });
  } else {
    const off = S.voice.lines.filter((_, i) => { const p = paceOf(i); return p && (p > FAST_WPM || p < SLOW_WPM); }).length;
    set({ selection: [`${off} sentences off pace (tinted) · ${stuck.length} stretches still for over ${STILL} s (red line)`, `Zoom ${((EDIT.zoomRate ?? 0) * 100).toFixed(1)}% per second`] });
  }
};

// Every time the edit or the voice map changes: the heard seconds of everything move
export const refreshTimes = () => {
  applyEdit();
  S.timesRev++;
  S.voiceOut = S.voice.lines.map((l) => ({ ...l, s: fromSource(l.s), e: fromSource(l.e), words: l.words.map((w) => ({ ...w, s: fromSource(w.s), e: fromSource(w.e) })) }));
  S.dirty = true;
  stuck = findStuck();
  describeSelection();
  if (S.tools) drawTimelines();
};

const drawWave = (g: CanvasRenderingContext2D, a: number, b: number, w: number, y: number, h: number) => {
  const { peaks, step } = S.voice;
  if (!peaks.length) return;
  g.fillStyle = tone("muted-foreground");
  for (let x = 0; x < w; x++) {
    const i0 = Math.floor(toSource(a + (x / w) * (b - a)) / step), i1 = Math.max(i0 + 1, Math.floor(toSource(a + ((x + 1) / w) * (b - a)) / step));
    let p = 0;
    for (let i = Math.max(0, i0); i < Math.min(peaks.length, i1); i++) if (peaks[i] > p) p = peaks[i];
    if (p > 0.012) { const d = (p * h) / 2; g.fillRect(x, y + h / 2 - d, 1, Math.max(1, d * 2)); }
  }
};
export const viewCentre = () => {
  const v = shown();
  if (slid && S.t !== slid.t) { if (Math.abs(S.t - slid.c) > v / 2) slid = null; else slid.t = S.t; }
  const c = frozenCentre ?? slid?.c ?? S.t;
  return v >= DURATION ? DURATION / 2 : Math.max(v / 2, Math.min(DURATION - v / 2, c));
};
// The playhead line runs down every row, and as in CapCut a press on it anywhere drags the playhead. While a row scrubs, the
// stretch holds still: centred on a moving playhead, the time under the pointer would run away
export const onPlayhead = (x: number, w: number, touch: boolean) => { const { a, v } = view(); return Math.abs(x - ((S.t - a) / v) * w) <= (touch ? 10 : 4); };
// The stretch shown: its first second (a) and how many seconds (v); and the second at x on a row w wide
export const view = () => { const v = shown(); return { a: viewCentre() - v / 2, v }; };
export const timeAt = (x: number, w: number) => { const { a, v } = view(); return a + (x / w) * v; };
export const holdView = (on: boolean) => { frozenCentre = on ? viewCentre() : null; S.dirty = true; };

const drawDetail = () => {
  const { g, w, h } = sized(S.el.detail);
  const { a, v } = view(), b = a + v, t = S.t;
  const X = (s: number) => ((s - a) / v) * w;
  const { shots: SH, voiceY: VY, actionY: AY } = rows, VH = rows.voice - WORDS_H; // VH: the wave's height, the words go under it
  g.fillStyle = tone("track"); g.fillRect(0, 0, w, h);
  g.font = `12px ${UI_FONT}`; g.textBaseline = "middle";
  const named = SH > SHOTS_STRIP; // no Camera row: the shots' names are here
  SHOTS.forEach((s, i) => {
    const e = shotEnd(i);
    if (e < a || s.t > b) return;
    const x0 = Math.max(0, X(s.t)), x1 = Math.min(w, X(e));
    if (named) {
      g.fillStyle = i === shotIndex(t) ? tone("shot-now") : i % 2 ? tone("card") : tone("main-track");
      g.fillRect(x0, 0, x1 - x0 - 1, SH);
      g.save(); g.beginPath(); g.rect(x0, 0, x1 - x0 - 3, SH); g.clip();
      g.fillStyle = tone("foreground"); g.fillText(`${i} ${S.comments[i] ?? ""}`, x0 + 4, SH / 2);
      g.restore();
    }
    g.fillStyle = tone("grid"); g.fillRect(X(s.t), SH, 1, h - SH);
  });
  boxes = [];
  g.fillStyle = tone("stuck");
  for (const [x, y] of stuck) if (y > a && x < b) g.fillRect(X(x), SH - 2, X(y) - X(x), 3);
  // Voice: each sentence's pace behind the wave
  S.voiceOut.forEach((l, i) => {
    const n = S.voiceOut[i + 1];
    if (n && n.s > a && l.e < b && X(n.s) - X(l.e) > 4) boxes.push({ type: "gap", i, x0: X(l.e), x1: X(n.s), y0: VY, y1: VY + VH });
    if (l.e < a || l.s > b) return;
    const pace = paceOf(i), on = selected?.type === "line" && selected.i === i;
    g.fillStyle = tone(on ? "pace-pick" : pace && pace > FAST_WPM ? "pace-fast" : pace && pace < SLOW_WPM ? "pace-slow" : "pace");
    g.fillRect(X(l.s), VY, X(l.e) - X(l.s), VH);
    boxes.push({ type: "line", i, x0: X(l.s), x1: X(l.e), y0: VY, y1: VY + VH });
    if (EDIT.voice.edits[i]) { g.fillStyle = tone("primary"); g.fillRect(X(l.s), VY, X(l.e) - X(l.s), 2); }
  });
  drawWave(g, a, b, w, VY, VH);
  // Actions and sounds, in lanes so they don't cover each other; as many lanes as the Action row's height holds, 3 to 2
  const count = Math.max(2, Math.floor(rows.action / LANE_H)), moves = Math.max(1, Math.round(count * 0.6));
  const lanes: Record<string, number[]> = { motion: Array(moves).fill(-1e9), sound: Array(Math.max(1, count - moves)).fill(-1e9) };
  const BASE: Record<string, number> = { motion: AY, sound: AY + moves * LANE_H };
  g.font = `11px ${UI_FONT}`;
  for (const [id, m] of Object.entries(EDIT.beats).sort((p, q) => p[1].at - q[1].at)) {
    const o0 = fromSource(m.at), o1 = fromSource(m.at + m.dur);
    if (o1 < a || o0 > b) continue;
    const row = lanes[m.kind], x0 = X(o0), x1 = Math.max(x0 + 10, X(o1));
    let lane = row.findIndex((end) => x0 >= end + 2);
    if (lane < 0) lane = 0;
    const label = HOLDS.has(id) ? x0 + 6 : x1;
    row[lane] = Math.max(x1, x0 + (m.title.length * 5.6 + 8));
    const y = BASE[m.kind] + lane * LANE_H, on = selected?.type === "beat" && selected.id === id;
    g.fillStyle = tone(m.kind === "sound" ? "clip-wave" : HOLDS.has(id) ? "beat-hold" : m.curve === "snap" ? "beat-snap" : "beat-move");
    g.fillRect(x0, y, x1 - x0, 13);
    if (on) { g.strokeStyle = tone("pick"); g.lineWidth = 2; g.strokeRect(x0 + 1, y + 1, x1 - x0 - 2, 11); }
    g.fillStyle = tone("foreground"); g.fillText(m.title, x0 + 3, y + 7);
    g.fillStyle = tone("primary");
    for (const [off] of m.sounds) if (m.kind === "motion") g.fillRect(X(fromSource(m.at + off)), y + 10, 2, 3);
    boxes.unshift({ type: "beat", id, x0, x1: Math.min(x1, label + 60), y0: y, y1: y + 13 });
  }
  g.fillStyle = tone("warn");
  for (const [s0, s1] of marks.optionRanges()) if (s1 >= a && s0 <= b) g.fillRect(X(s0), h - 5, Math.max(1, X(s1) - X(s0)), 4);
  // Words, as many as fit
  g.font = `12px ${UI_FONT}`;
  let right = -1;
  for (const l of S.voiceOut) {
    if (l.e < a || l.s > b) continue;
    for (const word of l.words) {
      const x = X(word.s);
      if (x < -40 || x > w) continue;
      const wd = g.measureText(word.w).width;
      if (x <= right + 3) continue;
      g.fillStyle = t >= word.s && t <= word.e ? tone("primary") : tone("foreground");
      g.fillText(word.w, x, VY + VH + 11);
      right = x + wd;
    }
  }
  if (!S.voice.lines.length) { g.fillStyle = tone("muted-foreground"); g.fillText("Reading the voice track…", 8, VY + VH + 11); }
  // Notes: a marker each, their lines faint so many of them don't drown the playhead; a done note keeps only a dim marker.
  // Markers under 2 px apart are drawn once and touching lines as one, so thousands of notes stay a few hundred shapes for the
  // GPU (which, drawing every one, held a 3000-note film to 23 fps). marks.notes() comes in film order
  const open = new Path2D(), done = new Path2D(), runs: [number, number][] = [];
  let lastOpen = -1e9, lastDone = -1e9;
  g.fillStyle = tone("primary");
  for (const n of marks.notes()) {
    if ((n.to ?? n.t) < a || n.t > b) continue;
    const x = X(n.t);
    if (n.to && !n.done) g.fillRect(x, SH + 1, Math.max(2, X(n.to) - x), 3); // a drawn note that spans moments
    if (x - (n.done ? lastDone : lastOpen) >= 2) {
      const head = n.done ? done : open;
      head.moveTo(x - 5, SH + 1); head.lineTo(x + 5, SH + 1); head.lineTo(x, SH + 10);
      if (n.done) lastDone = x; else lastOpen = x;
    }
    if (n.done) continue;
    const px = Math.floor(x), run = runs.at(-1);
    if (run && px <= run[1] + 1) run[1] = Math.max(run[1], px); else runs.push([px, px]);
  }
  g.fillStyle = tone("note-done"); g.fill(done);
  g.fillStyle = tone("primary"); g.fill(open);
  g.globalAlpha = 0.4;
  for (const [x0, x1] of runs) g.fillRect(x0, SH + 10, x1 - x0 + 1, h - SH - 10);
  g.globalAlpha = 1;
  drawPlayhead(g, X(t), h);
};

// The seconds over every row, as CapCut 9.7's ruler measured off the dev's screenshot: a dark line along its top, the ticks
// hanging from just under it (long at each label, short between, dimmer still), the seconds dim beside each long one so the
// clips under them lead. It stays put while the rows under it scroll, and carries the playhead's head
const drawRuler = () => {
  const c = S.el.ruler, { g, w, h } = sized(c);
  if (!c.width) return;
  const { a, v } = view(), b = a + v, X = (s: number) => ((s - a) / v) * w;
  g.fillStyle = tone("background"); g.fillRect(0, 0, w, h);
  g.fillStyle = tone("backdrop"); g.fillRect(0, 0, w, 1);
  // Room for each label whatever the screen; ten short ticks to a label when they stand apart, as CapCut's, else five
  const tick = [1, 2, 5, 10, 30, 60].find((n) => (n / v) * w >= 72) ?? 60, apart = (tick / v) * w, minor = tick / (apart >= 150 ? 10 : 5);
  g.fillStyle = tone("ruler-dot");
  for (let s = Math.max(0, Math.ceil(a / minor) * minor); s <= b; s += minor) g.fillRect(Math.round(X(s)), 4, 1, 6);
  g.font = `11px ${UI_FONT}`; g.textBaseline = "middle";
  for (let s = Math.max(0, Math.ceil(a / tick) * tick); s <= b; s += tick) {
    const x = Math.round(X(s));
    g.fillStyle = tone("ruler-tick"); g.fillRect(x, 4, 1, 11);
    g.fillStyle = tone("ruler-text"); g.fillText(`${pad(Math.floor(s / 60))}:${pad(s % 60)}`, x + 4, 10);
  }
  drawInOut(g, X, w, h);
  const t = X(S.t);
  drawPlayhead(g, t, h);
  // CapCut's handle: a hollow white shield from the top edge down, the ruler showing through it
  g.beginPath(); g.moveTo(t - 4.5, 1.5); g.lineTo(t + 4.5, 1.5); g.lineTo(t + 4.5, 9); g.quadraticCurveTo(t + 4.5, 11.5, t, 14); g.quadraticCurveTo(t - 4.5, 11.5, t - 4.5, 9); g.closePath();
  g.fillStyle = tone("background"); g.fill();
  g.strokeStyle = tone("pick"); g.lineWidth = 1.5; g.lineJoin = "round"; g.stroke();
};
// CapCut's In to Out stretch (inout.ts): the film outside it dimmed, its ends bracketed in blue
const drawInOut = (g: CanvasRenderingContext2D, X: (s: number) => number, w: number, h: number) => {
  const r = get().inOut;
  if (!r) return;
  const x0 = Math.max(-2, X(r[0])), x1 = Math.min(w + 2, X(r[1]));
  g.fillStyle = "rgba(0,0,0,.55)";
  if (x0 > 0) g.fillRect(0, 0, x0, h);
  if (x1 < w) g.fillRect(x1, 0, w - x1, h);
  g.fillStyle = tone("in-out");
  g.fillRect(x0, 0, Math.max(1, x1 - x0), 2);
  g.fillRect(x0, 0, 2, h); g.fillRect(x1 - 2, 0, 2, h);
};

export const drawTimelines = () => { if (!S.el) return; drawRuler(); drawDetail(); marks.text(); marks.cam(); marks.keys(); marks.lanes(); };
// Shows s seconds (6 at the closest, the whole film at the farthest), as CapCut's zoom slider; zoomSpan scales what is shown
export const ZOOM_MIN = 6;
export const zoomTo = (s: number) => { const span = Math.max(ZOOM_MIN, Math.min(DURATION, s)); set({ span }); stored.set("span", String(span), sessionStorage); drawTimelines(); };
export const zoomSpan = (k: number) => zoomTo(shown() * k);
export const zoomToFit = () => zoomTo(DURATION); // the whole film
// Auto snapping (S, or the toolbar): drags stick to the playhead, words, cuts and edges
export const toggleMagnet = () => { const on = !get().magnet; setPref("magnet", on); say(on ? "Auto snapping on" : "Auto snapping off"); };
// The wheel over any timeline row, as CapCut's: plain scrolls the rows up and down (the browser's own scroll), Ctrl+wheel zooms,
// Alt+wheel slides the stretch along the film without moving the playhead (Shift+wheel too, as in Premiere, and a sideways swipe)
export const timelineWheel = (e: WheelEvent) => {
  if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomSpan(e.deltaY > 0 ? 1.2 : 1 / 1.2); return; }
  const side = e.altKey || e.shiftKey ? e.deltaY || e.deltaX : Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0;
  if (!side) return;
  e.preventDefault();
  const v = shown(), w = S.el.detail.clientWidth || 1, px = side * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? w : 1);
  if (v >= DURATION) return;
  slid = { c: Math.max(v / 2, Math.min(DURATION - v / 2, viewCentre() + (px / w) * v)), t: S.t };
  drawTimelines();
};

const boxAt = (e: PointerEvent) => {
  const r = S.el.detail.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  // A fingertip covers more than these thin rows: take what's nearest within reach, and keep a cut's edge easy to catch
  const reach = e.pointerType === "touch" ? 9 : 0;
  let best: Box | null = null, d = 1e9;
  for (const b of boxes) {
    const dx = Math.max(b.x0 - reach - x, 0, x - b.x1 - reach), dy = Math.max(b.y0 - reach - y, 0, y - b.y1 - reach);
    if (dx || dy) continue;
    const e2 = Math.abs(y - (b.y0 + b.y1) / 2) + (b.type === "line" || b.type === "gap" ? 20 : 0);
    if (e2 < d) { d = e2; best = b; }
  }
  return best;
};

// Scrubbing, as in CapCut: a press on the ruler seeks there and drags; on the rows below (detail) only the playhead line itself
// drags, a click on a word or a beat picks what the panel describes, a click on empty space puts the playhead there and a mouse
// drag draws the box over the rows (rowbox.ts). A touch drag scrubs from anywhere, a fingertip being too wide for the line. The
// stretch below holds still while it drags
export const attachTimeline = () => {
  const { ruler, detail } = S.el;
  const scrub = (c: HTMLCanvasElement, toTime: (e: PointerEvent) => number, grab: (e: PointerEvent) => boolean = () => true) => {
    let press: { x: number; y: number } | null = null; // a touch that has not moved yet
    const start = (e: PointerEvent) => {
      S.dragging = { resume: S.playing };
      if (S.playing) setPlaying(false);
      frozenCentre = viewCentre();
      seek(toTime(e));
      skimSound(S.t);
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      c.setPointerCapture(e.pointerId);
      if (grab(e)) start(e);
      else if (e.pointerType === "touch") press = { x: e.clientX, y: e.clientY };
    };
    const up = () => { press = null; if (!S.dragging) return; const r = S.dragging.resume; S.dragging = null; frozenCentre = null; S.dirty = true; if (r) setPlaying(true); };
    // A move with the button already up ends the drag too: a let-go never heard would otherwise scrub on a mere hover
    const move = (e: PointerEvent) => {
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) >= 4) { press = null; start(e); return; }
      if (!S.dragging) { if (e.pointerType === "mouse" && !e.buttons) c.style.cursor = grab(e) ? "ew-resize" : ""; return; }
      if (!(e.buttons & 1)) up(); else { seek(toTime(e)); skimSound(S.t); }
    };
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) c.addEventListener(t, up);
  };
  let onThing = false; // the press was on a word or a beat, which it picks: its release is no click on empty space
  detail.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const b = boxAt(e);
    onThing = !!b;
    selected = b?.type === "beat" ? { type: "beat", id: b.id } : b && (b.type === "line" || b.type === "gap") ? { type: "line", i: b.i } : null;
    describeSelection();
    const r = detail.getBoundingClientRect();
    if (e.pointerType !== "touch" && !onPlayhead(e.clientX - r.left, r.width, false)) boxStart(e, e.shiftKey || e.ctrlKey || e.metaKey);
  });
  detail.addEventListener("pointermove", boxMove);
  for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) detail.addEventListener(t, (e) => boxEnd(onThing ? undefined : (e as PointerEvent)));
  boxPick.seek = (x) => { const r = detail.getBoundingClientRect(); if (r.width) seek(Math.max(0, Math.min(DURATION, timeAt(x - r.left, r.width)))); };
  const local = (c: HTMLCanvasElement, e: PointerEvent) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, w: r.width }; };
  scrub(ruler, (e) => { const { x, w } = local(ruler, e); return timeAt(x, w); });
  scrub(detail, (e) => { const { x, w } = local(detail, e); return timeAt(x, w); }, (e) => { const { x, w } = local(detail, e); return onPlayhead(x, w, e.pointerType === "touch"); });
  for (const c of [ruler, detail]) c.addEventListener("wheel", timelineWheel, { passive: false });
  new ResizeObserver(drawTimelines).observe(S.el.timeline);
  window.__editor ??= { boxes: () => boxes, seek, duration: () => DURATION, clear: () => { selected = null; describeSelection(); }, words: () => S.voice.lines.flatMap((l) => l.words.map((w) => w.s)) };
};

// The voice lines and their words, which the timeline lays out and the captions read
export const loadVoice = async () => { const r = await getFile("/api/voice_map.json"); if (r.ok) { S.voice = await r.json(); refreshTimes(); } };
