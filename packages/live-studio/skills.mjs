// bun run skills: the guides for an AI agent, served from the repo's skill-data/ so they always match the commands checked
// out next to them. .claude/skills/mc-films/SKILL.md is only a stub that sends an agent here (agent-browser's skills get pattern).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { cliArgs } from "./src/cli.mjs";

const DATA = fileURLToPath(new URL("../../skill-data", import.meta.url));
const HELP = `The guides for an AI agent working in this repo, matched to the commands checked out with them. Runs at the root or in a film.
  bun run skills                         the guides, one line each
  bun run skills get core                start here: the loop from an idea to an upload, the clocks, the safe and the costly commands
  bun run skills get core --ref sound    one reference by its path, file name or stem (the guide's Load table lists them);
                                         --ref again for more
  bun run skills get core --full         the guide and every reference at once, several times longer
A command's flags are in its own help (bun run <command> --help), not here: these guides are how to work.`;

const argv = cliArgs(HELP, ["--ref NAME", "--full"], 2);
const words = argv.filter((a, i) => !a.startsWith("-") && argv[i - 1] !== "--ref");
const refs = argv.flatMap((a, i) => (argv[i - 1] === "--ref" ? [a] : []));
// every refusal here is a wrong word: exit 2, as every repo command does
const fail = (why) => {
  console.error(why);
  process.exit(2);
};

// name and description from a guide's frontmatter
const about = (name) => {
  const text = readFileSync(join(DATA, name, "SKILL.md"), "utf8");
  const said = (key) => text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1].trim() ?? "";
  return { name, text, description: said("description"), hidden: said("hidden") === "true" };
};
const guides = readdirSync(DATA).filter((d) => existsSync(join(DATA, d, "SKILL.md")));
const files = (name) =>
  readdirSync(join(DATA, name), { recursive: true, withFileTypes: true })
    .filter((f) => f.isFile() && f.name !== "SKILL.md")
    .map((f) => relative(join(DATA, name), join(f.parentPath, f.name)).replaceAll("\\", "/"))
    .toSorted();

const [verb, name] = words;
if (!verb || verb === "list") {
  if (refs.length || argv.includes("--full"))
    fail("--ref and --full go with get: bun run skills get core --ref sound");
  for (const g of guides.map(about).filter((g) => !g.hidden))
    console.log(`${g.name.padEnd(12)}${g.description}`);
  console.log("next: bun run skills get core");
  process.exit(0);
}
if (verb !== "get") fail(`no ${verb}: bun run skills (the list) or bun run skills get <guide>`);
if (!name)
  fail(`which guide? bun run skills get ${guides[0] ?? "core"} (the list: bun run skills)`);
if (!guides.includes(name)) fail(`no guide ${name}; the guides: ${guides.join(", ")}`);

const all = files(name);
// a reference by its path, its file name or its name without .md
const pick = (want) => {
  const w = want.replace(/\.md$/, "");
  const hits = all.filter(
    (p) =>
      p === want || p.replace(/\.md$/, "") === w || p.split("/").at(-1).replace(/\.md$/, "") === w,
  );
  if (hits.length === 1) return hits[0];
  // the guide also routes to repo docs (RENDER.md, INSTALL.md): those are opened, never served here
  const doc = [...about(name).text.matchAll(/`([\w./-]+\.md)`/g)]
    .map((m) => m[1])
    .find(
      (p) =>
        !p.startsWith("references/") &&
        p.split("/").at(-1).replace(/\.md$/, "").toLowerCase() === w.toLowerCase(),
    );
  if (doc) fail(`${want} is a repo file, not a reference: open ${doc}`);
  fail(
    `${hits.length ? `${want} could be ${hits.join(" or ")}: give the path` : `${name} has no ${want}`}. ${
      all.length ? `Its references: ${all.join(", ")}` : `${name} has no references`
    }`,
  );
};
const show = (path, text, many) =>
  console.log(`${many ? `--- ${path} ---\n\n` : ""}${text.trimEnd()}\n`);
if (refs.length) {
  const chosen = [...new Set(refs.map(pick))];
  for (const p of chosen) show(p, readFileSync(join(DATA, name, p), "utf8"), chosen.length > 1);
} else {
  const full = argv.includes("--full");
  show("SKILL.md", about(name).text, full && all.length > 0);
  if (full) for (const p of all) show(p, readFileSync(join(DATA, name, p), "utf8"), true);
}
