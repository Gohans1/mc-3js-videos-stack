export interface ObjectsSlice {
  placed: boolean;
  object: string | null;
  gizmo: "translate" | "rotate" | "scale";
  snap: boolean;
}
export const objectsSlice: ObjectsSlice = {
  placed: false,
  object: null,
  gizmo: "translate",
  snap: true,
};
