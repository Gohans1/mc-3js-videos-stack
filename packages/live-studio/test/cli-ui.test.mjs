import { describe, test } from "bun:test";
import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  cliStore,
  commitSaveTemplate,
  consumeFocusConsoleRun,
  dispatchCliRun,
  openCommandWorkbench,
  openTemplateInWorkbench,
  refreshCliCatalog,
  refreshCliTemplates,
  removeTemplate,
  restoreDeletedTemplate,
  retryCliPanel,
  setDraftTargetFilm,
  stopCurrentRun,
} from "../app/cli/cli-store.ts";
import { CliBehaviorStrip } from "../app/cli/CliBadges.tsx";
import { CliBrowse } from "../app/cli/CliBrowse.tsx";
import { buildVerbatimCopyText, CliConsole } from "../app/cli/CliConsole.tsx";
import * as cliConsole from "../app/cli/CliConsole.tsx";
import { SaveTemplatePanel } from "../app/cli/CliDialogs.tsx";
import { saveCliTemplate } from "../app/cli/client.ts";
import { CliFieldControl } from "../app/cli/CliFieldControl.tsx";
import { CliLegoBar } from "../app/cli/CliLegoBar.tsx";
import { CliWorkbench, nextCompactTabForChange } from "../app/cli/CliWorkbench.tsx";
import * as cliModel from "../app/cli/model.ts";
import {
  buildTemplatePreviewCommand,
  commitMultiTokens,
  createInitialDraft,
  draftFromTemplate,
  filterCommands,
  filterTemplates,
  formatTargetBadgeText,
  getEffectLabel,
  listActiveLegoTokens,
  resolveSaveTemplateTargets,
  setDraftFieldWithExclusiveClear,
  stopCliHotkeyPropagation,
  stopCliInputHotkeyPropagation,
  stopCliTabHotkeyPropagation,
} from "../app/cli/model.ts";
import {
  Toast,
  ToastContent,
  ToastDescription,
  Toaster,
  ToastProvider,
  ToastTitle,
} from "../app/components/ui/toast.tsx";
import { TooltipProvider } from "../app/components/ui/tooltip.tsx";
import {
  buildCliInvocation,
  CLI_CATEGORIES,
  CLI_COMMANDS,
  findCliCommand,
  isFieldVisible,
} from "../src/cli-catalog.ts";

const makeContext = (overrides = {}) => ({
  repoName: "gohans-monorepo-3js-mc",
  activeFilm: "demo-film",
  isDemo: false,
  films: ["demo-film", "second-film"],
  filmDirs: ["films/cell-break", "films/sealed-room"],
  runningFilms: [],
  choices: {
    films: ["demo-film", "second-film"],
    filmDirs: ["films/cell-break", "films/sealed-room"],
    notes: ["#1: Fix light"],
    shots: ["0", "1"],
    takes: ["intro.mp3"],
    skills: ["core", "motion"],
    skillRefs: ["contract"],
    favLists: ["default"],
    findKinds: ["sfx", "mocap", "music"],
    findSources: ["mixkit", "kenney"],
    postures: ["stand", "walk"],
    renders: ["final.mp4"],
    labs: ["cam-lab"],
    packages: ["live-studio", "film-kit"],
  },
  envStatus: {
    ELEVENLABS_API_KEY: true,
    GENVOICE_API_KEY: false,
    GEMINI_API_KEY: false,
    GOOGLE_API_KEY: false,
    OPENCODE_API_KEY: false,
    OPENROUTER_API_KEY: false,
  },
  ...overrides,
});

test("poster validation identifies AT by its env key when the label includes units", () => {
  const spec = buildCliInvocation(
    { commandId: "render", args: { target: "poster" } },
    makeContext(),
  );
  const at = spec.envDef.find((field) => field.key === "AT");
  assert.ok(at);
  assert.ok(spec.validationErrors.includes("Missing required env: AT"));
  assert.ok(cliModel.hasFieldValidationError(at, spec.validationErrors));
  assert.ok(
    !cliModel.hasFieldValidationError({ key: "ENTRY", label: "Entry file" }, spec.validationErrors),
  );
});

test("command lifecycle uses a persistent polite status without reading stdout", () => {
  const base = {
    runId: "announcement",
    commandId: "help",
    subcommandPath: [],
    mode: "execute",
    displayCommand: "bun run help",
    cwd: "films/demo",
    targetFilm: "active",
    startedAt: 1,
    truncated: false,
    output: [{ seq: 1, stream: "stdout", chunk: "STDOUT_SENTINEL" }],
  };
  for (const [run, expected] of [
    [null, "Ready"],
    [{ ...base, status: "running" }, "Running"],
    [{ ...base, status: "done", exitCode: 0 }, "Exit 0"],
  ]) {
    const html = renderToStaticMarkup(
      wrapTree(createElement(cliConsole.CliRunAnnouncement, { run })),
    );
    assert.match(html, /role="status"/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /aria-atomic="true"/);
    assert.ok(html.includes(expected));
    if (run) assert.ok(html.includes("help"));
    assert.ok(!html.includes("STDOUT_SENTINEL"));
  }
});

test("More options counts only available settings after switching asset kind", () => {
  const context = makeContext();
  const command = findCliCommand("find");
  const draft = createInitialDraft(command, context);
  draft.flags = { "--kind": ["mocap"] };
  const mocap = buildCliInvocation({ commandId: "find", flags: draft.flags }, context);
  const flag = mocap.flagsDef.find(
    (field) => field.tier === "advanced" && field.visibleWhen?.unsetOrStartsWith?.includes("mocap"),
  );
  assert.ok(flag);
  draft.flags[flag.key] = flag.type === "boolean" ? true : "stand";
  draft.flags["--kind"] = ["sfx"];
  const spec = buildCliInvocation({ commandId: "find", flags: draft.flags }, context);
  const values = { ...draft.args, ...draft.flags, ...draft.env };
  const available = spec.flagsDef.filter(
    (field) => field.tier === "advanced" && isFieldVisible(field.visibleWhen, values),
  );
  const html = renderToStaticMarkup(
    wrapTree(
      createElement(
        CliWorkbench,
        makeWorkbenchProps(
          { categories: CLI_CATEGORIES, commands: CLI_COMMANDS, context },
          command,
          draft,
        ),
      ),
    ),
  );
  assert.ok(html.includes(`More options (${available.length})`));
  assert.ok(!html.includes("1 active"));
});

test("invalid enum controls announce the error, requirement and field description", () => {
  for (const optionalValue of [false, true]) {
    const html = renderToStaticMarkup(
      wrapTree(
        createElement(CliFieldControl, {
          def: {
            key: "--mode",
            flag: "--mode",
            label: "Mode",
            type: "enum",
            options: ["fast", "full"],
            required: true,
            hint: "Choose how much to analyze.",
            optionalValue,
          },
          value: optionalValue ? "" : undefined,
          context: makeContext(),
          invalid: true,
          errorId: "cli-error",
          onChange: () => {},
        }),
      ),
    );
    const combobox = html.match(/<button[^>]*role="combobox"[^>]*>/)?.[0];
    assert.ok(combobox);
    assert.match(combobox, /aria-invalid="true"/);
    assert.match(combobox, /aria-required="true"/);
    assert.match(combobox, /aria-describedby="cli-error [^"]+-hint"/);
  }
});

test("command details use labelled information and explain that Stop does not undo changes", () => {
  const html = renderToStaticMarkup(
    wrapTree(
      createElement(CliBehaviorStrip, {
        meta: { effect: "write", cost: "free", speed: "short", cancellable: true },
        targetLabel: "films/cell-break",
        missingEnvGroups: [],
      }),
    ),
  );
  assert.ok(html.includes("<dl"));
  assert.ok(html.includes("<dt"));
  assert.ok(html.includes("Runs in"));
  assert.ok(html.includes("does not undo"));
  assert.ok(!html.includes("<button"));
});

test("pending token text joins arguments and csv flags without changing stored drafts", () => {
  const command = findCliCommand("find");
  const draft = createInitialDraft(command);
  draft.args.words = ["stone"];
  draft.flags["--show"] = ["clip:a"];
  draft.pendingInputs = { "args:words": '"creaky door" stone', "flags:--show": "clip:b, clip:c" };
  const resolved = cliModel.resolvePendingInputs(command, draft);
  assert.deepEqual(resolved.args.words, ["stone", "creaky door"]);
  assert.deepEqual(resolved.flags["--show"], ["clip:a", "clip:b", "clip:c"]);
  assert.deepEqual(resolved.pendingInputs, {});
  assert.deepEqual(draft.args.words, ["stone"]);
  assert.deepEqual(draft.pendingInputs, {
    "args:words": '"creaky door" stone',
    "flags:--show": "clip:b, clip:c",
  });
});

test("exclusive CSV edits preserve their pending entry and clear only the competing flag", () => {
  const command = findCliCommand("find");
  const draft = createInitialDraft(command);
  draft.flags["--star"] = ["clip:a"];
  draft.pendingInputs = { "flags:--star": "clip:b", "flags:--unstar": "clip:c" };
  const spec = buildCliInvocation({ commandId: "find" });
  const flag = spec.flagsDef.find((field) => field.key === "--unstar");
  const { next } = setDraftFieldWithExclusiveClear(
    draft,
    spec,
    "flags",
    "--unstar",
    ["clip:d"],
    flag.exclusiveGroup,
    flag.optionalValue,
  );
  assert.equal(next.flags["--star"], undefined);
  assert.deepEqual(next.pendingInputs, { "flags:--unstar": "clip:c" });
  assert.deepEqual(draft.pendingInputs, { "flags:--star": "clip:b", "flags:--unstar": "clip:c" });
});

