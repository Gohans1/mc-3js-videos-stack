// The picture's size, and what the mouse and keys do on it, as in a 3D editor's viewport: a click picks an object (or a title,
// text/onpicture.ts), the right button pins a note and a right drag draws one (notes/ink.ts sketch); a tap on a phone, which has
// no right button, pins the note. Dragging and the flying keys move the free camera, and a left drag on the film's own view turns
// the free camera on from that view, turning
import { S } from "../core/state";
import { get } from "../core/store";
import { sketch } from "../notes/ink";
import { openNote } from "../notes/notes";
import { textPress } from "../text/onpicture";
import { gizmoBusy, hover, pickAt, select } from "../objects/placed";
import { setPlaying } from "../playback/transport";
import { frameSize } from "./frame";
import { flight, flyCam, moveCam, setFree, turnAbout } from "./freecam";
import { lookAtClick } from "./look";
import { render } from "./render";

export const fit = () => {
  const r = S.el.view.getBoundingClientRect(), [w, h] = frameSize(16), s = Math.min(r.width / w, r.height / h);
  S.el.stage.style.width = `${Math.floor(s * w)}px`; S.el.stage.style.height = `${Math.floor(s * h)}px`;
};
export const attachPicture = () => {
  const { canvas } = S.el;
  new ResizeObserver(fit).observe(S.el.view);
  let downAt: [number, number] | null = null, camDrag: { x: number; y: number; mode: "look" | "orbit" | "slide" } | null = null;
  let wake: { x: number; y: number; id: number; orbit: boolean } | null = null; // a left press on the film's view, a drag once it moves
  let right: PointerEvent | null = null; // a right press on the film's view: a note pinned, or a drawing once it moves
  const frac = (e: MouseEvent) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height] as const; };
  canvas.addEventListener("pointerdown", (e) => {
    if (gizmoBusy()) { downAt = null; return; } // the gizmo's handle under the pointer takes this drag
    if (!S.tools?.free.on && textPress(e, frac(e))) { downAt = null; return; } // a title on the picture: picked and dragged
    downAt = [e.clientX, e.clientY];
    if (!S.tools?.free.on) {
      if (e.pointerType === "mouse" && e.button === 0) wake = { x: e.clientX, y: e.clientY, id: e.pointerId, orbit: e.shiftKey };
      if (e.pointerType === "mouse" && e.button === 2) right = e;
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    camDrag = { x: e.clientX, y: e.clientY, mode: e.button !== 0 ? "slide" : e.shiftKey ? "orbit" : "look" };
  });
  canvas.addEventListener("pointermove", (e) => {
    if (right && !sketch.on() && Math.hypot(e.clientX - right.clientX, e.clientY - right.clientY) > 4) {
      canvas.setPointerCapture(right.pointerId);
      sketch.start(e, right);
      downAt = null;
      hover(null);
    }
    if (sketch.on()) { sketch.move(e); return; }
    if (wake && Math.hypot(e.clientX - wake.x, e.clientY - wake.y) > 4 && S.tools) {
      setFree(true, true);
      canvas.setPointerCapture(wake.id);
      camDrag = { x: wake.x, y: wake.y, mode: wake.orbit ? "orbit" : "look" };
      downAt = wake = null;
      hover(null);
    }
    if (!camDrag && e.pointerType === "mouse" && !gizmoBusy()) hover(pickAt(...frac(e)));
    if (!camDrag || !S.tools) return;
    const f = S.tools.free, dx = e.clientX - camDrag.x, dy = e.clientY - camDrag.y;
    camDrag.x = e.clientX; camDrag.y = e.clientY;
    if (camDrag.mode === "look") turnAbout(f.p, f.l, -dx * 0.0025, dy * 0.0025);
    else if (camDrag.mode === "orbit") turnAbout(f.l, f.p, -dx * 0.005, -dy * 0.005);
    else { const s = f.p.distanceTo(f.l) * 0.0012; moveCam(0, -dx * s, dy * s); }
    S.viewMoved = true;
  });
  addEventListener("pointerup", () => { camDrag = wake = right = null; });
  canvas.addEventListener("pointercancel", () => { sketch.drop(); right = null; });
  canvas.addEventListener("pointerleave", () => hover(null));
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  // Flying keys, by their place on the keyboard (any layout). Typing a note or a shortcut with Ctrl never flies. Any other key,
  // click or scroll while Shift is held makes a shortcut of it: the height Shift dropped comes back first, which is why these
  // listen in the capture phase, before the shortcut itself (Shift+K saves the view) reads the camera
  const chord = () => { const back = flight.chord(); if (back) flyCam(0, 0, back); };
  addEventListener("keydown", (e) => {
    if (!S.tools?.free.on) return;
    if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]")) return;
    if (!e.ctrlKey && !e.metaKey && !e.altKey && flight.press(e.code, e.timeStamp / 1000)) { e.preventDefault(); S.viewMoved = true; }
    else chord();
  }, true);
  for (const type of ["pointerdown", "wheel"]) addEventListener(type, (e) => { if ((e as MouseEvent).shiftKey && S.tools?.free.on) chord(); }, true);
  addEventListener("keyup", (e) => flight.release(e.code));
  addEventListener("blur", () => flight.clear()); // a key let go in another window never comes back as a keyup
  canvas.addEventListener("wheel", (e) => { if (!S.tools?.free.on) return; e.preventDefault(); moveCam((e.deltaY > 0 ? -1 : 1) * (e.shiftKey ? 0.03 : 0.12), 0, 0); }, { passive: false });
  // A press that didn't move: anything further was the free camera being dragged
  const tapped = (e: MouseEvent) => {
    if (!downAt || !S.render) return null;
    const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
    downAt = null;
    if (moved > 4) return null;
    if (S.playing) setPlaying(false);
    render(S.t);
    return frac(e);
  };
  // A note box opened mid-flight takes no focus, or the W still held would type into it
  const pinNote = (x: number, y: number) => openNote({ x: +x.toFixed(4), y: +y.toFixed(4), ...lookAtClick(x, y) }, !flight.flying());
  // On click, not pointerup: a phone only lets the note box take focus and raise its keyboard from a click
  canvas.addEventListener("click", (e) => {
    if (e.button !== 0) return;
    const at = tapped(e);
    if (!at) return;
    if (e.pointerType === "mouse") select(pickAt(...at)); // beside every object: nothing selected
    else pinNote(...at);
  });
  canvas.addEventListener("pointerup", (e) => {
    if (e.button !== 2 || e.pointerType !== "mouse") return;
    if (sketch.on()) { sketch.end(); return; }
    const at = tapped(e);
    if (at) pinNote(...at);
  });
};
