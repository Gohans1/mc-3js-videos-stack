import { describe, expect, test } from "bun:test";

import { createParticleSimulation, type Particle, type Sim } from "../src/particles";
import {
  columnQuad,
  precipitationAt,
  rainSplashes,
  type WeatherColumn,
  weatherColumns,
  type WeatherWorld,
} from "../src/weather";

const flat: WeatherWorld = { height: 64 };
const camera: [number, number, number] = [0.5, 70, 0.5];
const at = (cols: WeatherColumn[], x: number, z: number) => {
  const c = cols.find((col) => col.x === x && col.z === z);
  if (!c) throw new Error(`no column at ${x},${z}`);
  return c;
};
const wrap = (v: number) => ((v % 32) + 32) % 32;

describe("weather columns (WeatherEffectRenderer.extractRenderState)", () => {
  test("a flat world under rain fills the whole square of the weather radius", () => {
    const cols = weatherColumns(flat, camera, 0, { radius: 10 });
    expect(cols).toHaveLength(21 * 21);
    expect(at(cols, 0, 0)).toMatchObject({ kind: "rain", bottom: 64, top: 80 });
  });

  test("ground higher than camera plus radius leaves no column", () => {
    expect(weatherColumns({ height: 90 }, camera, 0, { radius: 10 })).toHaveLength(0);
  });

  test("columns stop at the ground and reach the radius above the camera", () => {
    const cols = weatherColumns({ height: (x) => (x > 3 ? 72 : 50) }, camera, 0, { radius: 5 });
    expect(at(cols, 0, 0)).toMatchObject({ bottom: 65, top: 75 });
    expect(at(cols, 5, 0)).toMatchObject({ bottom: 72, top: 75 });
  });

  test("biomes without precipitation get no column, cold ones get snow", () => {
    expect(weatherColumns({ height: 64, precipitation: "none" }, camera, 0)).toHaveLength(0);
    const cols = weatherColumns(
      { height: 64, precipitation: (x) => (x < 0 ? "snow" : "rain") },
      camera,
      0,
    );
    expect(at(cols, -3, 0).kind).toBe("snow");
    expect(at(cols, 3, 0).kind).toBe("rain");
  });

  test("rain texture falls 3 to 4 thirty-seconds of a tile per tick", () => {
    const now = weatherColumns(flat, camera, 100);
    const next = weatherColumns(flat, camera, 101);
    for (const c of now) {
      const step = wrap(c.v - at(next, c.x, c.z).v);
      expect(step).toBeGreaterThanOrEqual(3 / 32 - 1e-6);
      expect(step).toBeLessThan(4 / 32);
    }
  });

  test("snow drifts down far slower than rain and wobbles sideways", () => {
    const snowy: WeatherWorld = { height: 64, precipitation: "snow" };
    const a = weatherColumns(snowy, camera, 1000);
    const b = weatherColumns(snowy, camera, 1001);
    const fall = a.map((c) => Math.abs(at(b, c.x, c.z).v - c.v));
    expect(Math.max(...fall)).toBeLessThan(0.02);
    expect(a.some((c) => at(b, c.x, c.z).u !== c.u)).toBe(true);
  });

  test("a partial tick moves the rain between whole ticks", () => {
    const v = (t: number) => at(weatherColumns(flat, camera, t), 2, 2).v;
    const half = wrap(v(100) - v(100.5));
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(wrap(v(100) - v(101)));
  });

  test("snow is lit as if three quarters of the way to full light", () => {
    const lightLevel = () => [7, 0] as [number, number];
    const rain = at(weatherColumns({ height: 64, lightLevel }, camera, 0), 1, 1);
    const snow = at(
      weatherColumns({ height: 64, lightLevel, precipitation: "snow" }, camera, 0),
      1,
      1,
    );
    expect([rain.sky, rain.block]).toEqual([7, 0]);
    expect([snow.sky, snow.block]).toEqual([9, 3]);
  });
});

