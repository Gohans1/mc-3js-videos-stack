// @ts-nocheck
// Two Steves side by side. In the film scenes (dig, standing, walk, reach) the left one is driven the way the film drives
// him now (smoothstep between keys, breathing written into each pose, eyes fixed) and the right one through film-kit's
// layers, each switchable. In the mocap scene both get the layers: the left acts the moments with hand-made keys, the
// right plays Mixamo clips, and every layer that a clip already has (overlap, breath, sway, drift, the head's steadying)
// fades out over each clip (pose.ts mask; switch "mask" off to see them doubled).
// Layer order on the body pose: through keys, + overlap, + cartoon, + idle, + lean, + mood posture, + attention (chest and
// waist join the look), then foot pin, head IK, + steady head, + drift, hand IK (on arcs); face: gaze, blinks, lids.
// The layered Steve's poses are read at their first instant, so their written-in breathing is gone and breath replaces it.
// Also on him: a startle at each bang (not faded over clips: a clip can't know about the bang), the breath held through
// it, eyes gliding after the silverfish (pursuit), looking away while thinking, the head on the path ahead while walking
// (steer), and hips that counter where the upper body's mass goes (balance, measured on the rig by Winter's masses).
// Round 3: blinks that follow what he is doing (fewer while his eyes are busy, at the breaks after), eyes on what his
// hand goes for before it moves (handeye: found in the hand's own path, keys or clip; over a clip the eyes only),
// freezing in fear after a bang, and a glance at something that moves at the edge of his view (notice).
// Round 5: quick wide looks around after a scene or event starts (explore), sleepy eyes while he wakes (drowsy: wake
// scene), and a face that changes at each emotion's own pace (express).
// Round 7 (any Minecraft film): yawns and sighs in the breath, posture that follows the face's emotion, his own face
// touches when a hand is free (life scene), Minecraft's own motion for hits, jumps, deaths and things (mc scene), steps
// from where the soles land (walk and mc), and the same yawn, sigh and thinking as Mixamo clips (lifeMocap).
// URL: ?scene=dig|idle|walk|reach|scare|wake|mocap|life|mc|lifeMocap  ?t=<seconds> stops there  ?view=both|side|face|faceOld  ?off=<layer>,...
//      ?mood=tense|tired (Laban Effort on the layered Steve)
import * as THREE from "three";
import { addPose as addRigPose, blendPose, loadRig, makePlayer, MOODS, mouthAt, PX, walkPose } from "mc-actor/player";
import { blinkAt, DIG, FACES, IDLE, moodAt, POSES } from "./film/dig";
import { CLIP_A, CLIP_B, CLIP_C, mocapScene, REACH, SCARE, WAKE, WALK } from "./film/extra";
import { loadClips } from "mc-actor/clips";
import { slerpPose } from "mc-actor/mocap";
import { through } from "../src/curve";
import { canonical, mask, scalePose, throughPose } from "../src/pose";
import { overlap } from "../src/overlap";
import { cartoon } from "../src/cartoon";
import { idle } from "../src/idle";
import { anglesOf, EYE, eyeTime, gaze, lidOpen, REST_PITCH } from "../src/gaze";
import { attention } from "../src/attention";
import { steady } from "../src/steady";
import { lean } from "../src/lean";
import { micro } from "../src/micro";
import { arc } from "../src/arc";
import { effort, MOOD, phrase } from "../src/effort";
import { startle } from "../src/startle";
import { steer } from "../src/steer";
import { balance, WINTER } from "../src/balance";
import { BLINKS, blinks } from "../src/blinks";
import { HANDEYE, handEye, reaches } from "../src/handeye";
import { FREEZE, freeze } from "../src/freeze";
import { notice } from "../src/notice";
import { fitts, reachK } from "../src/reach";
import { hesitation } from "../src/hesitate";
import { tremor } from "../src/tremor";
import { explore } from "../src/explore";
import { DROWSY, drowsiness } from "../src/drowsy";
import { changeTime, express, KIND } from "../src/express";
import { CLIP_SIGH, CLIP_THINK, CLIP_YAWN, LIFE, lifeMocapScene, MCS } from "./film/life";
import { fly, mcBody, MC, TPS } from "../src/mcmotion";
import { contacts, stepSounds } from "../src/steps";
import { yawnPose, yawns } from "../src/yawn";
import { SIGH, sighTimes } from "../src/sigh";
import { posture, POSTURE } from "../src/posture";
import { SPOT, TOUCH, touches } from "../src/touch";

const q = new URLSearchParams(location.search);
const LAYERS = ["through", "overlap", "cartoon", "breath", "sway", "settle", "gaze", "lids", "attention", "steady", "lean", "noise", "arcs", "startle", "gasp", "pursuit", "think", "steer", "balance", "blinks", "handeye", "freeze", "notice", "reach", "hesitate", "tremor", "explore", "drowsy", "express", "yawn", "sigh", "posture", "touch", "steps", "mc", "mask"];
const on = Object.fromEntries(LAYERS.map((k) => [k, !(q.get("off") ?? "").split(",").includes(k)]));
const MOODNAME = MOOD[q.get("mood")] ? q.get("mood") : "calm";
const FX = effort(MOOD[MOODNAME]);
const SCENES = { dig: DIG, idle: IDLE, walk: WALK, reach: REACH, scare: SCARE, wake: WAKE, life: LIFE, mc: MCS };
const D = Math.PI / 180;

const smooth = (x) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };
const keyAt = (keys, t) => { let i = 0; while (i < keys.length - 1 && t >= keys[i + 1].t) i++; return i; };
const mixPose = (a, b, k) => {
  const out = { root: {} };
  for (const r of new Set([...Object.keys(a.root ?? {}), ...Object.keys(b.root ?? {})])) out.root[r] = THREE.MathUtils.lerp(a.root?.[r] ?? 0, b.root?.[r] ?? 0, k);
  for (const j of new Set([...Object.keys(a), ...Object.keys(b)])) if (j !== "root") { const x = a[j] ?? [0, 0, 0], y = b[j] ?? [0, 0, 0]; out[j] = x.map((v, i) => THREE.MathUtils.lerp(v, y[i], k)); }
  return out;
};

