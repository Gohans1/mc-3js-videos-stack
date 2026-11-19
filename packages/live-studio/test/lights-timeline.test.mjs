import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { Activity, createActivity } from "../src/activity.mjs";
import { createApi } from "../src/api.mjs";
import { checkFiles, LightsTimeline, problems, StudioConfig } from "../src/contract.ts";
import { contractFiles, openFilm } from "../src/film.mjs";
import { mapTimeline } from "../src/timing-data.mjs";
import { compileTiming } from "../src/timing.mjs";

const dirs = [];
const makeTemp = () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-lights-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop(), { recursive: true, force: true });
});

test("StudioConfig & LightsTimeline schema validate light docs, keys, presets, practicals, godrays, and reject invalid edits", () => {
  const config = StudioConfig.safeParse({ lightsTimeline: "src/timeline/lights.json" });
  assert.equal(config.success, true);

  const validDoc = {
    target: [3.5, 1.5, 3.5],
    keys: [
      {
        t: 0,
        preset: "golden-hour",
        key: {
          enabled: true,
          color: "#ffcc88",
          intensity: 2.8,
          azimuth: 40,
          elevation: 22,
          shadowRadius: 2.5,
          castShadow: true,
        },
        fog: { mode: "exp2", color: "#d8a87c", near: 8, far: 40, density: 0.02 },
        practicals: [
          {
            id: "lamp-1",
            name: "Desk Lamp",
            kind: "point",
            at: [1, 2, 3],
            color: "#ff9944",
            intensity: 3.5,
            distance: 8,
            decay: 2,
            flicker: { rate: 8, amount: 0.25, seed: 3 },
          },
          {
            id: "spot-1",
            name: "Stage Spot",
            kind: "spot",
            at: [2, 4, 2],
            target: [2, 1, 2],
            color: "#ffffff",
            intensity: 6,
            distance: 14,
            decay: 1.5,
            angle: 42,
            penumbra: 0.4,
          },
        ],
        godrays: {
          enabled: true,
          density: 0.015,
          maxDensity: 0.5,
          edgeStrength: 2,
          edgeRadius: 2,
          raymarchSteps: 60,
          blur: true,
          weight: 1,
          color: "#ffd9a0",
        },
      },
      {
        t: 4,
        cut: true,
        ease: [0.4, 0, 0.2, 1],
        preset: "noir-night",
        fill: { negativeFill: true, intensity: 0.25 },
      },
    ],
  };

  assert.deepEqual(problems(LightsTimeline, validDoc), []);
  assert.deepEqual(problems(LightsTimeline, validDoc.keys), []);

  // Out-of-order timestamps fail
  const badOrder = {
    keys: [{ t: 5 }, { t: 2 }],
  };
  assert.ok(problems(LightsTimeline, badOrder).length > 0);

  // Bad fog mode fails
  const badFog = {
    keys: [
      { t: 0, fog: { mode: "volumetric", color: "#ffffff", near: 1, far: 10, density: 0.01 } },
    ],
  };
  assert.ok(problems(LightsTimeline, badFog).length > 0);

  // Bad hex color fails
  const badHex = {
    keys: [{ t: 0, key: { color: "not-a-color" } }],
  };
  assert.ok(problems(LightsTimeline, badHex).length > 0);

  // Negative intensity fails
  const badIntensity = {
    keys: [{ t: 0, key: { intensity: -1 } }],
  };
  assert.ok(problems(LightsTimeline, badIntensity).length > 0);
});

test("checkFiles detects missing lightsTimeline file and openFilm/API serve, persist, and enforce OCC", async () => {
  const dir = makeTemp();
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "demo-lights",
      "live-studio": { lightsTimeline: "src/timeline/lights.json" },
    }),
  );

  assert.deepEqual(checkFiles(contractFiles(dir)), []);
  writeFileSync(join(dir, "src/timeline/lights.json"), JSON.stringify({ keys: [{ t: -5 }] }));
  assert.ok(checkFiles(contractFiles(dir)).some((p) => p.includes("src/timeline/lights.json")));

  const initial = { target: [3.5, 1.5, 3.5], keys: [{ t: 0, preset: "studio-three-point" }] };
  writeFileSync(join(dir, "src/scene.ts"), "export {};\n");
  writeFileSync(join(dir, "src/timeline/lights.json"), JSON.stringify(initial));

  const events = [];
  const activity = createActivity((event, data) => events.push([event, data]));
  const film = openFilm(dir, {
    send: (event, data) => events.push([event, data]),
    activity,
  });
  try {
    assert.ok(contractFiles(dir)["src/timeline/lights.json"]);
    assert.equal(film.features().lights, true);
    assert.ok(film.lights);

    const app = createApi(film, {
      page: { dir, html: () => "" },
      events: {},
      activity,
    });

    const getBefore = await app.request("/api/lights");
    assert.equal(getBefore.status, 200);
    const beforeBody = await getBefore.json();
    assert.deepEqual(beforeBody.data, initial);

    const next = {
      target: [3.5, 1.5, 3.5],
      keys: [
        { t: 0, preset: "studio-three-point" },
        { t: 3, preset: "golden-hour", godrays: { enabled: true } },
      ],
    };

    const saved = await app.request("/api/lights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ base: beforeBody.version, data: next }),
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(film.lights.read().data, next);

    // Stale base conflicts with 409
    const conflict = await app.request("/api/lights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        base: "stale-version",
        data: { keys: [{ t: 0, preset: "noir-night" }] },
      }),
    });
    assert.equal(conflict.status, 409);

    // Invalid payload fails 400
    const bad = await app.request("/api/lights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        base: film.lights.read().version,
        data: { keys: [{ t: 0, fog: { mode: "bad" } }] },
      }),
    });
    assert.equal(bad.status, 400);

    // Collaboration endpoint resolves named "lights"
    const collab = await app.request("/api/collaboration/lights");
    assert.equal(collab.status, 200);
    const collabBody = await collab.json();
    assert.deepEqual(collabBody.data, next);

    // Light activity surface is valid
    assert.equal(Activity.safeParse({ surface: "light", say: "Updated lights" }).success, true);
  } finally {
    film.stop?.();
  }
});

test("mapTimeline remaps lights doc and keyframe array timestamps across speed edits", () => {
  const clock = compileTiming({ speeds: [{ from: 0, to: 4, rate: 2 }] }, 10);
  const doc = {
    target: [0, 1, 0],
    keys: [
      { t: 0, preset: "studio-three-point" },
      { t: 4, preset: "golden-hour" },
    ],
  };

  const shown = mapTimeline("lights", doc, clock);
  assert.deepEqual(shown.target, [0, 1, 0]);
  assert.equal(shown.keys[0].t, 0);
  assert.equal(shown.keys[1].t, 2);

  const saved = mapTimeline("lights", shown, clock, true, doc);
  assert.equal(saved.keys[1].t, 4);

  const arrayShown = mapTimeline("lights", doc.keys, clock);
  assert.equal(arrayShown[1].t, 2);
});
