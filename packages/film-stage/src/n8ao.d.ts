declare module "n8ao" {
  import type { Pass } from "postprocessing";
  import type * as THREE from "three";

  export type N8AOQualityMode =
    | "Performance"
    | "Low"
    | "Medium"
    | "High"
    | "Ultra"
    | "Neural-Low"
    | "Neural-Medium"
    | "Neural-High";

  export type N8AODisplayMode = "Combined" | "AO" | "No AO" | "Split" | "Split AO";

  export interface N8AOConfiguration {
    aoSamples: number;
    aoRadius: number;
    aoTones: number;
    denoiseSamples: number;
    denoiseRadius: number;
    distanceFalloff: number;
    intensity: number;
    denoiseIterations: number;
    renderMode: 0 | 1 | 2 | 3 | 4;
    biasOffset: number;
    biasMultiplier: number;
    color: THREE.Color;
    gammaCorrection: boolean;
    depthBufferType: 1 | 2 | 3;
    screenSpaceRadius: boolean;
    halfRes: boolean;
    depthAwareUpsampling: boolean;
    colorMultiply: boolean;
    transparencyAware: boolean;
    accumulate: boolean;
    neuralDenoise: boolean;
  }

  export class N8AOPostPass extends Pass {
    constructor(scene: THREE.Scene, camera: THREE.Camera, width?: number, height?: number);
    scene: THREE.Scene;
    camera: THREE.Camera;
    width: number;
    height: number;
    configuration: N8AOConfiguration;
    outputTargetInternal: THREE.WebGLRenderTarget;
    writeTargetInternal: THREE.WebGLRenderTarget;
    readTargetInternal: THREE.WebGLRenderTarget;
    accumulationRenderTarget: THREE.WebGLRenderTarget;
    bluenoise: THREE.DataTexture;
    setQualityMode(mode: N8AOQualityMode): void;
    setDisplayMode(mode: N8AODisplayMode): void;
    enableDebugMode(): void;
    disableDebugMode(): void;
    firstFrame(): void;
  }
}
