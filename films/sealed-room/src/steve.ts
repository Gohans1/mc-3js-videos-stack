// @ts-nocheck
// Steve's acting vocabulary for this film: the body poses steve.json's moves name and the faces its face keys name beyond
// player.ts MOODS. What the keys mean and how they play: mc-actor/perform.ts.
import { GESTURES, PX, addPose, arm, leg } from "mc-actor/player";
import { makePerformance } from "mc-actor/perform";
import { CHAIR } from "./world";

const D = Math.PI / 180;

// Body poses by name, at local time s since the key. Arms here are where they hang when no hand target is set
export const POSES = {
  lie: () => GESTURES.sleep(),
  // propped up on his hands: the back rises, the legs stay flat on the mattress (hips turn up as the thighs turn down)
  push: () => addPose({ root: { rx: -48, y: -(12 * PX - 2 * PX) }, head: [-12, 0, 0], chest: [6, 0, 0] }, leg("L", 42, 2, 0), leg("R", 42, 2, 0)),
  sitBed: (s) => addPose({ root: { y: -(12 * PX - 2 * PX) }, body: [10, 0, 0], head: [6, 0, 0], chest: [1.5 * Math.sin(s * 1.6), 0, 0] }, leg("L", 90, 3, 0), leg("R", 90, 3, 0), arm("L", 8, 14, 0, 12), arm("R", 8, 14, 0, 12)),
  // perched on the bed's edge: the mattress (9 px) is higher than his shin (6 px), so the thighs slope down to the floor
  sitEdge: (s) => addPose({ root: { y: -0.04 }, body: [14, 0, 0], head: [10, 0, 0], chest: [1.5 * Math.sin(s * 1.6), 0, 0] }, leg("L", 34, 5, 34), leg("R", 34, 5, 34), arm("L", 16, 8, 0, 20), arm("R", 16, 8, 0, 20)),
  rise: () => ({ body: [24, 0, 0], chest: [10, 0, 0], head: [-14, 0, 0] }),
  stand: (s) => addPose(arm("L", 0, 5 + 1.2 * Math.sin(s * 1.3), 0, 6), arm("R", 0, 5 + 1.2 * Math.sin(s * 1.3 + 1), 0, 6), { chest: [-1.5 * Math.sin(s * 1.7), 0, 0] }),
  // standing close at the door, leaning a little in to it
  feel: (s) => addPose(POSES.stand(s), { body: [5, 0, 0], head: [4, 0, 0] }),
  // on the chair (world.ts CHAIR.seat): the thighs rest on the seat (hips half a leg's width above it), sloping a little to
  // the knees, shins straight down. A player's leg is 12 px against a real man's ~16, so on a real chair his feet hang a
  // hand's width off the floor, as in every Minecraft film
  seat: (s) => addPose({ root: { y: CHAIR.seat + 2 * PX - 12 * PX }, chest: [1.5 * Math.sin(s * 1.6), 0, 0] }, leg("L", 84, 4, 84), leg("R", 84, 4, 84)),
  chair: (s) => addPose(POSES.seat(s), arm("L", 40, 6, 0, 40), arm("R", 40, 6, 0, 40)),
  // reading sits back at ease, the back on the backrest; straining over the code only leans a few degrees in (the dev:
  // anything more reads as cowering at the desk)
  read: (s) => addPose(POSES.chair(s), { body: [1, 0, 0], chest: [1.5 * Math.sin(s * 1.6), 0, 0] }),
  strain: (s) => addPose(POSES.chair(s), { body: [5, 0, 0], chest: [4 + 1.2 * Math.sin(s * 2.4), 0, 0] }),
  // slumped back after giving up: the chest falls back, hands drop to the thighs; one long breath out at the start
  // (on the seat alone: its arms are its own, hanging limp; body and chest lean back 16 degrees, so they swing 16 forward)
  slump: (s) => addPose(POSES.seat(s), { body: [-10, 0, 0], chest: [-6 - 5 * Math.exp(-s * 1.5) * Math.sin(Math.min(s, 1.2) * 2.6), 0, 0], head: [-6, 0, 0] }, arm("L", 16, 7, 0, 4), arm("R", 16, 7, 0, 4)),
  // on both knees in front of the drawer, shins flat on the floor behind him (hips 8 px up); lean is how far over it he
  // bends. A player's arm reaches 10 px from the shoulder, so the drawer's back takes a deep bend
  kneel: (s, lean = 0) => addPose(leg("L", 0, 3, 90), leg("R", 0, 3, 90), { root: { y: -4 * PX }, body: [lean, 0, 0], chest: [lean * 0.2 + 1.2 * Math.sin(s * 1.7), 0, 0] }),
  reach: (s) => POSES.kneel(s, 50),
  pull: (s) => POSES.kneel(s, 18),
  hold: (s) => POSES.kneel(s, 10),
  // the dig (src/timeline/props.json files): bent in over the drawer for the next folder, upright on his knees to read it, then a
  // half turn of the chest to the side the folder is thrown to (his right: tossR), so it leaves the hand away from his body
  digReach: (s) => POSES.kneel(s, 42),
  digRead: (s) => addPose(POSES.kneel(s, 4), { head: [4, 0, 0] }),
  tossR: (s) => addPose(POSES.kneel(s, 8), { chest: [0, -24, 0], body: [0, -10, 0] }),
  tossL: (s) => addPose(POSES.kneel(s, 8), { chest: [0, 24, 0], body: [0, 10, 0] }),
  // the frenzy at the end: bent over the drawer, both hands flinging, the chest rocking with each throw
  frenzy: (s) => addPose(POSES.kneel(s, 40), { chest: [3 * Math.sin(s * 9.4), 6 * Math.sin(s * 4.7), 0] }),
  // scene 6 (1:10-1:44): curious on the chair, the recoil when the silverfish bursts out, sitting on the floor panting,
  // picking pages off the floor, reading them leant on the desk
  lean: (s) => addPose(POSES.chair(s), { body: [14, 0, 0], head: [8, 0, 0] }),
  // twisted round in the seat towards the cabinet on his left, so the head never turns past the shoulder
  slumpTurn: (s) => addPose(POSES.slump(s), { body: [0, 32, 0], chest: [0, 18, 0] }),
  leanTurn: (s) => addPose(POSES.lean(s), { body: [0, 32, 0], chest: [0, 16, 0] }),
  // bent to a low drawer standing, knees a little bent (hips 6 cm down: thighs 25 degrees on, shins 20 back), back bent well over
  stoop: (s) => addPose({ root: { y: -0.057 }, body: [52, 0, 0], chest: [6 + 1.2 * Math.sin(s * 1.7), 0, 0], head: [-22, 0, 0] }, leg("L", 25, 2, 45), leg("R", 25, 2, 45)),
  // the jolt back when the silverfish bursts out: straightens up and away, hands thrown up before his face
  // the kick at the door: the right knee drawn up, then the leg driven out straight, leaning back against it
  kickWind: (s) => addPose(POSES.stand(s), leg("R", 78, 3, 100), { body: [-5, 0, 0], head: [6, 0, 0] }),
  kick: (s) => addPose(POSES.stand(s), leg("R", 58, 3, 4), { body: [-15, 0, 0], head: [10, 0, 0] }),
  gasp: (s) => addPose(POSES.stand(s), arm("L", 75, 30, 0, 80), arm("R", 75, 30, 0, 80), { body: [-14, 0, 0], head: [-16, 0, 0] }),
  // on the floor, leaning back on his hands, knees up (thighs 35 degrees up, shins down to the stone); the breaths come
  // fast and slow down (rate 1.6 Hz falling to ~0.9 over four seconds)
  floor: (s) => {
    const ph = 2 * Math.PI * (1.6 * s - 0.09 * Math.min(s, 4) ** 2);
    return addPose({ root: { y: -(12 * PX - 2 * PX) }, body: [-26, 0, 0], chest: [-3 + 5 * Math.sin(ph), 0, 0], head: [6 + 3 * Math.sin(ph + 0.6), 0, 0] },
      leg("L", 125, 8, 101), leg("R", 125, 8, 101), arm("L", -50, 12, 0, 0), arm("R", -50, 12, 0, 0));
  },
  // sat up off his hands, still on the floor, knees up, arms free to take the pages lying round him; floorReach leans over
  // his knees for one further off
  floorUp: (s) => addPose({ root: { y: -(12 * PX - 2 * PX) }, body: [8, 0, 0], chest: [2 + 2 * Math.sin(s * 5), 0, 0] }, leg("L", 125, 8, 101), leg("R", 125, 8, 101), arm("L", 20, 10, 0, 20), arm("R", 20, 10, 0, 20)),
  floorReach: (s) => addPose(POSES.floorUp(s), { body: [22, 0, 0], head: [-8, 0, 0] }),
  desk: (s) => addPose(POSES.stand(s), { body: [16, 0, 0], head: [18, 0, 0] }),
  // standing tall to read what he holds up: here it is, let's see
  readUp: (s) => addPose(POSES.stand(s), { body: [4, 0, 0], chest: [-3, 0, 0] }),
  // the wind-up before the fling: hands pressed on the desk, shoulders turned to his right over the pile (anticipation)
  windup: (s) => addPose(POSES.stand(s), { body: [18, -8, 0], chest: [4, -12, 0], head: [14, 0, 0] }),
  // the fling: the whole body swings to his left after the pages (body and chest turn the same way, leaning into it)
  fling: (s) => addPose(POSES.stand(s), { body: [16, 30, 0], chest: [6, 22, 0] }),
  // stood still after it, breathing hard: the chest heaves
  pant: (s) => addPose(POSES.stand(s), { body: [6, 0, 0], chest: [-2 + 3 * Math.sin(s * 6.5), 0, 0] }),
  // down on one knee (the dev: never flat on the floor to look into a cabinet): right knee and shin on the stone, left foot
  // planted ahead (thigh 70 degrees forward, shin straight down to the floor from the 8 px kneeling hip); lean bends him over it
  oneKnee: (s, lean = 0) => addPose(leg("R", 0, 3, 90), leg("L", 70, 3, 70), { root: { y: -4 * PX }, body: [lean, 0, 0], chest: [lean * 0.15 + 1.2 * Math.sin(s * 1.7), 0, 0] }),
  // up on one knee on the way to his feet
  kneelUp: (s) => POSES.oneKnee(s, 20),
  // the yank: bent to the drawer's pull on one knee, then thrown back against it
  kneelPull: (s) => POSES.oneKnee(s, 45),
  kneelBack: (s) => POSES.oneKnee(s, 12),
  // bent to the empty slot, the head lifted against the lean so he looks into its mouth rather than at the floor
  peekIn: (s) => addPose(POSES.oneKnee(s, 57), { head: [-18, 0, 0] }),
  reachIn: (s) => addPose(POSES.oneKnee(s, 60), { head: [-22, 0, 0] }),
  // upright on one knee, the scrap held before his face
  readNote: (s) => addPose(POSES.oneKnee(s, 4), { head: [16, 0, 0] }),
};

