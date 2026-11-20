// Formats src/timeline/*.json (or named stems/paths) with the studio's 140-column compact JSON layout:
//   bun ../../scripts/timeline_fmt.ts [stem|path ...]
//   import { dump, load, save } from ".../scripts/timeline_fmt.ts"
import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative } from "node:path";

import { cliArgs, jsonFile } from "../packages/live-studio/src/cli.mjs";
import { compactJson as dump } from "../packages/live-studio/src/timeline_file.mjs";
import { assertInsideDir } from "../packages/live-studio/src/voice-map.mjs";

export { dump };

export const load = (name: string, dir = join(process.cwd(), "src/timeline")) =>
  jsonFile(join(dir, `${name}.json`));

export const save = (name: string, data: unknown, dir = join(process.cwd(), "src/timeline")) => {
  writeFileSync(join(dir, `${name}.json`), `${dump(data)}\n`, "utf8");
};

const hasActiveProtection = (state: unknown): boolean => {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  const s = state as Record<string, unknown>;
  if (Array.isArray(s.guards) && s.guards.length > 0) return true;
  if (s.wholeFileProtected === true) return true;
  if (Array.isArray(s.protectedPaths) && s.protectedPaths.length > 0) return true;
  return false;
};

const readProtectedFiles = (cwd: string, rels: readonly string[]): Set<string> => {
  const folder = join(cwd, ".studio/collaboration");
  const protectedRels = new Set<string>();
  if (!existsSync(folder)) return protectedRels;

  for (const rel of rels) {
    const key = createHash("sha256").update(rel).digest("hex");
    const stateFile = join(folder, `${key}.json`);
    if (!existsSync(stateFile)) continue;
    try {
      if (hasActiveProtection(JSON.parse(readFileSync(stateFile, "utf8")))) {
        protectedRels.add(rel);
      }
    } catch {
      protectedRels.add(rel);
    }
  }

  for (const entry of readdirSync(folder)) {
    if (!entry.endsWith(".json") || /^[a-f0-9]{64}\.json$/.test(entry)) continue;
    try {
      const state = JSON.parse(readFileSync(join(folder, entry), "utf8"));
      if (!hasActiveProtection(state)) continue;
      const ref =
        typeof state.file === "string"
          ? state.file
          : typeof state.rel === "string"
            ? state.rel
            : null;
      if (ref) protectedRels.add(ref.replaceAll("\\", "/").replace(/^\.\//, ""));
    } catch {
      /* ignore unrelated malformed collaboration entries */
    }
  }
  return protectedRels;
};

const labelFor = (rel: string): string =>
  rel.startsWith("src/timeline/") && !rel.slice("src/timeline/".length).includes("/")
    ? rel.slice("src/timeline/".length)
    : rel;

interface TargetFile {
  abs: string;
  rel: string;
  label: string;
}

const resolveTargetArg = (cwd: string, raw: string): TargetFile => {
  if (!raw || raw.includes("\0")) {
    throw new Error(`Invalid timeline argument: ${JSON.stringify(raw)}`);
  }
  const isBareStem =
    !raw.includes("/") && !raw.includes("\\") && !raw.includes(":") && !raw.includes(".");
  const candidate = isBareStem ? `src/timeline/${raw}.json` : raw;
  const abs = assertInsideDir(cwd, candidate, "Timeline file");
  if (!abs.endsWith(".json") || basename(abs) === ".json") {
    throw new Error(`Timeline file must end with .json: "${raw}"`);
  }
  if (!existsSync(abs)) {
    throw new Error(
      `Missing timeline file: "${candidate}" (pass a bare stem like "cast" or a path like "src/timeline/cast.json")`,
    );
  }
  if (!statSync(abs).isFile()) {
    throw new Error(`Timeline path is not a file: "${candidate}"`);
  }
  const rel = relative(realpathSync.native(cwd), realpathSync.native(abs)).replaceAll("\\", "/");
  return { abs, rel, label: labelFor(rel) };
};

if (import.meta.main) {
  const args = cliArgs(
    `Formats src/timeline/*.json (or named stems/paths) with the studio's compact layout.
  bun ../../scripts/timeline_fmt.ts [stem|path ...]
With no arguments, formats unprotected src/timeline/*.json files and skips Studio-protected files.
Bare stems resolve to src/timeline/<stem>.json. Paths must stay inside the film folder and end in .json.
Formatting is optional; it imposes no schema or creative limits. All JSON is parsed before any file is changed.
next: bun run check`,
    [],
    Infinity,
  );
  const cwd = process.cwd();
  const dir = join(cwd, "src/timeline");
  try {
    let targets: TargetFile[];
    const explicit = args.length > 0;
    if (explicit) {
      const seen = new Set<string>();
      targets = [];
      for (const raw of args) {
        const target = resolveTargetArg(cwd, raw);
        if (seen.has(target.rel)) continue;
        seen.add(target.rel);
        targets.push(target);
      }
    } else {
      const files = readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort();
      targets = files
        .map((name) => {
          const abs = assertInsideDir(cwd, `src/timeline/${name}`, "Timeline file");
          return statSync(abs).isFile() ? { abs, rel: `src/timeline/${name}`, label: name } : null;
        })
        .filter((t): t is TargetFile => t !== null);
    }

    const protectedRels = readProtectedFiles(
      cwd,
      targets.map((t) => t.rel),
    );
    const toFormat: TargetFile[] = [];
    for (const target of targets) {
      if (!explicit && protectedRels.has(target.rel)) {
        console.log(
          `skipped (Studio-protected): ${target.label} — edit via bun run collab or pass its name explicitly`,
        );
        continue;
      }
      toFormat.push(target);
    }

    const parsed = toFormat.map((target) => jsonFile(target.abs, cwd));
    for (const [i, target] of toFormat.entries()) {
      if (explicit && protectedRels.has(target.rel)) {
        console.error(
          `warning: ${target.label} has Studio-protected edits; formatting anyway as explicitly requested`,
        );
      }
      const formatted = `${dump(parsed[i])}\n`;
      writeFileSync(target.abs, formatted, "utf8");
      const lines = formatted.split("\n").length - 1;
      console.log(target.label, lines, "lines");
    }
    console.log("next: bun run check");
  } catch (e) {
    console.error(
      `${e instanceof Error ? e.message : String(e)}: fix the named JSON file, or cd films/<name> first`,
    );
    process.exit(2);
  }
}
