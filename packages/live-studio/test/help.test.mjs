// help.mjs: a film's command list. earshot is no bun run script, so an AI reading only the list would never learn it has ears
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HELP = join(import.meta.dir, "../help.mjs");

test("help validates the entire request before directing an agent to a command", () => {
  for (const args of [["skills", "extra"], ["skills", "--bogus"], ["toString"]]) {
    const r = spawnSync("bun", [HELP, ...args], { encoding: "utf8", timeout: 10000 });
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).not.toBe("");
  }
});

test("help documents discovery, and sends commands to their real working directory", () => {
  const usage = spawnSync("bun", [HELP, "--help"], { encoding: "utf8", timeout: 10000 });
  expect(usage.status).toBe(0);
  expect(usage.stdout).toContain("bun run help <command>");
  const root = spawnSync("bun", [HELP, "render"], { encoding: "utf8", timeout: 10000 });
  expect(root.status).toBe(0);
  expect(root.stdout).toContain("cd films/<name>");
  for (const dir of ["templates/film", "films/cell-break", "films/sealed-room"]) {
    const film = spawnSync("bun", [HELP, "setup:voices"], {
      cwd: join(import.meta.dir, "../../..", dir),
      encoding: "utf8",
      timeout: 10000,
    });
    expect(film.status).toBe(0);
    expect(film.stdout).toContain("cd ../..");
  }
});

test("a film's help names earshot beside its sound commands, and where the guide says which call is for what", () => {
  const dir = mkdtempSync(join(tmpdir(), "help-"));
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/scene.ts"), "");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { mix: "x", listen: "x", render: "x" }, "live-studio": {} }),
    );
    const r = spawnSync("bun", [HELP], { cwd: dir, encoding: "utf8" });
    expect(r.status).toBe(0);
    const sound = r.stdout.slice(
      r.stdout.indexOf("\nSound"),
      r.stdout.indexOf("\nLook and review"),
    );
    expect(sound).toMatch(
      /\n {2}earshot {2,}ears, its own CLI \(earshot <command> -h\)[^\n]*bun run skills get core --ref sound/,
    );
    // asked about by the name the list gives it, it is pointed to, never "no command"
    const one = spawnSync("bun", [HELP, "earshot"], { cwd: dir, encoding: "utf8" });
    expect(one.status).toBe(0);
    expect(one.stdout).toMatch(/earshot -h/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
