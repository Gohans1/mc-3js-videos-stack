import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCliInvocation,
  CLI_CATEGORIES,
  CLI_COMMANDS,
  findCliCommand,
  isFieldRequired,
  isFieldVisible,
  resolveSubcommandChain,
  tokenizeWords,
} from "../src/cli-catalog.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const BASE_CONTEXT = {
  activeFilm: "cell-break",
  isDemo: false,
  films: ["cell-break", "sealed-room"],
  runningFilms: [],
  choices: {
    filmDirs: ["films/cell-break", "films/sealed-room"],
  },
  envStatus: {
    ELEVENLABS_API_KEY: true,
    GENVOICE_API_KEY: false,
    GEMINI_API_KEY: true,
    GOOGLE_API_KEY: false,
    OPENCODE_API_KEY: true,
    OPENROUTER_API_KEY: false,
  },
};

test("embedding controls stay offline by default and respect the selected provider's credentials", () => {
  const missing = buildCliInvocation({ commandId: "assets:semantic" }, BASE_CONTEXT);
  expect(missing.validationErrors.some((error) => error.includes("subcommand"))).toBe(true);
  const draft = buildCliInvocation(
    { commandId: "assets:semantic", subcommandPath: ["build"] },
    BASE_CONTEXT,
  );
  expect(draft.meta.cost).toBe("free");
  expect(draft.meta.effect).toBe("read");
  expect(draft.missingEnvGroups).toEqual([]);
  const live = buildCliInvocation(
    { commandId: "assets:semantic", subcommandPath: ["build"], flags: { "--yes": true } },
    BASE_CONTEXT,
  );
  expect(live.meta.cost).toBe("optional-paid");
  expect(live.requiresConfirm).toBe(true);
  expect(live.missingEnvGroups).toEqual([]);
  const router = buildCliInvocation(
    {
      commandId: "assets:semantic",
      subcommandPath: ["build"],
      flags: { "--yes": true, "--provider": "openrouter", "--rpm": "40", "--tpm": "20000" },
    },
    BASE_CONTEXT,
  );
  expect(router.missingEnvGroups).toContainEqual(["OPENROUTER_API_KEY"]);
  expect(router.argvTokens).toEqual(
    expect.arrayContaining(["--provider", "openrouter", "--rpm", "40", "--tpm", "20000"]),
  );
  const cached = buildCliInvocation(
    { commandId: "find", args: { words: "sad goodbye" }, flags: { "--semantic": true } },
    BASE_CONTEXT,
  );
  expect(cached.meta.cost).toBe("free");
  expect(cached.missingEnvGroups).toEqual([]);
});

test("film collaboration/history and embedding subcommands retain their shared CLI options", () => {
  for (const [commandId, subcommandPath, args, flags, expected] of [
    ["history", ["list"], {}, { "--film": "films/cell-break" }, ["--film", "films/cell-break"]],
    [
      "collab",
      ["read"],
      { name: "cam" },
      { "--film": "films/cell-break" },
      ["--film", "films/cell-break"],
    ],
    [
      "assets:semantic",
      ["build"],
      {},
      { "--db": "custom.sqlite", "--dimensions": "1536" },
      ["--db", "custom.sqlite", "--dimensions", "1536"],
    ],
  ]) {
    const spec = buildCliInvocation(
      { commandId, subcommandPath, args, flags, targetFilm: "root" },
      BASE_CONTEXT,
    );
    for (const token of expected) expect(spec.argvTokens).toContain(token);
  }
});

test("rejects options hidden in argument and flag values while preserving negative numbers", () => {
  for (const request of [
    { commandId: "voice:gen", args: { ids: ["--yes"] } },
    { commandId: "find", args: { words: "door --jev" } },
    { commandId: "find", args: { words: ["-h"] } },
    { commandId: "find", args: { words: ["--"] } },
    { commandId: "catalog:search", flags: { "--jev": "--help" } },
    { commandId: "catalog:review", flags: { "--fix": ["mixamo/X", "--yes"] } },
  ]) {
    const spec = buildCliInvocation(request, BASE_CONTEXT);
    expect(spec.validationErrors.some((error) => error.includes("looks like an option"))).toBe(
      true,
    );
  }
  const negative = buildCliInvocation({ commandId: "find", flags: { "-n": "-2" } }, BASE_CONTEXT);
  expect(negative.validationErrors).toEqual([]);
  expect(negative.argvTokens).toEqual(["-n", "-2"]);
});

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

