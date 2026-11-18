import type * as THREE from "three";

import type { TransitionDef } from "./transitions-meta";

export interface TransitionRenderer {
  prepare(
    progress: number,
    capture: (incoming: boolean) => HTMLCanvasElement,
    props?: { vars?: Record<string, string>; text?: Record<string, string> },
  ): Promise<void>;
  draw(): void;
  dispose(): void;
}
export interface TransitionExtension {
  definition: TransitionDef;
  create?(renderer: THREE.WebGLRenderer): TransitionRenderer;
}
const extensions = new Map<string, TransitionExtension>();
export const registerTransitionExtension = (value: TransitionExtension) =>
  extensions.set(value.definition.id, value);
export const transitionExtension = (id: string) => extensions.get(id);
export const extendedTransitions = () => [...extensions.values()].map((value) => value.definition);
