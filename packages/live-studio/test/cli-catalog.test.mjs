import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { listActiveLegoTokens } from "../app/cli/model.ts";
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

test("FFmpeg native argv preserves its explicit option boundary without weakening other commands", () => {
  for (const invocation of [
    ["probe", "--", "a clip.mp4"],
    ["contract", "--", "--static", "--tool", "cut"],
    ["export", "--minutes", "10", "--", "clip.mp4", "--preset", "prores", "-o", "master.mov"],
  ]) {
    const result = buildCliInvocation({
      commandId: "media",
      subcommandPath: ["ffmpeg"],
      args: { invocation },
    });
    expect(result.validationErrors).toEqual([]);
    expect(result.argvTokens).toEqual(["ffmpeg", ...invocation]);
  }
  const ordinary = buildCliInvocation({ commandId: "find", args: { words: "door --jev" } });
  expect(ordinary.validationErrors.some((error) => error.includes("looks like an option"))).toBe(
    true,
  );
});

test("QC exposes native inspection commands and render preserves evidence settings", () => {
  /** @type {[Omit<import("../src/cli-catalog.ts").CliRunRequest, "commandId">, string[]][]} */
  const cases = [
    [
      {
        args: { video: "renders/draft.mp4" },
        flags: { "--checks": "probe,sync", "--strict": true },
      },
      ["renders/draft.mp4", "--checks", "probe,sync", "--strict"],
    ],
    [
      {
        subcommandPath: ["box"],
        args: { image: "before.png", rect: "0,0,0.5,0.5" },
        flags: { "--norm": true, "--json": true },
      },
      ["box", "before.png", "0,0,0.5,0.5", "--norm", "--json"],
    ],
    [
      {
        subcommandPath: ["compare"],
        args: { before: "before.png", after: "after.png" },
        flags: { "--out": "renders/diff.png" },
      },
      ["compare", "before.png", "after.png", "--out", "renders/diff.png"],
    ],
    [
      { subcommandPath: ["motion"], flags: { "--cam": "src/timeline/cam.json", "--to": 4 } },
      ["motion", "--cam", "src/timeline/cam.json", "--to", "4"],
    ],
  ];
  for (const [request, argv] of cases) {
    const result = buildCliInvocation({ commandId: "qc", ...request }, BASE_CONTEXT);
    expect(result.validationErrors).toEqual([]);
    expect(result.argvTokens).toEqual(argv);
  }
  const render = buildCliInvocation(
    {
      commandId: "render",
      args: { target: "stills" },
      flags: { "--crop": "0,0,0.5,0.5", "--compare": true },
    },
    BASE_CONTEXT,
  );
  expect(render.validationErrors).toEqual([]);
  expect(render.argvTokens).toEqual(["stills", "--crop", "0,0,0.5,0.5", "--compare"]);
});

test("media setup preserves custom deadline and evidence parent in catalog argv", () => {
  const result = buildCliInvocation({
    commandId: "media",
    subcommandPath: ["setup"],
    args: { tool: "caption" },
    flags: { "--minutes": 20, "--out": "renders/install" },
  });
  expect(result.validationErrors).toEqual([]);
  expect(result.argvTokens).toEqual([
    "setup",
    "caption",
    "--minutes",
    "20",
    "--out",
    "renders/install",
  ]);
});

test("skills subcommands preserve JSON output in resolved invocations", () => {
  for (const verb of ["list", "get", "path"]) {
    const result = buildCliInvocation({
      commandId: "skills",
      subcommandPath: [verb],
      args: verb === "list" ? {} : { name: "core" },
      flags: { "--json": true },
    });
    expect(result.validationErrors).toEqual([]);
    expect(result.argvTokens).toEqual([verb, ...(verb === "list" ? [] : ["core"]), "--json"]);
  }
});

test("media native tools remain discoverable and preserve their structured arguments", () => {
  const tools = JSON.parse(readFileSync(join(REPO_ROOT, "scripts/media/tools.json"), "utf8"));
  const catalog = findCliCommand("media");
  for (const [id, tool] of Object.entries(tools))
    if (tool.binary) expect(catalog.subcommands.some((sub) => sub.id === id)).toBe(true);
  const request = buildCliInvocation(
    {
      commandId: "media",
      subcommandPath: ["ced"],
      args: { source: "speech.wav" },
      flags: { "--top-k": 3 },
    },
    BASE_CONTEXT,
  );
  expect(request.validationErrors).toEqual([]);
  expect(request.argvTokens).toEqual(["ced", "speech.wav", "--top-k", "3"]);
});

test("reference media catalog preserves repeated points and a complete Foley search phrase", () => {
  for (const { request, expected } of [
    {
      request: {
        subcommandPath: ["tapir"],
        args: { source: "clip.mp4" },
        flags: { "--point": ["1,2", "3,4"] },
      },
      expected: ["tapir", "clip.mp4", "--point", "1,2", "--point", "3,4"],
    },
    {
      request: {
        subcommandPath: ["foley", "search"],
        args: { value: "a man speaking" },
        flags: { "--config": "library.toml" },
      },
      expected: ["foley", "search", "a man speaking", "--config", "library.toml"],
    },
  ]) {
    const result = buildCliInvocation({ commandId: "media", ...request }, BASE_CONTEXT);
    expect(result.validationErrors).toEqual([]);
    expect(result.argvTokens).toEqual(expected);
  }
});

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

