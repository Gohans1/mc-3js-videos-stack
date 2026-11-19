import { cameraAt, defaultCameraHandles, resolveCameraPoint } from "film-stage/camera";
import { EDIT } from "film/edit";
import type { CameraPathPose } from "film/scene";
import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";

import { gap } from "../../checks/contact.mjs";
import { cameraTimesAt, clockForTimeline } from "../../src/timing-state.mjs";
import { shotIndex } from "../core/film";
import { DURATION, SHOTS_OUT } from "../core/filmMeta";
import { S } from "../core/state";
import { get, say, set } from "../core/store";
import { FPS, SAME } from "../core/time";
import { cameraSurfaces } from "../picture/camera-collision";
import { filmCam } from "../picture/filmcam";
import { seekExact, setPlaying } from "../playback/transport";
import {
  cameraKeyFrameTime,
  type CamKey,
  edit,
  keys,
  preview,
  restore,
  setKey,
  snapshot,
  sourceCameraSegment,
  vectorPoint,
} from "./cam";

type Handle = "inHandle" | "outHandle";
type Field = "p" | "l" | Handle;
const isHandle = (field: Field): field is Handle => field === "inHandle" || field === "outHandle";
type Marker = { index: number; field: Field; point: THREE.Vector3 };
type TracePoint = { t: number; p: THREE.Vector3; contact: ReturnType<typeof gap> };
const AHEAD = new THREE.Color(0x68c6a2);
const BEHIND = new THREE.Color(0xcb796f);
const BLOCKED = new THREE.Color(0xff4d39);
const POINT_COLORS = { p: 0xfff0d1, l: 0x8bd0ef, inHandle: 0xe6aaff, outHandle: 0xffb887 };

const overlay = new THREE.Scene();
const traces = new THREE.Group();
overlay.add(traces);
const ghost = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 0.7);
const parallelGhost = new THREE.OrthographicCamera();
const makeFrustum = (camera: THREE.Camera) => {
  const helper = new THREE.CameraHelper(camera);
  const amber = new THREE.Color(0xec8b49);
  helper.setColors(amber, amber, new THREE.Color(0xfffcf0), amber, amber);
  overlay.add(helper);
  return helper;
};
const frustum = makeFrustum(ghost);
const parallelFrustum = makeFrustum(parallelGhost);
const proxy = new THREE.Object3D();
overlay.add(proxy);
const rayPositions = new THREE.BufferAttribute(new Float32Array(6), 3);
const guideGeometry = new THREE.BufferGeometry().setAttribute("position", rayPositions);
const guide = new THREE.Line(
  guideGeometry,
  new THREE.LineBasicMaterial({ color: POINT_COLORS.l, depthTest: false }),
);
guide.frustumCulled = false;
overlay.add(guide);
const handleLines = new THREE.Group();
overlay.add(handleLines);
const handleDots = new THREE.PointsMaterial({
  size: 9,
  sizeAttenuation: false,
  depthTest: false,
  vertexColors: true,
});
const handleInk = new THREE.LineBasicMaterial({
  transparent: true,
  opacity: 0.8,
  depthTest: false,
  vertexColors: true,
});
let tangents: Marker[] = [];

let marks: Marker[] = [];
let trace: TracePoint[] = [];
let paint: THREE.BufferAttribute | null = null;
let line: THREE.Line | null = null;
let built = "";
let shownKey = -1;
let handleCache = "";
let shownField: Field = "p";
let gizmo: TransformControls | null = null;
let drag: { index: number; field: Field; snap: string; point: THREE.Vector3 } | null = null;