test("execution errors stay visible in compact Output and expanded consoles", () => {
  const context = makeContext();
  const command = findCliCommand("help");
  const draft = createInitialDraft(command, context);
  const run = {
    runId: "previous-help",
    commandId: "help",
    subcommandPath: [],
    mode: "help",
    displayCommand: "bun run help --help",
    cwd: "repo root",
    status: "done",
    exitCode: 0,
    startedAt: 1,
    truncated: false,
    output: [],
  };
  for (const view of [
    { initialCompact: true, focusConsoleRunId: run.runId },
    { consoleExpanded: true },
  ]) {
    const html = renderToStaticMarkup(
      wrapTree(
        createElement(
          CliWorkbench,
          makeWorkbenchProps(
            { categories: CLI_CATEGORIES, commands: CLI_COMMANDS, context },
            command,
            draft,
            { lastRun: run, runError: "Studio is offline", ...view },
          ),
        ),
      ),
    );
    assert.ok(html.includes("Command could not run"));
    assert.ok(html.includes("Studio is offline"));
  }
});

for (const mode of ["execute", "help"]) {
  test(`network rejection releases ${mode} submission and allows retry`, async () => {
    const originalFetch = globalThis.fetch;
    const savedState = cliStore.getState();
    let calls = 0;
    try {
      globalThis.fetch = async () => {
        calls++;
        if (calls === 1) throw new TypeError("Failed to fetch");
        return Response.json({ error: "Retry request reached Studio" }, { status: 400 });
      };
      const request = { commandId: "help", targetFilm: "root", mode };
      await assert.doesNotReject(() => dispatchCliRun(request));
      assert.equal(cliStore.getState().submittingRun, false);
      assert.equal(cliStore.getState().runError, "Failed to fetch");
      await dispatchCliRun(request);
      assert.equal(calls, 2);
      assert.equal(cliStore.getState().submittingRun, false);
      assert.equal(cliStore.getState().runError, "Retry request reached Studio");
    } finally {
      globalThis.fetch = originalFetch;
      cliStore.setState(savedState);
    }
  });
}

test("network rejection releases Stop so the running command can be stopped again", async () => {
  const originalFetch = globalThis.fetch;
  const savedState = cliStore.getState();
  const running = { runId: "run-offline", status: "running", commandId: "render", output: [] };
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) throw new TypeError("Failed to fetch");
      return Response.json({ run: { ...running, status: "stopped" } });
    };
    cliStore.setState({ activeRun: running, stoppingRunId: null, runError: null });
    await assert.doesNotReject(() => stopCurrentRun("run-offline"));
    assert.equal(cliStore.getState().stoppingRunId, null);
    assert.equal(cliStore.getState().runError, "Failed to fetch");
    assert.equal(cliStore.getState().activeRun?.runId, "run-offline");
    await stopCurrentRun("run-offline");
    assert.equal(calls, 2);
    assert.equal(cliStore.getState().activeRun, null);
    assert.equal(cliStore.getState().lastRun?.status, "stopped");
  } finally {
    globalThis.fetch = originalFetch;
    cliStore.setState(savedState);
  }
});

const makeWorkbenchProps = (catalog, command, draft, overrides = {}) => ({
  catalog,
  command,
  draft,
  editingTemplateName: null,
  activeRun: null,
  lastRun: null,
  stoppingRunId: null,
  consoleExpanded: false,
  focusConsoleRunId: null,
  initialCompact: false,
  submittingRun: false,
  runError: null,
  clearedHint: null,
  onBack: () => {},
  onSelectCategory: () => {},
  onSelectCommand: () => {},
  onSelectSubcommand: () => {},
  onSelectTargetFilm: () => {},
  onUpdateField: () => {},
  onRemoveToken: () => {},
  onReset: () => {},
  onRun: () => {},
  onStopRun: () => {},
  onClearConsole: () => {},
  onToggleExpandConsole: () => {},
  onConsumeFocusRun: () => {},
  onOpenSaveTemplate: () => {},
  ...overrides,
});

const wrapTree = (node) => createElement(TooltipProvider, null, createElement(Toaster, null, node));

describe("CLI tab model & dependent lego logic", () => {
  test("swapping find <-> check adapts visible flags and cost/confirm metadata", () => {
    const findCmd = findCliCommand("find");
    const checkCmd = findCliCommand("check");
    assert.ok(findCmd);
    assert.ok(checkCmd);

    assert.ok(findCmd.flags?.some((f) => f.key === "--jev"));
    assert.ok(!checkCmd.flags?.some((f) => f.key === "--jev"));

    const ctx = makeContext();
    const specFree = buildCliInvocation(
      { commandId: "find", args: { words: "stone" }, flags: {}, targetFilm: "active" },
      ctx,
    );
    assert.equal(specFree.meta.cost, "optional-paid");
    assert.equal(specFree.requiresConfirm, false);

    const specJev = buildCliInvocation(
      {
        commandId: "find",
        args: { words: "stone" },
        flags: { "--jev": true },
        targetFilm: "active",
      },
      ctx,
    );
    assert.equal(specJev.meta.cost, "paid");
    assert.ok(specJev.displayCommand.includes("--jev"));
  });

  test("optionalValue emits bare flag when empty string and value token when selected", () => {
    const ctx = makeContext();
    const bare = buildCliInvocation(
      { commandId: "find", flags: { "--source": "" }, targetFilm: "active" },
      ctx,
    );
    assert.deepEqual(bare.argvTokens, ["--source"]);

    const picked = buildCliInvocation(
      { commandId: "find", flags: { "--source": "mixkit" }, targetFilm: "active" },
      ctx,
    );
    assert.deepEqual(picked.argvTokens, ["--source", "mixkit"]);
  });

  test("setDraftFieldWithExclusiveClear clears conflicting siblings across groups", () => {
    const renderCmd = findCliCommand("render");
    assert.ok(renderCmd);
    const ctx = makeContext();
    const initial = createInitialDraft(renderCmd, ctx);
    const spec = buildCliInvocation({ commandId: "render" }, ctx);

    const spanDef = spec.envDef.find((e) => e.key === "SPAN");
    const chunksDef = spec.envDef.find((e) => e.key === "CHUNKS");
    assert.ok(spanDef?.exclusiveGroup);
    assert.equal(spanDef?.exclusiveGroup, chunksDef?.exclusiveGroup);

    const first = setDraftFieldWithExclusiveClear(
      initial,
      spec,
      "env",
      "SPAN",
      "0-4",
      spanDef?.exclusiveGroup,
    );
    assert.equal(first.next.env.SPAN, "0-4");
    assert.equal(first.cleared.length, 0);

    const second = setDraftFieldWithExclusiveClear(
      first.next,
      spec,
      "env",
      "CHUNKS",
      "2",
      chunksDef?.exclusiveGroup,
    );
    assert.equal(second.next.env.CHUNKS, "2");
    assert.equal(second.next.env.SPAN, undefined);
    assert.ok(second.cleared.includes("SPAN"));
  });

  test("visibleWhen hides mocap-only flags when --kind is non-mocap and keeps them hidden from lego tokens", () => {
    const findCmd = findCliCommand("find");
    assert.ok(findCmd);
    const ctx = makeContext();
    const draft = createInitialDraft(findCmd, ctx);
    draft.flags["--kind"] = "sfx";
    draft.flags["--from"] = "stand";
    const spec = buildCliInvocation(
      { commandId: "find", flags: draft.flags, targetFilm: "active" },
      ctx,
    );
    const fromDef = spec.flagsDef.find((f) => f.key === "--from");
    assert.ok(fromDef?.visibleWhen);
    assert.equal(isFieldVisible(fromDef.visibleWhen, draft.flags), false);
    const tokens = listActiveLegoTokens(spec, draft);
    assert.ok(!tokens.some((t) => t.key === "--from"));
    assert.ok(!spec.argvTokens.includes("--from"));
  });

  test("filterCommands searches names, subcommands, flags, and categories", () => {
    assert.ok(filterCommands(CLI_COMMANDS, "--jev", "all").some((c) => c.id === "find"));
    assert.ok(filterCommands(CLI_COMMANDS, "forge", "sound").some((c) => c.id === "earshot"));
    assert.equal(filterCommands(CLI_COMMANDS, "--jev", "dev").length, 0);
  });

  test("template preview preserves confirm gate for paid templates", () => {
    const ctx = makeContext();
    const voiceCmd = findCliCommand("voice:gen");
    assert.ok(voiceCmd);
    const tpl = {
      id: "tpl-1",
      name: "Generate Intro Voice (--yes)",
      commandId: "voice:gen",
      subcommandPath: [],
      args: { ids: "intro" },
      flags: { "--yes": true },
      env: {},
      targetFilm: "active",
      createdAt: 1,
      updatedAt: 1,
    };
    const draft = draftFromTemplate(tpl, voiceCmd);
    assert.equal(draft.flags["--yes"], true);
    const preview = buildTemplatePreviewCommand(tpl, ctx);
    assert.ok(preview.spec?.requiresConfirm);
    assert.equal(filterTemplates([tpl], "stone").length, 0);
    assert.equal(filterTemplates([tpl], "intro").length, 1);
  });
});

