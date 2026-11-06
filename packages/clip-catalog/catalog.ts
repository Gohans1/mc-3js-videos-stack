// @ts-nocheck
// Lab: tags for a clip library, measured on Steve himself (each clip retargeted and baked as the film does, mc-actor/clips,
// at 30 fps): one "ROW {json}" line per clip, which clip-catalog/catalog.sh appends to vault/motion/catalog/<lib>.jsonl and
// clip-catalog/catalog.py searches. No stills.
// ENTRY=../../packages/clip-catalog/catalog.ts LAB_LIB=mixamo LAB_CLIPS=a,b,c bun run render stills
// Fields: dur s; start/end posture and the posture runs (POSTURE below, each run at least RUN s); travel (end x, z in his
// frame, m: x his left, z his front), reach (furthest from the start, m), turn (end ry, deg to his left); loop (first
// against last frame: worst joint deg, hips cm); energy (mean joint turn speed, deg/s); look (head twist on the neck,
// range, deg); hips (lowest and mean hip height, share of standing); head / up / ground (seconds a hand is at his head /
// above it / on the floor); air (seconds nothing of him touches the floor: a jump, or a bed or ledge under him); bend (seconds
// on his feet with the trunk over past 50 deg: picking up, putting down, looking under); tl (timeline, below).
import * as THREE from "three";
import { unzipSync } from "fflate";
import { config, done, log } from "live-studio/lab";
import { loadRig, makePlayer } from "mc-actor/player";
import { clipNames, loadClip } from "mc-actor/clips";
import { bodyBoxes } from "mc-actor/mocap";

const D = 180 / Math.PI, FPS = 30, RUN = 0.3;

// runs of equal labels; a run shorter than `min` frames is folded into its longer neighbour, so a flicker between two
// states never becomes a segment of its own
const runsOf = (labels, min) => {
  const runs = [];
  labels.forEach((l, i) => { if (runs.length && runs.at(-1).l === l) runs.at(-1).b = i; else runs.push({ l, a: i, b: i }); });
  for (;;) {
    let k = -1;
    runs.forEach((r, i) => { if (r.b - r.a + 1 < min && (k < 0 || r.b - r.a < runs[k].b - runs[k].a)) k = i; });
    if (k < 0 || runs.length < 2) return runs;
    const r = runs[k], prev = runs[k - 1], next = runs[k + 1];
    const into = !prev ? next : !next ? prev : prev.b - prev.a >= next.b - next.a ? prev : next;
    if (into === prev) prev.b = r.b; else next.a = r.a;
    runs.splice(k, 1);
    for (let i = runs.length - 1; i > 0; i--) if (runs[i].l === runs[i - 1].l) { runs[i - 1].b = runs[i].b; runs.splice(i, 1); }
  }
};
const smooth = (a, w) => a.map((_, i) => { let s = 0, n = 0; for (let j = Math.max(0, i - w); j <= Math.min(a.length - 1, i + w); j++) { s += a[j]; n++; } return s / n; });
const unwrap = (a) => a.reduce((o, x) => { o.push(o.length ? o.at(-1) + THREE.MathUtils.euclideanModulo(x - a[o.length - 1] + 180, 360) - 180 : x); return o; }, []);
const t1 = (i) => +(i / FPS).toFixed(1);