const cameraRange = () => {
  const independent = clockForTimeline("cam").cameraSpans?.find(
    (span) => S.t >= span.from && S.t < span.to,
  );
  if (independent) return [independent.from, independent.to] as const;
  const i = Math.max(
    0,
    SHOTS_OUT.findLastIndex((shot) => shot.t <= S.t),
  );
  return [SHOTS_OUT[i]?.t ?? 0, SHOTS_OUT[i + 1]?.t ?? DURATION] as const;
};
export const sampleEditedPath = (times: number[]): CameraPathPose[] => {
  const tools = S.tools!;
  const clockTimes = get().timing
    ? times.map(cameraTimesAt)
    : times.map((t) => ({ world: t, camera: t }));
  if (tools.sampleCameraPath) return tools.sampleCameraPath(clockTimes);
  if (tools.sampleCameraTrack)
    return tools.sampleCameraTrack(clockTimes).map(({ p, l, fov }) => ({
      p: new THREE.Vector3(...p),
      l: new THREE.Vector3(...l),
      fov,
    }));
  const track = EDIT.cam as CamKey[];
  return clockTimes.map(({ camera }) =>
    cameraAt(camera, track, {
      aspect: tools.camera.aspect,
      resolveAnchor: tools.resolveCameraAnchor,
    }),
  );
};
const colors = new THREE.LineBasicMaterial({ depthTest: false, vertexColors: true });
const dot = new THREE.PointsMaterial({
  depthTest: false,
  sizeAttenuation: false,
  size: 3,
  color: 0xf5d8ae,
});
const markerMaterials = {
  p: new THREE.PointsMaterial({
    depthTest: false,
    sizeAttenuation: false,
    size: 10,
    color: POINT_COLORS.p,
  }),
  l: new THREE.PointsMaterial({
    depthTest: false,
    sizeAttenuation: false,
    size: 8,
    color: POINT_COLORS.l,
  }),
};
const points = (values: THREE.Vector3[]) => new THREE.BufferGeometry().setFromPoints(values);
const rebuild = (start: number, end: number, windowStart: number) => {
  for (const object of traces.children) (object as THREE.Line).geometry.dispose();
  traces.clear();
  const first = Math.max(start, windowStart - 3);
  const last = Math.min(end - 1e-6, windowStart + 5);
  const count = Math.max(1, Math.ceil((last - first) * FPS));
  const times = Array.from({ length: count + 1 }, (_, i) =>
    THREE.MathUtils.lerp(first, last, i / count),
  );
  const candidates = keys.flatMap((key, index) =>
    key.t >= first && cameraKeyFrameTime(index) <= last ? [index] : [],
  );
  const posed = sampleEditedPath([...times, ...candidates.map(cameraKeyFrameTime)]);
  const surfaces = cameraSurfaces();
  trace = times.map((t, i) => ({ t, p: posed[i].p, contact: gap(posed[i].p, surfaces) }));
  const geometry = points(trace.map((s) => s.p));
  paint = new THREE.BufferAttribute(new Float32Array(trace.length * 3), 3);
  geometry.setAttribute("color", paint);
  line = new THREE.Line(geometry, colors);
  traces.add(line, new THREE.Points(points(trace.map((s) => s.p)), dot));
  marks = candidates.flatMap((index, i) => {
    const base = posed[times.length + i]?.base;
    return (["p", "l"] as const).map((field) => ({
      index,
      field,
      point: base?.[field] ?? resolveCameraPoint(keys[index][field], S.tools!.resolveCameraAnchor),
    }));
  });
  for (const field of ["p", "l"] as const)
    traces.add(
      new THREE.Points(
        points(marks.filter((m) => m.field === field).map((m) => m.point)),
        markerMaterials[field],
      ),
    );
};

const rigForKey = (index: number) => SHOTS_OUT[shotIndex(cameraKeyFrameTime(index))]?.camera;
export const cameraPathHandles = (index: number | null): Handle[] => {
  if (index === null || !keys[index] || keys[index].locked || keys[index].muted) return [];
  const rig = rigForKey(index);
  if (rig?.rail || rig?.look === "one-node") return [];
  const context = sourceCameraSegment(index);
  if (!context || context.at < 0) return [];
  const { active, at } = context,
    out: Handle[] = [];
  if (at > 0 && (active[at].motion ?? "smooth") === "smooth") out.push("inHandle");
  if (active[at + 1] && (active[at + 1].motion ?? "smooth") === "smooth") out.push("outHandle");
  return out;
};
export const chooseCameraPathHandle = (field: Handle) => {
  const { camKey } = get();
  if (camKey === null || !cameraPathHandles(camKey).includes(field)) return;
  shownKey = camKey;
  shownField = field;
  seekExact(cameraKeyFrameTime(camKey));
  S.dirty = true;
};

