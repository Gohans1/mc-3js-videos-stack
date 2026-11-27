import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Hono } from "hono";
import * as z from "zod";

import { openPage } from "../../film-stage/test/gpu.ts";
import { openFilm } from "../src/film.mjs";
import { mountHistory } from "../src/history-api.mjs";
import { openFilmHistory } from "../src/history.mjs";
import { openTimelineFile } from "../src/timeline_file.mjs";

const setup = (t, options) => {
  const project = mkdtempSync(join(tmpdir(), "film-history-"));
  mkdirSync(join(project, "src"));
  writeFileSync(join(project, "src/scene.ts"), "export const lighting = 'cold';\n");
  writeFileSync(join(project, "package.json"), '{"name":"film"}');
  const history = openFilmHistory(project, options);
  t.after(() => {
    history.close();
    rmSync(project, { recursive: true, force: true });
  });
  return { project, history };
};

test("autosave notifies Versions about failure and recovery without a new revision", async (t) => {
  let fail = false;
  const reported = [];
  const { project, history } = setup(t, {
    beforeCapture: () => {
      if (fail) throw new Error("Could not read the editing files");
    },
    changed: () => reported.push(history.problem),
    onError() {},
  });
  history.capture("Working", "named");
  reported.length = 0;
  fail = true;
  history.start();
  assert.deepEqual(reported, ["Could not read the editing files"]);

  fail = false;
  writeFileSync(join(project, "src/scene.ts"), "export const lighting = 'cold';\n");
  const deadline = Date.now() + 4000;
  while (reported.length < 2 && Date.now() < deadline) await Bun.sleep(25);
  assert.deepEqual(reported, ["Could not read the editing files", null]);
  assert.equal(history.list().length, 1);
});

