// @ts-nocheck
// Steve's acting vocabulary for this film: the body poses steve.json's moves name and the faces its face keys name beyond
// player.ts MOODS. What the keys mean and how they play: mc-actor/perform.ts. Most acting comes from mocap clips instead
// (a move key's clip: "<lib>/<clip>"; find one with python ../../packages/clip-catalog/catalog.py --jev "<the scene>").
import { GESTURES, addPose, arm } from "mc-actor/player";
import { makePerformance } from "mc-actor/perform";

// Body poses by name, at local time s since the key. Arms here are where they hang when no hand target is set
export const POSES = {
  stand: (s) => addPose(arm("L", 0, 5 + 1.2 * Math.sin(s * 1.3), 0, 6), arm("R", 0, 5 + 1.2 * Math.sin(s * 1.3 + 1), 0, 6), { chest: [-1.5 * Math.sin(s * 1.7), 0, 0] }),
  lie: () => GESTURES.sleep(),
};

// Faces the moods table lacks: {y, tilt, open, squint, pupil, smile}
export const FACES = {};

export const { bodyAt, targetAt, moodAt, readLook, blinkAt } = makePerformance({ poses: POSES, faces: FACES, standing: ["stand"] });
