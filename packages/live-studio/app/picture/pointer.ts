import { applyCameraPick, cancelCameraPick } from "../camera/camera-framing";
// Preview input: a click or tap pins a note, a right-click picks an object or title, and a right drag draws a note.
// A left drag moves a title or wakes Free Camera from the film view. On a phone the picture is for notes only.
import { cameraGizmoBusy, pickCameraPath } from "../camera/campath";
import { PHONE } from "../core/device";
import { S } from "../core/state";
import { get } from "../core/store";
import { sketch } from "../notes/ink";
import { openNote, pointOrigin } from "../notes/notes";
import { gizmoBusy, hover, pickAt, selectTarget } from "../objects/placed";
import { pickPageAt, startPageDrag } from "../openfilm/onpicture";
import { setPlaying } from "../playback/transport";
import { startTextDrag, textAt, textDoubleClick } from "../text/onpicture";
import { pickText } from "../text/text";
import { frameSize } from "./frame";
import {
  flight,
  flyCam,
  moveCam,
  orbitFree,
  rememberFreeView,
  setFree,
  setOrbitPivot,
  turnAbout,
} from "./freecam";
import { IDLE_VIEWPORT_GESTURE, stepViewport, type ViewportGesture } from "./gesture";
import { lookAtClick } from "./look";
import { changePreview, picturePoint } from "./preview-state";
import { render } from "./render";

