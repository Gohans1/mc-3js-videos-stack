import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../media/native.py", import.meta.url));
test("CED normalization retains independent scores and multi-word labels", () => {
  const code =
    "import runpy,sys,json; m=runpy.run_path(sys.argv[1]); print(json.dumps(m['parse_ced']('# sample.wav (8s)\\n0.7268  Speech\\n0.0675  Inside, small room\\n')))";
  const r = spawnSync("python", ["-c", code, script], { encoding: "utf8", timeout: 15000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [
    { label: "Speech", score: 0.7268 },
    { label: "Inside, small room", score: 0.0675 },
  ]);
});
test("native adapter validates parameters before writing or loading models", (t) => {
  const root = mkdtempSync(join(tmpdir(), "native-media-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source.wav");
  writeFileSync(source, "not decoded for invalid parameters");
  for (const [args, expected] of [
    [["denoise", source, "--from", "2", "--to", "1"], /--to must be after/],
    [["tts", "--text", ""], /text must not be empty/],
    [["ced", source, "--top-k", "0"], /--top-k must be between/],
    [["ced", source, "--threads", "0"], /--threads.*positive/],
    [["caption", source, "--tokens", "0"], /--tokens.*positive/],
  ]) {
    const r = spawnSync("python", [script, ...args, "--dry-run", "--out", join(root, "out")], {
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, expected);
    assert.equal(existsSync(join(root, "out")), false);
  }
});

test("native workers refuse existing artifacts before overwriting source bytes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "native-preserve-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "tool"),
    out = join(root, "out");
  mkdirSync(join(home, "bin"), { recursive: true });
  mkdirSync(out);
  writeFileSync(join(home, "bin/deep-filter.exe"), "not launched");
  const source = join(out, "result.json");
  writeFileSync(source, "original media bytes");
  const r = spawnSync("python", [script, "denoise", source, "--out", out], {
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, MC_MEDIA_TOOL_HOME: home },
  });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /existing|empty/);
  assert.equal(readFileSync(source, "utf8"), "original media bytes");
});

test("a zero fingerprint duration is rejected during validation", (t) => {
  const root = mkdtempSync(join(tmpdir(), "native-duration-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source.wav");
  writeFileSync(source, "not decoded");
  const r = spawnSync("python", [script, "fingerprint", source, "--length", "0", "--dry-run"], {
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /length/);
});
