import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import ts from "typescript";

import { ENVIRONMENT_PRESETS } from "../../packages/film-stage/src/lights.ts";
import { FONTS } from "../../packages/film-stage/src/titles-catalog.ts";
import { TONE_MAPS } from "../../packages/film-stage/src/tone.ts";
import { TRANSITIONS } from "../../packages/film-stage/src/transitions-meta.ts";
import { shouldCopyTemplateEntry } from "../new_film.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const ATLAS_PATH = join(ROOT, "templates/film/CAPABILITIES.md");
const SCENE_PATH = join(ROOT, "templates/film/src/scene.ts");
const NEW_FILM_PATH = join(ROOT, "scripts/new_film.ts");
const HELP_PATH = join(ROOT, "packages/live-studio/help.mjs");
const SKILLS_PATH = join(ROOT, "packages/live-studio/skills.mjs");
const BMR_TYPES_PATH = join(
  ROOT,
  "packages/mc-assets/node_modules/block-model-renderer/types/web.d.ts",
);

function readExports(pkgDir, filterSubpath = () => true) {
  const pkg = JSON.parse(readFileSync(join(ROOT, pkgDir, "package.json"), "utf8"));
  return Object.entries(pkg.exports ?? {})
    .filter(([k]) => k.startsWith("./"))
    .map(([k, v]) => ({ subpath: k.slice(2), target: typeof v === "string" ? v : null }))
    .filter(({ subpath }) => filterSubpath(subpath))
    .sort((a, b) => a.subpath.localeCompare(b.subpath));
}

