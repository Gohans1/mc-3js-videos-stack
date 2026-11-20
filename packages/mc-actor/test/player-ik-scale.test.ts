import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { makeFeet } from "../src/feet";
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
});
