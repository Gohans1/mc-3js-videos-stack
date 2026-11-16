import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [before, after, output] = process.argv.slice(2);
if (![before, after, output].every((s) => s && /^[\w-]+$/.test(s)))
  throw new Error(
    "Usage: bun scripts/evals/load/compare.mjs <before-run> <after-run> <output-stem>",
  );
const root = join(import.meta.dir, "runs");
const file = (run, name) => readFileSync(join(root, run, name));
const json = (run, name) => JSON.parse(file(run, name));
const lines = (run) => file(run, "samples.jsonl").toString().trim().split("\n").map(JSON.parse);
const median = (xs) => {
  const sorted = [...xs].sort((a, b) => a - b),
    mid = sorted.length >> 1;
  return Math.round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
};
const metrics = ["picture", "ready", "tbt", "longest", "js"];
const rows = [],
  frames = [],
  audio = [],
  visits = [];
for (const run of [before, after]) {
  const result = json(run, "results.json"),
    samples = lines(run);
  assert.equal(result.failed, false, run);
  for (const profile of ["desk", "phone"]) {
    const selected = samples.filter((r) => r.profile === profile);
    assert.equal(selected.length, result.runs);
    for (const sample of selected) {
      assert.notEqual(sample.cold.loaderId, sample.warm.loaderId);
      for (const kind of ["cold", "warm"]) {
        const v = sample[kind];
        assert.ok(v.loaderId);
        assert.deepEqual(v.errors, []);
        assert.deepEqual(v.preloadWarnings, []);
        assert.ok(!v.network.some((r) => r.error || r.status >= 400));
        assert.equal(v.network.filter((r) => r.path === "/mc/client_assets.zip").length, 1);
      }
    }
    for (const kind of ["cold", "warm"])
      for (const metric of metrics)
        assert.equal(
          result[`${profile}.${kind}`][metric],
          median(selected.map((r) => r[kind][metric])),
        );
  }
  visits.push({
    run,
    measured: samples.length * 2,
    documentIdentityChecked: true,
    duplicateJarRequests: 0,
  });
}
const a = json(before, "results.json"),
  b = json(after, "results.json");
assert.equal(a.film, b.film);
assert.equal(a.bun, b.bun);
assert.equal(a.resourceSettleMs, b.resourceSettleMs);
assert.deepEqual(a.browser, b.browser);
for (const profile of ["desk", "phone"]) {
  assert.deepEqual(
    lines(before).find((r) => r.profile === profile).cold.gpu,
    lines(after).find((r) => r.profile === profile).cold.gpu,
  );
  for (const kind of ["cold", "warm"])
    for (const metric of metrics) {
      const x = a[`${profile}.${kind}`][metric],
        y = b[`${profile}.${kind}`][metric];
      rows.push({
        profile,
        cache: kind,
        metric,
        unit: metric === "js" ? "KiB" : "ms",
        before: x,
        after: y,
        changePercent: x ? (100 * (y - x)) / x : null,
        speedup: y ? x / y : null,
      });
    }
  for (const label of [
    "cold-frame",
    "warm-frame",
    ...[0, 2.4, 4.7, 8.2, 10.5, 13.2].map((t) => `at-${t}`),
  ]) {
    const name = `${profile}-${label}.png`;
    frames.push({ file: name, exact: file(before, name).equals(file(after, name)) });
  }
  const repeat = `${profile}-at-0-repeat-1.png`;
  if (existsSync(join(root, before, repeat)))
    frames.push({ file: repeat, exact: file(before, repeat).equals(file(after, repeat)) });
  assert.deepEqual(json(before, `${profile}-audio.json`), json(after, `${profile}-audio.json`));
  audio.push({ profile, halfSecondRmsAndPeakIdentical: true, rawPcmCompared: false });
}
const result = {
  before,
  after,
  visits,
  rows,
  frames,
  audio,
  imagesExact: frames.every((f) => f.exact),
  targetTwofoldEveryFirstPicture: rows
    .filter((r) => r.metric === "picture")
    .every((r) => r.speedup >= 2),
  limits: [
    "Phone is Chrome CPU/network/touch emulation, not a physical phone.",
    "Other sessions share this host; observed timing differences are not a guaranteed speedup.",
    "Resource timing ends one second after ready; total bytes are not the complete session's traffic.",
    "No assertion is made about an absolute optimization ceiling.",
  ],
};
writeFileSync(join(root, `${output}.json`), JSON.stringify(result, null, 2) + "\n");
writeFileSync(
  join(root, `${output}.csv`),
  "profile,cache,metric,unit,before,after,change_percent,speedup\n" +
    rows
      .map((r) =>
        [
          r.profile,
          r.cache,
          r.metric,
          r.unit,
          r.before,
          r.after,
          r.changePercent ?? "",
          r.speedup ?? "",
        ].join(","),
      )
      .join("\n") +
    "\n",
);
console.log(
  JSON.stringify({
    output,
    imagesExact: result.imagesExact,
    targetTwofoldEveryFirstPicture: result.targetTwofoldEveryFirstPicture,
    visits,
  }),
);
process.exitCode = result.imagesExact ? 0 : 1;