function resolveTsFile(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  const noJs = spec.endsWith(".js") ? resolve(dirname(fromFile), spec.slice(0, -3)) : base;
  for (const cand of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.d.ts`,
    `${base}.mjs`,
    `${noJs}.ts`,
    `${noJs}.d.ts`,
    join(base, "index.ts"),
  ]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

function collectRuntimeExports(filePath, seen = new Set()) {
  const abs = resolve(filePath);
  if (seen.has(abs) || !existsSync(abs)) return new Set();
  seen.add(abs);
  const src = readFileSync(abs, "utf8");
  const sf = ts.createSourceFile(abs, src, ts.ScriptTarget.Latest, true);
  const names = new Set();

  const hasExportModifier = (node) =>
    Boolean(node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));

  for (const stmt of sf.statements) {
    if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) names.add(decl.name.text);
      }
    } else if (
      (ts.isFunctionDeclaration(stmt) ||
        ts.isClassDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt)) &&
      hasExportModifier(stmt) &&
      stmt.name
    ) {
      names.add(stmt.name.text);
    } else if (ts.isExportDeclaration(stmt) && !stmt.isTypeOnly) {
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          if (!el.isTypeOnly) names.add(el.name.text);
        }
      } else if (
        !stmt.exportClause &&
        stmt.moduleSpecifier &&
        ts.isStringLiteral(stmt.moduleSpecifier)
      ) {
        const spec = stmt.moduleSpecifier.text;
        if (spec.startsWith(".")) {
          const target = resolveTsFile(abs, spec);
          if (target) {
            for (const n of collectRuntimeExports(target, seen)) names.add(n);
          }
        }
      }
    }
  }
  return names;
}

function stripTsComments(source) {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    source,
  );
  let out = "";
  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (
      token !== ts.SyntaxKind.SingleLineCommentTrivia &&
      token !== ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      out += scanner.getTokenText();
    }
    token = scanner.scan();
  }
  return out;
}

function parseTableRows(markdown) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && !/^\|[\s:|-]+\|$/.test(line))
    .map((line) =>
      line
        .split(/(?<!\\)\|/)
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
}

function makeNewFilmFixture() {
  const root = mkdtempSync(join(tmpdir(), "film-cap-e2e-"));
  const put = (file, value) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), typeof value === "string" ? value : JSON.stringify(value));
  };
  for (const file of [
    "scripts/new_film.ts",
    "scripts/link.ts",
    "scripts/vault.mjs",
    "packages/live-studio/init.mjs",
    "packages/live-studio/src/cli.mjs",
    "packages/live-studio/src/compact-json.mjs",
    "packages/live-studio/src/edit-protection.mjs",
    "packages/live-studio/src/merge-edits.mjs",
    "packages/mc-assets/pick.mjs",
    "packages/mc-assets/src/catalog.ts",
    "packages/mc-assets/src/picks-manifest.ts",
  ]) {
    const src = join(ROOT, file);
    if (existsSync(src)) put(file, readFileSync(src, "utf8"));
  }
  cpSync(join(ROOT, "packages/live-studio/demo"), join(root, "packages/live-studio/demo"), {
    recursive: true,
  });
  put("package.json", { private: true, workspaces: ["packages/*", "films/*"] });
  put("packages/live-studio/package.json", { name: "live-studio", type: "module" });
  symlinkSync(
    join(ROOT, "packages/mc-assets/node_modules"),
    join(root, "packages/mc-assets/node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  put("vault.json", {
    root: "./vault",
    requiredDirectories: ["packs"],
    film_links: { mc: "jar" },
  });
  mkdirSync(join(root, "vault/jar"), { recursive: true });
  mkdirSync(join(root, "vault/packs"), { recursive: true });
  mkdirSync(join(root, "films"), { recursive: true });
  put("templates/film/package.json", {
    name: "__NAME__",
    type: "module",
    dependencies: { "live-studio": "workspace:*" },
    scripts: { studio: "bun node_modules/live-studio/src/live.mjs __PORT__" },
    "live-studio": { camTimeline: "src/timeline/cam.json", liveLanes: true },
  });
  for (const file of ["src/scene.ts", "src/edit.ts", "sound.py", ".gitignore"]) {
    put(`templates/film/${file}`, "");
  }
  put("templates/film/src/edit.json", {});
  put("templates/film/pack/picks.json", []);
  put("templates/film/CAPABILITIES.md", readFileSync(ATLAS_PATH, "utf8"));
  put("templates/film/node_modules/stale-sentinel.txt", "skip");
  put("templates/film/renders/old-still.jpg", "skip");
  put("templates/film/__pycache__/junk.pyc", "skip");
  put("templates/film/src/__pycache__/nested.pyc", "skip");
  return root;
}

test("CAPABILITIES.md stays bidirectionally synced with every workspace subpath export and bundled film engine", () => {
  const atlas = readFileSync(ATLAS_PATH, "utf8");
  const pkgSpecs = [
    ["packages/film-stage", "film-stage", () => true],
    ["packages/mc-actor", "mc-actor", () => true],
    ["packages/mc-assets", "mc-assets", () => true],
    ["packages/live-studio", "live-studio", (s) => !s.startsWith("src/")],
  ];

  for (const [pkgDir, pkgName, filterFn] of pkgSpecs) {
    const actual = readExports(pkgDir, filterFn).map((e) => e.subpath);
    const actualSet = new Set(actual);
    for (const sub of actual) {
      expect(atlas, `missing ${pkgName}/${sub} in CAPABILITIES.md`).toContain(
        `\`${pkgName}/${sub}\``,
      );
    }
    const cited = [...atlas.matchAll(new RegExp(`\`${pkgName}/([^\`\\s]+)\``, "g"))].map(
      (m) => m[1],
    );
    for (const sub of cited) {
      expect(actualSet.has(sub), `phantom ${pkgName}/${sub} in CAPABILITIES.md`).toBe(true);
    }
  }

  const kitActual = readExports("packages/film-kit").map((e) => e.subpath);
  const kitSet = new Set(kitActual);
  for (const m of atlas.matchAll(/`film-kit\/([^`\s]+)`/g)) {
    if (m[1] === "<name>") continue;
    expect(kitSet.has(m[1]), `phantom film-kit/${m[1]} in CAPABILITIES.md`).toBe(true);
  }
  const kitRows = parseTableRows(atlas).filter((cells) =>
    [
      "Life & Micro-Acting",
      "Reactive & Physical Acting",
      "Curves, Springs & Poses",
      "Minecraft Physics & Footsteps",
      "Camera Optics & Safe Framing",
    ].includes(cells[0] ?? ""),
  );
  const kitCited = new Set();
  for (const row of kitRows) {
    for (const m of (row[1] ?? "").matchAll(/`([a-z0-9-]+)`/g)) {
      kitCited.add(m[1]);
    }
  }
  expect([...kitCited].sort((a, b) => a.localeCompare(b))).toEqual(kitActual);
  expect(atlas).toContain(`All ${kitActual.length} Modules`);

  const tplDeps = Object.keys(
    JSON.parse(readFileSync(join(ROOT, "templates/film/package.json"), "utf8")).dependencies ?? {},
  );
  for (const engine of [
    "@dimforge/rapier3d-compat",
    "block-model-renderer",
    "n8ao",
    "postprocessing",
    "three",
    "three-good-godrays",
  ]) {
    expect(tplDeps, `missing template dep ${engine}`).toContain(engine);
    expect(atlas, `missing bundled engine ${engine} in CAPABILITIES.md`).toContain(`\`${engine}\``);
  }
  expect(atlas).toContain("localClippingEnabled");
});

