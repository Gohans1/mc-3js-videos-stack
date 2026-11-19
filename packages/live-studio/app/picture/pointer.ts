// Preview input: right-click pins a note, right-drag sketches/draws a note; left-click picks an object/title/element,
// and left-drag moves a text/page title or moves the Free Camera (waking it seamlessly if off). On a phone, tap pins notes.
import { setFocus } from "../camera/cam";
import { PHONE } from "../core/device";
import { engine } from "../core/engine";
import { S } from "../core/state";
import { get, say, set } from "../core/store";
import { sketch } from "../notes/ink";
import { openNote, pointOrigin } from "../notes/notes";
import { gizmoBusy, hover, pickAt, selectTarget } from "../objects/placed";
import { pickPageAt, startPageDrag } from "../openfilm/onpicture";
import { setPlaying } from "../playback/transport";
import { startTextDrag, textAt, textDoubleClick } from "../text/onpicture";
import { pickText } from "../text/text";
import { frameSize } from "./frame";
import { flight, flyCam, moveCam, turnAbout } from "./freecam";
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
    return [
      (e.clientX - r.left) / Math.max(1, r.width),
      (e.clientY - r.top) / Math.max(1, r.height),
    ] as const;
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
    if (e.button === 0 && gizmoBusy()) {
      gesture = IDLE_VIEWPORT_GESTURE;
      return;
    } // the gizmo's handle under the pointer takes this drag
    gesture = next.gesture;
    if (next.capture)
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {}
  });
  canvas.addEventListener("pointermove", (e) => {
    if ("id" in gesture && e.pointerId !== gesture.id) return;
    const prev = gesture;
    const step = stepViewport(prev, {
      type: "move",
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      canWake: !!S.tools && !PHONE,
    });
    gesture = step.gesture;
    if (step.startSketchFrom) {
      try {
        canvas.setPointerCapture(step.startSketchFrom.pointerId);
      } catch {}
      sketch.start(e, step.startSketchFrom);
      hover(null);
      return;
    }
    if (step.startCamDragFrom) {
      if (
        !S.tools?.free.on &&
        (startPageDrag(step.startCamDragFrom, e, frac(step.startCamDragFrom)) ||
          startTextDrag(step.startCamDragFrom, e, frac(step.startCamDragFrom)))
      ) {
        gesture = IDLE_VIEWPORT_GESTURE;
        hover(null);
        return;
      }
      if (!S.tools?.free.on && S.tools && !PHONE) engine.setFree(true, true);
      try {
        canvas.setPointerCapture(step.startCamDragFrom.pointerId);
      } catch {}
      hover(null);
      if (gesture.kind === "cam_drag") {
        stepCamDrag(
          gesture.mode,
          e.clientX - step.startCamDragFrom.clientX,
          e.clientY - step.startCamDragFrom.clientY,
        );
      }
      return;
    }
    if (gesture.kind === "sketching") {
      sketch.move(e);
      return;
    }
    if (gesture.kind === "cam_drag" && prev.kind === "cam_drag") {
      stepCamDrag(gesture.mode, e.clientX - prev.x, e.clientY - prev.y);
      return;
    }
    if (e.pointerType === "mouse" && !PHONE && !gizmoBusy()) hover(pickAt(...frac(e)));
  });
  // A press that didn't move: anything further was the free camera being dragged
  const tappedAt = (x: number, y: number, e: MouseEvent) => {
    if (!S.render || Math.hypot(e.clientX - x, e.clientY - y) > 4) return null;
    if (S.playing) setPlaying(false);
    void render(S.t);
    return frac(e);
  };
  // A note box opened mid-flight takes no focus, or the W still held would type into it
  const pinNote = (x: number, y: number, e: MouseEvent) =>
    openNote(
      { x: +x.toFixed(4), y: +y.toFixed(4), ...lookAtClick(x, y) },
      !flight.flying(),
      pointOrigin(e.clientX, e.clientY),
    );
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
    if (e.pointerType !== "mouse" || ("id" in gesture && e.pointerId !== gesture.id)) return;
    if (e.button === 2) {
      if (gesture.kind !== "sketching" && gesture.kind !== "right_press") return;
      const g = gesture;
      gesture = IDLE_VIEWPORT_GESTURE;
      if (g.kind === "sketching" || sketch.on()) {
        sketch.end();
        return;
      }
      const at = tappedAt(g.x, g.y, e);
      if (!at) return;
      pinNote(...at, e);
      return;
    }
    if (e.button !== 0) return;
    if (gesture.kind !== "left_press" && !(gesture.kind === "cam_drag" && gesture.mode !== "slide"))
      return;
    const g = gesture;
    gesture = IDLE_VIEWPORT_GESTURE;
    if (g.kind !== "left_press") return;
    const at = tappedAt(g.x, g.y, e);
    if (!at) return;
    const pickFocus = get().pickFocus;
    if (pickFocus !== null) {
      set({ pickFocus: null });
      const hit = lookAtClick(...at);
      const cam = S.tools?.camera;
      if (hit.world && cam) {
        const dist = Math.hypot(
          hit.world[0] - cam.position.x,
          hit.world[1] - cam.position.y,
          hit.world[2] - cam.position.z,
        );
        setFocus(pickFocus, Math.max(0.05, Math.round(dist * 100) / 100));
        say(`Focus set to ${dist.toFixed(2)} m (${hit.what})`);
      } else {
        say("Nothing hit at that point to focus on");
      }
      return;
    }
    if (!PHONE && pickPageAt(at)) return;
    const title = get().text ? textAt(...at) : -1;
    if (title >= 0) pickText([title]);
    else selectTarget(pickAt(...at), e.ctrlKey || e.metaKey);
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
  canvas.addEventListener("dblclick", (e) => {
    if (!PHONE && (e.ctrlKey || e.metaKey) && get().text) textDoubleClick(e, frac(e));
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  // Flying keys, by their place on the keyboard (any layout). Typing a note or a shortcut with Ctrl never flies. Any other key,
  // click or scroll while Shift is held makes a shortcut of it: the height Shift dropped comes back first, which is why these
  // listen in the capture phase, before the shortcut itself (Shift+K saves the view) reads the camera
  const chord = () => {
    const back = flight.chord();
    if (back) flyCam(0, 0, back);
  };
  const nonChordKeys = new Set([
    "",
    "Unidentified",
    "Process",
    "ShiftLeft",
    "ShiftRight",
    "ControlLeft",
    "ControlRight",
    "AltLeft",
    "AltRight",
    "MetaLeft",
    "MetaRight",
    "CapsLock",
    "NumLock",
    "ScrollLock",
  ]);
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
      } else if (!nonChordKeys.has(e.code)) {
        chord();
      }
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
    const pickFocus = get().pickFocus;
    if (pickFocus !== null) {
      set({ pickFocus: null });
      const hit = lookAtClick(...at);
      const cam = S.tools?.camera;
      if (hit.world && cam) {
        const dist = Math.hypot(
          hit.world[0] - cam.position.x,
          hit.world[1] - cam.position.y,
          hit.world[2] - cam.position.z,
        );
        setFocus(pickFocus, Math.max(0.05, Math.round(dist * 100) / 100));
        say(`Focus set to ${dist.toFixed(2)} m (${hit.what})`);
      } else {
        say("Nothing hit at that point to focus on");
      }
      return;
    }
    pinNote(...at, e);
  });
};