test("default dual search and its evaluation expose offline/JSON controls without provider credentials", () => {
  const spec = buildCliInvocation(
    {
      commandId: "find",
      args: { words: "creeper hiss" },
      flags: { "--json": true, "--offline": true },
    },
    BASE_CONTEXT,
  );
  expect(spec.validationErrors).toEqual([]);
  expect(spec.missingEnvGroups).toEqual([]);
  expect(spec.meta.cost).toBe("free");
  expect(spec.argvTokens).toEqual(expect.arrayContaining(["--offline", "--json"]));
  expect(
    isFieldVisible(findCliCommand("find").flags.find((f) => f.key === "--json").visibleWhen, {}),
  ).toBe(true);
  const evaluation = buildCliInvocation(
    {
      commandId: "eval:find",
      flags: { "--mode": "dual", "--plan": true, "--max-seconds": "30", "--max-requests": "20" },
    },
    BASE_CONTEXT,
  );
  expect(evaluation.validationErrors).toEqual([]);
  expect(evaluation.missingEnvGroups).toEqual([]);
  expect(evaluation.meta.cost).toBe("free");
  expect(evaluation.meta.effect).toBe("read");
  expect(evaluation.argvTokens).toEqual(expect.arrayContaining(["--mode", "dual", "--plan"]));
});

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
  const googleMissing = buildCliInvocation(
    {
      commandId: "assets:semantic",
      subcommandPath: ["build"],
      flags: { "--yes": true, "--retries": "2" },
    },
    {
      ...BASE_CONTEXT,
      envStatus: {
        ...BASE_CONTEXT.envStatus,
        GEMINI_API_KEY: false,
        GOOGLE_API_KEY: false,
        OPENROUTER_API_KEY: true,
      },
    },
  );
  expect(googleMissing.missingEnvGroups).toContainEqual(["GEMINI_API_KEY", "GOOGLE_API_KEY"]);
  expect(googleMissing.validationErrors).toEqual([]);
  expect(googleMissing.argvTokens).toEqual(expect.arrayContaining(["--retries", "2"]));
  const coverage = buildCliInvocation(
    {
      commandId: "assets:semantic",
      subcommandPath: ["status"],
      flags: { "--manifest": "assets.json" },
    },
    BASE_CONTEXT,
  );
  expect(coverage.validationErrors).toEqual([]);
  expect(coverage.argvTokens).toEqual(expect.arrayContaining(["--manifest", "assets.json"]));
  const evaluation = buildCliInvocation(
    {
      commandId: "assets:semantic",
      subcommandPath: ["eval"],
      args: { cases: "cases.json" },
      flags: { "--out": "report.json" },
    },
    BASE_CONTEXT,
  );
  expect(evaluation.validationErrors).toEqual([]);
  expect(evaluation.argvTokens).toEqual(
    expect.arrayContaining(["eval", "cases.json", "--out", "report.json"]),
  );
  expect(evaluation.missingEnvGroups).toEqual([]);
  expect(evaluation.meta.effect).toBe("write");
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
    {
      commandId: "find",
      args: { words: "sad goodbye" },
      flags: { "--semantic": true, "--json": true },
    },
    BASE_CONTEXT,
  );
  expect(cached.meta.cost).toBe("free");
  expect(cached.missingEnvGroups).toEqual([]);
  expect(cached.validationErrors).toEqual([]);
  expect(cached.argvTokens).toContain("--json");
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
  // a camera pose left of the origin is a list of numbers, not an option
  const pose = buildCliInvocation(
    { commandId: "render", args: { target: "stills" }, flags: { "--inspect": "-5,2,3,0,1,0,50" } },
    BASE_CONTEXT,
  );
  expect(pose.validationErrors).toEqual([]);
  expect(pose.argvTokens).toEqual(["stills", "--inspect", "-5,2,3,0,1,0,50"]);
  // PowerShell reads a bare @word as splatting: the shown command quotes it
  const views = buildCliInvocation(
    { commandId: "render", args: { target: "stills" }, flags: { "--views": "@views.json" } },
    BASE_CONTEXT,
  );
  expect(views.displayCommand).toEndWith('--views "@views.json"');
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
    const checkRule = (rule, defsByKey) => {
      for (let cur = rule; cur; cur = cur.and) {
        expect(defsByKey.has(cur.field)).toBe(true);
        const target = defsByKey.get(cur.field);
        if (target?.type === "enum" && target.options && cur.in) {
          for (const val of cur.in) expect(target.options.includes(val)).toBe(true);
        }
      }
    };

    const checkNode = (cmd, subPath, subNodes) => {
      if (!subNodes?.length) return;
      const seenSub = new Set();
      for (const sub of subNodes) {
        expect(seenSub.has(sub.id)).toBe(false);
        seenSub.add(sub.id);
        const nextPath = [...subPath, sub.id];
        const chain = resolveSubcommandChain(cmd, nextPath);
        const visibleFields = [...chain.argsDef, ...chain.flagsDef];
        const defsByKey = new Map(visibleFields.map((f) => [f.key, f]));
        for (const def of visibleFields) {
          if (def.visibleWhen) checkRule(def.visibleWhen, defsByKey);
          if (def.requiredWhen) checkRule(def.requiredWhen, defsByKey);
        }
        if (sub.subcommandRequired && chain.flagsDef.length && sub.subcommands?.length) {
          expect(sub.subcommands.some((child) => child.inheritFlags)).toBe(true);
        }
        checkNode(cmd, nextPath, sub.subcommands);
      }
    };

    for (const cmd of CLI_COMMANDS) {
      expect(seenCmdIds.has(cmd.id)).toBe(false);
      seenCmdIds.add(cmd.id);
      expect(categoryIds.has(cmd.category)).toBe(true);

      const topFields = [...(cmd.args ?? []), ...(cmd.flags ?? []), ...(cmd.env ?? [])];
      const defsByKey = new Map(topFields.map((f) => [f.key, f]));
      for (const def of topFields) {
        if (def.visibleWhen) checkRule(def.visibleWhen, defsByKey);
        if (def.requiredWhen) checkRule(def.requiredWhen, defsByKey);
      }
      if (cmd.subcommandRequired && cmd.flags?.length && cmd.subcommands?.length) {
        expect(cmd.subcommands.some((s) => s.inheritFlags)).toBe(true);
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
        const runnableInRoot =
          Boolean(rootPkg.scripts?.[cmd.target]) &&
          !String(rootPkg.scripts[cmd.target]).includes("wrong-place.mjs");
        const runnableInTemplate =
          Boolean(templatePkg.scripts?.[cmd.target]) &&
          !String(templatePkg.scripts[cmd.target]).includes("wrong-place.mjs");
        if (runnableInRoot || runnableInTemplate) {
          const expectedModes = [
            ...(runnableInRoot ? ["root"] : []),
            ...(runnableInTemplate ? ["film"] : []),
          ].toSorted();
          expect([...cmd.cwdModes].toSorted()).toEqual(expectedModes);
        }
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
      ["packages/live-studio/qc.mjs", "film-local entrypoint for the registered qc command"],
      ["scripts/review/frame_metrics.py", "image-region and comparison worker spawned by qc"],
      ["scripts/review/sheet_view.py", "overview/frame extraction helper dispatched by sheet.py"],
      [
        "scripts/review/reference_inspect.py",
        "reference inspect worker dispatched by reference.mjs",
      ],
      [
        "scripts/review/reference_source.py",
        "optional yt-dlp source acquisition for reference inspect",
      ],
      [
        "scripts/review/reference_transcript.py",
        "raw-preserving transcript import for reference inspect",
      ],
      ["scripts/evals/load/compare.mjs", "developer helper comparing recorded performance runs"],
      ["scripts/evals/load/frame.mjs", "developer frame-measurement probe for load evaluations"],
      ["scripts/evals/find/dual.ts", "dual search evaluation dispatched by eval:find --mode dual"],
      ["scripts/studio_tell.py", "shared Studio activity reporter library imported by Python CLIs"],
      ["packages/clip-catalog/jev.py", "stdin JSON helper library/IPC wrapper for Jev"],
      ["packages/live-studio/src/cli.mjs", "shared CLI argument parser imported by entrypoints"],
      [
        "packages/live-studio/wrong-place.mjs",
        "wrong-cwd guard invoked by package.json wrapper scripts",
      ],
      ["scripts/review/stale.py", "shared staleness helper module wrapping src/stale.mjs"],
      ["scripts/seconds.py", "shared heard-second parsing library imported by Python CLIs"],
      ["scripts/media/ocr.py", "RapidOCR SDK adapter spawned by the media CLI"],
      ["scripts/media/qc.py", "bundled deterministic QC worker spawned by the media CLI"],
      ["scripts/media/ffmpeg.mjs", "bundled FFmpeg dispatcher imported by the media CLI"],
      ["scripts/media/native.py", "native CPU media adapter spawned by the media CLI"],
      ["scripts/media/install.py", "verified native asset installer spawned by media setup"],
      ["scripts/media/sdk.py", "local SDK media worker spawned by the media CLI"],
      ["scripts/media/audio_sdk.py", "lazy audio SDK backends used by the media worker"],
      ["scripts/media/timeline.py", "OTIO handoff backend used by the media worker"],
      ["scripts/media/tracking.py", "reference tracking worker spawned by media CLI"],
      [
        "scripts/media/camera.py",
        "camera motion and solve worker spawned by media CLI and reference study/solve",
      ],
      ["scripts/media/camera_solve.py", "matchmove solver imported by the camera worker"],
      ["scripts/media/library.py", "local Foley catalog worker spawned by media CLI"],
      [
        "scripts/media/llama.py",
        "local llama.cpp server lifecycle/client used by the native media adapter",
      ],
      ["scripts/sound/beats.py", "stdin JSON beat-detection worker spawned by Live Studio audio"],
      [
        "scripts/sound/ir.py",
        "acoustic space IR synthesizer library imported by scripts/sound/mix.py",
      ],
      [
        "scripts/sound/process.py",
        "stdin JSON FFmpeg/Rubberband worker spawned by Live Studio audio",
      ],
      [
        "scripts/sound/spatial.py",
        "3D spatial audio math library imported by scripts/sound/mix.py",
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

  test("enforces exclusiveGroup conflicts among flags", () => {
    const renderConflict = buildCliInvocation(
      {
        commandId: "render",
        args: { target: "clip" },
        flags: { "--span": "0,4", "--chunks": "0,1" },
      },
      BASE_CONTEXT,
    );
    expect(renderConflict.exclusiveConflicts.length).toBeGreaterThan(0);
    expect(renderConflict.validationErrors.length).toBeGreaterThan(0);

    // --span is clip-only (render.mjs exits 2 on render all with --span)
    const renderAllSpan = buildCliInvocation(
      {
        commandId: "render",
        args: { target: "all" },
        flags: { "--span": "0,4" },
      },
      BASE_CONTEXT,
    );
    expect(renderAllSpan.argvTokens).toEqual(["all"]);
    const spanDef = renderAllSpan.flagsDef.find((e) => e.key === "--span");
    expect(isFieldVisible(spanDef?.visibleWhen, { target: "all" })).toBe(false);
    expect(isFieldVisible(spanDef?.visibleWhen, { target: "clip" })).toBe(true);

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
    const spanDef = renderCmd.flags.find((e) => e.key === "--span");
    const resDef = renderCmd.flags.find((e) => e.key === "--res");
    expect(isFieldVisible(spanDef.visibleWhen, { target: "clip" })).toBe(true);
    expect(isFieldVisible(spanDef.visibleWhen, { target: "stills" })).toBe(false);
    expect(isFieldVisible(resDef.visibleWhen, { target: "final" })).toBe(true);
    expect(isFieldVisible(resDef.visibleWhen, { target: "stills" })).toBe(false);
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

    const noHelp = buildCliInvocation({ commandId: "voice:genvoice", mode: "help" }, BASE_CONTEXT);
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

  test("enforces render --at requiredWhen poster, captions flag visibility, eval:load default guard, catalog:review --page, film-relative bun-file displayCommand, and partial context", () => {
    const posterNoAt = buildCliInvocation(
      { commandId: "render", args: { target: "poster" } },
      BASE_CONTEXT,
    );
    expect(posterNoAt.validationErrors).toContain("Missing required option: --at");

    const posterWithAt = buildCliInvocation(
      { commandId: "render", args: { target: "poster" }, flags: { "--at": "12" } },
      BASE_CONTEXT,
    );
    expect(posterWithAt.validationErrors).toEqual([]);
    expect(posterWithAt.argvTokens).toEqual(["poster", "--at", "12"]);

    const captions = buildCliInvocation(
      { commandId: "render", args: { target: "captions" } },
      BASE_CONTEXT,
    );
    const atDef = captions.flagsDef.find((d) => d.key === "--at");
    expect(isFieldRequired(atDef, { target: "poster" })).toBe(true);
    expect(isFieldRequired(atDef, { target: "stills" })).toBe(false);
    expect(isFieldRequired({ required: true }, {})).toBe(true);
    expect(isFieldRequired({}, {})).toBe(false);
    const entryDef = captions.flagsDef.find((d) => d.key === "--entry");
    const labDef = captions.flagsDef.find((d) => d.key === "--lab");
    expect(entryDef?.visibleWhen).toBeDefined();
    expect(labDef?.visibleWhen).toBeDefined();
    expect(isFieldVisible(entryDef?.visibleWhen, { target: "captions" })).toBe(false);
    expect(
      isFieldVisible(labDef?.visibleWhen, { target: "captions", "--entry": "lab/prop.ts" }),
    ).toBe(false);
    for (const target of ["stills", "clip", "poster", "all", "final"]) {
      expect(isFieldVisible(entryDef?.visibleWhen, { target })).toBe(true);
      // only an --entry page reads cfg.lab
      expect(isFieldVisible(labDef?.visibleWhen, { target })).toBe(false);
      expect(isFieldVisible(labDef?.visibleWhen, { target, "--entry": "lab/prop.ts" })).toBe(true);
    }
    const labRun = buildCliInvocation(
      {
        commandId: "render",
        args: { target: "stills" },
        flags: { "--entry": "lab/prop.ts", "--lab": ["view=desk", "zoom=2"] },
      },
      BASE_CONTEXT,
    );
    expect(labRun.argvTokens).toEqual([
      "stills",
      "--entry",
      "lab/prop.ts",
      "--lab",
      "view=desk",
      "--lab",
      "zoom=2",
    ]);

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
      "Missing required argument: Times / overview / frames / shots / cut",
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

    const nativeFrames = buildCliInvocation(
      {
        commandId: "sheet",
        args: { video: "renders/draft_video.mp4", target: "frames", frameTimes: "12.2-12.6/12" },
      },
      BASE_CONTEXT,
    );
    expect(nativeFrames.validationErrors).toEqual([]);
    expect(nativeFrames.argvTokens).toEqual(["renders/draft_video.mp4", "frames", "12.2-12.6/12"]);
    const overview = buildCliInvocation(
      {
        commandId: "sheet",
        args: { video: "renders/draft_video.mp4", target: "overview", overviewRange: "10-20/16" },
      },
      BASE_CONTEXT,
    );
    expect(overview.validationErrors).toEqual([]);
    expect(overview.argvTokens).toEqual(["renders/draft_video.mp4", "overview", "10-20/16"]);

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
      "Fill Video (Omit = Still PNGs) before setting Times / overview / frames / shots / cut.",
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
    expect(falseBool.meta.cost).toBe("free");

    const sheetClip = buildCliInvocation({ commandId: "catalog:sheet-clip" }, BASE_CONTEXT);
    expect(sheetClip.validationErrors).toEqual([]);
    expect(sheetClip.cwdMode).toBe("film");
    const sheetHelp = buildCliInvocation(
      { commandId: "catalog:sheet-clip", mode: "help" },
      BASE_CONTEXT,
    );
    expect(sheetHelp.validationErrors).toEqual([]);
    expect(sheetHelp.argvTokens).toEqual(["--help"]);
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

    const packCore = buildCliInvocation(
      {
        commandId: "pack:vault",
        args: { out: "D:/backup" },
        flags: { "--part": "core", "--json": true },
      },
      BASE_CONTEXT,
    );
    expect(packCore.validationErrors).toEqual([]);
    expect(packCore.argvTokens).toEqual(["D:/backup", "--part", "core", "--json"]);

    const setupSplit = buildCliInvocation(
      {
        commandId: "setup",
        flags: { "--vault-zip": ["D:/core.zip", "D:/heavy.zip"] },
      },
      BASE_CONTEXT,
    );
    expect(setupSplit.validationErrors).toEqual([]);
    expect(setupSplit.argvTokens).toEqual([
      "--vault-zip",
      "D:/core.zip",
      "--vault-zip",
      "D:/heavy.zip",
    ]);
  });

  test("supports render --views (stills/poster, --inspect conflict, clip hidden) and new-film --ratio", () => {
    const renderViews = buildCliInvocation(
      {
        commandId: "render",
        args: { target: "stills" },
        flags: { "--views": "front:0,2,5,0,1,0,50;top:0,8,0.1,0,0,0,50" },
      },
      BASE_CONTEXT,
    );
    expect(renderViews.validationErrors).toEqual([]);
    expect(renderViews.argvTokens).toEqual([
      "stills",
      "--views",
      "front:0,2,5,0,1,0,50;top:0,8,0.1,0,0,0,50",
    ]);

    const posterViews = buildCliInvocation(
      {
        commandId: "render",
        args: { target: "poster" },
        flags: { "--at": "4", "--views": "hero:0,2,5,0,1,0,50" },
      },
      BASE_CONTEXT,
    );
    expect(posterViews.validationErrors).toEqual([]);
    expect(posterViews.argvTokens).toEqual([
      "poster",
      "--at",
      "4",
      "--views",
      "hero:0,2,5,0,1,0,50",
    ]);

    const clipViews = buildCliInvocation(
      {
        commandId: "render",
        args: { target: "clip" },
        flags: { "--views": "hero:0,2,5,0,1,0,50" },
      },
      BASE_CONTEXT,
    );
    expect(clipViews.validationErrors).toEqual([]);
    expect(clipViews.argvTokens).toEqual(["clip"]);

    const viewsInspectConflict = buildCliInvocation(
      {
        commandId: "render",
        args: { target: "stills" },
        flags: { "--inspect": "0,2,5,0,1,0,50", "--views": "a:0,2,5,0,1,0,50" },
      },
      BASE_CONTEXT,
    );
    expect(viewsInspectConflict.validationErrors.length).toBeGreaterThan(0);

    const newFilmRatio = buildCliInvocation(
      {
        commandId: "new-film",
        args: { name: "short-demo" },
        flags: { "--ratio": "9:16" },
      },
      BASE_CONTEXT,
    );
    expect(newFilmRatio.validationErrors).toEqual([]);
    expect(newFilmRatio.argvTokens).toEqual(["short-demo", "--ratio", "9:16"]);
  });

  test("keeps sheet image-list mode visibility consistent across resolver, isFieldVisible, and Lego tokens", () => {
    const sheetImages = buildCliInvocation(
      {
        commandId: "sheet",
        args: { images: ["renders/view_a.png", "renders/view_b.png"] },
        flags: { "--out": "renders/views_sheet.jpg" },
      },
      BASE_CONTEXT,
    );
    expect(sheetImages.validationErrors).toEqual([]);
    expect(sheetImages.argvTokens).toEqual([
      "renders/view_a.png",
      "renders/view_b.png",
      "--out",
      "renders/views_sheet.jpg",
    ]);

    // Stale video-submode target/cutIndex/overviewRange/--start must stay hidden in resolver, UI, and Lego bar
    const staleCutDraft = {
      subcommandPath: [],
      args: { target: "cut", cutIndex: 4, images: ["renders/a.png"] },
      flags: { "--out": "renders/out.jpg", "--start": "60" },
      targetFilm: "active",
    };
    const sheetStaleCut = buildCliInvocation(
      {
        commandId: "sheet",
        args: staleCutDraft.args,
        flags: staleCutDraft.flags,
      },
      BASE_CONTEXT,
    );
    expect(sheetStaleCut.validationErrors).toEqual([]);
    expect(sheetStaleCut.argvTokens).toEqual(["renders/a.png", "--out", "renders/out.jpg"]);
    const staleCutCombined = { ...staleCutDraft.args, ...staleCutDraft.flags };
    expect(
      sheetStaleCut.argsDef
        .filter((d) => isFieldVisible(d.visibleWhen, staleCutCombined))
        .map((d) => d.key),
    ).toEqual(["images"]);
    expect(
      sheetStaleCut.flagsDef
        .filter((d) => isFieldVisible(d.visibleWhen, staleCutCombined))
        .map((d) => d.key),
    ).toEqual(["--out"]);
    expect(listActiveLegoTokens(sheetStaleCut, staleCutDraft).map((t) => t.id)).toEqual([
      "args:images",
      "flags:--out",
    ]);

    const sheetStaleOverview = buildCliInvocation(
      {
        commandId: "sheet",
        args: { target: "overview", images: ["renders/a.png"] },
      },
      BASE_CONTEXT,
    );
    expect(sheetStaleOverview.validationErrors).toEqual([]);
    expect(sheetStaleOverview.argvTokens).toEqual(["renders/a.png"]);

    // Both video and images set together must error and hide --out & cutIndex across resolver, UI, and Lego bar
    const conflictDraft = {
      subcommandPath: [],
      args: {
        video: "renders/draft_video.mp4",
        target: "cut",
        cutIndex: 4,
        images: ["renders/a.png"],
      },
      flags: { "--out": "renders/out.jpg" },
      targetFilm: "active",
    };
    const sheetBothConflict = buildCliInvocation(
      {
        commandId: "sheet",
        args: conflictDraft.args,
        flags: conflictDraft.flags,
      },
      BASE_CONTEXT,
    );
    expect(sheetBothConflict.validationErrors).toContain("Give Video or Image Files, not both.");
    expect(sheetBothConflict.argvTokens).toEqual([]);
    const conflictCombined = { ...conflictDraft.args, ...conflictDraft.flags };
    expect(
      sheetBothConflict.flagsDef
        .filter((d) => isFieldVisible(d.visibleWhen, conflictCombined))
        .map((d) => d.key),
    ).toEqual([]);
    expect(listActiveLegoTokens(sheetBothConflict, conflictDraft)).toEqual([]);
  });

  test("enforces studio mode flags and collab write stdin guard with file-path negative control", () => {
    const studioDetach = buildCliInvocation(
      {
        commandId: "studio",
        flags: { "--detach": true, "--lan": true },
      },
      BASE_CONTEXT,
    );
    expect(studioDetach.validationErrors).toEqual([]);
    expect(studioDetach.argvTokens).toEqual(["--lan", "--detach"]);

    for (const flag of ["--status", "--stop"]) {
      const solo = buildCliInvocation(
        { commandId: "studio", flags: { [flag]: true } },
        BASE_CONTEXT,
      );
      expect(solo.validationErrors).toEqual([]);
      expect(solo.argvTokens).toEqual([flag]);

      const lanConflict = buildCliInvocation(
        {
          commandId: "studio",
          flags: { "--lan": true, [flag]: true },
        },
        BASE_CONTEXT,
      );
      expect(lanConflict.validationErrors.length).toBeGreaterThan(0);
    }

    for (const pair of [
      { "--detach": true, "--stop": true },
      { "--status": true, "--stop": true },
    ]) {
      const studioConflict = buildCliInvocation({ commandId: "studio", flags: pair }, BASE_CONTEXT);
      expect(studioConflict.validationErrors.length).toBeGreaterThan(0);
    }

    const collabStdin = buildCliInvocation(
      {
        commandId: "collab",
        subcommandPath: ["write"],
        args: { name: "cam", input: "-" },
      },
      BASE_CONTEXT,
    );
    expect(collabStdin.validationErrors).toEqual([]);
    expect(collabStdin.argvTokens).toEqual(["write", "cam", "-"]);
    expect(collabStdin.guardReason).toContain("stdin");

    const collabFile = buildCliInvocation(
      {
        commandId: "collab",
        subcommandPath: ["write"],
        args: { name: "cam", input: "payload.json" },
        flags: { "--quiet": true },
      },
      BASE_CONTEXT,
    );
    expect(collabFile.validationErrors).toEqual([]);
    expect(collabFile.argvTokens).toEqual(["write", "cam", "payload.json", "--quiet"]);
    expect(collabFile.guardReason).toBeNull();
  });

  test("resolves R2/R3 flags for collab, asset preview, render, notes, and timeline:fmt", () => {
    const collabReadFull = buildCliInvocation(
      {
        commandId: "collab",
        subcommandPath: ["read"],
        args: { name: "cast" },
        flags: { "--full": true },
      },
      BASE_CONTEXT,
    );
    expect(collabReadFull.validationErrors).toEqual([]);
    expect(collabReadFull.argvTokens).toEqual(["read", "cast", "--full"]);

    const collabWriteManyStdin = buildCliInvocation(
      {
        commandId: "collab",
        subcommandPath: ["write-many"],
        args: { input: "-" },
      },
      BASE_CONTEXT,
    );
    expect(collabWriteManyStdin.validationErrors).toEqual([]);
    expect(collabWriteManyStdin.guardReason).toContain("stdin");

    const collabWriteManyFile = buildCliInvocation(
      {
        commandId: "collab",
        subcommandPath: ["write-many"],
        args: { input: "batch.json" },
        flags: { "--quiet": true },
      },
      BASE_CONTEXT,
    );
    expect(collabWriteManyFile.validationErrors).toEqual([]);
    expect(collabWriteManyFile.argvTokens).toEqual(["write-many", "batch.json", "--quiet"]);
    expect(collabWriteManyFile.guardReason).toBeNull();

    const assetPreview = buildCliInvocation(
      {
        commandId: "asset",
        subcommandPath: ["preview"],
        args: { id: "block:minecraft:oak_stairs item:minecraft:iron_sword" },
        flags: {
          "--kind": "block",
          "--source": "modern-furniture",
          "--out": "sheet.png",
          "--size": 0.6,
          "--limit": 6,
          "--no-scale": true,
        },
      },
      BASE_CONTEXT,
    );
    expect(assetPreview.validationErrors).toEqual([]);
    expect(assetPreview.meta.effect).toBe("write");
    expect(assetPreview.argvTokens).toEqual([
      "preview",
      "block:minecraft:oak_stairs",
      "item:minecraft:iron_sword",
      "--kind",
      "block",
      "--source",
      "modern-furniture",
      "--out",
      "sheet.png",
      "--size",
      "0.6",
      "--limit",
      "6",
      "--no-scale",
    ]);

    const assetPreviewDefault = buildCliInvocation(
      {
        commandId: "asset",
        subcommandPath: ["preview"],
      },
      BASE_CONTEXT,
    );
    expect(assetPreviewDefault.validationErrors).toEqual([]);
    expect(assetPreviewDefault.argvTokens).toEqual(["preview"]);

    const renderFresh = buildCliInvocation(
      {
        commandId: "render",
        args: { target: "stills" },
        flags: { "--check": "probe:4", "--fresh-cache": true },
      },
      BASE_CONTEXT,
    );
    expect(renderFresh.validationErrors).toEqual([]);
    expect(renderFresh.argvTokens).toEqual(["stills", "--check", "probe:4", "--fresh-cache"]);

    const notesFast = buildCliInvocation(
      {
        commandId: "notes",
        args: { ids: "1 2" },
        flags: { "--no-lessons": true },
      },
      BASE_CONTEXT,
    );
    expect(notesFast.validationErrors).toEqual([]);
    expect(notesFast.argvTokens).toEqual(["1", "2", "--no-lessons"]);

    const fmtTarget = buildCliInvocation(
      {
        commandId: "timeline:fmt",
        args: { target: "cast lights" },
      },
      BASE_CONTEXT,
    );
    expect(fmtTarget.validationErrors).toEqual([]);
    expect(fmtTarget.argvTokens).toEqual(["cast", "lights"]);
  });

  test("preserves inherited flags, confirmation gates, and context rules on voice:playground and openfilm", () => {
    const ttsPaid = buildCliInvocation(
      {
        commandId: "voice:playground",
        subcommandPath: ["generate", "tts"],
        flags: { "--input-file": "req.json", "--yes": true, "--scope": "project" },
      },
      BASE_CONTEXT,
    );
    expect(ttsPaid.validationErrors).toEqual([]);
    expect(ttsPaid.argvTokens).toEqual([
      "generate",
      "tts",
      "--input-file",
      "req.json",
      "--scope",
      "project",
      "--yes",
    ]);
    expect(ttsPaid.requiresConfirm).toBe(true);

    const ctxConflict = buildCliInvocation(
      {
        commandId: "voice:playground",
        subcommandPath: ["items", "list"],
        flags: { "--server": "http://127.0.0.1:3333", "--project": "films/demo" },
      },
      BASE_CONTEXT,
    );
    expect(ctxConflict.exclusiveConflicts).toEqual([
      "Mutually exclusive options set together: --server + --project",
    ]);
    expect(ctxConflict.validationErrors).toEqual(ctxConflict.exclusiveConflicts);

    const resumeInherited = buildCliInvocation(
      {
        commandId: "voice:playground",
        subcommandPath: ["resume"],
        args: { checkpoint: "ckpt.json" },
        flags: { "--dry-run": true, "--wait": 120 },
      },
      BASE_CONTEXT,
    );
    expect(resumeInherited.validationErrors).toEqual([]);
    expect(resumeInherited.argvTokens).toEqual([
      "resume",
      "ckpt.json",
      "--dry-run",
      "--wait",
      "120",
    ]);

    const schemaHelp = buildCliInvocation(
      { commandId: "voice:playground", subcommandPath: ["schema"], mode: "help" },
      BASE_CONTEXT,
    );
    expect(schemaHelp.validationErrors).toEqual([
      "voice:playground has no --help mode; inspect summary and fields instead.",
    ]);

    const openfilmUse = buildCliInvocation(
      {
        commandId: "openfilm",
        subcommandPath: ["use"],
        args: { id: "openfilm:effects/snow" },
        flags: { "--film": "films/demo", "--from": 2, "--to": 5 },
      },
      BASE_CONTEXT,
    );
    expect(openfilmUse.validationErrors).toEqual([]);
    expect(openfilmUse.argvTokens).toEqual([
      "use",
      "openfilm:effects/snow",
      "--film",
      "films/demo",
      "--from",
      "2",
      "--to",
      "5",
    ]);

    const openfilmPropsConflict = buildCliInvocation(
      {
        commandId: "openfilm",
        subcommandPath: ["use"],
        args: { id: "openfilm:effects/snow" },
        flags: { "--props": '{"a":1}', "--props-file": "props.json" },
      },
      BASE_CONTEXT,
    );
    expect(openfilmPropsConflict.exclusiveConflicts).toEqual([
      "Mutually exclusive options set together: --props + --props-file",
    ]);
    expect(openfilmPropsConflict.validationErrors).toEqual(
      openfilmPropsConflict.exclusiveConflicts,
    );
  });

  test("exposes note ask, find, eval:load, catalog:eval, and catalog:check flags cleanly", () => {
    const noteAsk = buildCliInvocation(
      {
        commandId: "note",
        subcommandPath: ["ask"],
        args: { id: "3", text: "Keep this angle?" },
        flags: { "--after": "renders/still_4s.jpg", "--t": "4" },
      },
      BASE_CONTEXT,
    );
    expect(noteAsk.validationErrors).toEqual([]);
    expect(noteAsk.argvTokens).toEqual([
      "ask",
      "3",
      "Keep this angle?",
      "--after",
      "renders/still_4s.jpg",
      "--t",
      "4",
    ]);

    const findStyle = buildCliInvocation(
      {
        commandId: "find",
        flags: { "--kind": "mocap", "--style": "natural", "--origin": "unknown" },
      },
      BASE_CONTEXT,
    );
    expect(findStyle.validationErrors).toEqual([]);
    expect(findStyle.argvTokens).toEqual([
      "--kind",
      "mocap",
      "--origin",
      "unknown",
      "--style",
      "natural",
    ]);

    const evalLoad = buildCliInvocation(
      {
        commandId: "eval:load",
        flags: { "--panels": true, "--frames": "0,2.4", "--audio": true, "--playback": true },
      },
      BASE_CONTEXT,
    );
    expect(evalLoad.validationErrors).toEqual([]);
    expect(evalLoad.argvTokens).toEqual(["--panels", "--frames", "0,2.4", "--audio", "--playback"]);

    const catEval = buildCliInvocation(
      {
        commandId: "catalog:eval",
        args: { out: "renders/eval.txt" },
        flags: { "--limit": 5, "--resume": true, "--scenes": "custom.txt", "--timeout": 120 },
      },
      BASE_CONTEXT,
    );
    expect(catEval.validationErrors).toEqual([]);
    expect(catEval.argvTokens).toEqual([
      "renders/eval.txt",
      "--scenes",
      "custom.txt",
      "--limit",
      "5",
      "--timeout",
      "120",
      "--resume",
    ]);

    const catCheck = buildCliInvocation(
      { commandId: "catalog:check", flags: { "--fights": true } },
      BASE_CONTEXT,
    );
    expect(catCheck.validationErrors).toEqual([]);
    expect(catCheck.argvTokens).toEqual(["--fights"]);
  });

  test("enforces catalog:review --page/--notes/--missing rules, reference auth exclusivity, and history/collab subcommandRequired", () => {
    const catPageNotes = buildCliInvocation(
      { commandId: "catalog:review", flags: { "--page": 0, "--notes": "notes.json" } },
      BASE_CONTEXT,
    );
    expect(catPageNotes.validationErrors).toEqual([]);
    expect(catPageNotes.guardReason).toBeNull();
    expect(catPageNotes.argvTokens).toEqual(["--page", "0", "--notes", "notes.json"]);

    const catMissingDropsNotes = buildCliInvocation(
      { commandId: "catalog:review", flags: { "--missing": "style", "--notes": "notes.json" } },
      BASE_CONTEXT,
    );
    expect(catMissingDropsNotes.validationErrors).toEqual([]);
    expect(catMissingDropsNotes.argvTokens).toEqual(["--missing", "style"]);

    const catModeConflict = buildCliInvocation(
      { commandId: "catalog:review", flags: { "--page": 0, "--missing": "style" } },
      BASE_CONTEXT,
    );
    expect(catModeConflict.exclusiveConflicts).toEqual([
      "Mutually exclusive options set together: --page + --missing",
    ]);
    expect(catModeConflict.validationErrors).toEqual(catModeConflict.exclusiveConflicts);

    const refConflict = buildCliInvocation(
      {
        commandId: "reference",
        args: { operation: "inspect", reference: "https://example.com/v" },
        flags: { "--cookies": "c.txt", "--cookies-from-browser": "chrome" },
      },
      BASE_CONTEXT,
    );
    expect(refConflict.exclusiveConflicts).toEqual([
      "Mutually exclusive options set together: --cookies + --cookies-from-browser",
    ]);
    expect(refConflict.validationErrors).toEqual(refConflict.exclusiveConflicts);

    const historyBare = buildCliInvocation({ commandId: "history" }, BASE_CONTEXT);
    expect(historyBare.validationErrors).toEqual(["Choose a history subcommand first."]);
    const collabBare = buildCliInvocation({ commandId: "collab" }, BASE_CONTEXT);
    expect(collabBare.validationErrors).toEqual(["Choose a collab subcommand first."]);
  });

  test("resolves earshot 1.0 make, sounds, recipe, build, and pack subcommands", () => {
    const makePlain = buildCliInvocation(
      {
        commandId: "earshot",
        subcommandPath: ["make"],
        args: { want: "a soft wooden knock" },
        flags: { "-o": "sound/sfx/knock.wav", "--n": 3 },
      },
      BASE_CONTEXT,
    );
    expect(makePlain.validationErrors).toEqual([]);
    expect(makePlain.meta.effect).toBe("write");
    expect(makePlain.meta.speed).toBe("short");
    expect(makePlain.argvTokens).toEqual([
      "make",
      "a soft wooden knock",
      "-o",
      "sound/sfx/knock.wav",
      "--n",
      "3",
    ]);

    const makeListen = buildCliInvocation(
      {
        commandId: "earshot",
        subcommandPath: ["make"],
        args: { want: "a soft wooden knock" },
        flags: { "-o": "sound/sfx/knock.wav", "--listen": true },
      },
      BASE_CONTEXT,
    );
    expect(makeListen.meta.speed).toBe("long");

    const buildParts = buildCliInvocation(
      {
        commandId: "earshot",
        subcommandPath: ["build"],
        args: { want: "a stampede of horses" },
        flags: {
          "-o": "sound/sfx/stampede.wav",
          "--part": ["hundreds of hoofbeats", "a low rumble"],
          "--without": ["thunder/roll", "horse"],
          "--no-listen": true,
        },
      },
      BASE_CONTEXT,
    );
    expect(buildParts.validationErrors).toEqual([]);
    expect(buildParts.meta.speed).toBe("short");
    expect(buildParts.argvTokens).toEqual([
      "build",
      "a stampede of horses",
      "-o",
      "sound/sfx/stampede.wav",
      "--part",
      "hundreds of hoofbeats",
      "--part",
      "a low rumble",
      "--without",
      "thunder/roll",
      "horse",
      "--no-listen",
    ]);

    const soundsSearch = buildCliInvocation(
      { commandId: "earshot", subcommandPath: ["sounds"], flags: { "--search": "footstep" } },
      BASE_CONTEXT,
    );
    expect(soundsSearch.validationErrors).toEqual([]);
    expect(soundsSearch.meta.effect).toBe("read");

    const recipeList = buildCliInvocation(
      { commandId: "earshot", subcommandPath: ["recipe"], flags: { "--list": true } },
      BASE_CONTEXT,
    );
    expect(recipeList.validationErrors).toEqual([]);
    expect(recipeList.meta.effect).toBe("read");

    const packSprite = buildCliInvocation(
      {
        commandId: "earshot",
        subcommandPath: ["pack"],
        args: { files: ["a.wav", "b.wav"] },
        flags: { "-o": "sprite.ogg", "--gap": 0.1 },
      },
      BASE_CONTEXT,
    );
    expect(packSprite.validationErrors).toEqual([]);
    expect(packSprite.argvTokens).toEqual([
      "pack",
      "a.wav",
      "b.wav",
      "-o",
      "sprite.ogg",
      "--gap",
      "0.1",
    ]);
  });
});
