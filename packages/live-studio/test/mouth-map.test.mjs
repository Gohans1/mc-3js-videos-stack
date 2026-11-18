import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { mouthFaults, shapeTake, speakingTakes, writeMouthMap } from "../src/mouth-map.mjs";

const writePcm16Wav = (file, seconds = 0.2, rate = 8000) => {
  const samples = Math.max(1, Math.round(seconds * rate));
  const data = Buffer.alloc(samples * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([h, data]));
};

const film = (t, takes) => {
  const dir = mkdtempSync(join(tmpdir(), "mouth-map-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "voice/takes"), { recursive: true });
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ takes }));
  for (const k of takes) writeFileSync(join(dir, `voice/takes/${k.id}.mp3`), "audio");
  return dir;
};
const shapes = (dir, id, cues) =>
  writeFileSync(join(dir, `voice/takes/${id}.mp3.mouth.json`), JSON.stringify({ cues }));

test("a take said by a character on screen without mouth shapes is named, with the command that makes them", (t) => {
  const dir = film(t, [
    { id: "hi", by: "steve", start: 0 },
    { id: "intro", start: 3 },
  ]);
  const faults = mouthFaults(dir);
  assert.equal(faults.length, 1);
  assert.match(faults[0], /"hi" \(by steve\).*steve's mouth stays shut.*bun run voice:lips/);
});

test("the map places each take's shapes where the voice places the take, and goes stale when a take moves", (t) => {
  const dir = film(t, [
    { id: "hi", by: "steve", start: 2 },
    { id: "intro", start: 5 },
  ]);
  shapes(dir, "hi", [
    [0, "X"],
    [0.4, "D"],
  ]);
  writeMouthMap(dir);
  const map = JSON.parse(readFileSync(join(dir, "src/timeline/mouth.json"), "utf8"));
  assert.deepEqual(map.takes, [
    {
      id: "hi",
      at: 2,
      cues: [
        [0, "X"],
        [0.4, "D"],
      ],
    },
  ]);
  assert.deepEqual(mouthFaults(dir), []);

  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({ takes: [{ id: "hi", by: "steve", start: 4 }] }),
  );
  assert.match(mouthFaults(dir).join("\n"), /mouth\.json.*behind.*bun run voice:lips/);
});

test("audio newer than its shapes (the take was made again) is named", (t) => {
  const dir = film(t, [{ id: "hi", by: "steve", start: 0 }]);
  shapes(dir, "hi", [[0, "X"]]);
  writeMouthMap(dir);
  const later = new Date(Date.now() + 60_000);
  utimesSync(join(dir, "voice/takes/hi.mp3"), later, later);
  assert.match(mouthFaults(dir).join("\n"), /"hi".*audio changed.*bun run voice:lips/);
});

test("shapes that are no JSON or hold no cues are named, even with a map written from them", (t) => {
  for (const bad of ["{", JSON.stringify({ shapes: [] }), JSON.stringify({ cues: [] })]) {
    const dir = film(t, [{ id: "hi", by: "steve", start: 0 }]);
    const shapesPath = join(dir, "voice/takes/hi.mp3.mouth.json");
    writeFileSync(shapesPath, bad);
    const future = new Date(Date.now() + 60_000);
    utimesSync(shapesPath, future, future);
    assert.equal(speakingTakes(dir)[0]?.fresh, false);
    writeMouthMap(dir);
    assert.match(mouthFaults(dir).join("\n"), /"hi" \(by steve\).*no cues.*bun run voice:lips/);
  }
});

test("shapeTake rejects missing output, invalid JSON, and empty mouthCues without writing .mouth.json, and writeMouthMap blocks escaped symlinks", (t) => {
  const dir = film(t, [{ id: "hi", by: "steve", start: 0 }]);
  const outside = mkdtempSync(join(tmpdir(), "mouth-map-out-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));

  const wavPath = join(dir, "voice/takes/hi.wav");
  const shapesPath = `${wavPath}.mouth.json`;
  writePcm16Wav(wavPath, 0.25);

  const stubSrc = join(dir, "rhubarb-stub.ts");
  const stubExe = join(dir, process.platform === "win32" ? "rhubarb-stub.exe" : "rhubarb-stub");
  writeFileSync(
    stubSrc,
    `import { writeFileSync } from "node:fs";
const idx = process.argv.indexOf("-o");
const out = idx >= 0 ? process.argv[idx + 1] : "";
const mode = process.env.RHUBARB_STUB_MODE || "empty";
if (mode === "empty") writeFileSync(out, JSON.stringify({ mouthCues: [] }));
else if (mode === "bad-json") writeFileSync(out, "{not json");
`,
  );
  const built = spawnSync(process.execPath, ["build", "--compile", stubSrc, "--outfile", stubExe], {
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(built.status, 0, built.stderr);

  const take = { id: "hi", by: "steve", audio: wavPath, shapes: shapesPath };
  for (const mode of ["missing-out", "bad-json", "empty"]) {
    process.env.RHUBARB_STUB_MODE = mode;
    assert.throws(
      () => shapeTake(take, "Hello", stubExe),
      /wrote no output|invalid output JSON|no usable mouth cues/i,
    );
    assert.equal(existsSync(shapesPath), false);
  }
  delete process.env.RHUBARB_STUB_MODE;

  assert.throws(
    () => shapeTake({ ...take, audio: join(dir, "voice/takes/missing.wav") }, "Hello", stubExe),
    /ffmpeg could not read/,
  );

  // writeMouthMap refuses junctioned src/timeline escaping root
  rmSync(join(dir, "src/timeline"), { recursive: true, force: true });
  let linked = false;
  try {
    symlinkSync(outside, join(dir, "src/timeline"), "junction");
    linked = true;
  } catch {
    linked = false;
  }
  if (linked) {
    assert.throws(() => writeMouthMap(dir), /symlink|junction|escapes/i);
    assert.equal(existsSync(join(outside, "mouth.json")), false);
  }
});
