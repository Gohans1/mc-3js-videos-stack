// The vault (vault.json "root") holds what never goes in git: Mojang's jar and assets, the Steve rig, the motion clips and
// their catalogue, the mod packs, headless Chrome. This links it in as ./vault and, in each film, as assets/public/<name>
// (vault.json "film_links"), the folders the studio serves to the page, and builds each film's assets/public/picked.zip
// from its pack/picks.json and the vault's mod jars (packages/mc-assets/pick.py; the zip is never committed: mod licences).
// Re-runnable; a link already there is kept, picked.zip is rebuilt.
// bun run link [film ...]   (default: every film)
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const cfg = await Bun.file(join(ROOT, "vault.json")).json();

function link(path: string, target: string) {
  if (!existsSync(target)) throw new Error(`no ${target}: fix vault.json "root" or fill the vault`);
  try {
    lstatSync(path);
    console.log(`kept ${path} -> ${readlinkSync(path)}`);
  } catch {
    symlinkSync(target, path, "junction");
    console.log(`${path} -> ${target}`);
  }
}

link(join(ROOT, "vault"), resolve(cfg.root));
const films = process.argv.slice(2).length ? process.argv.slice(2)
  : readdirSync(join(ROOT, "films")).filter((f) => existsSync(join(ROOT, "films", f, "package.json")));
for (const film of films) {
  const pub = join(ROOT, "films", film, "assets/public");
  mkdirSync(pub, { recursive: true });
  for (const [name, sub] of Object.entries(cfg.film_links as Record<string, string>)) link(join(pub, name), resolve(cfg.root, sub));
  if (existsSync(join(ROOT, "films", film, "pack/picks.json"))) {
    const r = spawnSync("python", [join(ROOT, "packages/mc-assets/pick.py")], { cwd: join(ROOT, "films", film), stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}
