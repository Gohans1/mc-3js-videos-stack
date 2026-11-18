import type { KeyRef } from "../keys/slice";
import type {
  TargetTransform,
  TransformBinding,
  TransformMode as GizmoMode,
} from "../objects/targets";

export type { GizmoMode };

export interface StudioEngine {
  render: (t: number, readFrame?: () => void) => Promise<void>;
  finalCanvas: () => HTMLCanvasElement | null;
  setFinal: (on: boolean) => Promise<void> | void;
  setFree: (on: boolean, here?: boolean) => void;
  setFov: (d: number) => void;
  setGizmo: (mode: GizmoMode) => void;
  isGizmoDragging: () => boolean;
  removeObject: (name: string) => void;
  selectObject: (name: string | null) => void;
  shownTransform: (name: string) => TargetTransform | null;
  previewTransform: (name: string, v: Partial<TargetTransform>) => void;
  cancelPreviewTransform: (name: string) => void;
  nativeTransform: (ref: KeyRef) => TransformBinding | undefined;
  startObjectCarry: (what: string, e: PointerEvent) => void;
  addObjectInFront: (what: string) => void;
}

export const engine: StudioEngine = {
  render: async (_t, readFrame) => {
    readFrame?.();
  },
  finalCanvas: () => null,
  setFinal: () => {},
  setFree: () => {},
  setFov: () => {},
  setGizmo: () => {},
  isGizmoDragging: () => false,
  removeObject: () => {},
  selectObject: () => {},
  shownTransform: () => null,
  previewTransform: () => {},
  cancelPreviewTransform: () => {},
  nativeTransform: () => undefined,
  startObjectCarry: () => {},
  addObjectInFront: () => {},
};

export const registerEngine = (impl: Partial<StudioEngine>) => Object.assign(engine, impl);
