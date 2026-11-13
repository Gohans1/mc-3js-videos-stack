// What every command does with its words before any work (src/cli.mjs): a probe's stray word once ran whole jobs
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const cli = pathToFileURL(join(import.meta.dir, "../src/cli.mjs")).href;
// a command that takes one word and --shot N, and says "worked" only when its words passed
const run = (args) =>
  spawnSync(
    process.execPath,
    [
      "-e",
      `const { cliArgs } = await import(${JSON.stringify(cli)});
       cliArgs("HELP TEXT", ["--shot N", "--done"], 1, ${JSON.stringify(args)});
       console.log("worked");`,
    ],
    { encoding: "utf8" },
  );

test("a word too many stops the command before its work, saying how many it takes", () => {
  const r = run(["clip", "junkarg"]);
  expect(r.status).toBe(2);
  expect(r.stdout).not.toContain("worked");
  expect(r.stderr).toContain("one word too many: junkarg (it takes 1 word");
});

test("an option's value is not one of the words, and an option missing its value stops it", () => {
  expect(run(["--shot", "3", "clip"]).stdout).toContain("worked");
  const r = run(["--shot", "--done"]);
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("--shot needs a value: --shot N");
});

test("--ref on a command that takes none points at the guide, where --ref lives", () => {
  const r = run(["--ref", "sound"]);
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("unknown option --ref");
  expect(r.stderr).toContain("bun run skills get core --ref sound");
});

test("a film's command run outside a film did nothing: exit 2, as every wrong place does, saying where it runs", () => {
  const r = spawnSync(
    process.execPath,
    [
      "-e",
      `const { needFilm } = await import(${JSON.stringify(cli)}); needFilm(${JSON.stringify(import.meta.dir)}); console.log("worked");`,
    ],
    { encoding: "utf8" },
  );
  expect(r.status).toBe(2);
  expect(r.stdout).not.toContain("worked");
  expect(r.stderr).toContain("cd films/<name> first");
});

test("a number that is no number stops with what it takes", () => {
  const r = spawnSync(
    process.execPath,
    [
      "-e",
      `const { numberArg } = await import(${JSON.stringify(cli)});
       numberArg("AT item 1", "abc", { min: 0 });
       console.log("worked");`,
    ],
    { encoding: "utf8" },
  );
  expect(r.status).toBe(2);
  expect(r.stderr).toContain('AT item 1 takes a number from 0, got "abc"');
});

// notes, a draft's strip and bun run at print mm:ss.mmm; a probe typed AT=1:05 and was refused
test("a heard second is read as notes print it, mm:ss, or with an s after it, and a minute past 59 s is refused", async () => {
  const { secondArg } = await import(cli);
  expect([
    secondArg("AT", "65"),
    secondArg("AT", "1:05"),
    secondArg("AT", "01:05.250"),
    secondArg("AT", "65s"),
    secondArg("AT", ".5"),
  ]).toEqual([65, 65, 65.25, 65, 0.5]);
  const r = spawnSync(
    process.execPath,
    ["-e", `const { secondArg } = await import(${JSON.stringify(cli)}); secondArg("AT", "1:75")`],
    { encoding: "utf8" },
  );
  expect(r.status).toBe(2);
  expect(r.stderr).toContain(
    'AT takes a heard second (65, 1:05 or 01:05.250), got "1:75": a minute holds 0-59 s, did you mean 2:15?',
  );
});

test("bun run studio help prints the help though the script put the port first, and starts no studio", () => {
  const r = spawnSync(
    process.execPath,
    [join(import.meta.dir, "../src/live.mjs"), "4999", "help"],
    {
      encoding: "utf8",
      timeout: 20_000,
    },
  );
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("The studio for one film");
});

test("an environment option one letter off is named with the one meant", () => {
  const r = spawnSync(
    process.execPath,
    [
      "-e",
      `const { envTypos } = await import(${JSON.stringify(cli)});
       envTypos(["AT", "CHUNKS"], { ATT: "3", CHUNK: "2", AT: "1", PATH: "x" });
       console.log("worked");`,
    ],
    { encoding: "utf8" },
  );
  expect(r.status).toBe(2);
  expect(r.stdout).not.toContain("worked");
  expect(r.stderr).toContain("ATT=3 is no option here: did you mean AT=3?");
  expect(r.stderr).toContain("CHUNK=2 is no option here: did you mean CHUNKS=2?");
  expect(r.stderr).not.toContain("PATH");
});

test("a variable one letter off only in its first letter is the machine's own: a warning, and the command goes on", () => {
  const r = spawnSync(
    process.execPath,
    [
      "-e",
      `const { envTypos } = await import(${JSON.stringify(cli)});
       envTypos(["AT"], { PAT: "token" });
       console.log("worked");`,
    ],
    { encoding: "utf8" },
  );
  expect(r.stdout).toContain("worked");
  expect(r.stderr).toContain("did you mean AT=token?");
});
