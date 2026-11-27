import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { lookdevWarnings } from "../src/lookdev-guard.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK_SCRIPT = resolve(HERE, "../check.mjs");
const TEMPLATE_DIR = resolve(HERE, "../../../templates/film");

const createTempFilm = (t, files, liveStudioConf = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "lookdev-guard-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "lookdev-test", "live-studio": liveStudioConf }, null, 2),
  );
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({ end: 5, voice: { edits: {}, warp: [] }, beats: {} }),
  );
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
};

test("clean modern film using setupLookdev, updateLighting, and film-stage/sky produces zero warnings", (t) => {
  const dir = createTempFilm(
    t,
    {
      "src/scene.ts": `
        import * as THREE from "three";
        import { EDIT } from "./edit";
        import { createSkyDome, setupLookdev } from "./lookdev";

        export async function buildScene(canvas, W, H, draft) {
          const scene = new THREE.Scene();
          const camera = new THREE.PerspectiveCamera();
          const lookdev = setupLookdev({ canvas, width: W, height: H, scene, camera, draft });
          const sky = createSkyDome();
          const fog = new THREE.Fog(0x111111, 10, 40);
          scene.fog = fog;
          return (t) => {
            lookdev.updateLighting(EDIT.lights, t, EDIT.light);
            sky.follow(camera);
            lookdev.post.render(camera);
          };
        }
      `,
      "src/timeline/lights.json": JSON.stringify({ keys: [{ t: 0, preset: "studio-three-point" }] }),
    },
    { lightsTimeline: "src/timeline/lights.json" },
  );

  assert.deepEqual(lookdevWarnings(dir, { lightsTimeline: "src/timeline/lights.json" }), []);
});

test("templates/film itself produces zero lookdev warnings", () => {
  assert.deepEqual(
    lookdevWarnings(TEMPLATE_DIR, { lightsTimeline: "src/timeline/lights.json" }),
    [],
  );
});

test("warns on deprecated PCFSoftShadowMap while ignoring comments, strings, and regex literals", (t) => {
  const dir = createTempFilm(t, {
    "src/scene.ts": `
      // renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      /* THREE.PCFSoftShadowMap */
      const note = "do not use THREE.PCFSoftShadowMap";
      const re = /PCFSoftShadowMap|["']/g;
      const ratio = 10 / 2;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    `,
  });

  const warnings = lookdevWarnings(dir);
  assert.equal(warnings.length, 1, warnings.join("\n"));
  assert.match(warnings[0], /^⚠ src\/scene\.ts:7:.*PCFSoftShadowMap.*PCFShadowMap.*createFilmRenderer/);
});

test("warns on shadow.radius above 4 on PCFShadowMap and allows values up to 4 or VSMShadowMap", (t) => {
  const dir = createTempFilm(t, {
    "src/scene.ts": `
      renderer.shadowMap.type = THREE.PCFShadowMap;
      // sun.shadow.radius = 9;
      key.shadow.radius = 2.5;
      fill.shadow.radius = 4;
      sun.shadow.radius = 6;
      spot.shadow.radius = 4.5;
    `,
  });

  const warnings = lookdevWarnings(dir);
  assert.equal(warnings.length, 2, warnings.join("\n"));
  assert.match(warnings[0], /^⚠ src\/scene\.ts:6:.*shadow\.radius = 6.*PCFShadowMap.*film-stage\/lights/);
  assert.match(warnings[1], /^⚠ src\/scene\.ts:7:.*shadow\.radius = 4\.5.*PCFShadowMap/);

  const vsmDir = createTempFilm(t, {
    "src/scene.ts": `
      renderer.shadowMap.type = THREE.VSMShadowMap;
      sun.shadow.radius = 8;
    `,
  });
  assert.deepEqual(lookdevWarnings(vsmDir), []);
});

