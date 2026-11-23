import assert from "node:assert/strict";
import { test } from "node:test";

test("a new machine is told every tool it lacks before setup starts, the ones setup cannot do without first", async () => {
  const { toolCheck } = await import("../tools.mjs");
  const has = new Set(["scoop", "curl", "ffprobe", "python", "uv", "earshot", "rubberband"]);
  const { stop, later } = toolCheck((name) => (has.has(name) ? `/bin/${name}` : null), "win32");
  assert.deepEqual(stop, ["ffmpeg (sound conversion and takes): scoop install ffmpeg"]);
  assert.deepEqual(later, [
    "aria2c (Sonniss torrent packs, bun run fetch:sound-raw): scoop install aria2",
  ]);
  has.delete("scoop");
  has.add("ffmpeg");
  assert.deepEqual(
    toolCheck((name) => (has.has(name) ? `/bin/${name}` : null), "win32"),
    {
      stop: [],
      later: [
        "scoop (installs the rest): see https://scoop.sh",
        "aria2c (Sonniss torrent packs, bun run fetch:sound-raw): scoop install aria2",
      ],
    },
  );
});
