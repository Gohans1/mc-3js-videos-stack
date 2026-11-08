// The key rows under the camera row, on the same seconds as the stretch above: per key file a heading line, then one row per list
// of keys in it (keys/keys.ts), names in the column beside (keys/KeyHeads.tsx). A diamond per key, labelled with what it says
// ("sits up", "tense"); a solid line between two keys that differ (something changes there), a dotted one where the row holds.
// Dragging a diamond retimes it (and every key picked with it), never past a key of its row that stays, snapping to frames,
// the playhead, words and cuts (Shift: no snap). A box dragged over empty space picks every key it touches (Shift/Ctrl add), on
// these rows and the others it crosses (timeline/rowbox.ts, across.ts), and a drag on a picked key moves all of it;
// a click on a key seeks there, one on empty space drops the pick and moves the playhead there (CapCut, the dev's call
// 2026-11-09); a touch dragged over empty space scrubs.
import { SHOTS_OUT as SHOTS } from "film/scene";
import { snapTo, stamp } from "../core/time";
import { editKeys, HEAD_H, hold, isPicked, keyOf, keysOf, lines, linesHeight, litRow, nameOf, pickKeys, preview, restore, ROW_H, room, same, sameKey, snapshot } from "./keys";
import { S } from "../core/state";
import { get, noSnap, say } from "../core/store";
import { type KeyRef } from "./slice";
import { together } from "../core/doc";
import { alongWith, type Along, inBox, pickAcross, picked } from "../timeline/across";
import { drawPlayhead, keyReach, REACH, sized, tone, UI_FONT } from "../timeline/canvas";
import { boxEnd, boxMove, boxStart } from "../timeline/rowbox";
import { holdView, marks, onPlayhead, timeAt, timelineWheel, view } from "../timeline/timeline";
import { seek, setPlaying } from "../playback/transport";

const HOLD = "#4F4F4F"; // the dotted line where a row holds still; every other colour is an index.css token
const R = 4.5;


type Spot = { ref: KeyRef; x: number; y: number };
let spots: Spot[] = [];

const diamond = (g: CanvasRenderingContext2D, x: number, y: number, r: number) => { g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); };

export const drawKeyRows = () => {
  const c = S.el?.keyrows;
  if (!c || !get().keyFiles?.length || !c.getClientRects().length) return;
  const height = linesHeight();
  if (c.style.height !== `${height}px`) c.style.height = `${height}px`;
  const { g, w, h } = sized(c);
  if (!c.width) return;
  const { a, v } = view(), X = (s: number) => ((s - a) / v) * w;
  g.fillStyle = tone("track"); g.fillRect(0, 0, w, h);
  g.font = `12px ${UI_FONT}`; g.textBaseline = "middle";
  spots = [];
  const lit = litRow();
  for (const l of lines()) {
    // Flat rows as CapCut's tracks; the file's heading in the label column's colour (KeyHeads.tsx bg-card)
    if (l.kind === "file") { g.fillStyle = tone("card"); g.fillRect(0, l.y, w, HEAD_H); continue; }
    if (l.row.id === lit) { g.fillStyle = tone("tint"); g.fillRect(0, l.y, w, ROW_H); }
    const ks = keysOf(l.row.f, l.row.path), y = l.y + ROW_H / 2;
    // What happens between keys first, so the diamonds sit on top
    for (let i = 1; i < ks.length; i++) {
      const x0 = X(ks[i - 1].t), x1 = X(ks[i].t);
      if (x1 < 0 || x0 > w || x1 - x0 < 1) continue;
      if (same(ks[i - 1], ks[i])) { g.fillStyle = HOLD; for (let x = Math.max(0, x0); x < Math.min(w, x1); x += 4) g.fillRect(x, y, 2, 1); }
      else { g.fillStyle = tone("muted-foreground"); g.fillRect(Math.max(0, x0), y, Math.min(w, x1) - Math.max(0, x0), 1); }
    }
    ks.forEach((k, i) => {
      const x = X(k.t);
      if (x < -60 || x > w + REACH) return;
      const ref = { f: l.row.f, path: l.row.path, i };
      spots.push({ ref, x, y });
      const name = nameOf(k), room = (i + 1 < ks.length ? X(ks[i + 1].t) : w) - x - 10;
      if (name && room > 24) {
        g.save(); g.beginPath(); g.rect(x + 7, l.y, room, ROW_H); g.clip();
        g.fillStyle = l.row.id === lit ? tone("tint") : tone("track"); g.fillRect(x + 6, y - 7, Math.min(room, g.measureText(name).width + 4), 14);
        g.fillStyle = tone("label"); g.fillText(name, x + 8, y);
        g.restore();
      }
      diamond(g, x, y, R); g.fillStyle = tone("foreground"); g.fill();
      if (isPicked(ref)) { diamond(g, x, y, R + 3); g.strokeStyle = tone("pick"); g.lineWidth = 2; g.stroke(); }
    });
  }
  // Cuts, faint, over everything: a key is often put on one by eye
  g.fillStyle = tone("grid");
  for (const s of SHOTS) if (s.t > a && s.t < a + v) g.fillRect(X(s.t), 0, 1, h);
  drawPlayhead(g, X(S.t), h);
};

