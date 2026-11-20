import { clampFov, fovOf, hfovOf, vfovOf } from "film-kit/lens";
import { type Box3, OrthographicCamera, PerspectiveCamera, Plane, Ray, Vector3 } from "three";

export type Vec3 = [number, number, number];
export type Offset = [number, number];
export type FovAxis = { mode: "horizontal" | "vertical"; aspect: number };
export const ORTHOGRAPHIC_DEPTH = 10;
export type RigCamera = PerspectiveCamera | (OrthographicCamera & { fov: number; aspect: number });

export const orthographicCamera = (
  fov: number,
  aspect: number,
): Extract<RigCamera, OrthographicCamera> =>
  Object.assign(new OrthographicCamera(-aspect, aspect, 1, -1), { fov, aspect });

export interface CameraRig {
  projection?: "perspective" | "orthographic";
  orthographicDepth?: number;
  look?: "target" | "one-node" | "tangent";
  position?: Vec3;
  lead?: number;
  bank?: number;
  up?: Vec3;
  frameOffset?: Offset;
  lensShift?: Offset;
  fovAxis?: FovAxis;
  near?: number;
  far?: number;
  hideGroups?: string[];
  rail?: Vec3[];
  extrapolation?: "hold" | "linear";
}
export const cameraTrackOptions = (rig?: CameraRig) => ({
  fovAxis: rig?.fovAxis,
  rail: rig?.look === "one-node" ? undefined : rig?.rail,
  extrapolation: rig?.extrapolation,
});

type CameraOrientation = { p: Vector3; l: Vector3; roll: number };
type Sample = (t: number) => Pick<CameraOrientation, "p" | "l">;
const DEFAULT_UP = new Vector3(0, 1, 0);
const EDGE = 1e-6;

export const lensAspect = (aspect: number, axis?: FovAxis) =>
  axis?.mode === "vertical" ? axis.aspect : aspect;

export function rigFov(fov: number, mm: number | undefined, aspect: number, axis?: FovAxis) {
  if (mm !== undefined) return clampFov(fovOf(mm, lensAspect(aspect, axis)));
  if (axis?.mode === "horizontal") return clampFov(vfovOf(hfovOf(fov, axis.aspect), aspect));
  return clampFov(fov);
}

export function applyCameraRig(
  cam: CameraOrientation,
  time: number,
  bounds: [number, number],
  rig: CameraRig | undefined,
  sample: Sample,
) {
  if (!rig) return;
  const [start, end] = bounds;
  const at = (t: number) => Math.max(start, Math.min(end - EDGE, t));
  const distance = Math.max(0.01, cam.p.distanceTo(cam.l));
  if (rig.lead) cam.l.copy(sample(at(time + rig.lead)).l);
  if (rig.look === "tangent" || rig.bank) {
    const between = 0.05;
    const before = sample(at(time - between)).p;
    const after = sample(at(time + between)).p;
    const tangent = after.clone().sub(before);
    if (rig.look === "tangent" && tangent.lengthSq() > 1e-8)
      cam.l.copy(cam.p).add(tangent.setLength(distance));
    if (rig.bank) {
      const entry = cam.p.clone().sub(before),
        exit = after.clone().sub(cam.p);
      if (entry.lengthSq() > 1e-8 && exit.lengthSq() > 1e-8) {
        entry.normalize();
        exit.normalize();
        const up = rig.up ? new Vector3(...rig.up).normalize() : DEFAULT_UP;
        const bend = Math.atan2(entry.clone().cross(exit).dot(up), entry.dot(exit));
        cam.roll += Math.max(-Math.PI / 4, Math.min(Math.PI / 4, bend * rig.bank));
      }
    }
  }
  if (rig.look === "one-node" && rig.position) {
    cam.l.sub(cam.p);
    cam.p.fromArray(rig.position);
    cam.l.add(cam.p);
  }
}