test("Versions stays idle between updates and catches up after a reconnect", async (t) => {
  const { history } = setup(t);
  history.capture("First version", "named");
  let events,
    reads = 0,
    unavailable = false;
  const page = await openPage(join(import.meta.dirname, "history-page.tsx"), (req) => {
    const path = new URL(req.url).pathname;
    if (path === "/api/history") {
      reads++;
      if (unavailable)
        return Response.json({ error: "Versions temporarily unavailable" }, { status: 503 });
      return Response.json({
        revisions: history.list(),
        current: history.current(),
        next: null,
        problem: history.problem,
      });
    }
    if (path === "/api/events") {
      return new Response(
        new ReadableStream({
          start(controller) {
            events = controller;
            events.enqueue("retry: 100\nevent: hello\ndata: test\n\n");
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    }
  });
  t.after(() => page.close());
  const shown = async (name) => {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (await page.run(`document.body.innerText.includes(${JSON.stringify(name)})`)) return;
      await Bun.sleep(25);
    }
    assert.fail(`Versions did not show ${name}`);
  };
  await shown("First version");
  assert.ok(events);
  history.capture("Second version", "named");
  events.enqueue("event: history\ndata: \n\n");
  await shown("Second version");
  const readsAfterChange = reads;
  await Bun.sleep(5200);
  assert.equal(reads, readsAfterChange);

  unavailable = true;
  events.enqueue("event: history\ndata: \n\n");
  await shown("Versions temporarily unavailable");
  unavailable = false;
  history.capture("Version saved during disconnect", "named");
  events.close();
  await shown("Version saved during disconnect");
});

test("named and automatic revisions survive reopening without touching project Git or media", (t) => {
  const { project, history } = setup(t);
  writeFileSync(join(project, ".git"), "untouched");
  mkdirSync(join(project, "assets"));
  writeFileSync(join(project, "assets/movie.mp4"), "media");
  const named = history.capture("Cold lighting", "named");
  assert.equal(history.capture("Autosave", "auto").id, named.id);
  writeFileSync(join(project, "src/scene.ts"), "export const lighting = 'warm';\n");
  history.capture("Autosave", "auto");
  const reopened = openFilmHistory(project);
  try {
    assert.equal(reopened.list().length, 2);
    assert.equal(reopened.list().at(-1).name, "Cold lighting");
  } finally {
    reopened.close();
  }
  assert.equal(readFileSync(join(project, ".git"), "utf8"), "untouched");
  assert.equal(readFileSync(join(project, "assets/movie.mp4"), "utf8"), "media");
});

test("restore is film-scoped, restores deletions and preserves a recovery revision", (t) => {
  const { project, history } = setup(t);
  const original = history.capture("Cold", "named");
  writeFileSync(join(project, "src/scene.ts"), "warm");
  writeFileSync(join(project, "src/new.ts"), "new code");
  const current = history.current();
  const result = history.restore(original.id, current.fingerprint);
  assert.match(readFileSync(join(project, "src/scene.ts"), "utf8"), /cold/);
  assert.equal(existsSync(join(project, "src/new.ts")), false);
  history.restore(result.backup.id, history.current().fingerprint);
  assert.equal(readFileSync(join(project, "src/scene.ts"), "utf8"), "warm");
  assert.equal(readFileSync(join(project, "src/new.ts"), "utf8"), "new code");
});

test("restore refuses a changed working film before writing anything", (t) => {
  const { project, history } = setup(t);
  const original = history.capture("Cold", "named");
  const viewed = history.current();
  writeFileSync(join(project, "src/scene.ts"), "newer edit");
  assert.throws(() => history.restore(original.id, viewed.fingerprint), /changed/i);
  assert.equal(readFileSync(join(project, "src/scene.ts"), "utf8"), "newer edit");
});

test("history can recover broken timeline JSON and keeps the broken bytes in its recovery version", (t) => {
  const { project } = setup(t);
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify({ "live-studio": { camTimeline: "src/cam.json" } }),
  );
  writeFileSync(join(project, "src/cam.json"), "[]");
  const film = openFilm(project, { send() {} });
  try {
    const good = film.history.capture("Working", "named");
    writeFileSync(join(project, "src/cam.json"), "{broken");
    const result = film.history.restore(good.id, film.history.current().fingerprint);
    assert.equal(readFileSync(join(project, "src/cam.json"), "utf8"), "[]");
    film.history.restore(result.backup.id, film.history.current().fingerprint);
    assert.equal(readFileSync(join(project, "src/cam.json"), "utf8"), "{broken");
  } finally {
    film.stop();
  }
});

test("configured timelines and picks outside src are observed and restored with their original configuration", async (t) => {
  const { project, history } = setup(t);
  mkdirSync(join(project, "timeline"));
  mkdirSync(join(project, "pack"));
  const pkg = { "live-studio": { camTimeline: "./timeline/camera.json" } };
  writeFileSync(join(project, "package.json"), JSON.stringify(pkg));
  writeFileSync(join(project, "timeline/camera.json"), "45");
  writeFileSync(join(project, "pack/picks.json"), '["old"]');
  history.start();
  const saved = history.capture("Cold", "named");
  writeFileSync(join(project, "timeline/camera.json"), "60");
  writeFileSync(join(project, "pack/picks.json"), '["new"]');
  const deadline = Date.now() + 4000;
  while (history.list()[0].fingerprint === saved.fingerprint && Date.now() < deadline)
    await new Promise((done) => setTimeout(done, 25));
  assert.notEqual(history.list()[0].fingerprint, saved.fingerprint);
  writeFileSync(join(project, "package.json"), "{broken");
  const result = history.restore(saved.id, history.current().fingerprint);
  assert.equal(readFileSync(join(project, "timeline/camera.json"), "utf8"), "45");
  assert.equal(readFileSync(join(project, "pack/picks.json"), "utf8"), '["old"]');
  history.restore(result.backup.id, history.current().fingerprint);
  assert.equal(readFileSync(join(project, "timeline/camera.json"), "utf8"), "60");
  assert.equal(readFileSync(join(project, "package.json"), "utf8"), "{broken");
});

test("the offline CLI can restore an existing history after scene.ts was deleted", (t) => {
  const { project, history } = setup(t);
  const saved = history.capture("Working", "named");
  rmSync(join(project, "src/scene.ts"));
  const base = history.current().fingerprint;
  const result = Bun.spawnSync([
    "bun",
    "packages/live-studio/history.mjs",
    "--film",
    project,
    "restore",
    saved.id,
    "--base",
    base,
  ]);
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.match(readFileSync(join(project, "src/scene.ts"), "utf8"), /cold/);
});

test("historical configured paths stay tracked across config changes, deletion, restore and reopening", (t) => {
  const { project, history } = setup(t);
  mkdirSync(join(project, "timeline"));
  const keep = (name) => {
    writeFileSync(
      join(project, "package.json"),
      JSON.stringify({ "live-studio": { camTimeline: `timeline/${name}.json` } }),
    );
    writeFileSync(join(project, `timeline/${name}.json`), name);
    return history.capture(name, "named");
  };
  keep("a");
  const b = keep("b");
  keep("c");
  rmSync(join(project, "timeline/a.json"));
  history.capture();
  const result = history.restore(b.id, history.current().fingerprint);
  assert.equal(result.revision.fingerprint, b.fingerprint);
  const reopened = openFilmHistory(project);
  try {
    const before = reopened.current().fingerprint;
    writeFileSync(join(project, "timeline/a.json"), "edited a");
    assert.notEqual(reopened.current().fingerprint, before);
    const saved = reopened.capture("Edited a", "named");
    writeFileSync(join(project, "timeline/a.json"), "lost a");
    reopened.restore(saved.id, reopened.current().fingerprint);
    assert.equal(readFileSync(join(project, "timeline/a.json"), "utf8"), "edited a");
  } finally {
    reopened.close();
  }
});

test("case aliases on a case-insensitive filesystem cannot delete the restored timeline", (t) => {
  const { project, history } = setup(t);
  writeFileSync(join(project, "camera.json"), "45");
  if (!existsSync(join(project, "Camera.json"))) {
    t.skip("Requires a case-insensitive filesystem");
    return;
  }
  const configure = (name) =>
    writeFileSync(
      join(project, "package.json"),
      JSON.stringify({ "live-studio": { camTimeline: name } }),
    );
  configure("camera.json");
  const original = history.capture("Original", "named");
  configure("Camera.json");
  writeFileSync(join(project, "Camera.json"), "60");
  const timeline = openTimelineFile(project, "Camera.json", z.number());
  timeline.write(timeline.read().version, 65);
  history.capture("Alternative", "named");
  const result = history.restore(original.id, history.current().fingerprint);
  assert.equal(readFileSync(join(project, "camera.json"), "utf8"), "45");
  assert.equal(result.revision.fingerprint, original.fingerprint);
  timeline.reloadProtection();
  assert.equal(timeline.read().data, 45);
  history.restore(result.backup.id, history.current().fingerprint);
  assert.equal(readFileSync(join(project, "Camera.json"), "utf8"), "65\n");
});

test("distinct case-sensitive files remain separate editing files", (t) => {
  const { project, history } = setup(t);
  writeFileSync(join(project, "camera.json"), "45");
  if (existsSync(join(project, "Camera.json"))) {
    t.skip("Requires a case-sensitive filesystem");
    return;
  }
  writeFileSync(join(project, "Camera.json"), "60");
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify({ "live-studio": { keyFiles: { "camera.json": "a", "Camera.json": "b" } } }),
  );
  const saved = history.capture("Both", "named");
  writeFileSync(join(project, "camera.json"), "90");
  writeFileSync(join(project, "Camera.json"), "100");
  history.restore(saved.id, history.current().fingerprint);
  assert.equal(readFileSync(join(project, "camera.json"), "utf8"), "45");
  assert.equal(readFileSync(join(project, "Camera.json"), "utf8"), "60");
});

for (const invalid of ["../wrong-camera.json", "src"]) {
  test(`history recovers configuration with an invalid current timeline path ${invalid}`, (t) => {
    const { project, history } = setup(t);
    const good = history.capture("Good config", "named");
    writeFileSync(
      join(project, "package.json"),
      JSON.stringify({ "live-studio": { camTimeline: invalid } }),
    );
    const current = history.current();
    assert.match(history.problem, /History|regular file/);
    history.restore(good.id, current.fingerprint);
    assert.equal(readFileSync(join(project, "package.json"), "utf8"), '{"name":"film"}');
  });
}

test("restoration replaces old human guards so a reopened Studio keeps the chosen revision", (t) => {
  const { project, history } = setup(t);
  const file = join(project, "src/cam.json");
  writeFileSync(file, '{"fov":50}');
  const original = history.capture("Before", "named");
  const timeline = openTimelineFile(project, "./src/cam.json", z.looseObject({}));
  timeline.write(timeline.read().version, { fov: 60 });
  history.restore(original.id, history.current().fingerprint);
  const reopened = openTimelineFile(project, "src/cam.json", z.looseObject({}));
  assert.equal(reopened.read().data.fov, 50);
  writeFileSync(file, '{"fov":60}');
  assert.equal(reopened.read().data.fov, 50);
});

test("the API names versions and refuses stale restores without changing the film", async (t) => {
  const { project, history } = setup(t);
  const app = new Hono();
  mountHistory(app, { PROJECT: project, history });
  const post = (path, data) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
  const saved = await (await post("/api/history", { name: "Cold" })).json();
  const viewed = await (await app.request("/api/history")).json();
  writeFileSync(join(project, "src/scene.ts"), "new edit");
  assert.equal(
    (await post("/api/history/restore", { id: saved.id, base: viewed.current.fingerprint })).status,
    409,
  );
  const current = await (await app.request("/api/history")).json();
  const restored = await (
    await post("/api/history/restore", { id: saved.id, base: current.current.fingerprint })
  ).json();
  assert.equal(restored.backup.kind, "before-restore");
  assert.match(readFileSync(join(project, "src/scene.ts"), "utf8"), /cold/);
});

test("automatic history observes a real source edit and survives closing its watcher", async (t) => {
  const { project, history } = setup(t);
  history.start();
  writeFileSync(join(project, "src/scene.ts"), "automatic edit");
  const deadline = Date.now() + 4000;
  while (history.list().length < 2 && Date.now() < deadline)
    await new Promise((done) => setTimeout(done, 25));
  assert.equal(history.list().length, 2);
  assert.equal(history.list()[0].kind, "auto");
});

test("restoring OpenFilm overlays reloads the live document's protection", (t) => {
  const { project } = setup(t);
  mkdirSync(join(project, "src/timeline"));
  const file = join(project, "src/timeline/openfilm.json");
  const initial = { items: [{ id: "overlay", asset: "effects/grain", from: 0, to: 1 }] };
  writeFileSync(file, JSON.stringify(initial));
  const film = openFilm(project, { send() {} });
  try {
    const saved = film.history.capture("Original overlays", "named");
    const current = film.openfilm.read();
    const result = film.openfilm.write(current.version, {
      items: [{ ...current.data.items[0], to: 3 }],
    });
    assert.ok(result.version, JSON.stringify(result));
    film.history.restore(saved.id, film.history.current().fingerprint);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).items[0].to, 1);
    assert.equal(film.openfilm.read().data.items[0].to, 1);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).items[0].to, 1);
  } finally {
    film.stop();
  }
});