const snapPoints = () => [S.t, ...SHOTS.map((s) => s.t), ...S.voiceOut.flatMap((l) => l.words.map((w) => w.s))];
const snapped = (s: number, perPx: number, off: boolean) => snapTo(s, snapPoints(), perPx, off, true);
// The key a press takes: the playhead line comes first over keys behind it (a crowd of keys never hides it), except the
// picked key, which a click has just brought the playhead onto and which must still drag
const keyUnder = (x: number, y: number, w: number, touch: boolean) => {
  const s = spotAt(x, y, touch);
  return s && onPlayhead(x, w, touch) && !isPicked(s.ref) ? null : s;
};
const spotAt = (x: number, y: number, touch: boolean) => {
  const reach = keyReach(touch);
  let best: Spot | null = null, d = reach;
  for (const s of spots) { if (Math.abs(s.y - y) > ROW_H / 2) continue; const e = Math.abs(s.x - x); if (e <= d) { d = e; best = s; } }
  return best;
};
const keysInBox = (b: { x0: number; x1: number; y0: number; y1: number }) => {
  const r = S.el.keyrows.getBoundingClientRect();
  if (!r.height) return [];
  return spots.filter((s) => r.left + s.x >= b.x0 - R && r.left + s.x <= b.x1 + R && r.top + s.y >= b.y0 - R && r.top + s.y <= b.y1 + R).map((s) => s.ref);
};

export const attachKeyRows = () => {
  const c = S.el.keyrows;
  marks.keys = drawKeyRows;
  inBox.keys = keysInBox;
  const local = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width }; };
  let drag: { ref: KeyRef; group: KeyRef[]; along: Along | null; x: number; t: number; snap: string[]; moved: boolean; alone: boolean } | null = null;
  let scrub: { resume: boolean } | null = null;
  let box: { add: boolean } | null = null;

  c.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const { x, y, w } = local(e), touch = e.pointerType === "touch", add = e.shiftKey || e.ctrlKey || e.metaKey;
    const s = add ? spotAt(x, y, touch) : keyUnder(x, y, w, touch);
    if (get().blade) { say("Split mode cuts sound clips and shots, not keyframes. Press A to select again"); return; }
    c.setPointerCapture(e.pointerId);
    if (!s) {
      const grab = onPlayhead(x, w, touch);
      if (touch || grab) {
        if (!grab) pickKeys([]);
        scrub = { resume: S.playing };
        holdView(true);
        if (S.playing) setPlaying(false);
      } else { box = { add }; boxStart(e, add); }
      return;
    }
    if (add) { const p = picked(); pickAcross({ ...p, keys: isPicked(s.ref) ? p.keys.filter((q) => !sameKey(q, s.ref)) : [...p.keys, s.ref] }); return; }
    const was = isPicked(s.ref);
    if (!was) pickKeys([s.ref]);
    const along = was ? alongWith("keys") : null;
    drag = { ref: s.ref, group: get().keyPicks, along, x, t: keyOf(s.ref).t, snap: snapshot(), moved: false, alone: was && (get().keyPicks.length > 1 || !!along) };
  });
  c.addEventListener("pointermove", (e) => {
    const { x, y, w } = local(e), { v } = view(), perPx = v / w;
    if (scrub) { seek(timeAt(x, w)); return; }
    if (get().blade && !drag && !box) { c.style.cursor = "not-allowed"; return; }
    if (box) { boxMove(e); return; }
    if (!drag) { c.style.cursor = keyUnder(x, y, w, false) ? "grab" : onPlayhead(x, w, false) ? "ew-resize" : "crosshair"; return; }
    if (!drag.moved && Math.abs(x - drag.x) < 3) return;
    if (!drag.moved) hold(true);
    drag.moved = true;
    c.style.cursor = "grabbing";
    // The key under the pointer snaps; the rest of the pick moves as far, none past a key of its row that stays
    restore(drag.snap);
    const { along } = drag, [lo, hi] = room(drag.group), want = snapped(drag.t + (x - drag.x) * perPx, perPx, noSnap(e)) - drag.t;
    const d = Math.max(lo, along?.room[0] ?? lo, Math.min(hi, along?.room[1] ?? hi, want));
    preview(drag.group, (r, ks) => { ks[r.i].t = Math.round((ks[r.i].t + d) * 1000) / 1000; });
    along?.preview(d);
    const others = drag.group.length - 1 + (along?.count ?? 0), many = others ? ` + ${others} more` : "";
    say(`${drag.ref.path.join(".")}${many}: ${stamp(drag.t)} → ${stamp(drag.t + d)}${d !== want ? " (stopped by its neighbour)" : noSnap(e) ? "" : " (Shift: no snapping)"}`, 1500);
  });
  const up = (e: PointerEvent) => {
    if (scrub) { const r = scrub.resume; scrub = null; holdView(false); if (r) setPlaying(true); return; }
    if (box) { box = null; boxEnd(e); return; }
    if (!drag) return;
    const { snap, moved, alone, ref, group, along, t: was } = drag;
    drag = null;
    c.style.cursor = "";
    // A plain click also brings the picture to the key, so the Key tab and the frame show the same moment
    if (!moved) { if (alone) pickKeys([ref]); seek(keyOf(ref).t); return; }
    const after = group.map((r) => keyOf(r).t), d = Math.round((keyOf(ref).t - was) * 1000) / 1000;
    restore(snap);
    hold(false);
    along?.restore();
    together(() => {
      editKeys(group, (r, ks) => { ks[r.i].t = after[group.findIndex((g) => sameKey(g, r))]; });
      along?.commit(d);
    });
  };
  c.addEventListener("pointerup", up);
  c.addEventListener("pointercancel", up);
  c.addEventListener("lostpointercapture", up);
  c.addEventListener("wheel", timelineWheel, { passive: false });
  new ResizeObserver(drawKeyRows).observe(c);
};
