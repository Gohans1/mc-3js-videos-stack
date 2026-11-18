import type { Box3, BufferGeometry, Line3, Matrix4, Ray, Side, Vector3 } from "three";

export interface ContactSurface {
  g: BufferGeometry;
  matrix: Matrix4;
  inv: Matrix4;
  box: Box3;
  label: string;
  two: boolean;
  flip: boolean;
}
export const REACH: number;
export function surface(
  geometry: BufferGeometry,
  matrix: Matrix4,
  options?: { side?: Side; label?: string },
): ContactSurface;
export function gap(
  point: Vector3,
  surfaces: ContactSurface[],
): {
  d: number;
  surface?: string;
  point?: Vector3;
  normal?: Vector3;
};
export function raycastSurface(
  ray: Ray,
  surfaces: ContactSurface[],
  far?: number,
): {
  point: Vector3;
  normal: Vector3;
  distance: number;
} | null;
export function capsuleHits(segment: Line3, radius: number, surfaces: ContactSurface[]): boolean;
