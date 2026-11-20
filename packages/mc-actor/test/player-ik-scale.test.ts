import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { makeFeet } from "../src/feet";
import { retargeter } from "../src/mocap";
import { GESTURES, makePlayer, PX } from "../src/player";

function makeStubCanvas(w = 64, h = 64) {
  const data = new Uint8ClampedArray(w * h * 4);
  data.fill(180);
  const canvas = {
    width: w,
    height: h,
    getContext() {
      return ctx;
    },
  };
  const ctx = {
    canvas,
    fillStyle: "#000000",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    save() {},
    restore() {},
    clearRect() {},
    fillRect() {},
    drawImage() {},
    getImageData(_x: number, _y: number, rw: number, rh: number) {
      return { data: new Uint8ClampedArray(rw * rh * 4).fill(180) };
    },
  };
  return canvas;
}

async function loadPlayerTemplate(): Promise<THREE.Object3D> {
  const vaultRoot = process.env.MC_VAULT_ROOT;
  const glbPath = vaultRoot ? join(vaultRoot, "mcprep/player.glb") : null;
  if (glbPath && existsSync(glbPath)) {
    const buf = readFileSync(glbPath);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const gltf = await new Promise<{ scene: THREE.Object3D }>((res, rej) =>
      new GLTFLoader().parse(ab, "", res, rej),
    );
    return gltf.scene;
  }

  const template = new THREE.Group();
  const bone = (name: string, x: number, y: number, z: number) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    return b;
  };
  const root = bone("center", 0, 12 * PX, 0);
  const body = bone("Body", 0, 0, 0);
  const chest = bone("Chest", 0, 6 * PX, 0);
  const head = bone("Head", 0, 6 * PX, 0);
  const uaL = bone("ArmLeftUpper", 6 * PX, 4 * PX, 0);
  const laL = bone("ArmLeftLower", 0, -6 * PX, 0);
  const uaR = bone("ArmRightUpper", -6 * PX, 4 * PX, 0);
  const laR = bone("ArmRightLower", 0, -6 * PX, 0);
  const ulL = bone("LegLeftUpper", 2 * PX, 0, 0);
  const llL = bone("LegLeftLower", 0, -6 * PX, 0);
  const ulR = bone("LegRightUpper", -2 * PX, 0, 0);
  const llR = bone("LegRightLower", 0, -6 * PX, 0);
  template.add(root);
  root.add(body, ulL, ulR);
  body.add(chest);
  chest.add(head, uaL, uaR);
  uaL.add(laL);
  uaR.add(laR);
  ulL.add(llL);
  ulR.add(llR);

  // Add a simple skinned box per bone so bodyBoxes() / retargeter({ floor: true, own: true }) work on fallback rigs too
  template.updateMatrixWorld(true);
  const bones = [root, body, chest, head, uaL, laL, uaR, laR, ulL, llL, ulR, llR];
  const boxes: Array<[number, number, number, number, number, number, number]> = [
    [1, 0, 15 * PX, 0, 8 * PX, 6 * PX, 4 * PX], // body
    [2, 0, 21 * PX, 0, 8 * PX, 6 * PX, 4 * PX], // chest
    [3, 0, 28 * PX, 0, 8 * PX, 8 * PX, 8 * PX], // head
    [4, 6 * PX, 21 * PX, 0, 4 * PX, 6 * PX, 4 * PX], // uaL
    [5, 6 * PX, 15 * PX, 0, 4 * PX, 6 * PX, 4 * PX], // laL
    [6, -6 * PX, 21 * PX, 0, 4 * PX, 6 * PX, 4 * PX], // uaR
    [7, -6 * PX, 15 * PX, 0, 4 * PX, 6 * PX, 4 * PX], // laR
    [8, 2 * PX, 9 * PX, 0, 4 * PX, 6 * PX, 4 * PX], // ulL
    [9, 2 * PX, 3 * PX, 0, 4 * PX, 6 * PX, 4 * PX], // llL
    [10, -2 * PX, 9 * PX, 0, 4 * PX, 6 * PX, 4 * PX], // ulR
    [11, -2 * PX, 3 * PX, 0, 4 * PX, 6 * PX, 4 * PX], // llR
  ];
  const skeleton = new THREE.Skeleton(bones);
  for (const [boneIdx, cx, cy, cz, w, h, d] of boxes) {
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.translate(cx, cy, cz);
    const count = geo.attributes.position.count;
    const si = new Uint16Array(count * 4);
    const sw = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      si[i * 4] = boneIdx;
      sw[i * 4] = 1;
    }
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
    const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
    mesh.name = `Part_${boneIdx}`;
    mesh.bind(skeleton);
    template.add(mesh);
  }
  return template;
}

const prevDoc = (globalThis as { document?: unknown }).document;
afterEach(() => {
  (globalThis as { document?: unknown }).document = prevDoc;
});

async function createRig() {
  (globalThis as { document?: unknown }).document = {
    createElement: () => makeStubCanvas(64, 64),
  };
  const template = await loadPlayerTemplate();
  const player = await makePlayer(template, makeStubCanvas(64, 64), { face: "skin" });
  player.setPose({});
  player.g.updateMatrixWorld(true);

  const armEndLocal = (sd: "L" | "R") => {
    const e0 = player.bones[`la${sd}`].getWorldPosition(new THREE.Vector3());
    const endY = 12 * PX - 0.02;
    return player.bones[`la${sd}`].worldToLocal(new THREE.Vector3(e0.x, endY, e0.z));
  };
  const armReach = (sd: "L" | "R") => {
    const s0 = player.bones[`ua${sd}`].getWorldPosition(new THREE.Vector3());
    const e0 = player.bones[`la${sd}`].getWorldPosition(new THREE.Vector3());
    const l1 = s0.distanceTo(e0);
    const l2 = Math.max(0.05, e0.y - (12 * PX - 0.02));
    return l1 + l2;
  };
  const headRest = () => {
    const h0 = player.bones.head.getWorldPosition(new THREE.Vector3());
    return {
      centerLocal: player.bones.head.worldToLocal(h0.clone().add(new THREE.Vector3(0, 4 * PX, 0))),
      forwardLocal: player.bones.head.worldToLocal(h0.clone().add(new THREE.Vector3(0, 4 * PX, 1))),
    };
  };

  return {
    player,
    handEndL: armEndLocal("L"),
    handEndR: armEndLocal("R"),
    baseArmReachR: armReach("R"),
    baseLegReach: player.legReach,
    headFrame: headRest(),
  };
}

