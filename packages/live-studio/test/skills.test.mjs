import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const DATA = join(ROOT, "skill-data");
const SKILLS = fileURLToPath(new URL("../skills.mjs", import.meta.url));
const run = (args, cwd = ROOT) => spawnSync("bun", [SKILLS, ...args], { cwd, encoding: "utf8" });
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
  assert.match(list.stdout, /^core\s/m);

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
});
