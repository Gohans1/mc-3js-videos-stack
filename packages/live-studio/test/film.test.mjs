import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { cpSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createApi } from "../src/api.mjs";
import { createActivity } from "../src/activity.mjs";
import { openFilm, STUDIO } from "../src/film.mjs";

const fixture = (t, config = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-film-"));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"));
  const audio = join(dir, "src/timeline/audio.json");
  writeFileSync(audio, '{"gain": 1}\n');
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { sound: ["sound.py", "src/timeline/audio.json"], ...config } }),
  );
  writeFileSync(
    join(dir, "sound.py"),
    'import sys, pathlib\nout = pathlib.Path(sys.argv[1])\nout.write_bytes(b"")\nout.with_name("trials.json").write_text("{}")\n',
  );
  const events = new EventEmitter(),
    heard = [];
  const send = (event, data) => {
    heard.push(event);
    events.emit(event, data);
  };
  const activity = createActivity(send);
  const film = openFilm(dir, { send, activity });
  t.after(() => {
    film.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const mixed = (change) =>
    new Promise((done, fail) => {
      const complete = () => {
        clearTimeout(timer);
        done();
      };
      const timer = setTimeout(() => {
        events.off("sound", complete);
        fail(new Error(`No completed mix: ${heard.join(", ")}`));
      }, 20000);
      events.once("sound", complete);
      change();
    });
  return { film, audio, heard, mixed, dir, send, activity, events };
};

test("a change to a file package.json lists under live-studio.sound remixes, with no optional script in the film", async (t) => {
  const { film, audio, heard, mixed } = fixture(t);
  await mixed(() => film.start());
  await mixed(() => writeFileSync(audio, '{"gain": 2}\n'));
  assert.equal(heard.filter((e) => e === "sound").length, 2);
});

test("a listed file deleted remixes too, and the studio keeps running", async (t) => {
  const { film, audio, heard, mixed } = fixture(t);
  await mixed(() => film.start());
  await mixed(() => rmSync(audio));
  assert.equal(heard.filter((e) => e === "sound").length, 2);
});

test("fresh and atomically replaced timelines announce the surface, including agent API saves", async (t) => {
  const { film, dir, send, activity, events, mixed } = fixture(t, {
    textTimeline: "src/timeline/text.json",
  });
  await mixed(() => film.start());
  const app = createApi(film, { send, activity, page: {}, events: new Set() });
  const path = join(dir, "src/timeline/text.json");
  const data = (text) => ({ items: [{ kind: "text", from: 1, to: 2, text }] });
  const textEvent = () => once(events, "text", { signal: AbortSignal.timeout(6000) });
  const first = textEvent();
  writeFileSync(path + ".new", JSON.stringify(data("First")));
  renameSync(path + ".new", path);
  await first;
  assert.equal(activity.state().lines.at(-1)?.surface, "text");

  const contractEvent = () => once(events, "contract", { signal: AbortSignal.timeout(6000) });
  const broken = contractEvent();
  writeFileSync(path, "{");
  await broken;
  assert.match(film.contract().files.join("\n"), /text\.json.*not valid JSON/s);
  assert.equal(activity.state().lines.length, 1);
  const repaired = contractEvent();
  writeFileSync(path, JSON.stringify(data("First")));
  await repaired;
  assert.deepEqual(film.contract().files, []);
  assert.equal(activity.state().lines.length, 1);

  const save = async (route, text) => {
    const current = await (await app.request("/api/text")).json();
    const next = textEvent();
    const response = await app.request(route, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ base: current.version, data: data(text) }),
    });
    assert.equal(response.status, 200);
    await next;
  };
  await save("/api/collaboration/text", "Agent edit");
  assert.deepEqual(activity.state().lines.map((line) => line.surface), ["text", "text"]);
  await save("/api/text", "Studio edit");
  assert.deepEqual(activity.state().lines.map((line) => line.surface), ["text", "text"]);
});