const rebuildHandles = (index: number | null) => {
  tangents = [];
  for (const child of handleLines.children) (child as THREE.Line).geometry.dispose();
  handleLines.clear();
  if (
    index === null ||
    !S.tools ||
    !keys[index] ||
    Math.abs(cameraKeyFrameTime(index) - S.t) >= SAME
  )
    return;
  const fields = cameraPathHandles(index);
  if (!fields.length) return;
  const context = sourceCameraSegment(index);
  if (!context) return;
  const { active, at } = context;
  const resolve = S.tools.resolveCameraAnchor;
  const positions = active.map((key) => resolveCameraPoint(key.p, resolve));
  const p = positions[at];
  const key = active[at];
  const vertices: THREE.Vector3[] = [],
    positionsColor: number[] = [],
    dotColor: number[] = [];
  for (const field of fields) {
    const stored = key[field];
    const offset = stored
      ? new THREE.Vector3(...stored)
      : field === "inHandle"
        ? defaultCameraHandles(positions, at - 1).in
        : defaultCameraHandles(positions, at).out;
    const pos = p.clone().add(offset);
    tangents.push({ index, field, point: pos });
    vertices.push(p, pos);
    const rgb = new THREE.Color(POINT_COLORS[field]).toArray();
    positionsColor.push(...rgb, ...rgb);
    dotColor.push(...rgb);
  }
  const geometry = points(vertices).setAttribute(
    "color",
    new THREE.Float32BufferAttribute(positionsColor, 3),
  );
  const dotGeometry = points(tangents.map((mark) => mark.point)).setAttribute(
    "color",
    new THREE.Float32BufferAttribute(dotColor, 3),
  );
  handleLines.add(
    new THREE.LineSegments(geometry, handleInk),
    new THREE.Points(dotGeometry, handleDots),
  );
};

const writePoint = (index: number, field: Field, point: THREE.Vector3, apply: typeof edit) => {
  const key = keys[index];
  if (!key || key.locked || (field === "p" && rigForKey(index)?.rail)) return false;
  if (isHandle(field)) {
    const offset = point.clone().sub(resolveCameraPoint(key.p, S.tools?.resolveCameraAnchor));
    apply((rows) => {
      rows[index][field] = vectorPoint(offset);
    });
    return true;
  }
  const vec = vectorPoint(point);
  const old = key[field];
  const value = Array.isArray(old) ? vec : S.tools?.moveCameraAnchor?.(old, vec);
  if (!value) return false;
  apply((rows) => {
    rows[index][field] = value;
  });
  return true;
};
const finishDrag = (commit: boolean) => {
  if (!drag) return;
  const { index, field, snap, point } = drag;
  drag = null;
  const destination = proxy.position.clone();
  restore(snap);
  if (commit && !point.equals(destination)) writePoint(index, field, destination, edit);
  S.dirty = true;
};
const gizmoFor = () => {
  if (gizmo) return gizmo;
  const controls = new TransformControls(S.tools!.camera, S.el.canvas);
  gizmo = controls;
  controls.setSize(0.6);
  overlay.add(controls.getHelper());
  controls.addEventListener("dragging-changed", (e) => {
    if (!e.value) return finishDrag(true);
    if (shownKey < 0) return;
    if (S.playing) setPlaying(false);
    drag = { index: shownKey, field: shownField, snap: snapshot(), point: proxy.position.clone() };
  });
  controls.addEventListener("objectChange", () => {
    if (!drag) return;
    writePoint(drag.index, drag.field, proxy.position, preview);
    S.dirty = true;
  });
  controls.addEventListener("change", () => {
    S.viewMoved = true;
  });
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !drag) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      finishDrag(false);
      controls.detach();
    },
    true,
  );
  return controls;
};

export const cameraGizmoBusy = () => !!gizmo && (gizmo.dragging || gizmo.axis !== null);
export const pickCameraPath = (x: number, y: number) => {
  if (!get().free || !get().cameraPath) return false;
  const canvas = S.el.canvas;
  const camera = S.tools?.camera;
  if (!camera) return false;
  let best: Marker | null = null;
  let distance = 11;
  for (const mark of [...tangents, ...marks]) {
    const screen = mark.point.clone().project(camera);
    if (screen.z < -1 || screen.z > 1) continue;
    const pixels = Math.hypot(
      ((screen.x + 1) / 2 - x) * canvas.clientWidth,
      ((1 - screen.y) / 2 - y) * canvas.clientHeight,
    );
    if (pixels >= distance) continue;
    best = mark;
    distance = pixels;
  }
  if (!best) return false;
  shownKey = best.index;
  shownField = best.field;
  setKey(best.index);
  seekExact(cameraKeyFrameTime(best.index));
  return true;
};
export const avoidCameraWall = () => {
  const i = get().camKey;
  const key = i === null ? null : keys[i];
  if (!key || i === null || key.locked) return say("Pick an unlocked camera position key");
  if (rigForKey(i)?.rail) return say("Set this key’s rail position to move it clear of a wall");
  if (Math.abs(key.t - S.t) >= SAME)
    return say("Go to the camera keyframe before moving it away from the wall");
  const p = resolveCameraPoint(key.p, S.tools!.resolveCameraAnchor);
  const contacts = cameraSurfaces();
  const actual = sampleEditedPath([cameraKeyFrameTime(i)])[0]?.p ?? p;
  const hit = gap(actual, contacts);
  if (!hit.normal || hit.d >= 0.08) return say("This camera key is clear of the nearest wall");
  const push = hit.normal.clone().multiplyScalar(0.1 - hit.d);
  const moved = p.clone().add(push);
  if (gap(actual.clone().add(push), contacts).d < 0.02)
    return say("The first clear point is blocked. Move the position handle");
  if (writePoint(i, "p", moved, edit)) say("Camera key moved away from the wall");
};