test("warns on un-disposed PMREMGenerator and stays quiet for disposed typed or optional-chained variables", (t) => {
  const leakDir = createTempFilm(t, {
    "src/scene.ts": `
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(studio, 0.03).texture;
    `,
  });
  const leakWarnings = lookdevWarnings(leakDir);
  assert.equal(leakWarnings.length, 1, leakWarnings.join("\n"));
  assert.match(leakWarnings[0], /^⚠ src\/scene\.ts:2:.*PMREMGenerator.*dispose\(\).*film-stage\/lights/);

  const disposedDir = createTempFilm(t, {
    "src/scene.ts": `
      const typed: THREE.PMREMGenerator = new THREE.PMREMGenerator(renderer);
      typed.dispose();
      let $pmrem;
      $pmrem = new THREE.PMREMGenerator(renderer);
      $pmrem?.dispose();
      new THREE.PMREMGenerator(renderer).dispose();
    `,
  });
  assert.deepEqual(lookdevWarnings(disposedDir), []);
});

test("warns when PMREMGenerator is chained directly into fromScene or anonymous with only an unrelated dispose", (t) => {
  const chainedDir = createTempFilm(t, {
    "src/scene.ts": `
      const env = new THREE.PMREMGenerator(renderer).fromScene(studio, 0.03);
      env.dispose();
    `,
  });
  const chainedWarnings = lookdevWarnings(chainedDir);
  assert.equal(chainedWarnings.length, 1, chainedWarnings.join("\n"));
  assert.match(chainedWarnings[0], /^⚠ src\/scene\.ts:2:.*PMREMGenerator/);

  const anonDir = createTempFilm(t, {
    "src/scene.ts": `
      scene.environment = new THREE.PMREMGenerator(renderer).fromEquirectangular(tex).texture;
      tex.dispose();
    `,
  });
  const anonWarnings = lookdevWarnings(anonDir);
  assert.equal(anonWarnings.length, 1, anonWarnings.join("\n"));
  assert.match(anonWarnings[0], /^⚠ src\/scene\.ts:2:.*PMREMGenerator/);
});

test("warns on Fog/FogExp2 allocation inside per-frame callbacks, returned closures, RAF, or loops", (t) => {
  const dir = createTempFilm(t, {
    "src/scene.ts": `
      export async function buildScene(canvas, W, H) {
        const applyLight = (spec: unknown): void => {
          scene.fog = spec ? new THREE.Fog(0x112233, 1, 20) : null;
        };
        const frame = (t: number): void => {
          scene.fog = new THREE.FogExp2(0x223344, 0.02);
        };
        for (let i = 0; i < count(); i++) {
          scene.fog = new THREE.Fog(0x000000, 1, 10);
        }
        requestAnimationFrame(() => (scene.fog = new THREE.Fog(0x101010, 2, 12)));
        return (t = 0) => (scene.fog = new THREE.FogExp2(0x334455, 0.01));
      }
      function updateLights(scene) {
        scene.fog = new THREE.Fog(0x000000, 1, 10);
      }
    `,
  });

  const warnings = lookdevWarnings(dir);
  assert.equal(warnings.length, 6, warnings.join("\n"));
  assert.match(warnings[0], /^⚠ src\/scene\.ts:4:.*new THREE\.Fog.*applySetLight/);
  assert.match(warnings[1], /^⚠ src\/scene\.ts:7:.*new THREE\.FogExp2.*applySetLight/);
  assert.match(warnings[2], /^⚠ src\/scene\.ts:10:.*new THREE\.Fog/);
  assert.match(warnings[3], /^⚠ src\/scene\.ts:12:.*new THREE\.Fog/);
  assert.match(warnings[4], /^⚠ src\/scene\.ts:13:.*new THREE\.FogExp2/);
  assert.match(warnings[5], /^⚠ src\/scene\.ts:16:.*new THREE\.Fog.*createLightingRig/);
});

test("allows one-time Fog setup inside buildScene, setup helpers, and after unrelated arrow expressions", (t) => {
  const dir = createTempFilm(t, {
    "src/scene.ts": `
      function buildEnv() {
        return new THREE.Fog(0x101820, 5, 30);
      }
      export async function buildScene(canvas, W, H) {
        const staticFog = new THREE.FogExp2(0x101820, 0.01);
        const makeRoom = () => {
          const roomFog = new THREE.Fog(0x121212, 2, 24);
          return roomFog;
        };
        items.sort((a, b) => a - b); const afterSort = new THREE.Fog(0x111111, 1, 20);
        return () => {};
      }
    `,
  });

  assert.deepEqual(lookdevWarnings(dir), []);
});

