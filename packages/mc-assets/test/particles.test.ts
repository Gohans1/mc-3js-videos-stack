import { describe, expect, test } from "bun:test";

import {
  animateTickChance,
  createParticleSimulation,
  frameIndex,
  mob,
  type Particle,
  PARTICLE_EVENTS,
  type ParticleType,
  type ParticleWorld,
  type Sim,
} from "../src/particles";

const TICK = 1 / 20;

function run(build: (sim: Sim) => void, world: ParticleWorld = {}) {
  const sim = createParticleSimulation(world);
  sim.burst(0, build);
  return (n: number): readonly Particle[] => sim.at(n * TICK)[0]?.particles ?? [];
}
const ofType = (ps: readonly Particle[], type: ParticleType) => ps.filter((p) => p.type === type);
function spawned(at: (n: number) => readonly Particle[], type: ParticleType, ticks: number) {
  let n = 0;
  for (let t = 0; t <= ticks; t++) n += ofType(at(t), type).filter((p) => p.age === 0).length;
  return n;
}

describe("particle types (the 26.3 providers)", () => {
  test("poof: ExplodeParticle's life of 18 to 82 ticks and size of 0.1 to 0.7", () => {
    const at = run((sim) => {
      for (let i = 0; i < 400; i++) sim.spawn("poof", [0, 0, 0]);
    });
    const ps = at(0);
    expect(ps).toHaveLength(400);
    for (const p of ps) {
      expect(p.lifetime).toBeGreaterThanOrEqual(18);
      expect(p.lifetime).toBeLessThanOrEqual(82);
      expect(p.quadSize).toBeGreaterThanOrEqual(0.1);
      expect(p.quadSize).toBeLessThanOrEqual(0.7);
    }
  });

  test("the 7-argument push: a random speed of 0.06 to 0.18 a tick, lifted 0.1", () => {
    const at = run((sim) => {
      for (let i = 0; i < 400; i++)
        sim.spawn("block", [0, 0, 0], [0, 0, 0], { sprite: "block/stone" });
    });
    for (const p of at(0)) {
      const speed = Math.hypot(p.xd, p.yd - 0.1, p.zd);
      expect(speed).toBeGreaterThanOrEqual(0.06 - 1e-9);
      expect(speed).toBeLessThanOrEqual(0.18 + 1e-9);
    }
  });

  test("a smoke puff's sprite runs through its set by age, last frame at the end", () => {
    const at = run((sim) => void sim.spawn("smoke", [0, 0, 0]));
    const life = at(0)[0]!.lifetime;
    expect(frameIndex(at(0)[0]!, 8)).toBe(0);
    expect(frameIndex(at(life)[0]!, 8)).toBe(7);
  });

  test("a crumb falls onto a solid floor and stays there", () => {
    const at = run(
      (sim) => {
        sim.spawn("block", [0.5, 3, 0.5], [0, 0, 0], { sprite: "block/stone" }).lifetime = 100;
      },
      { solid: (_x, y) => y < 0 },
    );
    const p = at(40)[0]!;
    expect(p.y).toBe(0);
    expect(p.stopped).toBe(true);
    expect(at(41)[0]!.x).toBe(p.x);
  });

  test("a large ball firework throws 386 sparks and a flash; a small ball 98, a star 121, a creeper 265", () => {
    const sparks = (shape: "small_ball" | "large_ball" | "star" | "creeper") => {
      const at = run((sim) =>
        PARTICLE_EVENTS.firework(sim, [0, 0, 0], [{ shape, colors: [0xb3312c] }]),
      );
      return [ofType(at(1), "firework").length, ofType(at(1), "flash").length];
    };
    expect(sparks("large_ball")).toEqual([386, 1]);
    expect(sparks("small_ball")).toEqual([98, 1]);
    expect(sparks("star")).toEqual([121, 1]);
    expect(sparks("creeper")).toEqual([265, 1]);
  });

  test("a firework with no explosions puffs 2, 3 or 4 times, the count redrawn each pass", () => {
    const counts = [0, 0, 0, 0, 0];
    for (let seed = 1; seed <= 3000; seed++) {
      const sim = createParticleSimulation({}, seed);
      sim.burst(0, (s) => PARTICLE_EVENTS.firework(s, [0, 0, 0], []));
      counts[ofType(sim.at(0)[0]!.particles, "poof").length]! += 1;
    }
    expect(counts[0]! + counts[1]!).toBe(0);
    expect(counts[2]! / 3000).toBeCloseTo(1 / 3, 1);
    expect(counts[3]! / 3000).toBeCloseTo(4 / 9, 1);
    expect(counts[4]! / 3000).toBeCloseTo(2 / 9, 1);
  });

  test("trail sparks keep their colour while the main sparks fade", () => {
    const at = run((sim) =>
      PARTICLE_EVENTS.firework(
        sim,
        [0, 0, 0],
        [{ shape: "large_ball", colors: [0xb3312c], fadeColors: [0xf0f0f0], trail: true }],
      ),
    );
    const sparks = ofType(at(12), "firework");
    const trails = sparks.filter((p) => !p.data.trail);
    expect(trails.length).toBeGreaterThan(0);
    expect(sparks.some((p) => p.data.hasFade)).toBe(true);
    expect(trails.every((p) => !p.data.hasFade)).toBe(true);
  });
});

