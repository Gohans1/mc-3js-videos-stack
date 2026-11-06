// @ts-nocheck
// Planted feet (foot locking, as in D. Holden's "Inverse Kinematics and Foot Locking", theorangeduck.com, and the stance
// locking of game engines): a sole on the stone stays where it landed while the body above it walks, turns or blends
// between poses, and the leg IK (player.ts legTo) bends hip and knee to keep it there. Which sole is on the floor comes
// from the pose: in a walk its gait phase (player.ts gaitOf), otherwise the pose's sole being near the stone. A sole leaves
// the floor when the gait or the pose lifts it, or as a step of its own (one foot at a time) when the body has drifted or
// turned too far over it or would pull the leg straight. Every step flies in an arc to where that sole lands next, found by
// looking ahead, so a foot never drags over (or through) the floor. Without this, every move key that shifts him (moves
// `at`) slid the whole body over the stone and each walking step slid 25-43 cm.
// draw(t) holds no state between frames, so the film is run through once per edit (60 samples a second, the pose's soles
// alone, under a second for the whole film) and draw(t) reads the result: same t, same feet.
import * as THREE from "three";
import { bodyAt } from "./steve";

const HZ = 60;
const DOWN = 0.05, UP = 0.08; // a sole the pose holds still counts as on the floor below 5 cm, off it above 8 (no flicker)
const DRIFT = 0.16, TURN = 35; // a planted sole steps when the pose wants it 16 cm or 35 degrees away
const MIN_STEP = 0.2, MAX_LOOK = 0.8, SETTLE = 0.45; // seconds: shortest step; how far ahead a landing is looked for
const SINK = 0.08; // seconds to set a sole the pose holds a little above (or in) the floor down onto it