describe("CLI tab SSR UI rendering", () => {
  test("CliBrowse renders all categories, templates, and hazard badges cleanly", () => {
    const ctx = makeContext();
    const catalog = { categories: CLI_CATEGORIES, commands: CLI_COMMANDS, context: ctx };
    const templates = [
      {
        id: "tpl-1",
        name: "Generate Voice (--yes)",
        commandId: "voice:gen",
        subcommandPath: [],
        args: { ids: "intro" },
        flags: { "--yes": true },
        env: {},
        targetFilm: "active",
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const html = renderToStaticMarkup(
      wrapTree(
        createElement(CliBrowse, {
          catalog,
          templates,
          searchQuery: "",
          selectedCategory: "all",
          activeRun: null,
          lastRun: null,
          onSearchChange: () => {},
          onSelectCategory: () => {},
          onOpenCommand: () => {},
          onRunTemplate: () => {},
          onEditTemplate: () => {},
          onDeleteTemplate: async () => true,
          onRestoreTemplate: async () => true,
          onStopRun: () => {},
        }),
      ),
    );
    assert.ok(html.includes("Saved templates"));
    assert.ok(html.includes("Generate Voice (--yes)"));
    assert.ok(html.includes("Review &amp; run"));
    for (const cat of CLI_CATEGORIES) {
      assert.ok(html.includes(cat.label.replaceAll("&", "&amp;")), `Missing category ${cat.label}`);
    }
  });

  test("CliWorkbench swaps rendered options when changing find <-> check", () => {
    const ctx = makeContext();
    const catalog = { categories: CLI_CATEGORIES, commands: CLI_COMMANDS, context: ctx };
    const findCmd = findCliCommand("find");
    const checkCmd = findCliCommand("check");
    assert.ok(findCmd && checkCmd);

    const commonProps = {
      catalog,
      editingTemplateName: null,
      activeRun: null,
      lastRun: null,
      consoleExpanded: false,
      submittingRun: false,
      runError: null,
      clearedHint: null,
      onBack: () => {},
      onSelectCategory: () => {},
      onSelectCommand: () => {},
      onSelectSubcommand: () => {},
      onSelectTargetFilm: () => {},
      onUpdateField: () => {},
      onRemoveToken: () => {},
      onReset: () => {},
      onRun: () => {},
      onStopRun: () => {},
      onClearConsole: () => {},
      onToggleExpandConsole: () => {},
      onOpenSaveTemplate: () => {},
    };

    const findHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliWorkbench, {
          ...commonProps,
          command: findCmd,
          draft: createInitialDraft(findCmd, ctx),
        }),
      ),
    );
    assert.ok(findHtml.includes("--jev"));

    const checkHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliWorkbench, {
          ...commonProps,
          command: checkCmd,
          draft: createInitialDraft(checkCmd, ctx),
        }),
      ),
    );
    assert.ok(!checkHtml.includes("--jev"));
  });

  test("CliFieldControl renders boolean, optionalValue csv+input, string detected choices, and multi choices", () => {
    const ctx = makeContext();
    const findCmd = findCliCommand("find");
    const initCmd = findCliCommand("studio:init");
    assert.ok(findCmd && initCmd);
    const sourceDef = findCmd.flags?.find((f) => f.key === "--source");
    const kindDef = findCmd.flags?.find((f) => f.key === "--kind");
    const jevDef = findCmd.flags?.find((f) => f.key === "--jev");
    const projectDef = initCmd.args?.find((a) => a.key === "project");
    assert.ok(sourceDef && kindDef && jevDef && projectDef);

    const optCsvHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliFieldControl, {
          def: kindDef,
          value: "",
          context: ctx,
          onChange: () => {},
        }),
      ),
    );
    assert.ok(optCsvHtml.includes("Leave empty to list available"));
    assert.ok(optCsvHtml.includes("sfx"));
    assert.ok(optCsvHtml.includes("<input"));

    const optSourceHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliFieldControl, {
          def: sourceDef,
          value: "",
          context: ctx,
          onChange: () => {},
        }),
      ),
    );
    assert.ok(optSourceHtml.includes("mixkit"));

    const initHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliFieldControl, {
          def: projectDef,
          value: "",
          context: ctx,
          onChange: () => {},
        }),
      ),
    );
    assert.ok(initHtml.includes("<input"));
    assert.ok(initHtml.includes("films/cell-break"));
    assert.ok(initHtml.includes("films/sealed-room"));

    const boolHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliFieldControl, {
          def: jevDef,
          value: true,
          context: ctx,
          onChange: () => {},
        }),
      ),
    );
    assert.ok(boolHtml.includes("--jev"));
  });

  test("CliConsole and CliBehaviorStrip surface exit code 2, non-color labels, region semantics, and missing keys", () => {
    const consoleHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliConsole, {
          run: {
            runId: "run-1",
            commandId: "find",
            subcommandPath: [],
            mode: "execute",
            displayCommand: "bun run find",
            cwd: "/repo/films/demo-film",
            targetFilm: "demo-film",
            status: "done",
            startedAt: 1000,
            finishedAt: 1500,
            exitCode: 2,
            signal: null,
            durationMs: 500,
            truncated: false,
            output: [
              { seq: 0, stream: "stderr", chunk: "Missing query\n" },
              { seq: 1, stream: "stdout", chunk: "Usage: bun run find <words>\n" },
            ],
          },
          expanded: false,
          onToggleExpand: () => {},
          onStop: () => {},
          onClear: () => {},
        }),
      ),
    );
    assert.ok(consoleHtml.includes("Exit 2 · Usage"));
    assert.ok(consoleHtml.includes("Missing query"));
    assert.ok(consoleHtml.includes("Usage: bun run find"));
    assert.ok(consoleHtml.includes("data-arrow-scroll"));
    assert.ok(consoleHtml.includes('role="region"'));
    assert.ok(consoleHtml.includes("wrap-break-word"));
    assert.ok(!consoleHtml.includes("Non-TTY piped capture"));

    const stripHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliBehaviorStrip, {
          meta: {
            effect: "write",
            cost: "paid",
            costHint: "ElevenLabs",
            speed: "long",
            cancellable: true,
            helpMode: "flag",
          },
          targetLabel: "films/demo-film",
          missingEnvGroups: [["ELEVENLABS_API_KEY"]],
        }),
      ),
    );
    assert.ok(stripHtml.includes("Writes files"));
    assert.ok(stripHtml.includes("Paid API"));
    assert.ok(stripHtml.includes("May take a while"));
    assert.ok(stripHtml.includes("Process ends"));
    assert.ok(stripHtml.includes("Add ELEVENLABS_API_KEY"));
    assert.equal(getEffectLabel("write"), "Writes files");
    assert.equal(getEffectLabel("destructive"), "Changes many files");
  });
});

