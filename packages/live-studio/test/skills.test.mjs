import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const DATA = join(ROOT, "skill-data");
const SKILLS = fileURLToPath(new URL("../skills.mjs", import.meta.url));
const run = (args, cwd = ROOT) =>
  spawnSync("bun", [SKILLS, ...args], { cwd, encoding: "utf8", timeout: 10000 });
const repoAgentSkills = () => {
  const names = readdirSync(join(ROOT, ".claude/skills"))
    .filter((name) => existsSync(join(ROOT, ".claude/skills", name, "SKILL.md")))
    .toSorted();
  assert.ok(names.length > 0, "expected at least one repo agent skill");
  return names;
};

test("skills JSON supports discovery, selected content and resource paths without text wrappers", () => {
  const list = run(["list", "--json"]);
  assert.equal(list.status, 0, list.stderr);
  const listed = JSON.parse(list.stdout).data;
  assert.ok(
    listed.some((g) => g.name === "core" && g.kind === "guide" && g.description.length > 0),
  );
  for (const name of repoAgentSkills()) {
    assert.ok(
      listed.some(
        (s) =>
          s.name === name &&
          s.kind === "skill" &&
          s.description.length > 0 &&
          s.path === join(ROOT, ".claude/skills", name),
      ),
      `skills list --json missed agent skill ${name}`,
    );
  }
  const selected = run(["get", "core", "--ref", "notes", "--ref", "notes.md", "--json"]);
  assert.equal(selected.status, 0, selected.stderr);
  const guide = JSON.parse(selected.stdout).data;
  assert.deepEqual(
    guide.files.map((f) => f.path),
    ["references/notes.md"],
  );
  assert.equal(
    guide.files[0].content,
    readFileSync(join(DATA, "core/references/notes.md"), "utf8"),
  );
  assert.ok(guide.references.includes("references/sound.md"));
  const resource = run(["path", "earshot", "--json"], join(ROOT, "templates/film"));
  assert.equal(resource.status, 0, resource.stderr);
  assert.equal(JSON.parse(resource.stdout).data.path, join(ROOT, ".claude/skills/earshot"));
});

test("skills rejects requests whose extra words or conflicting modes would be ignored", () => {
  for (const args of [
    ["list", "core"],
    ["list", "-1"],
    ["-1"],
    ["get", "core", "--ref", "sound", "--full"],
    ["path", "core", "--ref", "sound"],
    ["path", "core", "--full"],
  ]) {
    const r = run(args);
    assert.equal(r.status, 2, args.join(" "));
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /list|--ref|--full/);
  }
});

test("skills path locates guide and agent-skill resources independently of the working directory", () => {
  for (const cwd of [ROOT, join(ROOT, "templates/film")]) {
    const directory = run(["path"], cwd);
    assert.equal(directory.status, 0, directory.stderr);
    assert.equal(directory.stdout.trim(), DATA);
    for (const [name, expected] of [
      ["core", join(DATA, "core")],
      ["earshot", join(ROOT, ".claude/skills/earshot")],
      ["real-sound", join(ROOT, ".claude/skills/real-sound")],
    ]) {
      const result = run(["path", name], cwd);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), expected);
      assert.ok(readFileSync(join(result.stdout.trim(), "SKILL.md"), "utf8").length > 0);
    }
  }
  const missing = run(["path", "nope"]);
  assert.equal(missing.status, 2);
  assert.equal(missing.stdout, "");
  assert.match(missing.stderr, /no guide|no skill/);
});

test("repo-document recovery points to existing files from the caller's directory, including hidden directories", () => {
  for (const [name, path] of [
    ["INSTALL.md", "../../INSTALL.md"],
    ["SKILL", "../../.claude/skills/gohans-3js-videos-skills/SKILL.md"],
  ]) {
    const result = run(["get", "core", "--ref", name], join(ROOT, "templates/film"));
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes(`open ${path}`), result.stderr);
  }
});

