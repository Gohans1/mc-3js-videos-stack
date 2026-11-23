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

import { cliArgs, jsonFile } from "../packages/live-studio/src/cli.mjs";
import { checkVault } from "./vault.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILMS = join(ROOT, "films");
const HELP = `A new film from templates/film, from the repo root: copies the template into films/<name>, connects it to the studio
(package.json link and scripts, bun install), links the vault into it and builds its empty picks zip.
  bun run new-film <name> [studio port] [--ratio 16:9|9:16]   name: lowercase-with-dashes; port: studio's (default one above films' highest)
Example: bun run new-film cave-escape 47920 --ratio 9:16
Requires a prepared vault (new machine: bun run setup). Downloads dependencies; each child step has a 5-minute limit.
The film name must also be unused by any existing workspace package.
Rejects ports already assigned to another film; an unrelated running service can still occupy the port.
If a step fails, the film is kept and the error prints the recovery command. Rerunning new-film never overwrites it.
next: cd films/<name>, read CAPABILITIES.md (full package, acting, VFX and skill atlas), run bun run check, then bun run studio --detach. Data rules: bun run skills get core --ref contract.`;

export const VALID_RATIOS = ["16:9", "9:16"] as const;
export type FilmRatio = (typeof VALID_RATIOS)[number];
export const TEMPLATE_SKIP_NAMES = ["node_modules", "renders", "__pycache__"] as const;

export function shouldCopyTemplateEntry(srcPath: string): boolean {
  return !(TEMPLATE_SKIP_NAMES as readonly string[]).includes(basename(srcPath));
}

export function validateRatio(raw: string | undefined): FilmRatio | null {
  if (!raw) return null;
  return (VALID_RATIOS as readonly string[]).includes(raw) ? (raw as FilmRatio) : null;
}

export function parseNewFilmArgs(argv: string[]): {
  name?: string;
  portArg?: string;
  ratio?: string;
  duplicateRatio?: boolean;
} {
  const words: string[] = [];
  let ratio: string | undefined;
  let duplicateRatio = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--ratio") {
      if (ratio !== undefined) duplicateRatio = true;
      ratio = argv[++i];
    } else {
      words.push(argv[i]!);
    }
  }
  return duplicateRatio
    ? { name: words[0], portArg: words[1], ratio, duplicateRatio }
    : { name: words[0], portArg: words[1], ratio };
}

export function parseTailscaleDnsName(jsonText: string): string | null {
  try {
    const parsed = JSON.parse(jsonText);
    const raw = typeof parsed?.Self?.DNSName === "string" ? parsed.Self.DNSName.trim() : "";
    const clean = raw.replace(/\.+$/, "").toLowerCase();
    if (!clean || !/^[a-z0-9.-]+$/.test(clean) || clean.startsWith(".") || clean.includes("..")) {
      return null;
    }
    return clean;
  } catch {
    return null;
  }
}

export type TailscaleRunner = (
  cmd: string,
  args: string[],
  opts: { encoding: "utf8"; windowsHide: boolean; timeout: number },
) => { status: number | null; stdout?: string; error?: Error };

export function detectTailscaleHost(runCmd: TailscaleRunner = spawnSync): string | null {
  try {
    const r = runCmd("tailscale", ["status", "--json"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 3000,
    });
    if (r.error || r.status !== 0 || !r.stdout) return null;
    return parseTailscaleDnsName(r.stdout);
  } catch {
    return null;
  }
}

