import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gap } from "../gap";

const inTemp = (body: (file: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), "gap-"));
  try {
    body(join(dir, "gaps.jsonl"));
  } finally {
    rmSync(dir, { recursive: true });
  }
};

test("a gap is kept with what was done instead, the command it was missing from and the film", () =>
  inTemp((file) => {
    const said = gap(
      ["zoom into one region of a still", "--did", "cropped it with ffmpeg", "--cmd", "render"],
      file,
      "sealed-room",
    );
    expect(said).toMatch(/^noted: 1 gap so far, 1 about render/);
    const row = JSON.parse(readFileSync(file, "utf8").trim());
    expect(row).toMatchObject({
      need: "zoom into one region of a still",
      did: "cropped it with ffmpeg",
      cmd: "render",
      film: "sealed-room",
    });
  }));

test("a gap says what was done instead, or the agent is asked for it", () =>
  inTemp((file) => {
    expect(() => gap(["zoom into a region"], file)).toThrow(/--did "<what you did instead/);
    expect(() => gap(["--did", "x"], file)).toThrow(/what you needed, in words/);
  }));

test("the gaps listed: the commands asked of most first, each with its needs, newest first", () =>
  inTemp((file) => {
    gap(["zoom into a region", "--did", "ffmpeg crop", "--cmd", "render"], file);
    gap(["a sound by its loudness", "--did", "read PEAKS.json", "--cmd", "find"], file);
    gap(["zoom on a moving hand", "--did", "ffmpeg crop again", "--cmd", "render"], file);
    const out = gap([], file);
    expect(out).toMatch(
      /^3 gaps, by the command they were missing from:\nrender 2:\n  zoom on a moving hand/,
    );
    expect(out).toMatch(
      /find 1:\n  a sound by its loudness \(did: read PEAKS\.json; \d{4}-\d\d-\d\d\)/,
    );
  }));

test("no gaps yet says how one is kept", () =>
  inTemp((file) => {
    expect(gap([], file)).toMatch(/^no gaps yet\. When a command lacks something: bun run gap/);
  }));
