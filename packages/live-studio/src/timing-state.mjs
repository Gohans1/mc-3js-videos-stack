import { compileLayerTiming, overlayTime } from "./layer-timing.mjs";
import { LINKAGE_KINDS } from "./linkage.mjs";
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
export const setTiming = (data, sourceDuration = timingClock.sourceDuration) => {
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
        layerClocks[clip.name === data.narration ? "voice" : list === "beds" ? "audio" : "sfx"],
    };
    layersKey = nextLayers;
  }
};
export const clockForTimeline = (name) =>
  name === "sound" ? audioClock : (layerClocks[name] ?? timingClock);
export const layerDuration = () =>
  Math.max(0, ...Object.values(layerClocks).map((clock) => clock.duration));

export const timedDraw = (draw) => {
  const out = Object.assign((t) => {
    const frame = frameAt(timingClock, t),
      layers = layerClock.sourceAt(t);
    const adjustment = clockForTimeline("adjustment");
    return draw(frame, {
      layers,
      adjustments: adjustment.sourceAt(t),
      textTime: (item) => overlayTime(layerClock, t, item),
      adjustmentTime: (item) => overlayTime(adjustment, t, item),
      pictureVisible: frameVisible(timingClock, t),
      layersVisible: frameVisible(layerClock, t),
      adjustmentsVisible: frameVisible(adjustment, t),
      transitionVisible: (at) => transitionAvailable(timingClock, at),
      velocity: velocityAt(timing.velocity, frame),
    });
  }, draw);
  if (draw.describe) out.describe = (t) => draw.describe(frameAt(timingClock, t));
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
