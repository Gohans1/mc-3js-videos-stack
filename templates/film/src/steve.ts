// @ts-nocheck
import { makePerformance } from "mc-actor/perform";
import { addPose, arm, GESTURES } from "mc-actor/player";

export const POSES = {
  stand: (s) =>
    addPose(
      arm("L", 0, 5 + 1.2 * Math.sin(s * 1.3), 0, 6),
      arm("R", 0, 5 + 1.2 * Math.sin(s * 1.3 + 1), 0, 6),
      { chest: [-1.5 * Math.sin(s * 1.7), 0, 0] },
    ),
  lie: () => GESTURES.sleep(),
};

export const FACES = {};

export const { bodyAt, targetAt, moodAt, readLook, blinkAt } = makePerformance({
  poses: POSES,
  faces: FACES,
  standing: ["stand"],
});