describe("mc-actor scale-aware IK and feet", () => {
  test("armTo places the hand end on reachable targets across uniform, non-uniform, and parent scales", async () => {
    const cases: Array<{
      label: string;
      scale: [number, number, number];
      chest?: [number, number, number];
    }> = [
      { label: "kid 0.6", scale: [0.6, 0.6, 0.6] },
      { label: "unit 1.0", scale: [1, 1, 1] },
      { label: "tall 1.6", scale: [1.6, 1.6, 1.6] },
      {
        label: "non-uniform bully [1.3, 1.55, 1.3] leaning",
        scale: [1.3, 1.55, 1.3],
        chest: [16, -12, 0],
      },
    ];

    for (const c of cases) {
      const { player, handEndR, handEndL } = await createRig();
      player.g.position.set(1.2, 0.1, -0.8);
      player.g.rotation.y = 0.45;
      player.g.scale.set(...c.scale);

      const basePose = c.chest ? { chest: c.chest } : {};
      player.setPose(basePose);
      player.g.updateMatrixWorld(true);

      const shoulderR = player.bones.uaR.getWorldPosition(new THREE.Vector3());
      const offsetR = new THREE.Vector3(
        0.08 * c.scale[0],
        -0.22 * c.scale[1],
        0.34 * c.scale[2],
      ).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.45);
      const targetR = shoulderR.clone().add(offsetR);
      const armR = player.armTo("R", targetR);
      player.setPose({ ...basePose, ...armR });
      player.g.updateMatrixWorld(true);
      const actualR = player.bones.laR.localToWorld(handEndR.clone());
      expect(actualR.distanceTo(targetR), `${c.label} armTo(R)`).toBeLessThan(0.01);

      // Pole-guided arm IK must also hit exact scaled targets
      player.setPose(basePose);
      player.g.updateMatrixWorld(true);
      const shoulderL = player.bones.uaL.getWorldPosition(new THREE.Vector3());
      const offsetL = new THREE.Vector3(
        -0.08 * c.scale[0],
        -0.15 * c.scale[1],
        0.36 * c.scale[2],
      ).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.45);
      const targetL = shoulderL.clone().add(offsetL);
      const armL = player.armTo("L", targetL, [0.6, -1, 0.25]);
      player.setPose({ ...basePose, ...armL });
      player.g.updateMatrixWorld(true);
      const actualL = player.bones.laL.localToWorld(handEndL.clone());
      expect(actualL.distanceTo(targetL), `${c.label} armTo(L, pole)`).toBeLessThan(0.01);
    }

    // Scaled & rotated parent group
    const { player, handEndR } = await createRig();
    const parent = new THREE.Group();
    parent.position.set(-2, 0.5, 3);
    parent.rotation.y = -0.8;
    parent.scale.set(1.25, 1.45, 1.25);
    parent.add(player.g);
    player.setPose({});
    parent.updateMatrixWorld(true);

    const shoulder = player.bones.uaR.getWorldPosition(new THREE.Vector3());
    const target = shoulder.clone().add(new THREE.Vector3(-0.35, -0.25, 0.3));
    const arm = player.armTo("R", target);
    player.setPose(arm);
    parent.updateMatrixWorld(true);
    const actual = player.bones.laR.localToWorld(handEndR.clone());
    expect(actual.distanceTo(target), "scaled parent armTo(R)").toBeLessThan(0.01);
  });

  test("armTo clamps out-of-reach targets proportionally to scale and points toward the target", async () => {
    for (const s of [0.6, 1.0, 1.6]) {
      const { player, handEndR, baseArmReachR } = await createRig();
      player.g.scale.setScalar(s);
      player.setPose({});
      player.g.updateMatrixWorld(true);

      const shoulder = player.bones.uaR.getWorldPosition(new THREE.Vector3());
      const dir = new THREE.Vector3(0.2, 0.3, 1).normalize();
      // 1.15 * scaled reach: for s = 0.6 this is < unscaled reach, proving clamp uses scaled reach not unit reach
      const farTarget = shoulder.clone().addScaledVector(dir, s * baseArmReachR * 1.15);
      const arm = player.armTo("R", farTarget);
      player.setPose(arm);
      player.g.updateMatrixWorld(true);

      const actual = player.bones.laR.localToWorld(handEndR.clone());
      const vec = actual.clone().sub(shoulder);
      expect(Math.abs(vec.length() - s * baseArmReachR), `scale ${s} reach`).toBeLessThan(0.01);
      expect(vec.normalize().dot(dir), `scale ${s} aim`).toBeGreaterThan(0.998);
    }

    // Non-uniform scale clamps along each axis by that axis's scale and keeps diagonal aim true in world space
    const { player, handEndR, baseArmReachR } = await createRig();
    player.g.scale.set(1.3, 1.55, 1.3);
    player.setPose({});
    player.g.updateMatrixWorld(true);
    const shoulder = player.bones.uaR.getWorldPosition(new THREE.Vector3());

    const armFwd = player.armTo("R", shoulder.clone().add(new THREE.Vector3(0, 0, 5)));
    player.setPose(armFwd);
    player.g.updateMatrixWorld(true);
    const reachFwd = player.bones.laR.localToWorld(handEndR.clone()).distanceTo(shoulder);
    expect(Math.abs(reachFwd - 1.3 * baseArmReachR)).toBeLessThan(0.01);

    player.setPose({});
    player.g.updateMatrixWorld(true);
    const armUp = player.armTo("R", shoulder.clone().add(new THREE.Vector3(0, 5, 0)));
    player.setPose(armUp);
    player.g.updateMatrixWorld(true);
    const reachUp = player.bones.laR.localToWorld(handEndR.clone()).distanceTo(shoulder);
    expect(Math.abs(reachUp - 1.55 * baseArmReachR)).toBeLessThan(0.01);

    player.setPose({});
    player.g.updateMatrixWorld(true);
    const diagDir = new THREE.Vector3(0, 1, 1).normalize();
    const armDiag = player.armTo("R", shoulder.clone().addScaledVector(diagDir, 5));
    player.setPose(armDiag);
    player.g.updateMatrixWorld(true);
    const diagActual = player.bones.laR.localToWorld(handEndR.clone()).sub(shoulder).normalize();
    expect(diagActual.dot(diagDir), "non-uniform diagonal out-of-reach aim").toBeGreaterThan(0.998);
  });

  test("legTo places the sole on reachable targets and clamps reach across uniform, non-uniform, and lying transforms", async () => {
    const cases: Array<{ label: string; scale: [number, number, number]; rotX?: number }> = [
      { label: "kid 0.6", scale: [0.6, 0.6, 0.6] },
      { label: "unit 1.0", scale: [1, 1, 1] },
      { label: "tall 1.6", scale: [1.6, 1.6, 1.6] },
      { label: "non-uniform [1.3, 1.55, 1.3]", scale: [1.3, 1.55, 1.3] },
      { label: "lying scaled 1.4", scale: [1.4, 1.4, 1.4], rotX: -Math.PI / 2 },
    ];

    for (const c of cases) {
      const { player } = await createRig();
      player.g.position.set(-0.5, 0, 1.1);
      player.g.scale.set(...c.scale);
      if (c.rotX) player.g.rotation.x = c.rotX;

      // Start with a bent knee so legTo preserves the forward knee plane
      const startPose = { ulR: [-25, 0, 0], llR: [50, 0, 0] };
      player.setPose(startPose);
      player.g.updateMatrixWorld(true);

      const hip = player.bones.ulR.getWorldPosition(new THREE.Vector3());
      const localOffset = new THREE.Vector3(0.05, -0.52, 0.25);
      const scaledLocal = new THREE.Vector3(
        localOffset.x * c.scale[0],
        localOffset.y * c.scale[1],
        localOffset.z * c.scale[2],
      );
      if (c.rotX) scaledLocal.applyAxisAngle(new THREE.Vector3(1, 0, 0), c.rotX);
      const target = hip.clone().add(scaledLocal);

      const leg = player.legTo("R", target);
      player.setPose(leg);
      player.g.updateMatrixWorld(true);
      const actual = player.soleAt("R");
      expect(actual.distanceTo(target), `${c.label} legTo(R)`).toBeLessThan(0.01);
    }

    // Out-of-reach clamping scales proportionally with g.scale
    for (const s of [0.6, 1.6]) {
      const { player, baseLegReach } = await createRig();
      player.g.scale.setScalar(s);
      player.setPose({});
      player.g.updateMatrixWorld(true);
      const hip = player.bones.ulL.getWorldPosition(new THREE.Vector3());
      const dir = new THREE.Vector3(0, -0.8, 0.6).normalize();
      const far = hip.clone().addScaledVector(dir, 5);
      const leg = player.legTo("L", far);
      player.setPose(leg);
      player.g.updateMatrixWorld(true);
      const actual = player.soleAt("L");
      const vec = actual.clone().sub(hip);
      expect(Math.abs(vec.length() - s * baseLegReach), `scale ${s} leg clamp`).toBeLessThan(0.01);
      expect(vec.normalize().dot(dir), `scale ${s} leg aim`).toBeGreaterThan(0.998);
    }
  });

  test("headTo aims from the scaled and oriented head center on tall and lying actors", async () => {
    // 1. Tall scaled actor (scale = 1.5): target level with the SCALED head center must yield ~0 pitch
    {
      const { player, headFrame } = await createRig();
      player.g.scale.setScalar(1.5);
      player.setPose({});
      player.g.updateMatrixWorld(true);

      const headPivot = player.bones.head.getWorldPosition(new THREE.Vector3());
      const scaledCenter = headPivot.clone().add(new THREE.Vector3(0, 1.5 * 4 * PX, 0));
      const levelTarget = scaledCenter.clone().add(new THREE.Vector3(0, 0, 0.6));
      const [down, yaw] = player.headTo(levelTarget);
      expect(Math.abs(down), "scaled level target pitch").toBeLessThan(0.5);
      expect(Math.abs(yaw), "scaled level target yaw").toBeLessThan(0.5);

      // Angled target verified by casting the face forward vector in world space
      const angledTarget = scaledCenter.clone().add(new THREE.Vector3(0.35, -0.22, 0.9));
      const head = player.headTo(angledTarget);
      player.setPose({ head });
      player.g.updateMatrixWorld(true);
      const cWorld = player.bones.head.localToWorld(headFrame.centerLocal.clone());
      const fWorld = player.bones.head.localToWorld(headFrame.forwardLocal.clone());
      const gazeDir = fWorld.sub(cWorld).normalize();
      const wantDir = angledTarget.clone().sub(scaledCenter).normalize();
      expect(gazeDir.dot(wantDir), "scaled angled gaze alignment").toBeGreaterThan(0.999);
    }

    // 2. Lying actor via g.rotation.x = -Math.PI / 2 (feet at origin, head toward -Z, face looking +Y)
    {
      const { player, headFrame } = await createRig();
      player.g.rotation.x = -Math.PI / 2;
      player.g.scale.setScalar(1.3);
      player.setPose({});
      player.g.updateMatrixWorld(true);

      const headCenterWorld = player.bones.head.localToWorld(headFrame.centerLocal.clone());
      // Directly in front of the lying face (+Y above head center)
      const straightAbove = headCenterWorld.clone().add(new THREE.Vector3(0, 0.8, 0));
      const [down0, yaw0] = player.headTo(straightAbove);
      expect(Math.abs(down0), "lying straight-above pitch").toBeLessThan(0.5);
      expect(Math.abs(yaw0), "lying straight-above yaw").toBeLessThan(0.5);

      // Off-axis target in front of the lying face
      const offAxis = headCenterWorld.clone().add(new THREE.Vector3(0.4, 1.0, -0.35));
      const head = player.headTo(offAxis);
      player.setPose({ head });
      player.g.updateMatrixWorld(true);
      const cWorld = player.bones.head.localToWorld(headFrame.centerLocal.clone());
      const fWorld = player.bones.head.localToWorld(headFrame.forwardLocal.clone());
      const gazeDir = fWorld.sub(cWorld).normalize();
      const wantDir = offAxis.clone().sub(headCenterWorld).normalize();
      expect(gazeDir.dot(wantDir), "lying off-axis gaze alignment").toBeGreaterThan(0.999);
    }

    // 3. Lying actor via pose (GESTURES.lie() tilts root rx = -90)
    {
      const { player, headFrame } = await createRig();
      const lieBody = { root: GESTURES.lie().root };
      player.setPose(lieBody);
      player.g.updateMatrixWorld(true);

      const headCenterWorld = player.bones.head.localToWorld(headFrame.centerLocal.clone());
      const straightAbove = headCenterWorld.clone().add(new THREE.Vector3(0, 0.7, 0));
      const [down, yaw] = player.headTo(straightAbove);
      expect(Math.abs(down), "pose-lying straight-above pitch").toBeLessThan(0.5);
      expect(Math.abs(yaw), "pose-lying straight-above yaw").toBeLessThan(0.5);
    }

    // 4. Non-uniform scaled leaning actor ([1.3, 1.55, 1.3]): world gaze ray hits angled target accurately
    {
      const { player, headFrame } = await createRig();
      player.g.scale.set(1.3, 1.55, 1.3);
      const basePose = { chest: [12, -15, 0] };
      player.setPose(basePose);
      player.g.updateMatrixWorld(true);

      const headCenterWorld = player.bones.head.localToWorld(headFrame.centerLocal.clone());
      const target = headCenterWorld.clone().add(new THREE.Vector3(0.4, -0.3, 1.2));
      const head = player.headTo(target);
      player.setPose({ ...basePose, head });
      player.g.updateMatrixWorld(true);
      const cWorld = player.bones.head.localToWorld(headFrame.centerLocal.clone());
      const fWorld = player.bones.head.localToWorld(headFrame.forwardLocal.clone());
      const gazeDir = fWorld.sub(cWorld).normalize();
      const wantDir = target.clone().sub(headCenterWorld).normalize();
      expect(gazeDir.dot(wantDir), "non-uniform leaning gaze alignment").toBeGreaterThan(0.998);
    }
  });

  test("legReach reflects current world scale dynamically and makeFeet avoids premature strain steps on tall actors", async () => {
    const { player, baseLegReach } = await createRig();

    // Dynamic getter responds to g.scale without requiring manual updateMatrixWorld first
    player.g.scale.setScalar(1.6);
    expect(player.legReach).toBeCloseTo(baseLegReach * 1.6, 5);

    player.g.scale.set(1.3, 1.55, 1.3);
    expect(player.legReach).toBeCloseTo(baseLegReach * 1.55, 5);

    player.g.scale.setScalar(0.6);
    expect(player.legReach).toBeCloseTo(baseLegReach * 0.6, 5);

    // Parent group scale is reflected too
    const parent = new THREE.Group();
    parent.scale.setScalar(1.4);
    player.g.scale.setScalar(1.0);
    parent.add(player.g);
    expect(player.legReach).toBeCloseTo(baseLegReach * 1.4, 5);
    parent.remove(player.g);

    // Standing tall actor (scale = 1.6) must stay locked (mode "l1"), never triggering false strain steps ("s1")
    player.g.scale.setScalar(1.6);
    player.g.position.set(0, 0, 0);
    player.g.rotation.set(0, 0, 0);
    player.setPose({});
    player.g.updateMatrixWorld(true);

    const standingBody = () => ({ at: [0, 0, 0], yaw: 0, pose: {}, gait: null });
    const standMoves = [{ t: 0, at: [0, 0, 0], yaw: 0 }];
    const standFeet = makeFeet(player, () => 1.0, standingBody, {});
    for (let t = 0.05; t <= 0.95; t += 0.1) {
      const f = standFeet(standMoves, t);
      expect(f.mode("L"), `tall standing L at t=${t.toFixed(2)}`).toBe("l1");
      expect(f.mode("R"), `tall standing R at t=${t.toFixed(2)}`).toBe("l1");
    }

    // Small drift inside a tall actor's scaled comfort radius stays locked, while large slide triggers a step
    const slideBody = (_m: unknown, t: number) => ({
      at: [0, 0, t > 0.2 ? Math.min(1.0, (t - 0.2) * 1.5) : 0],
      yaw: 0,
      pose: {},
      gait: null,
    });
    const slideMoves = [{ t: 0, at: [0, 0, 0], yaw: 0 }];
    const slideFeet = makeFeet(player, () => 1.5, slideBody, {});
    let stepped = false;
    for (let t = 0.25; t <= 1.4; t += 0.05) {
      if (slideFeet(slideMoves, t).mode("L").startsWith("s")) {
        stepped = true;
        break;
      }
    }
    expect(stepped, "tall actor still takes a real step when moving far").toBe(true);
  });

  test("makeFeet scales drift and floor-height thresholds and stays synced with parent and rig transforms", async () => {
    // 1. Tall (1.6) stays locked on 0.20m drift (< 0.16 * 1.6 = 0.256m), kid (0.6) steps on 0.12m drift (> 0.16 * 0.6 = 0.096m)
    {
      const { player } = await createRig();
      player.g.scale.setScalar(1.6);
      const tallDriftBody = (_m: unknown, t: number) => ({
        at: [0, 0, t > 0.2 ? Math.min(0.2, (t - 0.2) * 0.4) : 0],
        yaw: 0,
        pose: { root: { y: -0.04 } }, // slight knee slack so 0.20m drift isn't leg-strained
        gait: null,
      });
      const moves = [{ t: 0, at: [0, 0, 0], yaw: 0 }];
      const feet = makeFeet(player, () => 1.2, tallDriftBody, {});
      for (let t = 0.05; t <= 1.1; t += 0.05) {
        expect(feet(moves, t).mode("L"), `tall 0.20m drift L at t=${t.toFixed(2)}`).toBe("l1");
      }
    }
    {
      const { player } = await createRig();
      player.g.scale.setScalar(0.6);
      const kidDriftBody = (_m: unknown, t: number) => ({
        at: [0, 0, t > 0.2 ? Math.min(0.12, (t - 0.2) * 0.5) : 0],
        yaw: 0,
        pose: { root: { y: -0.05 } },
        gait: null,
      });
      const moves = [{ t: 0, at: [0, 0, 0], yaw: 0 }];
      const feet = makeFeet(player, () => 1.2, kidDriftBody, {});
      let stepped = false;
      for (let t = 0.25; t <= 1.1; t += 0.05) {
        if (feet(moves, t).mode("L").startsWith("s")) {
          stepped = true;
          break;
        }
      }
      expect(stepped, "kid 0.6 steps on 0.12m drift").toBe(true);
    }

    // 2. Scaled height threshold: sole held at world y = 0.06 via knee bend (hip stays at legReach, never strained)
    //    is off-floor ("f0") on kid (0.6, downH=0.03) but grounded ("l1") on tall (1.6, downH=0.08)
    for (const [scale, wantMode] of [
      [0.6, "f0"],
      [1.6, "l1"],
    ] as const) {
      const { player } = await createRig();
      player.g.scale.setScalar(scale);
      const aDeg = (Math.acos(1 - 0.06 / player.legReach) * 180) / Math.PI;
      const body = () => ({
        at: [0, 0, 0],
        yaw: 0,
        pose: { ulL: [-aDeg, 0, 0], llL: [2 * aDeg, 0, 0] },
        gait: null,
      });
      const moves = [{ t: 0, at: [0, 0, 0], yaw: 0 }];
      const feet = makeFeet(player, () => 0.5, body, {});
      expect(feet(moves, 0.2).mode("L"), `scale=${scale} sole y=0.06`).toBe(wantMode);
    }

    // 3. Parent-scaled + offset (0.6 and 1.6) AND rig.scale-modified actors match soleAt and stay locked standing
    for (const s of [0.6, 1.6]) {
      const { player } = await createRig();
      const parent = new THREE.Group();
      parent.position.set(2, 0, -1);
      parent.scale.setScalar(s);
      parent.add(player.g);

      const body = () => ({ at: [0, 0, 0], yaw: 0, pose: {}, gait: null });
      const moves = [{ t: 0, at: [0, 0, 0], yaw: 0 }];
      const feet = makeFeet(player, () => 0.8, body, {});
      const f = feet(moves, 0.4);
      expect(f.mode("L"), `parent scale=${s} L locked`).toBe("l1");
      expect(f.mode("R"), `parent scale=${s} R locked`).toBe("l1");

      player.g.position.set(0, 0, 0);
      player.g.rotation.set(0, 0, 0);
      player.setPose({});
      parent.updateMatrixWorld(true);
      expect(
        f.L!.distanceTo(player.soleAt("L")),
        `parent scale=${s} L matches soleAt`,
      ).toBeLessThan(1e-4);
      expect(
        f.R!.distanceTo(player.soleAt("R")),
        `parent scale=${s} R matches soleAt`,
      ).toBeLessThan(1e-4);
    }

    {
      const { player } = await createRig();
      player.rig.scale.setScalar(1.6);
      const body = () => ({ at: [0, 0, 0], yaw: 0, pose: {}, gait: null });
      const moves = [{ t: 0, at: [0, 0, 0], yaw: 0 }];
      const feet = makeFeet(player, () => 0.8, body, {});
      const f = feet(moves, 0.4);
      expect(f.mode("L"), "rig.scale=1.6 L locked").toBe("l1");
      expect(f.mode("R"), "rig.scale=1.6 R locked").toBe("l1");

      player.g.position.set(0, 0, 0);
      player.g.rotation.set(0, 0, 0);
      player.setPose({});
      player.g.updateMatrixWorld(true);
      expect(f.L!.distanceTo(player.soleAt("L")), "rig.scale=1.6 L matches soleAt").toBeLessThan(
        1e-4,
      );
      expect(f.R!.distanceTo(player.soleAt("R")), "rig.scale=1.6 R matches soleAt").toBeLessThan(
        1e-4,
      );
    }

    // 4. Parent rotation + non-zero actor at/yaw locks premultiply order (parentWorld * mG)
    {
      const { player } = await createRig();
      const parent = new THREE.Group();
      parent.position.set(1.5, 0, -2.5);
      parent.rotation.y = 0.7;
      parent.scale.setScalar(1.4);
      parent.add(player.g);

      const body = () => ({ at: [0.6, 0, -0.4], yaw: 35, pose: {}, gait: null });
      const moves = [{ t: 0, at: [0.6, 0, -0.4], yaw: 35 }];
      const feet = makeFeet(player, () => 0.6, body, {});
      const f = feet(moves, 0.3);
      expect(f.mode("L"), "rotated parent L locked").toBe("l1");
      expect(f.mode("R"), "rotated parent R locked").toBe("l1");

      player.g.position.set(0.6, 0, -0.4);
      player.g.rotation.set(0, 35 * THREE.MathUtils.DEG2RAD, 0);
      player.setPose({});
      parent.updateMatrixWorld(true);
      expect(f.L!.distanceTo(player.soleAt("L")), "rotated parent L matches soleAt").toBeLessThan(
        1e-4,
      );
      expect(f.R!.distanceTo(player.soleAt("R")), "rotated parent R matches soleAt").toBeLessThan(
        1e-4,
      );
    }

    // 5. Non-uniform [1.6, 1.0, 1.6]: xzScale (1.6) keeps 0.20m drift locked while legScale (1.0) keeps y=0.06 off-floor
    {
      const { player } = await createRig();
      player.g.scale.set(1.6, 1.0, 1.6);
      const driftBody = (_m: unknown, t: number) => ({
        at: [0, 0, t > 0.2 ? Math.min(0.2, (t - 0.2) * 0.4) : 0],
        yaw: 0,
        pose: { root: { y: -0.05 } },
        gait: null,
      });
      const moves = [{ t: 0, at: [0, 0, 0], yaw: 0 }];
      const feet = makeFeet(player, () => 1.0, driftBody, {});
      for (let t = 0.05; t <= 0.95; t += 0.05) {
        expect(
          feet(moves, t).mode("L"),
          `non-uniform xzScale 0.20m drift at t=${t.toFixed(2)}`,
        ).toBe("l1");
      }

      const aDeg = (Math.acos(1 - 0.06 / player.legReach) * 180) / Math.PI;
      const liftBody = () => ({
        at: [0, 0, 0],
        yaw: 0,
        pose: { ulL: [-aDeg, 0, 0], llL: [2 * aDeg, 0, 0] },
        gait: null,
      });
      const liftFeet = makeFeet(player, () => 0.5, liftBody, {});
      expect(
        liftFeet(moves, 0.2).mode("L"),
        "non-uniform legScale=1.0 sole y=0.06 is off-floor",
      ).toBe("f0");
    }

    // 6. legsSig() invalidates on parent transform or rig.scale mutations without manual updateMatrixWorld,
    //    and stays invariant across g.position, g.rotation, and setPose
    {
      const { player } = await createRig();
      const sigBase = player.legsSig();
      player.g.position.set(4, 2, -3);
      player.g.rotation.set(0.3, 1.2, -0.4);
      player.setPose({ ulL: [-30, 0, 0], llL: [60, 0, 0] });
      expect(player.legsSig(), "legsSig invariant to g.position/rotation/setPose").toBe(sigBase);

      player.rig.scale.setScalar(1.3);
      const sigRig = player.legsSig();
      expect(sigRig, "legsSig changes on rig.scale").not.toBe(sigBase);
      player.rig.scale.setScalar(1);

      const parent = new THREE.Group();
      parent.add(player.g);
      const sigP0 = player.legsSig();
      parent.position.set(1, 0, 0);
      const sigPPos = player.legsSig();
      expect(sigPPos, "legsSig changes on parent.position").not.toBe(sigP0);
      parent.rotation.y = 0.5;
      const sigPRot = player.legsSig();
      expect(sigPRot, "legsSig changes on parent.rotation").not.toBe(sigPPos);
      parent.scale.setScalar(1.5);
      const sigPScale = player.legsSig();
      expect(sigPScale, "legsSig changes on parent.scale").not.toBe(sigPRot);
    }
  });

  test("retargeter scales world hip travel linearly on scaled actors and keeps soles grounded", async () => {
    const makeUprightMocapSource = () => {
      const shift = new THREE.Vector3();
      const base: Record<string, [number, number, number]> = {
        hips: [0, 0.9, 0],
        waist: [0, 1.15, 0],
        neck: [0, 1.5, 0],
        shoulderL: [0.22, 1.42, 0],
        elbowL: [0.22, 1.12, 0],
        wristL: [0.22, 0.84, 0],
        shoulderR: [-0.22, 1.42, 0],
        elbowR: [-0.22, 1.12, 0],
        wristR: [-0.22, 0.84, 0],
        hipL: [0.1, 0.9, 0],
        kneeL: [0.1, 0.48, 0],
        ankleL: [0.1, 0.06, 0],
        toeL: [0.1, 0.02, 0.14],
        hipR: [-0.1, 0.9, 0],
        kneeR: [-0.1, 0.48, 0],
        ankleR: [-0.1, 0.06, 0],
        toeR: [-0.1, 0.02, 0.14],
      };
      const idQ = new THREE.Quaternion();
      return {
        setShift(x: number, y: number, z: number) {
          shift.set(x, y, z);
        },
        update() {},
        atNow(role: string, out = new THREE.Vector3()) {
          const p = base[role]!;
          return out.set(p[0] + shift.x, p[1] + shift.y, p[2] + shift.z);
        },
        quatNow(_role: string, out = new THREE.Quaternion()) {
          return out.copy(idQ);
        },
        headNow() {
          return idQ.clone();
        },
      };
    };

    const runCase = async (scale: number, opts: { floor: boolean; own: boolean }) => {
      const { player, baseLegReach } = await createRig();
      player.g.scale.setScalar(scale);
      player.g.updateMatrixWorld(true);
      const src = makeUprightMocapSource();
      const rt = retargeter(src, player, opts);

      const srcLeg = 0.42 + 0.42;
      expect(rt.k, `scale=${scale} retargeter k uses unscaled restLegReach`).toBeCloseTo(
        baseLegReach / srcLeg,
        5,
      );

      // Move source forward 0.5m along +z while keeping feet on floor
      src.setShift(0, 0, 0.5);
      const pose = rt.pose(0);
      player.setPose(pose);
      player.g.updateMatrixWorld(true);

      const hipWorld = player.bones.root.getWorldPosition(new THREE.Vector3());
      const expectedZ = scale * (baseLegReach / srcLeg) * 0.5;
      expect(
        hipWorld.z,
        `scale=${scale} floor=${opts.floor} hip world travel scales linearly`,
      ).toBeCloseTo(expectedZ, 3);

      const soleL = player.soleAt("L");
      const soleR = player.soleAt("R");
      expect(
        Math.abs(Math.min(soleL.y, soleR.y)),
        `scale=${scale} floor=${opts.floor} soles stay grounded`,
      ).toBeLessThan(0.02);
    };

    for (const scale of [0.6, 1.6]) {
      await runCase(scale, { floor: false, own: false });
      await runCase(scale, { floor: true, own: true });
    }

    // Exact pose parity (including root.y on a crouched frame) with parent + g.scale + rig.scale all active,
    // and all three transforms restored afterward
    {
      const unit = await createRig();
      const scaled = await createRig();
      const parent = new THREE.Group();
      parent.position.set(3, 0.5, -2);
      parent.scale.setScalar(1.2);
      parent.add(scaled.player.g);
      scaled.player.g.position.set(0.4, 0.2, -0.6);
      scaled.player.g.rotation.set(0.1, 0.8, -0.2);
      scaled.player.g.scale.setScalar(1.4);
      scaled.player.rig.scale.setScalar(1.15);
      const gPosBefore = scaled.player.g.position.toArray();
      const gQuatBefore = scaled.player.g.quaternion.toArray();
      const gScaleBefore = scaled.player.g.scale.toArray();
      const rigScaleBefore = scaled.player.rig.scale.toArray();

      const srcUnit = makeUprightMocapSource();
      const srcScaled = makeUprightMocapSource();
      const rtUnit = retargeter(srcUnit, unit.player, { floor: true, own: true });
      const rtScaled = retargeter(srcScaled, scaled.player, { floor: true, own: true });

      // Crouched/lifted frame (hips shifted forward and down by 0.15m)
      srcUnit.setShift(0.1, -0.15, 0.35);
      srcScaled.setShift(0.1, -0.15, 0.35);
      const poseUnit = rtUnit.pose(0);
      const poseScaled = rtScaled.pose(0);

      expect(poseScaled.root.x).toBeCloseTo(poseUnit.root.x, 5);
      expect(poseScaled.root.y).toBeCloseTo(poseUnit.root.y, 5);
      expect(poseScaled.root.z).toBeCloseTo(poseUnit.root.z, 5);
      for (const joint of [
        "chest",
        "head",
        "uaL",
        "laL",
        "uaR",
        "laR",
        "ulL",
        "llL",
        "ulR",
        "llR",
      ]) {
        for (let i = 0; i < 3; i++) {
          expect(poseScaled[joint][i], `pose equality ${joint}[${i}]`).toBeCloseTo(
            poseUnit[joint][i],
            3,
          );
        }
      }
      expect(scaled.player.g.parent).toBe(parent);
      expect(scaled.player.g.position.toArray()).toEqual(gPosBefore);
      expect(scaled.player.g.quaternion.toArray()).toEqual(gQuatBefore);
      expect(scaled.player.g.scale.toArray()).toEqual(gScaleBefore);
      expect(scaled.player.rig.scale.toArray()).toEqual(rigScaleBefore);
    }
  });

  test("IK handles degenerate scales, mirrored scale, coincident targets, dirty matrices, and elbow pole direction", async () => {
    const allFinite = (vals: number[]) => vals.every((n) => Number.isFinite(n));

    // 1. Zero-scale guards ([0,0,0] and [1,0,1]) must never produce NaN or Infinity
    for (const scale of [
      [0, 0, 0],
      [1, 0, 1],
    ] as const) {
      const { player } = await createRig();
      player.g.scale.set(...scale);
      const target = new THREE.Vector3(0.3, 1.0, 0.5);
      const arm = player.armTo("R", target);
      const armP = player.armTo("L", target, [0.5, -1, 0.2]);
      const leg = player.legTo("R", target);
      const head = player.headTo(target);
      expect(allFinite([...arm.uaR, ...arm.laR]), `zero scale ${scale} armTo`).toBe(true);
      expect(allFinite([...armP.uaL, ...armP.laL]), `zero scale ${scale} armPole`).toBe(true);
      expect(allFinite([...leg.ulR, ...leg.llR]), `zero scale ${scale} legTo`).toBe(true);
      expect(allFinite(head), `zero scale ${scale} headTo`).toBe(true);
    }

    // 2. Negative/mirrored scale ([-1, 1, 1]): armTo and legTo still reach exact world targets without NaN
    {
      const { player, handEndR } = await createRig();
      player.g.scale.set(-1, 1, 1);
      player.setPose({});
      player.g.updateMatrixWorld(true);

      const shoulder = player.bones.uaR.getWorldPosition(new THREE.Vector3());
      const armTarget = shoulder.clone().add(new THREE.Vector3(-0.1, -0.25, 0.3));
      const arm = player.armTo("R", armTarget);
      expect(allFinite([...arm.uaR, ...arm.laR])).toBe(true);
      player.setPose(arm);
      player.g.updateMatrixWorld(true);
      expect(player.bones.laR.localToWorld(handEndR.clone()).distanceTo(armTarget)).toBeLessThan(
        0.01,
      );

      player.setPose({ ulR: [-25, 0, 0], llR: [50, 0, 0] });
      player.g.updateMatrixWorld(true);
      const hip = player.bones.ulR.getWorldPosition(new THREE.Vector3());
      const legTarget = hip.clone().add(new THREE.Vector3(-0.05, -0.5, 0.25));
      const leg = player.legTo("R", legTarget);
      expect(allFinite([...leg.ulR, ...leg.llR])).toBe(true);
      player.setPose(leg);
      player.g.updateMatrixWorld(true);
      expect(player.soleAt("R").distanceTo(legTarget)).toBeLessThan(0.01);

      const head = player.headTo(new THREE.Vector3(0.4, 1.5, 1.0));
      expect(allFinite(head)).toBe(true);
    }

    // 3. Coincident targets (target === shoulder / hip / headCenter) return finite numbers
    {
      const { player, headFrame } = await createRig();
      player.setPose({});
      player.g.updateMatrixWorld(true);
      const sh = player.bones.uaR.getWorldPosition(new THREE.Vector3());
      const hip = player.bones.ulR.getWorldPosition(new THREE.Vector3());
      const hc = player.bones.head.localToWorld(headFrame.centerLocal.clone());
      const a0 = player.armTo("R", sh);
      const ap0 = player.armTo("R", sh, [-1, -1, 0]);
      const l0 = player.legTo("R", hip);
      const h0 = player.headTo(hc);
      expect(allFinite([...a0.uaR, ...a0.laR])).toBe(true);
      expect(allFinite([...ap0.uaR, ...ap0.laR])).toBe(true);
      expect(allFinite([...l0.ulR, ...l0.llR])).toBe(true);
      expect(allFinite(h0)).toBe(true);
    }

    // 4. Dirty transforms without manual updateMatrixWorld(true) before calling armTo, legTo, and headTo
    {
      const { player, handEndR, headFrame } = await createRig();
      player.g.position.set(1.5, 0, -2.0);
      player.g.scale.setScalar(1.4);
      const prevSh = player.bones.uaR.getWorldPosition(new THREE.Vector3()).clone();
      const prevHip = player.bones.ulR.getWorldPosition(new THREE.Vector3()).clone();
      const prevHeadCenter = player.bones.head.localToWorld(headFrame.centerLocal.clone());

      // Mutate position WITHOUT calling updateMatrixWorld(true)
      const shift = new THREE.Vector3(1.0, 0.25, 0.5);
      player.g.position.add(shift);

      const armTarget = prevSh
        .clone()
        .add(shift)
        .add(new THREE.Vector3(0, -0.3, 0.45));
      const arm = player.armTo("R", armTarget);
      player.setPose(arm);
      player.g.updateMatrixWorld(true);
      expect(player.bones.laR.localToWorld(handEndR.clone()).distanceTo(armTarget)).toBeLessThan(
        0.01,
      );

      player.setPose({ ulR: [-25, 0, 0], llR: [50, 0, 0] });
      player.g.position.add(shift);
      const legTarget = prevHip
        .clone()
        .addScaledVector(shift, 2)
        .add(new THREE.Vector3(0.05, -0.7, 0.35));
      const leg = player.legTo("R", legTarget);
      player.setPose(leg);
      player.g.updateMatrixWorld(true);
      expect(player.soleAt("R").distanceTo(legTarget)).toBeLessThan(0.01);

      player.setPose({});
      player.g.position.add(shift);
      const headCenterNow = prevHeadCenter.clone().addScaledVector(shift, 3);
      const headTarget = headCenterNow.clone().add(new THREE.Vector3(0.4, -0.2, 1.0));
      const head = player.headTo(headTarget);
      player.setPose({ head });
      player.g.updateMatrixWorld(true);
      const cWorld = player.bones.head.localToWorld(headFrame.centerLocal.clone());
      const fWorld = player.bones.head.localToWorld(headFrame.forwardLocal.clone());
      expect(
        fWorld.sub(cWorld).normalize().dot(headTarget.clone().sub(headCenterNow).normalize()),
        "dirty headTo gaze alignment",
      ).toBeGreaterThan(0.998);
    }

    // 5. Elbow pole direction and legTo knee pole direction under scale
    {
      const { player, handEndL } = await createRig();
      player.g.scale.setScalar(1.5);
      player.setPose({});
      player.g.updateMatrixWorld(true);
      const sh = player.bones.uaL.getWorldPosition(new THREE.Vector3());
      const target = sh.clone().add(new THREE.Vector3(0, 0, 0.55));

      const downPose = player.armTo("L", target, [0, -1, 0]);
      player.setPose(downPose);
      player.g.updateMatrixWorld(true);
      const elbowDown = player.bones.laL.getWorldPosition(new THREE.Vector3());
      expect(player.bones.laL.localToWorld(handEndL.clone()).distanceTo(target)).toBeLessThan(0.01);

      player.setPose({});
      player.g.updateMatrixWorld(true);
      const outPose = player.armTo("L", target, [1, 0, 0]);
      player.setPose(outPose);
      player.g.updateMatrixWorld(true);
      const elbowOut = player.bones.laL.getWorldPosition(new THREE.Vector3());
      expect(player.bones.laL.localToWorld(handEndL.clone()).distanceTo(target)).toBeLessThan(0.01);

      expect(elbowDown.y, "down pole places elbow below shoulder").toBeLessThan(sh.y - 0.1);
      expect(elbowOut.x, "outward pole places elbow to character's left (+x)").toBeGreaterThan(
        sh.x + 0.1,
      );

      // legTo preserves a turned-out knee plane under scale
      player.setPose({ ulL: [-30, 50, 0], llL: [60, 0, 0] });
      player.g.updateMatrixWorld(true);
      const hip = player.bones.ulL.getWorldPosition(new THREE.Vector3());
      const soleTarget = hip.clone().add(new THREE.Vector3(0, -0.72, 0.1));
      const legTurned = player.legTo("L", soleTarget);
      player.setPose(legTurned);
      player.g.updateMatrixWorld(true);
      expect(player.soleAt("L").distanceTo(soleTarget)).toBeLessThan(0.01);
      const kneeWorld = player.bones.llL.getWorldPosition(new THREE.Vector3());
      expect(kneeWorld.x, "turned-out left knee bends outward (+x)").toBeGreaterThan(hip.x + 0.15);
    }

    // 6. armTo, legTo, and headTo work accurately when rig.scale !== 1 (non-uniform)
    {
      const { player, handEndR, headFrame } = await createRig();
      player.rig.scale.set(1.2, 1.5, 1.2);
      player.setPose({});
      player.g.updateMatrixWorld(true);

      const sh = player.bones.uaR.getWorldPosition(new THREE.Vector3());
      const armTarget = sh.clone().add(new THREE.Vector3(0.06, -0.35, 0.42));
      const arm = player.armTo("R", armTarget);
      player.setPose(arm);
      player.g.updateMatrixWorld(true);
      expect(player.bones.laR.localToWorld(handEndR.clone()).distanceTo(armTarget)).toBeLessThan(
        0.01,
      );

      player.setPose({ ulR: [-25, 0, 0], llR: [50, 0, 0] });
      player.g.updateMatrixWorld(true);
      const hip = player.bones.ulR.getWorldPosition(new THREE.Vector3());
      const legTarget = hip.clone().add(new THREE.Vector3(-0.04, -0.78, 0.25));
      const leg = player.legTo("R", legTarget);
      player.setPose(leg);
      player.g.updateMatrixWorld(true);
      expect(player.soleAt("R").distanceTo(legTarget)).toBeLessThan(0.01);

      player.setPose({});
      player.g.updateMatrixWorld(true);
      const hc = player.bones.head.localToWorld(headFrame.centerLocal.clone());
      const headTarget = hc.clone().add(new THREE.Vector3(0.3, -0.25, 1.1));
      const head = player.headTo(headTarget);
      player.setPose({ head });
      player.g.updateMatrixWorld(true);
      const cWorld = player.bones.head.localToWorld(headFrame.centerLocal.clone());
      const fWorld = player.bones.head.localToWorld(headFrame.forwardLocal.clone());
      expect(
        fWorld.sub(cWorld).normalize().dot(headTarget.clone().sub(hc).normalize()),
        "rig.scale headTo gaze alignment",
      ).toBeGreaterThan(0.998);
    }
  });
});