test("warns on colorspace_fragment or tonemapping_fragment in custom shaders under post pipeline while ignoring GLSL comments and multiline onBeforeCompile hooks", (t) => {
  const dir = createTempFilm(t, {
    "src/scene.ts": `
      import { setupLookdev } from "./lookdev";
      const lookdev = setupLookdev({});
    `,
    "src/env.ts": `
      const mat = new THREE.ShaderMaterial({
        fragmentShader: \`
          void main() {
            gl_FragColor = vec4(1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        \`,
      });
    `,
    "src/safe-shader.ts": `
      const safeMat = new THREE.ShaderMaterial({
        fragmentShader: \`
          void main() {
            // #include <colorspace_fragment>
            /*
              #include <tonemapping_fragment>
            */
            gl_FragColor = vec4(1.0);
          }
        \`,
      });
    `,
    "src/pbr-hook.ts": `
      const cleanShader = new THREE.ShaderMaterial({ fragmentShader: "void main(){ gl_FragColor = vec4(1.0); }" });
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <colorspace_fragment>",
          "gl_FragColor.rgb *= 0.9;\\n#include <colorspace_fragment>",
        );
      };
    `,
  });

  const warnings = lookdevWarnings(dir);
  assert.equal(warnings.length, 1, warnings.join("\n"));
  assert.match(
    warnings[0],
    /^⚠ src\/env\.ts:6:.*tonemapping_fragment.*colorspace_fragment.*film-stage\/sky/,
  );
});

test("ignores shader tone-map/colorspace includes when no scene file uses EffectComposer or post pipeline (even if unused lookdev.ts exists)", (t) => {
  const dir = createTempFilm(t, {
    "src/lookdev.ts": `
      export const setupLookdev = () => null;
    `,
    "src/scene.ts": `
      const mat = new THREE.ShaderMaterial({
        fragmentShader: \`
          void main() {
            gl_FragColor = vec4(1.0);
            #include <colorspace_fragment>
          }
        \`,
      });
      renderer.render(scene, camera);
    `,
  });
  assert.deepEqual(lookdevWarnings(dir), []);
});

test("warns when lights.json has keys but scene code only calls setupLookdev or mentions lights.json in UI strings", (t) => {
  const deadDir = createTempFilm(
    t,
    {
      "src/lookdev.ts": `
        import { lightsAt } from "film-stage/lights";
        export const setupLookdev = () => ({ updateLighting: lightsAt });
      `,
      "src/scene.ts": `
        import { setupLookdev } from "./lookdev";
        export async function buildScene() {
          const lookdev = setupLookdev({});
          const describe = () => "EDIT HERE: src/timeline/lights.json";
          return () => describe();
        }
      `,
      "src/edit.ts": `
        import lights from "./timeline/lights.json";
        setEdit({ lights });
      `,
      "src/timeline/lights.json": JSON.stringify({ keys: [{ t: 0, preset: "studio-three-point" }] }),
    },
    { lightsTimeline: "src/timeline/lights.json" },
  );

  const warnings = lookdevWarnings(deadDir, { lightsTimeline: "src/timeline/lights.json" });
  assert.equal(warnings.length, 1, warnings.join("\n"));
  assert.match(warnings[0], /^⚠ src\/timeline\/lights\.json:.*updateLighting.*LightPanel/);

  const emptyLightsDir = createTempFilm(
    t,
    {
      "src/scene.ts": "export async function buildScene() { return () => {}; }\n",
      "src/timeline/lights.json": JSON.stringify({ keys: [] }),
    },
    { lightsTimeline: "src/timeline/lights.json" },
  );
  assert.deepEqual(lookdevWarnings(emptyLightsDir, { lightsTimeline: "src/timeline/lights.json" }), []);

  const wiredDir = createTempFilm(
    t,
    {
      "src/scene.ts": `
        import { setupLookdev } from "./lookdev";
        export async function buildScene() {
          const lookdev = setupLookdev({});
          return (t) => lookdev.updateLighting(null, t);
        }
      `,
      "src/timeline/lights.json": JSON.stringify({ keys: [{ t: 0, preset: "studio-three-point" }] }),
    },
    { lightsTimeline: "src/timeline/lights.json" },
  );
  assert.deepEqual(lookdevWarnings(wiredDir, { lightsTimeline: "src/timeline/lights.json" }), []);
});

