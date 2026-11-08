// The dropped-in objects' part of the page state (core/store.ts)
export interface ObjectsSlice {
  placed: boolean; // the film takes objects dropped in from the Objects library (tools.placed, mc-assets/placed.ts)
  object: string | null; // the dropped-in object the gizmo is on
  gizmo: "translate" | "rotate" | "scale";
  snap: boolean; // the gizmo moves by game pixels and turns by 15 degrees
}
export const objectsSlice: ObjectsSlice = { placed: false, object: null, gizmo: "translate", snap: true };
