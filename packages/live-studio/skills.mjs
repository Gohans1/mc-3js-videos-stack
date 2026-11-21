// bun run skills: the guides for an AI agent, served from the repo's skill-data/ so they always match the commands checked
// out next to them. .claude/skills/mc-films/SKILL.md is only a stub that sends an agent here (agent-browser's skills get pattern).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { cliArgs } from "./src/cli.mjs";

const DATA = fileURLToPath(new URL("../../skill-data", import.meta.url));
const AGENT_SKILLS = fileURLToPath(new URL("../../.claude/skills", import.meta.url));
const HELP = `Read the guides that ship with this checkout of mc-films.

Usage: bun run skills [list | get <name> | path [name]] [options]

Start here:
  bun run skills get core              Read the workflow, clocks, and command costs
  bun run skills get core --ref sound  Load the sound workflow and checks

Commands:
  list                                List available guides (also the default)
  get <name>                          Print one guide
  path [name]                         Print the guide or repo skill directory as an absolute path
                                      Omit the name for the skill-data directory

Options:
  --ref <ref>                         Load one reference by path, filename, or stem. Repeat for more
  --full                              Load the guide and all references. Use with get and omit --ref
  --json                              Return structured output

Run bun run <command> --help for command flags.`;

const argv = cliArgs(HELP, ["--ref NAME", "--full", "--json"], 2);
const words = argv.filter(
  (a, i) => a !== "--full" && a !== "--json" && a !== "--ref" && argv[i - 1] !== "--ref",
);
const refs = argv.flatMap((a, i) => (argv[i - 1] === "--ref" ? [a] : []));
const json = argv.includes("--json");
const emit = (data) => console.log(JSON.stringify({ success: true, data }));
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
const agentSkills = existsSync(AGENT_SKILLS)
  ? readdirSync(AGENT_SKILLS).filter((d) => existsSync(join(AGENT_SKILLS, d, "SKILL.md")))
  : [];
const files = (name) =>
  readdirSync(join(DATA, name), { recursive: true, withFileTypes: true })
    .filter((f) => f.isFile() && f.name !== "SKILL.md")
    .map((f) => relative(join(DATA, name), join(f.parentPath, f.name)).replaceAll("\\", "/"))
    .toSorted();

const [verb, name] = words;
if (!verb || verb === "list") {
  if (name)
    fail("list takes no guide name: bun run skills list; to read one: bun run skills get core");
  if (refs.length || argv.includes("--full"))
    fail("--ref and --full go with get: bun run skills get core --ref sound");
  const visible = guides.map(about).filter((g) => !g.hidden);
  if (json) emit(visible.map(({ name, description }) => ({ name, description })));
  else {
    for (const g of visible) console.log(`${g.name.padEnd(12)}${g.description}`);
    console.log("next: bun run skills get core  (or --ref <topic>, --full, path <skill>)");
  }
  process.exit(0);
}
if (refs.length && argv.includes("--full"))
  fail(
    "choose --ref for selected references, or --full for the guide and all references; not both",
  );
if (verb === "path") {
  if (refs.length || argv.includes("--full")) fail("--ref and --full go with get, not path");
  const dir = !name
    ? DATA
    : guides.includes(name)
      ? join(DATA, name)
      : agentSkills.includes(name)
        ? join(AGENT_SKILLS, name)
        : null;
  if (!dir) fail(`no guide or agent skill ${name}; bun run skills lists guides`);
  if (json) emit({ path: dir });
  else console.log(dir);
  process.exit(0);
}
if (verb !== "get") fail(`no ${verb}: bun run skills (the list) or bun run skills get <guide>`);
if (!name)
  fail(`which guide? bun run skills get ${guides[0] ?? "core"} (the list: bun run skills)`);
if (!guides.includes(name)) {
  // earshot, real-sound, cinetic: agent skills of their own, read where they are, never served as an mc-films guide
  const own = join(DATA, "../.claude/skills", name, "SKILL.md");
  fail(
    existsSync(own)
      ? `${name} is an agent skill of its own, not an mc-films guide: open ${relative(process.cwd(), own).replaceAll("\\", "/")}; its directory: bun run skills path ${name}`
      : `no guide ${name}; the guides: ${guides.join(", ")}`,
  );
}

const all = files(name);
// a reference by its path, its file name or its name without .md
const pick = (want) => {
  const w = want.replace(/\.md$/, "");
  const hits = all.filter(
    (p) =>
      p === want || p.replace(/\.md$/, "") === w || p.split("/").at(-1).replace(/\.md$/, "") === w,
  );
  if (hits.length === 1) return hits[0];
  // the guide also routes to repo docs (INSTALL.md): those are opened, never served here
  const doc = [...about(name).text.matchAll(/([\w./-]+\.md)\b/g)]
    .map((m) => m[1])
    .find(
      (p) =>
        !p.startsWith("references/") &&
        existsSync(join(DATA, "..", p)) &&
        p.split("/").at(-1).replace(/\.md$/, "").toLowerCase() === w.toLowerCase(),
    );
  if (doc)
    fail(
      `${want} is a repo file, not a reference: open ${relative(process.cwd(), join(DATA, "..", doc)).replaceAll("\\", "/")}`,
    );
  fail(
    `${hits.length ? `${want} could be ${hits.join(" or ")}: give the path` : `${name} has no ${want}`}. ${
      all.length ? `Its references: ${all.join(", ")}` : `${name} has no references`
    }`,
  );
};
const show = (path, text, many) =>
  console.log(`${many ? `--- ${path} ---\n\n` : ""}${text.trimEnd()}\n`);
const chosen = refs.length
  ? [...new Set(refs.map(pick))]
  : ["SKILL.md", ...(argv.includes("--full") ? all : [])];
if (json) {
  emit({
    name,
    description: about(name).description,
    references: all,
    files: chosen.map((path) => ({ path, content: readFileSync(join(DATA, name, path), "utf8") })),
  });
  process.exit(0);
}
for (const p of chosen) show(p, readFileSync(join(DATA, name, p), "utf8"), chosen.length > 1);