test("CAPABILITIES.md only cites real exported symbols and live preset/transition/tone IDs across Sections 1-3", () => {
  const atlas = readFileSync(ATLAS_PATH, "utf8");
  const pkgRoots = {
    "film-stage": "packages/film-stage",
    "film-kit": "packages/film-kit",
    "mc-actor": "packages/mc-actor",
    "mc-assets": "packages/mc-assets",
    "live-studio": "packages/live-studio",
  };

  const exportsByModule = new Map();
  for (const [pkgName, pkgDir] of Object.entries(pkgRoots)) {
    for (const entry of readExports(
      pkgDir,
      (s) => pkgName !== "live-studio" || !s.startsWith("src/"),
    )) {
      if (!entry.target) continue;
      const abs = join(ROOT, pkgDir, entry.target);
      exportsByModule.set(`${pkgName}/${entry.subpath}`, collectRuntimeExports(abs));
    }
  }
  const bmrExports = collectRuntimeExports(BMR_TYPES_PATH);
  expect(bmrExports.size).toBeGreaterThan(0);

  const playerSrc = readFileSync(join(ROOT, "packages/mc-actor/src/player.ts"), "utf8");
  const playerApiTokens = [
    "armTo",
    "legTo",
    "headTo",
    "holdProp",
    "tintParts",
    "showParts",
    "eyeWhite",
    "faceColors",
  ];
  for (const tok of playerApiTokens) {
    expect(playerSrc, `missing player API token ${tok} in player.ts`).toContain(tok);
  }

  const contractKeysSrc = readFileSync(
    join(ROOT, "packages/live-studio/src/contract-keys.ts"),
    "utf8",
  );
  expect(contractKeysSrc).toContain('"easeChannels"');

  const rows = parseTableRows(atlas);
  for (const row of rows) {
    const col0 = row[0] ?? "";
    const col1 = row[1] ?? "";
    const col2 = row[2] ?? "";
    const rowModules = [];

    for (const m of `${col0} ${col1}`.matchAll(
      /`((?:film-stage|mc-actor|mc-assets|live-studio)\/[a-z0-9-]+)`/g,
    )) {
      rowModules.push(m[1]);
    }
    if (
      [
        "Life & Micro-Acting",
        "Reactive & Physical Acting",
        "Curves, Springs & Poses",
        "Minecraft Physics & Footsteps",
        "Camera Optics & Safe Framing",
      ].includes(col0)
    ) {
      for (const m of col1.matchAll(/`([a-z0-9-]+)`/g)) {
        rowModules.push(`film-kit/${m[1]}`);
      }
    }
    if (rowModules.length === 0) continue;

    const allowed = new Set();
    for (const mod of rowModules) {
      for (const sym of exportsByModule.get(mod) ?? []) allowed.add(sym);
    }

    if (rowModules.includes("film-stage/lights")) {
      for (const preset of Object.keys(ENVIRONMENT_PRESETS)) allowed.add(preset);
      for (const threeTok of ["PointLight", "DirectionalLight", "ToneMappingEffect"]) {
        allowed.add(threeTok);
      }
    }
    if (rowModules.includes("film-stage/transitions")) {
      for (const tr of TRANSITIONS) allowed.add(tr.id);
    }
    if (rowModules.includes("film-stage/tone")) {
      for (const mode of TONE_MAPS) allowed.add(mode);
    }
    if (rowModules.includes("film-stage/camera")) {
      allowed.add("easeChannels");
    }
    if (col0.includes("`block-model-renderer`")) {
      for (const sym of bmrExports) allowed.add(sym);
    }
    if (rowModules.includes("mc-actor/player")) {
      for (const tok of playerApiTokens) allowed.add(tok);
    }
    if (rowModules.includes("mc-assets/screen")) {
      allowed.add("CanvasTexture");
    }

    const inspectText = rowModules[0].startsWith("mc-") ? `${col1} ${col2}` : col2;
    const rawTokens = [...inspectText.matchAll(/`([A-Za-z_$][A-Za-z0-9_$]*)`/g)].map((m) => m[1]);
    for (const tok of rawTokens) {
      expect(
        allowed.has(tok),
        `unexported symbol \`${tok}\` cited alongside [${rowModules.join(", ")}] in CAPABILITIES.md`,
      ).toBe(true);
    }
  }
});

