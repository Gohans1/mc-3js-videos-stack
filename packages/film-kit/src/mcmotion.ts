// Things that move the way they do in Minecraft, so a viewer who plays it sees the game: a jump, a fall, a mob knocked
// back by a hit, an item tossed, an arrow, falling sand, TNT; the red flash of a hit and the death tip-over. Java Edition
// runs at 20 ticks a second, and each tick an entity adds gravity to its velocity, multiplies it by a drag, and moves by
// it, in an order that depends on its kind (minecraft.wiki/w/Entity, "Gravity": the table below). Simulating those three
// steps tick by tick with the table's numbers is exact; between ticks the game draws the entity lerped from its last
// tick to the next (partialTick), and so does this. 1 block = 1 metre, velocities in blocks a tick.
//   Jump: 0.42 blocks/tick up (LivingEntity.getJumpPower) peaks 1.2522 blocks up and lands 12 ticks later.
//   On the ground a living entity's horizontal drag is 0.91 times the block's friction (0.6; slime 0.8, ice 0.98, blue
//   ice 0.989), so a mob that is hit slides to a stop on ice and barely moves on stone.
//   A hit (LivingEntity.hurt -> knockback(0.4, from the source), decompiled 1.21.4): the velocity halves, then 0.4 is
//   taken away horizontally toward the side away from the source and, if on the ground, y = min(0.4, y / 2 + 0.4).
//   The entity flashes red for 10 ticks (hurtTime). Death (minecraft.wiki/w/Death; LivingEntityRenderer.setupRotations):
//   red the whole time, tips onto its left side by min(1, sqrt((deathTime - 1) / 20 * 1.6)) * 90 degrees (spiders and
//   silverfish flip 180), and at deathTime 20 (1 s) it is gone in a puff of white smoke.
//   const body = mcBody([x, y, z], [{ t: 2, hit: [sx, sz] }, { t: 3, from: [0, -1] }, { t: 4, jump: true }, { t: 6, die: true }]);
//   body(t) -> { p, v, onGround, red, roll, gone, puff }; body.events: landings and hits (for sounds)
//   const item = fly("item", [x, y, z], [vx, vy, vz], { ground: 0 });  item(t).p
// ground: a height, or (x, z) => the top of the block under that point. Only the floor collides (no walls).
export const TPS = 20;
// gravity (blocks/tick^2), vertical drag, horizontal drag, and the order of the three steps in a tick: a = acceleration,
// d = drag, p = position (minecraft.wiki/w/Entity)
export const KINDS = {
  living: { order: "pad", g: 0.08, dv: 0.98, dh: 0.91 },
  slowFalling: { order: "pad", g: 0.01, dv: 0.98, dh: 0.91 },
  block: { order: "apd", g: 0.04, dv: 0.98, dh: 0.98 }, // falling sand, gravel, anvils; primed TNT
  item: { order: "apd", g: 0.04, dv: 0.98, dh: 0.98 },
  xp: { order: "apd", g: 0.03, dv: 0.98, dh: 0.98 },
  thrown: { order: "adp", g: 0.03, dv: 0.99, dh: 0.99 }, // snowballs, eggs, ender pearls (1.21.2 and later)
  potion: { order: "adp", g: 0.05, dv: 0.99, dh: 0.99 },
  arrow: { order: "pda", g: 0.05, dv: 0.99, dh: 0.99 }, // and thrown tridents
} as const;
export type Kind = keyof typeof KINDS;
export const FRICTION = { normal: 0.6, slime: 0.8, ice: 0.98, blueIce: 0.989 };
export const MC = {
  jump: 0.42, // blocks/tick
  knock: 0.4, // a hit's knockback strength
  hurt: 10, // ticks red after a hit
  death: 20, // ticks from death to the puff
  flip: 90, // degrees a dying body tips over (180 for spiders and silverfish)
  fallHurts: 3, // blocks: a fall longer than this hurts (and plays the block's fall sound)
  speed: { walk: 4.317, sprint: 5.612, sneak: 1.295 }, // m/s (minecraft.wiki/w/Walking, Sprinting, Sneaking)
};

type V3 = [number, number, number];
type Ground = number | ((x: number, z: number) => number);
const floorAt = (g: Ground, x: number, z: number) => (typeof g === "number" ? g : g(x, z));

type State = { p: V3; v: V3; on: boolean };
// one tick of a kind's motion; returns how far it fell this tick if it landed
function tick(s: State, k: { order: string; g: number; dv: number; dh: number }, ground: Ground, friction: number, stick: boolean) {
  let landedFrom = -1;
  for (const op of k.order) {
    if (op === "a") s.v[1] -= k.g;
    else if (op === "d") { const h = s.on ? k.dh * friction : k.dh; s.v[0] *= h; s.v[1] *= k.dv; s.v[2] *= h; }
    else {
      s.p = [s.p[0] + s.v[0], s.p[1] + s.v[1], s.p[2] + s.v[2]];
      const f = floorAt(ground, s.p[0], s.p[2]);
      if (s.p[1] <= f && s.v[1] <= 0) {
        if (!s.on) landedFrom = 1;
        s.p[1] = f; s.v[1] = 0; s.on = true;
        if (stick) s.v = [0, 0, 0];
      } else if (s.p[1] > f + 1e-6) s.on = false;
    }
  }
  return landedFrom;
}