// The clip as timed segments per channel, measured (what clip-catalog/catalog.py hands Jev next to the eye-checked notes): body
// posture, travel (direction in his own frame, distance), body turns, gaze (head direction: up / down past 20 deg, far down
// past 50, left / right of his chest past 35), each hand (where: on the floor / low / hip / chest / face height / at his
// head / above it; reaching forward past 0.3 m or out to the side past 0.45 m from the chest; how fast it moves against
// his chest) and tempo (mean joint speed). Labels a segment of its own needs: 0.3 s body, 1 s tempo, 0.5 s the rest.
const timeline = (posture, track, energy) => {
  const n = track.length, seg = (labels, min, note = () => "") =>
    runsOf(labels, min).filter((r) => r.l).map((r) => [t1(r.a), t1(r.b + 1), r.l + note(r)]);
  const yaw = unwrap(track.map((f) => f.yaw));
  const vx = smooth(track.map((f, i) => (i ? f.x - track[i - 1].x : 0) * FPS), 5), vz = smooth(track.map((f, i) => (i ? f.z - track[i - 1].z : 0) * FPS), 5);
  const rate = smooth(yaw.map((y, i) => (i ? y - yaw[i - 1] : 0) * FPS), 5);
  const moves = track.map((f, i) => {
    const v = Math.hypot(vx[i], vz[i]);
    if (v < 0.2) return "";
    const fx = Math.sin(f.yaw / D), fz = Math.cos(f.yaw / D), ang = Math.atan2(fz * vx[i] - fx * vz[i], fx * vx[i] + fz * vz[i]) * D;
    const dir = Math.abs(ang) < 45 ? "forward" : Math.abs(ang) > 135 ? "backward" : ang > 0 ? "to his left" : "to his right";
    return `${v < 0.6 ? "edges" : v < 1.8 ? "walks" : v < 4 ? "runs" : "sprints"} ${dir}`;
  });
  const dist = (r) => { let s = 0; for (let i = r.a + 1; i <= r.b; i++) s += Math.hypot(track[i].x - track[i - 1].x, track[i].z - track[i - 1].z); return ` ${s.toFixed(1)} m`; };
  const turns = seg(rate.map((w) => (w > 30 ? "turns left" : w < -30 ? "turns right" : "")), 8, (r) => ` ${Math.abs(yaw[r.b] - yaw[r.a]).toFixed(0)} deg`)
    .filter((s) => +s[2].split(" ").at(-2) >= 20);
  const gaze = track.map((f) => {
    const v = f.pitch < -50 ? "far down" : f.pitch < -20 ? "down" : f.pitch > 20 ? "up" : "";
    const h = f.gazeYaw > 35 ? "left" : f.gazeYaw < -35 ? "right" : "";
    return v && h ? `${v}-${h}` : v || h || "ahead";
  });
  const hand = (k) => {
    const sp = smooth(track.map((f, i) => (i ? f.hands[k].p.clone().sub(f.hands[k].chest).distanceTo(track[i - 1].hands[k].p.clone().sub(track[i - 1].hands[k].chest)) * FPS : 0)), 3);
    return track.map((f, i) => {
      const h = f.hands[k], d = h.p.clone().sub(h.chest), ahead = d.dot(h.fwd), side = Math.abs(d.x * h.fwd.z - d.z * h.fwd.x);
      const rel = (h.p.y - h.base) / Math.max(0.2, h.neck - h.base);
      const where = h.floor ? "on the floor" : h.p.y > h.top ? "above his head" : h.head ? "at his head" : rel < 0.3 ? "low" : rel < 0.62 ? "at hip height" : rel < 0.9 ? "at chest height" : "at face height";
      const act = sp[i] > 1.5 ? "fast" : sp[i] > 0.35 ? "moving" : "";
      // lying, heights above the floor say nothing of his body: on the floor, on himself, or held up off him
      if (posture[i] === "lie") return [h.floor ? "on the floor" : h.p.y - h.chest.y > 0.25 ? "raised" : "resting on his body", act].filter(Boolean).join(", ");
      if (["sitSeat", "sitFloor"].includes(posture[i]) && ["low", "at hip height"].includes(where) && ahead < 0.55 && !act) return "resting on his lap";
      if (["low", "at hip height"].includes(where) && ahead < 0.2 && side < 0.45 && !act) return "down at his side";
      return [where, ahead > 0.3 ? "reaching forward" : side > 0.45 ? "out to the side" : "", act].filter(Boolean).join(", ");
    });
  };
  const e = smooth([energy[0] ?? 0, ...energy], 8);
  return {
    body: seg(posture, RUN * FPS),
    moves: seg(moves, 15, dist),
    turns,
    gaze: seg(gaze, 15),
    handR: seg(hand(0), 15),
    handL: seg(hand(1), 15),
    tempo: seg(smooth(e, 15).map((x) => (x < 6 ? "still" : x < 18 ? "gentle" : x < 45 ? "moderate" : x < 110 ? "fast" : "violent")), 30),
  };
};

