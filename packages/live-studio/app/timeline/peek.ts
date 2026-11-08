// CapCut's preview axis (S, or the timeline bar): with the mouse over the ruler or the rows under it, a yellow line follows it
// and the picture shows the frame there, the clock its time in yellow; the playhead stays. Pins and drawn strokes belong to
// the playhead's frame, so they hide meanwhile. Only a mouse with no button down: touch has no hover, and a press drags or
// scrubs. Off while playing, writing a note, drawing or flying the free camera, where the picture must stay on the playhead.
// Picture only unless Shift+S, CapCut's "video and audio": then each new frame under the pointer plays a few frames of its
// sound, and a dragged playhead's too (sound/skim.ts)
import { DURATION } from "film/scene";
import { FPS } from "../core/time";
import { S } from "../core/state";
import { get, say, setPref } from "../core/store";
import { audioCtx } from "../sound/clock";
import { skimSound } from "../sound/skim";
import { timeAt } from "./timeline";

let peek: { t: number; at: number } | null = null; // the second shown, and the playhead's then: once that moves, the peek ends

const allowed = () => { const s = get(); return s.previewAxis && !S.playing && !S.dragging && !s.free && !s.compose && !s.ink; };
// The second the picture shows instead of the playhead's, or null
export const peekTime = () => {
  if (peek && (peek.at !== S.t || !allowed())) end();
  return peek?.t ?? null;
};
const end = () => { if (!peek) return; peek = null; S.el.peek.hidden = true; S.dirty = true; };

export const togglePreviewAxis = () => {
  const on = !get().previewAxis;
  setPref("previewAxis", on);
  if (!on) end();
  say(on ? "Preview axis on: point at the timeline to see that frame" : "Preview axis off");
};
// Shift+S. The key is the page's first gesture often enough: the audio context may start here
export const togglePreviewAudio = () => {
  const on = !get().previewAudio;
  setPref("previewAudio", on);
  if (on) { void audioCtx.resume(); if (!get().previewAxis) setPref("previewAxis", true); }
  say(on ? "Preview axis with sound: point at the timeline to hear that moment (Shift+S for picture only)" : "Preview axis: picture only");
};

export const attachPreviewAxis = () => {
  const { timeline, ruler, detail, camrow, keyrows, lanes, peek: line } = S.el;
  const rows = [ruler, detail, camrow, keyrows, lanes];
  const scroller = detail.parentElement!; // the rows' scroll box, under the ruler
  timeline.addEventListener("pointermove", (e) => {
    const c = rows.find((r) => r === e.target);
    if (!c || e.pointerType !== "mouse" || e.buttons || !allowed()) return end();
    const r = c.getBoundingClientRect(), x = Math.max(0, Math.min(r.width, e.clientX - r.left));
    const t = Math.max(0, Math.min(DURATION - 0.01, Math.round(timeAt(x, r.width) * FPS) / FPS));
    const box = timeline.getBoundingClientRect(), top = ruler.getBoundingClientRect().top;
    line.style.top = `${top - box.top}px`;
    line.style.height = `${scroller.getBoundingClientRect().bottom - top}px`;
    line.style.translate = `${r.left + x - box.left}px`;
    line.hidden = false;
    if (peek?.t !== t) { peek = { t, at: S.t }; S.dirty = true; skimSound(t); }
  });
  timeline.addEventListener("pointerleave", end);
  timeline.addEventListener("pointerdown", end, { capture: true }); // a click scrubs, picks or cuts: the playhead's frame again
  scroller.addEventListener("scroll", end, { passive: true });
  timeline.addEventListener("wheel", end, { passive: true }); // a zoom or slide moves the second under the pointer
};