export const drawCamPath = () => {
  const tools = S.tools;
  const state = get();
  if (
    !tools?.free.on ||
    !tools.renderer ||
    !state.free ||
    !state.cameraPath ||
    !keys.length ||
    state.preview.clean ||
    state.preview.mirror
  ) {
    if (gizmo?.object) gizmo.detach();
    return;
  }
  const [start, end] = cameraRange();
  const windowStart = Math.floor(S.t / 2) * 2;
  const cache = [
    state.camRev,
    state.keysRev,
    state.shotsRev,
    state.timingRev,
    start,
    end,
    windowStart,
  ].join("|");
  if (cache !== built && !drag) {
    rebuild(start, end, windowStart);
    built = cache;
  }
  trace.forEach((sample, i) => {
    const color = sample.contact.d < 0.08 ? BLOCKED : sample.t < S.t ? BEHIND : AHEAD;
    paint?.setXYZ(i, color.r, color.g, color.b);
  });
  if (paint) paint.needsUpdate = true;
  if (line) line.visible = trace.length > 1;
  const parallel = filmCam.parallel;
  const guideCamera = parallel ? parallelGhost : ghost;
  const helper = parallel ? parallelFrustum : frustum;
  guideCamera.position.copy(filmCam.position);
  guideCamera.quaternion.copy(filmCam.quaternion);
  if (parallel) Object.assign(parallelGhost, parallel);
  else {
    ghost.fov = filmCam.fov;
    ghost.aspect = filmCam.aspect;
  }
  const view = filmCam.view;
  if (view)
    guideCamera.setViewOffset(
      view.fullWidth,
      view.fullHeight,
      view.offsetX,
      view.offsetY,
      view.width,
      view.height,
    );
  else guideCamera.clearViewOffset();
  guideCamera.far = THREE.MathUtils.clamp((filmCam.focus || 0.7) + filmCam.focusRange / 2, 0.2, 20);
  guideCamera.near = filmCam.focusRange
    ? THREE.MathUtils.clamp(filmCam.focus - filmCam.focusRange / 2, 0.05, guideCamera.far - 0.05)
    : 0.05;
  guideCamera.updateProjectionMatrix();
  guideCamera.updateMatrixWorld();
  helper.update();
  const visible = tools.camera.position.distanceTo(guideCamera.position) > 0.3;
  frustum.visible = visible && !parallel;
  parallelFrustum.visible = visible && !!parallel;
  rayPositions.setXYZ(0, filmCam.position.x, filmCam.position.y, filmCam.position.z);
  rayPositions.setXYZ(1, filmCam.aim.x, filmCam.aim.y, filmCam.aim.z);
  rayPositions.needsUpdate = true;
  const index = state.camKey;
  const handleKey = [index, state.camRev, state.shotsRev, state.timingRev, S.t, !!drag].join("|");
  if (handleKey !== handleCache) {
    rebuildHandles(index);
    handleCache = handleKey;
  }
  if (!drag) {
    const key = index === null ? null : keys[index];
    if (
      index !== null &&
      key &&
      !key.locked &&
      Math.abs(S.t - key.t) < SAME &&
      !state.object &&
      !state.keyPicks.length
    ) {
      if (shownKey !== index && isHandle(shownField)) shownField = "p";
      shownKey = index;
      const tangent = isHandle(shownField)
        ? tangents.find((mark) => mark.field === shownField)
        : null;
      if (isHandle(shownField) && !tangent) shownField = "p";
      if (shownField === "p" && rigForKey(index)?.rail) shownField = "l";
      const point =
        tangent?.point ??
        resolveCameraPoint(key[shownField === "l" ? "l" : "p"], tools.resolveCameraAnchor);
      proxy.position.copy(point);
      proxy.updateMatrixWorld(true);
      const controls = gizmoFor();
      controls.camera = tools.camera;
      controls.setTranslationSnap(state.snap ? 1 / 16 : null);
      if (!controls.object) controls.attach(proxy);
    } else if (gizmo?.object) gizmo.detach();
  }
  const renderer = tools.renderer;
  const auto = renderer.autoClear;
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(overlay, tools.camera);
  renderer.autoClear = auto;
};

export const toggleCameraPath = () => {
  set({ cameraPath: !get().cameraPath });
  S.dirty = true;
};
