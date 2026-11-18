import type { TimingClock } from "./timing.mjs";

export interface CameraSpan {
  from: number;
  to: number;
  sourceFrom: number;
  sourceTo: number;
}

export interface CameraClock extends TimingClock {
  cameraPicture?: TimingClock;
  cameraSpans?: readonly CameraSpan[];
  cameraOutputsAt?: (t: number, edge: "before" | "after") => number[];
  cameraRateAt?: (t: number) => number | undefined;
}

export function compileCameraClock(
  picture: TimingClock,
  shots: readonly { t: number; cameraClock?: "scene" | "output" }[],
): CameraClock;

export function canPlaceCameraCut(picture: TimingClock, at: number): boolean;
