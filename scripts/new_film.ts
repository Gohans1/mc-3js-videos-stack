// A new film from templates/film: bun run new-film <name> [studio port]
// Copies the template into films/<name>, connects it to the studio the studio's own way (packages/live-studio/init.mjs: its
// package.json link and scripts, bun install; it adds nothing the template holds already), links the vault into it
// and builds its picks zip from pack/picks.json, empty to start (scripts/link.ts). Then: cd films/<name> && bun run studio.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cliArgs } from "../packages/live-studio/src/cli.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILMS = join(ROOT, "films");
const HELP = `A new film from templates/film, from the repo root: copies the template into films/<name>, connects it to the studio
(package.json link and scripts, bun install), links the vault into it and builds its empty picks zip.
  bun run new-film <name> [studio port]     name: lowercase-with-dashes; port: the studio's (default one above the films' highest)
Example: bun run new-film cave-escape 47920
Then: cd films/<name> && bun run studio. The film's data rules: packages/live-studio/docs/film-contract.md.`;
const [name, portArg] = cliArgs(HELP, [], 2);
if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error(
    `${name ? `"${name}" is no film name: lowercase letters, digits and dashes, as cave-escape` : "which name?"}: bun run new-film <name> [studio port]`,
  );
  process.exit(2);
}
if (portArg !== undefined && !(/^\d+$/.test(portArg) && +portArg >= 1024 && +portArg <= 65535)) {
  console.error(`the studio port is a number from 1024 to 65535, got ${portArg}`);
  process.exit(2);
}
const film = join(FILMS, name);
if (existsSync(film)) {
  console.error(
    `films/${name} exists already: pick another name (or cd films/${name} && bun run studio)`,
  );
  process.exit(1);
}
const studio = join(ROOT, "packages/live-studio");

const films = readdirSync(FILMS).filter((f) => existsSync(join(FILMS, f, "package.json")));
const used = films
  .map((f) =>
    Number(
      /live\.mjs (\d+)/.exec(
        JSON.parse(readFileSync(join(FILMS, f, "package.json"), "utf8")).scripts?.studio ?? "",
      )?.[1],
    ),
  )
  .filter(Boolean);
const port = Number(portArg) || Math.max(4324, ...used.map((p) => p + 1));

// the template is a working film too: its own node_modules (links) and renders stay behind
cpSync(join(ROOT, "templates/film"), film, {
  recursive: true,
  filter: (src) => !["node_modules", "renders"].includes(basename(src)),
});
mkdirSync(join(film, "assets/public"), { recursive: true }); // else init.mjs copies the studio demo's
const pkg = join(film, "package.json");
writeFileSync(
  pkg,
  readFileSync(pkg, "utf8").replace("__NAME__", name).replace("__PORT__", String(port)),
);
// this machine's studio host names (Tailscale), never committed: from a film that has them
const hosts = films.map((f) => join(FILMS, f, ".live_hosts")).find(existsSync);
if (hosts) copyFileSync(hosts, join(film, ".live_hosts"));

const run = (cmd: string, args: string[], cwd: string) => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`${cmd} ${args.join(" ")} failed in ${cwd}`);
    process.exit(r.status ?? 1);
  }
};
run("bun", [join(studio, "init.mjs"), film], ROOT);
run("bun", ["scripts/link.ts", name], ROOT);
console.log(`\nfilms/${name} is ready (studio port ${port}).
  cd films/${name} && bun run studio            the studio prints both "film contract ... ok" lines
  AT=1,4 bun run render stills                   a first look, renders/still_*.jpg
  tailscale serve --bg --https=<free port> http://127.0.0.1:${port}   to watch it from the phone`);
