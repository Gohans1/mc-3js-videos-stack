import { hfovOf, mmOf, PAN_SECONDS } from "film-kit/lens";
import { lensAspect } from "film-stage/camera";
import { EDIT } from "film/edit";
import type { CameraPathPose } from "film/scene";
import { Vector3 } from "three";

import { camLine } from "../camera/camline";
import { sampleEditedPath } from "../camera/campath";
import { shotEnd, shotIndex } from "../core/film";
import { SHOTS_OUT } from "../core/filmMeta";
import { S } from "../core/state";
import { get, say, showError } from "../core/store";
import { FPS, stamp } from "../core/time";
import { focusLimits } from "./hud";

const DEG = 180 / Math.PI;
const EPS = 1e-5;
const angleLabel = (v: number) => v.toFixed(1) + "°";
const distanceLabel = (v: number) => (Number.isFinite(v) ? v.toFixed(2) + "m" : "∞");
const forward = (pose: CameraPathPose) => pose.l.clone().sub(pose.p);
const sample = (times: number[]) =>
  S.tools && Array.isArray(EDIT.cam) && EDIT.cam.length ? sampleEditedPath(times) : null;

export const panStats = (i: number, t: number) => {
  const shot = SHOTS_OUT[i];
  if (!shot) return null;
  const from = Math.max(shot.t, t - 0.5 / FPS);
  const to = Math.min(shotEnd(i) - EPS, t + 0.5 / FPS);
  if (to <= from) return null;
  const poses = sample([from, to]);
  if (!poses) return null;
  const [a, b] = poses;
  const aspect = S.tools?.camera.aspect ?? 16 / 9;
  const speed = (forward(a).angleTo(forward(b)) * DEG) / (to - from);
  const fullWidth = speed > 1e-6 ? hfovOf((a.fov + b.fov) / 2, aspect) / speed : Infinity;
  return {
    speed,
    fullWidth,
    mm: mmOf((a.fov + b.fov) / 2, lensAspect(aspect, shot.camera?.fovAxis)),
  };
};

export const cutWarnings = (i: number) => {
  const shot = SHOTS_OUT[i];
  if (!shot || i <= 0) return [];
  const poses = sample([shot.t - EPS, shot.t]);
  if (!poses) return [];
  const [before, after] = poses;
  const angle = forward(before).angleTo(forward(after)) * DEG;
  const sameAim = before.l.distanceToSquared(after.l) < 0.5 ** 2;
  const lensChange = Math.max(before.fov, after.fov) / Math.min(before.fov, after.fov);
  const warnings: string[] = [];
  if (sameAim && angle < 30 && lensChange < 1.25)
    warnings.push("30° cut (" + angleLabel(angle) + ")");
  const specified = shot.continuityAxis;
  const axis =
    Array.isArray(specified) && specified.length === 2
      ? specified.map((value) => new Vector3().fromArray(value))
      : [before.l, after.l];
  const line = axis[1].clone().sub(axis[0]).setY(0);
  if (line.lengthSq() < 0.25 ** 2) return warnings;
  line.normalize();
  const side = (p: Vector3) => line.clone().cross(p.clone().sub(axis[0])).y;
  const a = side(before.p),
    b = side(after.p);
  if (a * b < 0 && Math.min(Math.abs(a), Math.abs(b)) > 0.02)
    warnings.push(Array.isArray(specified) ? "180° axis crossed" : "Check 180° axis");
  return warnings;
};

const up = new Vector3();
const right = new Vector3();
const sight = new Vector3();
const horizon = () => {
  const q = S.tools?.camera.quaternion;
  if (!q) return null;
  sight.set(0, 0, -1).applyQuaternion(q);
  if (Math.abs(sight.y) > 0.999) return null;
  return (
    Math.atan2(right.set(1, 0, 0).applyQuaternion(q).y, up.set(0, 1, 0).applyQuaternion(q).y) * DEG
  );
};

export const cameraMonitor = (t: number) => {
  const optics = S.tools?.optics;
  const level = horizon();
  const pan = panStats(shotIndex(t), t);
  const cut = cutWarnings(shotIndex(t));
  const features: string[] = [];
  if (optics?.focusM && optics.fstop) {
    const limits = focusLimits(
      optics.mm,
      optics.fstop,
      optics.focusM,
      get().ratio === "9:16" ? 1080 : 1920,
    );
    if (limits)
      features.push(
        "DOF " +
          distanceLabel(limits.near) +
          "–" +
          distanceLabel(limits.far) +
          " · H " +
          distanceLabel(limits.hyperfocal),
      );
  }
  if (level !== null) features.push("Level " + angleLabel(level));
  if (pan && pan.speed >= 0.1) {
    features.push(
      "Pan " +
        angleLabel(pan.speed) +
        "/s" +
        (pan.fullWidth < PAN_SECONDS
          ? " · " + pan.fullWidth.toFixed(1) + "s across frame (<7s)"
          : ""),
    );
  }
  features.push(...cut);
  return { level, text: features.join(" · ") };
};

export const drawCameraMonitor = (t: number) => {
  const el = S.el.horizon;
  if (!el || !get().preview.horizon || get().preview.clean) return "";
  const { level, text } = cameraMonitor(t);
  el.hidden = level === null;
  if (level !== null) {
    const shown = level;
    el.style.setProperty("--horizon-roll", shown.toFixed(2) + "deg");
    el.toggleAttribute("data-level", Math.abs(shown) < 0.8);
  }
  return text;
};

export const copyCameraInspection = () => {
  if (!S.tools) return;
  if (!navigator.clipboard) return say("Clipboard is unavailable in this browser");
  const c = camLine();
  const tag = stamp(S.t) + " Shot " + c.shot;
  const text = [tag, c.line, cameraMonitor(S.t).text].filter(Boolean).join("\n");
  void navigator.clipboard
    .writeText(text)
    .then(() => say("Camera INSPECT copied"))
    .catch(showError);
};
