import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function loadRootEnv() {
  if (
    resolve(process.cwd()) === ROOT ||
    process.execArgv.some(
      (arg) => arg === "--no-env-file" || arg === "--env-file" || arg.startsWith("--env-file="),
    )
  )
    return;
  if (!readdirSync(ROOT).some((name) => name === ".env" || name.startsWith(".env."))) return;
  // Bun's dotenv parser preserves expansion/precedence for commands launched inside films.
  const loaded = spawnSync(
    process.versions.bun ? process.execPath : "bun",
    ["--print", "JSON.stringify(process.env)"],
    {
      cwd: ROOT,
      env: process.env,
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    },
  );
  if (loaded.error || loaded.status !== 0)
    throw new Error("Cannot load repository dotenv defaults with Bun");
  const defaults = JSON.parse(loaded.stdout);
  for (const [key, value] of Object.entries(defaults))
    if (process.env[key] === undefined) process.env[key] = value;
}
loadRootEnv();
export const config = JSON.parse(readFileSync(resolve(ROOT, "vault.json"), "utf8"));

export function vaultPath(path) {
  return resolve(ROOT, path);
}

export const LOCAL = vaultPath(process.env.MC_VAULT_ROOT?.trim() || config.root);
export const EXTERNAL = vaultPath(
  process.env.MC_VAULT_EXTERNAL?.trim() || config.externalRoot || config.root,
);

export function checkVault() {
  if (lstatSync(LOCAL, { throwIfNoEntry: false })?.isSymbolicLink())
    throw new Error(
      `Local vault must be a real directory: ${LOCAL}. Preserve its light assets before replacing the old link.`,
    );
  for (const name of config.requiredDirectories ?? [])
    if (!lstatSync(resolve(LOCAL, name), { throwIfNoEntry: false })?.isDirectory())
      throw new Error(`Missing real vault/${name}: ${LOCAL}. Restore it there, then bun run link.`);
  for (const sub of Object.values(config.film_links)) {
    const target = resolve(LOCAL, sub);
    if (!lstatSync(target, { throwIfNoEntry: false })?.isDirectory())
      throw new Error(
        `Missing asset directory: ${target}. Run bun run setup:vault, then bun run link.`,
      );
  }
  for (const file of config.requiredFiles ?? [])
    if (!statSync(resolve(LOCAL, file), { throwIfNoEntry: false })?.isFile())
      throw new Error(
        `Missing vault file: ${resolve(LOCAL, file)}. Run bun run setup:vault, then bun run link.`,
      );
}

export function copyDirectory(path, target) {
  path = resolve(path);
  target = resolve(target);
  if (path === target) return;
  if (!existsSync(target)) throw new Error(`Missing asset directory: ${target}`);
  const current = lstatSync(path, { throwIfNoEntry: false });
  const linked = current?.isSymbolicLink();
  const marker = join(path, ".vault-copy.json");
  if (
    current &&
    !linked &&
    (!current.isDirectory() || (!existsSync(marker) && readdirSync(path).length))
  )
    throw new Error(
      `Refusing to replace real files at ${path}; preserve them before preparing asset copies.`,
    );
  const previous = !linked && existsSync(marker) ? JSON.parse(readFileSync(marker, "utf8")) : {};
  const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
  const files = { ...previous };
  const pending = [];
  const walk = (sub = "") => {
    for (const entry of readdirSync(join(target, sub), { withFileTypes: true })) {
      if (entry.name === ".vault-copy.json") continue;
      const rel = join(sub, entry.name);
      const source = join(target, rel);
      if (lstatSync(source).isSymbolicLink())
        throw new Error(`Asset source must be a real file or directory: ${source}`);
      if (entry.isDirectory()) {
        const dest = !linked && lstatSync(join(path, rel), { throwIfNoEntry: false });
        if (dest && !dest.isDirectory())
          throw new Error(`Asset directory conflicts with ${join(path, rel)}`);
        walk(rel);
        continue;
      }
      const dest = join(path, rel);
      files[rel] = hash(source);
      const old = !linked && lstatSync(dest, { throwIfNoEntry: false });
      if (old) {
        if (!old.isFile()) throw new Error(`Asset copy conflicts with ${dest}`);
        const actual = hash(dest);
        if (actual === files[rel]) continue;
        if (actual !== previous[rel])
          throw new Error(`Modified film asset: ${dest}. Preserve it before refreshing.`);
      }
      pending.push(rel);
    }
  };
  walk();
  if (linked) unlinkSync(path);
  mkdirSync(path, { recursive: true });
  if (!existsSync(marker)) writeFileSync(marker, JSON.stringify(files));
  for (const rel of pending) {
    const dest = join(path, rel);
    const partial = `${dest}.${process.pid}.part`;
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(target, rel), partial);
    if (hash(partial) !== files[rel]) throw new Error(`Asset copy verification failed: ${partial}`);
    renameSync(partial, dest);
  }
  const partial = `${marker}.${process.pid}.part`;
  writeFileSync(partial, JSON.stringify(files));
  renameSync(partial, marker);
  console.log(`${path}: ${pending.length} asset file(s) copied`);
}
