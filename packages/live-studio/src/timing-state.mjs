import { compileCameraClock, SHOT_CUT_NEAR } from "./camera-clock.mjs";
import { compileLayerTiming, overlayTime } from "./layer-timing.mjs";
import { LINKAGE_KINDS } from "./linkage.mjs";
import { mapTimeline } from "./timing-data.mjs";
import { transitionAvailable } from "./timing-effects.mjs";
import { compileTiming, frameAt, frameVisible } from "./timing.mjs";
import { velocityAt } from "./velocity.mjs";

export let timing = {};
export let timingClock = compileTiming({}, 0);
export let layerClock = timingClock;
let pictureKey = "",
  layersKey = "";
let layerClocks = {};
let audioClock = layerClock;
let cameraClock = timingClock,
  cameraShots = [],
  cameraKey = "";
export const setTiming = (
  data,
  sourceDuration = timingClock.sourceDuration,
  shots = cameraShots,
) => {
  cameraShots = shots;
  timing = data;
  const nextPicture = JSON.stringify([
    sourceDuration,
    data.speeds,
    data.freezes,
    data.cuts,
    data.gaps,
    data.main,
  ]);
  if (pictureKey !== nextPicture) {
    timingClock = compileTiming(data, sourceDuration);
    pictureKey = nextPicture;
  }
  const nextCamera = JSON.stringify([nextPicture, shots.map((shot) => [shot.t, shot.cameraClock])]);
  if (cameraKey !== nextCamera) {
    cameraClock = compileCameraClock(timingClock, shots);
    cameraKey = nextCamera;
  }
  const nextLayers = JSON.stringify([sourceDuration, data.layers, data.layerKinds, nextPicture]);
  if (layersKey !== nextLayers) {
    const cache = new Map();
    layerClocks = Object.fromEntries(
      LINKAGE_KINDS.map((kind) => {
        const history = data.layerKinds?.[kind] ?? data.layers;
        if (!history) return [kind, timingClock];
        const key = JSON.stringify([sourceDuration, history]);
        const previous = layerClocks[kind];
        const clock =
          cache.get(key) ??
          (previous?.historyKey === key
            ? previous
            : Object.assign(compileLayerTiming(data, sourceDuration, kind), { historyKey: key }));
        cache.set(key, clock);
        return [kind, clock];
      }),
    );
    layerClock = layerClocks.text;
    audioClock = {
      ...layerClocks.sfx,
      forClip: (clip, list, data) =>
        layerClocks[
          clip._narration || clip.name === data.narration
            ? "voice"
            : list === "beds"
              ? "audio"
              : "sfx"
        ],
    };
    layersKey = nextLayers;
  }
};
export const clockForTimeline = (name) =>
  name === "cam"
    ? cameraClock
    : name === "sound"
      ? audioClock
      : (layerClocks[name === "openfilm" ? "overlays" : name] ?? timingClock);
export const cameraCutSeconds = (keys) => {
  const list = Array.isArray(keys) ? keys : Array.isArray(keys?.keys) ? keys.keys : [];
  const rows = list.filter((k) => Number.isFinite(k?.t));
  const heard = mapTimeline("cam", rows, clockForTimeline("cam")) ?? [];
  const first = heard.length ? Math.min(...heard.map((k) => k.t)) : 0;
  return heard.flatMap((k) => (k.cut && k.t > first + 1e-9 ? [k.t] : [])).toSorted((a, b) => a - b);
};
export const renderCutTimes = (shotStarts, camKeys) => {
  const shots = [...shotStarts].toSorted((a, b) => a - b);
  const keys = cameraCutSeconds(camKeys).filter(
    (t) => !shots.some((s) => Math.abs(s - t) < SHOT_CUT_NEAR),
  );
  return [...shots, ...keys]
    .toSorted((a, b) => a - b)
    .filter((t, i, all) => !i || t - all[i - 1] > 1e-6);
};
export const layerDuration = () =>
  Math.max(0, ...Object.values(layerClocks).map((clock) => clock.duration));

export const cameraTimesAt = (t) => {
  const picture = timingClock;
  const world = frameAt(picture, t);
  const span = cameraClock.cameraSpans?.find((s) => t >= s.from && t < s.to);
  if (!span) return { world, camera: world };
  const rate = (span.sourceTo - span.sourceFrom) / (span.to - span.from);
  const camera = span.sourceFrom + (t - span.from) * rate;
  return {
    world,
    camera,
    worldAtCamera: (time) => {
      const mapped = rate > 0 ? t + (time - camera) / rate : t;
      const last = Math.max(span.from, span.to - 1e-6);
      return frameAt(picture, Math.max(span.from, Math.min(last, mapped)));
    },
  };
};

export const timedDraw = (draw) => {
  const asyncFrame = draw.renderFrame?.bind(draw);
  const at = (t, render, options) => {
    const { world: frame, camera, worldAtCamera } = cameraTimesAt(t);
    const layerAt = options?.layerTime ?? t;
    const layers = layerClock.sourceAt(layerAt);
    const adjustment = clockForTimeline("adjustment");
    return render(frame, {
      ...options,
      camera,
      worldAtCamera,
      layers,
      adjustments: adjustment.sourceAt(t),
      textTime: (item) => overlayTime(layerClock, layerAt, item),
      adjustmentTime: (item) => overlayTime(adjustment, t, item),
      pictureVisible: options?.pictureVisible === false ? false : frameVisible(timingClock, t),
      layersVisible: options?.layersVisible === false ? false : frameVisible(layerClock, layerAt),
      adjustmentsVisible:
        options?.adjustmentsVisible === false ? false : frameVisible(adjustment, t),
      transitionVisible: (at) =>
        options?.pictureVisible === false ? false : transitionAvailable(timingClock, at),
      velocity: velocityAt(timing.velocity, frame),
    });
  };
  const out = Object.assign((t, options) => at(t, draw, options), draw);
  if (asyncFrame) out.renderFrame = (t, options) => at(t, asyncFrame, options);
  if (draw.describe) out.describe = (t) => draw.describe(frameAt(timingClock, t));
  if (draw.prepareFrame) out.prepareFrame = (t) => draw.prepareFrame(frameAt(timingClock, t));
  if (draw.needsPreparation)
    out.needsPreparation = (t) => draw.needsPreparation(frameAt(timingClock, t));
  if (draw.variants)
    out.variants = draw.variants.map((v) => ({
      ...v,
      // a spread reads a getter once: the pick a chip makes later must still show
      get pick() {
        return v.pick;
      },
      get ranges() {
        return v.ranges.map(([a, b]) => [
          timingClock.outputAt(a),
          timingClock.outputAt(b, "before"),
        ]);
      },
    }));
  return out;
};
