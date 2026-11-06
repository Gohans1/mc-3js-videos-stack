// A new film from templates/film: bun run new-film <name> [studio port]
// Copies the template into films/<name>, connects it to the studio the studio's own way (live-studio/init.mjs: its
// package.json link and scripts, bun install; it adds nothing the template holds already), links the vault into it
// (scripts/link.ts) and writes its picks zip (pack/picks.json, empty to start). Then: cd films/<name> && bun run studio.
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const FILMS = join(ROOT, "films");
const [name, portArg] = process.argv.slice(2);
if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) { console.error("usage: bun run new-film <name, lowercase-with-dashes> [studio port]"); process.exit(2); }
const film = join(FILMS, name);
if (existsSync(film)) { console.error(`films/${name} exists already`); process.exit(1); }
// `bun link` in the studio's own folder registers it by name; init.mjs lives there
const link = join(homedir(), ".bun/install/global/node_modules/live-studio");
if (!existsSync(link)) { console.error("live-studio is not linked: clone https://github.com/Gohans1/live-studio, then bun link in it"); process.exit(1); }
const studio = realpathSync(link);

const films = readdirSync(FILMS).filter((f) => existsSync(join(FILMS, f, "package.json")));
const used = films.map((f) => Number(/live\.mjs (\d+)/.exec(JSON.parse(readFileSync(join(FILMS, f, "package.json"), "utf8")).scripts?.studio ?? "")?.[1])).filter(Boolean);
const port = Number(portArg) || Math.max(4324, ...used.map((p) => p + 1));

cpSync(join(ROOT, "templates/film"), film, { recursive: true });
mkdirSync(join(film, "assets/public"), { recursive: true }); // else init.mjs copies the studio demo's
const pkg = join(film, "package.json");
writeFileSync(pkg, readFileSync(pkg, "utf8").replace("__NAME__", name).replace("__PORT__", String(port)));
// this machine's studio host names (Tailscale), never committed: from a film that has them
const hosts = films.map((f) => join(FILMS, f, ".live_hosts")).find(existsSync);
if (hosts) copyFileSync(hosts, join(film, ".live_hosts"));

const run = (cmd: string, args: string[], cwd: string) => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.status !== 0) { console.error(`${cmd} ${args.join(" ")} failed in ${cwd}`); process.exit(r.status ?? 1); }
};
run("node", [join(studio, "init.mjs"), film], ROOT);
run("bun", ["scripts/link.ts", name], ROOT);
run("python", [join(ROOT, "packages/mc-assets/pick.py")], film);
console.log(`\nfilms/${name} is ready (studio port ${port}).
  cd films/${name} && bun run studio            the studio prints both "film contract ... ok" lines
  NOLIST=1 AT=1,4 bun run render stills          a first look, renders/still_*.jpg
  tailscale serve --bg --https=<free port> http://127.0.0.1:${port}   to watch it from the phone`);