async function parseEarshotSubcommands(args) {
  const proc = Bun.spawn(["earshot", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const [status, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
  expect(status).toBe(0);
  const out = [];
  let inPositional = false;
  for (const rawLine of stdout.split(/\r?\n/)) {
    if (/^positional arguments:/i.test(rawLine)) {
      inPositional = true;
      continue;
    }
    if (/^options:/i.test(rawLine)) break;
    if (!inPositional) continue;
    const m = /^ {4}([a-z][a-z0-9_-]*)(?:\s{2,}|$)/.exec(rawLine);
    if (m) out.push(m[1]);
  }
  return out.toSorted();
}

describe("cli-catalog structure & bidirectional repo drift", () => {
  test("every command has unique id, valid category, unique subcommands, and valid visibleWhen refs", () => {
    const categoryIds = new Set(CLI_CATEGORIES.map((c) => c.id));
    const seenCmdIds = new Set();

    const checkNode = (cmd, subPath, subNodes) => {
      if (!subNodes?.length) return;
      const seenSub = new Set();
      for (const sub of subNodes) {
        expect(seenSub.has(sub.id)).toBe(false);
        seenSub.add(sub.id);
        const nextPath = [...subPath, sub.id];
        const chain = resolveSubcommandChain(cmd, nextPath);
        const visibleFieldNames = new Set([
          ...chain.argsDef.map((f) => f.key),
          ...chain.flagsDef.map((f) => f.key),
          ...chain.envDef.map((f) => f.key),
        ]);
        for (const def of [...chain.argsDef, ...chain.flagsDef, ...chain.envDef]) {
          if (def.visibleWhen) {
            expect(visibleFieldNames.has(def.visibleWhen.field)).toBe(true);
          }
          if (def.requiredWhen) {
            expect(visibleFieldNames.has(def.requiredWhen.field)).toBe(true);
          }
        }
        checkNode(cmd, nextPath, sub.subcommands);
      }
    };

    for (const cmd of CLI_COMMANDS) {
      expect(seenCmdIds.has(cmd.id)).toBe(false);
      seenCmdIds.add(cmd.id);
      expect(categoryIds.has(cmd.category)).toBe(true);

      const fieldNames = new Set([
        ...(cmd.args ?? []).map((f) => f.key),
        ...(cmd.flags ?? []).map((f) => f.key),
        ...(cmd.env ?? []).map((f) => f.key),
      ]);
      for (const def of [...(cmd.args ?? []), ...(cmd.flags ?? []), ...(cmd.env ?? [])]) {
        if (def.visibleWhen) {
          expect(fieldNames.has(def.visibleWhen.field)).toBe(true);
        }
        if (def.requiredWhen) {
          expect(fieldNames.has(def.requiredWhen.field)).toBe(true);
        }
      }
      checkNode(cmd, [], cmd.subcommands);
    }
  });

  test("bidirectional drift: root, film, workspace scripts, files on disk, and earshot subcommands", async () => {
    const rootPkg = readJson(join(REPO_ROOT, "package.json"));
    const templatePkg = readJson(join(REPO_ROOT, "templates/film/package.json"));
    const filmDirs = readdirSync(join(REPO_ROOT, "films"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    const filmScriptMaps = [
      templatePkg.scripts ?? {},
      ...filmDirs
        .map((f) => join(REPO_ROOT, "films", f, "package.json"))
        .filter((p) => existsSync(p))
        .map((p) => readJson(p).scripts ?? {}),
    ];

    const allKnownBunTargets = new Set([
      ...Object.keys(rootPkg.scripts ?? {}),
      ...filmScriptMaps.flatMap((m) => Object.keys(m)),
    ]);

    const catalogBunTargets = new Set(
      CLI_COMMANDS.filter((c) => c.runner === "bun-script").map((c) => c.target),
    );
    for (const command of CLI_COMMANDS)
      if (
        command.runner === "bun-file" &&
        rootPkg.scripts?.[command.id] === `bun ${command.target}`
      )
        catalogBunTargets.add(command.id);
    const catalogPkgScripts = new Set(
      CLI_COMMANDS.filter((c) => c.runner === "package-script").map(
        (c) => `${c.packageDir}:${c.target}`,
      ),
    );

    // 1) Forward check: every runnable script in root, template, and films/* is represented
    for (const [name, scriptCmd] of Object.entries(rootPkg.scripts ?? {})) {
      if (String(scriptCmd).includes("wrong-place.mjs")) continue;
      expect(catalogBunTargets.has(name)).toBe(true);
    }
    for (const scripts of filmScriptMaps) {
      for (const [name, scriptCmd] of Object.entries(scripts)) {
        if (String(scriptCmd).includes("wrong-place.mjs")) continue;
        expect(catalogBunTargets.has(name)).toBe(true);
      }
    }

    // 2) Forward check: every workspace package script in packages/*/package.json is represented
    for (const entry of readdirSync(join(REPO_ROOT, "packages"), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgFile = join(REPO_ROOT, "packages", entry.name, "package.json");
      if (!existsSync(pkgFile)) continue;
      const pkg = readJson(pkgFile);
      const pkgDir = `packages/${entry.name}`;
      for (const scriptName of Object.keys(pkg.scripts ?? {})) {
        expect(catalogPkgScripts.has(`${pkgDir}:${scriptName}`)).toBe(true);
      }
    }

    // 3) Reverse check: every catalog command resolves to an actual target/script/file
    const scriptRunFiles = new Set();
    const recordScriptBody = (scriptCmd, baseDir = "") => {
      for (const rawTok of String(scriptCmd).split(/\s+/)) {
        const tok = rawTok.replace(/^['"]|['"]$/g, "");
        if (!/\.(?:[mc]?[jt]sx?|py|sh)$/.test(tok)) continue;
        if (tok.startsWith("node_modules/live-studio/")) {
          scriptRunFiles.add(tok.replace(/^node_modules\/live-studio\//, "packages/live-studio/"));
        } else if (tok.startsWith("../../")) {
          scriptRunFiles.add(tok.slice(6));
        } else if (baseDir) {
          scriptRunFiles.add(
            relative(REPO_ROOT, resolve(REPO_ROOT, baseDir, tok)).replaceAll("\\", "/"),
          );
        } else {
          scriptRunFiles.add(tok);
        }
      }
    };

    for (const cmd of CLI_COMMANDS) {
      if (cmd.runner === "bun-script") {
        expect(allKnownBunTargets.has(cmd.target)).toBe(true);
        if (rootPkg.scripts?.[cmd.target]) recordScriptBody(rootPkg.scripts[cmd.target]);
        for (const m of filmScriptMaps) {
          if (m[cmd.target] && !String(m[cmd.target]).includes("wrong-place.mjs")) {
            recordScriptBody(m[cmd.target]);
          }
        }
      } else if (cmd.runner === "package-script") {
        expect(cmd.packageDir).toBeTruthy();
        const pkg = readJson(join(REPO_ROOT, cmd.packageDir, "package.json"));
        expect(typeof pkg.scripts?.[cmd.target]).toBe("string");
        recordScriptBody(pkg.scripts[cmd.target], cmd.packageDir);
      } else if (
        cmd.runner === "bun-file" ||
        cmd.runner === "python-file" ||
        cmd.runner === "bash-file"
      ) {
        expect(existsSync(join(REPO_ROOT, cmd.target))).toBe(true);
        scriptRunFiles.add(cmd.target);
      }
    }
    expect(
      CLI_COMMANDS.some(
        (c) => c.runner === "python-file" && c.target === "scripts/render_earshot_bank.py",
      ),
    ).toBe(true);
    expect(findCliCommand("studio:init")?.args?.[0]?.choiceSource).toBe("filmDirs");

    // 4) Bidirectional disk entrypoint coverage across scripts/ and packages/
    const INTERNAL_WORKER_OR_HELPER_FILES = new Map([
      ["scripts/evals/load/compare.mjs", "developer helper comparing recorded performance runs"],
      ["scripts/evals/load/frame.mjs", "developer frame-measurement probe for load evaluations"],
      ["scripts/studio_tell.py", "shared Studio activity reporter library imported by Python CLIs"],
      ["packages/clip-catalog/jev.py", "stdin JSON helper library/IPC wrapper for Jev"],
      ["packages/live-studio/src/cli.mjs", "shared CLI argument parser imported by entrypoints"],
      [
        "packages/live-studio/wrong-place.mjs",
        "wrong-cwd guard invoked by package.json wrapper scripts",
      ],
      ["scripts/review/stale.py", "shared staleness helper module wrapping src/stale.mjs"],
      ["scripts/seconds.py", "shared heard-second parsing library imported by Python CLIs"],
      ["scripts/sound/beats.py", "stdin JSON beat-detection worker spawned by Live Studio audio"],
      [
        "scripts/sound/process.py",
        "stdin JSON FFmpeg/Rubberband worker spawned by Live Studio audio",
      ],

      [
        "scripts/voice/words.py",
        "internal WHISPERX_PYTHON GPU alignment worker spawned by scripts/voice/align.ts",
      ],
    ]);
    const ignoredDirs = new Set([
      "node_modules",
      "demo",
      ".vite",
      "test",
      "renders",
      "runs",
      ".git",
      "dist",
    ]);
    const discoveredEntrypoints = [];
    const walkEntrypoints = (dirRel) => {
      const absDir = join(REPO_ROOT, dirRel);
      if (!existsSync(absDir)) return;
      for (const entry of readdirSync(absDir, { withFileTypes: true })) {
        if (ignoredDirs.has(entry.name)) continue;
        const nextRel = `${dirRel}/${entry.name}`;
        if (entry.isDirectory()) {
          walkEntrypoints(nextRel);
          continue;
        }
        if (entry.name.endsWith(".d.ts") || /^test_.*\.py$/.test(entry.name)) continue;
        if (!/\.(?:ts|tsx|mjs|js|py|sh)$/.test(entry.name)) continue;
        const txt = readFileSync(join(REPO_ROOT, nextRel), "utf8");
        const isJsEntry =
          /\.(?:ts|tsx|mjs|js)$/.test(entry.name) &&
          /\bimport\.meta\.main\b|\b(?:const|let|var)\s+isMain\b|\bcliArgs\s*\(|\bprocess\.argv\b/.test(
            txt,
          );
        // Every .py under scripts/ and packages/ must be either catalogued or declared in INTERNAL_WORKER_OR_HELPER_FILES.
        const isPyEntry = entry.name.endsWith(".py");
        const isShEntry = entry.name.endsWith(".sh");
        if (isJsEntry || isPyEntry || isShEntry) {
          discoveredEntrypoints.push(nextRel);
        }
      }
    };
    walkEntrypoints("scripts");
    walkEntrypoints("packages");

    const uncovered = discoveredEntrypoints.filter(
      (f) => !scriptRunFiles.has(f) && !INTERNAL_WORKER_OR_HELPER_FILES.has(f),
    );
    expect(uncovered).toEqual([]);
    for (const [internalFile] of INTERNAL_WORKER_OR_HELPER_FILES) {
      expect(existsSync(join(REPO_ROOT, internalFile))).toBe(true);
      expect(
        CLI_COMMANDS.some(
          (c) =>
            (c.runner === "bun-file" || c.runner === "python-file" || c.runner === "bash-file") &&
            c.target === internalFile,
        ),
      ).toBe(false);
    }

    // 5) Live earshot -h, earshot sfx -h, earshot kit -h bidirectional check (warm Python once before subcommands)
    const earshotCmd = findCliCommand("earshot");
    expect(earshotCmd).toBeDefined();
    const sfxNode = earshotCmd.subcommands?.find((s) => s.id === "sfx");
    const kitNode = earshotCmd.subcommands?.find((s) => s.id === "kit");
    expect(sfxNode).toBeDefined();
    expect(kitNode).toBeDefined();

    const liveTop = await parseEarshotSubcommands(["-h"]);
    const [liveSfx, liveKit] = await Promise.all([
      parseEarshotSubcommands(["sfx", "-h"]),
      parseEarshotSubcommands(["kit", "-h"]),
    ]);
    const catalogTop = (earshotCmd.subcommands ?? []).map((s) => s.id).toSorted();
    expect(catalogTop).toEqual(liveTop);
    expect((sfxNode.subcommands ?? []).map((s) => s.id).toSorted()).toEqual(liveSfx);
    expect((kitNode.subcommands ?? []).map((s) => s.id).toSorted()).toEqual(liveKit);
  }, 60_000);
});

describe("cli-catalog resolver rules", () => {
  test("tokenizeWords handles quoted substrings and whitespace", () => {
    expect(tokenizeWords("hello \"creaky wooden door\" 'soft thud'  plain")).toEqual([
      "hello",
      "creaky wooden door",
      "soft thud",
      "plain",
    ]);
  });

  test("emits separate flag/value tokens (never --flag=value) and respects optionalValue", () => {
    const atSpec = buildCliInvocation(
      {
        commandId: "at",
        args: { secondOrNote: "#52" },
        flags: { "--json": true },
      },
      BASE_CONTEXT,
    );
    expect(atSpec.validationErrors).toEqual([]);
    expect(atSpec.argvTokens).toEqual(["#52", "--json"]);

    const notesIdSpec = buildCliInvocation(
      {
        commandId: "notes",
        args: { ids: "3 mw6hr1fm" },
        flags: { "--sort": "newest", "--done": true },
      },
      BASE_CONTEXT,
    );
    expect(notesIdSpec.validationErrors).toEqual([]);
    expect(notesIdSpec.argvTokens).toEqual(["3", "mw6hr1fm", "--sort", "newest", "--done"]);

    const notesShotSpec = buildCliInvocation(
      {
        commandId: "notes",
        flags: { "--shot": "0", "--limit": "10", "--sort": "newest", "--done": true },
      },
      BASE_CONTEXT,
    );
    expect(notesShotSpec.validationErrors).toEqual([]);
    expect(notesShotSpec.argvTokens).toEqual([
      "--shot",
      "0",
      "--sort",
      "newest",
      "--limit",
      "10",
      "--done",
    ]);

    const bareSource = buildCliInvocation(
      { commandId: "find", flags: { "--source": true } },
      BASE_CONTEXT,
    );
    expect(bareSource.argvTokens).toEqual(["--source"]);

    const valSource = buildCliInvocation(
      { commandId: "find", flags: { "--source": "mixkit", "-n": "15" } },
      BASE_CONTEXT,
    );
    expect(valSource.argvTokens).toEqual(["--source", "mixkit", "-n", "15"]);

    const deliverBareYt = buildCliInvocation(
      { commandId: "deliver", flags: { "--youtube": true } },
      BASE_CONTEXT,
    );
    expect(deliverBareYt.argvTokens).toEqual(["--youtube"]);
    expect(deliverBareYt.meta.effect).toBe("write");
    expect(deliverBareYt.meta.speed).toBe("long");

    const deliverSpanYt = buildCliInvocation(
      { commandId: "deliver", flags: { "--youtube": "9-15" } },
      BASE_CONTEXT,
    );
    expect(deliverSpanYt.argvTokens).toEqual(["--youtube", "9-15"]);
  });

  test("enforces exclusiveGroup conflicts across env and flags", () => {
    const renderConflict = buildCliInvocation(
      {
        commandId: "render",
        args: { target: "clip" },
        env: { SPAN: "0,4", CHUNKS: "0,1" },
      },
      BASE_CONTEXT,
    );
    expect(renderConflict.exclusiveConflicts.length).toBeGreaterThan(0);
    expect(renderConflict.validationErrors.length).toBeGreaterThan(0);

    // SPAN is clip-only (render.mjs exits 2 on render all when SPAN is set)
    const renderAllSpan = buildCliInvocation(
      {
        commandId: "render",
        args: { target: "all" },
        env: { SPAN: "0,4" },
      },
      BASE_CONTEXT,
    );
    expect(renderAllSpan.envEntries).toEqual([]);
    const spanEnvDef = renderAllSpan.envDef.find((e) => e.key === "SPAN");
    expect(isFieldVisible(spanEnvDef?.visibleWhen, { target: "all" })).toBe(false);
    expect(isFieldVisible(spanEnvDef?.visibleWhen, { target: "clip" })).toBe(true);

    const findConflict = buildCliInvocation(
      {
        commandId: "find",
        flags: { "--star": "kick", "--unstar": "snare" },
      },
      BASE_CONTEXT,
    );
    expect(findConflict.exclusiveConflicts.length).toBeGreaterThan(0);
    expect(findConflict.validationErrors.length).toBeGreaterThan(0);
  });

  test("evaluates visibleWhen (unsetOrStartsWith, in) dynamically", () => {
    const findCmd = findCliCommand("find");
    const fromFlag = findCmd.flags.find((f) => f.key === "--from");
    expect(isFieldVisible(fromFlag.visibleWhen, {})).toBe(true);
    expect(isFieldVisible(fromFlag.visibleWhen, { "--kind": "mocap" })).toBe(true);
    expect(isFieldVisible(fromFlag.visibleWhen, { "--kind": "mocap/hands" })).toBe(true);
    expect(isFieldVisible(fromFlag.visibleWhen, { "--kind": "sfx" })).toBe(false);

    // Hidden flags should also not emit argv tokens even if stale state was set
    const findSfxWithStaleFrom = buildCliInvocation(
      { commandId: "find", flags: { "--kind": "sfx", "--from": "stand" } },
      BASE_CONTEXT,
    );
    expect(findSfxWithStaleFrom.argvTokens).toEqual(["--kind", "sfx"]);

    const renderCmd = findCliCommand("render");
    const spanEnv = renderCmd.env.find((e) => e.key === "SPAN");
    const resEnv = renderCmd.env.find((e) => e.key === "RES");
    expect(isFieldVisible(spanEnv.visibleWhen, { target: "clip" })).toBe(true);
    expect(isFieldVisible(spanEnv.visibleWhen, { target: "stills" })).toBe(false);
    expect(isFieldVisible(resEnv.visibleWhen, { target: "final" })).toBe(true);
    expect(isFieldVisible(resEnv.visibleWhen, { target: "stills" })).toBe(false);
  });

  test("enforces subcommandRequired and helpMode: none", () => {
    expect(
      buildCliInvocation({ commandId: "earshot" }, BASE_CONTEXT).validationErrors.length,
    ).toBeGreaterThan(0);
    expect(
      buildCliInvocation({ commandId: "earshot", subcommandPath: ["sfx"] }, BASE_CONTEXT)
        .validationErrors.length,
    ).toBeGreaterThan(0);
    expect(
      buildCliInvocation({ commandId: "earshot", subcommandPath: ["sfx", "list"] }, BASE_CONTEXT)
        .validationErrors,
    ).toEqual([]);

    expect(
      buildCliInvocation({ commandId: "note" }, BASE_CONTEXT).validationErrors.length,
    ).toBeGreaterThan(0);
    expect(buildCliInvocation({ commandId: "skills" }, BASE_CONTEXT).validationErrors).toEqual([]);
    expect(buildCliInvocation({ commandId: "sfx:get" }, BASE_CONTEXT).validationErrors).toEqual([]);

    const noHelp = buildCliInvocation({ commandId: "mc:slim-jar", mode: "help" }, BASE_CONTEXT);
    expect(noHelp.meta.helpMode).toBe("none");
    expect(noHelp.validationErrors.length).toBeGreaterThan(0);
  });

  test("evaluates dynamic confirmation gates and execution guards", () => {
    const voiceFree = buildCliInvocation({ commandId: "voice:gen" }, BASE_CONTEXT);
    expect(voiceFree.requiresConfirm).toBe(false);
    expect(voiceFree.meta.cost).toBe("optional-paid");

    const voicePaid = buildCliInvocation(
      { commandId: "voice:gen", flags: { "--yes": true } },
      BASE_CONTEXT,
    );
    expect(voicePaid.requiresConfirm).toBe(true);
    expect(voicePaid.meta.cost).toBe("paid");

    const voiceDry = buildCliInvocation(
      { commandId: "voice:gen", flags: { "--yes": true, "--dry-run": true } },
      BASE_CONTEXT,
    );
    expect(voiceDry.requiresConfirm).toBe(false);
    expect(voiceDry.meta.cost).toBe("free");

    const llmPreview = buildCliInvocation(
      { commandId: "earshot", subcommandPath: ["llm"], args: { file: "mix.wav" } },
      BASE_CONTEXT,
    );
    expect(llmPreview.validationErrors).toEqual(["Missing required option: --yes-upload"]);
    expect(llmPreview.requiresConfirm).toBe(false);

    const llmUpload = buildCliInvocation(
      {
        commandId: "earshot",
        subcommandPath: ["llm"],
        args: { file: "mix.wav" },
        flags: { "--yes-upload": true },
      },
      BASE_CONTEXT,
    );
    expect(llmUpload.validationErrors).toEqual([]);
    expect(llmUpload.requiresConfirm).toBe(true);

    // Subcommand-scoped computeEffectiveMeta checks
    const evalWords = buildCliInvocation(
      { commandId: "eval:find", flags: { "--mode": "words" } },
      BASE_CONTEXT,
    );
    expect(evalWords.meta.cost).toBe("free");
    const evalJev = buildCliInvocation(
      { commandId: "eval:find", flags: { "--mode": "jev" } },
      BASE_CONTEXT,
    );
    expect(evalJev.meta.cost).toBe("paid");

    const doctorDefault = buildCliInvocation(
      { commandId: "earshot", subcommandPath: ["doctor"] },
      BASE_CONTEXT,
    );
    expect(doctorDefault.meta.effect).toBe("read");
    const doctorFetch = buildCliInvocation(
      { commandId: "earshot", subcommandPath: ["doctor"], flags: { "--fetch": true } },
      BASE_CONTEXT,
    );
    expect(doctorFetch.meta.effect).toBe("install");
    expect(doctorFetch.meta.speed).toBe("long");

    // Non-mcp earshot subcommand shouldn't treat --tools as read override
    const mcpGuard = buildCliInvocation(
      { commandId: "earshot", subcommandPath: ["mcp"] },
      BASE_CONTEXT,
    );
    expect(mcpGuard.meta.effect).toBe("daemon");

    expect(
      buildCliInvocation({ commandId: "render", args: { target: "final" } }, BASE_CONTEXT)
        .requiresConfirm,
    ).toBe(true);
    expect(
      buildCliInvocation({ commandId: "render", args: { target: "stills" } }, BASE_CONTEXT)
        .requiresConfirm,
    ).toBe(false);

    expect(
      buildCliInvocation(
        { commandId: "studio:init", args: { project: "films/cell-break" } },
        BASE_CONTEXT,
      ).requiresConfirm,
    ).toBe(true);
    expect(
      buildCliInvocation(
        {
          commandId: "studio:init",
          args: { project: "films/cell-break" },
          flags: { "--dry": true },
        },
        BASE_CONTEXT,
      ).requiresConfirm,
    ).toBe(false);

    // Guards
    expect(
      buildCliInvocation({ commandId: "earshot", subcommandPath: ["mcp"] }, BASE_CONTEXT)
        .guardReason,
    ).toBeTruthy();
    const mcpTools = buildCliInvocation(
      { commandId: "earshot", subcommandPath: ["mcp"], flags: { "--tools": true } },
      BASE_CONTEXT,
    );
    expect(mcpTools.guardReason).toBeNull();
    expect(mcpTools.meta.effect).toBe("read");

    expect(
      buildCliInvocation(
        { commandId: "eval:load", flags: { "--film": "cell-break" } },
        { ...BASE_CONTEXT, runningFilms: ["cell-break"] },
      ).guardReason,
    ).toBeTruthy();
    expect(
      buildCliInvocation(
        { commandId: "eval:load", flags: { "--film": "cell-break" } },
        BASE_CONTEXT,
      ).guardReason,
    ).toBeNull();

    expect(buildCliInvocation({ commandId: "studio" }, BASE_CONTEXT).guardReason).toBeTruthy();
    expect(
      buildCliInvocation({ commandId: "studio", mode: "help" }, BASE_CONTEXT).guardReason,
    ).toBeNull();
  });

  test("enforces render AT requiredWhen poster, captions env visibility, eval:load default guard, catalog:review --page, film-relative bun-file displayCommand, and partial context", () => {
    const posterNoAt = buildCliInvocation(
      { commandId: "render", args: { target: "poster" } },
      BASE_CONTEXT,
    );
    expect(posterNoAt.validationErrors).toContain("Missing required env: AT");

    const posterWithAt = buildCliInvocation(
      { commandId: "render", args: { target: "poster" }, env: { AT: "12" } },
      BASE_CONTEXT,
    );
    expect(posterWithAt.validationErrors).toEqual([]);

    const captions = buildCliInvocation(
      { commandId: "render", args: { target: "captions" } },
      BASE_CONTEXT,
    );
    const atDef = captions.envDef.find((d) => d.key === "AT");
    expect(isFieldRequired(atDef, { target: "poster" })).toBe(true);
    expect(isFieldRequired(atDef, { target: "stills" })).toBe(false);
    expect(isFieldRequired({ required: true }, {})).toBe(true);
    expect(isFieldRequired({}, {})).toBe(false);
    const entryDef = captions.envDef.find((d) => d.key === "ENTRY");
    const labViewDef = captions.envDef.find((d) => d.key === "LAB_VIEW");
    expect(entryDef?.visibleWhen).toBeDefined();
    expect(labViewDef?.visibleWhen).toBeDefined();
    expect(isFieldVisible(entryDef?.visibleWhen, { target: "captions" })).toBe(false);
    expect(isFieldVisible(labViewDef?.visibleWhen, { target: "captions" })).toBe(false);
    for (const target of ["stills", "clip", "poster", "all", "final"]) {
      expect(isFieldVisible(entryDef?.visibleWhen, { target })).toBe(true);
      expect(isFieldVisible(labViewDef?.visibleWhen, { target })).toBe(true);
    }

    // Studio checks the current film before launching a second Studio.
    expect(
      buildCliInvocation(
        { commandId: "eval:load" },
        { ...BASE_CONTEXT, activeFilm: "sealed-room", runningFilms: ["sealed-room"] },
      ).guardReason,
    ).toBeTruthy();
    expect(
      buildCliInvocation(
        { commandId: "eval:load" },
        { ...BASE_CONTEXT, activeFilm: "sealed-room", runningFilms: ["cell-break"] },
      ).guardReason,
    ).toBeNull();

    const catReview = findCliCommand("catalog:review");
    const pageFlag = catReview?.flags?.find((f) => f.key === "--page");
    expect(pageFlag?.type).toBe("number");
    expect(pageFlag?.tier).toBe("advanced");
    expect(
      buildCliInvocation({ commandId: "catalog:review", flags: { "--page": 2 } }, BASE_CONTEXT)
        .argvTokens,
    ).toEqual(["--page", "2"]);

    expect(buildCliInvocation({ commandId: "timeline:fmt" }, BASE_CONTEXT).displayCommand).toBe(
      "bun ../../scripts/timeline_fmt.ts",
    );

    expect(() => buildCliInvocation({ commandId: "help" }, {})).not.toThrow();
  });

  test("handles multi/csv visibleWhen, catalog:review --page guard, optionalValue copy, sheet requiredWhen/visibleWhen, deliver --youtube bare meta, and lint speeds", () => {
    const findCmd = findCliCommand("find");
    const fromFlag = findCmd?.flags?.find((f) => f.key === "--from");
    expect(isFieldVisible(fromFlag?.visibleWhen, { "--kind": ["sfx", "mocap"] })).toBe(true);
    expect(isFieldVisible(fromFlag?.visibleWhen, { "--kind": "sfx,mocap" })).toBe(true);
    expect(isFieldVisible(fromFlag?.visibleWhen, { "--kind": ["sfx", "bgm"] })).toBe(false);

    const findMulti = buildCliInvocation(
      { commandId: "find", flags: { "--kind": ["sfx", "mocap"], "--from": "stand" } },
      BASE_CONTEXT,
    );
    expect(findMulti.argvTokens).toEqual(["--kind", "sfx,mocap", "--from", "stand"]);

    // catalog:review --page requires piped stdin -> guarded on execute, allowed on help
    const catPageExec = buildCliInvocation(
      { commandId: "catalog:review", flags: { "--page": 0 } },
      BASE_CONTEXT,
    );
    expect(catPageExec.guardReason).toContain("stdin");
    expect(
      buildCliInvocation(
        { commandId: "catalog:review", mode: "help", flags: { "--page": 0 } },
        BASE_CONTEXT,
      ).guardReason,
    ).toBeNull();
    expect(
      buildCliInvocation(
        { commandId: "catalog:review", flags: { "--missing": "style" } },
        BASE_CONTEXT,
      ).guardReason,
    ).toBeNull();

    // Per-flag optionalValue bareLabel & bareHint metadata
    for (const k of [
      "--kind",
      "--source",
      "--dur",
      "--origin",
      "--edition",
      "--license",
      "--fav",
    ]) {
      const f = findCmd?.flags?.find((x) => x.key === k);
      expect(f?.bareLabel).toBeTruthy();
      expect(f?.bareHint).toBeTruthy();
    }
    const deliverCmd = findCliCommand("deliver");
    const ytFlag = deliverCmd?.flags?.find((x) => x.key === "--youtube");
    expect(ytFlag?.bareLabel).toContain("full-film AV1");
    expect(ytFlag?.bareHint).toContain("full-film AV1");

    const deliverBare = buildCliInvocation(
      { commandId: "deliver", flags: { "--youtube": "" } },
      BASE_CONTEXT,
    );
    expect(deliverBare.argvTokens).toEqual(["--youtube"]);
    expect(deliverBare.meta.effect).toBe("write");
    expect(deliverBare.meta.speed).toBe("long");

    const forgeSub = findCliCommand("earshot")?.subcommands?.find((s) => s.id === "forge");
    expect(forgeSub?.flags?.find((x) => x.key === "--render")?.bareLabel).toBeTruthy();
    expect(forgeSub?.flags?.find((x) => x.key === "--seeds")?.bareHint).toBeTruthy();

    // sheet conditional rules matching scripts/review/sheet.py
    expect(buildCliInvocation({ commandId: "sheet" }, BASE_CONTEXT).validationErrors).toEqual([]);
    const sheetMissingTarget = buildCliInvocation(
      { commandId: "sheet", args: { video: "renders/draft_video.mp4" } },
      BASE_CONTEXT,
    );
    expect(sheetMissingTarget.validationErrors).toContain(
      "Missing required argument: Times / shots / cut",
    );

    const sheetMissingCut = buildCliInvocation(
      { commandId: "sheet", args: { video: "renders/draft_video.mp4", target: "cut" } },
      BASE_CONTEXT,
    );
    expect(sheetMissingCut.validationErrors).toContain(
      "Missing required argument: Cut # (with 'cut')",
    );

    const sheetCutOk = buildCliInvocation(
      {
        commandId: "sheet",
        args: { video: "renders/draft_video.mp4", target: "cut", cutIndex: 4 },
      },
      BASE_CONTEXT,
    );
    expect(sheetCutOk.validationErrors).toEqual([]);
    expect(sheetCutOk.argvTokens).toEqual(["renders/draft_video.mp4", "cut", "4"]);

    const sheetShots = buildCliInvocation(
      { commandId: "sheet", args: { video: "renders/draft_video.mp4", target: "shots" } },
      BASE_CONTEXT,
    );
    const cutArgDef = sheetShots.argsDef.find((d) => d.key === "cutIndex");
    expect(isFieldVisible(cutArgDef?.visibleWhen, { target: "shots" })).toBe(false);
    expect(isFieldRequired(cutArgDef, { target: "cut" })).toBe(true);
    expect(isFieldRequired(cutArgDef, { target: "shots" })).toBe(false);

    // lint and live-studio:lint take >1s
    expect(findCliCommand("lint")?.meta.speed).toBe("short");
    expect(findCliCommand("live-studio:lint")?.meta.speed).toBe("short");
  });

  test("rejects targetFilm 'root' on film-only commands, supports mc:slim-jar dual cwdModes, find --license free text, and clears voice:gen keys on preview/dry-run", () => {
    const atRoot = buildCliInvocation(
      { commandId: "at", args: { secondOrNote: "12" }, targetFilm: "root" },
      BASE_CONTEXT,
    );
    expect(atRoot.validationErrors).toContain(
      "at runs inside a film workspace; targetFilm cannot be 'root'.",
    );

    const findRoot = buildCliInvocation(
      { commandId: "find", args: { words: "door" }, targetFilm: "root" },
      BASE_CONTEXT,
    );
    expect(findRoot.validationErrors).toEqual([]);
    expect(findRoot.cwdMode).toBe("root");

    const slimCmd = findCliCommand("mc:slim-jar");
    expect(slimCmd?.cwdModes).toEqual(["film", "root"]);
    expect(buildCliInvocation({ commandId: "mc:slim-jar" }, BASE_CONTEXT).displayCommand).toBe(
      "bun ../../scripts/mc/slim_jar.mjs",
    );
    expect(
      buildCliInvocation({ commandId: "mc:slim-jar", targetFilm: "root" }, BASE_CONTEXT)
        .displayCommand,
    ).toBe("bun scripts/mc/slim_jar.mjs");

    const licenseFlag = findCliCommand("find")?.flags?.find((f) => f.key === "--license");
    expect(licenseFlag?.type).toBe("string");
    expect(licenseFlag?.options).toContain("free");
    expect(
      buildCliInvocation({ commandId: "find", flags: { "--license": "cc0" } }, BASE_CONTEXT)
        .argvTokens,
    ).toEqual(["--license", "cc0"]);

    const noVoiceKeysCtx = {
      ...BASE_CONTEXT,
      envStatus: { ...BASE_CONTEXT.envStatus, ELEVENLABS_API_KEY: false, GENVOICE_API_KEY: false },
    };
    expect(buildCliInvocation({ commandId: "voice:gen" }, noVoiceKeysCtx).missingEnvGroups).toEqual(
      [],
    );
    expect(
      buildCliInvocation(
        { commandId: "voice:gen", flags: { "--yes": true, "--dry-run": true } },
        noVoiceKeysCtx,
      ).missingEnvGroups,
    ).toEqual([]);
    expect(
      buildCliInvocation({ commandId: "voice:gen", flags: { "--yes": true } }, noVoiceKeysCtx)
        .missingEnvGroups,
    ).toEqual([["ELEVENLABS_API_KEY", "GENVOICE_API_KEY"]]);
  });

  test("covers voice:genvoice, sound:mc-peaks, studio:stale, bash-file catalog scripts, and legacy python counterparts", () => {
    // voice:genvoice requires subcommand, has helpMode: "none", and gates tts/sts behind always confirm + paid
    const gvNoSub = buildCliInvocation({ commandId: "voice:genvoice" }, BASE_CONTEXT);
    expect(gvNoSub.validationErrors.length).toBeGreaterThan(0);
    expect(
      buildCliInvocation({ commandId: "voice:genvoice", mode: "help" }, BASE_CONTEXT)
        .validationErrors.length,
    ).toBeGreaterThan(0);

    const gvVoices = buildCliInvocation(
      { commandId: "voice:genvoice", subcommandPath: ["voices"], args: { query: "calm" } },
      BASE_CONTEXT,
    );
    expect(gvVoices.validationErrors).toEqual([]);
    expect(gvVoices.meta.effect).toBe("read");
    expect(gvVoices.meta.cost).toBe("free");
    expect(gvVoices.requiresConfirm).toBe(false);
    expect(gvVoices.displayCommand).toBe("bun scripts/voice/genvoice.ts voices calm");

    const gvTtsMissing = buildCliInvocation(
      { commandId: "voice:genvoice", subcommandPath: ["tts"], args: { voiceId: "v1" } },
      BASE_CONTEXT,
    );
    expect(gvTtsMissing.validationErrors).toContain("Missing required argument: Text File Path");
    expect(gvTtsMissing.validationErrors).toContain("Missing required argument: Output MP3 Path");

    const gvTts = buildCliInvocation(
      {
        commandId: "voice:genvoice",
        subcommandPath: ["tts"],
        args: {
          voiceId: "v1",
          textFile: "line.txt",
          out: "out.mp3",
          model: "eleven_v4",
          speed: 1.1,
        },
      },
      BASE_CONTEXT,
    );
    expect(gvTts.validationErrors).toEqual([]);
    expect(gvTts.meta.cost).toBe("paid");
    expect(gvTts.meta.effect).toBe("write");
    expect(gvTts.requiresConfirm).toBe(true);
    expect(gvTts.argvTokens).toEqual(["tts", "v1", "line.txt", "out.mp3", "eleven_v4", "1.1"]);

    const gvSts = buildCliInvocation(
      {
        commandId: "voice:genvoice",
        subcommandPath: ["sts"],
        args: { voiceId: "v1", audioPath: "guide.wav", out: "out.mp3" },
      },
      BASE_CONTEXT,
    );
    expect(gvSts.validationErrors).toEqual([]);
    expect(gvSts.meta.cost).toBe("paid");
    expect(gvSts.requiresConfirm).toBe(true);

    // sound:mc-peaks requires vaultDir
    expect(
      buildCliInvocation({ commandId: "sound:mc-peaks" }, BASE_CONTEXT).validationErrors,
    ).toContain("Missing required argument: Vault Directory");
    expect(
      buildCliInvocation(
        { commandId: "sound:mc-peaks", args: { vaultDir: "vault/sound" } },
        BASE_CONTEXT,
      ).displayCommand,
    ).toBe("python scripts/compute_mc_peaks.py vault/sound");

    // studio:stale + legacy python counterparts + bash-file film-relative displayCommand
    expect(
      buildCliInvocation(
        { commandId: "studio:stale", args: { video: "renders/final.mp4" } },
        BASE_CONTEXT,
      ).displayCommand,
    ).toBe("bun ../../packages/live-studio/src/stale.mjs renders/final.mp4");
    expect(
      buildCliInvocation(
        { commandId: "catalog:tag-sh", args: { libs: "mixamo ual1" } },
        BASE_CONTEXT,
      ).displayCommand,
    ).toBe("bash ../../packages/clip-catalog/catalog.sh mixamo ual1");
    expect(
      buildCliInvocation({ commandId: "catalog:review-sh" }, BASE_CONTEXT).displayCommand,
    ).toBe("bash ../../packages/clip-catalog/catalog_review.sh");
    expect(buildCliInvocation({ commandId: "catalog:sweep-sh" }, BASE_CONTEXT).displayCommand).toBe(
      "bash ../../packages/clip-catalog/sweep.sh",
    );
    expect(buildCliInvocation({ commandId: "mc:pick-py" }, BASE_CONTEXT).displayCommand).toBe(
      "python ../../packages/mc-assets/pick.py",
    );
    expect(buildCliInvocation({ commandId: "timeline:fmt-py" }, BASE_CONTEXT).displayCommand).toBe(
      "python ../../scripts/timeline_fmt.py",
    );
  });

  test("rejects later positional arguments when an earlier optional positional arg is blank", () => {
    const gvSkipModel = buildCliInvocation(
      {
        commandId: "voice:genvoice",
        subcommandPath: ["tts"],
        args: { voiceId: "v1", textFile: "line.txt", out: "out.mp3", speed: 1.1 },
      },
      BASE_CONTEXT,
    );
    expect(gvSkipModel.validationErrors).toContain("Fill Model ID before setting Speed.");

    const gvSkipSpeed = buildCliInvocation(
      {
        commandId: "voice:genvoice",
        subcommandPath: ["tts"],
        args: {
          voiceId: "v1",
          textFile: "line.txt",
          out: "out.mp3",
          model: "eleven_v4",
          stability: 0.5,
        },
      },
      BASE_CONTEXT,
    );
    expect(gvSkipSpeed.validationErrors).toContain("Fill Speed before setting Stability.");

    const sheetSkipVideo = buildCliInvocation(
      {
        commandId: "sheet",
        args: { target: "10,20,30" },
      },
      BASE_CONTEXT,
    );
    expect(sheetSkipVideo.validationErrors).toContain(
      "Fill Video (Omit = Still PNGs) before setting Times / shots / cut.",
    );
  });

  test("gates API-key envAnyOf dynamically on find, catalog:search, and eval:find", () => {
    const noKeysContext = {
      ...BASE_CONTEXT,
      envStatus: {
        ELEVENLABS_API_KEY: false,
        GENVOICE_API_KEY: false,
        GEMINI_API_KEY: false,
        GOOGLE_API_KEY: false,
        OPENCODE_API_KEY: false,
        OPENROUTER_API_KEY: false,
      },
    };

    const offlineFind = buildCliInvocation({ commandId: "find" }, noKeysContext);
    expect(offlineFind.meta.envAnyOf).toBeUndefined();
    expect(offlineFind.missingEnvGroups).toEqual([]);

    const jevFind = buildCliInvocation(
      { commandId: "find", flags: { "--jev": true } },
      noKeysContext,
    );
    expect(jevFind.meta.envAnyOf).toEqual([["OPENCODE_API_KEY", "OPENROUTER_API_KEY"]]);
    expect(jevFind.missingEnvGroups).toEqual([["OPENCODE_API_KEY", "OPENROUTER_API_KEY"]]);

    const offlineCat = buildCliInvocation({ commandId: "catalog:search" }, noKeysContext);
    expect(offlineCat.meta.envAnyOf).toBeUndefined();
    expect(offlineCat.missingEnvGroups).toEqual([]);

    const jevCat = buildCliInvocation(
      { commandId: "catalog:search", flags: { "--jev": "he searches the floor" } },
      noKeysContext,
    );
    expect(jevCat.meta.cost).toBe("paid");
    expect(jevCat.missingEnvGroups).toEqual([["OPENCODE_API_KEY", "OPENROUTER_API_KEY"]]);

    const falseCat = buildCliInvocation(
      { commandId: "catalog:search", flags: { "--jev": "false" } },
      noKeysContext,
    );
    expect(falseCat.meta.envAnyOf).toBeUndefined();
    expect(falseCat.missingEnvGroups).toEqual([]);

    const evalDefault = buildCliInvocation({ commandId: "eval:find" }, noKeysContext);
    expect(evalDefault.meta.cost).toBe("paid");
    expect(evalDefault.missingEnvGroups).toEqual([["OPENCODE_API_KEY", "OPENROUTER_API_KEY"]]);

    const evalWords = buildCliInvocation(
      { commandId: "eval:find", flags: { "--mode": "words" } },
      noKeysContext,
    );
    expect(evalWords.meta.cost).toBe("free");
    expect(evalWords.missingEnvGroups).toEqual([]);
  });

  test("validates numeric fields, ignores 'false' boolean strings, and includes catalog:sheet-clip", () => {
    const badNum = buildCliInvocation({ commandId: "find", flags: { "-n": "abc" } }, BASE_CONTEXT);
    expect(badNum.validationErrors).toContain('Invalid number for Limit (-n): "abc"');

    const okNum = buildCliInvocation({ commandId: "find", flags: { "-n": "12" } }, BASE_CONTEXT);
    expect(okNum.validationErrors).toEqual([]);
    expect(okNum.argvTokens).toEqual(["-n", "12"]);

    const falseBool = buildCliInvocation(
      { commandId: "find", flags: { "--jev": "false" } },
      BASE_CONTEXT,
    );
    expect(falseBool.argvTokens).toEqual([]);
    expect(falseBool.meta.cost).toBe("optional-paid");

    const sheetClip = buildCliInvocation({ commandId: "catalog:sheet-clip" }, BASE_CONTEXT);
    expect(sheetClip.validationErrors).toEqual([]);
    expect(sheetClip.cwdMode).toBe("film");
    expect(sheetClip.meta.helpMode).toBe("none");
    expect(sheetClip.displayCommand).toBe("python ../../packages/clip-catalog/sheet_clip.py");
  });

  test("enforces ELEVENLABS_API_KEY for genvoice sts, dry-run/read meta, and arg defaults", () => {
    const genvoiceOnlyCtx = {
      ...BASE_CONTEXT,
      envStatus: {
        ...BASE_CONTEXT.envStatus,
        ELEVENLABS_API_KEY: false,
        GENVOICE_API_KEY: true,
      },
    };
    const stsMissing = buildCliInvocation(
      {
        commandId: "voice:genvoice",
        subcommandPath: ["sts"],
        args: { voiceId: "v1", audioPath: "guide.wav", out: "out.mp3" },
      },
      genvoiceOnlyCtx,
    );
    expect(stsMissing.meta.envRequired).toEqual(["ELEVENLABS_API_KEY"]);
    expect(stsMissing.missingEnvGroups).toEqual([["ELEVENLABS_API_KEY"]]);

    const dryInit = buildCliInvocation(
      { commandId: "studio:init", args: { project: "films/new-film" }, flags: { "--dry": true } },
      BASE_CONTEXT,
    );
    expect(dryInit.meta.effect).toBe("read");
    expect(dryInit.requiresConfirm).toBe(false);

    const forgeList = buildCliInvocation(
      { commandId: "earshot", subcommandPath: ["forge"], flags: { "--list": true } },
      BASE_CONTEXT,
    );
    expect(forgeList.meta.effect).toBe("read");
    expect(forgeList.meta.speed).toBe("instant");

    const forgeCheck = buildCliInvocation(
      { commandId: "earshot", subcommandPath: ["forge"], flags: { "--check": ["tmp/out"] } },
      BASE_CONTEXT,
    );
    expect(forgeCheck.meta.effect).toBe("read");
    expect(forgeCheck.meta.speed).toBe("short");
  });

  test("blocks earshot mcp guard bypasses, quotes # tokens, and mirrors help/notes/gap parity", () => {
    for (const badTools of ["false", "0", 0, false]) {
      const mcpBad = buildCliInvocation(
        { commandId: "earshot", subcommandPath: ["mcp"], flags: { "--tools": badTools } },
        BASE_CONTEXT,
      );
      expect(mcpBad.guardReason).toBeTruthy();
      expect(mcpBad.meta.effect).toBe("daemon");
      expect(mcpBad.argvTokens).toEqual(["mcp"]);
    }

    const mcpOk = buildCliInvocation(
      { commandId: "earshot", subcommandPath: ["mcp"], flags: { "--tools": true } },
      BASE_CONTEXT,
    );
    expect(mcpOk.guardReason).toBeNull();
    expect(mcpOk.meta.effect).toBe("read");
    expect(mcpOk.argvTokens).toEqual(["mcp", "--tools"]);

    const atQuoted = buildCliInvocation(
      { commandId: "at", args: { secondOrNote: "#52" }, flags: { "--json": true } },
      BASE_CONTEXT,
    );
    expect(atQuoted.displayCommand).toBe('bun run at "#52" --json');

    const helpFind = buildCliInvocation(
      { commandId: "help", args: { command: "find" } },
      BASE_CONTEXT,
    );
    expect(helpFind.validationErrors).toEqual([]);
    expect(helpFind.displayCommand).toBe("bun run help find");

    const notesClash = buildCliInvocation(
      { commandId: "notes", args: { ids: ["#3"] }, flags: { "--shot": "1" } },
      BASE_CONTEXT,
    );
    expect(notesClash.validationErrors.length).toBeGreaterThan(0);

    const gapWrite = buildCliInvocation(
      { commandId: "gap", args: { need: "crop still" }, flags: { "--did": "ffmpeg" } },
      BASE_CONTEXT,
    );
    expect(gapWrite.validationErrors).toEqual([]);
    expect(gapWrite.meta.effect).toBe("write");

    const gapMissingDid = buildCliInvocation(
      { commandId: "gap", args: { need: "crop still" } },
      BASE_CONTEXT,
    );
    expect(gapMissingDid.validationErrors.length).toBeGreaterThan(0);
  });
});