describe("water in the world", () => {
  const water: ParticleWorld = { fluid: (_x, y) => (y < 64 ? 8 / 9 : 0) };

  test("drops stop at the water's surface", () => {
    const at = run((sim) => {
      for (let i = 0; i < 50; i++) sim.spawn("rain", [0.5, 64.5, 0.5]);
    }, water);
    for (let t = 1; t <= 40; t++)
      for (const p of ofType(at(t), "rain")) expect(p.y).toBeGreaterThanOrEqual(63 + 8 / 9);
  });

  test("bubbles burst once they rise out of the water", () => {
    const at = run((sim) => {
      for (let i = 0; i < 20; i++) sim.spawn("bubble", [0.5, 63.5, 0.5], [0, 0.5, 0]);
    }, water);
    for (let t = 1; t <= 30; t++)
      for (const p of ofType(at(t), "bubble")) expect(p.y).toBeLessThan(64);
  });

  test("the effect particle takes a colour like instant_effect", () => {
    const [p] = run((sim) => void sim.spawn("effect", [0, 0, 0], [0, 0, 0], { color: [1, 0, 0] }))(
      0,
    );
    expect([p!.r, p!.g, p!.b]).toEqual([1, 0, 0]);
  });
});

describe("the vanilla events", () => {
  test("a broken block throws 64 crumbs from inside it", () => {
    const ps = run((sim) => PARTICLE_EVENTS.blockBreak(sim, "block/stone", [2, 0, 5]))(0);
    expect(ps).toHaveLength(64);
    for (const p of ps) {
      expect(p.x).toBeGreaterThan(2);
      expect(p.x).toBeLessThan(3);
      expect(p.sprite).toBe("block/stone");
    }
  });

  test("TNT: the emitter's 6 blasts a tick for 8 ticks, and the puffs; a small blast is one explosion", () => {
    const tnt = run((sim) => PARTICLE_EVENTS.explosion(sim, [0, 64, 0], 4, 100, true));
    expect(spawned(tnt, "explosion", 9)).toBe(48);
    expect(ofType(tnt(0), "poof").length + ofType(tnt(0), "smoke").length).toBe(100);
    const small = run((sim) => PARTICLE_EVENTS.explosion(sim, [0, 64, 0], 1, 0, false))(0);
    expect(small.map((p) => [p.type, p.quadSize])).toEqual([["explosion", 1]]);
  });

  test("puffs only where the blast left air", () => {
    const at = run((sim) => PARTICLE_EVENTS.explosion(sim, [0, 0, 0], 4, 200, true), {
      solid: () => true,
    });
    expect(ofType(at(0), "poof").length + ofType(at(0), "smoke").length).toBe(0);
  });

  test("damage hearts need more than 2 health lost", () => {
    const cow = mob("cow", [0, 64, 0]);
    const hearts = (lost: number) =>
      ofType(run((sim) => PARTICLE_EVENTS.damage(sim, cow, lost))(0), "damage_indicator").length;
    expect(hearts(2)).toBe(0);
    expect(hearts(2.5)).toBe(1);
  });

  test("a mob's death is 20 puffs, a breeding 7 hearts, a hit for 9 four damage hearts", () => {
    const cow = mob("cow", [0, 64, 0]);
    expect(run((sim) => PARTICLE_EVENTS.mobDeath(sim, cow))(0)).toHaveLength(20);
    expect(ofType(run((sim) => PARTICLE_EVENTS.hearts(sim, cow))(0), "heart")).toHaveLength(7);
    expect(
      ofType(run((sim) => PARTICLE_EVENTS.damage(sim, cow, 9))(0), "damage_indicator"),
    ).toHaveLength(4);
  });

  test("a player hitting water: 13 bubbles and 13 splashes at the surface", () => {
    const ps = run((sim) =>
      PARTICLE_EVENTS.waterSplash(sim, mob("player", [0, 62.3, 0], [0, -0.8, 0]), 63),
    )(0);
    expect(ofType(ps, "bubble")).toHaveLength(13);
    expect(ofType(ps, "splash")).toHaveLength(13);
    expect(ps.every((p) => p.yo === 63)).toBe(true);
  });

  test("a crit's tracking emitter tries 16 a tick for 3 ticks", () => {
    const at = run((sim) => PARTICLE_EVENTS.crit(sim, mob("zombie", [0, 0, 0])));
    const first = ofType(at(0), "crit").length;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(16);
    expect(spawned(at, "crit", 5)).toBeLessThanOrEqual(48);
    expect(ofType(at(3), "crit").filter((p) => p.age === 0)).toHaveLength(0);
  });

  test("the display tick reaches the player's own block 0.18 times a tick, nothing 32 blocks off", () => {
    expect(animateTickChance([0, 0, 0])).toBeCloseTo(667 * (1 / 16 ** 3 + 1 / 32 ** 3), 10);
    expect(animateTickChance([32, 0, 0])).toBe(0);
  });
});

