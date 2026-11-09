import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openFilm, STUDIO } from "../src/film.mjs";

const fixture = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-film-"));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"));
  const audio = join(dir, "src/timeline/audio.json");
  writeFileSync(audio, '{"gain": 1}\n');
  writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": { sound: ["sound.py", "src/timeline/audio.json"] } }));
  writeFileSync(join(dir, "sound.py"), 'import sys, pathlib\nout = pathlib.Path(sys.argv[1])\nout.write_bytes(b"")\nout.with_name("trials.json").write_text("{}")\n');
  const events = new EventEmitter(), heard = [];
  const film = openFilm(dir, { send: (e) => { heard.push(e); events.emit(e); } });
  t.after(() => { film.stop(); rmSync(dir, { recursive: true, force: true }); });
  const mixed = (change) => new Promise((done, fail) => {
    const complete = () => { clearTimeout(timer); done(); };
    const timer = setTimeout(() => { events.off("sound", complete); fail(new Error(`No completed mix: ${heard.join(", ")}`)); }, 20000);
    events.once("sound", complete);
    change();
  });
  return { film, audio, heard, mixed };
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
