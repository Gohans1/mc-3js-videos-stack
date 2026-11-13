// help.mjs: a film's command list. earshot is no bun run script, so an AI reading only the list would never learn it has ears
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HELP = join(import.meta.dir, "../help.mjs");

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
      /\n {2}earshot {2,}[^\n]*not bun run[^\n]*bun run skills get core --ref sound/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