(async () => {
  const cfg = await config();
  const jar = new Uint8Array(await (await fetch("mc/client_assets.zip")).arrayBuffer());
  const SKIN = "assets/minecraft/textures/entity/player/wide/steve.png";
  const skin = URL.createObjectURL(new Blob([unzipSync(jar, { filter: (f) => f.name === SKIN })[SKIN]], { type: "image/png" }));
  const steve = await makePlayer(await loadRig("rig/player.glb"), skin, { glow: 0.03 });
  const b = steve.bones, lib = cfg.lab.lib ?? "mixamo";
  const at = (k) => b[k].getWorldPosition(new THREE.Vector3());
  const restOf = (k) => b[k].getWorldQuaternion(new THREE.Quaternion()).invert();
  steve.setPose({});
  steve.g.updateMatrixWorld(true);
  const H0 = at("root").y, rest = { chest: restOf("chest"), head: restOf("head"), root: restOf("root") }, body = bodyBoxes(steve);
  const turnOf = (k) => b[k].getWorldQuaternion(new THREE.Quaternion()).multiply(rest[k]);
  // each box's lowest corner (the floor meets his box surfaces, a joint centre sits half a limb above it)
  const M = new THREE.Matrix4(), c = new THREE.Vector3();
  const low = (k) => {
    const bx = body.box[k];
    M.copy(b[k].matrixWorld).multiply(new THREE.Matrix4().copy(body.rest[k]).invert());
    let y = Infinity;
    for (let i = 0; i < 8; i++) y = Math.min(y, c.set(i & 1 ? bx.max.x : bx.min.x, i & 2 ? bx.max.y : bx.min.y, i & 4 ? bx.max.z : bx.min.z).applyMatrix4(M).y);
    return y;
  };
  const ON = 0.06; // a box this close to the floor rests on it
  // a hand at his head: by the head's box and above its chin (his head sits right on his shoulders: a hand rubbing the
  // other shoulder is as close to the box)
  const atHead = (p) => {
    const q = p.clone().applyMatrix4(M.copy(body.rest.head).multiply(new THREE.Matrix4().copy(b.head.matrixWorld).invert()));
    return body.box.head.distanceToPoint(q) < 0.1 && q.y > body.box.head.min.y + 0.08;
  };

  // what his body is doing in one frame, by its shape over its own lowest point (so lying on a bed is lying, and a jump
  // keeps its stand / crouch; `air` counts the time off the floor). Steve's metres over that point: hips 0.70 standing,
  // ~0.47 kneeling upright or on all fours, ~0.15 sitting on the floor; neck ~1.4 standing; a knee joint ~0.12 when down.
  // Thresholds checked against the clips' names (a clip named kneel must kneel...) and by eye on the disagreements.
  const POSTURE = (f, base) => {
    const lean = Math.acos(THREE.MathUtils.clamp(new THREE.Vector3(0, 1, 0).applyQuaternion(turnOf("chest")).y, -1, 1)) * D;
    const hips = f.root.y - base, neck = f.head.y - base;
    const kneeDown = Math.min(f.kneeL.y, f.kneeR.y) - base < 0.2, handsDown = Math.min(low("laL"), low("laR")) - base < ON;
    const fold = (sd) => f[`knee${sd}`].clone().sub(f[`hip${sd}`]).normalize().angleTo(f[`sole${sd}`].clone().sub(f[`knee${sd}`]).normalize()) * D;
    const thighTilt = (sd) => Math.asin(THREE.MathUtils.clamp(Math.abs(f[`knee${sd}`].y - f[`hip${sd}`].y) / f[`knee${sd}`].distanceTo(f[`hip${sd}`]), 0, 1)) * D;
    const level = thighTilt("L") < 35 && thighTilt("R") < 35;
    // trunk flat: hips up on hands and knees, else lying: neck no higher than the hips (a deep crouch leans as far but keeps
    // its neck up), and the hips low or the thighs flat too (on a bed the legs can hang off its edge; bending over to the
    // floor keeps the thighs upright)
    if (lean > 55 && kneeDown && handsDown && hips > 0.3) return "allFours";
    if (lean > 55 && neck - hips < 0.3 && (hips < 0.45 || level)) return "lie";
    // the seat on the floor: hips low (a knee on the floor alone keeps them up) and his seat on it (a catcher's squat
    // keeps it off)
    if (hips < 0.4 * H0 && low("body") - base < 0.1) return "sitFloor";
    if (kneeDown) return "kneel";
    // a walk's stance leg is near straight; a crouch (or crouched walk) keeps both knees bent
    if (hips > 0.92 * H0 || (hips > 0.85 * H0 && Math.min(fold("L"), fold("R")) < 35)) return "stand";
    // thighs level: a seat (feet out in front of the hips), not a squat (knees folded shut, feet under him)
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(turnOf("root")).setY(0).normalize();
    const feetAhead = f.soleL.clone().add(f.soleR).multiplyScalar(0.5).sub(f.root).dot(fwd);
    if (level && Math.max(fold("L"), fold("R")) < 115 && feetAhead > 0.2) return "sitSeat";
    return "crouch";
  };

  const names = cfg.lab.clips === "all" ? await clipNames(lib) : cfg.lab.clips.split(",");
    for (const name of names) {
    try {
      const clip = await loadClip(`${lib}/${name}`, steve, FPS);
      const frames = clip.frames, posture = [], energy = [], track = [];
      let reach = 0, head = 0, air = 0, bend = 0, hipMin = Infinity, hipSum = 0, up = 0, ground = 0, lookMin = Infinity, lookMax = -Infinity;
      frames.forEach((p, i) => {
        steve.setPose(p);
        steve.g.updateMatrixWorld(true);
        const f = { root: at("root"), head: at("head"), kneeL: at("llL"), kneeR: at("llR"), hipL: at("ulL"), hipR: at("ulR"), soleL: steve.soleAt("L", new THREE.Vector3()), soleR: steve.soleAt("R", new THREE.Vector3()) };
        const base = Math.min(...Object.keys(body.box).map(low));
        posture.push(POSTURE(f, base));
        if (base > 0.1) air += 1 / FPS;
        if (["stand", "crouch"].includes(posture.at(-1)) && new THREE.Vector3(0, 1, 0).applyQuaternion(turnOf("chest")).y < Math.cos(50 / D)) bend += 1 / FPS;
        reach = Math.max(reach, Math.hypot(p.root.x, p.root.z));
        const top = f.head.y + 0.47, hands = [steve.hand.getWorldPosition(new THREE.Vector3()), steve.handL.getWorldPosition(new THREE.Vector3())];
        if (hands.some(atHead)) head += 1 / FPS;
        hipMin = Math.min(hipMin, f.root.y / H0); hipSum += f.root.y / H0;
        if (hands.some((h) => h.y > top)) up += 1 / FPS;
        if (Math.min(low("laL"), low("laR")) < ON) ground += 1 / FPS;
        // the head's twist about the chest's up (swing-twist): stays put when he looks down, unlike a yaw from his gaze
        const q = turnOf("chest").invert().multiply(turnOf("head")), look = 2 * Math.atan2(q.y, q.w) * D;
        const tw = THREE.MathUtils.euclideanModulo(look + 180, 360) - 180;
        lookMin = Math.min(lookMin, tw); lookMax = Math.max(lookMax, tw);
        // where his body faces on the floor: the hips' front, or across their left-right axis when the front points up or
        // down (lying on his back or front), so the facing doesn't spin while he lies or sits up
        const front = new THREE.Vector3(0, 0, 1).applyQuaternion(turnOf("root")).setY(0);
        const across = new THREE.Vector3().crossVectors(new THREE.Vector3(1, 0, 0).applyQuaternion(turnOf("root")).setY(0), new THREE.Vector3(0, 1, 0));
        const fwd = (front.lengthSq() > across.lengthSq() ? front : across).normalize();
        const gaze = new THREE.Vector3(0, 0, 1).applyQuaternion(turnOf("head")), chest = at("chest");
        const flat = gaze.clone().setY(0).normalize(), pitch = Math.asin(THREE.MathUtils.clamp(gaze.y, -1, 1)) * D;
        track.push({
          x: p.root.x, z: p.root.z, yaw: Math.atan2(fwd.x, fwd.z) * D, pitch,
          // left / right means nothing for a gaze straight up or down
          gazeYaw: Math.abs(pitch) > 60 ? 0 : Math.atan2(new THREE.Vector3().crossVectors(fwd, flat).y, fwd.dot(flat)) * D,
          hands: hands.map((h, k) => ({ p: h, chest, fwd, base, neck: f.head.y, hip: f.root.y, top, floor: low(k ? "laL" : "laR") - base < ON, head: atHead(h) })),
        });
        if (i) {
          const q = frames[i - 1];
          let sum = 0, n = 0;
          for (const j of Object.keys(p)) if (j !== "root" && q[j]) { sum += Math.max(...p[j].map((x, k) => Math.abs(x - q[j][k]))); n++; }
          energy.push((sum / Math.max(1, n)) * FPS);
        }
      });
      // runs of one posture; runs shorter than RUN (flickers between two) are dropped
      const runs = [];
      posture.forEach((x, i) => { if (runs.length && runs.at(-1)[0] === x) runs.at(-1)[2] = i; else runs.push([x, i, i]); });
      const kept = runs.filter((r, i) => (r[2] - r[1] + 1) / FPS >= RUN || runs.length === 1);
      // a short clip changing all the time keeps no run that long: its longest run then
      const seq = (kept.length ? kept : [runs.reduce((x, y) => (y[2] - y[1] > x[2] - x[1] ? y : x))]).map((r) => r[0]).filter((x, i, a) => i === 0 || a[i - 1] !== x);
      const majority = (from, to) => { const c = {}; for (const x of posture.slice(from, to)) c[x] = (c[x] ?? 0) + 1; return Object.entries(c).sort((x, y) => y[1] - x[1])[0][0]; };
      const k = Math.max(1, Math.round(0.2 * FPS)), A = frames[0], Z = frames.at(-1);
      let loopDeg = 0;
      for (const j of Object.keys(A)) if (j !== "root" && Z[j]) loopDeg = Math.max(loopDeg, ...A[j].map((x, i) => Math.abs(THREE.MathUtils.euclideanModulo(x - Z[j][i] + 180, 360) - 180)));
      const r = (x, d = 2) => +x.toFixed(d);
      await log(`ROW ${JSON.stringify({
        ref: `${lib}/${name}`, dur: r(clip.duration), start: majority(0, k), end: majority(frames.length - k, frames.length), seq,
        travel: [r(clip.end.x), r(clip.end.z)], reach: r(reach), turn: r(clip.end.ry, 0),
        loop: [r(loopDeg, 0), r(Math.hypot(Z.root.x - A.root.x, Z.root.y - A.root.y, Z.root.z - A.root.z) * 100, 0)],
        energy: r(energy.length ? energy.reduce((x, y) => x + y) / energy.length : 0, 0), look: r(lookMax - lookMin, 0), hips: [r(hipMin), r(hipSum / frames.length)], head: r(head), up: r(up), ground: r(ground), air: r(air), bend: r(bend),
        tl: timeline(posture, track, energy),
      })}`);
    } catch (e) {
      await log(`ROW ${JSON.stringify({ ref: `${lib}/${name}`, error: String(e.message ?? e) })}`);
    }
  }
  await done();
})();