function main() {
  const argv = cliArgs(HELP, ["--ratio RATIO"], 2);
  const { name, portArg, ratio: ratioArg, duplicateRatio } = parseNewFilmArgs(argv);
  if (
    !name ||
    !/^[a-z0-9][a-z0-9-]*$/.test(name) ||
    /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(name)
  ) {
    console.error(
      `${name ? `"${name}" is no film name: lowercase letters, digits and dashes, no Windows device names, as cave-escape` : "which name?"}: bun run new-film <name> [studio port] [--ratio 16:9|9:16]`,
    );
    process.exit(2);
  }
  if (portArg !== undefined && !(/^\d+$/.test(portArg) && +portArg >= 1024 && +portArg <= 65535)) {
    console.error(`the studio port is a number from 1024 to 65535, got ${portArg}`);
    process.exit(2);
  }
  if (duplicateRatio) {
    console.error(
      `--ratio was passed more than once; pass it once: --ratio ${VALID_RATIOS.join("|")}`,
    );
    process.exit(2);
  }
  let ratio: FilmRatio | undefined;
  if (ratioArg !== undefined) {
    const valid = validateRatio(ratioArg);
    if (!valid) {
      console.error(`--ratio takes ${VALID_RATIOS.join(" or ")}, got ${JSON.stringify(ratioArg)}`);
      process.exit(2);
    }
    ratio = valid;
  }
  const film = join(FILMS, name);
  if (existsSync(film)) {
    console.error(
      `films/${name} exists already; it was not changed. Use another name. To finish an interrupted creation:\nnext: bun packages/live-studio/init.mjs films/${name}, then bun run link ${name}, then cd films/${name} and bun run studio --detach`,
    );
    process.exit(1);
  }
  const studio = join(ROOT, "packages/live-studio");

  const films = (existsSync(FILMS) ? readdirSync(FILMS) : []).filter((f) =>
    existsSync(join(FILMS, f, "package.json")),
  );
  const packageFiles = [
    join(ROOT, "package.json"),
    ...films.map((f) => join(FILMS, f, "package.json")),
    ...readdirSync(join(ROOT, "packages")).map((p) => join(ROOT, "packages", p, "package.json")),
  ].filter(existsSync);
  if (packageFiles.some((file) => jsonFile(file, ROOT).name === name)) {
    console.error(
      `workspace package "${name}" exists already; choose another film name.\nnext: bun run new-film <different-name> [port]`,
    );
    process.exit(2);
  }
  const used = films
    .map((f) =>
      Number(
        /live\.mjs (\d+)/.exec(
          jsonFile(join(FILMS, f, "package.json"), ROOT).scripts?.studio ?? "",
        )?.[1],
      ),
    )
    .filter(Boolean);
  const port = Number(portArg) || Math.max(4324, ...used.map((p) => p + 1));
  if (port > 65535 || used.includes(port)) {
    console.error(
      `studio port ${port} ${port > 65535 ? "exceeds 65535" : "is already assigned to a film"}: bun run new-film ${name} <unused port from 1024 to 65535>`,
    );
    process.exit(2);
  }
  try {
    checkVault();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  cpSync(join(ROOT, "templates/film"), film, {
    recursive: true,
    filter: shouldCopyTemplateEntry,
  });
  mkdirSync(join(film, "assets/public"), { recursive: true });
  const pkg = join(film, "package.json");
  const pkgText = readFileSync(pkg, "utf8")
    .replace("__NAME__", name)
    .replace("__PORT__", String(port));
  if (ratio) {
    const parsed = JSON.parse(pkgText);
    parsed["live-studio"] = { ...parsed["live-studio"], ratio };
    writeFileSync(pkg, `${JSON.stringify(parsed, null, 2)}\n`);
  } else {
    writeFileSync(pkg, pkgText);
  }
  const hosts = films.map((f) => join(FILMS, f, ".live_hosts")).find(existsSync);
  if (hosts) copyFileSync(hosts, join(film, ".live_hosts"));
  else {
    const tsHost = detectTailscaleHost();
    if (tsHost) writeFileSync(join(film, ".live_hosts"), `${tsHost}\n`);
  }

  const run = (cmd: string, args: string[], cwd: string) => {
    const r = spawnSync(cmd, args, { cwd, stdio: "inherit", windowsHide: true, timeout: 300_000 });
    if (r.error || r.status !== 0) {
      console.error(
        `${cmd} ${args.join(" ")} failed in ${cwd}${r.error ? `: ${r.error.message}` : ""}. Film kept; fix the error.\nnext: bun packages/live-studio/init.mjs films/${name}, then bun run link ${name}`,
      );
      process.exit(1);
    }
  };
  run("bun", [join(studio, "init.mjs"), film], ROOT);
  run("bun", ["scripts/link.ts", name], ROOT);
  console.log(`\nfilms/${name} created, dependencies installed and vault linked (studio port ${port}${ratio ? `, ratio ${ratio}` : ""}).
The scene has not been opened yet; read CAPABILITIES.md for the full package/acting/VFX/skill atlas, check the scene, and open the URL Studio prints.
next: cd films/${name}, read CAPABILITIES.md, run bun run check, then bun run studio --detach (check with --status, stop with --stop)`);
}

if (import.meta.main) {
  main();
}
