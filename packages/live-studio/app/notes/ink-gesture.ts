import type { InkKind } from "./slice";

export type InkGesture =
  | { kind: "idle" }
  | { kind: "drawing"; id: number; mask: 1 | 2 }
  | { kind: "path_press"; id: number; mask: 1 | 2 };

export const IDLE_INK_GESTURE: InkGesture = { kind: "idle" };

export type InkEvent =
  | {
      type: "down";
      id: number;
      button: number;
      pointerType?: string;
      drawOnLeft?: boolean;
      tool: InkKind | null;
      x: number;
      y: number;
    }
  | { type: "move"; id: number; x: number; y: number }
  | { type: "up"; id: number; buttons: number; tool: InkKind | null }
  | { type: "cancel"; id: number }
  | { type: "blur" }
  | { type: "reset" };

export interface InkStep {
  gesture: InkGesture;
  effect:
    "none" | "start_stroke" | "start_path" | "move_stroke" | "end_stroke" | "commit_path" | "drop";
}

export function stepInk(gesture: InkGesture, event: InkEvent): InkStep {
  switch (event.type) {
    case "down": {
      const isMouse = (event.pointerType ?? "mouse") === "mouse";
      const allowed = isMouse
        ? event.button === 2 || (Boolean(event.drawOnLeft) && event.button === 0)
        : event.button === 0;
      if (!event.tool || gesture.kind !== "idle" || !allowed) return { gesture, effect: "none" };
      const mask: 1 | 2 = event.button === 2 ? 2 : 1;
      if (event.tool === "path")
        return { gesture: { kind: "path_press", id: event.id, mask }, effect: "start_path" };
      return { gesture: { kind: "drawing", id: event.id, mask }, effect: "start_stroke" };
    }
    case "move":
      if (gesture.kind === "idle" || event.id !== gesture.id) return { gesture, effect: "none" };
      if (gesture.kind === "drawing") return { gesture, effect: "move_stroke" };
      return { gesture, effect: "none" };
    case "up":
      if (gesture.kind === "idle" || event.id !== gesture.id) return { gesture, effect: "none" };
      if (
        (gesture.kind === "drawing" || gesture.kind === "path_press") &&
        (event.buttons & gesture.mask) !== 0
      )
        return { gesture, effect: "none" };
      if (gesture.kind === "drawing") {
        return { gesture: IDLE_INK_GESTURE, effect: "end_stroke" };
      }
      if (gesture.kind === "path_press") {
        return {
          gesture: IDLE_INK_GESTURE,
          effect: event.tool === "path" ? "commit_path" : "none",
        };
      }
      return { gesture: IDLE_INK_GESTURE, effect: "none" };
    case "cancel":
      if (gesture.kind === "idle" || event.id !== gesture.id) return { gesture, effect: "none" };
      return { gesture: IDLE_INK_GESTURE, effect: "drop" };
    case "blur":
    case "reset":
      return gesture.kind === "idle"
        ? { gesture, effect: "none" }
        : { gesture: IDLE_INK_GESTURE, effect: "drop" };
  }
}
