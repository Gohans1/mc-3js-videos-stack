// Formats src/timeline/*.json (or named stems/paths) with the studio's 140-column compact JSON layout:
//   bun ../../scripts/timeline_fmt.ts [stem|path ...]
//   import { dump, load, save } from ".../scripts/timeline_fmt.ts"
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

import { cliArgs, jsonFile } from "../packages/live-studio/src/cli.mjs";
import { openEditProtection } from "../packages/live-studio/src/edit-protection.mjs";
import { compactJson as dump } from "../packages/live-studio/src/timeline_file.mjs";
import { assertInsideDir, writeAtomicSync } from "../packages/live-studio/src/voice-map.mjs";

export { dump };

export const load = (name: string, dir = join(process.cwd(), "src/timeline")) =>
  jsonFile(join(dir, `${name}.json`));

export const save = (name: string, data: unknown, dir = join(process.cwd(), "src/timeline")) => {
  writeAtomicSync(join(dir, `${name}.json`), `${dump(data)}\n`);
};

const isStudioProtected = (cwd: string, rel: string): boolean => {
  const candidates =
    process.platform === "win32" && rel !== rel.toLowerCase() ? [rel, rel.toLowerCase()] : [rel];
  for (const candidate of candidates) {
    try {
      if (openEditProtection(cwd, candidate).report().protected.length > 0) return true;
    } catch {
      // Fail closed on corrupt collaboration JSON so human edits are never overwritten
      return true;
    }
  }
  return false;
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
  const realCwd = realpathSync.native(cwd);
  const realAbs = realpathSync.native(abs);
  const rel = relative(realCwd, realAbs).replaceAll("\\", "/");
  const topSeg = rel.split("/")[0]?.toLowerCase();
  if (topSeg === ".studio" || topSeg === "node_modules") {
    throw new Error(`Refusing to format internal file: "${rel}"`);
  }
  return { abs: join(resolve(cwd), rel), rel, label: labelFor(rel) };
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
      const safeDir = assertInsideDir(cwd, "src/timeline", "Timeline directory");
      const files = readdirSync(safeDir)
        .filter((f) => f.endsWith(".json") && f !== ".json")
        .sort();
      targets = files
        .map((name) => {
          const abs = assertInsideDir(cwd, `src/timeline/${name}`, "Timeline file");
          return statSync(abs).isFile() ? { abs, rel: `src/timeline/${name}`, label: name } : null;
        })
        .filter((t): t is TargetFile => t !== null);
    }

    const protectedRels = new Set(
      targets.filter((target) => isStudioProtected(cwd, target.rel)).map((target) => target.rel),
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

    const outputs = toFormat.map((target) => `${dump(jsonFile(target.abs, cwd))}\n`);
    for (const [i, target] of toFormat.entries()) {
      if (explicit && protectedRels.has(target.rel)) {
        console.error(
          `warning: ${target.label} has Studio-protected edits; formatting anyway as explicitly requested`,
        );
      }
      const formatted = outputs[i]!;
      writeAtomicSync(target.abs, formatted);
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
