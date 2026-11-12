import type { InkKind } from "./slice";

export type InkGesture<E = unknown> =
  | { kind: "idle" }
  | { kind: "drawing"; id: number }
  | { kind: "path_press"; id: number }
  | { kind: "right_press"; id: number; x: number; y: number; from: E }
  | { kind: "sketching"; id: number };

export const IDLE_INK_GESTURE: InkGesture<never> = { kind: "idle" };

export type InkEvent<E = unknown> =
  | {
      type: "down";
      id: number;
      button: number;
      tool: InkKind | null;
      x: number;
      y: number;
      raw?: E;
    }
  | { type: "move"; id: number; x: number; y: number }
  | { type: "up"; id: number; buttons: number; tool: InkKind | null }
  | { type: "cancel"; id: number }
  | { type: "blur" }
  | { type: "reset" };

export interface InkStep<E = unknown> {
  gesture: InkGesture<E>;
  effect:
    | "none"
    | "start_stroke"
    | "start_path"
    | "start_sketch"
    | "move_stroke"
    | "end_stroke"
    | "commit_path"
    | "drop";
  from?: E;
}

export function stepInk<E>(gesture: InkGesture<E>, event: InkEvent<E>): InkStep<E> {
  switch (event.type) {
    case "down":
      if (!event.tool || gesture.kind !== "idle" || (event.button !== 0 && event.button !== 2))
        return { gesture, effect: "none" };
      if (event.button === 2)
        return {
          gesture: {
            kind: "right_press",
            id: event.id,
            x: event.x,
            y: event.y,
            from: event.raw as E,
          },
          effect: "none",
        };
      if (event.tool === "path")
        return { gesture: { kind: "path_press", id: event.id }, effect: "start_path" };
      return { gesture: { kind: "drawing", id: event.id }, effect: "start_stroke" };
    case "move":
      if (gesture.kind === "idle" || event.id !== gesture.id) return { gesture, effect: "none" };
      if (gesture.kind === "right_press") {
        if (Math.hypot(event.x - gesture.x, event.y - gesture.y) > 4) {
          return {
            gesture: { kind: "sketching", id: gesture.id },
            effect: "start_sketch",
            from: gesture.from,
          };
        }
        return { gesture, effect: "none" };
      }
      if (gesture.kind === "drawing" || gesture.kind === "sketching")
        return { gesture, effect: "move_stroke" };
      return { gesture, effect: "none" };
    case "up":
      if (gesture.kind === "idle" || event.id !== gesture.id) return { gesture, effect: "none" };
      if (gesture.kind === "sketching" && (event.buttons & 2) !== 0)
        return { gesture, effect: "none" };
      if (
        (gesture.kind === "drawing" || gesture.kind === "path_press") &&
        (event.buttons & 1) !== 0
      )
        return { gesture, effect: "none" };
      if (gesture.kind === "right_press") return { gesture: IDLE_INK_GESTURE, effect: "none" };
      if (gesture.kind === "sketching" || gesture.kind === "drawing") {
        return { gesture: IDLE_INK_GESTURE, effect: "end_stroke" };
      }
      return { gesture: IDLE_INK_GESTURE, effect: event.tool === "path" ? "commit_path" : "none" };
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
