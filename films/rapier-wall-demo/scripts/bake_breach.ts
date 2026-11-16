// @ts-nocheck
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import RAPIER from "@dimforge/rapier3d-compat";
import { mulberry32 } from "math/random";

import {
  BLAST_ORIGIN,
  BREACH_FPS,
  buildWallChunks,
  CRATE_BASE_BLOCK,
  DYNAMIC_PROPS,
  ROOM,
  SIM_DURATION,
  STEVE_WAIT,
  T_BOOM,
} from "../src/breach-layout";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(HERE, "../src/timeline/breach.json");

const round3 = (n) => Math.round(n * 1000) / 1000;
const round4 = (n) => Math.round(n * 10000) / 10000;

await RAPIER.init();

const world = new RAPIER.World({ x: 0.0, y: -16.0, z: 0.0 });
const addFixedBox = (cx, cy, cz, hx, hy, hz, friction = 0.78, restitution = 0.16) => {
  const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy, cz));
  const col = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
    .setFriction(friction)
    .setRestitution(restitution);
  return world.createCollider(col, rb);
};

// Floor top y = 0, Ceiling underside y = ROOM.top + 1 (4.0)
addFixedBox(3.5, -0.5, 5.5, 10, 0.5, 10, 0.76, 0.14);
addFixedBox(3.5, ROOM.top + 1.5, 3.0, 5.5, 0.5, 4.0, 0.7, 0.12);

// Side & back walls: inner faces at x = 0, x = 7, z = 0
addFixedBox(-0.5, 2.0, 4.0, 0.5, 3.0, 8.0, 0.72, 0.18);
addFixedBox(ROOM.x1 + 1.5, 2.0, 4.0, 0.5, 3.0, 8.0, 0.72, 0.18);
addFixedBox(3.5, 2.0, -0.5, 5.5, 3.0, 0.5, 0.72, 0.18);

// Breach wall surround at z: 6..7 -> center z = 6.5, hz = 0.5; leaves x: 2..5, y: 0..3 open (low friction so bricks clear)
addFixedBox(1.0, 2.0, 6.5, 1.0, 2.0, 0.5, 0.22, 0.28);
addFixedBox(6.0, 2.0, 6.5, 1.0, 2.0, 0.5, 0.22, 0.28);
addFixedBox(3.5, 3.5, 6.5, 1.5, 0.5, 0.5, 0.22, 0.28);

// Pedestal block inside room + invisible Steve safety collider so chunks bounce off him cleanly
addFixedBox(CRATE_BASE_BLOCK[0] + 0.5, CRATE_BASE_BLOCK[1] + 0.5, CRATE_BASE_BLOCK[2] + 0.5, 0.5, 0.5, 0.5, 0.75, 0.18);
addFixedBox(STEVE_WAIT[0], 0.9, STEVE_WAIT[2], 0.42, 0.9, 0.36, 0.65, 0.15);

const rng = mulberry32.create(7331);
const bodies = [];
const colliderKind = new Map();

// Create dynamic wall brick chunks
for (const c of buildWallChunks()) {
  const rbDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(c.start[0], c.start[1], c.start[2])
    .setLinearDamping(0.18)
    .setAngularDamping(0.28)
    .setCcdEnabled(true);
  const rb = world.createRigidBody(rbDesc);
  const col = world.createCollider(
    RAPIER.ColliderDesc.cuboid(c.half * 0.88, c.half * 0.88, c.half * 0.88)
      .setDensity(2.4)
      .setFriction(0.32)
      .setRestitution(0.2),
    rb,
  );
  colliderKind.set(col.handle, "brick");

  // Directional blast impulse from BLAST_ORIGIN inward toward -z
  const dx = c.start[0] - BLAST_ORIGIN[0];
  const dy = c.start[1] - BLAST_ORIGIN[1];
  const dz = c.start[2] - BLAST_ORIGIN[2];
  const dist = Math.hypot(dx, dy, dz);
  const falloff = Math.max(0.2, 1.0 - dist * 0.25);
  const jitter = () => (mulberry32.sample(rng) - 0.5) * 2;

  const isFrontInner = c.start[2] < 6.5;
  const pushZ = -(5.4 + 4.8 * falloff + (isFrontInner ? 1.1 : 0.0) + Math.abs(jitter()) * 1.4);
  const edgeRelief = Math.abs(dx) > 0.9 ? -Math.sign(dx) * 1.05 : (dx / 0.9) * 0.9;
  const pushX = edgeRelief + jitter() * 0.9;
  const heightBias = c.start[1] >= 2.0 ? -1.1 : c.start[1] >= 1.2 ? 0.7 : 2.1;
  const pushY = heightBias + 1.6 * falloff + jitter() * 0.7;

  rb.setLinvel({ x: pushX, y: pushY, z: pushZ }, true);
  rb.setAngvel(
    {
      x: jitter() * (7 + 6 * falloff),
      y: jitter() * (6 + 5 * falloff),
      z: jitter() * (7 + 6 * falloff),
    },
    true,
  );

  bodies.push({
    id: c.id,
    role: "brick",
    kind: c.kind,
    size: c.half * 2,
    start: c.start,
    rb,
    frames: [],
  });
}

