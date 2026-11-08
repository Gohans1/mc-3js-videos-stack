// @ts-nocheck
// Steve's acting vocabulary for this film: the body poses steve.json's moves name. What the keys mean and how they play:
// mc-actor/perform.ts. He has no face to act with (scene.ts sets FACES "noeyes"), so steve.json carries no face keys.
// Most shots are stills (the dev's rule: a photo of him mid-action, scene.ts stillAt), so a pose here is the moment the
// photo catches: hands that touch something get a target in steve.json `hands` (arm IK), the rest is in the pose.
// Head pitch: + looks down; body/chest pitch: + leans forward.
import { GESTURES, PX, addPose, arm, leg } from "mc-actor/player";
import { makePerformance } from "mc-actor/perform";

const SEAT = 0.45; // story.ts CHAIR.seat

// Body poses by name, at local time s since the key. Arms here are where they hang when no hand target is set
export const POSES = {
  stand: (s) => addPose(arm("L", 0, 5 + 1.2 * Math.sin(s * 1.3), 0, 6), arm("R", 0, 5 + 1.2 * Math.sin(s * 1.3 + 1), 0, 6), { chest: [-1.5 * Math.sin(s * 1.7), 0, 0] }),
  still: () => addPose(arm("L", 0, 5, 0, 8), arm("R", 0, 5, 0, 8)),
  lie: () => GESTURES.sleep(),
  // on the chair: thighs on the seat, shins straight down (sealed-room's seat)
  seat: () => addPose({ root: { y: SEAT + 2 * PX - 12 * PX } }, leg("L", 84, 4, 84), leg("R", 84, 4, 84)),
  chair: () => addPose(POSES.seat(), arm("L", 40, 6, 0, 40), arm("R", 40, 6, 0, 40)),
  type: () => addPose(POSES.chair(), { body: [6, 0, 0], head: [14, 0, 0] }),
  // stuck: elbows on the desk, both hands on his head, bent over
  despair: () => addPose(POSES.seat(), arm("L", 95, -18, 15, 120), arm("R", 95, -18, 15, 120), { body: [16, 0, 0], chest: [10, 0, 0], head: [26, 0, 0] }),
  // his kick on the door: right leg straight out at the panel, leaning back, arms out for balance
  kick: () => addPose(leg("R", 78, 0, 8), leg("L", -6, 0, 10), arm("L", 30, 35, 0, 35), arm("R", -10, 40, 0, 20), { body: [-14, 0, 0], head: [10, 0, 0] }),
  lookUp: () => addPose(POSES.still(), { head: [-38, 0, 0], chest: [-4, 0, 0] }),
  // a book hurled down: the throwing arm low and forward, the body following through
  throw: () => addPose(arm("R", 62, -6, 0, 6), arm("L", -12, 18, 0, 20), { body: [12, 18, 0], head: [16, 10, 0] }),
  flinch: () => GESTURES.scared(),
  crouch: () => GESTURES.crouch(),
  kneel: () => GESTURES.kneel(),
  // half under the desk: on his knees, bent far forward into its knee space, head low under the plate
  under: () => addPose(GESTURES.kneel(), { body: [74, 0, 0], chest: [6, 0, 0], head: [10, 0, 0] }),
  // backed out from under it, still on his knees, bent forward: his head clear of the desk's edge to look around
  underOut: () => addPose(GESTURES.kneel(), { body: [38, 0, 0] }),
  // reading a book held in both hands at the chest
  read: () => addPose(arm("L", 58, -16, 0, 74), arm("R", 58, -16, 0, 74), { head: [26, 0, 0] }),
  // the answer scrap up his sleeve: arms crossed tight, head tipped up at the dome
  hide: () => addPose(arm("R", 52, -42, 0, 112), arm("L", 48, -40, 0, 108), { chest: [4, 0, 0], head: [-30, -14, 0] }),
  // his ear on the east wall: leaning in sideways, head turned flat against the stone
  ear: () => addPose(POSES.still(), { body: [0, 0, -12], head: [4, -62, -8] }, arm("L", 30, 20, 0, 60), arm("R", 30, 20, 0, 60)),
  // sat on the floor where he fell, propped on his hands
  floor: () => addPose(GESTURES.sit(), arm("L", -34, 14, 0, 8), arm("R", -34, 14, 0, 8), { body: [-16, 0, 0], head: [6, 0, 0] }),
  // dust: his hands up in front of his eyes as he comes apart
  hands: () => addPose(arm("L", 78, -12, 0, 70), arm("R", 78, -12, 0, 70), { head: [22, 0, 0] }),
};

export const { bodyAt, targetAt } = makePerformance({ poses: POSES, standing: ["stand", "still", "lookUp", "throw", "read", "hide", "ear", "hands", "flinch"] });
