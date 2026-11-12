// @ts-nocheck
import { unzipSync } from "fflate";
import { canvas, config, done, log, still } from "live-studio/lab";
import { clipNames, loadSource } from "mc-actor/clips";
import { bodyBoxes, retargeter, skeletonSource } from "mc-actor/mocap";
import { loadRig, makePlayer, MOODS } from "mc-actor/player";
// Lab: a human clip onto Steve (mc-actor/mocap), judged from every side and by numbers. Quaternius UAL1/UAL2 (CC0) or
// Mixamo FBX, in the vault's motion/ (bun run link), served to the page as motion/.
//   ENTRY=../../packages/clip-catalog/mocap.ts LAB_CLIP=Interact bun run render stills
//     renders/mocap_<clip>_NNN.jpg, 4 x 2 panels that follow the hips: top row source and Steve from the front, source and
//     Steve from their left; bottom row Steve from behind, his right, above, the floor. Then the numbers (CHECKS below),
//     worst frame of each
//   LAB_LIB=ual2: UAL2 (motion/ual2/UAL2_Standard.glb) instead of UAL1; LAB_LIB=mixamo LAB_CLIP=<file stem in
//   motion/mixamo>: a Mixamo FBX (no skin: drawn as a stick skeleton); LAB_FPS=6 fewer stills; LAB_NUMBERS=1 numbers
//   only; LAB_RAW=1 without the floor and own-body fixes; LAB_LOG=1 every frame's numbers; LAB_ZOOM=3 the panels close on
//   the head; LAB_FROM / LAB_TO seconds: only stills in that window
//   LAB_CLIPS=all: numbers only, every clip of the library (Mixamo: the stems in motion/mixamo/_tools/clips.json), one
//   "ROW {json}" line each with the worst of every check, for a sweep (LAB_CLIPS=a,b: those)
import * as THREE from "three";

const D = 180 / Math.PI;
const PXM = 1.875 / 32;
// Steve's bones against the source bones that turn them, for spin (a turn of his the source's own turn doesn't explain)
const SPIN = {
  root: "hips",
  chest: "waist",
  head: "head",
  uaL: "shoulderL",
  laL: "elbowL",
  ulL: "hipL",
  llL: "kneeL",
  uaR: "shoulderR",
  laR: "elbowR",
  ulR: "hipR",
  llR: "kneeR",
};
// points of his that must stay out of other parts of him: [name, where, radius, the boxes it must stay out of]
const OTHER = { L: "R", R: "L" };
const POINTS = (sd) => [
  [
    `elbow${sd}`,
    "la" + sd,
    1.6 * PXM,
    [
      "head",
      "body",
      "chest",
      `ul${sd}`,
      `ll${sd}`,
      `ul${OTHER[sd]}`,
      `ll${OTHER[sd]}`,
      `ua${OTHER[sd]}`,
      `la${OTHER[sd]}`,
    ],
  ],
  [`hand${sd} in other arm`, "hand" + sd, 1.6 * PXM, [`ua${OTHER[sd]}`, `la${OTHER[sd]}`]],
  [
    `knee${sd}`,
    "ll" + sd,
    1.6 * PXM,
    [
      "head",
      "body",
      "chest",
      `ul${OTHER[sd]}`,
      `ll${OTHER[sd]}`,
      `ua${sd}`,
      `la${sd}`,
      `ua${OTHER[sd]}`,
      `la${OTHER[sd]}`,
    ],
  ],
  [
    `foot${sd}`,
    "sole" + sd,
    1.6 * PXM,
    ["head", "body", "chest", `ul${OTHER[sd]}`, `ll${OTHER[sd]}`],
  ],
];

