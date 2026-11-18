import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { mediaFixture } from "./media-fixture.mjs";

const fixture = mediaFixture();

test("QC accepts a PowerShell UTF-8 BOM in both validation and measurement and retains exact request bytes", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "media-qc-bom-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const subtitle = join(folder, "captions.srt");
  const request = join(folder, "request.json");
  writeFileSync(subtitle, "1\n00:00:00,000 --> 00:00:01,000\nMột câu.\n");
  const raw = Buffer.from(
    "\uFEFF" +
      JSON.stringify({
        operation: "check",
        kind: "subtitle",
        input: subtitle,
      }),
  );
  writeFileSync(request, raw);
  const plan = run([request, "--dry-run"]);
  assert.equal(plan.status, 0, plan.stderr);
  const result = run([request, "--out", join(folder, "runs")]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const job = JSON.parse(result.stdout);
  assert.deepEqual(readFileSync(join(job.folder, "request.json")), raw);
  assert.deepEqual(readFileSync(request), raw);
  assert.equal(
    JSON.parse(readFileSync(join(job.folder, "native.json"), "utf8")).status,
    "completed",
  );
});

const CLI = fileURLToPath(new URL("../media.mjs", import.meta.url));
const run = (args) =>
  spawnSync(process.execPath, [CLI, "qc", ...args], { encoding: "utf8", timeout: 30000 });

test("QC contract is discoverable without setup, media probing or evidence writes", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "media-qc-contract-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const result = run(["--contract", "--out", join(folder, "unused")]);
  assert.equal(result.status, 0, result.stderr);
  const contract = JSON.parse(result.stdout);
  assert.ok(JSON.stringify(contract).includes("audio.loop_seam_click_within_limit"));
  assert.equal(existsSync(join(folder, "unused")), false);
});

test("QC reports a measured subtitle violation without pretending execution failed", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "media-qc-subtitle-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const subtitle = join(folder, "captions.srt"),
    request = join(folder, "request.json");
  const text =
    "1\n00:00:00,000 --> 00:00:02,000\nFirst\n\n2\n00:00:01,000 --> 00:00:03,000\nOverlap\n\n";
  writeFileSync(subtitle, text);
  writeFileSync(
    request,
    JSON.stringify({
      operation: "check",
      kind: "subtitle",
      input: subtitle,
      rules: { subtitle: { max_line_length: 5 } },
    }),
  );
  const result = run([request, "--out", join(folder, "runs")]);
  assert.equal(result.status, 0, result.stderr);
  const job = JSON.parse(result.stdout);
  const report = JSON.parse(readFileSync(join(job.folder, "result.json"), "utf8"));
  assert.equal(report.native.status, "completed");
  assert.ok(report.native.report.checks.some((check) => check.status === "FAIL"));
  assert.equal(readFileSync(subtitle, "utf8"), text);
  assert.ok(existsSync(join(job.folder, "request.json")));
});

test("QC rejects executable/filter injection before creating a job", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "media-qc-invalid-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const request = join(folder, "request.json"),
    out = join(folder, "runs");
  writeFileSync(
    request,
    JSON.stringify({
      operation: "inspect",
      kind: "audio",
      input: "missing.wav",
      parameters: { shell: "evil" },
    }),
  );
  const result = run([request, "--out", out]);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(existsSync(out), false);
});

test(
  "QC measures continuous versus clicking loop wraps on real PCM and preserves sources",
  { timeout: 60_000 },
  (t) => {
    const folder = mkdtempSync(join(tmpdir(), "media-qc-loop-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    for (const [duration, expected] of [
      [2, "PASS"],
      [2.003, "FAIL"],
    ]) {
      const source = join(folder, `loop-${duration}.wav`),
        request = join(folder, `request-${duration}.json`);
      fixture(source, [
        "-f",
        "lavfi",
        "-i",
        `sine=f=250:r=16000:d=${duration}`,
        "-c:a",
        "pcm_s16le",
      ]);
      const before = readFileSync(source);
      writeFileSync(
        request,
        JSON.stringify({
          operation: "check",
          kind: "audio",
          input: source,
          rules: { audio: { loop_seam: { max_click_ratio: 3 } } },
        }),
      );
      const result = run([request, "--out", join(folder, "runs")]);
      assert.equal(result.status, 0, result.stderr);
      const job = JSON.parse(result.stdout),
        report = JSON.parse(readFileSync(join(job.folder, "result.json"), "utf8"));
      const check = report.native.report.checks.find(
        (row) => row.check_id === "audio.loop_seam_click_within_limit",
      );
      assert.equal(check.status, expected);
      assert.deepEqual(readFileSync(source), before);
    }
  },
);