describe("column quads (WeatherEffectRenderer.prepareInstances)", () => {
  const cols = weatherColumns(flat, camera, 0);

  test("each quad faces the camera's block", () => {
    const east = columnQuad(at(cols, 5, 0), camera, 1, 10)!;
    expect(east.corners[0][0]).toBeCloseTo(east.corners[1][0]);
    expect(Math.abs(east.corners[0][2] - east.corners[1][2])).toBeCloseTo(1);
    const north = columnQuad(at(cols, 0, -5), camera, 1, 10)!;
    expect(north.corners[0][2]).toBeCloseTo(north.corners[1][2]);
  });

  test("the column inside the camera's block draws nothing", () => {
    expect(columnQuad(at(cols, 0, 0), camera, 1, 10)).toBeUndefined();
  });

  test("alpha runs from the intensity near the camera to one half at the radius", () => {
    expect(columnQuad(at(cols, 1, 0), camera, 1, 10)!.alpha).toBeCloseTo(0.995, 3);
    expect(columnQuad(at(cols, 10, 0), camera, 1, 10)!.alpha).toBeCloseTo(0.5);
    expect(columnQuad(at(cols, 10, 0), camera, 0.2, 10)!.alpha).toBeCloseTo(0.5);
    const snow = weatherColumns({ height: 64, precipitation: "snow" }, camera, 0);
    expect(columnQuad(at(snow, 10, 0), camera, 1, 10)!.alpha).toBeCloseTo(0.4);
  });

  test("the texture spans one tile across and a quarter tile per block of height", () => {
    const q = columnQuad(at(cols, 4, 4), camera, 1, 10)!;
    expect(q.uv[1][0] - q.uv[0][0]).toBe(1);
    expect(q.uv[2][1] - q.uv[1][1]).toBeCloseTo((80 - 64) * 0.25);
  });
});

describe("rain splashes (ClientLevel.tickRainParticles)", () => {
  const run = (world: Parameters<typeof rainSplashes>[1], rain = 1) => {
    const sim = createParticleSimulation({ ground: 64 });
    sim.burst(0, (s: Sim) => rainSplashes(s, world, () => camera, { rain, ticks: 1 }));
    return sim.at(1 / 20)[0]?.particles.filter((p: Particle) => p.type !== "emitter") ?? [];
  };

  test("a full storm throws 99 drops a tick on flat ground within ten blocks", () => {
    const drops = run(flat);
    expect(drops).toHaveLength(99);
    expect(drops.every((p) => p.type === "rain" && p.y === 64)).toBe(true);
  });

  test("light rain throws a quarter as many per square of intensity", () => {
    expect(run(flat, 0.5)).toHaveLength(24);
  });

  test("ground more than ten blocks below the camera stays dry", () => {
    expect(run({ height: 50 })).toHaveLength(0);
  });

  test("lava, magma and lit campfires hiss smoke instead", () => {
    const drops = run({ height: 64, hot: () => true });
    expect(drops.every((p) => p.type === "smoke")).toBe(true);
  });

  test("drops land on the top of short blocks", () => {
    const drops = run({ height: 64, surface: () => 0.5 });
    expect(drops.every((p) => p.y === 63.5)).toBe(true);
  });
});

describe("precipitationAt (Biome.getPrecipitationAt without the temperature noise)", () => {
  const plains = { temperature: 0.8, precipitation: "rain" as const };
  const meadow = { temperature: 0.5, precipitation: "rain" as const };

  test("warm biomes rain at every height up to where the air cools below 0.15", () => {
    expect(precipitationAt(plains, 200)).toBe("rain");
    expect(precipitationAt(meadow, 80)).toBe("rain");
    expect(precipitationAt(meadow, 80 + 279)).toBe("rain");
    expect(precipitationAt(meadow, 80 + 290)).toBe("snow");
  });

  test("dry biomes never get rain", () => {
    expect(precipitationAt({ temperature: 2, precipitation: "none" }, 64)).toBe("none");
  });
});