test("CAPABILITIES.md matches live TRANSITIONS, FONTS, and variable font counts with zero gl-transitions claim", () => {
  const atlas = readFileSync(ATLAS_PATH, "utf8");
  expect(atlas).toContain(`${TRANSITIONS.length} built-in GLSL shaders`);

  const fontMatches = [...atlas.matchAll(/(\d+)\s+bundled fonts/g)];
  expect(fontMatches.length).toBeGreaterThanOrEqual(2);
  for (const m of fontMatches) {
    expect(Number(m[1])).toBe(FONTS.length);
  }

  const stageDeps = Object.keys(
    JSON.parse(readFileSync(join(ROOT, "packages/film-stage/package.json"), "utf8")).dependencies ??
      {},
  );
  const variableFontCount = stageDeps.filter((d) => d.startsWith("@fontsource-variable/")).length;
  expect(atlas).toContain(`${variableFontCount} variable \`@fontsource-variable/*\``);
  expect(atlas).not.toContain("gl-transitions");
});

test("CAPABILITIES.md references only active film CLI scripts, valid subcommands/flags, showcase lab, and exact repo skills", () => {
  const atlas = readFileSync(ATLAS_PATH, "utf8");
  const tplScripts =
    JSON.parse(readFileSync(join(ROOT, "templates/film/package.json"), "utf8")).scripts ?? {};
  const activeFilmScripts = new Set(
    Object.entries(tplScripts)
      .filter(([, cmd]) => !String(cmd).includes("wrong-place.mjs"))
      .map(([name]) => name),
  );

  for (const m of atlas.matchAll(/bun run ([a-z][a-z0-9:-]*)/g)) {
    const cmd = m[1];
    expect(
      activeFilmScripts.has(cmd),
      `inactive or unknown film script "bun run ${cmd}" in CAPABILITIES.md`,
    ).toBe(true);
  }

  const sec4 = atlas.split("## 4.")[1] ?? "";
  expect(sec4.length).toBeGreaterThan(0);
  for (const m of sec4.matchAll(/`([^`]+)`/g)) {
    expect(m[1], `forbidden --flag= syntax in "${m[1]}"`).not.toMatch(/--[a-z][a-z0-9-]*=/i);
  }
  expect(atlas).not.toContain("`bun run sheet --vs`");
  expect(existsSync(join(ROOT, "templates/film/lab/showcase.ts"))).toBe(true);

  const refHelp = spawnSync(
    process.execPath,
    [join(ROOT, "scripts/review/reference.mjs"), "--help"],
    { encoding: "utf8" },
  );
  expect(refHelp.status, refHelp.stderr).toBe(0);
  for (const sub of ["add", "compare", "timecode", "sidebyside", "inspect", "study", "solve"]) {
    expect(refHelp.stdout, `missing reference subcommand ${sub}`).toContain(`reference ${sub}`);
  }

  const assetHelp = spawnSync(process.execPath, [join(ROOT, "scripts/asset.mjs"), "--help"], {
    encoding: "utf8",
  });
  expect(assetHelp.status, assetHelp.stderr).toBe(0);
  for (const sub of ["pick", "preview", "use"]) {
    expect(assetHelp.stdout, `missing asset subcommand ${sub}`).toContain(`asset ${sub}`);
  }

  const findHelp = spawnSync(process.execPath, [join(ROOT, "scripts/find.ts"), "--help"], {
    encoding: "utf8",
  });
  expect(findHelp.status, findHelp.stderr).toBe(0);
  for (const kind of ["object", "sfx", "mocap", "transition", "look", "effect"]) {
    expect(findHelp.stdout, `missing find --kind ${kind}`).toContain(kind);
  }

  const skillLine = atlas.split(/\r?\n/).find((line) => line.includes("../../.claude/skills/"));
  expect(skillLine, "missing repo skills line in CAPABILITIES.md").toBeTruthy();
  const paren = skillLine.match(/\.\.\/\.\.\/\.claude\/skills\/`\s*\(([^)]+)\)/)?.[1] ?? "";
  const listedSkills = [...paren.matchAll(/`([a-z0-9-]+)`/g)]
    .map((m) => m[1])
    .sort((a, b) => a.localeCompare(b));
  const actualSkills = readdirSync(join(ROOT, ".claude/skills"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(ROOT, ".claude/skills", d.name, "SKILL.md")))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));
  expect(listedSkills).toEqual(actualSkills);
  for (const name of listedSkills) {
    const pathRes = spawnSync(process.execPath, [SKILLS_PATH, "path", name], {
      cwd: join(ROOT, "templates/film"),
      encoding: "utf8",
    });
    expect(pathRes.status, pathRes.stderr).toBe(0);
  }
});

