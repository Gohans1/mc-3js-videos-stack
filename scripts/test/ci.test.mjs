import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CI = join(import.meta.dir, "../ci.mjs");
const jobs = ["lint", "typecheck", "test:parallel"];

const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), "mc-films-ci-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ scripts: Object.fromEntries(jobs.map((job) => [job, `bun job.mjs ${job}`])) }),
  );
  writeFileSync(
    join(dir, "job.mjs"),
    `import { existsSync, writeFileSync } from "node:fs";
const job = process.argv[2];
writeFileSync(job + ".started", "");
const deadline = Date.now() + 5000;
while (!${JSON.stringify(jobs)}.every(name => existsSync(name + ".started"))) {
  if (Date.now() > deadline) throw new Error("Checks did not start concurrently");
  await Bun.sleep(20);
}
if (process.env.CI_TEST_FAIL && job !== process.env.CI_TEST_FAIL) await Bun.sleep(1000);
writeFileSync(job + ".finished", "");
process.exit(job === process.env.CI_TEST_FAIL ? 7 : 0);
`,
  );
  return dir;
};
const run = (cwd, args = [], env = {}) =>
  spawnSync("bun", [CI, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 15000,
  });

test("CI help and usage errors never start checks", () => {
  const dir = fixture();
  try {
    for (const args of [["--help"], ["help"], ["--bogus"], ["unexpected"]]) {
      const result = run(dir, args);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(args.includes("--help") || args.includes("help") ? 0 : 2);
      expect(readdirSync(dir).filter((name) => /\.(started|finished)$/.test(name))).toEqual([]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const failedJob of ["", "typecheck"]) {
  test(`CI starts every check concurrently and ${failedJob ? "reports a failed check" : "succeeds when all pass"}`, () => {
    const dir = fixture();
    try {
      const result = run(dir, [], { CI_TEST_FAIL: failedJob });
      expect(result.error, result.stderr).toBeUndefined();
      if (failedJob) expect(result.status).not.toBe(0);
      else expect(result.status, result.stderr).toBe(0);
      for (const job of jobs) expect(readFileSync(join(dir, job + ".finished"), "utf8")).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