// Faces the moods table lacks: brows stay thin lines and never drop over the eyes
export const FACES = {
  uneasy: { y: 0.15, tilt: 14, open: 0.9, squint: 0, pupil: 0.95, smile: -0.25 },
  tense: { y: 0.1, tilt: 18, open: 0.95, squint: 0.1, pupil: 0.9, smile: -0.45 },
  strained: { y: 0, tilt: -12, open: 0.85, squint: 0.35, pupil: 0.95, smile: -0.5 },
  spent: { y: 0, tilt: 10, open: 0.55, squint: 0.1, pupil: 1, smile: -0.35 },
  bored: { y: -0.05, tilt: 4, open: 0.6, squint: 0.1, pupil: 1, smile: -0.2 },
  restless: { y: 0, tilt: -10, open: 0.9, squint: 0.25, pupil: 1, smile: -0.55 },
  // furious at ACCESS DENIED: brows pulled in but still above the eyes
  seething: { y: 0.05, tilt: -14, open: 0.95, squint: 0.2, pupil: 0.9, smile: -0.7 },
  // back from the locked door: more put out than afraid
  annoyed: { y: 0, tilt: -6, open: 0.85, squint: 0.15, pupil: 1, smile: -0.3 },
  // at the desk with the pages: here it is, read it fast. Brows up, eyes wide, the start of a smile
  eager: { y: 0.3, tilt: 6, open: 1, squint: 0, pupil: 0.85, smile: 0.3 },
  struck: { y: 0.4, tilt: 10, open: 1, squint: 0, pupil: 0.7, smile: -0.1 },
  // the drawer opens: is there anything good in here? Brows up, eyes wide; then the pages are worthless
  curious: { y: 0.3, tilt: 4, open: 1, squint: 0, pupil: 0.85, smile: 0.1 },
  unimpressed: { y: -0.1, tilt: 6, open: 0.55, squint: 0.15, pupil: 1, smile: -0.4 },
};

export const { bodyAt, targetAt, moodAt, readLook, blinkAt } = makePerformance({ poses: POSES, faces: FACES, standing: ["stand", "feel"] });