test("templates/film/src/scene.ts wires createEnvironment, localClippingEnabled, and dynamic THREE.REVISION in executable code", () => {
  const code = stripTsComments(readFileSync(SCENE_PATH, "utf8"));
  expect(code).toMatch(/createEnvironment\s*\(/);
  expect(code).toMatch(/scene\.environment\s*=/);
  expect(code).toContain("renderer.localClippingEnabled = true");
  expect(code).toContain("THREE.REVISION");
  expect(code).not.toMatch(/three\.js r\d+/);
});

test("shouldCopyTemplateEntry keeps CAPABILITIES.md and sources while skipping generated caches", () => {
  expect(shouldCopyTemplateEntry("/tpl/CAPABILITIES.md")).toBe(true);
  expect(shouldCopyTemplateEntry("/tpl/src/scene.ts")).toBe(true);
  expect(shouldCopyTemplateEntry("/tpl/node_modules")).toBe(false);
  expect(shouldCopyTemplateEntry("/tpl/renders")).toBe(false);
  expect(shouldCopyTemplateEntry("/tpl/__pycache__")).toBe(false);
  expect(shouldCopyTemplateEntry("/tpl/sub/__pycache__")).toBe(false);
});

test("new_film.ts end-to-end copies CAPABILITIES.md, skips caches/renders, and prints CAPABILITIES.md in stdout and --help", () => {
  const helpRes = spawnSync(process.execPath, [NEW_FILM_PATH, "--help"], { encoding: "utf8" });
  expect(helpRes.status, helpRes.stderr).toBe(0);
  expect(helpRes.stdout).toContain("CAPABILITIES.md");

  const root = makeNewFilmFixture();
  try {
    const env = { ...process.env, MC_VAULT_EXTERNAL: join(root, "external") };
    delete env.MC_VAULT_ROOT;
    const res = spawnSync(
      process.execPath,
      [join(root, "scripts/new_film.ts"), "cap-demo", "47950"],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 30_000,
        env,
      },
    );
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain("CAPABILITIES.md");

    const copiedAtlas = join(root, "films/cap-demo/CAPABILITIES.md");
    expect(existsSync(copiedAtlas)).toBe(true);
    expect(readFileSync(copiedAtlas, "utf8")).toBe(readFileSync(ATLAS_PATH, "utf8"));
    expect(existsSync(join(root, "films/cap-demo/node_modules/stale-sentinel.txt"))).toBe(false);
    expect(existsSync(join(root, "films/cap-demo/renders/old-still.jpg"))).toBe(false);
    expect(existsSync(join(root, "films/cap-demo/__pycache__/junk.pyc"))).toBe(false);
    expect(existsSync(join(root, "films/cap-demo/src/__pycache__/nested.pyc"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("bun run help and bun run skills get core surface CAPABILITIES.md in both template and legacy films", () => {
  const tplHelp = spawnSync(process.execPath, [HELP_PATH], {
    cwd: join(ROOT, "templates/film"),
    encoding: "utf8",
  });
  expect(tplHelp.status, tplHelp.stderr).toBe(0);
  expect(tplHelp.stdout).toContain("CAPABILITIES.md");
  expect(tplHelp.stdout).toContain("live-studio");

  const legacyDir = mkdtempSync(join(tmpdir(), "legacy-film-help-"));
  try {
    mkdirSync(join(legacyDir, "src"));
    writeFileSync(join(legacyDir, "src/scene.ts"), "");
    writeFileSync(
      join(legacyDir, "package.json"),
      JSON.stringify({ scripts: { help: "x" }, "live-studio": {} }),
    );
    const legacyHelp = spawnSync(process.execPath, [HELP_PATH], {
      cwd: legacyDir,
      encoding: "utf8",
    });
    expect(legacyHelp.status, legacyHelp.stderr).toBe(0);
    expect(legacyHelp.stdout).toContain("../../templates/film/CAPABILITIES.md");
  } finally {
    rmSync(legacyDir, { recursive: true, force: true });
  }

  const skillCore = spawnSync(process.execPath, [SKILLS_PATH, "get", "core"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  expect(skillCore.status, skillCore.stderr).toBe(0);
  expect(skillCore.stdout).toContain("CAPABILITIES.md");

  const skillFilm = spawnSync(process.execPath, [SKILLS_PATH, "get", "core", "--ref", "film"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  expect(skillFilm.status, skillFilm.stderr).toBe(0);
  expect(skillFilm.stdout).toContain("CAPABILITIES.md");
});
