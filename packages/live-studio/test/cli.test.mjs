import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const cli = pathToFileURL(join(import.meta.dir, "../src/cli.mjs")).href;
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
       numberArg("--at item 1", "abc", { min: 0 });
       console.log("worked");`,
    ],
    { encoding: "utf8" },
  );
  expect(r.status).toBe(2);
  expect(r.stderr).toContain('--at item 1 takes a number from 0, got "abc"');
});

test("a heard second is read as notes print it, mm:ss, or with an s after it, and a minute past 59 s is refused", async () => {
  const { secondArg } = await import(cli);
  expect([
    secondArg("--at", "65"),
    secondArg("--at", "1:05"),
    secondArg("--at", "01:05.250"),
    secondArg("--at", "65s"),
    secondArg("--at", ".5"),
  ]).toEqual([65, 65, 65.25, 65, 0.5]);
  const r = spawnSync(
    process.execPath,
    ["-e", `const { secondArg } = await import(${JSON.stringify(cli)}); secondArg("--at", "1:75")`],
    { encoding: "utf8" },
  );
  expect(r.status).toBe(2);
  expect(r.stderr).toContain(
    '--at takes a heard second (65, 1:05 or 01:05.250), got "1:75": a minute holds 0-59 s, did you mean 2:15?',
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

test("a machine setting one letter off is named with the one meant", () => {
  const r = spawnSync(
    process.execPath,
    [
      "-e",
      `const { envTypos } = await import(${JSON.stringify(cli)});
       envTypos(["LIVE_PROJECT", "RHUBARB"], { LIVE_PROJCT: "a", RHUBARBB: "b", RHUBARB: "c", PATH: "x" });
       console.log("worked");`,
    ],
    { encoding: "utf8" },
  );
  expect(r.status).toBe(2);
  expect(r.stdout).not.toContain("worked");
  expect(r.stderr).toContain(
    "LIVE_PROJCT is set in the environment, one letter off LIVE_PROJECT that this command reads: did you mean LIVE_PROJECT?",
  );
  expect(r.stderr).toContain(
    "RHUBARBB is set in the environment, one letter off RHUBARB that this command reads: did you mean RHUBARB?",
  );
  expect(r.stderr).not.toContain("PATH");
});

test("a variable one letter off only in its first letter is the machine's own: a warning, and the command goes on", () => {
  const r = spawnSync(
    process.execPath,
    [
      "-e",
      `const { envTypos } = await import(${JSON.stringify(cli)});
       envTypos(["RHUBARB"], { SHUBARB: "token" });
       console.log("worked");`,
    ],
    { encoding: "utf8" },
  );
  expect(r.stdout).toContain("worked");
  expect(r.stderr).toContain("did you mean RHUBARB?");
});