test("skills prints exactly the requested guide and unique references in caller order", () => {
  const guide = run(["get", "core"]);
  assert.equal(guide.status, 0, guide.stderr);
  assert.equal(guide.stdout.trim(), readFileSync(join(DATA, "core/SKILL.md"), "utf8").trim());
  const refs = run([
    "get",
    "core",
    "--ref",
    "notes.md",
    "--ref",
    "references/sound.md",
    "--ref",
    "notes",
  ]);
  assert.equal(refs.status, 0, refs.stderr);
  assert.equal((refs.stdout.match(/--- references\/notes.md ---/g) ?? []).length, 1);
  assert.ok(
    refs.stdout.indexOf("--- references/notes.md ---") <
      refs.stdout.indexOf("--- references/sound.md ---"),
  );
  const full = run(["get", "core", "--full"]);
  assert.equal(full.status, 0, full.stderr);
  for (const file of md(join(DATA, "core/references")))
    assert.ok(full.stdout.includes(readFileSync(file, "utf8").trim()), file);
});
const md = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((f) => f.isFile() && f.name.endsWith(".md"))
    .map((f) => join(f.parentPath, f.name));

test("the core guide routes to every reference and every other skill, so none is unreachable", () => {
  const core = readFileSync(join(DATA, "core/SKILL.md"), "utf8");
  for (const file of md(join(DATA, "core/references")))
    assert.ok(
      core.includes(`references/${file.split(/[\\/]/).at(-1)}`),
      `core/SKILL.md does not route to ${file}`,
    );
  for (const skill of readdirSync(DATA).filter((d) => d !== "core"))
    assert.ok(core.includes(`skills get ${skill}`), `core/SKILL.md does not route to ${skill}`);
});

test("every command the skills name is a command of the repo or of a film", () => {
  const scripts = (f) => Object.keys(JSON.parse(readFileSync(join(ROOT, f), "utf8")).scripts);
  const known = new Set([...scripts("package.json"), ...scripts("templates/film/package.json")]);
  for (const file of [...md(DATA), join(ROOT, ".claude/skills/mc-films/SKILL.md")])
    for (const [, name] of readFileSync(file, "utf8").matchAll(/bun run ([a-z][\w:-]*)/g))
      assert.ok(known.has(name), `${file} names bun run ${name}, which no package.json has`);
});

test("skills get prints a guide, one reference by its name, and names the references a wrong one could be", () => {
  const list = run(["list"]);
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /^core\s+\S/m);
  assert.match(list.stdout, /Repo agent skills/);
  for (const name of repoAgentSkills()) {
    assert.match(
      list.stdout,
      new RegExp(`^  ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+\\S`, "m"),
      `skills list missed summary for ${name}`,
    );
  }

  const ref = md(join(DATA, "core/references"))[0];
  const stem = ref.split(/[\\/]/).at(-1).replace(/\.md$/, "");
  const one = run(["get", "core", "--ref", stem], join(ROOT, "templates/film"));
  assert.equal(one.status, 0, one.stderr);
  assert.equal(one.stdout.trim(), readFileSync(ref, "utf8").trim());

  const wrong = run(["get", "core", "--ref", "nope"]);
  assert.equal(wrong.status, 2);
  assert.match(wrong.stderr, new RegExp(`references/${stem}\\.md`));

  // a repo doc the guide routes to is a file to open, not a reference
  const doc = run(["get", "core", "--ref", "install"]);
  assert.equal(doc.status, 2);
  assert.match(doc.stderr, /a repo file, not a reference: open INSTALL\.md/);

  const missing = run(["get", "nope"]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /core/);

  // an agent skill of its own (earshot, cinetic) is a file to open, named from where the agent stands
  const own = run(["get", "cinetic"], join(ROOT, "templates/film"));
  assert.equal(own.status, 2);
  assert.match(own.stderr, /open \.\.\/\.\.\/\.claude\/skills\/cinetic\/SKILL\.md/);
});
