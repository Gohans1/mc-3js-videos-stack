import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const config = JSON.parse(readFileSync(resolve(ROOT, "vault.json"), "utf8"));

export function vaultPath(path) {
  return resolve(ROOT, path);
}

export const LOCAL = vaultPath(config.root);
export const EXTERNAL = vaultPath(
  process.env.MC_VAULT_EXTERNAL ?? config.externalRoot ?? config.root,
);

export function checkVault() {
  if (lstatSync(LOCAL, { throwIfNoEntry: false })?.isSymbolicLink())
    throw new Error(
      `Local vault must be a real directory: ${LOCAL}. Preserve its light assets before replacing the old link.`,
    );
  for (const name of config.external ?? [])
    if (!statSync(resolve(EXTERNAL, name), { throwIfNoEntry: false })?.isDirectory())
      throw new Error(
        `Missing external vault/${name}: ${EXTERNAL}. Restore it there or set MC_VAULT_EXTERNAL; then bun run link.`,
      );
  for (const sub of Object.values(config.film_links)) {
    const external = (config.external ?? []).includes(sub);
    const target = resolve(external ? EXTERNAL : LOCAL, sub);
    if (!statSync(target, { throwIfNoEntry: false })?.isDirectory())
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

export function linkDirectory(path, target) {
  path = resolve(path);
  target = resolve(target);
  if (path === target) return;
  if (!existsSync(target)) throw new Error(`Missing asset directory: ${target}`);
  const current = lstatSync(path, { throwIfNoEntry: false });
  if (current) {
    if (!current.isSymbolicLink())
      throw new Error(
        `Refusing to replace real files at ${path}; move them deliberately before linking.`,
      );
    const old = resolve(dirname(path), readlinkSync(path));
    if (
      (process.platform === "win32"
        ? old.toLowerCase() === target.toLowerCase()
        : old === target) &&
      existsSync(path)
    )
      return;
    unlinkSync(path);
  }
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir");
  console.log(`${path} -> ${target}`);
}
