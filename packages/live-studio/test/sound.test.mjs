import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { openSound, wavInfo, wavPeaks } from "../src/sound.mjs";
import { compactJson } from "../src/timeline_file.mjs";

const dir = mkdtempSync(join(tmpdir(), "studio-sound-"));
after(() => rmSync(dir, { recursive: true, force: true }));

// A mono 16 bit WAV: one second of silence, then one at half level
const wav = (file, rate = 8000) => {
  const n = rate * 2, data = Buffer.alloc(n * 2);
  for (let i = rate; i < n; i++) data.writeInt16LE(i % 2 ? 16384 : -16384, i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([h, data]));
};

test("a WAV's length comes from its header and its level curve follows the sound", () => {
  const f = join(dir, "two.wav");
  wav(f);
  assert.equal(wavInfo(f).seconds, 2);
  const { step, peaks } = wavPeaks(f);
  assert.equal(peaks.length, Math.round(2 / step));
  assert.equal(peaks[10], 0);
  assert.equal(peaks.at(-10), 0.5);
});

test("the studio writes the lanes as the films' timeline writer does: short entries on one line", () => {
  const data = { beds: [{ name: "hum", from: 0, to: 9, gain: 2, fadeIn: 0.5, fadeOut: 1 }], sfx: Array.from({ length: 3 }, (_, i) => ({ at: i, name: "tap", gain: -3 })) };
  assert.equal(compactJson({ sfx: data.sfx.slice(0, 1) }), '{"sfx": [{"at": 0, "name": "tap", "gain": -3}]}');
  const lines = compactJson({ ...data, sfx: Array.from({ length: 9 }, (_, i) => ({ at: i, name: "tap", gain: -3 })) }).split("\n");
  assert.equal(lines[0], "{");
  assert.ok(lines.every((l) => l.length <= 140));
  assert.equal(lines.find((l) => l.includes('"at": 4')).trim(), '{"at": 4, "name": "tap", "gain": -3},');
});

test("a film's lanes as timeline_fmt.py wrote them come back unchanged but for whole-number floats (2.0 reads 2)", () => {
  const text = readFileSync(join(import.meta.dirname, "fixtures/timeline/audio.json"), "utf8");
  assert.equal(compactJson(JSON.parse(text)) + "\n", text.replace(/(\d)\.0(?=[,\]}\s])/g, "$1"));
});

test("a save made on an old version is refused, a bad one is named, a good one is written", () => {
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  wav(join(dir, "sound/sfx/tap.wav"));
  writeFileSync(join(dir, "sound/sfx/SOURCES.json"), JSON.stringify({ tap: { title: "A tap", license: "CC0 1.0", kind: "bgm", role: "whoosh" } }));
  const file = join(dir, "src/timeline/audio.json");
  writeFileSync(file, JSON.stringify({ voiceGain: 0, beds: [], sfx: [{ at: 1, name: "tap", gain: 0, try: ["knock"] }] }));
  const s = openSound(dir, { soundTimeline: "src/timeline/audio.json", sfx: "sound/sfx" });
  const { version, data } = s.read();
  assert.deepEqual(s.library(), [{ name: "tap", seconds: 2, title: "A tap", license: "CC0 1.0", url: undefined, for: undefined, kind: "bgm", role: "whoosh" }]);
  assert.match(s.write(version, { ...data, sfx: [{ at: -1, name: "tap", gain: 0 }] }).problems.join(), /sfx/);
  data.sfx[0].at = 2.5;
  const ok = s.write(version, data);
  assert.ok(ok.version);
  assert.ok(s.ownWrite());
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).sfx[0], { at: 2.5, name: "tap", gain: 0, try: ["knock"] }); // the film's own keys stay
  assert.deepEqual(s.write(version, data), { conflict: true });
  writeFileSync(file, readFileSync(file, "utf8").replace("2.5", "3"));
  assert.ok(!s.ownWrite());
  assert.equal(s.fileOf("../x"), null);
  assert.equal(openSound(dir, {}), null);
});
