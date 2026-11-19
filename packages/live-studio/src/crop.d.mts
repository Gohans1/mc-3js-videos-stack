export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CropView {
  fullWidth: number;
  fullHeight: number;
  offsetX: number;
  offsetY: number;
  viewWidth: number;
  viewHeight: number;
  outWidth: number;
  outHeight: number;
  scale: number;
}

export interface OffsettableCamera {
  view?: {
    enabled: boolean;
    fullWidth: number;
    fullHeight: number;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
  } | null;
  setViewOffset(
    fullWidth: number,
    fullHeight: number,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void;
  clearViewOffset?(): void;
  updateProjectionMatrix?(): void;
}

export function parseCropRect(spec: string | CropRect): CropRect;
export function computeCropView(fullWidth: number, fullHeight: number, rect: CropRect): CropView;
export function withCropViewOffset<T>(
  camera: OffsettableCamera | readonly OffsettableCamera[] | null | undefined,
  fullWidth: number,
  fullHeight: number,
  rect: CropRect,
  fn: (view: CropView) => T,
): T;