describe("CLI store async flows, target preservation & hotkey guard", () => {
  test("resolveSaveTemplateTargets exposes current project and supported root only", () => {
    const demoPlan = resolveSaveTemplateTargets({
      initialTargetFilm: "cell-break",
      activeFilm: null,
      films: ["cell-break", "sealed-room"],
      supportsFilmTarget: true,
      supportsRootTarget: true,
    });
    assert.equal(demoPlan.defaultTarget, "active");
    assert.ok(!demoPlan.items.some((i) => i.value === "cell-break"));
    assert.ok(demoPlan.items.some((i) => i.value === "root"));

    const crossFilmPlan = resolveSaveTemplateTargets({
      initialTargetFilm: "sealed-room",
      activeFilm: "cell-break",
      films: ["cell-break", "sealed-room"],
      supportsFilmTarget: true,
      supportsRootTarget: false,
    });
    assert.equal(crossFilmPlan.defaultTarget, "active");
    assert.ok(!crossFilmPlan.items.some((i) => i.value === "root"));

    const rootSelectedPlan = resolveSaveTemplateTargets({
      initialTargetFilm: "root",
      activeFilm: "cell-break",
      films: ["cell-break"],
      supportsFilmTarget: true,
      supportsRootTarget: true,
    });
    assert.equal(rootSelectedPlan.defaultTarget, "root");

    const rootOnlyPlan = resolveSaveTemplateTargets({
      initialTargetFilm: "cell-break",
      activeFilm: "cell-break",
      films: ["cell-break"],
      supportsFilmTarget: false,
      supportsRootTarget: true,
    });
    assert.equal(rootOnlyPlan.defaultTarget, "root");
    assert.equal(rootOnlyPlan.items.length, 0);
  });

  test("stopCliHotkeyPropagation blocks unmodified keys & Mod+A in text controls without catching Escape", () => {
    let stopped = 0;
    const mk = (key, opts = {}) => ({
      key,
      metaKey: Boolean(opts.metaKey),
      ctrlKey: Boolean(opts.ctrlKey),
      altKey: Boolean(opts.altKey),
      target: opts.target ?? { matches: () => false },
      stopPropagation: () => {
        stopped += 1;
      },
    });

    stopCliHotkeyPropagation(mk(" "));
    stopCliHotkeyPropagation(mk("ArrowLeft"));
    stopCliHotkeyPropagation(mk("="));
    stopCliHotkeyPropagation(mk("P"));
    assert.equal(stopped, 4);

    stopCliHotkeyPropagation(
      mk("a", { ctrlKey: true, target: { matches: (sel) => sel.includes("pre") } }),
    );
    assert.equal(stopped, 5);

    stopCliHotkeyPropagation(mk("a", { ctrlKey: true }));
    stopCliHotkeyPropagation(mk("Escape"));
    assert.equal(stopped, 5);
  });

  test("stopCurrentRun keeps SSE open on non-terminal /stop and finishes on SSE done with trailing chunk", async () => {
    const origFetch = globalThis.fetch;
    const origES = globalThis.EventSource;
    const savedState = cliStore.getState();

    const listeners = new Map();
    let esClosed = false;
    class FakeEventSource {
      constructor() {
        FakeEventSource.instances.push(this);
      }
      addEventListener(type, fn) {
        listeners.set(type, fn);
      }
      close() {
        esClosed = true;
      }
    }
    FakeEventSource.instances = [];

    const runningRun = {
      runId: "r-stop-1",
      commandId: "render",
      subcommandPath: [],
      mode: "execute",
      displayCommand: "bun run render",
      cwd: "/repo/films/cell-break",
      targetFilm: "cell-break",
      status: "running",
      startedAt: 1000,
      truncated: false,
      output: [{ seq: 0, stream: "stdout", chunk: "frame 1\n" }],
    };

    try {
      globalThis.EventSource = FakeEventSource;
      globalThis.fetch = async (url) => {
        const sUrl = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
        if (sUrl.includes("/api/cli/runs/r-stop-1/stop")) {
          return new Response(JSON.stringify({ ok: true, run: runningRun }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ active: null, last: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      cliStore.setState({
        activeRun: runningRun,
        lastRun: null,
        stoppingRunId: null,
      });

      await stopCurrentRun("r-stop-1");
      assert.equal(cliStore.getState().stoppingRunId, "r-stop-1");
      assert.equal(cliStore.getState().activeRun?.runId, "r-stop-1");
      assert.equal(cliStore.getState().lastRun, null);
      assert.equal(esClosed, false);

      const onChunk = listeners.get("chunk");
      const onDone = listeners.get("done");
      assert.ok(onChunk && onDone);

      onChunk({
        data: JSON.stringify({ seq: 1, stream: "stderr", chunk: "cleanup complete\n" }),
      });
      onDone({
        data: JSON.stringify({
          runId: "r-stop-1",
          status: "stopped",
          signal: "SIGTERM",
          durationMs: 250,
          truncated: false,
        }),
      });

      const after = cliStore.getState();
      assert.equal(after.stoppingRunId, null);
      assert.equal(after.activeRun, null);
      assert.equal(after.lastRun?.status, "stopped");
      assert.equal(after.lastRun?.signal, "SIGTERM");
      assert.equal(after.lastRun?.output.length, 2);
      assert.equal(after.lastRun?.output[1]?.chunk, "cleanup complete\n");
      assert.equal(esClosed, true);
    } finally {
      globalThis.fetch = origFetch;
      globalThis.EventSource = origES;
      cliStore.setState(savedState);
    }
  });

  test("syncCatalogForTarget updates catalog on template pin & active reset, and CONFIRM_REQUIRED opens fallback dialog", async () => {
    const origFetch = globalThis.fetch;
    const savedState = cliStore.getState();
    const fetchedUrls = [];
    const ctx = makeContext();

    try {
      globalThis.fetch = async (url, init) => {
        const sUrl = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
        fetchedUrls.push(sUrl);
        if (sUrl.startsWith("/api/cli/catalog")) {
          return new Response(
            JSON.stringify({ categories: CLI_CATEGORIES, commands: CLI_COMMANDS, context: ctx }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (sUrl === "/api/cli/run" && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              error: "Confirmation required",
              code: "CONFIRM_REQUIRED",
              confirmMessage: "Spend ElevenLabs credits?",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("{}", { status: 404 });
      };

      cliStore.setState({
        catalog: { categories: CLI_CATEGORIES, commands: CLI_COMMANDS, context: ctx },
        catalogFilmQuery: null,
        confirmPending: null,
      });

      openTemplateInWorkbench({
        id: "tpl-pin",
        name: "Sealed room find",
        commandId: "find",
        subcommandPath: [],
        args: {},
        flags: {},
        env: {},
        targetFilm: "sealed-room",
        createdAt: 1,
        updatedAt: 1,
      });
      await new Promise((r) => setTimeout(r, 10));
      assert.ok(fetchedUrls.includes("/api/cli/catalog?film=sealed-room"));
      assert.equal(cliStore.getState().catalogFilmQuery, "sealed-room");

      setDraftTargetFilm("find", "active");
      await new Promise((r) => setTimeout(r, 10));
      assert.ok(fetchedUrls.includes("/api/cli/catalog"));
      assert.equal(cliStore.getState().catalogFilmQuery, null);

      await dispatchCliRun({
        commandId: "voice:gen",
        subcommandPath: [],
        flags: { "--yes": true },
        targetFilm: "active",
        mode: "execute",
      });
      const pending = cliStore.getState().confirmPending;
      assert.ok(pending);
      assert.equal(pending.dialog.reason, "Spend ElevenLabs credits?");
      assert.ok(pending.dialog.displayCommand.includes("voice:gen"));
    } finally {
      globalThis.fetch = origFetch;
      cliStore.setState(savedState);
    }
  });

  test("commitSaveTemplate keeps dialog open & sets saveError on failure; SaveTemplateForm renders saveError alert", async () => {
    const origFetch = globalThis.fetch;
    const savedState = cliStore.getState();
    const ctx = makeContext();
    const findCmd = findCliCommand("find");
    assert.ok(findCmd);
    const draft = createInitialDraft(findCmd, ctx);

    try {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: "Template limit reached" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });

      cliStore.setState({
        saveDialogOpen: true,
        savingTemplate: false,
        saveError: null,
        runError: null,
      });

      const created = await commitSaveTemplate({
        name: "Will Fail",
        targetFilm: "active",
        draft,
      });
      assert.equal(created, null);
      assert.equal(cliStore.getState().saveDialogOpen, true);
      assert.equal(cliStore.getState().savingTemplate, false);
      assert.equal(cliStore.getState().saveError, "Template limit reached");
      assert.equal(cliStore.getState().runError, null);
    } finally {
      globalThis.fetch = origFetch;
      cliStore.setState(savedState);
    }

    const dlgHtml = renderToStaticMarkup(
      wrapTree(
        createElement(SaveTemplatePanel, {
          initialName: "Will Fail",
          initialTargetFilm: "active",
          activeFilm: ctx.activeFilm,
          films: ctx.films,
          supportsFilmTarget: true,
          supportsRootTarget: true,
          displayCommand: "bun run find",
          editingExisting: false,
          saving: false,
          saveError: "Template limit reached",
          onSave: () => {},
          onClose: () => {},
        }),
      ),
    );
    assert.ok(dlgHtml.includes("Template limit reached"));
    assert.ok(dlgHtml.includes('role="alert"'));
  });

  test("CliBrowse renders runError & templatesError alerts and confirmed Browse run failure stays visible on browse", async () => {
    const origFetch = globalThis.fetch;
    const savedState = cliStore.getState();
    const ctx = makeContext();
    const catalog = { categories: CLI_CATEGORIES, commands: CLI_COMMANDS, context: ctx };

    const browseHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliBrowse, {
          catalog,
          templates: [],
          searchQuery: "",
          selectedCategory: "all",
          activeRun: null,
          lastRun: null,
          runError: "Film directory missing",
          templatesError: "Failed to save templates.json",
          catalogError: "Catalog refresh HTTP 500",
          onDismissRunError: () => {},
          onDismissTemplatesError: () => {},
          onDismissCatalogError: () => {},
          onRetryCatalog: () => {},
          onSearchChange: () => {},
          onSelectCategory: () => {},
          onOpenCommand: () => {},
          onRunTemplate: () => {},
          onEditTemplate: () => {},
          onDeleteTemplate: async () => true,
          onRestoreTemplate: async () => true,
          onStopRun: () => {},
        }),
      ),
    );
    assert.ok(browseHtml.includes("Film directory missing"));
    assert.ok(browseHtml.includes("Failed to save templates.json"));
    assert.ok(browseHtml.includes("Catalog refresh HTTP 500"));
    assert.ok(browseHtml.includes("Retry"));
    assert.ok(browseHtml.includes('role="alert"'));

    try {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: "Film locked by render" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      cliStore.setState({ view: "browse", runError: null, confirmPending: null });
      await dispatchCliRun(
        {
          commandId: "voice:gen",
          subcommandPath: [],
          args: { ids: "intro" },
          flags: { "--yes": true },
          targetFilm: "active",
          confirmed: true,
          mode: "execute",
        },
        {
          openWorkbench: true,
          templateToLoad: {
            id: "tpl-fail",
            name: "Locked Voice",
            commandId: "voice:gen",
            subcommandPath: [],
            args: { ids: "intro" },
            flags: { "--yes": true },
            env: {},
            targetFilm: "active",
            createdAt: 1,
            updatedAt: 1,
          },
        },
      );
      assert.equal(cliStore.getState().view, "browse");
      assert.equal(cliStore.getState().runError, "Film locked by render");
    } finally {
      globalThis.fetch = origFetch;
      cliStore.setState(savedState);
    }
  });

  test("removeTemplate and restoreDeletedTemplate return boolean & populate templatesError without throwing", async () => {
    const origFetch = globalThis.fetch;
    const savedState = cliStore.getState();
    const sampleTpl = {
      id: "tpl-del",
      name: "Find SFX",
      commandId: "find",
      subcommandPath: [],
      args: {},
      flags: {},
      env: {},
      targetFilm: "active",
      createdAt: 1,
      updatedAt: 1,
    };

    try {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: "Disk read-only" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      cliStore.setState({ templates: [sampleTpl], templatesError: null });

      const deleted = await removeTemplate("tpl-del");
      assert.equal(deleted, false);
      assert.equal(cliStore.getState().templatesError, "Disk read-only");
      assert.equal(cliStore.getState().templates.length, 1);

      const restored = await restoreDeletedTemplate(sampleTpl);
      assert.equal(restored, false);
      assert.equal(cliStore.getState().templatesError, "Disk read-only");

      globalThis.fetch = async (_url, init) => {
        if (init?.method === "DELETE") {
          return new Response(JSON.stringify({ templates: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ template: sampleTpl, templates: [sampleTpl] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      const okDel = await removeTemplate("tpl-del");
      assert.equal(okDel, true);
      assert.equal(cliStore.getState().templatesError, null);
      assert.equal(cliStore.getState().templates.length, 0);

      const okRes = await restoreDeletedTemplate(sampleTpl);
      assert.equal(okRes, true);
      assert.equal(cliStore.getState().templatesError, null);
      assert.equal(cliStore.getState().templates.length, 1);
    } finally {
      globalThis.fetch = origFetch;
      cliStore.setState(savedState);
    }
  });

  test("refreshCliCatalog ignores stale out-of-order responses", async () => {
    const origFetch = globalThis.fetch;
    const savedState = cliStore.getState();
    let resolveSlow;
    const slowPromise = new Promise((r) => {
      resolveSlow = r;
    });

    try {
      globalThis.fetch = async (url) => {
        const sUrl = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
        if (sUrl.includes("cell-break")) {
          await slowPromise;
          return new Response(
            JSON.stringify({
              categories: CLI_CATEGORIES,
              commands: CLI_COMMANDS,
              context: makeContext({ activeFilm: "cell-break" }),
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            categories: CLI_CATEGORIES,
            commands: CLI_COMMANDS,
            context: makeContext({ activeFilm: "sealed-room" }),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      };

      const p1 = refreshCliCatalog("cell-break");
      const p2 = refreshCliCatalog("sealed-room");
      await p2;
      resolveSlow();
      await p1;

      assert.equal(cliStore.getState().catalog?.context.activeFilm, "sealed-room");
      assert.equal(cliStore.getState().catalogFilmQuery, "sealed-room");
    } finally {
      globalThis.fetch = origFetch;
      cliStore.setState(savedState);
    }
  });

  test("CliFieldControl honors requiredOverride even when static def.required is false", () => {
    const ctx = makeContext();
    const renderCmd = findCliCommand("render");
    assert.ok(renderCmd);
    const atEnv = renderCmd.env?.find((e) => e.key === "AT");
    assert.ok(atEnv);

    const html = renderToStaticMarkup(
      wrapTree(
        createElement(CliFieldControl, {
          def: atEnv,
          value: undefined,
          context: ctx,
          requiredOverride: true,
          onChange: () => {},
        }),
      ),
    );
    assert.ok(html.includes("Required"));
  });

  test("buildVerbatimCopyText joins non-empty stdout/stderr and run.error cleanly, and retryCliPanel reloads all endpoints", async () => {
    assert.equal(
      buildVerbatimCopyText({
        runId: "r-copy",
        commandId: "check",
        subcommandPath: [],
        mode: "execute",
        displayCommand: "bun run check",
        cwd: "/repo/films/demo-film",
        targetFilm: "demo-film",
        status: "done",
        startedAt: 1,
        truncated: false,
        output: [{ seq: 0, stream: "stdout", chunk: "Checking shots" }],
        error: "Process terminated",
      }),
      "Checking shots\nProcess terminated",
    );
    assert.equal(buildVerbatimCopyText(null), "");

    const origFetch = globalThis.fetch;
    const savedState = cliStore.getState();
    const seen = [];
    try {
      globalThis.fetch = async (url) => {
        const sUrl = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
        seen.push(sUrl);
        if (sUrl.startsWith("/api/cli/catalog")) {
          return new Response(
            JSON.stringify({
              categories: CLI_CATEGORIES,
              commands: CLI_COMMANDS,
              context: makeContext(),
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (sUrl === "/api/cli/templates") {
          return new Response(JSON.stringify({ templates: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ active: null, last: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      cliStore.setState({
        catalogError: "Offline",
        templatesError: "Failed",
        catalogFilmQuery: null,
      });
      await retryCliPanel();
      assert.equal(cliStore.getState().catalogError, null);
      assert.equal(cliStore.getState().templatesError, null);
      assert.ok(seen.includes("/api/cli/catalog"));
      assert.ok(seen.includes("/api/cli/templates"));
      assert.ok(seen.includes("/api/cli/runs"));
    } finally {
      globalThis.fetch = origFetch;
      cliStore.setState(savedState);
    }
  });

  test("CliWorkbench renders conditional AT Required on render poster, hides ENTRY/LAB_VIEW on captions, and preserves ../../scripts/timeline_fmt.ts", () => {
    const ctx = makeContext();
    const catalog = { categories: CLI_CATEGORIES, commands: CLI_COMMANDS, context: ctx };
    const renderCmd = findCliCommand("render");
    const fmtCmd = findCliCommand("timeline:fmt");
    assert.ok(renderCmd && fmtCmd);

    const commonProps = {
      catalog,
      command: renderCmd,
      editingTemplateName: null,
      activeRun: null,
      lastRun: null,
      consoleExpanded: false,
      submittingRun: false,
      runError: null,
      clearedHint: null,
      onBack: () => {},
      onSelectCategory: () => {},
      onSelectCommand: () => {},
      onSelectSubcommand: () => {},
      onSelectTargetFilm: () => {},
      onUpdateField: () => {},
      onRemoveToken: () => {},
      onReset: () => {},
      onRun: () => {},
      onStopRun: () => {},
      onClearConsole: () => {},
      onToggleExpandConsole: () => {},
      onOpenSaveTemplate: () => {},
    };

    const posterDraft = createInitialDraft(renderCmd, ctx);
    posterDraft.args.target = "poster";
    const posterHtml = renderToStaticMarkup(
      wrapTree(createElement(CliWorkbench, { ...commonProps, draft: posterDraft })),
    );
    const posterAtIdx = posterHtml.indexOf("AT (Heard Seconds)");
    assert.ok(posterAtIdx >= 0);
    assert.ok(posterHtml.slice(posterAtIdx, posterAtIdx + 240).includes("Required"));
    assert.ok(posterHtml.includes("ENTRY"));

    const stillsDraft = createInitialDraft(renderCmd, ctx);
    stillsDraft.args.target = "stills";
    const stillsHtml = renderToStaticMarkup(
      wrapTree(createElement(CliWorkbench, { ...commonProps, draft: stillsDraft })),
    );
    const stillsAtIdx = stillsHtml.indexOf("AT (Heard Seconds)");
    assert.ok(stillsAtIdx >= 0);
    assert.ok(!stillsHtml.slice(stillsAtIdx, stillsAtIdx + 240).includes("Required"));

    const captionsDraft = createInitialDraft(renderCmd, ctx);
    captionsDraft.args.target = "captions";
    const captionsHtml = renderToStaticMarkup(
      wrapTree(createElement(CliWorkbench, { ...commonProps, draft: captionsDraft })),
    );
    assert.ok(!captionsHtml.includes("ENTRY"));
    assert.ok(!captionsHtml.includes("LAB_VIEW"));

    const fmtSpec = buildCliInvocation({ commandId: "timeline:fmt", targetFilm: "active" }, ctx);
    assert.ok(fmtSpec.displayCommand.includes("../../scripts/timeline_fmt.ts"));
  });

  test("CliBehaviorStrip differentiates !cancellable read, daemon, and write commands", () => {
    const readHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliBehaviorStrip, {
          meta: {
            effect: "read",
            cost: "free",
            speed: "instant",
            cancellable: false,
            helpMode: "flag",
          },
          targetLabel: "repo root",
          missingEnvGroups: [],
        }),
      ),
    );
    assert.ok(readHtml.includes("Process ends"));
    assert.ok(!readHtml.includes("Kills process"));

    const daemonHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliBehaviorStrip, {
          meta: {
            effect: "daemon",
            cost: "free",
            speed: "long",
            cancellable: false,
            helpMode: "none",
          },
          targetLabel: "films/demo-film",
          missingEnvGroups: [],
        }),
      ),
    );
    assert.ok(daemonHtml.includes("Server closes"));
    assert.ok(!daemonHtml.includes("Kills process"));

    const writeHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliBehaviorStrip, {
          meta: {
            effect: "write",
            cost: "free",
            speed: "short",
            cancellable: false,
            helpMode: "flag",
          },
          targetLabel: "films/demo-film",
          missingEnvGroups: [],
        }),
      ),
    );
    assert.ok(writeHtml.includes("Stopping does not undo saved changes"));
  });

  test("CliFieldControl optionalValue avoids 'list values' copy on deliver --youtube and honors bareLabel/bareHint", () => {
    const ctx = makeContext();
    const deliverCmd = findCliCommand("deliver");
    assert.ok(deliverCmd);
    const youtubeFlag = deliverCmd.flags.find((f) => f.key === "--youtube");
    assert.ok(youtubeFlag);

    const ytHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliFieldControl, {
          def: youtubeFlag,
          value: "",
          context: ctx,
          onChange: () => {},
        }),
      ),
    );
    assert.ok(!ytHtml.includes("list values"));
    assert.ok(ytHtml.includes("full-film AV1 check"));

    const customEnumFlag = {
      key: "--mode",
      flag: "--mode",
      label: "Mode",
      type: "enum",
      optionalValue: true,
      options: ["fast", "full"],
      bareLabel: "(bare flag — full check)",
      bareHint: "Empty runs full check; pick a mode to narrow.",
    };
    const customHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliFieldControl, {
          def: customEnumFlag,
          value: "",
          context: ctx,
          onChange: () => {},
        }),
      ),
    );
    assert.ok(customHtml.includes("(bare flag — full check)"));
    assert.ok(!customHtml.includes("(bare flag — list values)"));

    const defaultEnumFlag = {
      key: "--scope",
      flag: "--scope",
      label: "Scope",
      type: "enum",
      optionalValue: true,
      options: ["a", "b"],
    };
    const defaultEnumHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliFieldControl, {
          def: defaultEnumFlag,
          value: "",
          context: ctx,
          onChange: () => {},
        }),
      ),
    );
    assert.ok(defaultEnumHtml.includes("Use the default behavior"));
    assert.ok(!defaultEnumHtml.includes("(bare flag — list values)"));
  });

  test("refreshCliTemplates surfaces corrupt cli-templates.json warning into templatesError", async () => {
    const origFetch = globalThis.fetch;
    const savedState = cliStore.getState();

    try {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            templates: [],
            warning: "Saved templates file is corrupted; loaded empty list.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );

      cliStore.setState({ templates: [], templatesError: null, templatesLoaded: false });
      await refreshCliTemplates();
      assert.equal(
        cliStore.getState().templatesError,
        "Saved templates file is corrupted; loaded empty list.",
      );
      assert.equal(cliStore.getState().templatesLoaded, true);

      globalThis.fetch = async () =>
        new Response(JSON.stringify({ templates: [], warning: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      await refreshCliTemplates();
      assert.equal(cliStore.getState().templatesError, null);
    } finally {
      globalThis.fetch = origFetch;
      cliStore.setState(savedState);
    }
  });

  test("formatTargetBadgeText never emits films/root and resolves root vs film targets cleanly", () => {
    const ctx = makeContext();
    assert.equal(formatTargetBadgeText("root", "active", ctx), "repo root");
    assert.equal(formatTargetBadgeText("root", "root", ctx), "repo root");
    assert.equal(formatTargetBadgeText("film", "root", ctx), "films/demo-film");
    assert.equal(formatTargetBadgeText("film", "active", ctx), "films/demo-film");
    assert.equal(formatTargetBadgeText("film", "", ctx), "films/demo-film");
    assert.equal(formatTargetBadgeText("film", "other-film", ctx), "films/demo-film");
    assert.equal(
      formatTargetBadgeText("film", "root", { ...ctx, activeFilm: null, films: [] }),
      "Current project",
    );
  });

  test("CliBrowse uses HorizontalScrollRail group for categories and disables invalid template Run with validation title", () => {
    const ctx = makeContext();
    const catalog = { categories: CLI_CATEGORIES, commands: CLI_COMMANDS, context: ctx };
    const incompleteTpl = {
      id: "tpl-incomplete",
      name: "Init missing project",
      commandId: "studio:init",
      subcommandPath: [],
      args: {},
      flags: {},
      env: {},
      targetFilm: "root",
      createdAt: 1,
      updatedAt: 1,
    };

    const browseHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliBrowse, {
          catalog,
          templates: [incompleteTpl],
          searchQuery: "",
          selectedCategory: "all",
          activeRun: null,
          lastRun: null,
          onSearchChange: () => {},
          onSelectCategory: () => {},
          onOpenCommand: () => {},
          onRunTemplate: () => {},
          onEditTemplate: () => {},
          onDeleteTemplate: async () => true,
          onRestoreTemplate: async () => true,
          onStopRun: () => {},
        }),
      ),
    );

    const catIdx = browseHtml.indexOf('aria-label="CLI categories"');
    assert.ok(catIdx >= 0);
    const catSlice = browseHtml.slice(Math.max(0, catIdx - 140), catIdx + 180);
    assert.ok(catSlice.includes('role="group"'));
    assert.ok(catSlice.includes("overflow-x-auto"));

    // Template card Run button should be disabled when required args are missing
    const { spec: invalidSpec } = buildTemplatePreviewCommand(incompleteTpl, ctx);
    assert.ok(invalidSpec && invalidSpec.validationErrors.length > 0);
    const tplIdx = browseHtml.indexOf("Init missing project");
    assert.ok(tplIdx >= 0);
    const sectionEnd = browseHtml.indexOf("</section>", tplIdx);
    const cardSlice = browseHtml.slice(tplIdx, sectionEnd >= 0 ? sectionEnd : tplIdx + 8000);
    assert.ok(cardSlice.includes(`title="${invalidSpec.validationErrors[0]}"`));
    assert.ok(cardSlice.includes('disabled=""'));
  });

  test("CliConsole expands in compact mode without max-h-72 clamp and adds title on outputsHint", () => {
    const consoleHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliConsole, {
          run: {
            runId: "r-compact",
            commandId: "find",
            subcommandPath: [],
            mode: "execute",
            displayCommand: "bun run find",
            cwd: "/repo",
            targetFilm: "root",
            status: "done",
            exitCode: 0,
            startedAt: 1,
            finishedAt: 2,
            durationMs: 1,
            truncated: false,
            output: [{ seq: 0, stream: "stdout", chunk: "ok\n" }],
          },
          expanded: false,
          compact: true,
          outputsHint: "Prints matching sound and asset paths",
          onToggleExpand: () => {},
          onStop: () => {},
          onClear: () => {},
        }),
      ),
    );
    assert.ok(!consoleHtml.includes("max-h-72"));
    assert.ok(consoleHtml.includes("flex-1"));
    assert.ok(consoleHtml.includes('title="Prints matching sound and asset paths"'));
  });

  test("CliFieldControl binds aria-labelledby on multi-choice chip group", () => {
    const ctx = makeContext();
    const multiFlag = {
      key: "--kinds",
      flag: "--kinds",
      label: "Kinds",
      type: "choice",
      multi: true,
      options: ["sfx", "music"],
    };
    const html = renderToStaticMarkup(
      wrapTree(
        createElement(CliFieldControl, {
          def: multiFlag,
          value: ["sfx"],
          context: ctx,
          onChange: () => {},
        }),
      ),
    );
    const idMatch = html.match(/<label[^>]*id="([^"]+)"[^>]*>Kinds/);
    assert.ok(idMatch);
    assert.ok(html.includes(`role="group" aria-labelledby="${idMatch[1]}"`));
  });

  test("Compact CliWorkbench switches Configure/Output cleanly and auto-focuses Output on run or focusConsoleRunId", async () => {
    const ctx = makeContext();
    const catalog = { categories: CLI_CATEGORIES, commands: CLI_COMMANDS, context: ctx };
    const findCmd = findCliCommand("find");
    assert.ok(findCmd);
    const draft = createInitialDraft(findCmd, ctx);
    const run = {
      runId: "r-compact-focus",
      commandId: "find",
      subcommandPath: [],
      mode: "help",
      displayCommand: "bun run find -h",
      cwd: "/repo",
      targetFilm: "root",
      status: "done",
      exitCode: 0,
      startedAt: 1,
      finishedAt: 50,
      durationMs: 49,
      truncated: false,
      output: [{ seq: 0, stream: "stdout", chunk: "Usage: find\n" }],
    };

    const builderHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliWorkbench, {
          catalog,
          command: findCmd,
          draft,
          editingTemplateName: null,
          activeRun: null,
          lastRun: run,
          consoleExpanded: false,
          focusConsoleRunId: null,
          initialCompact: true,
          submittingRun: false,
          runError: null,
          clearedHint: null,
          onBack: () => {},
          onSelectCategory: () => {},
          onSelectCommand: () => {},
          onSelectSubcommand: () => {},
          onSelectTargetFilm: () => {},
          onUpdateField: () => {},
          onRemoveToken: () => {},
          onReset: () => {},
          onRun: () => {},
          onStopRun: () => {},
          onClearConsole: () => {},
          onToggleExpandConsole: () => {},
          onConsumeFocusRun: () => {},
          onOpenSaveTemplate: () => {},
        }),
      ),
    );
    assert.ok(builderHtml.includes('aria-label="CLI pane section"'));
    assert.ok(builderHtml.includes("Configure"));
    assert.ok(builderHtml.includes("Output"));
    assert.ok(builderHtml.includes("Run"));
    assert.ok(!builderHtml.includes("Usage: find"));

    const outputHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliWorkbench, {
          catalog,
          command: findCmd,
          draft,
          editingTemplateName: null,
          activeRun: null,
          lastRun: run,
          consoleExpanded: false,
          focusConsoleRunId: "r-compact-focus",
          initialCompact: true,
          submittingRun: false,
          runError: null,
          clearedHint: null,
          onBack: () => {},
          onSelectCategory: () => {},
          onSelectCommand: () => {},
          onSelectSubcommand: () => {},
          onSelectTargetFilm: () => {},
          onUpdateField: () => {},
          onRemoveToken: () => {},
          onReset: () => {},
          onRun: () => {},
          onStopRun: () => {},
          onClearConsole: () => {},
          onToggleExpandConsole: () => {},
          onConsumeFocusRun: () => {},
          onOpenSaveTemplate: () => {},
        }),
      ),
    );
    assert.ok(outputHtml.includes("Usage: find"));
    assert.ok(outputHtml.includes("Run"));

    // Pure transition rules:
    assert.deepEqual(
      nextCompactTabForChange({
        currentTab: "builder",
        prevRunId: "r-1",
        nextRunId: "r-1",
        prevScopeKey: "help:",
        nextScopeKey: "find:",
        focusConsoleRunId: "r-1",
      }),
      { nextTab: "output", consumeFocus: true },
    );
    assert.deepEqual(
      nextCompactTabForChange({
        currentTab: "builder",
        prevRunId: undefined,
        nextRunId: "r-2",
        prevScopeKey: "find:",
        nextScopeKey: "find:",
        focusConsoleRunId: null,
      }),
      { nextTab: "output", consumeFocus: false },
    );
    assert.deepEqual(
      nextCompactTabForChange({
        currentTab: "output",
        prevRunId: "r-2",
        nextRunId: "r-2",
        prevScopeKey: "earshot:doctor",
        nextScopeKey: "earshot:forge",
        focusConsoleRunId: null,
      }),
      { nextTab: "builder", consumeFocus: false },
    );
    assert.deepEqual(
      nextCompactTabForChange({
        currentTab: "output",
        prevRunId: "r-2",
        nextRunId: "r-2",
        prevScopeKey: "find:",
        nextScopeKey: "find:",
        focusConsoleRunId: null,
      }),
      { nextTab: "output", consumeFocus: false },
    );

    assert.deepEqual(
      nextCompactTabForChange({
        currentTab: "builder",
        prevRunId: undefined,
        nextRunId: "old-help",
        prevScopeKey: "find:",
        nextScopeKey: "help:",
        focusConsoleRunId: null,
      }),
      { nextTab: "builder", consumeFocus: false },
    );

    // Store focusConsoleRunId flow (Browse Output & Browse template Run):
    const origFetch = globalThis.fetch;
    const savedState = cliStore.getState();
    try {
      openCommandWorkbench("find", { focusRunId: "r-focus" });
      assert.equal(cliStore.getState().focusConsoleRunId, "r-focus");
      assert.equal(cliStore.getState().consoleExpanded, false);
      consumeFocusConsoleRun("r-other");
      assert.equal(cliStore.getState().focusConsoleRunId, "r-focus");
      consumeFocusConsoleRun("r-focus");
      assert.equal(cliStore.getState().focusConsoleRunId, null);

      globalThis.fetch = async (input) => {
        const href =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (href === "/api/cli/run") {
          return new Response(
            JSON.stringify({
              run: {
                runId: "r-tpl-start",
                commandId: "check",
                subcommandPath: [],
                mode: "execute",
                displayCommand: "bun run check",
                cwd: "/repo/films/cell-break",
                targetFilm: "cell-break",
                status: "done",
                exitCode: 0,
                startedAt: 1,
                finishedAt: 2,
                durationMs: 1,
                truncated: false,
                output: [],
              },
            }),
            { status: 202, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ runs: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      await dispatchCliRun(
        { commandId: "check", subcommandPath: [], targetFilm: "cell-break", mode: "execute" },
        { openWorkbench: true },
      );
      assert.equal(cliStore.getState().focusConsoleRunId, "r-tpl-start");
      assert.equal(cliStore.getState().consoleExpanded, false);
      assert.equal(cliStore.getState().view, "workbench");
    } finally {
      globalThis.fetch = origFetch;
      cliStore.setState(savedState);
    }
  });

  test("find --license renders free-text <input> with quick-pick pills, and voice:gen dry-run clears missing-key block while --yes enforces it", () => {
    const ctx = makeContext();
    ctx.envStatus = { GEMINI_API_KEY: false, ELEVENLABS_API_KEY: false };

    const findCmd = findCliCommand("find");
    assert.ok(findCmd);
    const licenseDef = findCmd.flags.find((f) => f.key === "--license");
    assert.ok(licenseDef);
    const licenseHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliFieldControl, {
          def: licenseDef,
          value: "cc0",
          context: ctx,
          onChange: () => {},
        }),
      ),
    );
    assert.ok(licenseHtml.includes("<input"));
    assert.ok(licenseHtml.includes("free"));
    assert.ok(licenseHtml.includes("mit"));

    const drySpec = buildCliInvocation(
      { commandId: "voice:gen", subcommandPath: [], flags: { "--dry-run": true } },
      ctx,
    );
    assert.equal(drySpec.missingEnvGroups.length, 0);
    const dryStripHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliBehaviorStrip, {
          meta: drySpec.meta,
          targetLabel: "films/demo-film",
          missingEnvGroups: drySpec.missingEnvGroups,
        }),
      ),
    );
    assert.ok(!dryStripHtml.includes("Need "));

    const liveSpec = buildCliInvocation(
      { commandId: "voice:gen", subcommandPath: [], flags: { "--yes": true } },
      ctx,
    );
    assert.ok(liveSpec.missingEnvGroups.length > 0);
    const liveStripHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliBehaviorStrip, {
          meta: liveSpec.meta,
          targetLabel: "films/demo-film",
          missingEnvGroups: liveSpec.missingEnvGroups,
        }),
      ),
    );
    assert.ok(liveStripHtml.includes("Add "));
    assert.ok(liveStripHtml.includes("ELEVENLABS_API_KEY"));
  });

  test("stopCliInputHotkeyPropagation lets Escape bubble while stopping b/Space, and stopCliTabHotkeyPropagation scopes to [data-cli-tab]", () => {
    let stopped = 0;
    const mk = (key, target) => ({
      key,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      target,
      stopPropagation: () => {
        stopped += 1;
      },
    });

    stopCliInputHotkeyPropagation(mk("Escape"));
    assert.equal(stopped, 0);
    stopCliInputHotkeyPropagation(mk("b"));
    stopCliInputHotkeyPropagation(mk(" "));
    assert.equal(stopped, 2);

    const onCliTab = { closest: (sel) => (sel === "[data-cli-tab]" ? {} : null) };
    const onNotesTab = { closest: () => null };

    stopCliTabHotkeyPropagation(mk("b", onNotesTab));
    stopCliTabHotkeyPropagation(mk(" ", onNotesTab));
    assert.equal(stopped, 2);

    stopCliTabHotkeyPropagation(mk("b", onCliTab));
    stopCliTabHotkeyPropagation(mk(" ", onCliTab));
    assert.equal(stopped, 4);

    stopCliTabHotkeyPropagation(mk("Escape", onCliTab));
    assert.equal(stopped, 4);
  });

  test("formatTargetBadgeText, CliLegoBar, and CliWorkbench show packageDir for package-script commands", () => {
    const ctx = makeContext();
    assert.equal(
      formatTargetBadgeText("root", "root", ctx, "packages/live-studio"),
      "packages/live-studio",
    );
    assert.equal(formatTargetBadgeText("root", "root", ctx, undefined), "repo root");

    const pkgCmd = findCliCommand("live-studio:test");
    assert.ok(pkgCmd);
    assert.equal(pkgCmd.runner, "package-script");
    assert.equal(pkgCmd.packageDir, "packages/live-studio");

    const draft = createInitialDraft(pkgCmd, ctx);
    const spec = buildCliInvocation(draft, ctx);
    const barHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliLegoBar, {
          categories: CLI_CATEGORIES,
          commands: CLI_COMMANDS,
          command: pkgCmd,
          spec,
          draft,
          context: ctx,
          onSelectCategory: () => {},
          onSelectCommand: () => {},
          onSelectSubcommand: () => {},
          onSelectTargetFilm: () => {},
          onRemoveToken: () => {},
          onReset: () => {},
        }),
      ),
    );
    assert.ok(barHtml.includes("packages/live-studio"));
    assert.ok(!barHtml.includes(">repo root<"));
  });

  test("CliWorkbench exposes template update, busy command and guide actions", () => {
    const ctx = makeContext();
    const catalog = { categories: CLI_CATEGORIES, commands: CLI_COMMANDS, context: ctx };
    const checkCmd = findCliCommand("check");
    assert.ok(checkCmd);
    const draft = createInitialDraft(checkCmd, ctx);
    const longName = "X".repeat(80);
    const busyRun = {
      runId: "r-busy-other",
      commandId: "find",
      subcommandPath: [],
      mode: "execute",
      displayCommand: "bun run find --kind kind/sfx",
      cwd: "/repo",
      targetFilm: "root",
      status: "running",
      startedAt: 1,
      truncated: false,
      output: [],
    };

    const html = renderToStaticMarkup(
      wrapTree(
        createElement(CliWorkbench, {
          catalog,
          command: checkCmd,
          draft,
          editingTemplateName: longName,
          activeRun: busyRun,
          lastRun: null,
          consoleExpanded: false,
          focusConsoleRunId: null,
          initialCompact: true,
          submittingRun: false,
          runError: null,
          clearedHint: null,
          onBack: () => {},
          onSelectCategory: () => {},
          onSelectCommand: () => {},
          onSelectSubcommand: () => {},
          onSelectTargetFilm: () => {},
          onUpdateField: () => {},
          onRemoveToken: () => {},
          onReset: () => {},
          onRun: () => {},
          onStopRun: () => {},
          onClearConsole: () => {},
          onToggleExpandConsole: () => {},
          onConsumeFocusRun: () => {},
          onOpenSaveTemplate: () => {},
        }),
      ),
    );

    assert.ok(html.includes("Update template"));
    assert.ok(html.includes(`title="${busyRun.displayCommand}"`));
    assert.ok(html.includes("Command guide"));
  });

  test("CliBrowse gives each template unique Edit/Run aria-labels and bounds long template/banner text", () => {
    const ctx = makeContext();
    const catalog = { categories: CLI_CATEGORIES, commands: CLI_COMMANDS, context: ctx };
    const longName = "X".repeat(80);
    const longFilm = "film-slug-extremely-long-unbroken-name";
    const templates = [
      {
        id: "tpl-long",
        name: longName,
        commandId: "find",
        subcommandPath: [],
        targetFilm: "active",
        flags: {},
        args: { query: "rain" },
        env: {},
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "tpl-confirm",
        name: "Deploy voice",
        commandId: "voice:gen",
        subcommandPath: [],
        targetFilm: "demo-film",
        flags: { "--yes": true },
        args: {},
        env: {},
        createdAt: 2,
        updatedAt: 2,
      },
    ];
    const bannerRun = {
      runId: "r-banner",
      commandId: "find",
      subcommandPath: [],
      mode: "execute",
      displayCommand: "bun run find --kind kind/sfx --limit 5 rainstorm",
      cwd: "/repo",
      targetFilm: "root",
      status: "done",
      exitCode: 0,
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      truncated: false,
      output: [],
    };

    const html = renderToStaticMarkup(
      wrapTree(
        createElement(CliBrowse, {
          catalog,
          templates,
          activeRun: null,
          lastRun: bannerRun,
          searchQuery: "",
          selectedCategory: "all",
          onSearchChange: () => {},
          onSelectCategory: () => {},
          onOpenCommand: () => {},
          onEditTemplate: () => {},
          onRunTemplate: () => {},
          onDeleteTemplate: async () => true,
          onRestoreTemplate: async () => true,
          onStopRun: () => {},
        }),
      ),
    );

    assert.ok(html.includes(`title="${bannerRun.displayCommand}"`));
    assert.ok(html.includes(`title="${longName}"`));
    assert.ok(!html.includes(`title="${longFilm}"`));
    assert.ok(html.includes(`aria-label="Edit template ${longName}"`));
    assert.ok(html.includes(`aria-label="Run template ${longName}"`));
    assert.ok(html.includes(`aria-label="Review &amp; run template Deploy voice"`));
  });

  test("ToastTitle and ToastDescription use min-w-0 and [overflow-wrap:anywhere] to wrap long unbreakable names", () => {
    const html = renderToStaticMarkup(
      wrapTree(
        createElement(
          ToastProvider,
          null,
          createElement(
            Toast,
            {
              toast: {
                id: "t-wrap",
                title: `Removed template "${"X".repeat(80)}"`,
                description: "LongUnbrokenWord".repeat(6),
                timeout: 10000,
              },
            },
            createElement(
              ToastContent,
              null,
              createElement(
                "div",
                { className: "flex min-w-0 flex-1 flex-col gap-1" },
                createElement(ToastTitle),
                createElement(ToastDescription),
              ),
            ),
          ),
        ),
      ),
    );

    assert.ok(html.includes("Removed template"));
    const titleMatches = html.match(/data-slot="toast-title"[^>]*class="([^"]+)"/);
    const descMatches = html.match(/data-slot="toast-description"[^>]*class="([^"]+)"/);
    assert.ok(titleMatches && titleMatches[1]);
    assert.ok(descMatches && descMatches[1]);
    assert.ok(titleMatches[1].includes("min-w-0"));
    assert.ok(titleMatches[1].includes("[overflow-wrap:anywhere]"));
    assert.ok(descMatches[1].includes("min-w-0"));
    assert.ok(descMatches[1].includes("[overflow-wrap:anywhere]"));
  });

  test("CliBrowse marks unknown template commands unavailable, preserves Scroll CLI acronym case, and surfaces packageDir", () => {
    const ctx = makeContext();
    const catalog = { categories: CLI_CATEGORIES, commands: CLI_COMMANDS, context: ctx };
    const templates = [
      {
        id: "tpl-orphan",
        name: "Old removed CLI",
        commandId: "nonexistent:cmd",
        subcommandPath: [],
        args: {},
        flags: {},
        env: {},
        targetFilm: "root",
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "tpl-pkg",
        name: "Studio suite",
        commandId: "live-studio:test",
        subcommandPath: [],
        args: {},
        flags: {},
        env: {},
        targetFilm: "root",
        createdAt: 2,
        updatedAt: 2,
      },
    ];

    const html = renderToStaticMarkup(
      wrapTree(
        createElement(CliBrowse, {
          catalog,
          templates,
          activeRun: null,
          lastRun: null,
          searchQuery: "",
          selectedCategory: "all",
          onSearchChange: () => {},
          onSelectCategory: () => {},
          onOpenCommand: () => {},
          onEditTemplate: () => {},
          onRunTemplate: () => {},
          onDeleteTemplate: async () => true,
          onRestoreTemplate: async () => true,
          onStopRun: () => {},
        }),
      ),
    );

    assert.ok(html.includes("Unavailable"));
    assert.match(
      html,
      /disabled=""[^>]*aria-label="Edit template Old removed CLI"|aria-label="Edit template Old removed CLI"[^>]*disabled=""/,
    );
    assert.match(
      html,
      /disabled=""[^>]*aria-label="Run template Old removed CLI"|aria-label="Run template Old removed CLI"[^>]*disabled=""/,
    );
    assert.doesNotMatch(html, /disabled=""[^>]*aria-label="Delete template Old removed CLI"/);
    assert.ok(html.includes("packages/live-studio"));

    openTemplateInWorkbench(templates[0]);
    assert.ok(cliStore.getState().templatesError?.includes("nonexistent:cmd"));
    cliStore.setState({ templatesError: null });
  });

  test("touch targets, false-string boolean, unique Add labels, coalesced console, and search counts", () => {
    const ctx = makeContext();
    const catalog = { categories: CLI_CATEGORIES, commands: CLI_COMMANDS, context: ctx };
    const findCmd = findCliCommand("find");
    assert.ok(findCmd);
    const draft = {
      ...createInitialDraft(findCmd, ctx),
      flags: { "--kind": "sfx", "--jev": "false", "-n": "abc" },
    };
    const spec = buildCliInvocation(draft, ctx);

    const barHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliLegoBar, {
          categories: CLI_CATEGORIES,
          commands: CLI_COMMANDS,
          command: findCmd,
          spec,
          draft,
          context: ctx,
          onSelectCategory: () => {},
          onSelectCommand: () => {},
          onSelectSubcommand: () => {},
          onSelectTargetFilm: () => {},
          onRemoveToken: () => {},
          onReset: () => {},
        }),
      ),
    );
    assert.ok(barHtml.includes("pointer-coarse:size-10"));

    const wbHtml = renderToStaticMarkup(
      wrapTree(
        createElement(
          CliWorkbench,
          makeWorkbenchProps(catalog, findCmd, draft, {
            initialCompact: false,
          }),
        ),
      ),
    );
    assert.ok(wbHtml.includes("pointer-coarse:min-h-10"));
    assert.match(wbHtml, /aria-describedby="[^"]+"/);
    assert.ok(!wbHtml.includes("Invalid number for Limit (-n): &quot;abc&quot;"));

    const jevDef = spec.flagsDef.find((f) => f.key === "--jev");
    const kindDef = spec.flagsDef.find((f) => f.key === "--kind");
    assert.ok(jevDef && kindDef);
    const boolHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliFieldControl, {
          def: jevDef,
          value: "false",
          context: ctx,
          onChange: () => {},
        }),
      ),
    );
    assert.ok(!boolHtml.includes('aria-checked="true"'));

    const multiAddHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliFieldControl, {
          def: kindDef,
          value: "sfx",
          context: ctx,
          onChange: () => {},
        }),
      ),
    );
    assert.ok(multiAddHtml.includes(`aria-label="Add ${kindDef.label} item"`));

    const consoleHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliConsole, {
          run: {
            runId: "r-coalesce",
            commandId: "check",
            subcommandPath: [],
            mode: "execute",
            displayCommand: "bun run check",
            cwd: "/repo/films/demo-film",
            targetFilm: "demo-film",
            status: "done",
            startedAt: 1000,
            finishedAt: 1200,
            exitCode: 1,
            signal: null,
            durationMs: 200,
            truncated: false,
            output: [
              { seq: 0, stream: "stdout", chunk: "a\n" },
              { seq: 1, stream: "stdout", chunk: "b\n" },
              { seq: 2, stream: "stderr", chunk: "err1\n" },
              { seq: 3, stream: "stderr", chunk: "err2\n" },
              { seq: 4, stream: "stdout", chunk: "c\n" },
            ],
          },
          expanded: false,
          onToggleExpand: () => {},
          onStop: () => {},
          onClear: () => {},
        }),
      ),
    );
    const spanCount = (consoleHtml.match(/<span class="text-(?:foreground|warn-text)"/g) ?? [])
      .length;
    assert.equal(spanCount, 3);

    const searchBrowseHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliBrowse, {
          catalog,
          templates: [],
          activeRun: null,
          lastRun: null,
          searchQuery: "earshot",
          selectedCategory: "all",
          onSearchChange: () => {},
          onSelectCategory: () => {},
          onOpenCommand: () => {},
          onEditTemplate: () => {},
          onRunTemplate: () => {},
          onDeleteTemplate: async () => true,
          onRestoreTemplate: async () => true,
          onStopRun: () => {},
        }),
      ),
    );
    assert.ok(!searchBrowseHtml.includes(`All (${CLI_COMMANDS.length})`));
    assert.ok(!searchBrowseHtml.includes("Sound, Mix &amp; Earshot (6)"));
  });

  test("surfaces readable Zod 400 template errors, maxLength 80, repo root badges, and tokenized multi-values", async () => {
    const ctx = makeContext();
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          success: false,
          error: {
            name: "ZodError",
            issues: [{ message: "Template name must be 80 characters or fewer" }],
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    try {
      await assert.rejects(
        () => saveCliTemplate({ name: "X".repeat(81), commandId: "find" }),
        /80 characters or fewer/,
      );
    } finally {
      globalThis.fetch = origFetch;
    }

    const dlgHtml = renderToStaticMarkup(
      wrapTree(
        createElement(SaveTemplatePanel, {
          initialName: "Test",
          initialTargetFilm: "active",
          activeFilm: ctx.activeFilm,
          films: ctx.films,
          supportsFilmTarget: true,
          supportsRootTarget: true,
          displayCommand: "bun run find",
          editingExisting: false,
          saving: false,
          saveError: null,
          onSave: () => {},
          onClose: () => {},
        }),
      ),
    );
    assert.ok(dlgHtml.includes('maxLength="80"'));

    const rootBrowseHtml = renderToStaticMarkup(
      wrapTree(
        createElement(CliBrowse, {
          catalog: { categories: CLI_CATEGORIES, commands: CLI_COMMANDS, context: ctx },
          templates: [
            {
              id: "t-root",
              name: "Root Help",
              commandId: "help",
              subcommandPath: [],
              args: {},
              flags: {},
              env: {},
              targetFilm: "root",
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          activeRun: null,
          lastRun: null,
          searchQuery: "",
          selectedCategory: "all",
          onSearchChange: () => {},
          onSelectCategory: () => {},
          onOpenCommand: () => {},
          onEditTemplate: () => {},
          onRunTemplate: () => {},
          onDeleteTemplate: async () => true,
          onRestoreTemplate: async () => true,
          onStopRun: () => {},
        }),
      ),
    );
    assert.ok(rootBrowseHtml.includes("repo root"));
    assert.deepEqual(commitMultiTokens('mixamo/X {"end":"kneel"}', [], false), [
      "mixamo/X",
      '{"end":"kneel"}',
    ]);
    assert.deepEqual(commitMultiTokens("mixamo ual1 ual2", ["mixamo"], false), [
      "mixamo",
      "ual1",
      "ual2",
    ]);
    assert.deepEqual(commitMultiTokens("sfx, mocap", [], true), ["sfx", "mocap"]);
  });
});