(async () => {
  const cfg = await config();
  const c = canvas();
  const W = cfg.W,
    H = cfg.H;
  const renderer = new THREE.WebGLRenderer({
    canvas: c,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(W, H, false);
  renderer.setScissorTest(true);
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1d2024);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(2, 4, 3);
  sun.castShadow = true;
  scene.add(sun);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0x3a3f45, transparent: true, opacity: 0.85 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor, new THREE.GridHelper(20, 40, 0x667, 0x445));

  const jar = new Uint8Array(await (await fetch("mc/client_assets.zip")).arrayBuffer());
  const SKIN = "assets/minecraft/textures/entity/player/wide/steve.png";
  const skin = URL.createObjectURL(
    new Blob([unzipSync(jar, { filter: (f) => f.name === SKIN })[SKIN]], { type: "image/png" }),
  );
  const steve = await makePlayer(await loadRig("rig/player.glb"), skin, { glow: 0.03 });
  scene.add(steve.g);
  steve.setPose({});
  steve.g.updateMatrixWorld(true);
  const restBoxes = bodyBoxes(steve),
    headRestMid = restBoxes.box.head.getCenter(new THREE.Vector3()),
    headRestInv = restBoxes.rest.head.clone().invert();

  const libName = cfg.lab.lib ?? "ual1",
    mixamo = libName === "mixamo";
  const load = async (name) => {
    const { root, names, clip } = await loadSource(`${libName}/${name}`);
    return {
      src: { scene: root, names, show: mixamo ? [root, new THREE.SkeletonHelper(root)] : [root] },
      clip,
    };
  };

  // panel: [figure, camera offset from the hips (x = his left, z = his front)]
  const P = [
    ["src", [0, 0.3, 5.4]],
    ["steve", [0, 0.3, 5.4]],
    ["src", [5.4, 0.3, 0]],
    ["steve", [5.4, 0.3, 0]],
    ["steve", [0, 0.3, -5.4]],
    ["steve", [-5.4, 0.3, 0]],
    ["steve", [0.01, 5.6, 0.4]],
    ["steve", [0.4, -0.6, 4.4]],
  ];
  const pw = W / 4,
    ph = H / 2;
  const cam = new THREE.PerspectiveCamera(30, pw / ph, 0.05, 50);

  const run = async (clipName, { stills, sweep }) => {
    const { src, clip } = await load(clipName);
    src.scene.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
        o.material = new THREE.MeshStandardMaterial({ color: 0x9aa4ae, roughness: 0.7 });
      }
    });
    if (stills) scene.add(...src.show);
    const show = (who) => {
      for (const o of src.show) o.visible = who === "src";
      steve.g.visible = who === "steve";
    };
    const mixer = new THREE.AnimationMixer(src.scene);
    const fps = sweep ? 30 : Number(cfg.lab.fps ?? 30),
      n = Math.max(1, Math.round(clip.duration * fps));
    // the mixer loops: at exactly clip.duration it shows frame 0 again
    const end = clip.duration - 1e-4;
    // the retargeter measures both rests before the clip runs, both at the origin; both stay there (one shown per panel)
    const sk = skeletonSource(src.scene, src.names);
    // the source as loaded is its rest: upright or not (an FBX whose rest is its first frame lying down would aim the
    // head and place the hips from that)
    const rest = { up: sk.at("neck").y - sk.at("hips").y, hips: sk.at("hips").y };
    const rt = retargeter(sk, steve, cfg.lab.raw ? { floor: false, own: false } : {});
    mixer.clipAction(clip).play();

    const gaps = {},
      stats = {},
      worst = (k, val, t) => {
        if (!(val <= stats[k]?.val)) stats[k] = { val, t };
      };
    const w = (bone) => steve.bones[bone].getWorldPosition(new THREE.Vector3());
    // joint: [his, relative to the joint it hangs on], [the source's role, the one it hangs on]
    const JOINTS = {
      root: [() => w("root"), ["hips"]],
      head: [
        () => steve.bones.head.localToWorld(new THREE.Vector3(0, 0.3, 0)).sub(w("head")),
        ["head", "neck"],
      ],
      ...Object.fromEntries(
        ["L", "R"].flatMap((sd) => [
          [`elbow${sd}`, [() => w(`la${sd}`).sub(w(`ua${sd}`)), [`elbow${sd}`, `shoulder${sd}`]]],
          [`hand${sd}`, [() => rt.hand(sd).sub(w(`la${sd}`)), [`wrist${sd}`, `elbow${sd}`]]],
          [`knee${sd}`, [() => w(`ll${sd}`).sub(w(`ul${sd}`)), [`knee${sd}`, `hip${sd}`]]],
          [
            `foot${sd}`,
            [
              () => steve.soleAt(sd, new THREE.Vector3()).sub(w(`ll${sd}`)),
              [`ankle${sd}`, `knee${sd}`],
            ],
          ],
        ]),
      ),
    };
    const ratio = {},
      ZERO = new THREE.Vector3();
    const soles = { L: [], R: [] },
      prev = {},
      prevQ = {},
      v = new THREE.Vector3(),
      hipsAt = new THREE.Vector3(),
      q = new THREE.Quaternion();
    const chestRest = steve.bones.chest.getWorldQuaternion(new THREE.Quaternion()).invert(),
      headRest = steve.bones.head.getWorldQuaternion(new THREE.Quaternion()).invert();
    for (let i = 0; i <= n; i++) {
      const t = Math.min(end, i / fps);
      mixer.setTime(t);
      const p = rt.pose(i > 0 ? 1 / fps : 0);
      steve.setPose(p);
      steve.face(MOODS.neutral, [0, 0, 0, 0], 0, [0, 0]); // unset, the floating face keeps its lids shut and mouth open
      scene.updateMatrixWorld(true);
      const m = rt.measure();
      if (
        JSON.stringify(p, (k, x) =>
          typeof x === "number" && !Number.isFinite(x) ? "BAD" : x,
        ).includes("BAD")
      )
        worst("not a number", 1, t);
      for (const [k, e] of Object.entries(m.dir)) worst(`direction error ${k}`, e, t);
      // bent, the source's own hinge plane against the one its upper bone's roll gives (mc-actor/mocap hinge): far apart,
      // a limb rolls between them as it straightens
      for (const [k, g] of Object.entries(m.gap)) (gaps[k] ??= []).push(g);
      worst("float (Steve's lowest point above where it should be)", m.float * 100, t);
      // below the floor only where the source isn't (a fall into a pool, over a cliff)
      const ground = Math.min(0, rt.k * m.srcLow);
      worst("sink (Steve's lowest point below the floor)", (ground - m.low) * 100, t);
      worst("arm below the floor", (ground - m.armLow) * 100, t);
      worst("head below the floor", (ground - m.headLow) * 100, t);
      for (const [k, d] of Object.entries(m.inside)) worst(`inside ${k}`, d * 100, t);
      // his other points in other parts of him
      for (const sd of ["L", "R"])
        for (const [name, where, r, keys] of POINTS(sd)) {
          const at = where.startsWith("hand")
            ? rt.hand(sd)
            : where.startsWith("sole")
              ? steve.soleAt(sd, new THREE.Vector3())
              : steve.bones[where].getWorldPosition(new THREE.Vector3());
          worst(`inside ${name} in him`, rt.depth(at, keys, r) * 100, t);
        }
      // his head (a ball inside its 8 px cube) in his legs: a human head fits between the knees in a deep bend, his doesn't
      const headMid = headRestMid
        .clone()
        .applyMatrix4(new THREE.Matrix4().copy(steve.bones.head.matrixWorld).multiply(headRestInv));
      worst(
        "inside head in legs",
        rt.depth(headMid, ["ulL", "ulR", "llL", "llR"], 3.5 * PXM) * 100,
        t,
      );
      // the neck: his head against his chest, from their rests (past ~80 the box head reads broken)
      q.copy(steve.bones.chest.getWorldQuaternion(new THREE.Quaternion()).multiply(chestRest))
        .invert()
        .multiply(steve.bones.head.getWorldQuaternion(new THREE.Quaternion()).multiply(headRest));
      worst("neck turn (deg)", 2 * Math.acos(Math.min(1, Math.abs(q.w))) * D, t);
      for (const sd of ["L", "R"]) soles[sd].push(steve.soleAt(sd, v).clone());
      // jumps: a joint of his moving between frames, from the joint it hangs on, further than the source's does (scaled by
      // the two limbs' lengths: his arms are long for his legs) is a pop the retarget made; the root against the hips
      for (const [j, [mine, src]] of Object.entries(JOINTS)) {
        const a = mine(),
          s0 = sk.at(src[0]).sub(src[1] ? sk.at(src[1]) : ZERO);
        if (!(j in ratio)) ratio[j] = j === "root" ? rt.k : a.length() / s0.length();
        if (prev[j] && i > 0)
          worst(
            `jump ${j} (beyond the source's own move, per frame)`,
            (a.distanceTo(prev[j][0]) - ratio[j] * s0.distanceTo(prev[j][1])) * 100,
            t,
          );
        prev[j] = [a, s0];
      }
      // spin: a bone of his turning between frames more than the source's bone turns (a twist flip moves no joint)
      for (const [key, r] of Object.entries(SPIN)) {
        const a = steve.bones[key].getWorldQuaternion(new THREE.Quaternion()),
          s0 = sk.quat(r);
        if (prevQ[key] && i > 0)
          worst(
            `spin ${key} (deg per frame beyond the source's)`,
            a.angleTo(prevQ[key][0]) * D - s0.angleTo(prevQ[key][1]) * D,
            t,
          );
        prevQ[key] = [a, s0];
      }
      if (cfg.lab.log)
        await log(
          `${t.toFixed(2)} ${JSON.stringify({ ...m, pose: p }, (k, x) => (typeof x === "number" ? Math.round(x * 100) / 100 : x))}`,
        );
      if (!stills || t < Number(cfg.lab.from ?? 0) || t > Number(cfg.lab.to ?? Infinity)) continue;
      for (const [k, [who, off]] of P.entries()) {
        show(who);
        const zoom = Number(cfg.lab.zoom ?? 1);
        const joint = zoom > 1 ? "neck" : "hips",
          bone = zoom > 1 ? steve.bones.head : steve.bones.root;
        if (who === "src") sk.at(joint, hipsAt);
        else bone.getWorldPosition(hipsAt);
        const look = new THREE.Vector3(hipsAt.x, zoom > 1 ? hipsAt.y + 0.15 : 0.8, hipsAt.z);
        cam.position.set(look.x + off[0] / zoom, look.y + off[1] / zoom, look.z + off[2] / zoom);
        cam.up.set(0, 1, 0);
        cam.lookAt(look);
        const x = (k % 4) * pw,
          y = (1 - Math.floor(k / 4)) * ph;
        renderer.setViewport(x, y, pw, ph);
        renderer.setScissor(x, y, pw, ph);
        renderer.render(scene, cam);
      }
      show("both");
      await still(`mocap_${clipName}_${String(i).padStart(3, "0")}.jpg`, c);
    }
    // A sole within 3 cm of the floor counts as planted: how far it moves frame to frame there
    for (const sd of ["L", "R"]) {
      let slide = 0;
      for (let i = 1; i < soles[sd].length; i++) {
        const a = soles[sd][i - 1],
          b = soles[sd][i];
        if (a.y < 0.03 && b.y < 0.03) slide += Math.hypot(b.x - a.x, b.z - a.z);
      }
      stats[`planted slide ${sd} (cm, before foot locking)`] = { val: slide * 100, t: 0 };
    }
    for (const [k, g] of Object.entries(gaps)) {
      g.sort((x, y) => x - y);
      stats[`hinge gap ${k} median (deg)`] = { val: g[g.length >> 1], t: 0 };
      stats[`hinge gap ${k} 90th (deg)`] = { val: g[Math.floor(g.length * 0.9)], t: 0 };
    }
    if (fps < 30) for (const x of Object.keys(stats)) if (/^(jump|spin)/.test(x)) delete stats[x]; // only meaningful frame to frame at 30 fps
    mixer.stopAllAction();
    mixer.uncacheRoot(src.scene);
    if (stills) scene.remove(...src.show);
    return { stats, rest, frames: n + 1, duration: clip.duration };
  };

  if (cfg.lab.clips) {
    const names = cfg.lab.clips !== "all" ? cfg.lab.clips.split(",") : await clipNames(libName);
    for (const name of names) {
      try {
        const r = await run(name, { sweep: true });
        await log(
          `ROW ${JSON.stringify({ clip: name, rest: r.rest, s: Object.fromEntries(Object.entries(r.stats).map(([k, x]) => [k, [+x.val.toFixed(2), +x.t.toFixed(2)]])) })}`,
        );
      } catch (e) {
        await log(`ROW ${JSON.stringify({ clip: name, error: String(e?.message ?? e) })}`);
      }
    }
  } else {
    const clipName = cfg.lab.clip ?? "PickUp_Table";
    const r = await run(clipName, { stills: !cfg.lab.numbers });
    const unit = (k) =>
      /^(direction|spin|neck|hinge)/.test(k)
        ? "deg"
        : k.startsWith("planted") || k.startsWith("not")
          ? ""
          : "cm";
    for (const [k, s] of Object.entries(r.stats))
      await log(`${clipName} | ${k}: ${s.val.toFixed(1)} ${unit(k)} at ${s.t.toFixed(2)} s`);
    await log(
      `${clipName}: ${r.frames} frames, ${r.duration.toFixed(2)} s, rest neck above hips ${r.rest.up.toFixed(2)} m, hips at ${r.rest.hips.toFixed(2)} m`,
    );
  }
  await done();
})();