const lerp3 = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

// a thrown or dropped thing from p0 with velocity v0 (blocks/tick) at time t0 (s)
export function fly(kind: Kind, p0: V3, v0: V3, { t0 = 0, ground = -Infinity as Ground, friction = FRICTION.normal, ticks = 1200, stick = kind === "arrow" } = {}) {
  const k = KINDS[kind], s: State = { p: [...p0] as V3, v: [...v0] as V3, on: false };
  const P: V3[] = [s.p], landings: { t: number; v: number }[] = [];
  for (let i = 1; i <= ticks; i++) {
    const vy = s.v[1];
    if (tick(s, k, ground, friction, stick) > 0) landings.push({ t: t0 + i / TPS, v: -vy });
    P.push(s.p);
  }
  const at = (t: number) => {
    const x = Math.min(Math.max((t - t0) * TPS, 0), ticks - 1e-6), i = Math.floor(x);
    return lerp3(P[i], P[i + 1], x - i);
  };
  return Object.assign((t: number) => ({ p: at(t) }), { landings });
}

// hit: where the attacker stands on the floor [x, z]; from: the attacker's offset from him at that moment [dx, dz] (for
// a film keyed by who hits from which side, wherever earlier hits have pushed him)
export type McEvent = { t: number; hit?: [number, number]; from?: [number, number]; strength?: number; jump?: boolean; die?: boolean; push?: V3 };
// a living entity (a player or mob) standing at p0, moved only by what happens to it: hits, jumps, pushes, death
export function mcBody(p0: V3, events: McEvent[], { ground = 0 as Ground, friction = FRICTION.normal, end = 60, flip = MC.flip, resist = 0 } = {}) {
  const k = KINDS.living, n = Math.ceil(end * TPS) + 2;
  const s: State = { p: [...p0] as V3, v: [0, 0, 0], on: true };
  const P: V3[] = [], V: V3[] = [], ON: boolean[] = [];
  const evs = [...events].sort((a, b) => a.t - b.t);
  const out: { t: number; kind: "land" | "hit" | "jump" | "die"; fall?: number; at: V3 }[] = [];
  let e = 0, top = s.p[1], died = Infinity;
  const hits: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / TPS;
    // events take effect at the start of the tick they fall in
    while (e < evs.length && evs[e].t <= t) {
      const x = evs[e++];
      if (x.die && died === Infinity) { died = x.t; out.push({ t: x.t, kind: "die", at: s.p }); }
      if (x.jump && s.on) { s.v[1] = MC.jump; s.on = false; out.push({ t: x.t, kind: "jump", at: s.p }); }
      if (x.push) s.v = [s.v[0] + x.push[0], s.v[1] + x.push[1], s.v[2] + x.push[2]];
      if (x.hit || x.from) {
        hits.push(x.t);
        out.push({ t: x.t, kind: "hit", at: s.p });
        const str = (x.strength ?? MC.knock) * (1 - resist);
        let [dx, dz] = x.from ?? [x.hit![0] - s.p[0], x.hit![1] - s.p[2]];
        const d = Math.hypot(dx, dz) || 1;
        dx = (dx / d) * str; dz = (dz / d) * str;
        s.v = [s.v[0] / 2 - dx, s.on ? Math.min(0.4, s.v[1] / 2 + str) : s.v[1], s.v[2] / 2 - dz];
        if (s.on) s.on = false;
      }
    }
    P.push(s.p); V.push([...s.v] as V3); ON.push(s.on);
    if (!s.on) top = Math.max(top, s.p[1]);
    if (tick(s, k, ground, friction, false) > 0) { out.push({ t: (i + 1) / TPS, kind: "land", fall: top - s.p[1], at: s.p }); top = s.p[1]; }
    if (s.on) top = s.p[1];
  }
  const read = (t: number) => { const x = Math.min(Math.max(t * TPS, 0), n - 1 - 1e-6), i = Math.floor(x); return { i, f: x - i }; };
  const body = (t: number) => {
    const { i, f } = read(t);
    const dt = (t - died) * TPS; // deathTime in ticks (with the partial tick)
    const hurt = hits.some((h) => t >= h && t < h + MC.hurt / TPS);
    return {
      p: lerp3(P[i], P[i + 1], f), v: V[i], onGround: ON[i],
      red: hurt || dt >= 0, // the game's hurt overlay: a flat red tint, on or off
      roll: dt > 0 ? Math.min(1, Math.sqrt(Math.max(0, (dt - 1) / 20) * 1.6)) * flip : 0,
      gone: dt >= MC.death,
      puff: dt >= MC.death ? (dt - MC.death) / TPS : -1, // s since the smoke puff, -1 before it
    };
  };
  return Object.assign(body, { events: out });
}

// how high a jump of v0 blocks/tick goes, and how many ticks until it lands back on the same level
export function jumpArc(v0 = MC.jump) {
  const s: State = { p: [0, 0, 0], v: [0, v0, 0], on: false };
  let top = 0, i = 0;
  do { tick(s, KINDS.living, 0, FRICTION.normal, false); top = Math.max(top, s.p[1]); i++; } while (!s.on && i < 400);
  return { height: top, ticks: i };
}
