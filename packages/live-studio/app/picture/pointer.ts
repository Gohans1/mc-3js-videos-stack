// The picture's size, and what the mouse and keys do on it, as in a 3D editor's viewport: a click picks an object (or a title,
// text/onpicture.ts), the right button pins a note and a right drag draws one (notes/ink.ts sketch); a tap on a phone, which has
// no right button, pins the note. Dragging and the flying keys move the free camera, and a left drag on the film's own view turns
// the free camera on from that view.
import { S } from "../core/state";
import { get } from "../core/store";
import { sketch } from "../notes/ink";
import { openNote } from "../notes/notes";
import { gizmoBusy, hover, pickAt, selectTarget } from "../objects/placed";
import { setPlaying } from "../playback/transport";
import { textPress } from "../text/onpicture";
import { frameSize } from "./frame";
import { flight, flyCam, moveCam, setFree, turnAbout } from "./freecam";
import { IDLE_VIEWPORT_GESTURE, stepViewport, type ViewportGesture } from "./gesture";
import { lookAtClick } from "./look";
import { render } from "./render";

export const fit = () => {
  const r = S.el.view.getBoundingClientRect(),
    [w, h] = frameSize(16),
    s = Math.min(r.width / w, r.height / h);
  S.el.stage.style.width = `${Math.floor(s * w)}px`;
  S.el.stage.style.height = `${Math.floor(s * h)}px`;
};
export const attachPicture = () => {
  const { canvas } = S.el;
  new ResizeObserver(fit).observe(S.el.view);
  let gesture: ViewportGesture<PointerEvent> = IDLE_VIEWPORT_GESTURE;
  const frac = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height] as const;
  };
  const stepCamDrag = (mode: "look" | "orbit" | "slide", dx: number, dy: number) => {
    if (!S.tools) return;
    const f = S.tools.free;
    if (mode === "look") turnAbout(f.p, f.l, -dx * 0.0025, dy * 0.0025);
    else if (mode === "orbit") turnAbout(f.l, f.p, -dx * 0.005, -dy * 0.005);
    else {
      const s = f.p.distanceTo(f.l) * 0.0012;
      moveCam(0, -dx * s, dy * s);
    }
    S.viewMoved = true;
  };
  canvas.addEventListener("pointerdown", (e) => {
    const prev = gesture;
    const next = stepViewport(gesture, {
      type: "press",
      id: e.pointerId,
      pointerType: e.pointerType,
      button: e.button,
      x: e.clientX,
      y: e.clientY,
      free: !!S.tools?.free.on,
      shiftKey: e.shiftKey,
      raw: e,
    });
    if (next.gesture === prev) return;
    if (gizmoBusy()) {
      gesture = IDLE_VIEWPORT_GESTURE;
      return;
    } // the gizmo's handle under the pointer takes this drag
    if (!S.tools?.free.on && textPress(e, frac(e))) {
      gesture = IDLE_VIEWPORT_GESTURE;
      return;
    } // a title on the picture: picked and dragged
    gesture = next.gesture;
    if (next.capture) canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if ("id" in gesture && e.pointerId !== gesture.id) return;
    const prev = gesture;
    const step = stepViewport(prev, {
      type: "move",
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      canWake: !!S.tools,
    });
    gesture = step.gesture;
    if (step.startSketchFrom) {
      canvas.setPointerCapture(step.startSketchFrom.pointerId);
      sketch.start(e, step.startSketchFrom);
      hover(null);
      return;
    }
    if (gesture.kind === "sketching") {
      sketch.move(e);
      return;
    }
    if (step.wokeFree && gesture.kind === "cam_drag" && "x" in prev) {
      setFree(true, true);
      canvas.setPointerCapture(gesture.id);
      hover(null);
      stepCamDrag(gesture.mode, e.clientX - prev.x, e.clientY - prev.y);
      return;
    }
    if (gesture.kind === "cam_drag" && prev.kind === "cam_drag") {
      stepCamDrag(gesture.mode, e.clientX - prev.x, e.clientY - prev.y);
      return;
    }
    if (e.pointerType === "mouse" && !gizmoBusy()) hover(pickAt(...frac(e)));
  });
  // A press that didn't move: anything further was the free camera being dragged
  const tappedAt = (x: number, y: number, e: MouseEvent) => {
    if (!S.render || Math.hypot(e.clientX - x, e.clientY - y) > 4) return null;
    if (S.playing) setPlaying(false);
    render(S.t);
    return frac(e);
  };
  // A note box opened mid-flight takes no focus, or the W still held would type into it
  const pinNote = (x: number, y: number) =>
    openNote({ x: +x.toFixed(4), y: +y.toFixed(4), ...lookAtClick(x, y) }, !flight.flying());
  const armClick = () => {
    setTimeout(() => {
      if (gesture.kind === "pending_click") gesture = IDLE_VIEWPORT_GESTURE;
    }, 0);
  };
  const cancelPointer = (e: PointerEvent) => {
    const res = stepViewport(gesture, { type: "cancel", id: e.pointerId });
    gesture = res.gesture;
    if (res.dropSketch || sketch.on()) sketch.drop();
  };
  canvas.addEventListener("pointerup", (e) => {
    if (
      e.button !== 2 ||
      e.pointerType !== "mouse" ||
      ("id" in gesture && e.pointerId !== gesture.id)
    )
      return;
    const g = gesture;
    gesture = IDLE_VIEWPORT_GESTURE;
    if (g.kind === "sketching" || sketch.on()) {
      sketch.end();
      return;
    }
    const origin =
      g.kind === "right_press"
        ? [g.x, g.y]
        : g.kind === "cam_drag" && !g.woke && !g.moved
          ? [g.startX, g.startY]
          : null;
    if (!origin) return;
    const at = tappedAt(origin[0], origin[1], e);
    if (at) pinNote(...at);
  });
  addEventListener("pointerup", (e) => {
    const res = stepViewport(gesture, {
      type: "windowUp",
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      buttons: e.buttons,
    });
    gesture = res.gesture;
    if (res.dropSketch) sketch.drop();
    if (res.armClickAt) armClick();
  });
  addEventListener("pointercancel", cancelPointer);
  canvas.addEventListener("lostpointercapture", cancelPointer);
  canvas.addEventListener("pointerleave", () => hover(null));
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  // Flying keys, by their place on the keyboard (any layout). Typing a note or a shortcut with Ctrl never flies. Any other key,
  // click or scroll while Shift is held makes a shortcut of it: the height Shift dropped comes back first, which is why these
  // listen in the capture phase, before the shortcut itself (Shift+K saves the view) reads the camera
  const chord = () => {
    const back = flight.chord();
    if (back) flyCam(0, 0, back);
  };
  addEventListener(
    "keydown",
    (e) => {
      if (!S.tools?.free.on || get().modal !== null) return;
      if (
        e.target instanceof HTMLElement &&
        (e.target.closest(
          "input, textarea, select, [contenteditable], [data-slot=dialog-content]",
        ) ||
          (e.code === "Space" &&
            e.target.closest("button, summary, [role=checkbox], [role=switch], [role=radio]")))
      )
        return;
      if (!e.ctrlKey && !e.metaKey && !e.altKey && flight.press(e.code, e.timeStamp / 1000)) {
        e.preventDefault();
        S.viewMoved = true;
      } else chord();
    },
    true,
  );
  for (const type of ["pointerdown", "wheel"])
    addEventListener(
      type,
      (e) => {
        if ((e as MouseEvent).shiftKey && S.tools?.free.on) chord();
      },
      true,
    );
  addEventListener("keyup", (e) => flight.release(e.code));
  addEventListener("blur", () => {
    flight.clear(); // a key let go in another window never comes back as a keyup
    const res = stepViewport(gesture, { type: "blur" });
    gesture = res.gesture;
    if (res.dropSketch || sketch.on()) sketch.drop();
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (!S.tools?.free.on) return;
      e.preventDefault();
      moveCam((e.deltaY > 0 ? -1 : 1) * (e.shiftKey ? 0.03 : 0.12), 0, 0);
    },
    { passive: false },
  );
  // On click, not pointerup: a phone only lets the note box take focus and raise its keyboard from a click
  canvas.addEventListener("click", (e) => {
    if (e.button !== 0 || gesture.kind !== "pending_click") return;
    const { x, y } = gesture;
    gesture = IDLE_VIEWPORT_GESTURE;
    const at = tappedAt(x, y, e);
    if (!at) return;
    if (e.pointerType === "mouse") selectTarget(pickAt(...at), e.ctrlKey || e.metaKey);
    else pinNote(...at);
  });
};
