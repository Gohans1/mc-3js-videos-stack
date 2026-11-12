import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
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