export function orientCamera(camera: RigCamera, look: Vector3, roll: number, rig?: CameraRig) {
  camera.up.fromArray(rig?.up ?? [0, 1, 0]).normalize();
  const direction = look.clone().sub(camera.position).normalize();
  if (!camera.up.lengthSq() || Math.abs(direction.dot(camera.up)) > 0.999999) {
    camera.up.set(0, 0, 1);
    if (Math.abs(direction.z) > 0.999999) camera.up.set(1, 0, 0);
  }
  camera.lookAt(look);
  camera.rotateZ(roll);
  if ("isOrthographicCamera" in camera) return;
  const [x, y] = rig?.frameOffset ?? [0, 0];
  const tanV = Math.tan((camera.fov * Math.PI) / 360);
  camera.rotateY(Math.atan(x * tanV * camera.aspect));
  camera.rotateX(Math.atan(-y * tanV));
}

// Where a pixel of the picture (x right, y down, in a w x h frame) meets the plane axis = at, through a perspective
// camera oriented as orientCamera does: a reference's landmark placed in our world. null when the ray never reaches it
export function pixelOnPlane(
  cam: { p: readonly number[]; l: readonly number[]; fov: number; roll: number },
  rig: CameraRig | undefined,
  [x, y]: readonly [number, number],
  [w, h]: readonly [number, number],
  plane: { axis: "x" | "y" | "z"; at: number },
): Vec3 | null {
  const camera = new PerspectiveCamera(cam.fov, w / h, 0.01, 1e5);
  camera.position.fromArray(cam.p as number[]);
  orientCamera(camera, new Vector3().fromArray(cam.l as number[]), cam.roll, rig);
  camera.updateMatrixWorld();
  const toward = new Vector3((x / w) * 2 - 1, 1 - (y / h) * 2, 0.5)
    .unproject(camera)
    .sub(camera.position);
  const normal = new Vector3(+(plane.axis === "x"), +(plane.axis === "y"), +(plane.axis === "z"));
  const hit = new Ray(camera.position, toward.normalize()).intersectPlane(
    new Plane(normal, -plane.at),
    new Vector3(),
  );
  return hit ? (hit.toArray() as Vec3) : null;
}

export function apertureOffset(
  camera: PerspectiveCamera,
  pupil: { x: number; y: number },
  mm: number,
  fstop: number,
  focus: number,
): Offset {
  if (!(fstop > 0) || !(mm > 0)) return [0, 0];
  const radius = mm / (2000 * fstop);
  const x = pupil.x * radius,
    y = pupil.y * radius;
  camera.translateX(x);
  camera.translateY(y);
  const scale = Math.max(0.05, focus) * Math.tan((camera.fov * Math.PI) / 360);
  return [-x / (camera.aspect * scale), y / scale];
}

interface CameraRenderRegion {
  fullWidth: number;
  fullHeight: number;
  offsetX: number;
  offsetY: number;
  viewWidth: number;
  viewHeight: number;
}

const renderRegions = new WeakMap<object, CameraRenderRegion>();

export function setCameraRenderRegion(camera: object, region: CameraRenderRegion | undefined) {
  const previous = renderRegions.get(camera);
  if (region) renderRegions.set(camera, region);
  else renderRegions.delete(camera);
  return previous;
}