test("history includes a configured overlay timeline outside src", (t) => {
  const { project, history } = setup(t);
  mkdirSync(join(project, "editing"));
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify({
      "live-studio": { openfilmTimeline: "editing/overlays.json" },
    }),
  );
  const file = join(project, "editing/overlays.json");
  writeFileSync(file, "original overlays");
  const saved = history.capture("Original overlays", "named");
  writeFileSync(file, "edited overlays");
  assert.notEqual(history.current().fingerprint, saved.fingerprint);
  history.restore(saved.id, history.current().fingerprint);
  assert.equal(readFileSync(file, "utf8"), "original overlays");
});

test("a live history read keeps an asset successfully added by the CLI", (t) => {
  const { project } = setup(t);
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify({
      "live-studio": { textTimeline: "src/text.json" },
    }),
  );
  const file = join(project, "src/text.json");
  writeFileSync(file, JSON.stringify({ items: [] }));
  const film = openFilm(project, { send() {} });
  try {
    film.text.write(film.text.read().version, {
      items: [{ id: "human", kind: "text", text: "Human title", from: 0, to: 1 }],
    });
    const props = join(project, "props.json");
    writeFileSync(props, JSON.stringify({ text: "CLI title" }));
    const cli = Bun.spawnSync(
      [
        process.execPath,
        "scripts/asset.mjs",
        "use",
        "text/in/fade",
        "--film",
        project,
        "--from",
        "2",
        "--to",
        "4",
        "--props-file",
        props,
      ],
      { timeout: 15000 },
    );
    assert.equal(cli.exitCode, 0, cli.stderr.toString());
    assert.equal(JSON.parse(readFileSync(file, "utf8")).items.length, 2);
    film.history.current();
    assert.deepEqual(
      film.text.read().data.items.map((item) => item.text),
      ["Human title", "CLI title"],
    );
    assert.equal(JSON.parse(readFileSync(file, "utf8")).items.length, 2);
  } finally {
    film.stop();
  }
});

test("history.start after history.close is a safe no-op that does not touch the closed database", (t) => {
  const { project } = setup(t);
  let errors = 0;
  let changes = 0;
  const h = openFilmHistory(project, {
    onError: () => {
      errors++;
    },
    changed: () => {
      changes++;
    },
  });
  h.close();
  assert.doesNotThrow(() => {
    h.start();
    h.close();
  });
  assert.equal(errors, 0);
  assert.equal(changes, 0);
});
