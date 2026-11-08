// The key rows under the camera row, on the same seconds as the stretch above: per key file a heading line, then one row per list
// of keys in it (keys/keys.ts), names in the column beside (keys/KeyHeads.tsx). A diamond per key, labelled with what it says
// ("sits up", "tense"); a solid line between two keys that differ (something changes there), a dotted one where the row holds.
// Dragging a diamond retimes it (and every key picked with it), never past a key of its row that stays, snapping to frames,
// the playhead, words and cuts (Shift: no snap). A box dragged over empty space picks every key it touches (Shift/Ctrl add);
// a click on a key or on empty space seeks there; a touch on empty space scrubs.
import { SHOTS_OUT as SHOTS } from "film/scene";
import { snapTo, stamp } from "../core/time";
import { editKeys, HEAD_H, hold, isPicked, keyOf, keysOf, lines, linesHeight, litRow, nameOf, pickKeys, preview, restore, ROW_H, room, same, sameKey, snapshot } from "./keys";
import { S } from "../core/state";
import { get, noSnap, say } from "../core/store";
import { type KeyRef } from "./slice";
import { drawMarquee, keyReach, type Marquee, marqueeRect, PICK, REACH, sized, UI_FONT } from "../timeline/canvas";
import { holdView, marks, onPlayhead, timeAt, timelineWheel, view } from "../timeline/timeline";
import { seek, setPlaying } from "../playback/transport";

const COLOR = { bg: "#100F0F", band: ["#151413", "#121110"], lit: "#1C2C2A", head: "#1C1B1A", line: "#878580", hold: "#403E3C", key: "#E6E4D9", text: "#B7B5AC", cut: "#2A2928" };
const R = 4.5;


type Spot = { ref: KeyRef; x: number; y: number };
let spots: Spot[] = [];
let marquee: Marquee | null = null;

const diamond = (g: CanvasRenderingContext2D, x: number, y: number, r: number) => { g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); };