export const fit = () => {
  const r = (S.el.view.querySelector("[data-preview-pane]") ?? S.el.view).getBoundingClientRect(),
    [w, h] = frameSize(16),
    s = Math.min(r.width / w, r.height / h);
  S.el.stage.style.width = `${Math.floor(s * w)}px`;
  S.el.view.style.setProperty("--split-height", Math.floor(r.height) + "px");
  S.el.stage.style.height = `${Math.floor(s * h)}px`;
};
export const stageFit = () => {
  if (S.el?.stage && S.el.view) fit();
};
export const attachPicture = () => {
  const { canvas } = S.el;
  new ResizeObserver(fit).observe(S.el.view.querySelector("[data-preview-pane]") ?? S.el.view);
  let gesture: ViewportGesture<PointerEvent> = IDLE_VIEWPORT_GESTURE;
  const frac = (e: MouseEvent) => picturePoint(e, canvas);
  let pan: { id: number; x: number; y: number; fromX: number; fromY: number } | null = null;
  const stepCamDrag = (mode: "look" | "orbit" | "slide", dx: number, dy: number) => {
    if (!S.tools || get().freeLocked) return;
    const f = S.tools.free;
    if (get().preview.mirror) dx = -dx;
    if (mode === "look") turnAbout(f.p, f.l, -dx * 0.0025, dy * 0.0025);
    else if (mode === "orbit") orbitFree(-dx * 0.005, -dy * 0.005);
    else {
      const s = f.p.distanceTo(f.l) * 0.0012;
      moveCam(0, -dx * s, dy * s);
    }
    S.viewMoved = true;
  };
  canvas.addEventListener("pointerdown", (e) => {
    const p = get().preview;
    if (!PHONE && e.button === 1 && (p.zoom !== 100 || !S.tools?.free.on)) {
      e.preventDefault();
      pan = { id: e.pointerId, x: e.clientX, y: e.clientY, fromX: p.panX, fromY: p.panY };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 0 && e.altKey && S.tools?.free.on && !get().cameraPick) return;
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
    if (e.button === 0 && (gizmoBusy() || cameraGizmoBusy())) {
      gesture = IDLE_VIEWPORT_GESTURE;
      return;
    } // the gizmo's handle under the pointer takes this drag
    gesture = next.gesture;
    if (S.tools?.free.on) rememberFreeView();
    if (next.capture) canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (pan?.id === e.pointerId) {
      changePreview({ panX: pan.fromX + e.clientX - pan.x, panY: pan.fromY + e.clientY - pan.y });
      return;
    }
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
      canvas.setPointerCapture(step.startSketchFrom.pointerId);
      sketch.start(e, step.startSketchFrom);
      hover(null);
      return;
    }
    if (gesture.kind === "sketching") {
      sketch.move(e);
      return;
    }
    if (step.wokeFree && gesture.kind === "cam_drag" && prev.kind === "wake_press") {
      if (
        prev.event &&
        (startPageDrag(prev.event, e, frac(prev.event)) ||
          startTextDrag(prev.event, e, frac(prev.event)))
      ) {
        gesture = IDLE_VIEWPORT_GESTURE;
        hover(null);
        return;
      }
      setFree(true, true);
      rememberFreeView();
      canvas.setPointerCapture(gesture.id);
      hover(null);
      stepCamDrag(gesture.mode, e.clientX - prev.x, e.clientY - prev.y);
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
    if (pan?.id === e.pointerId) pan = null;
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
    if (!at || (!PHONE && pickPageAt(at))) return;
    const title = get().text ? textAt(...at) : -1;
    if (title >= 0) pickText([title]);
    else selectTarget(pickAt(...at), e.ctrlKey || e.metaKey);
  });
  addEventListener("pointerup", (e) => {
    if (pan?.id === e.pointerId) pan = null;
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
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !get().cameraPick) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      cancelCameraPick();
    },
    true,
  );
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
  addEventListener(
    "keydown",
    (e) => {
      if (!S.tools?.free.on || get().freeLocked || get().modal !== null) return;
      if (
        e.target instanceof HTMLElement &&
        (e.target.closest(
          "input, textarea, select, [contenteditable], [data-slot=dialog-content]",
        ) ||
          (e.code === "Space" &&
            e.target.closest("button, summary, [role=checkbox], [role=switch], [role=radio]")))
      )
        return;
      const wasFlying = flight.flying();
      if (!e.ctrlKey && !e.metaKey && !e.altKey && flight.press(e.code, e.timeStamp / 1000)) {
        if (!wasFlying) rememberFreeView();
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
    pan = null;
    flight.clear(); // a key let go in another window never comes back as a keyup
    const res = stepViewport(gesture, { type: "blur" });
    gesture = res.gesture;
    if (res.dropSketch || sketch.on()) sketch.drop();
  });
  let lastWheel = -Infinity;
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (!PHONE && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const zoom = Math.max(
          10,
          Math.min(1600, Math.round(get().preview.zoom * (e.deltaY > 0 ? 0.8 : 1.25))),
        );
        changePreview({ zoom });
        return;
      }
      if (!S.tools?.free.on) return;
      e.preventDefault();
      if (get().freeLocked) return;
      if (e.timeStamp - lastWheel > 250) rememberFreeView();
      lastWheel = e.timeStamp;
      moveCam((e.deltaY > 0 ? -1 : 1) * (e.shiftKey ? 0.03 : 0.12), 0, 0);
    },
    { passive: false },
  );
  // On click, not pointerup: a phone only lets the note box take focus and raise its keyboard from a click
  canvas.addEventListener("click", (e) => {
    if (e.button === 0 && e.altKey && S.tools?.free.on && !get().cameraPick) {
      if (get().freeLocked) return;
      const [x, y] = frac(e),
        t = S.t;
      void render(t, () => {
        const hit = lookAtClick(x, y);
        if (hit.world) setOrbitPivot(hit.world);
      });
      return;
    }
    if (e.button !== 0 || gesture.kind !== "pending_click") return;
    const { x, y } = gesture;
    gesture = IDLE_VIEWPORT_GESTURE;
    const pick = get().cameraPick;
    if (pick && Math.hypot(e.clientX - x, e.clientY - y) <= 4) {
      const [nx, ny] = frac(e);
      const t = S.t;
      void render(t, () => applyCameraPick(pick, lookAtClick(nx, ny)));
      return;
    }
    const at = tappedAt(x, y, e);
    if (!at || pickCameraPath(...at)) return;
    pinNote(...at, e);
  });
};
