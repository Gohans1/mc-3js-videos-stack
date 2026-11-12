// Pure pointer/touch/sketch state machine for the 3D viewport (picture/pointer.ts).
export type ViewportGesture<E = unknown> =
  | { kind: "idle" }
  | { kind: "tap_press"; id: number; x: number; y: number; moved: boolean }
  | { kind: "wake_press"; id: number; x: number; y: number; orbit: boolean }
  | { kind: "right_press"; id: number; x: number; y: number; event: E }
  | {
      kind: "cam_drag";
      id: number;
      startX: number;
      startY: number;
      x: number;
      y: number;
      mode: "look" | "orbit" | "slide";
      woke: boolean;
      moved: boolean;
    }
  | { kind: "sketching"; id: number }
  | { kind: "pending_click"; x: number; y: number };

export type ViewportEvent<E = unknown> =
  | {
      type: "press";
      id: number;
      pointerType: string;
      button: number;
      x: number;
      y: number;
      free: boolean;
      shiftKey: boolean;
      raw?: E;
    }
  | { type: "move"; id: number; x: number; y: number; canWake: boolean }
  | { type: "windowUp"; id: number; x: number; y: number; buttons: number }
  | { type: "cancel"; id: number }
  | { type: "blur" };

export interface ViewportStep<E = unknown> {
  gesture: ViewportGesture<E>;
  dropSketch: boolean;
  armClickAt?: [number, number] | null;
  capture?: boolean;
  startSketchFrom?: E;
  wokeFree?: boolean;
}

export const IDLE_VIEWPORT_GESTURE: ViewportGesture<never> = { kind: "idle" };

const canSupersede = <E>(g: ViewportGesture<E>, pointerType: string, id: number): boolean =>
  g.kind === "idle" ||
  g.kind === "pending_click" ||
  ((g.kind === "wake_press" || g.kind === "right_press") && pointerType === "mouse") ||
  (g.kind === "tap_press" && g.id === id);

export function stepViewport<E>(
  gesture: ViewportGesture<E>,
  event: ViewportEvent<E>,
): ViewportStep<E> {
  switch (event.type) {
    case "press": {
      if (!canSupersede(gesture, event.pointerType, event.id))
        return { gesture, dropSketch: false };
      if (!event.free) {
        if (event.pointerType === "mouse" && event.button === 0) {
          return {
            gesture: {
              kind: "wake_press",
              id: event.id,
              x: event.x,
              y: event.y,
              orbit: event.shiftKey,
            },
            dropSketch: false,
          };
        }
        if (event.pointerType === "mouse" && event.button === 2) {
          return {
            gesture: {
              kind: "right_press",
              id: event.id,
              x: event.x,
              y: event.y,
              event: event.raw as E,
            },
            dropSketch: false,
          };
        }
        return {
          gesture: { kind: "tap_press", id: event.id, x: event.x, y: event.y, moved: false },
          dropSketch: false,
        };
      }
      return {
        gesture: {
          kind: "cam_drag",
          id: event.id,
          startX: event.x,
          startY: event.y,
          x: event.x,
          y: event.y,
          mode: event.button !== 0 ? "slide" : event.shiftKey ? "orbit" : "look",
          woke: false,
          moved: false,
        },
        dropSketch: false,
        capture: true,
      };
    }
    case "move": {
      if ("id" in gesture && event.id !== gesture.id) return { gesture, dropSketch: false };
      if (
        gesture.kind === "right_press" &&
        Math.hypot(event.x - gesture.x, event.y - gesture.y) > 4
      ) {
        return {
          gesture: { kind: "sketching", id: gesture.id },
          dropSketch: false,
          startSketchFrom: gesture.event,
          capture: true,
        };
      }
      if (
        gesture.kind === "wake_press" &&
        event.canWake &&
        Math.hypot(event.x - gesture.x, event.y - gesture.y) > 4
      ) {
        return {
          gesture: {
            kind: "cam_drag",
            id: gesture.id,
            startX: gesture.x,
            startY: gesture.y,
            x: event.x,
            y: event.y,
            mode: gesture.orbit ? "orbit" : "look",
            woke: true,
            moved: true,
          },
          dropSketch: false,
          wokeFree: true,
          capture: true,
        };
      }
      if (
        gesture.kind === "tap_press" &&
        !gesture.moved &&
        Math.hypot(event.x - gesture.x, event.y - gesture.y) > 4
      ) {
        return { gesture: { ...gesture, moved: true }, dropSketch: false };
      }
      if (gesture.kind === "cam_drag") {
        const moved =
          gesture.moved || Math.hypot(event.x - gesture.startX, event.y - gesture.startY) > 4;
        return { gesture: { ...gesture, x: event.x, y: event.y, moved }, dropSketch: false };
      }
      return { gesture, dropSketch: false };
    }
    case "windowUp": {
      if ("id" in gesture && event.id !== gesture.id)
        return { gesture, dropSketch: false, armClickAt: null };
      if (gesture.kind === "sketching" && (event.buttons & 2) !== 0)
        return { gesture, dropSketch: false, armClickAt: null };
      if (
        gesture.kind === "wake_press" &&
        Math.hypot(event.x - gesture.x, event.y - gesture.y) <= 4
      ) {
        return {
          gesture: { kind: "pending_click", x: gesture.x, y: gesture.y },
          dropSketch: false,
          armClickAt: [gesture.x, gesture.y],
        };
      }
      if (
        gesture.kind === "tap_press" &&
        !gesture.moved &&
        Math.hypot(event.x - gesture.x, event.y - gesture.y) <= 4
      ) {
        return {
          gesture: { kind: "pending_click", x: gesture.x, y: gesture.y },
          dropSketch: false,
          armClickAt: [gesture.x, gesture.y],
        };
      }
      if (
        gesture.kind === "cam_drag" &&
        gesture.mode !== "slide" &&
        !gesture.woke &&
        !gesture.moved &&
        Math.hypot(event.x - gesture.startX, event.y - gesture.startY) <= 4
      ) {
        return {
          gesture: { kind: "pending_click", x: gesture.startX, y: gesture.startY },
          dropSketch: false,
          armClickAt: [gesture.startX, gesture.startY],
        };
      }
      const dropSketch = gesture.kind === "sketching";
      return {
        gesture: gesture.kind === "pending_click" ? gesture : IDLE_VIEWPORT_GESTURE,
        dropSketch,
        armClickAt: null,
      };
    }
    case "cancel":
      if (!("id" in gesture) || event.id !== gesture.id) return { gesture, dropSketch: false };
      return { gesture: IDLE_VIEWPORT_GESTURE, dropSketch: gesture.kind === "sketching" };
    case "blur":
      return { gesture: IDLE_VIEWPORT_GESTURE, dropSketch: gesture.kind === "sketching" };
  }
}
