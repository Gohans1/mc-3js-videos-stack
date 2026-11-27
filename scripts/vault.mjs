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

const ESCAPED_DOLLAR = "\uE000";

function parseDotEnvRaw(text) {
  const entries = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(trimmed);
    if (!match) continue;
    const key = match[1];
    const raw = match[2].trim();
    if (!raw) {
      entries.push([key, { val: "", expand: false, allowBackslashDollar: false }]);
      continue;
    }
    const quote = raw[0];
    if (quote === "'" || quote === '"' || quote === "`") {
      let body = raw.slice(1);
      let closed = false;
      let val = "";
      while (true) {
        for (let j = 0; j < body.length; j++) {
          const ch = body[j];
          if (ch === "\\" && quote === '"' && j + 1 < body.length) {
            const next = body[++j];
            val +=
              next === "n"
                ? "\n"
                : next === "r"
                  ? "\r"
                  : next === "t"
                    ? "\t"
                    : next === '"'
                      ? '"'
                      : next === "\\"
                        ? "\\"
                        : next === "$"
                          ? ESCAPED_DOLLAR
                          : `\\${next}`;
            continue;
          }
          if (ch === quote) {
            closed = true;
            break;
          }
          val += ch;
        }
        if (closed || i + 1 >= lines.length) break;
        val += "\n";
        body = lines[++i];
      }
      entries.push([key, { val, expand: quote !== "'", allowBackslashDollar: quote !== '"' }]);
    } else {
      const noComment = raw.startsWith("#") ? "" : raw.replace(/\s+#.*$/, "").trim();
      entries.push([key, { val: noComment, expand: true, allowBackslashDollar: true }]);
    }
  }
  return entries;
}

function expandEnvEntries(rawMap, seed = {}, overrides = {}) {
  const resolved = {};
  const resolving = new Set();
  const resolveKey = (name) => {
    if (overrides[name] !== undefined) return overrides[name];
    if (name in resolved) return resolved[name];
    const entry = rawMap.get(name);
    if (!entry) return seed[name] ?? "";
    if (resolving.has(name)) return seed[name] ?? "";
    resolving.add(name);
    let value;
    if (!entry.expand) {
      value = entry.val;
    } else {
      const pattern = entry.allowBackslashDollar
        ? /\\\$|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g
        : /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;
      value = entry.val
        .replace(pattern, (m, a, b) => (m === "\\$" ? "$" : resolveKey(a ?? b)))
        .replaceAll(ESCAPED_DOLLAR, "$");
    }
    resolving.delete(name);
    resolved[name] = value;
    return value;
  };
  for (const key of rawMap.keys()) resolveKey(key);
  return resolved;
}

export function parseDotEnv(text, seed = {}, overrides = {}) {
  const rawMap = new Map(parseDotEnvRaw(text));
  return expandEnvEntries(rawMap, seed, overrides);
}

function loadRootEnv() {
  const cwd = resolve(process.cwd());
  const sameRoot =
    process.platform === "win32" ? cwd.toLowerCase() === ROOT.toLowerCase() : cwd === ROOT;
  if (
    sameRoot ||
    process.env.MC_ROOT_ENV_LOADED === ROOT ||
    process.execArgv.some(
      (arg) => arg === "--no-env-file" || arg === "--env-file" || arg.startsWith("--env-file="),
    )
  )
    return;
  const nodeEnv = process.env.NODE_ENV || "development";
  const files =
    nodeEnv === "test"
      ? [".env", `.env.${nodeEnv}`, `.env.${nodeEnv}.local`]
      : [".env", `.env.${nodeEnv}`, ".env.local", `.env.${nodeEnv}.local`];
  const rawMap = new Map();
  let loadedAny = false;
  for (const name of files) {
    const filePath = join(ROOT, name);
    if (!existsSync(filePath)) continue;
    loadedAny = true;
    for (const [key, entry] of parseDotEnvRaw(readFileSync(filePath, "utf8"))) {
      rawMap.set(key, entry);
    }
  }
  if (!loadedAny) return;
  const merged = expandEnvEntries(rawMap, {}, process.env);
  for (const [key, value] of Object.entries(merged))
    if (process.env[key] === undefined) process.env[key] = value;
  process.env.MC_ROOT_ENV_LOADED = ROOT;
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