// Create dynamic wooden barrel props sitting inside the room + blast shockwave impulse
for (const p of DYNAMIC_PROPS) {
  const rbDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(p.start[0], p.start[1], p.start[2])
    .setLinearDamping(0.22)
    .setAngularDamping(0.28)
    .setCcdEnabled(true);
  const rb = world.createRigidBody(rbDesc);
  const h = p.size / 2;
  const col = world.createCollider(
    RAPIER.ColliderDesc.cuboid(h, h, h)
      .setDensity(p.density)
      .setFriction(0.58)
      .setRestitution(0.24),
    rb,
  );
  colliderKind.set(col.handle, "crate");

  const isTop = p.id === "barrel-top";
  rb.setLinvel(
    isTop ? { x: -1.9, y: 1.55, z: -3.5 } : { x: -1.4, y: 1.35, z: -2.9 },
    true,
  );
  rb.setAngvel(
    isTop ? { x: -4.2, y: 1.8, z: 3.4 } : { x: -2.6, y: -2.1, z: 1.9 },
    true,
  );

  bodies.push({
    id: p.id,
    role: "prop",
    kind: p.block,
    size: p.size,
    start: p.start,
    rb,
    frames: [],
  });
}

// Step at 120 Hz and sample at 30 Hz (every 4th physics step), recording significant impacts via velocity deltas
const SUBSTEPS_PER_SAMPLE = 4;
const SIM_HZ = BREACH_FPS * SUBSTEPS_PER_SAMPLE;
world.timestep = 1 / SIM_HZ;
const TOTAL_SAMPLES = Math.round(SIM_DURATION * BREACH_FPS) + 1;
const prevVel = bodies.map((b) => {
  const v = b.rb.linvel();
  return [v.x, v.y, v.z];
});
const impacts = [];

for (let s = 0; s < TOTAL_SAMPLES; s++) {
  const simTime = s / BREACH_FPS;
  for (const b of bodies) {
    const p = b.rb.translation();
    const r = b.rb.rotation();
    b.frames.push([
      round3(p.x),
      round3(p.y),
      round3(p.z),
      round4(r.x),
      round4(r.y),
      round4(r.z),
      round4(r.w),
    ]);
  }
  if (s === TOTAL_SAMPLES - 1) break;

  for (let sub = 0; sub < SUBSTEPS_PER_SAMPLE; sub++) {
    world.step();
    const subTime = simTime + (sub + 1) / SIM_HZ;
    for (let i = 0; i < bodies.length; i++) {
      const v = bodies[i].rb.linvel();
      const dv = Math.hypot(v.x - prevVel[i][0], v.y - prevVel[i][1], v.z - prevVel[i][2]);
      prevVel[i][0] = v.x;
      prevVel[i][1] = v.y;
      prevVel[i][2] = v.z;
      // Ignore the initial blast step at t=0, record sharp subsequent landings/collisions
      if (subTime > 0.08 && dv > 3.2) {
        const p = bodies[i].rb.translation();
        impacts.push({
          t: round3(T_BOOM + subTime),
          role: bodies[i].role,
          id: bodies[i].id,
          dv: round3(dv),
          at: [round3(p.x), round3(p.y), round3(p.z)],
        });
      }
    }
  }
}

// Coalesce impact events separated by at least 0.14s so sound triggers read distinctly
impacts.sort((a, b) => a.t - b.t);
const cueHits = [];
for (const ev of impacts) {
  const last = cueHits.at(-1);
  if (!last || ev.t - last.t >= 0.14) cueHits.push(ev);
  else if (ev.dv > last.dv) cueHits[cueHits.length - 1] = ev;
}

const barrelMotion = bodies
  .filter((b) => b.role === "prop")
  .map((b) => {
    const end = b.frames.at(-1);
    const disp = Math.hypot(end[0] - b.start[0], end[1] - b.start[1], end[2] - b.start[2]);
    return { id: b.id, start: b.start, end: end.slice(0, 3), displacementM: round3(disp) };
  });

const out = {
  fps: BREACH_FPS,
  tBoom: T_BOOM,
  duration: SIM_DURATION,
  impacts: cueHits.slice(0, 14),
  bodies: bodies.map(({ id, role, kind, size, start, frames }) => ({
    id,
    role,
    kind,
    size,
    start,
    frames,
  })),
};

writeFileSync(OUT_FILE, JSON.stringify(out));
world.free();

console.log(`Baked ${out.bodies.length} rigid bodies (${TOTAL_SAMPLES} samples @ ${BREACH_FPS}Hz) -> ${OUT_FILE}`);
console.log("Dynamic props displacement:", barrelMotion);
console.log("Top collision cue timestamps (heard seconds):", out.impacts);
