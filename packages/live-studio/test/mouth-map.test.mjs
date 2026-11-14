import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { mouthFaults, writeMouthMap } from "../src/mouth-map.mjs";

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
