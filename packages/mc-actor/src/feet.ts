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

const HZ = 60;
const DOWN = 0.05,
  UP = 0.08; // a sole the pose holds still counts as on the floor below 5 cm, off it above 8 (no flicker)
const DRIFT = 0.16,
  TURN = 35; // a planted sole steps when the pose wants it 16 cm or 35 degrees away
const MIN_STEP = 0.2,
  MAX_LOOK = 0.8,
  SETTLE = 0.45; // seconds: shortest step; how far ahead a landing is looked for
const SINK = 0.08; // seconds to set a sole the pose holds a little above (or in) the floor down onto it

const DB = "mc-actor-bakes";
const CLIP_KEY = Symbol.for("mc-actor.clipKey");
const HASHED_SCRIPT = /\/[^/]+-[A-Za-z0-9_-]{6,}\.[cm]?js(?:$|\?)/;
const scriptTag = (u = import.meta.url) => {
  if (!u || typeof u !== "string") return null;
  const i = u.search(/[?#]/);
  const clean = i >= 0 ? u.slice(0, i) : u;
  return HASHED_SCRIPT.test(clean) ? clean : null;
};
const idbRequest = (r) =>
  new Promise((done, fail) => {
    r.onsuccess = () => done(r.result);
    r.onerror = () => fail(r.error);
  });

// bodyAt: the performance's (perform.ts makePerformance), so the feet follow the same body the film draws
export function makeFeet(steve, endOf, bodyAt, clips = {}) {
  const baked = new WeakMap();
  const tmp = new THREE.Vector3(),
    V = new THREE.Vector3();
  const bake = (moves) => {
    const n = Math.ceil(endOf() * HZ) + 2;
    const want = { L: new Float32Array(n * 3), R: new Float32Array(n * 3) },
      hips = { L: new Float32Array(n * 3), R: new Float32Array(n * 3) };
    const yaw = new Float32Array(n),
      gait = new Float32Array(n).fill(NaN);
    steve.g.updateWorldMatrix(true, true);
    if (steve.legsAt) {
      const wantL = want.L,
        wantR = want.R,
        hipL = hips.L,
        hipR = hips.R;
      let lastB = null;
      for (let i = 0; i < n; i++) {
        const B = bodyAt(moves, i / HZ, clips);
        lastB = B;
        steve.legsAt(B.at, B.yaw, B.pose, wantL, wantR, hipL, hipR, i * 3);
        yaw[i] = B.yaw;
        if (B.gait && B.gait.w > 0.15) gait[i] = B.gait.ph;
      }
      if (lastB) {
        steve.g.position.set(lastB.at[0], lastB.at[1], lastB.at[2]);
        steve.g.rotation.y = lastB.yaw * THREE.MathUtils.DEG2RAD;
        steve.setPose(lastB.pose);
      }
    } else {
      for (let i = 0; i < n; i++) {
        const B = bodyAt(moves, i / HZ, clips);
        steve.g.position.set(...B.at);
        steve.g.rotation.y = B.yaw * THREE.MathUtils.DEG2RAD;
        steve.setPose(B.pose);
        steve.updateBones();
        yaw[i] = B.yaw;
        if (B.gait && B.gait.w > 0.15) gait[i] = B.gait.ph;
        for (const sd of ["L", "R"]) {
          steve.soleNow(sd, tmp).toArray(want[sd], i * 3);
          tmp.setFromMatrixPosition(steve.bones[`ul${sd}`].matrixWorld).toArray(hips[sd], i * 3);
        }
      }
    }
    steve.g.updateWorldMatrix(true, true); // all of him and his ancestors, as the last sample left him
    const legReach = steve.legReach;
    const mWorld = (steve.rig ?? steve.g).matrixWorld;
    const legScale = Math.max(
      1e-3,
      steve.restLegReach > 0
        ? legReach / steve.restLegReach
        : tmp.setFromMatrixColumn(mWorld, 1).length(),
    );
    const xzScale = Math.max(
      1e-3,
      Math.hypot(
        tmp.setFromMatrixColumn(mWorld, 0).length(),
        V.setFromMatrixColumn(mWorld, 2).length(),
      ) / Math.SQRT2,
    );
    const downH = DOWN * legScale,
      upH = UP * legScale,
      drift = DRIFT * xzScale,
      settleSpeed = 0.12 * xzScale,
      sweepSpeed = 0.4 * xzScale,
      strainMax = legReach + 0.02 * legScale,
      arcBase = 0.03 * legScale,
      arcMax = 0.1 * legScale;
    // on the floor or not, per foot and sample: the gait's stance half while walking, else the pose's sole height
    const down = { L: new Uint8Array(n), R: new Uint8Array(n) };
    for (const sd of ["L", "R"]) {
      let was = 0;
      for (let i = 0; i < n; i++) {
        const y = want[sd][i * 3 + 1],
          ph = gait[i];
        was = Number.isNaN(ph)
          ? y < downH || (was && y <= upH)
            ? 1
            : 0
          : (sd === "L" ? Math.cos(ph) < 0 : Math.cos(ph) > 0)
            ? 1
            : 0;
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
    const stanceEnd = (sd, i) => {
      let j = i;
      while (j < n - 1 && down[sd][j] && !Number.isNaN(gait[j])) j++;
      return j;
    };
    // where a planted sole stepping on its own goes: where the pose's sole comes to rest, at most SETTLE ahead
    const settle = (sd, i) => {
      let j = i + 1;
      while (j < Math.min(n - 1, i + SETTLE * HZ) && down[sd][j] && speed(sd, j) > settleSpeed) j++;
      return j;
    };
    const out = { L: new Float32Array(n * 3), R: new Float32Array(n * 3) },
      on = { L: new Uint8Array(n), R: new Uint8Array(n) },
      mode = { L: new Uint8Array(n), R: new Uint8Array(n) };
    const st = { L: { mode: "free" }, R: { mode: "free" } };
    const W = new THREE.Vector3(),
      P = new THREE.Vector3(),
      H = new THREE.Vector3(),
      Q = new THREE.Vector3();
    const step = (s, i, from, j, arc) =>
      Object.assign(s, {
        mode: "step",
        from: from.clone(),
        t0: i,
        t1: Math.min(n - 1, Math.max(j, i + Math.round(MIN_STEP * HZ))),
        arc,
      });
    const lock = (s, i, p) =>
      Object.assign(s, { mode: "lock", pin: p.clone(), y0: p.y, t0: i, yaw: yaw[i] });
    for (let i = 0; i < n; i++) {
      for (const sd of ["L", "R"]) {
        const s = st[sd],
          o = st[sd === "L" ? "R" : "L"];
        at(sd, i, W);
        H.fromArray(hips[sd], i * 3);
        if (s.mode === "lock") {
          const away = Math.hypot(s.pin.x - W.x, s.pin.z - W.z),
            turned = Math.abs(((yaw[i] - s.yaw + 540) % 360) - 180);
          // standing straight the leg is already at full reach: pulled 2 cm (scaled) past it (the sole would lift off) is too far
          const strained = s.pin.distanceTo(H) > strainMax;
          if (!down[sd][i]) {
            const j = landing(sd, i);
            // lifted for good (sitting down, lying back): it goes with the pose's own leg
            step(s, i, s.pin, j < 0 ? i : j, j >= 0);
          } else if (!Number.isNaN(gait[i])) {
            // walking, the gait times every step; a leg pulled straight before it lifts goes early, to the same footfall
            if (strained) {
              const j = landing(sd, stanceEnd(sd, i));
              step(s, i, s.pin, j < 0 || j - i > 0.6 * HZ ? settle(sd, i) : j, true);
            }
          } else if (strained || (o.mode !== "step" && (away > drift || turned > TURN)))
            step(s, i, s.pin, settle(sd, i), true);
        }
        // a sole the pose sweeps along the floor (a leg folding under him): lifted into one step to where it stops
        if (s.mode === "free" && down[sd][i] && speed(sd, i) > sweepSpeed && o.mode !== "step")
          step(s, i, W.clone().setY(Math.max(0, W.y)), settle(sd, i), true);
        if (s.mode === "step") {
          const u = Math.min(1, (i - s.t0) / (s.t1 - s.t0)),
            k = u * u * (3 - 2 * u);
          if (s.arc) {
            at(sd, s.t1, Q).setY(0);
            P.copy(s.from).lerp(Q, k);
            P.y +=
              Math.min(arcMax, arcBase + 0.2 * Math.hypot(Q.x - s.from.x, Q.z - s.from.z)) *
              Math.sin(Math.PI * u);
          } else P.copy(s.from).lerp(W, k);
          P.toArray(out[sd], i * 3);
          on[sd][i] = 1;
          mode[sd][i] = 2;
          if (u < 1) continue;
          s.mode = "free";
          if (s.arc && down[sd][i]) {
            lock(s, i, P);
            continue;
          }
          // the gait lifted it as its own step ended: straight on to its next footfall
          const j = !down[sd][i] && !Number.isNaN(gait[i]) ? landing(sd, i) : -1;
          if (j >= 0) {
            step(s, i, P, j, true);
            continue;
          }
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
  const A = new THREE.Vector3(),
    B = new THREE.Vector3();
  const warm = async (moves, codeTag = "") => {
    try {
      if (typeof indexedDB === "undefined" || !globalThis.crypto?.subtle) return;
      const fTag = scriptTag();
      const cTag = scriptTag(codeTag);
      if (!fTag || !cTag) return;
      const usedRefs = [...new Set(moves.map((m) => m.clip).filter(Boolean))].sort((a, b) =>
        a < b ? -1 : a > b ? 1 : 0,
      );
      const clipParts = [];
      for (const r of usedRefs) {
        const ck = clips?.[r]?.[CLIP_KEY];
        if (!ck) return;
        clipParts.push(`${r}=${ck}`);
      }
      const legNames = ["root", "ulL", "ulR", "llL", "llR"];
      let boneSig;
      if (typeof steve.legsSig === "function") {
        boneSig = steve.legsSig();
      } else {
        const saved = legNames.map((name) => {
          const b = steve.bones?.[name];
          return b ? [b, b.position.clone(), b.quaternion.clone()] : null;
        });
        if (typeof steve.setPose === "function") steve.setPose({});
        const gs = steve.g?.scale;
        boneSig = [
          gs ? `${gs.x},${gs.y},${gs.z}` : "",
          ...legNames.map((name) => {
            const b = steve.bones?.[name];
            return b
              ? `${name}:${b.position.x},${b.position.y},${b.position.z},${b.quaternion.x},${b.quaternion.y},${b.quaternion.z},${b.quaternion.w},${b.scale.x},${b.scale.y},${b.scale.z}`
              : "";
          }),
        ].join("|");
        for (const item of saved) {
          if (!item) continue;
          item[0].position.copy(item[1]);
          item[0].quaternion.copy(item[2]);
        }
      }
      const actorSig = `${fTag}\0${cTag}\0${THREE.REVISION}\0${steve.legReach}\0${boneSig}`;
      const actorDigest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(actorSig)),
      );
      const slot = `meta:feet:${[...actorDigest].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
      const sig = `${actorSig}\0${endOf()}\0${clipParts.join("\0")}\0${JSON.stringify(moves)}`;
      const d = new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sig)),
      );
      const key = [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains("bakes")) open.result.createObjectStore("bakes");
      };
      const db = await idbRequest(open);
      try {
        const rec = await idbRequest(
          db.transaction("bakes", "readonly").objectStore("bakes").get(slot),
        ).catch(() => null);
        if (rec?.key === key && rec.n) {
          baked.set(moves, {
            out: { L: rec.outL, R: rec.outR },
            on: { L: rec.onL, R: rec.onR },
            n: rec.n,
            mode: { L: rec.modeL, R: rec.modeR },
            down: { L: rec.downL, R: rec.downR },
          });
          return;
        }
        let data = baked.get(moves);
        if (!data) baked.set(moves, (data = bake(moves)));
        const tx = db.transaction("bakes", "readwrite");
        tx.objectStore("bakes").put(
          {
            ver: fTag,
            key,
            n: data.n,
            outL: data.out.L,
            outR: data.out.R,
            onL: data.on.L,
            onR: data.on.R,
            modeL: data.mode.L,
            modeR: data.mode.R,
            downL: data.down.L,
            downR: data.down.R,
          },
          slot,
        );
        await new Promise((done, fail) => {
          tx.oncomplete = () => done(undefined);
          tx.onerror = () => fail(tx.error);
          tx.onabort = () => fail(tx.error);
        });
      } finally {
        db?.close?.();
      }
    } catch {}
  };
  // where each sole goes at t, or null where the pose's own leg is left as it is (off the floor, nothing to hold)
  const feetAt = (moves, t) => {
    let data = baked.get(moves);
    if (!data) baked.set(moves, (data = bake(moves)));
    const { out, on, n, mode, down } = data;
    const x = Math.min(Math.max(t * HZ, 0), n - 1.001),
      i = Math.floor(x),
      f = x - i;
    const res = {
      mode: (sd) => "fls"[mode[sd][i]] + down[sd][i],
    };
    for (const sd of ["L", "R"])
      res[sd] =
        on[sd][i] || on[sd][i + 1]
          ? A.fromArray(out[sd], i * 3)
              .lerp(B.fromArray(out[sd], (i + 1) * 3), f)
              .clone()
          : null;
    return res;
  };
  return Object.assign(feetAt, { warm });
}