export function makeFeet(steve, endOf, clips = {}) {
  const baked = new WeakMap();
  const tmp = new THREE.Vector3(), V = new THREE.Vector3();
  const bake = (moves) => {
    const n = Math.ceil(endOf() * HZ) + 2;
    const want = { L: new Float32Array(n * 3), R: new Float32Array(n * 3) }, hips = { L: new Float32Array(n * 3), R: new Float32Array(n * 3) };
    const yaw = new Float32Array(n), gait = new Float32Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      const B = bodyAt(moves, i / HZ, clips);
      steve.g.position.set(...B.at);
      steve.g.rotation.y = B.yaw * THREE.MathUtils.DEG2RAD;
      steve.setPose(B.pose);
      steve.g.updateMatrixWorld(true);
      yaw[i] = B.yaw;
      if (B.gait && B.gait.w > 0.15) gait[i] = B.gait.ph;
      for (const sd of ["L", "R"]) {
        steve.soleAt(sd, tmp).toArray(want[sd], i * 3);
        steve.bones[`ul${sd}`].getWorldPosition(tmp).toArray(hips[sd], i * 3);
      }
    }
    // on the floor or not, per foot and sample: the gait's stance half while walking, else the pose's sole height
    const down = { L: new Uint8Array(n), R: new Uint8Array(n) };
    for (const sd of ["L", "R"]) {
      let was = 0;
      for (let i = 0; i < n; i++) {
        const y = want[sd][i * 3 + 1], ph = gait[i];
        was = Number.isNaN(ph) ? (y < DOWN || (was && y <= UP) ? 1 : 0) : ((sd === "L" ? Math.cos(ph) < 0 : Math.cos(ph) > 0) ? 1 : 0);
        down[sd][i] = was;
      }
    }
    const at = (sd, j, v) => v.fromArray(want[sd], j * 3);
    const speed = (sd, j) => (j + 1 < n ? at(sd, j + 1, tmp).distanceTo(at(sd, j, V)) * HZ : 0);
    // where a sole leaving the floor at i lands: the pose's sole when it is next on the floor (a walk's next footfall)
    const landing = (sd, i) => {
      let j = i + 1;
      while (j < Math.min(n - 1, i + MAX_LOOK * HZ) && !down[sd][j]) j++;
      return down[sd][j] ? j : -1;
    };
    // the end of this foot's stance in the walk (or of the walk itself: the trailing foot then closes up beside the other)
    const stanceEnd = (sd, i) => { let j = i; while (j < n - 1 && down[sd][j] && !Number.isNaN(gait[j])) j++; return j; };
    // where a planted sole stepping on its own goes: where the pose's sole comes to rest, at most SETTLE ahead
    const settle = (sd, i) => {
      let j = i + 1;
      while (j < Math.min(n - 1, i + SETTLE * HZ) && down[sd][j] && speed(sd, j) > 0.12) j++;
      return j;
    };
    const out = { L: new Float32Array(n * 3), R: new Float32Array(n * 3) }, on = { L: new Uint8Array(n), R: new Uint8Array(n) }, mode = { L: new Uint8Array(n), R: new Uint8Array(n) };
    const st = { L: { mode: "free" }, R: { mode: "free" } };
    const W = new THREE.Vector3(), P = new THREE.Vector3(), H = new THREE.Vector3(), Q = new THREE.Vector3();
    const step = (s, i, from, j, arc) => Object.assign(s, { mode: "step", from: from.clone(), t0: i, t1: Math.min(n - 1, Math.max(j, i + Math.round(MIN_STEP * HZ))), arc });
    const lock = (s, i, p) => Object.assign(s, { mode: "lock", pin: p.clone(), y0: p.y, t0: i, yaw: yaw[i] });
    for (let i = 0; i < n; i++) {
      for (const sd of ["L", "R"]) {
        const s = st[sd], o = st[sd === "L" ? "R" : "L"];
        at(sd, i, W);
        H.fromArray(hips[sd], i * 3);
        if (s.mode === "lock") {
          const away = Math.hypot(s.pin.x - W.x, s.pin.z - W.z), turned = Math.abs(((yaw[i] - s.yaw + 540) % 360) - 180);
          // standing straight the leg is already at full reach: pulled 2 cm past it (the sole would lift off) is too far
          const strained = s.pin.distanceTo(H) > steve.legReach + 0.02;
          if (!down[sd][i]) {
            const j = landing(sd, i);
            // lifted for good (sitting down, lying back): it goes with the pose's own leg
            step(s, i, s.pin, j < 0 ? i : j, j >= 0);
          } else if (!Number.isNaN(gait[i])) {
            // walking, the gait times every step; a leg pulled straight before it lifts goes early, to the same footfall
            if (strained) { const j = landing(sd, stanceEnd(sd, i)); step(s, i, s.pin, j < 0 || j - i > 0.6 * HZ ? settle(sd, i) : j, true); }
          } else if (strained || (o.mode !== "step" && (away > DRIFT || turned > TURN))) step(s, i, s.pin, settle(sd, i), true);
        }
        // a sole the pose sweeps along the floor (a leg folding under him): lifted into one step to where it stops
        if (s.mode === "free" && down[sd][i] && speed(sd, i) > 0.4 && o.mode !== "step") step(s, i, W.clone().setY(Math.max(0, W.y)), settle(sd, i), true);
        if (s.mode === "step") {
          const u = Math.min(1, (i - s.t0) / (s.t1 - s.t0)), k = u * u * (3 - 2 * u);
          if (s.arc) {
            at(sd, s.t1, Q).setY(0);
            P.copy(s.from).lerp(Q, k);
            P.y += Math.min(0.1, 0.03 + 0.2 * Math.hypot(Q.x - s.from.x, Q.z - s.from.z)) * Math.sin(Math.PI * u);
          } else P.copy(s.from).lerp(W, k);
          P.toArray(out[sd], i * 3);
          on[sd][i] = 1;
          mode[sd][i] = 2;
          if (u < 1) continue;
          s.mode = "free";
          if (s.arc && down[sd][i]) { lock(s, i, P); continue; }
          // the gait lifted it as its own step ended: straight on to its next footfall
          const j = !down[sd][i] && !Number.isNaN(gait[i]) ? landing(sd, i) : -1;
          if (j >= 0) { step(s, i, P, j, true); continue; }
        }
        if (s.mode === "free" && down[sd][i]) lock(s, i, W);
        if (s.mode === "lock") {
          // set down onto the stone (the pose holds its sole a little off it, or in it)
          s.pin.y = s.y0 * (1 - Math.min(1, (i - s.t0) / (SINK * HZ)));
          s.pin.toArray(out[sd], i * 3);
          on[sd][i] = 1;
          mode[sd][i] = 1;
        } else W.toArray(out[sd], i * 3);
      }
    }
    return { out, on, n, mode, down };
  };
  const A = new THREE.Vector3(), B = new THREE.Vector3();
  // where each sole goes at t, or null where the pose's own leg is left as it is (off the floor, nothing to hold)
  return (moves, t) => {
    if (!baked.has(moves)) baked.set(moves, bake(moves));
    const { out, on, n } = baked.get(moves);
    const x = Math.min(Math.max(t * HZ, 0), n - 1.001), i = Math.floor(x), f = x - i;
    const res = { mode: (sd) => "fls"[baked.get(moves).mode[sd][i]] + baked.get(moves).down[sd][i] };
    for (const sd of ["L", "R"]) res[sd] = on[sd][i] || on[sd][i + 1] ? A.fromArray(out[sd], i * 3).lerp(B.fromArray(out[sd], (i + 1) * 3), f).clone() : null;
    return res;
  };
}