// ---- stage ----
const W = innerWidth, H = innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15191c);
const camera = new THREE.PerspectiveCamera(30, W / H, 0.02, 80);
scene.add(new THREE.HemisphereLight(0xdfe8ec, 0x2a2622, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-2, 4, 8);
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 1 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const grid = new THREE.GridHelper(40, 40, 0x555a5e, 0x44484b);
grid.position.y = 0.001;
scene.add(grid);

const rig = await loadRig("vendor/player.glb");
const probe = await makePlayer(rig, "vendor/steve.png"); // never shown: measures the rig for the bakes

// ---- scene ----
const NAME = q.get("scene") === "mocap" || q.get("scene") === "lifeMocap" || SCENES[q.get("scene")] ? q.get("scene") : "dig";
let SC, CLIPS = {};
const durs = () => Object.fromEntries(Object.entries(CLIPS).map(([k, c]) => [k, c.duration]));
if (NAME === "mocap") {
  CLIPS = await loadClips([CLIP_A, CLIP_B, CLIP_C], probe);
  SC = mocapScene(durs());
} else if (NAME === "lifeMocap") {
  CLIPS = await loadClips([CLIP_YAWN, CLIP_SIGH, CLIP_THINK], probe);
  SC = lifeMocapScene(durs());
} else SC = SCENES[NAME];
const { from: FROM, to: TO } = SC, END = TO + 1;
const STANDING = new Set(["stand", "readUp", "desk", "fling", "pant", "gasp"]);
const AT0 = SC.moves[0].at;

// where the character stands and faces at t (a walk path, or the scene's spot), with this Steve's sideways offset
const placeOf = (t) => { const P = SC.path?.(t); return P ? { x: P.x, z: P.z, yaw: P.yaw, dist: P.dist, speed: P.speed } : { x: AT0[0], z: AT0[2], yaw: -90, dist: 0, speed: 0 }; };
// a walk spreads the two along his path (one 2 m behind the other) so a side camera sees both
const offsetOf = (dz) => (SC.path ? new THREE.Vector3(1.25 * dz, 0, 0) : new THREE.Vector3(0, 0, dz));
const placeAt = (s, dz, t) => { const P = placeOf(t); s.g.position.set(P.x, 0, P.z).add(offsetOf(dz)); s.g.rotation.y = P.yaw * D; };
const place = (s, pose) => { s.setPose(pose); s.g.updateMatrixWorld(true); };

// One performance: its keys (moves, look), whether film-kit's layers drive it, and every layer baked from its body pose
function actor({ moves, look, layered, dz, masked, part = SC }) {
  const M = layered && FX.hold > 0 ? phrase(moves, FX.hold) : moves;
  // a hesitant reach inside a clip: the clip (and every key after it) plays on a stretched clock (hesitate.ts stretch)
  const clock = masked && on.hesitate && SC.stretch ? SC.stretch.time : (t) => t;
  const poseOf = (key, s) => {
    if (key.clip) { const c = CLIPS[key.clip], x = (key.from ?? 0) + Math.max(0, s) * (key.rate ?? 1); return c.at(key.loop ? THREE.MathUtils.euclideanModulo(x, c.duration) : x); }
    return POSES[key.pose](layered && on.breath && key.pose !== "frenzy" ? 0 : Math.max(0, s));
  };
  const bodyAt = (tf) => {
    const t = clock(tf);
    const i = keyAt(M, t), a = M[i], b = M[Math.min(i + 1, M.length - 1)];
    let pose;
    const A = poseOf(a, t - a.t);
    if (b === a || t < a.t) pose = A;
    else {
      const B = poseOf(b, 0), k = (t - a.t) / (b.t - a.t);
      // a clip's turns are measured, not keyed angle by angle: blend them as turns (the film's slerpPose)
      if (a.clip || b.clip) pose = slerpPose(A, B, smooth(k));
      else if (!(layered && on.through)) pose = mixPose(A, B, smooth(k));
      else {
        const p = M[i - 1], n = M[i + 2], ok = (x) => x && !x.clip;
        pose = throughPose(ok(p) ? poseOf(p, t - p.t) : null, A, B, ok(n) ? poseOf(n, 0) : null, [p?.t ?? 0, a.t, b.t, n?.t ?? 0], t);
      }
    }
    const P = placeOf(tf);
    // layers add their offsets to this pose, so it is spelled the way they read it
    return canonical(P.speed > 0 ? addRigPose(pose, walkPose(P.dist, P.speed)) : pose);
  };
  const standingAt = (tf) => {
    const t = clock(tf);
    const i = keyAt(M, t), a = M[i], b = M[Math.min(i + 1, M.length - 1)];
    const k = b === a ? 0 : smooth((t - a.t) / (b.t - a.t));
    const s = (STANDING.has(a.pose) ? 1 - k : 0) + (STANDING.has(b.pose) ? k : 0);
    return s * (1 - Math.min(1, placeOf(tf).speed / 1.2));
  };
  // the head's look point and weight (null keys: the pose's own head), smoothstep or through the keys
  const keyLook = (t) => {
    if (!look.length || t < look[0].t) return null;
    const i = keyAt(look, t), a = look[i], b = look[Math.min(i + 1, look.length - 1)];
    const x = b === a ? 0 : smooth((t - a.t) / (b.t - a.t));
    if (a.at && !b.at) return { p: new THREE.Vector3(...a.at), w: 1 - x };
    if (!a.at && b.at) return { p: new THREE.Vector3(...b.at), w: x };
    if (!a.at) return null;
    const p = look[i - 1]?.at && look[i - 1], n = look[i + 2]?.at && look[i + 2];
    const v = [0, 1, 2].map((c) => (layered && on.through ? through(p ? p.at[c] : null, a.at[c], b.at[c], n ? n.at[c] : null, p?.t ?? 0, a.t, b.t, n?.t ?? 0, t) : THREE.MathUtils.lerp(a.at[c], b.at[c], x)));
    return { p: new THREE.Vector3(...v), w: 1 };
  };
  const ahead = layered && on.steer && SC.path && !look.length ? steer(placeOf) : null;
  const glance = notice(layered && on.notice ? SC.sights ?? [] : []);
  // set once the layers are baked: keys found from the hand's path (handeye), and how much of a look the head takes
  let handLook = () => null, headShare = () => 1;
  const under = (t) => {
    const T = SC.target?.(t);
    if (T && T.w > 0) return { p: new THREE.Vector3(...T.at), w: T.w };
    const A = ahead?.(t);
    if (A) return { p: new THREE.Vector3(...A.head), eye: new THREE.Vector3(...A.at), w: A.w };
    // the reach scene's right Steve has no look keys: all of his comes from his hand
    const K = SC.handLooks && layered && on.handeye ? null : keyLook(t);
    if (K) return K;
    const H = handLook(t);
    return H && { ...H, hw: H.w * headShare(t) };
  };
  // a glance blends over whatever else he looks at
  const lookAt = (t) => {
    const U = under(t), N = glance(t);
    if (!N || N.w <= 0) return U;
    const p = new THREE.Vector3(...N.at);
    if (!U) return { p, w: N.w };
    const hw = U.hw ?? U.w;
    return { p: U.p.clone().lerp(p, N.w), eye: (U.eye ?? U.p).clone().lerp(p, N.w), w: U.w + (1 - U.w) * N.w, hw: hw + (1 - hw) * N.w };
  };
  const A = { bodyAt, standingAt, lookAt, layered, dz, look };
  if (!layered) return A;

  // the game's own motion for this Steve (mc scene): where it is, airborne, alive. Dead, every layer that makes him alive
  // stops (breath, sway, eyes, blinks, touches): the mask goes to 0 when he starts to tip over
  const MCB = SC.mc && on.mc ? mcBody(AT0, SC.mc.events, { ground: 0, end: END }) : null;
  const alive = (t) => (MCB ? (MCB(t).roll > 0 ? 0 : 1) : 1);
  const w0 = masked && on.mask && SC.clips ? mask(SC.clips) : () => 1;
  const w = (t) => w0(t) * alive(t);
  // the eyes go for what the hand goes for, found in the hand's own path (IK keys or a clip): over a clip the actor's
  // head already does it, so there the keys move the eyes only. The path: the end of each hand in his own axes, posed by
  // the body and the right hand's IK target
  const handPath = (t, sd) => {
    placeAt(probe, 0, t);
    const p = bodyAt(t);
    place(probe, p);
    const h = sd === "R" && SC.hands && handLocal(t, on.arcs, on.reach);
    if (h) place(probe, blendPose(p, probe.armTo("R", new THREE.Vector3(...h.p).applyMatrix4(probe.g.matrixWorld)), h.w));
    return probe.g.worldToLocal(probe.bones[`la${sd}`].localToWorld(new THREE.Vector3().copy(HAND_END[sd]))).toArray();
  };
  const worldOf = (p, t) => { placeAt(probe, 0, t); return new THREE.Vector3(...p).applyMatrix4(probe.g.matrixWorld).toArray(); };
  const R = on.handeye ? ["L", "R"].flatMap((sd) => reaches((t) => handPath(t, sd), END, { rest: REST_END[sd], spans: SC.hands ? null : SC.reachClips ?? [] }).map((r) => ({ ...r, side: sd, at: worldOf(r.at, r.arrive) }))).sort((a, b) => a.start - b.start) : [];
  const HK = handEye(R);
  handLook = (t) => {
    if (!HK.length || t < HK[0].t) return null;
    const i = keyAt(HK, t), a = HK[i], b = HK[Math.min(i + 1, HK.length - 1)], x = b === a ? 0 : smooth((t - a.t) / (b.t - a.t));
    if (!a.at && !b.at) return null;
    if (!a.at || !b.at) return { p: new THREE.Vector3(...(a.at ?? b.at)), w: a.at ? 1 - x : x };
    return { p: new THREE.Vector3(...a.at).lerp(new THREE.Vector3(...b.at), x), w: 1 };
  };
  headShare = w;
  const still = freeze(on.freeze ? SC.freeze ?? [] : []);
  // fear's level for the tremor: the same rise and let-go as a freeze, over the scene's `tremble` spans
  const fear = freeze(on.tremor ? SC.tremble ?? [] : []);
  const shake = tremor(fear);
  const lagOf = overlap(bodyAt, END, FX.overlap);
  const toon = cartoon(bodyAt, END, FX.cartoon);
  const bangs = SC.bangs ?? [];
  // yawns (dropped whole where a fright's gasp would overlap one), sighs keyed and by themselves, the breath around them
  const Y = on.yawn ? yawns(part.yawns ?? [], { gasps: on.gasp ? bangs : [] }) : null;
  const clipAt = (t) => (SC.clips ?? []).some(([a, b]) => t >= a - 0.6 && t <= b + 0.6) && masked;
  const sighs = on.sigh ? [...(part.sighs ?? []), ...sighTimes(END, () => SIGH.rate.rest, { busy: (t) => clipAt(t) || placeOf(t).speed > 0.3 })] : [];
  const life = idle(bodyAt, END, { standing: standingAt, breath: +on.breath, sway: on.sway ? FX.idle.sway : 0, settle: on.settle ? FX.idle.settle : 0, gasps: on.gasp ? bangs : [], sighs, yawns: Y, freeze: still });
  // the body takes the face's emotion at its pace (faded over clips: a clip acts its own)
  const body = posture(part.face ?? SC.face ?? [], { kind: KIND });
  const tilt = lean((t) => placeOf(t), END);
  const jolt = startle(on.startle ? bangs : []);
  const unbalanced = (t) => {
    const k = w(t), amp = on.posture ? body.amp(t) : 1;
    let p = bodyAt(t);
    // the emotion's movement size scales what trails and settles after a move (sad smaller, angry bigger)
    if (on.overlap) p = addRigPose(p, scalePose(lagOf(t), k * amp));
    if (on.cartoon) p = addRigPose(p, scalePose(toon(t), k * amp));
    p = addRigPose(p, scalePose(life(t), k));
    if (on.lean) p = addRigPose(p, tilt(t));
    p = addRigPose(p, scalePose(FX.posture, k));
    if (on.posture) p = addRigPose(p, scalePose(body(t), k));
    return addRigPose(p, jolt(t).pose);
  };
  // where the joints put his centre of mass, hips held still (sway and sink are meant to move it), the reaching hand on
  // its target, against the rest pose's
  const comAt = (t) => {
    placeAt(probe, dz, t);
    const p = unbalanced(t);
    place(probe, { ...p, root: { ...p.root, x: 0, y: 0, z: 0 } });
    const h = SC.hands && handLocal(t, on.arcs, on.reach);
    if (h) place(probe, blendPose(p, probe.armTo("R", new THREE.Vector3(...h.p).applyMatrix4(probe.g.matrixWorld)), h.w));
    const c = comOf(probe);
    return [c.x - COM0.x, c.z - COM0.z];
  };
  const bal = on.balance ? balance(comAt, END, { standing: standingAt }) : () => ({ root: {} });
  const prePose = (t) => addRigPose(unbalanced(t), scalePose(bal(t), w(t)));
  // the turn the head would need from the trunk as it is, measured on the rig, for the trunk to take its share of
  const chain = attention((t) => {
    const L = lookAt(t);
    if (!L) return null;
    placeAt(probe, dz, t);
    place(probe, prePose(t));
    const [down, yaw] = probe.headTo(L.p.clone().add(offsetOf(dz)));
    return { down, yaw, w: L.hw ?? L.w };
  }, END);
  const trunkPose = (t) => (on.attention ? addRigPose(prePose(t), chain(t)) : prePose(t));
  const steadyHead = steady(trunkPose, END);
  const drift = micro({ amount: FX.micro.amount });
  const keyed = SC.handLooks && on.handeye ? [] : look;
  const shifts = keyed.slice(0, -1).filter((k, i) => JSON.stringify(k.at) !== JSON.stringify(keyed[i + 1].at)).map((k) => k.t);
  const handShifts = HK.slice(0, -1).filter((k, i) => JSON.stringify(k.at) !== JSON.stringify(HK[i + 1].at)).map((k) => k.t);
  // a glance at something sudden wins over looking away to think
  const glancing = (t) => glance.events.some((g) => g.looks && t >= g.t && t <= g.off + 0.45);
  const thinking = (t) => (on.think && !glancing(t) && (part.think ?? []).some(([a, b]) => t >= a && t <= b) ? 1 : 0);
  // blinks: few while his eyes are busy (the silverfish, a reach, frozen on a threat), more at the breaks after
  const pursuit = on.pursuit ? SC.pursuit ?? [] : [];
  const busy = (t) => pursuit.some(([a, b]) => t >= a && t <= b) || still(t) > 0.5 || R.some((r) => t >= r.start - HANDEYE.lead && t <= r.arrive);
  const breaks = [...shifts, ...handShifts, ...pursuit.map(([, b]) => b), ...(SC.freeze ?? []).map((f) => f.until + 0.5), ...life.stops.map((s) => s.t), ...R.map((r) => r.arrive), ...glance.events.filter((g) => g.looks).map((g) => g.off)];
  // sleepy blinks and lids while he wakes; quick wide looks around just after a scene or event starts
  const sleepy = drowsiness(on.drowsy ? SC.drowsy ?? [] : []);
  const lids = blinks(END, { rate: (t) => (busy(t) ? BLINKS.rate.focus : BLINKS.rate.rest), breaks, drowsy: sleepy, asleep: on.drowsy ? SC.asleep ?? [] : [], quiet: Y?.spans ?? [] });
  // his own face touches: only with that hand free (no clip, reach, walk, startle, fright's breath, yawn, freeze, death);
  // more while thinking; the film's keyed ones (a hand over a yawn) go where they are put
  const handBusy = (t, sd) => (sd === "R" && !!SC.hands && !!handLocal(t, false)) || R.some((r) => r.side === sd && t >= r.start - 0.3 && t <= r.arrive + 0.5);
  const free = (t, sd) => !clipAt(t) && !handBusy(t, sd) && placeOf(t).speed < 0.3 && !bangs.some((b) => t >= b.t - 0.3 && t <= b.t + 2.5)
    && !["gasp", "yawn"].includes(life.breath(t)) && still(t) < 0.3 && alive(t) > 0 && (!MCB || MCB(t).onGround);
  const touch = on.touch ? touches(END, { rate: (t) => (part.touchRate ?? TOUCH.rate) * (thinking(t) ? TOUCH.stress : 1), free, keys: part.touches ?? [] }) : () => null;
  const amb = explore(on.explore ? SC.explore ?? [] : []);
  const filmBlinks = (t) => [...Array(16)].some((_, i) => blinkAt(t - i / 30, SC.blinksFrom) > 0);
  const eyesAt = gaze([...shifts, ...handShifts, ...glance.shifts, ...(SC.shifts ?? [])], END, { mean: (t) => FX.gaze.mean * amb.mean(t), wander: (t) => FX.gaze.wander * amb.wander(t), slow: (t) => 1 + DROWSY.slow * sleepy(t), blinkedNear: on.blinks ? (t) => lids.near(t) : filmBlinks, pursuit, think: thinking, freeze: still });
  const nextKey = (x) => [...keyed, ...HK].map((k) => k.t).filter((k) => k > x).sort((a, b) => a - b)[0];
  // the face changes at each emotion's own pace (surprise fast, sadness slow, leaving slower than coming)
  const faceAt = on.express ? express(SC.face, { ...MOODS, ...FACES }) : (t) => moodAt(SC.face, t);
  return Object.assign(A, { w, lagOf, toon, life, tilt, jolt, bal, chain, trunkPose, steadyHead, drift, eyesAt, nextKey, still, lids, glance, reaches: R, busy, handPath, fear, shake, clock, sleepy, amb, faceAt, Y, body, touch, MCB, alive });
}

const Q = new THREE.Quaternion(), E = new THREE.Vector3(), V = new THREE.Vector3(), M4 = new THREE.Matrix4();
// right hand targets in his own axes; "rest" is where the end of the hand hangs (armTo puts that end on the target:
// 12 px up from the feet, under the elbow); the arc pivots on his right shoulder as it is posed at that moment
place(probe, {});
probe.g.position.set(0, 0, 0); probe.g.rotation.y = 0; probe.g.updateMatrixWorld(true);
const elbow0 = probe.bones.laR.getWorldPosition(new THREE.Vector3());
const REST_HAND = [elbow0.x, 12 * PX - 0.02, elbow0.z];
const handEnd = probe.bones.laR.worldToLocal(new THREE.Vector3(...REST_HAND)); // in the forearm's own frame
let SHOULDER_R = probe.bones.uaR.getWorldPosition(new THREE.Vector3()).toArray();
// human: film-kit's reach timing (a bell at the hand's own pace, a small corrective move) and, on a key with `doubt`,
// hesitation; otherwise the film's smoothstep across the whole gap
const handLocal = (t, arcs, human = false) => {
  const HK = SC.hands ?? [];
  if (!HK.length || t < HK[0].t) return null;
  const i = keyAt(HK, t), a = HK[i], b = HK[Math.min(i + 1, HK.length - 1)], P = (r) => (r === "rest" ? REST_HAND : r);
  const dist = a.R && b.R ? Math.hypot(...P(a.R).map((v, j) => v - P(b.R)[j])) : 0;
  const k = b === a ? 0 : !human || !a.R || !b.R ? smooth((t - a.t) / (b.t - a.t))
    : b.doubt && on.hesitate ? hesitation(b.t - a.t, b.doubt)(t - a.t) : reachK(t, a.t, b.t, { dist });
  if (!a.R && !b.R) return null;
  if (a.R && (!b.R || b === a)) return { p: P(a.R), w: b === a ? 1 : 1 - k };
  if (!a.R) return { p: P(b.R), w: k };
  const pa = P(a.R), pb = P(b.R);
  return { p: arcs ? arc(SHOULDER_R, pa, pb, k, { bend: [0, 0, 1] }) : pa.map((v, j) => v + (pb[j] - v) * k), w: 1 };
};

// the body's centre of mass on a posed rig, in its own axes: Winter's segment masses at each segment's middle
const P1 = new THREE.Vector3(), P2 = new THREE.Vector3(), C = new THREE.Vector3();
function comOf(s) {
  const b = s.bones, at = (bone, v = P1) => s.g.worldToLocal(bone.getWorldPosition(v));
  C.set(0, 0, 0);
  const add = (v, m) => C.addScaledVector(v, m);
  add(at(b.head).add(V.set(0, 4 * PX, 0)), WINTER.head);
  add(at(b.body).add(at(b.head, P2)).multiplyScalar(0.5), WINTER.trunk);
  for (const sd of ["L", "R"]) {
    add(at(b[`ua${sd}`]).add(at(b[`la${sd}`], P2)).multiplyScalar(0.5), WINTER.upperArm);
    add(at(b[`la${sd}`]).add(s.g.worldToLocal(b[`la${sd}`].localToWorld(P2.copy(HAND_END[sd])))).multiplyScalar(0.5), WINTER.forearmHand);
    add(at(b[`ul${sd}`]).add(at(b[`ll${sd}`], P2)).multiplyScalar(0.5), WINTER.thigh);
    add(at(b[`ll${sd}`]).add(s.g.worldToLocal(s.soleAt(sd, P2))).multiplyScalar(0.5), WINTER.legFoot);
  }
  return C.clone();
}
place(probe, {});
probe.g.position.set(0, 0, 0); probe.g.rotation.y = 0; probe.g.updateMatrixWorld(true);
// the end of each hand at rest (12 px up from the feet, under the elbow), in its forearm's frame
const HAND_END = Object.fromEntries(["L", "R"].map((sd) => { const e = probe.bones[`la${sd}`].getWorldPosition(new THREE.Vector3()); return [sd, probe.bones[`la${sd}`].worldToLocal(new THREE.Vector3(e.x, 12 * PX - 0.02, e.z))]; }));
const COM0 = comOf(probe);
// where each hand's end hangs at rest, in his own axes (a reach ends away from here)
const REST_END = Object.fromEntries(["L", "R"].map((sd) => [sd, probe.g.worldToLocal(probe.bones[`la${sd}`].localToWorld(HAND_END[sd].clone())).toArray()]));

// ---- Minecraft motion (mc scene) ----
// the left Steve: the same beats keyed the usual way (smoothstep slides and hops, a smoothstep tip-over)
const keyedMc = (t) => {
  let x = 0, y = 0, z = 0, roll = 0, red = false, gone = false;
  for (const e of SC.mc?.events ?? []) {
    const u = t - e.t;
    if (u < 0) continue;
    if (e.hit || e.from) {
      const [fx, fz] = e.from ?? [e.hit[0] - AT0[0], e.hit[1] - AT0[2]], d = Math.hypot(fx, fz) || 1, k = smooth(u / 0.6);
      x -= (fx / d) * 1.5 * k; z -= (fz / d) * 1.5 * k;
      y += u < 0.6 ? 0.5 * Math.sin(Math.PI * smooth(u / 0.6)) : 0;
      red = red || u < MC.hurt / TPS;
    }
    if (e.jump && u < 0.8) y += 1.25 * Math.sin(Math.PI * smooth(u / 0.8));
    if (e.die) { roll = 90 * smooth(u / 1); red = true; gone = u >= 1; }
  }
  return { p: [AT0[0] + x, y, AT0[2] + z], roll, red, gone, puff: -1, onGround: y < 1e-3 };
};
const things = (SC.mc?.things ?? []).map(([kind, t0, p0, v0, color]) => {
  const m = new THREE.Mesh(kind === "arrow" ? new THREE.BoxGeometry(0.06, 0.06, 0.5) : new THREE.BoxGeometry(...(kind === "block" ? [1, 1, 1] : [0.25, 0.25, 0.25])), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
  scene.add(m);
  return { kind, t0, m, path: fly(kind, p0, v0, { t0, ground: 0 }) };
});
const placeThings = (t) => {
  for (const th of things) {
    th.m.visible = t >= th.t0;
    if (!th.m.visible) continue;
    const p = th.path(t).p, size = th.kind === "block" ? 0.5 : th.kind === "item" ? 0.125 : 0;
    th.m.position.set(p[0], p[1] + size, p[2]);
    // an item turns slowly as it flies (the game spins dropped items); an arrow points where it flies
    if (th.kind === "item") th.m.rotation.y = (t - th.t0) * 2;
    if (th.kind === "arrow") { const a = th.path(t - 0.05).p; if (Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]) > 1e-4) th.m.lookAt(p[0] + (p[0] - a[0]), p[1] + (p[1] - a[1]), p[2] + (p[2] - a[2])); }
  }
};
// the death puff: the game spawns 20 poof particles; here 20 small white cubes drift out and fade over 0.6 s
const PUFF = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: 0xf2f2f2, transparent: true }), 40);
scene.add(PUFF);
const hashD = (n, k) => { const x = Math.sin(n * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };

// ---- cast ----
const SIDE = 0.8;
const MOCAP = NAME === "mocap" || NAME === "lifeMocap";
const cast = [];
for (const [name, dz] of [["old", -SIDE], ["new", SIDE]]) {
  const s = await makePlayer(rig, "vendor/steve.png", { glow: 0.05 });
  scene.add(s.g);
  place(s, {});
  const restHead = s.bones.head.getWorldQuaternion(new THREE.Quaternion()).invert();
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.03), new THREE.MeshBasicMaterial({ color: name === "old" ? 0xff8060 : 0x60e0a0 }));
  scene.add(dot);
  const trail = new THREE.InstancedMesh(new THREE.SphereGeometry(0.012), new THREE.MeshBasicMaterial({ color: name === "old" ? 0xff8060 : 0x60e0a0 }), 46);
  scene.add(trail);
  const spec = MOCAP
    ? name === "old" ? { moves: SC.authored.moves, look: SC.authored.look, layered: true, part: { ...SC, ...SC.authored } } : { moves: SC.moves, look: SC.look, layered: true, masked: true }
    : { moves: SC.moves, look: SC.look, layered: name === "new" };
  const bug = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.1), new THREE.MeshStandardMaterial({ color: 0x8c8f93, roughness: 0.9 }));
  bug.visible = false;
  scene.add(bug);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), new THREE.MeshStandardMaterial({ color: 0xd8c27a, emissive: 0x4a3c10 }));
  sight.visible = false;
  scene.add(sight);
  cast.push({ name, s, dz, restHead, dot, trail, bug, sight, act: actor({ ...spec, dz }) });
}
// steps where the right Steve's soles land (walk and mc scenes), from his body pose over time; every floor here is stone
const soleOf = (c, sd, t) => {
  placeAt(probe, c.dz, t);
  const m = c.act.MCB?.(t);
  if (m) { probe.g.position.x += m.p[0] - AT0[0]; probe.g.position.y += m.p[1]; probe.g.position.z += m.p[2] - AT0[2]; }
  place(probe, c.act.bodyAt(t));
  return probe.soleAt(sd, new THREE.Vector3()).toArray();
};
const STEPS = on.steps && (SC.path || SC.mc) ? stepSounds(contacts({ L: (t) => soleOf(cast[1], "L", t), R: (t) => soleOf(cast[1], "R", t) }, END, { ground: 0 }), () => "stone") : [];
const marks = STEPS.map(() => { const m = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.13, 20), new THREE.MeshBasicMaterial({ color: 0x60e0a0, transparent: true, side: THREE.DoubleSide })); m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m); return m; });
let audio = null, heard = -1;
// a short noise burst per step while playing at 1x (only to hear the timing; a film plays its CC0 step recordings)
const click = (s) => {
  if (!audio) return;
  const n = audio.sampleRate * 0.08, buf = audio.createBuffer(1, n, audio.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
  const src = audio.createBufferSource(), f = audio.createBiquadFilter(), g = audio.createGain();
  src.buffer = buf; f.type = "bandpass"; f.frequency.value = 900 * s.pitch; g.gain.value = s.volume * 5;
  src.connect(f).connect(g).connect(audio.destination); src.start();
};

document.getElementById("old").textContent = MOCAP ? "Left: hand-made keys + film-kit layers (no Mixamo)" : "Before: the film now (smoothstep keys, breathing per pose, eyes fixed)";
document.getElementById("new").textContent = MOCAP ? `Right: Mixamo clips (layers ${on.mask ? "fade out over each clip" : "NOT faded: doubled"})` : `After: film-kit layers${MOODNAME === "calm" ? "" : `, mood ${MOODNAME}`}`;

// a world point from his eyes, in the posed head's own axes
const gazeTo = (c, p) => {
  c.s.bones.head.getWorldQuaternion(Q).multiply(c.restHead);
  c.s.bones.head.getWorldPosition(E).add(V.set(0, 4 * PX, 4 * PX).applyQuaternion(Q));
  return anglesOf(V.copy(p).sub(E).applyQuaternion(Q.invert()).toArray());
};
// the same from his body's front at time f, head straight, eyes at standing height: steady while the head turns
const EYE_Y = 1.62;
const bodyTo = (c, p, f) => {
  const P = placeOf(f), e = new THREE.Vector3(P.x, EYE_Y, P.z).add(offsetOf(c.dz));
  return anglesOf(new THREE.Vector3().copy(p).sub(e).applyAxisAngle(new THREE.Vector3(0, 1, 0), -P.yaw * D).toArray());
};
const soles = { L: new THREE.Vector3(), R: new THREE.Vector3() };
const perform = (c, t) => {
  const A = c.act;
  placeAt(c.s, c.dz, t);
  // the game's motion moves the whole body: knocked back, jumping, tipping over (about his feet, onto his left side)
  const mcb = SC.mc ? (A.MCB ? A.MCB(t) : keyedMc(t)) : null;
  c.mcb = mcb;
  if (mcb) {
    c.s.g.position.x += mcb.p[0] - AT0[0]; c.s.g.position.y += mcb.p[1]; c.s.g.position.z += mcb.p[2] - AT0[2];
    c.s.g.rotation.set(0, c.s.g.rotation.y, -mcb.roll * D, "YXZ");
    c.s.g.visible = !mcb.gone;
    c.s.red(on.mc && mcb.red);
  }
  const stand = A.layered ? A.standingAt(t) * (mcb && !mcb.onGround ? 0 : 1) * (A.alive?.(t) ?? 1) : 0;
  if (stand > 0) { place(c.s, A.bodyAt(t)); c.s.soleAt("L", soles.L); c.s.soleAt("R", soles.R); }
  let pose = A.layered ? A.trunkPose(t) : A.bodyAt(t);
  place(c.s, pose);
  // planted soles stay where the pose put them while the hips sway and sink over them
  if (stand > 0) { for (const sd of ["L", "R"]) pose = blendPose(pose, c.s.legTo(sd, soles[sd]), stand); place(c.s, pose); }
  const shift = offsetOf(c.dz);
  const look = A.lookAt(t);
  if (look) {
    // a look given to the eyes only (a clip's own head) still turns the head by what the eyes can't cover
    let hw = look.hw ?? look.w;
    if (hw < look.w) {
      const a = gazeTo(c, (look.eye ?? look.p).clone().add(shift));
      if (a) hw = Math.max(hw, look.w * Math.max(0, 1 - (0.6 * EYE.yaw) / Math.max(1e-6, Math.abs(a[0])), 1 - (0.6 * EYE.pitch) / Math.max(1e-6, Math.abs(a[1] - REST_PITCH))));
    }
    pose = blendPose(pose, { head: c.s.headTo(look.p.clone().add(shift)) }, hw);
    place(c.s, pose);
  }
  c.dot.visible = !!look && look.w > 0.5 && !view().startsWith("face");
  if (look) c.dot.position.copy(look.p).add(shift);
  const k = A.layered ? A.w(t) : 0;
  c.steadyNow = [0, 0];
  if (A.layered) {
    if (on.steady) { const h = A.steadyHead(t).head; c.steadyNow = [h[0] * (1 - (look?.w ?? 0)) * k, h[2] * k]; pose = addRigPose(pose, { head: [c.steadyNow[0], 0, c.steadyNow[1]] }); }
    if (on.noise) pose = addRigPose(pose, scalePose(A.drift(t), k * (1 - FREEZE.drift * A.still(t)) * (on.posture ? A.body.amp(t) : 1)));
    // a yawn tips the head back after the look's aim (a look holds the head on its target otherwise); faded over a clip
    // that is itself a yawn
    if (A.Y) pose = addRigPose(pose, scalePose(yawnPose(A.Y(t)), k));
    place(c.s, pose);
  }
  // a hand to his own face: the spot rides the head as it is posed now
  c.touchNow = A.layered ? A.touch(t) : null;
  if (c.touchNow && c.touchNow.w > 0) {
    c.s.bones.head.getWorldQuaternion(Q).multiply(c.restHead);
    const target = c.s.bones.head.getWorldPosition(new THREE.Vector3()).add(V.set(...c.touchNow.at).multiplyScalar(PX).applyQuaternion(Q));
    // the elbow hangs down, a little out and forward, as a hand comes up to the face
    const arm = c.s.armTo(c.touchNow.side, target, [c.touchNow.side === "L" ? 0.5 : -0.5, -1, 0.3]);
    // turned the short way (the arm's big twist, lerped as angles, swings the hand far out in front on its way up), the
    // elbow folding ahead of the shoulder so the hand comes up close to the chest
    const w = c.touchNow.w, sd = c.touchNow.side, ua = `ua${sd}`, la = `la${sd}`;
    const up = slerpPose({ [ua]: pose[ua] ?? [0, 0, 0] }, { [ua]: arm[ua] }, w)[ua];
    const fold = slerpPose({ [la]: pose[la] ?? [0, 0, 0] }, { [la]: arm[la] }, Math.min(1, w * 1.8))[la];
    pose = { ...pose, [ua]: up, [la]: fold };
    place(c.s, pose);
  }
  // the right hand on its target, straight or on its arc; the target's path over the last 1.5 s as dots
  const arcs = A.layered && on.arcs;
  SHOULDER_R = c.s.g.worldToLocal(c.s.bones.uaR.getWorldPosition(V)).toArray();
  const hand = handLocal(t, arcs, A.layered && on.reach);
  c.handErr = null;
  if (hand) {
    const target = new THREE.Vector3(...hand.p).applyMatrix4(c.s.g.matrixWorld);
    pose = blendPose(pose, c.s.armTo("R", target), hand.w);
    place(c.s, pose);
    c.handErr = c.s.bones.laR.localToWorld(V.copy(handEnd)).distanceTo(target) * (hand.w > 0.99 ? 1 : 0);
  }
  // fear's tremor last, on top of keyed arms, IK hands and clips alike
  if (A.layered && on.tremor && A.fear(t) > 0) { pose = addRigPose(pose, A.shake(t)); place(c.s, pose); }
  c.trail.visible = !!SC.hands;
  if (SC.hands) for (let i = 0; i < 46; i++) {
    const h = handLocal(t - i / 30, arcs, A.layered && on.reach), p = h ? new THREE.Vector3(...h.p).applyMatrix4(c.s.g.matrixWorld) : new THREE.Vector3(0, -10, 0);
    c.trail.setMatrixAt(i, M4.makeTranslation(p.x, p.y, p.z));
  }
  c.trail.instanceMatrix.needsUpdate = true;
  // face: eyes on fixations that lead the head, blinks, lids that follow the eyes
  let eyes = [0, -0.15], extra = 0, lid = 0;
  const dead = A.layered && (A.alive?.(t) ?? 1) === 0;
  if (A.layered && on.gaze && !dead) {
    // a pursuit reads the silverfish where it is at f; a thinking look-away is added in full, wander near a target a third
    const g = A.eyesAt(t, (f, o, mode, body) => {
      const L = mode === "pursue" && SC.bug ? { p: new THREE.Vector3(...SC.bug(f)), w: 1 } : A.lookAt(eyeTime(f, A.nextKey));
      const p = L && L.w > 0.5 && (L.eye ?? L.p).clone().add(shift);
      const a = p && (body ? bodyTo(c, p, f) : gazeTo(c, p)), s = mode === "avert" ? 1 : 1 / 3;
      return a ? [a[0] + o[0] * s, a[1] + o[1] * s] : [o[0], REST_PITCH + o[1]];
    });
    eyes = g.look;
    extra = g.blink;
    lid = on.lids ? g.lid : 0;
    c.pursuing = g.pursuing;
    c.thinking = g.thinking;
  }
  if (A.layered && !dead) extra = Math.max(extra, A.jolt(t).blink, on.blinks ? A.lids(t) : 0);
  // what he may notice: a small block that pops up for a moment where each sight is
  c.sight.visible = !!(SC.sights ?? []).find((g) => t >= g.t && t < g.t + 0.5);
  if (c.sight.visible) c.sight.position.fromArray((SC.sights ?? []).find((g) => t >= g.t && t < g.t + 0.5).at).add(shift);
  if (c.bug) { c.bug.visible = !!SC.bug && t > 1 && t < 6.5; if (SC.bug) c.bug.position.fromArray(SC.bug(t)).add(shift); }
  const y = A.layered && A.Y ? A.Y(t) : null;
  c.yawnNow = y;
  const blink = Math.max(A.layered && on.blinks ? 0 : blinkAt(t, SC.blinksFrom), extra, y?.lids ?? 0);
  const mood = A.layered ? A.faceAt(t) : moodAt(SC.face, t);
  // a yawn: brows up at the acme, the mouth gaping, a smile or frown let go while it does
  let mouth = mouthAt([], 0);
  if (y) { mood.y += (0.75 - mood.y) * y.brow; mood.tilt *= 1 - y.brow; mood.smile *= 1 - y.gape; mouth = [2 + 0.6 * y.gape, 1.9 * y.gape, 0.3 * y.gape, 0.8 * y.gape]; }
  mood.open = Math.min(1, Math.max(0, mood.open + lidOpen(lid) - (A.layered && on.drowsy ? A.lids.droop(t) : 0)));
  c.s.face(mood, mouth, blink, eyes);
  Object.assign(c, { eyes, blink, lid, look, stand, k });
};

// ---- camera ----
const view = () => q.get("view") ?? (NAME === "walk" || NAME === "reach" ? "side" : "both");
const H0 = new THREE.Vector3();
const frame = (t) => {
  const v = view();
  camera.up.set(0, 1, 0);
  // a body the game has removed (gone after dying) stays hidden in every view
  for (const o of cast) o.s.g.visible = !o.mcb?.gone;
  const P = placeOf(t), x0 = P.x, z0 = P.z;
  // Minecraft motion: far enough back to hold a 1.25-block jump and the knockback slides
  if (v === "both" && NAME === "mc") { camera.fov = 30; camera.position.set(x0 - 12.5, 2.4, z0 + 3.6); camera.lookAt(x0, 0.45, z0 + 3.6); }
  else if (v === "both") { camera.fov = 30; camera.position.set(x0 - 6.4, 1.3, z0); camera.lookAt(x0, 0.6 + (MOCAP ? 0.3 : 0), z0); }
  if (v === "side") {
    camera.fov = 30;
    if (NAME === "reach") { camera.position.set(x0 - 3.4, 1.7, z0 - 4.6); camera.lookAt(x0 - 0.3, 1.1, z0 - 0.2); }
    else if (NAME === "walk") { camera.position.set(x0 - 0.6, 1.4, AT0[2] - 7.5); camera.lookAt(x0, 1.1, AT0[2] + 0.3); }
    else { camera.position.set(x0 - 3.5, 2.4, z0 + 3.35); camera.lookAt(x0 - 0.2, 0.6, z0); }
  }
  if (v === "face" || v === "faceOld") {
    // in front of the face, wherever it points: rest axes (z forward, y up) turned by the head
    const c = cast[v === "face" ? 1 : 0];
    c.s.bones.head.getWorldQuaternion(Q).multiply(c.restHead);
    c.s.bones.head.getWorldPosition(H0).add(V.set(0, 4 * PX, 2 * PX).applyQuaternion(Q));
    camera.fov = 30;
    camera.position.copy(H0).add(V.set(0, 0.08, 0.8).applyQuaternion(Q));
    camera.up.set(0, 1, 0).applyQuaternion(Q);
    camera.lookAt(H0);
    for (const o of cast) o.s.g.visible = o === c && !o.mcb?.gone;
  }
  if (v === "bust") {
    // head and hands of the right Steve, a little off his front, following him
    cast[1].s.bones.head.getWorldPosition(H0);
    const y = cast[1].s.g.rotation.y, fx = Math.sin(y), fz = Math.cos(y);
    camera.fov = 30;
    camera.position.set(H0.x + 4.6 * fx + 1.2 * fz, H0.y - 0.2, H0.z + 4.6 * fz - 1.2 * fx);
    // aimed past him and low, so his head and hands sit left of the status box and above the controls
    camera.lookAt(H0.x + 0.7 * fz, H0.y - 0.4, H0.z - 0.7 * fx);
  }
  camera.updateProjectionMatrix();
};

// what the right Steve's automatic layers are doing now (in the mocap scene: both)
const info = document.getElementById("info");
const status = (t) => {
  const lines = [];
  for (const c of MOCAP ? cast : [cast[1]]) {
    const A = c.act;
    if (!A.layered) continue;
    if (MOCAP) lines.push(c.name === "old" ? "LEFT (keys)" : "RIGHT (Mixamo)");
    const e = A.life.effort(t), wt = A.life(t).root.x / 0.035, k = c.k;
    if (MOCAP && k < 0.99) lines.push(`clip: body layers ${((1 - k) * 100).toFixed(0)}% faded out`);
    if (on.breath && k > 0.01) lines.push(`breath ${Math.round(60 * (0.25 + 0.42 * e))}/min, effort ${(e * 100).toFixed(0)}%`);
    if (on.sway && Math.abs(wt * k) > 0.05) lines.push(`weight on his ${wt > 0 ? "left" : "right"} leg ${(Math.abs(wt * k) * 100).toFixed(0)}%`);
    if (on.settle && k > 0.5 && A.life.stops.some((s) => t > s.t && t < s.t + 0.9)) lines.push("settling after a stop");
    if (on.lean && (Math.abs(A.tilt.forward(t)) > 0.3 || Math.abs(A.tilt.left(t)) > 0.3)) lines.push(`lean ${A.tilt.forward(t) > 0 ? "forward" : "back"} ${Math.abs(A.tilt.forward(t)).toFixed(1)}°, into turn ${A.tilt.left(t).toFixed(1)}°`);
    const ch = A.chain(t).chest;
    if (on.attention && Math.hypot(ch[0], ch[1]) > 0.3) lines.push(`chest joins the look: ${ch[1].toFixed(1)}° turn, ${ch[0].toFixed(1)}° down`);
    if (on.steady && Math.hypot(...c.steadyNow) > 0.3) lines.push(`head steadies ${c.steadyNow[0].toFixed(1)}° pitch, ${c.steadyNow[1].toFixed(1)}° roll`);
    const J = A.jolt.events.find((e) => t >= e.t && t < e.t + 1.5);
    if (J) lines.push(`startle ${(t - J.t).toFixed(2)} s in: ${t - J.t < 0.09 ? "eyes shut" : t - J.t < 0.14 ? "head jerks" : t - J.t < 0.2 ? "arms pull in" : "trunk and knees give"}${J.body < J.k * 0.99 ? `, body ${((J.body / J.k) * 100).toFixed(0)}% (repeat)` : ""}`);
    const G = A.life.gasp(t);
    if (G && on.gasp && k > 0.01) lines.push(G === "in" ? "gasp: sharp breath in" : G === "held" ? "breath held" : "relief: long breath out, shoulders drop");
    if (c.pursuing) lines.push("eyes glide after the silverfish (pursuit)");
    const fz = A.still(t);
    if (fz > 0.05) lines.push(`frozen in fear ${(fz * 100).toFixed(0)}%: sway and drift down, eyes held`);
    const G2 = A.glance.events.find((g) => t >= g.t && t < g.off + 0.45);
    if (G2) lines.push(G2.looks ? `notices something at the edge of view (pull ${(G2.pull * 100).toFixed(0)}%)` : `something moves; no glance this time (pull ${(G2.pull * 100).toFixed(0)}%: seen it before)`);
    const RR = A.reaches.find((r) => t >= r.start - 0.8 && t <= r.arrive + 0.5);
    if (on.handeye && RR) lines.push(`${t < RR.start ? "eyes on the target before the hand moves" : t < RR.arrive - 0.16 ? "hand travels, eyes stay on the target" : "eyes leave just before the hand lands"}${A.w(t) < 0.5 ? " (clip: eyes only)" : ""}`);
    const am = on.explore ? A.amb(t) : 0;
    if (am > 0.02) lines.push(`looking around a new place ${(am * 100).toFixed(0)}%: quick, wide eye jumps (ambient), settling on things (focal)`);
    const dz2 = on.drowsy ? A.sleepy(t) : 0, asleep = on.drowsy && (SC.asleep ?? []).some(([a, b]) => t >= a && t < b);
    if (asleep) lines.push("asleep: lids shut");
    else if (dz2 > 0.02) { const S = A.lids.shapes[A.lids.times.findLastIndex((b) => b <= t)]; lines.push(`drowsy ${(dz2 * 100).toFixed(0)}%: lids low, slow eye jumps${S && c.blink > 0.05 ? `, ${S.shut >= 0.5 ? "long closure" : S.depth < 1 ? "partial blink" : "slow blink"} (${(S.down + S.shut + S.up).toFixed(2)} s)` : ""}`); }
    const FK = SC.face ?? [], fi = FK.findLastIndex((f) => f.t <= t);
    if (on.express && fi > 0) { const T = changeTime(FK[fi - 1].mood, FK[fi].mood, KIND); if (t < FK[fi].t + T) lines.push(`face ${FK[fi - 1].mood} -> ${FK[fi].mood} over ${T.toFixed(2)} s (${KIND[FK[fi].mood] ? `${KIND[FK[fi].mood]} onset` : KIND[FK[fi - 1].mood] ? `${KIND[FK[fi - 1].mood]} offset` : "calm"})${KIND[FK[fi].mood] === "fear" ? ": brows, then mouth, then eyes" : ""}`); }
    if (on.blinks) lines.push(`blink rate ${A.busy(t) ? `${BLINKS.rate.focus}/min (eyes busy)` : `${BLINKS.rate.rest}/min`}`);
    if (c.thinking) lines.push("thinking: eyes look away");
    const bz = A.bal(t).root;
    if (on.balance && Math.hypot(bz.x ?? 0, bz.z ?? 0) > 0.005) lines.push(`hips counter the mass: ${((bz.z ?? 0) * 100).toFixed(1)} cm ${(bz.z ?? 0) < 0 ? "back" : "forward"}, ${((bz.x ?? 0) * 100).toFixed(1)} cm left`);
    if (on.gaze && c.blink > 0.05 && !c.yawnNow) lines.push("blink");
    if (on.gaze) lines.push(`eyes ${c.eyes.map((v) => v.toFixed(2)).join(" ")}${on.lids ? `, lids ${c.lid.toFixed(2)}` : ""}`);
    const tr = on.tremor ? A.fear(t) : 0;
    if (tr > 0.05) lines.push(`hands tremble with fear ${(tr * 100).toFixed(0)}% (8-9 Hz, in runs)`);
    const HKs = SC.hands ?? [], hi = HKs.findIndex((h, i) => i > 0 && h.t > t);
    if (c.name === "new" && !MOCAP && on.reach && hi > 0 && HKs[hi].R && HKs[hi - 1].R) {
      const a = HKs[hi - 1], b = HKs[hi], P = (r) => (r === "rest" ? REST_HAND : r);
      const d = Math.hypot(...P(a.R).map((v, j) => v - P(b.R)[j]));
      if (d > 0.02) lines.push(b.doubt && on.hesitate ? `hesitant reach (doubt ${b.doubt}): late start, stops part way, draws back, commits` : `reach at his own pace: ${fitts(d).toFixed(2)} s for ${(d * 100).toFixed(0)} cm (Fitts), one bell + a small correction`);
    }
    if (MOCAP && c.name === "new" && on.hesitate && SC.stretch && t > SC.stretch.start && t < SC.stretch.end) lines.push(`hesitant press: the clip slows, stops, draws back, then goes (+${SC.stretch.extra.toFixed(2)} s)`);
    if (c.handErr != null) lines.push(`hand ${(c.handErr * 100).toFixed(1)} cm off its target`);
    const Yn = c.yawnNow;
    if (Yn) lines.push(`yawn (${Yn.phase}): ${Yn.phase === "in" ? "slow deep breath in, jaw opening, eyes narrowing" : Yn.phase === "acme" ? "mouth widest, eyes squeezed shut, brows up, neck back" : Yn.phase === "out" ? "quick breath out, everything lets go" : "a pause in breathing"}; no blinks`);
    const Bk = A.life.breath(t);
    if (Bk === "sigh" && k > 0.01) lines.push("sigh: a normal breath, a second one on top, a long breath out (shoulders drop)");
    const fm = KIND[(SC.face ?? []).findLast((f) => f.t <= t)?.mood];
    if (on.posture && fm && POSTURE.shape[fm] && k > 0.01) lines.push(`posture: ${fm}${fm === "sadness" ? ", the head hangs" : fm === "joy" ? ", head up" : fm === "fear" ? ", elbows in, knees give" : fm === "anger" ? ", elbows bent, head a little down" : ""}; follow-through and drift x${A.body.amp(t).toFixed(2)}`);
    if (c.touchNow) lines.push(`hand (${c.touchNow.side}) to his ${c.touchNow.spot}${c.thinking ? ` (thinking: touches x${TOUCH.stress})` : ""}`);
    const mb = c.mcb;
    if (mb && on.mc) {
      const hit = SC.mc.events.find((e) => (e.hit || e.from) && t >= e.t && t < e.t + 1.2), dieE = SC.mc.events.find((e) => e.die);
      if (mb.gone) lines.push("gone: white smoke puff (20 ticks after death)");
      else if (mb.roll > 0) lines.push(`dying: red, tipping onto his left side ${mb.roll.toFixed(0)}° (game formula)`);
      else if (hit) lines.push(`hit: knocked back (game knockback 0.4)${mb.red ? ", red (10 ticks)" : ""}${!mb.onGround ? `, ${mb.p[1].toFixed(2)} m up` : ""}`);
      else if (!mb.onGround) lines.push(`jump: ${mb.p[1].toFixed(2)} m up (game: 1.25 peak, 12 ticks)`);
    }
    const S1 = c.name === "new" ? STEPS.findLast((s) => t >= s.t && t < s.t + 0.4) : null;
    if (S1) lines.push(`step ${S1.foot}: ${S1.event} vol ${S1.volume.toFixed(2)} pitch ${S1.pitch.toFixed(2)}, variant ${S1.variant}`);
  }
  if (!MOCAP && cast[0].handErr != null) lines.push(`(left hand ${(cast[0].handErr * 100).toFixed(1)} cm off)`);
  if (MOODNAME !== "calm") lines.push(`mood ${MOODNAME}: holds ${(FX.hold * 100).toFixed(0)}% of each move, then goes`);
  info.textContent = lines.join("\n");
};

const clock = document.getElementById("clock"), slider = document.getElementById("t");
slider.min = FROM; slider.max = TO; slider.step = 1 / 30;
let t = q.has("t") ? +q.get("t") : FROM, playing = !q.has("t"), speed = 1, last = performance.now();
const draw = (tt) => {
  t = tt;
  for (const c of cast) perform(c, t);
  placeThings(t);
  // the puff where the right Steve was when he went
  const pc = cast.find((c) => c.mcb && c.mcb.gone);
  PUFF.visible = !!pc;
  if (pc) {
    const u = pc.mcb.puff >= 0 ? pc.mcb.puff : t - (SC.mc.events.find((e) => e.die).t + 1);
    PUFF.material.opacity = Math.max(0, 1 - u / 0.6);
    for (let i = 0; i < 40; i++) {
      const a = 2 * Math.PI * hashD(i, 1), r = 0.15 + 0.5 * hashD(i, 2) * Math.min(1, u / 0.6), h = 0.2 + 1.4 * hashD(i, 3);
      PUFF.setMatrixAt(i, M4.makeTranslation(pc.s.g.position.x + r * Math.cos(a), h + 0.4 * u, pc.s.g.position.z + r * Math.sin(a)));
    }
    PUFF.instanceMatrix.needsUpdate = true;
  }
  STEPS.forEach((s, i) => { const u = t - s.t; marks[i].visible = u >= 0 && u < 0.4; if (marks[i].visible) { marks[i].position.set(s.at[0] + offsetOf(cast[1].dz).x, 0.01, s.at[2] + offsetOf(cast[1].dz).z); marks[i].material.opacity = 1 - u / 0.4; } });
  if (playing && speed === 1) for (const s of STEPS) if (s.t > heard && s.t <= t) click(s);
  heard = t;
  frame(t);
  renderer.render(scene, camera);
  status(t);
  const m = Math.floor(t / 60), s = (t - m * 60).toFixed(3).padStart(6, "0");
  clock.textContent = `${String(m).padStart(2, "0")}:${s}`;
  slider.value = t;
};
const loop = (now) => {
  if (playing) { t += ((now - last) / 1000) * speed; if (t > TO) t = FROM; }
  last = now;
  draw(t);
  requestAnimationFrame(loop);
};
const go = (k, v) => { q.set(k, v); q.delete("t"); location.search = q.toString(); };
slider.oninput = () => { playing = false; draw(+slider.value); };
document.getElementById("play").onclick = () => { playing = !playing; audio ??= new AudioContext(); };
for (const b of document.querySelectorAll("[data-speed]")) b.onclick = () => { speed = +b.dataset.speed; };
for (const b of document.querySelectorAll("[data-view]")) b.onclick = () => { q.set("view", b.dataset.view); };
for (const b of document.querySelectorAll("[data-scene]")) { b.onclick = () => go("scene", b.dataset.scene); b.setAttribute("aria-pressed", String(b.dataset.scene === NAME)); }
for (const b of document.querySelectorAll("[data-mood]")) { b.onclick = () => go("mood", b.dataset.mood); b.setAttribute("aria-pressed", String(b.dataset.mood === MOODNAME)); }
const toggles = document.getElementById("layers");
for (const k of LAYERS) {
  const l = document.createElement("label");
  l.innerHTML = `<input type="checkbox" ${on[k] ? "checked" : ""}> ${k}`;
  l.querySelector("input").onchange = () => go("off", LAYERS.filter((x) => (x === k ? on[x] : !on[x])).join(","));
  toggles.append(l);
}
requestAnimationFrame(loop);
window.demo = { draw, cast, camera, SC, CLIPS, perform, placeOf, handLocal, STEPS, get t() { return t; } };