export function projectCamera(
  camera: RigCamera,
  w: number,
  h: number,
  rig?: CameraRig,
  pupil?: Offset,
) {
  camera.near = rig?.near ?? 0.02;
  camera.far = Math.max(camera.near + 0.01, rig?.far ?? 500);
  let [x, y] = rig?.lensShift ?? [0, 0];
  if ("isOrthographicCamera" in camera) {
    const halfHeight =
      (rig?.orthographicDepth ?? ORTHOGRAPHIC_DEPTH) * Math.tan((camera.fov * Math.PI) / 360);
    camera.aspect = w / h;
    camera.right = halfHeight * camera.aspect;
    camera.left = -camera.right;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    x -= rig?.frameOffset?.[0] ?? 0;
    y += rig?.frameOffset?.[1] ?? 0;
  }
  const [dx, dy] = pupil ?? [0, 0];
  const shiftX = ((x + dx) * w) / 2;
  const shiftY = ((y + dy) * h) / 2;
  const region = renderRegions.get(camera);
  if (region) {
    camera.setViewOffset(
      region.fullWidth,
      region.fullHeight,
      region.offsetX + shiftX,
      region.offsetY + shiftY,
      region.viewWidth,
      region.viewHeight,
    );
  } else if (shiftX || shiftY) camera.setViewOffset(w, h, shiftX, shiftY, w, h);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

export function fitBoxFrame(
  box: Box3,
  forward: Vector3,
  {
    fov,
    aspect,
    roll = 0,
    fill,
    rig,
  }: { fov: number; aspect: number; roll?: number; fill: number; rig?: CameraRig },
): { p: Vector3; l: Vector3; fov?: number } | null {
  const center = box.getCenter(new Vector3());
  const direction = forward.clone().normalize();
  const parallel = rig?.projection === "orthographic";
  const view = parallel ? orthographicCamera(fov, aspect) : new PerspectiveCamera(fov, aspect);
  view.position.copy(center).sub(direction);
  orientCamera(view, center, roll, rig);
  projectCamera(view, aspect, 1, rig);
  const m = view.projectionMatrix.elements;
  const q = view.quaternion.clone().invert();
  const [offsetX, offsetY] = rig?.frameOffset ?? [0, 0];
  const margin = 1 - fill;
  const x = Math.max(-margin, Math.min(margin, offsetX)) + m[8];
  const y = Math.max(-margin, Math.min(margin, offsetY)) + m[9];
  let distance = 0,
    back = 0,
    extentOrtho = 0;
  for (const px of [box.min.x, box.max.x]) {
    for (const py of [box.min.y, box.max.y]) {
      for (const pz of [box.min.z, box.max.z]) {
        const v = new Vector3(px, py, pz).sub(center).applyQuaternion(q);
        if (parallel) {
          extentOrtho = Math.max(
            extentOrtho,
            Math.max(Math.abs(v.x) / aspect, Math.abs(v.y)) / fill,
          );
          distance = Math.max(distance, v.z + view.near + 0.001);
        } else {
          const extent =
            Math.max(Math.abs(m[0] * v.x + x * v.z), Math.abs(m[5] * v.y + y * v.z)) / fill;
          distance = Math.max(distance, v.z + Math.max(extent, view.near + 0.001));
        }
        back = Math.max(back, -v.z);
      }
    }
  }
  if (distance + back > view.far) return null;
  if (parallel) {
    const reference = rig?.orthographicDepth ?? ORTHOGRAPHIC_DEPTH;
    const fitFov = clampFov((Math.atan(extentOrtho / reference) * 360) / Math.PI);
    if (reference * Math.tan((fitFov * Math.PI) / 360) < extentOrtho - 1e-6) return null;
    view.fov = fitFov;
    projectCamera(view, aspect, 1, rig);
    distance = Math.max(distance, Math.min(reference, view.far - back - 0.001));
    const wantedX = Math.max(-margin, Math.min(margin, offsetX));
    const wantedY = Math.max(-margin, Math.min(margin, offsetY));
    const ray = new Vector3(
      (wantedX - m[12]) / m[0],
      (wantedY - m[13]) / m[5],
      -distance,
    ).applyQuaternion(view.quaternion);
    const p = center.sub(ray);
    return { p, l: p.clone().addScaledVector(direction, distance), fov: fitFov };
  }
  const ray = new Vector3(x / m[0], y / m[5], -1)
    .multiplyScalar(distance)
    .applyQuaternion(view.quaternion);
  const p = center.sub(ray);
  return { p, l: p.clone().addScaledVector(direction, distance) };
}
