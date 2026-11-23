import { DURATION } from "../core/filmMeta";
import { S } from "../core/state";
import { get, say, setPref } from "../core/store";
import { FPS } from "../core/time";
import { resumeAudio } from "../sound/clock";
import { skimSound } from "../sound/skim";
import { timeAt } from "./timeline";

let peek: { t: number; at: number } | null = null;

const allowed = () => {
  const s = get();
  return s.previewAxis && !S.playing && !S.dragging && !s.free && !s.compose && !s.ink;
};
export const peekTime = () => {
  if (peek && (peek.at !== S.t || !allowed())) end();
  return peek?.t ?? null;
};
const end = () => {
  if (!peek) return;
  peek = null;
  S.el.peek.hidden = true;
  S.dirty = true;
};

export const togglePreviewAxis = () => {
  const on = !get().previewAxis;
  setPref("previewAxis", on);
  if (!on) end();
  say(on ? "Preview axis on: point at the timeline to see that frame" : "Preview axis off");
};
export const togglePreviewAudio = () => {
  const on = !get().previewAudio;
  setPref("previewAudio", on);
  if (on) {
    resumeAudio();
    if (!get().previewAxis) setPref("previewAxis", true);
  }
  say(
    on
      ? "Preview axis with sound: point at the timeline to hear that moment (Shift+S for picture only)"
      : "Preview axis: picture only",
  );
};

export const attachPreviewAxis = () => {
  const { timeline, ruler, detail, camrow, textrow, keyrows, lanes, peek: line } = S.el;
  const rows = [ruler, camrow, textrow, detail, keyrows, lanes];
  const scroller = detail.closest<HTMLElement>("[data-tracks-scroll]")!;
  timeline.addEventListener("pointermove", (e) => {
    const target = e.target as Element | null;
    const dr = detail.getBoundingClientRect();
    const inGap =
      !!target &&
      scroller.contains(target) &&
      !target.closest("button, input, canvas, [role=separator]") &&
      dr.width > 0 &&
      e.clientX >= dr.left &&
      e.clientX <= dr.right;
    const c =
      rows.find((r) => r === e.target) ??
      (target instanceof HTMLCanvasElement && target.hasAttribute("data-timeline-row")
        ? target
        : inGap
          ? detail
          : null);
    if (!c || e.pointerType !== "mouse" || e.buttons || !allowed()) return end();
    const r = c.getBoundingClientRect(),
      x = Math.max(0, Math.min(r.width, e.clientX - r.left));
    const t = Math.max(0, Math.min(DURATION - 0.01, Math.round(timeAt(x, r.width) * FPS) / FPS));
    const box = timeline.getBoundingClientRect(),
      top = ruler.getBoundingClientRect().top;
    line.style.top = `${top - box.top}px`;
    line.style.height = `${scroller.getBoundingClientRect().bottom - top}px`;
    line.style.translate = `${r.left + x - box.left}px`;
    line.hidden = false;
    if (peek?.t !== t) {
      peek = { t, at: S.t };
      S.dirty = true;
      skimSound(t);
    }
  });
  timeline.addEventListener("pointerleave", end);
  timeline.addEventListener("pointerdown", end, { capture: true });
  scroller.addEventListener("scroll", end, { passive: true });
  timeline.addEventListener("wheel", end, { passive: true });
};