describe("film time", () => {
  test("a seek back and forth shows the same particles, nothing before the burst or after the last one goes", () => {
    const sim = createParticleSimulation({ ground: 0 }, 7);
    sim.burst(1, (s) => PARTICLE_EVENTS.blockBreak(s, "block/dirt", [0, 0, 0]));
    const snap = (t: number) =>
      sim.at(t).flatMap((b) => b.particles.map((p) => [p.x, p.y, p.z, p.age]));
    const later = snap(2.37);
    snap(1.2);
    expect(snap(2.37)).toEqual(later);
    expect(snap(0.99)).toEqual([]);
    expect(snap(60)).toEqual([]);
    const again = createParticleSimulation({ ground: 0 }, 7);
    again.burst(1, (s) => PARTICLE_EVENTS.blockBreak(s, "block/dirt", [0, 0, 0]));
    expect(again.at(2.37).flatMap((b) => b.particles.map((p) => [p.x, p.y, p.z, p.age]))).toEqual(
      later,
    );
  });

  test("between ticks the partial tick is how far film time is past the last one", () => {
    const sim = createParticleSimulation();
    sim.burst(0.5, (s) => void s.spawn("poof", [0, 0, 0]));
    expect(sim.at(0.5 + 3.25 * TICK)[0]!.pt).toBeCloseTo(0.25, 9);
  });
});