export const drawKeyRows = () => {
  const c = S.el?.keyrows;
  if (!c || !get().keyFiles?.length || !c.getClientRects().length) return;
  const height = linesHeight();
  if (c.style.height !== `${height}px`) c.style.height = `${height}px`;
  const { g, w, h } = sized(c);
  if (!c.width) return;
  const { a, v } = view(), X = (s: number) => ((s - a) / v) * w;
  g.fillStyle = COLOR.bg; g.fillRect(0, 0, w, h);
  g.font = `12px ${UI_FONT}`; g.textBaseline = "middle";
  spots = [];
  let band = 0;
  const lit = litRow();
  for (const l of lines()) {
    if (l.kind === "file") { g.fillStyle = COLOR.head; g.fillRect(0, l.y, w, HEAD_H); band = 0; continue; }
    g.fillStyle = l.row.id === lit ? COLOR.lit : COLOR.band[band % 2]; g.fillRect(0, l.y, w, ROW_H);
    band++;
    const ks = keysOf(l.row.f, l.row.path), y = l.y + ROW_H / 2;
    // What happens between keys first, so the diamonds sit on top
    for (let i = 1; i < ks.length; i++) {
      const x0 = X(ks[i - 1].t), x1 = X(ks[i].t);
      if (x1 < 0 || x0 > w || x1 - x0 < 1) continue;
      if (same(ks[i - 1], ks[i])) { g.fillStyle = COLOR.hold; for (let x = Math.max(0, x0); x < Math.min(w, x1); x += 4) g.fillRect(x, y, 2, 1); }
      else { g.fillStyle = COLOR.line; g.fillRect(Math.max(0, x0), y, Math.min(w, x1) - Math.max(0, x0), 1); }
    }
    ks.forEach((k, i) => {
      const x = X(k.t);
      if (x < -60 || x > w + REACH) return;
      const ref = { f: l.row.f, path: l.row.path, i };
      spots.push({ ref, x, y });
      const name = nameOf(k), room = (i + 1 < ks.length ? X(ks[i + 1].t) : w) - x - 10;
      if (name && room > 24) {
        g.save(); g.beginPath(); g.rect(x + 7, l.y, room, ROW_H); g.clip();
        g.fillStyle = COLOR.bg; g.fillRect(x + 6, y - 7, Math.min(room, g.measureText(name).width + 4), 14);
        g.fillStyle = COLOR.text; g.fillText(name, x + 8, y);
        g.restore();
      }
      diamond(g, x, y, R); g.fillStyle = COLOR.key; g.fill();
      if (isPicked(ref)) { diamond(g, x, y, R + 3); g.strokeStyle = PICK; g.lineWidth = 2; g.stroke(); }
    });
  }
  // Cuts, faint, over everything: a key is often put on one by eye
  g.fillStyle = COLOR.cut;
  for (const s of SHOTS) if (s.t > a && s.t < a + v) g.fillRect(X(s.t), 0, 1, h);
  if (marquee) drawMarquee(g, marquee);
  const t = X(S.t);
  g.fillStyle = "#000"; g.fillRect(t - 2, 0, 4, h);
  g.fillStyle = "#EC8B49"; g.fillRect(t - 1, 0, 2, h);
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
const inBox = (m: NonNullable<typeof marquee>) => {
  const { x0, x1, y0, y1 } = marqueeRect(m);
  return spots.filter((s) => s.x >= x0 - R && s.x <= x1 + R && s.y >= y0 - R && s.y <= y1 + R).map((s) => s.ref);
};

export const attachKeyRows = () => {
  const c = S.el.keyrows;
  marks.keys = drawKeyRows;
  const local = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width }; };
  let drag: { ref: KeyRef; group: KeyRef[]; x: number; t: number; snap: string[]; moved: boolean; alone: boolean } | null = null;
  let scrub: { resume: boolean } | null = null;
  let box: { x: number; y: number; base: KeyRef[]; moved: boolean } | null = null;

  c.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const { x, y, w } = local(e), touch = e.pointerType === "touch", add = e.shiftKey || e.ctrlKey || e.metaKey;
    const s = add ? spotAt(x, y, touch) : keyUnder(x, y, w, touch);
    if (get().blade) { say("Split mode cuts sound clips and shots, not keyframes. Press A to select again"); return; }
    c.setPointerCapture(e.pointerId);
    if (!s) {
      const grab = onPlayhead(x, w, touch);
      if (touch || grab) {
        if (!grab) { pickKeys([]); seek(timeAt(x, w)); }
        scrub = { resume: S.playing };
        holdView(true);
        if (S.playing) setPlaying(false);
      } else box = { x, y, base: add ? get().keyPicks : [], moved: false };
      return;
    }
    if (add) { pickKeys(isPicked(s.ref) ? get().keyPicks.filter((p) => !sameKey(p, s.ref)) : [...get().keyPicks, s.ref]); return; }
    const was = isPicked(s.ref);
    if (!was) pickKeys([s.ref]);
    drag = { ref: s.ref, group: get().keyPicks, x, t: keyOf(s.ref).t, snap: snapshot(), moved: false, alone: was && get().keyPicks.length > 1 };
  });
  const edgeScroll = (e: PointerEvent) => {
    const el = c.closest<HTMLElement>("[data-tracks-scroll]"), r = el?.getBoundingClientRect();
    if (!el || !r) return;
    if (e.clientY > r.bottom - 18) el.scrollTop += 10; else if (e.clientY < r.top + 18) el.scrollTop -= 10;
  };
  c.addEventListener("pointermove", (e) => {
    const { x, y, w } = local(e), { v } = view(), perPx = v / w;
    if (scrub) { seek(timeAt(x, w)); return; }
    if (get().blade && !drag && !box) { c.style.cursor = "not-allowed"; return; }
    if (box) {
      if (!box.moved && Math.hypot(x - box.x, y - box.y) < 4) return;
      box.moved = true;
      edgeScroll(e);
      marquee = { x0: box.x, y0: box.y, x1: x, y1: y };
      const inside = inBox(marquee);
      pickKeys([...box.base.filter((p) => !inside.some((r) => sameKey(r, p))), ...inside]);
      drawKeyRows();
      return;
    }
    if (!drag) { c.style.cursor = keyUnder(x, y, w, false) ? "grab" : onPlayhead(x, w, false) ? "ew-resize" : "crosshair"; return; }
    if (!drag.moved && Math.abs(x - drag.x) < 3) return;
    if (!drag.moved) hold(true);
    drag.moved = true;
    c.style.cursor = "grabbing";
    // The key under the pointer snaps; the rest of the pick moves as far, none past a key of its row that stays
    restore(drag.snap);
    const [lo, hi] = room(drag.group), want = snapped(drag.t + (x - drag.x) * perPx, perPx, noSnap(e)) - drag.t, d = Math.max(lo, Math.min(hi, want));
    preview(drag.group, (r, ks) => { ks[r.i].t = Math.round((ks[r.i].t + d) * 1000) / 1000; });
    const many = drag.group.length > 1 ? ` + ${drag.group.length - 1} key` : "";
    say(`${drag.ref.path.join(".")}${many}: ${stamp(drag.t)} → ${stamp(drag.t + d)}${d !== want ? " (stopped by its neighbour)" : noSnap(e) ? "" : " (Shift: no snapping)"}`, 1500);
  });
  const up = () => {
    if (scrub) { const r = scrub.resume; scrub = null; holdView(false); if (r) setPlaying(true); return; }
    if (box) {
      const { moved, base, x } = box;
      box = null; marquee = null;
      if (!moved) { if (!base.length) pickKeys([]); seek(timeAt(x, c.getBoundingClientRect().width)); }
      else if (get().keyPicks.length > 1) say(`${get().keyPicks.length} keyframes selected. Drag one to move them all`);
      drawKeyRows();
      return;
    }
    if (!drag) return;
    const { snap, moved, alone, ref, group } = drag;
    drag = null;
    c.style.cursor = "";
    // A plain click also brings the picture to the key, so the Key tab and the frame show the same moment
    if (!moved) { if (alone) pickKeys([ref]); seek(keyOf(ref).t); return; }
    const after = group.map((r) => keyOf(r).t);
    restore(snap);
    hold(false);
    editKeys(group, (r, ks) => { ks[r.i].t = after[group.findIndex((g) => sameKey(g, r))]; });
  };
  c.addEventListener("pointerup", up);
  c.addEventListener("pointercancel", up);
  c.addEventListener("lostpointercapture", up);
  c.addEventListener("wheel", timelineWheel, { passive: false });
  new ResizeObserver(drawKeyRows).observe(c);
};
