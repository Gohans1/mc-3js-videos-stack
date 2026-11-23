import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { cliArgs } from "../packages/live-studio/src/cli.mjs";
import { checkVault, config, copyDirectory, LOCAL, ROOT } from "./vault.mjs";

const HELP = `Prepares real asset copies from the local vault in each film's assets/public, then builds its picks zip from pack/picks.json.
  bun run link                 every film in films/
  bun run link sealed-room     only these films
A new film from bun run new-film is prepared already; run this after updating vault files or pack/picks.json.
Does not install dependencies or download assets. Missing light assets: bun run setup:vault; new machine: bun run setup.
Protects existing custom files. Assets and code must use real directories; only Bun-managed node_modules links are allowed.
Windows worktree cleanup requires Git for Windows 2.54 or newer; detach links before removing a worktree.
next: cd films/<name> and run bun run check, then bun run studio.`;
const args = cliArgs(HELP, []);
const there = (existsSync(join(ROOT, "films")) ? readdirSync(join(ROOT, "films")) : []).filter(
  (f) => existsSync(join(ROOT, "films", f, "package.json")),
);
const films = args.length ? args : there;
const wrong = films.filter((f) => !there.includes(f));
if (wrong.length) {
  console.error(
    `no film ${wrong.join(", ")} in films/ (there: ${there.join(", ")}): bun run link <one of them>, or bun run link for all`,
  );
  process.exit(2);
}

try {
  checkVault();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
mkdirSync(LOCAL, { recursive: true });

for (const film of films) {
  const dir = join(ROOT, "films", film);
  const pub = join(dir, "assets/public");
  for (const [name, sub] of Object.entries(config.film_links as Record<string, string>))
    copyDirectory(join(pub, name), join(LOCAL, sub));
  if (existsSync(join(dir, "pack/picks.json"))) {
    const { pickBlocks } = await import(
      pathToFileURL(join(ROOT, "packages/mc-assets/pick.mjs")).href
    );
    pickBlocks({ cwd: dir, vaultDir: join(LOCAL, "packs") });
  }
}
console.log(
  films.length
    ? `Prepared ${films.length} film(s).\nnext: cd films/${films[0]} and run bun run check, then bun run studio`
    : "Vault connected; no films yet.\nnext: bun run new-film <name>",
);
