import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HELP = join(import.meta.dir, "../help.mjs");

test("JSON lookup can describe the help command itself", () => {
  const result = spawnSync("bun", [HELP, "help", "--json"], { encoding: "utf8", timeout: 10000 });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).data.commands[0].id).toBe("help");
});

test("a direct tool's printed help command runs from the stated film directory", () => {
  const cwd = join(import.meta.dir, "../../../templates/film");
  const result = spawnSync("bun", [HELP, "mc:slim-jar"], { cwd, encoding: "utf8", timeout: 10000 });
  expect(result.status, result.stderr).toBe(0);
  const command = result.stdout.match(/run in film[^:]*: (.+)/)?.[1];
  expect(command).toBeTruthy();
  const help = spawnSync("bun", ["exec", command], { cwd, encoding: "utf8", timeout: 10000 });
  expect(help.status, help.stderr).toBe(0);
  expect(help.stdout).toContain("slim Minecraft asset ZIP");
});

test("direct help also locates repo tools from a standalone film outside the monorepo", () => {
  const cwd = mkdtempSync(join(tmpdir(), "standalone-help-"));
  try {
    mkdirSync(join(cwd, "src"));
    writeFileSync(join(cwd, "src/scene.ts"), "");
    const result = spawnSync("bun", [HELP, "mc:slim-jar"], {
      cwd,
      encoding: "utf8",
      timeout: 10000,
    });
    expect(result.status, result.stderr).toBe(0);
    const command = result.stdout.match(/run in film: (.+)/)?.[1];
    expect(command).toBeTruthy();
    const help = spawnSync("bun", ["exec", command], { cwd, encoding: "utf8", timeout: 10000 });
    expect(help.status, help.stderr).toBe(0);
    expect(help.stdout).toContain("slim Minecraft asset ZIP");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("package and legacy help run in their stated directory in the caller's native shell", () => {
  const ids = [
    "film-kit:test",
    ...(process.platform === "win32"
      ? ["catalog:tag-sh", "catalog:review-sh", "catalog:sweep-sh"]
      : []),
  ];
  for (const id of ids) {
    const result = spawnSync("bun", [HELP, id], { encoding: "utf8", timeout: 10000 });
    expect(result.status, result.stderr).toBe(0);
    const [, cwd, command] = result.stdout.match(/run in ([^:]+): (.+)/) ?? [];
    expect(cwd).toBeTruthy();
    const shell = process.platform === "win32" ? "powershell.exe" : "sh";
    const args =
      process.platform === "win32" ? ["-NoProfile", "-Command", command] : ["-c", command];
    const help = spawnSync(shell, args, {
      cwd: join(
        import.meta.dir,
        "../../..",
        cwd === "root" ? "" : cwd === "film" ? "templates/film" : cwd,
      ),
      encoding: "utf8",
      timeout: 10000,
    });
    expect(help.status, help.stderr).toBe(0);
    expect(help.stdout).toMatch(/bun test|usage:/i);
  }
});

test("help exposes the shared catalog without executing commands, including direct tools", () => {
  const list = spawnSync("bun", [HELP, "--json"], { encoding: "utf8", timeout: 10000 });
  expect(list.status, list.stderr).toBe(0);
  const { data } = JSON.parse(list.stdout);
  expect(data.scope).toBe("root");
  expect(data.commands.some((c) => c.id === "catalog:review")).toBe(true);
  expect(data.commands.find((c) => c.id === "render").availableHere).toBe(false);
  expect(data.commands.find((c) => c.id === "find").flags).toBeUndefined();
  const one = spawnSync("bun", [HELP, "catalog:review", "--json"], {
    encoding: "utf8",
    timeout: 10000,
  });
  expect(one.status, one.stderr).toBe(0);
  expect(JSON.parse(one.stdout).data.commands[0].flags.some((f) => f.flag === "--missing")).toBe(
    true,
  );
  const direct = spawnSync("bun", [HELP, "timeline:fmt"], { encoding: "utf8", timeout: 10000 });
  expect(direct.status, direct.stderr).toBe(0);
  expect(direct.stdout).toContain("scripts/timeline_fmt.ts");
  expect(direct.stdout).toContain("--help");
});

test("JSON discovery keeps a film's custom scripts and rejects unknown command IDs", () => {
  const dir = mkdtempSync(join(tmpdir(), "help-json-"));
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/scene.ts"), "");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { "custom:bake": "bun bake.ts" } }),
    );
    const result = spawnSync("bun", [HELP, "--json"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 10000,
    });
    expect(result.status, result.stderr).toBe(0);
    const { data } = JSON.parse(result.stdout);
    expect(data.scope).toBe("film");
    expect(data.commands.find((c) => c.id === "custom:bake").availableHere).toBe(true);
    const wrong = spawnSync("bun", [HELP, "missing-command", "--json"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 10000,
    });
    expect(wrong.status).toBe(2);
    expect(wrong.stdout).toBe("");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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
  const commands = spawnSync("bun", [HELP], { encoding: "utf8", timeout: 10000 });
  expect(commands.status).toBe(0);
  expect(commands.stdout).toMatch(/\n {2}earshot\s+ears, its own CLI/);
  const root = spawnSync("bun", [HELP, "render"], { encoding: "utf8", timeout: 10000 });
  expect(root.status).toBe(0);
  expect(root.stdout).toContain("cd films/<name>");
  const film = spawnSync("bun", [HELP, "setup:voices"], {
    cwd: join(import.meta.dir, "../../../templates/film"),
    encoding: "utf8",
    timeout: 10000,
  });
  expect(film.status).toBe(0);
  expect(film.stdout).toContain("cd ../..");
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
    const one = spawnSync("bun", [HELP, "earshot"], { cwd: dir, encoding: "utf8" });
    expect(one.status).toBe(0);
    expect(one.stdout).toMatch(/earshot -h/);
    expect(r.stdout).toMatch(
      /\n {2}lessons\/\s+this film's lessons \(every film's: \.\.\/\.\.\/lessons\//,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("help direct formats clean single-slash paths without duplicating active scripts, and help has no ungrouped Other commands", () => {
  const rootHelp = spawnSync("bun", [HELP], { encoding: "utf8", timeout: 10000 });
  expect(rootHelp.status, rootHelp.stderr).toBe(0);
  expect(rootHelp.stdout).not.toContain("\nOther\n");

  const filmHelp = spawnSync("bun", [HELP], {
    cwd: join(import.meta.dir, "../../../templates/film"),
    encoding: "utf8",
    timeout: 10000,
  });
  expect(filmHelp.status, filmHelp.stderr).toBe(0);
  expect(filmHelp.stdout).not.toContain("\nOther\n");

  const direct = spawnSync("bun", [HELP, "direct"], { encoding: "utf8", timeout: 10000 });
  expect(direct.status, direct.stderr).toBe(0);
  expect(direct.stdout.replace(/https?:\/\//g, "")).not.toContain("//");
  expect(direct.stdout).not.toMatch(/^(?:history|collab|assets:semantic|qc|earshot): /m);
});