test("warns on raw hand-rolled EffectComposer + N8AOPostPass boilerplate and nudges to setupLookdev / createPostPipeline", (t) => {
  const dir = createTempFilm(t, {
    "src/scene.ts": `
      import { N8AOPostPass } from "n8ao";
      import { EffectComposer } from "postprocessing";
      export async function buildScene(renderer, scene, camera, W, H) {
        const composer = new EffectComposer(renderer);
        const ao = new N8AOPostPass(scene, camera, W, H);
        composer.addPass(ao);
      }
    `,
  });

  const warnings = lookdevWarnings(dir);
  assert.equal(warnings.length, 1, warnings.join("\n"));
  assert.match(
    warnings[0],
    /^⚠ src\/scene\.ts:5:.*EffectComposer.*N8AOPostPass.*setupLookdev.*createPostPipeline/,
  );
});

test("handles missing src directory, src-as-file, corrupt lights.json, and path-traversal lightsTimeline safely", (t) => {
  const noSrc = mkdtempSync(join(tmpdir(), "lookdev-nosrc-"));
  t.after(() => rmSync(noSrc, { recursive: true, force: true }));
  assert.deepEqual(lookdevWarnings(noSrc), []);

  const fileSrc = mkdtempSync(join(tmpdir(), "lookdev-filesrc-"));
  t.after(() => rmSync(fileSrc, { recursive: true, force: true }));
  writeFileSync(join(fileSrc, "src"), "not a directory");
  assert.deepEqual(lookdevWarnings(fileSrc), []);

  const corruptDir = createTempFilm(
    t,
    {
      "src/scene.ts": "export {};\n",
      "src/timeline/lights.json": "{ not valid json",
    },
    { lightsTimeline: "src/timeline/lights.json" },
  );
  assert.deepEqual(lookdevWarnings(corruptDir, { lightsTimeline: "src/timeline/lights.json" }), []);

  const parent = mkdtempSync(join(tmpdir(), "lookdev-escape-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  writeFileSync(join(parent, "outside.json"), JSON.stringify({ keys: [{ t: 0 }] }));
  const child = join(parent, "film");
  mkdirSync(join(child, "src"), { recursive: true });
  writeFileSync(join(child, "src/scene.ts"), "export {};\n");
  assert.deepEqual(lookdevWarnings(child, { lightsTimeline: "../outside.json" }), []);
});

test("treats member property division like shot.in / 2 as division rather than a regex literal", (t) => {
  const dir = createTempFilm(t, {
    "src/scene.ts": `
      const a = shot.in / 2 + shot.of / 4; // THREE.PCFSoftShadowMap
      const b = obj.in / 2;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    `,
  });

  const warnings = lookdevWarnings(dir);
  assert.equal(warnings.length, 1, warnings.join("\n"));
  assert.match(warnings[0], /^⚠ src\/scene\.ts:4:.*PCFSoftShadowMap/);
});

test("detects shader includes after strings containing image/* or https:// and ignores replace() calls with regex parens", (t) => {
  const dir = createTempFilm(t, {
    "src/scene.ts": `
      import { setupLookdev } from "./lookdev";
      const lookdev = setupLookdev({});
      const mime = "image/*";
      const docs = "https://example.com/shader";
      const hook = src.replace(/\\)/g, "").replace(
        "#include <colorspace_fragment>",
        "gl_FragColor.rgb *= 0.9;\\n#include <colorspace_fragment>",
      );
      const mat = new THREE.ShaderMaterial({
        fragmentShader: \`
          void main() {
            gl_FragColor = vec4(1.0);
            #include <colorspace_fragment>
          }
        \`,
      });
    `,
  });

  const warnings = lookdevWarnings(dir);
  assert.equal(warnings.length, 1, warnings.join("\n"));
  assert.match(warnings[0], /^⚠ src\/scene\.ts:14:.*colorspace_fragment/);
});

test("detects braceless for(a;b;c) Fog allocations and TS var-typed per-frame callbacks", (t) => {
  const dir = createTempFilm(t, {
    "src/scene.ts": `
      export async function buildScene() {
        for (let i = 0; i < 3; i++) scene.fog = new THREE.Fog(0x111111, 1, 10);
        const frame: (t: number) => void = (t) => {
          scene.fog = new THREE.FogExp2(0x222222, 0.02);
        };
        return frame;
      }
    `,
  });

  const warnings = lookdevWarnings(dir);
  assert.equal(warnings.length, 2, warnings.join("\n"));
  assert.match(warnings[0], /^⚠ src\/scene\.ts:3:.*new THREE\.Fog/);
  assert.match(warnings[1], /^⚠ src\/scene\.ts:5:.*new THREE\.FogExp2/);
});

test("does not flag Fog after semicolon-free ASI arrow or inside factory return outside buildScene", (t) => {
  const dir = createTempFilm(t, {
    "src/scene.ts": `
      function makeFogFactory() {
        return () => new THREE.Fog(0x101010, 2, 16);
      }
      export async function buildScene() {
        const tick = (t) => move(t)
        const fog = new THREE.Fog(0x111111, 1, 20)
        return () => {};
      }
    `,
  });

  assert.deepEqual(lookdevWarnings(dir), []);
});

test("accepts optional-chained EDIT?.lights as wired lights.json usage", (t) => {
  const dir = createTempFilm(
    t,
    {
      "src/scene.ts": `
        export async function buildScene() {
          return () => EDIT?.lights;
        }
      `,
      "src/timeline/lights.json": JSON.stringify({ keys: [{ t: 0, preset: "studio-three-point" }] }),
    },
    { lightsTimeline: "src/timeline/lights.json" },
  );

  assert.deepEqual(lookdevWarnings(dir, { lightsTimeline: "src/timeline/lights.json" }), []);
});

test("keeps UTF-16 indices aligned with non-BMP emoji around replace() hooks and handles escaped-newline GLSL comments", (t) => {
  const dir = createTempFilm(t, {
    "src/scene.ts": `
      import { setupLookdev } from "./lookdev";
      const lookdev = setupLookdev({});
      const badge = "🔥🎬";
      const patched = src.replace("🔥#include <colorspace_fragment>", "ok");
      const mat = new THREE.ShaderMaterial({
        fragmentShader: "// linear note\\n#include <colorspace_fragment>",
      });
    `,
  });

  const warnings = lookdevWarnings(dir);
  assert.equal(warnings.length, 1, warnings.join("\n"));
  assert.match(warnings[0], /^⚠ src\/scene\.ts:7:.*colorspace_fragment/);
});

test("scopes makeTransitions callback detection to unclosed calls and ignores multiline ASI arrow bodies", (t) => {
  const cleanDir = createTempFilm(t, {
    "src/scene.ts": `
      export async function buildScene() {
        const composite = makeTransitions(renderer, frame)
        const makeRoom = () => {
          const roomFog = new THREE.Fog(0x111111, 2, 20)
          return roomFog
        }
        const tick = (t) =>
          move(t)
        const fog = new THREE.Fog(0x222222, 1, 12)
        return composite
      }
    `,
  });
  assert.deepEqual(lookdevWarnings(cleanDir), []);

  const callbackDir = createTempFilm(t, {
    "src/scene.ts": `
      export async function buildScene() {
        return makeTransitions(renderer, frame, () => {}, () => 1, free, (t) => {
          scene.fog = new THREE.Fog(0x111111, 1, 10);
        });
      }
    `,
  });
  const warnings = lookdevWarnings(callbackDir);
  assert.equal(warnings.length, 1, warnings.join("\n"));
  assert.match(warnings[0], /^⚠ src\/scene\.ts:4:.*new THREE\.Fog/);
});

test("requires a path boundary when matching lights.json imports so headlights.json does not mask dead lights.json", (t) => {
  const dir = createTempFilm(
    t,
    {
      "src/scene.ts": `
        import headlights from "./headlights.json";
        export async function buildScene() { return () => headlights; }
      `,
      "src/timeline/lights.json": JSON.stringify({ keys: [{ t: 0, preset: "studio-three-point" }] }),
    },
    { lightsTimeline: "src/timeline/lights.json" },
  );

  const warnings = lookdevWarnings(dir, { lightsTimeline: "src/timeline/lights.json" });
  assert.equal(warnings.length, 1, warnings.join("\n"));
  assert.match(warnings[0], /^⚠ src\/timeline\/lights\.json:.*LightPanel/);
});

test("handles TS function return types with => in stripTrailingReturnType and non-null asserted PMREM dispose", (t) => {
  const dir = createTempFilm(t, {
    "src/scene.ts": `
      export async function buildScene(canvas: HTMLCanvasElement): Promise<(t: number) => void> {
        const pmrem = new THREE.PMREMGenerator(renderer);
        pmrem!.dispose();
        const staticFog = new THREE.Fog(0x111111, 2, 20);
        const frame = (t: number): (() => void) => {
          scene.fog = new THREE.Fog(0x222222, 1, 10);
          return () => {};
        };
        return (t: number) => {
          scene.fog = new THREE.FogExp2(0x333333, 0.02);
        };
      }
      function frame(t: number): () => void {
        scene.fog = new THREE.Fog(0x444444, 1, 12);
        return () => {};
      }
    `,
  });

  const warnings = lookdevWarnings(dir);
  assert.equal(warnings.length, 3, warnings.join("\n"));
  assert.match(warnings[0], /^⚠ src\/scene\.ts:7:.*new THREE\.Fog/);
  assert.match(warnings[1], /^⚠ src\/scene\.ts:11:.*new THREE\.FogExp2/);
  assert.match(warnings[2], /^⚠ src\/scene\.ts:15:.*new THREE\.Fog/);
});

test("check.mjs surfaces lookdev warnings as non-blocking warnings in both --json and plain-text output", (t) => {
  const dir = createTempFilm(
    t,
    {
      "src/scene.ts": `
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        key.shadow.radius = 6;
      `,
      "src/timeline/lights.json": JSON.stringify({ keys: [{ t: 0, preset: "studio-three-point" }] }),
    },
    { lightsTimeline: "src/timeline/lights.json" },
  );

  const jsonRes = spawnSync(process.execPath, [CHECK_SCRIPT, "--json"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(jsonRes.status, 0, jsonRes.stdout + jsonRes.stderr);
  const report = JSON.parse(jsonRes.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.problems.length, 0);
  assert.ok(report.warnings.every((w) => w.startsWith("⚠")), JSON.stringify(report.warnings));
  assert.ok(report.warnings.some((w) => w.includes("PCFSoftShadowMap")), JSON.stringify(report.warnings));
  assert.ok(report.warnings.some((w) => w.includes("shadow.radius = 6")), JSON.stringify(report.warnings));
  assert.ok(report.warnings.some((w) => w.includes("src/timeline/lights.json")), JSON.stringify(report.warnings));

  const textRes = spawnSync(process.execPath, [CHECK_SCRIPT], {
    cwd: dir,
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(textRes.status, 0, textRes.stdout + textRes.stderr);
  assert.match(textRes.stdout, /⚠ src\/scene\.ts:2:.*PCFSoftShadowMap/);
  assert.match(textRes.stdout, /⚠ src\/scene\.ts:3:.*shadow\.radius = 6/);
  assert.match(textRes.stdout, /⚠ src\/timeline\/lights\.json:.*LightPanel/);
  assert.match(textRes.stdout, /ok: the film's data is what the studio expects/);
});
