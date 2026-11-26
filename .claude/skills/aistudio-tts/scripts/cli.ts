import { extname } from "node:path";
import { parseArgs } from "node:util";

import {
  browserSteps,
  chromeStep,
  chromeUp,
  closeWindowOf,
  currentTab,
  isTargetGeneratingCdp,
  js,
  mutateTabs,
  pageTargets,
  PORT,
  prepareTab,
  readTabs,
  runSteps,
  type Step,
  StepError,
  stripBom,
  TAB_RE,
  useTab,
} from "../../aistudio/scripts/lib";
import { clearRunBaseline, exportAudio, submitSpeech, waitForAudio } from "./audio";
import {
  addBlock,
  addExpression,
  block,
  blockCount,
  blockStyle,
  blockText,
  closeLibrary,
  generatedCode,
  openLibrary,
  openSpeech,
  removeBlock,
  requireSpeechPage,
  speechStatus,
  startEditor,
  temperature,
} from "./editor";
import {
  DEFAULT_MODEL,
  InputError,
  type Scene,
  SPEECH_PATH,
  speechUrl,
  validateBatchManifest,
  validateScene,
} from "./input";
import { exists, inspectMap, item, label, tap, verify } from "./page-map";
import { actOnUi, snapshot } from "./ui";
import {
  FACETS,
  favoriteVoice,
  openVoiceCreation,
  sampleVoice,
  searchVoices,
  selectVoice,
  voiceFilter,
  voices,
} from "./voices";

const grammar = {
  open: [
    "[--model ID] [--account SLOT]",
    "Open the TTS model in a dedicated tab, preserving existing speech.",
  ],
  speak: [
    "SCENE.json --out TAKE.wav [--model ID] [--account SLOT] [--timeout SECONDS] [--keep-open] [--force]",
    "Open tab, apply scene, generate audio, export WAV, and close tab in one process.",
  ],
  batch: [
    "MANIFEST.json [--model ID] [--account SLOT] [--timeout SECONDS] [--keep-open] [--force]",
    "Generate multiple takes sequentially on one reused tab in a single process.",
  ],
  tabs: ["", "List open tabs in the shared AI Studio Chrome without starting Chrome."],
  start: ["", "Start the screenplay editor from the landing screen."],
  status: ["", "Read model, blocks, temperature and audio state."],
  apply: ["SCENE.json", "Load a screenplay into a fresh, empty editor."],
  "block-add": ["", "Append a speech block."],
  "block-remove": ["BLOCK", "Delete one draft block by its 1-based number."],
  text: ["BLOCK FILE|-", "Fill one block from a UTF-8 transcript file (or - for stdin)."],
  style: ["BLOCK [TEXT]", "Inspect or set freeform style. Pass an empty argument to clear."],
  preset: ["BLOCK NAME", "Choose a preset from the live Style menu."],
  expression: [
    "BLOCK [NAME]",
    "List expression tags or insert one at the editor's current position.",
  ],
  "block-preview": ["BLOCK", "Start the block's built-in preview."],
  temperature: ["[VALUE]", "Read the current value/range or set Temperature."],
  library: [
    "[SPEAKER] [--block]",
    "Open a speaker's voice library, or target a block's speaker chip.",
  ],
  "library-close": ["", "Close the voice library."],
  voices: ["[QUERY]", "Read catalog results, or set search and read the results."],
  filter: ["FACET [OPTION]", "List or choose a Language, Gender, Pitch, Style or Use case option."],
  voice: ["NAME", "Select an exact voice in the open library."],
  favorite: ["NAME on|off", "Set the account's favorite state for a voice."],
  sample: [
    "[NAME] [--out SAMPLE.wav] [--force]",
    "Play a voice sample and optionally export its public catalog WAV.",
  ],
  "voice-create": [
    "[design|replication|remix [NAME]]",
    "Open a voice form. Use snapshot/ui for its live controls.",
  ],
  run: [
    "[--out TAKE.wav] [--timeout SECONDS] [--force]",
    "Submit the screenplay once and wait for new audio.",
  ],
  collect: [
    "--out TAKE.wav [--timeout SECONDS] [--force]",
    "Export audio from the visible result without submitting.",
  ],
  stop: ["", "Stop a speech generation in progress."],
  snapshot: ["", "List interactive controls and live browser refs for uncovered UI actions."],
  code: ["", "Print the active Get code language snippet without using the clipboard."],
  ui: [
    "ACTION REF [VALUE]",
    "Use click, hover, focus, fill, press, check, uncheck, drag or upload on a live ref.",
  ],
  map: ["", "Read which mapped selectors match and how many controls they find."],
  doctor: ["", "Check the controls required in the open speech state."],
  close: ["", "Close the dedicated tab. Safe when already closed; refuses while generating."],
} as const;

type Command = keyof typeof grammar;
const usage = [
  "Usage: bun .claude/skills/aistudio-tts/scripts/cli.ts [--tab tts-LABEL] [--json] COMMAND",
  "",
  ...Object.entries(grammar).map(
    ([name, [args, detail]]) => `  ${[name, args].filter(Boolean).join(" ")}\n    ${detail}`,
  ),
  "",
  "Default tab: tts-main. Tab labels must start with tts-, use only letters/numbers/hyphens (no underscores), and be <= 31 chars.",
  "Prefer speak or batch for single-process generation on Windows. JSON results go to stdout; logs go to stderr.",
  "Exit 2 = invalid input; 1 = step failure.",
].join("\n");

let result: unknown;
const steps: Step[] = [];
const add = (name: string, run: Step[1]) => steps.push([name, run]);
function resultStep(name: string, operation: () => unknown) {
  add(name, async () => {
    result = await operation();
    return typeof result === "string" && !result.includes("\n")
      ? result
      : "read back from AI Studio";
  });
}

function numberArg(raw: string, context: string, integer = true) {
  const number = Number(raw);
  if (
    !raw.trim() ||
    !Number.isFinite(number) ||
    (integer && (!Number.isSafeInteger(number) || number < 1))
  ) {
    throw new InputError(`${context} must be a ${integer ? "positive integer" : "finite number"}.`);
  }
  return number;
}

async function textFile(path: string) {
  try {
    if (path === "-") return stripBom(await Bun.stdin.text());
    return stripBom(await Bun.file(path).text());
  } catch (error) {
    throw new InputError(`Cannot read ${path}: ${(error as Error).message}`);
  }
}

async function closeTabByLabel(labelName: string) {
  const target = readTabs()[labelName];
  if (!target) return "tab already closed";
  const pruneIfSame = () =>
    mutateTabs((cur) => {
      if (cur[labelName]?.id !== target.id) return cur;
      const { [labelName]: _, ...rest } = cur;
      return rest;
    });
  if (!(await chromeUp())) {
    await pruneIfSame();
    return "tab already closed";
  }
  const live = (await pageTargets()).find((p) => p.id === target.id);
  if (!live) {
    await pruneIfSame();
    return "tab already closed";
  }
  let onSpeech = false;
  try {
    onSpeech = SPEECH_PATH.test(new URL(live.url).pathname);
  } catch {}
  if (onSpeech && (await isTargetGeneratingCdp(target.id))) {
    throw new StepError("This tab is generating or streaming audio. Collect or stop first.");
  }
  await closeWindowOf(target.id);
  await pruneIfSame();
  return "owned TTS tab closed";
}

function verifyBlockSpeaker(blockNumber: number, speakerNum: 1 | 2, expectedVoice?: string) {
  const expectedPrefix = `Speaker ${speakerNum}`;
  const actual = js<string>(label(item("speaker", block(blockNumber))));
  if (!actual.startsWith(`${expectedPrefix} - `)) {
    throw new StepError(`Block ${blockNumber}: expected ${expectedPrefix}, found ${actual}.`);
  }
  if (
    expectedVoice &&
    actual.toLowerCase() !== `${expectedPrefix} - ${expectedVoice}`.toLowerCase()
  ) {
    throw new StepError(
      `Block ${blockNumber}: expected ${expectedPrefix} - ${expectedVoice}, found ${actual}.`,
    );
  }
  return actual;
}

function queueSceneApplySteps(scene: Scene) {
  add("prepare an empty editor", async () => {
    const status = speechStatus();
    if (
      status.running ||
      status.audio ||
      status.voiceLibraryOpen ||
      status.blocks.length > 1 ||
      status.blocks.some((b) => b.text || b.style || !b.speaker.startsWith("Speaker 1 - "))
    ) {
      throw new StepError(
        "This tab already has a draft or take. Use a new --tab to apply a scene.",
      );
    }
    return startEditor();
  });
  for (let i = 1; i < scene.blocks.length; i++) add(`append block ${i + 1}`, addBlock);
  for (const [i, name] of (scene.voices ?? []).entries()) {
    if (!name) continue;
    add(`open speaker ${i + 1} library`, () => openLibrary(i + 1));
    add(`set voice for speaker ${i + 1}`, () => selectVoice(name, i + 1));
    add(`leave speaker ${i + 1} library`, async () =>
      js<boolean>(exists("voiceSearch")) ? closeLibrary() : "voice selection closed the library",
    );
  }
  for (const [i, speech] of scene.blocks.entries()) {
    add(`verify speaker for block ${i + 1}`, () => {
      const speakerNum = (speech.speaker ?? (i % 2) + 1) as 1 | 2;
      return verifyBlockSpeaker(i + 1, speakerNum, scene.voices?.[speakerNum - 1]);
    });
    add(`fill block ${i + 1}`, () => blockText(i + 1, speech.text));
    if (speech.style !== undefined) {
      const styleText = speech.style;
      add(`set style of block ${i + 1}`, () => blockStyle(i + 1, styleText));
    }
  }
  if (scene.temperature !== undefined) {
    add("set temperature", async () => {
      const t = await temperature(scene.temperature);
      return `temperature ${t.value}`;
    });
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { short: "h", type: "boolean" },
      json: { type: "boolean" },
      tab: { type: "string", default: "tts-main" },
      model: { type: "string" },
      account: { type: "string" },
      block: { type: "boolean" },
      out: { type: "string" },
      timeout: { type: "string" },
      "keep-open": { type: "boolean" },
      force: { type: "boolean" },
    },
    strict: true,
    allowPositionals: true,
  });
  const [commandName, ...args] = positionals;
  if (values.help || commandName === "help" || !commandName) {
    console.log(values.json ? JSON.stringify(grammar, null, 2) : usage);
    return;
  }
  if (!Object.hasOwn(grammar, commandName))
    throw new InputError(`Unknown command "${commandName}". See --help.`);
  const command = commandName as Command;
  const tab = values.tab!;
  if (!TAB_RE.test(tab) || !tab.startsWith("tts-") || tab.length < 5) {
    throw new InputError(
      "--tab must start with tts-, use only letters, numbers or hyphens (no underscores), and be 5–31 characters.",
    );
  }
  useTab(tab);
  const count = (min: number, max = min) => {
    if (args.length < min || args.length > max) {
      throw new InputError(`Usage: ${command} ${grammar[command][0]}`);
    }
  };
  const index = () => numberArg(args[0]!, "Block number");
  const { account, model, block: byBlock, out, timeout, "keep-open": keepOpen, force } = values;
  if (
    (account !== undefined || model !== undefined) &&
    !["open", "speak", "batch"].includes(command)
  ) {
    throw new InputError("--account and --model are only accepted by open, speak and batch.");
  }
  if (byBlock && command !== "library")
    throw new InputError("--block is only accepted by library.");
  if (keepOpen && !["speak", "batch"].includes(command))
    throw new InputError("--keep-open is only accepted by speak and batch.");
  if (force && !["run", "collect", "sample", "speak", "batch"].includes(command))
    throw new InputError("--force is only accepted by run, collect, sample, speak and batch.");
  if (out !== undefined && !["run", "collect", "sample", "speak"].includes(command))
    throw new InputError("--out is only accepted by run, collect, sample and speak.");
  if (timeout !== undefined && !["run", "collect", "speak", "batch"].includes(command))
    throw new InputError("--timeout is only accepted by run, collect, speak and batch.");
  if (out !== undefined && extname(out).toLowerCase() !== ".wav")
    throw new InputError("--out must end in .wav.");
  const timeoutMs = timeout === undefined ? 180_000 : numberArg(timeout, "--timeout") * 1_000;
  if (timeoutMs > 900_000) throw new InputError("--timeout must be at most 900 seconds.");
  if (out !== undefined && !force && (await Bun.file(out).exists()))
    throw new InputError(`Output already exists: ${out}. Use a new take path or pass --force.`);

  const opensTab = command === "open" || command === "speak" || command === "batch";
  const noBrowserPrelude = command === "close" || command === "tabs";
  if (!opensTab && !noBrowserPrelude) {
    add("verify speech workspace", () => {
      const url = requireSpeechPage(true);
      return url.pathname;
    });
  }

  switch (command) {
    case "open":
      count(0);
      speechUrl(model ?? DEFAULT_MODEL, account);
      resultStep("open AI Studio TTS", () => openSpeech(model, account));
      break;
    case "tabs":
      count(0);
      add("list shared Chrome tabs", async () => {
        if (!(await chromeUp())) {
          result = [];
          return `Chrome is not running on port ${PORT}`;
        }
        const pages = await pageTargets();
        const tabs = await mutateTabs((cur) =>
          Object.fromEntries(
            Object.entries(cur).filter(([, t]) => pages.some((p) => p.id === t.id)),
          ),
        );
        const labelOf = Object.fromEntries(Object.entries(tabs).map(([l, t]) => [t.id, l]));
        const rows = pages.map((p) => ({ tab: labelOf[p.id] ?? null, url: p.url, title: p.title }));
        result = rows;
        return `${rows.length} windows, ${Object.keys(tabs).length} with a label`;
      });
      break;
    case "speak": {
      count(1);
      if (!out) throw new InputError("speak requires --out TAKE.wav.");
      speechUrl(model ?? DEFAULT_MODEL, account);
      const raw = await textFile(args[0]!);
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch (error) {
        throw new InputError(`Invalid scene JSON: ${(error as Error).message}`);
      }
      const scene = validateScene(json);
      add("open AI Studio TTS", () => openSpeech(model, account));
      queueSceneApplySteps(scene);
      add("submit screenplay", () => {
        submitSpeech();
        return "Run clicked once";
      });
      add("wait for playable audio", async () => {
        const duration = await waitForAudio(timeoutMs, { submitted: true });
        return `player has ${duration.toFixed(2)} s of audio`;
      });
      resultStep("save WAV", () => exportAudio(out, Boolean(force)));
      if (!keepOpen) add("close TTS tab", () => closeTabByLabel(currentTab()));
      break;
    }
    case "batch": {
      count(1);
      speechUrl(model ?? DEFAULT_MODEL, account);
      const raw = await textFile(args[0]!);
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch (error) {
        throw new InputError(`Invalid batch manifest JSON: ${(error as Error).message}`);
      }
      const manifest = validateBatchManifest(json);
      if (!force) {
        for (const take of manifest.takes) {
          if (await Bun.file(take.out).exists()) {
            throw new InputError(
              `Output already exists: ${take.out}. Use new take paths or pass --force.`,
            );
          }
        }
      }
      const maxBlocks = Math.max(...manifest.takes.map((t) => t.blocks.length));
      const initialVoiceSetupBlocks = manifest.voices?.[1]
        ? Math.max(2, manifest.takes[0]!.blocks.length)
        : manifest.takes[0]!.blocks.length;
      add("open AI Studio TTS", () => openSpeech(model, account));
      add("prepare an empty editor", async () => {
        const status = speechStatus();
        if (
          status.running ||
          status.audio ||
          status.voiceLibraryOpen ||
          status.blocks.length > 1 ||
          status.blocks.some((b) => b.text || b.style || !b.speaker.startsWith("Speaker 1 - "))
        ) {
          throw new StepError(
            "This tab already has a draft or take. Use a new --tab to run a batch.",
          );
        }
        return startEditor();
      });
      for (let i = 1; i < Math.min(maxBlocks, initialVoiceSetupBlocks); i++) {
        add(`append initial block ${i + 1}`, addBlock);
      }
      for (const [i, name] of (manifest.voices ?? []).entries()) {
        if (!name) continue;
        add(`open speaker ${i + 1} library`, () => openLibrary(i + 1));
        add(`set voice for speaker ${i + 1}`, () => selectVoice(name, i + 1));
        add(`leave speaker ${i + 1} library`, async () =>
          js<boolean>(exists("voiceSearch"))
            ? closeLibrary()
            : "voice selection closed the library",
        );
      }
      const exported: { index: number; path: string; bytes: number; duration: number }[] = [];
      let baselineTemp: number | undefined;
      let currentTemp: number | undefined;
      for (const [idx, take] of manifest.takes.entries()) {
        const tag = `[take ${idx + 1}/${manifest.takes.length}]`;
        add(`${tag} update screenplay`, async () => {
          let countNow = blockCount();
          while (countNow < take.blocks.length) {
            await addBlock();
            countNow++;
          }
          while (countNow > take.blocks.length) {
            await removeBlock(countNow);
            countNow--;
          }
          for (const [bIdx, speech] of take.blocks.entries()) {
            const speakerNum = (speech.speaker ?? (bIdx % 2) + 1) as 1 | 2;
            const expectedVoice = manifest.voices?.[speakerNum - 1];
            const expectedFull = expectedVoice ? `Speaker ${speakerNum} - ${expectedVoice}` : "";
            const currentLabel = js<string>(label(item("speaker", block(bIdx + 1))));
            if (expectedVoice && currentLabel.toLowerCase() !== expectedFull.toLowerCase()) {
              await openLibrary(speakerNum);
              await selectVoice(expectedVoice, speakerNum);
              if (js<boolean>(exists("voiceSearch"))) await closeLibrary();
            }
            verifyBlockSpeaker(bIdx + 1, speakerNum, expectedVoice);
            await blockText(bIdx + 1, speech.text);
            if (speech.style !== undefined) {
              await blockStyle(bIdx + 1, speech.style);
            } else if (idx > 0) {
              const status = speechStatus();
              if (status.blocks[bIdx]?.style) await blockStyle(bIdx + 1, "");
            }
          }
          if (
            manifest.temperature === undefined &&
            take.temperature !== undefined &&
            baselineTemp === undefined
          ) {
            baselineTemp = (await temperature()).value;
            currentTemp = baselineTemp;
          }
          const wantTemp = take.temperature ?? manifest.temperature ?? baselineTemp;
          if (wantTemp !== undefined && wantTemp !== currentTemp) {
            await temperature(wantTemp);
            currentTemp = wantTemp;
          }
          return `${take.blocks.length} block(s) ready`;
        });
        add(`${tag} generate & save WAV`, async () => {
          submitSpeech();
          await waitForAudio(timeoutMs, { submitted: true });
          const saved = await exportAudio(take.out, Boolean(force));
          exported.push({ index: idx + 1, ...saved });
          result = { takes: exported };
          return `${saved.path} (${saved.duration.toFixed(2)} s)`;
        });
      }
      if (!keepOpen) add("close TTS tab", () => closeTabByLabel(currentTab()));
      break;
    }
    case "start":
      count(0);
      resultStep("start editor", startEditor);
      break;
    case "status":
      count(0);
      resultStep("read screenplay and audio", speechStatus);
      break;
    case "apply": {
      count(1);
      const raw = await textFile(args[0]!);
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch (error) {
        throw new InputError(`Invalid scene JSON: ${(error as Error).message}`);
      }
      const scene = validateScene(json);
      queueSceneApplySteps(scene);
      resultStep("read applied screenplay", speechStatus);
      break;
    }
    case "block-add":
      count(0);
      resultStep("append block", addBlock);
      break;
    case "block-remove": {
      count(1);
      const n = index();
      resultStep(`remove block ${n}`, () => removeBlock(n));
      break;
    }
    case "text": {
      count(2);
      const n = index();
      const text = await textFile(args[1]!);
      resultStep(`fill block ${n}`, () => blockText(n, text));
      break;
    }
    case "style":
    case "preset":
    case "expression":
    case "block-preview": {
      count(command === "preset" ? 2 : 1, command === "block-preview" ? 1 : 2);
      const n = index();
      if (command === "expression")
        resultStep(`expression for block ${n}`, () => addExpression(n, args[1]));
      else if (command === "block-preview")
        resultStep(`preview block ${n}`, async () => {
          tap("blockPreview", block(n));
          const control = label(item("blockPreview", block(n)));
          await verify(
            `/^Stop/i.test(${control})`,
            "Block preview did not signal playback. Inspect the button and alerts.",
            20_000,
          );
          return `block ${n} preview playing`;
        });
      else resultStep(`style for block ${n}`, () => blockStyle(n, args[1], command === "preset"));
      break;
    }
    case "temperature": {
      count(0, 1);
      const setting = args[0] === undefined ? undefined : numberArg(args[0], "Temperature", false);
      resultStep("temperature", () => temperature(setting));
      break;
    }
    case "library": {
      count(0, 1);
      const target = args[0] === undefined ? 1 : index();
      resultStep("open voice library", () => openLibrary(target, byBlock ? "block" : "speaker"));
      break;
    }
    case "library-close":
      count(0);
      resultStep("close voice library", closeLibrary);
      break;
    case "voices":
      count(0, 1);
      resultStep("read voice results", () =>
        args[0] === undefined ? voices() : searchVoices(args[0]),
      );
      break;
    case "filter": {
      count(1, 2);
      const facet = FACETS.find((s) => s.toLowerCase() === args[0]!.toLowerCase());
      if (!facet) throw new InputError("Use Language, Gender, Pitch, Style or Use case.");
      resultStep(`filter voices by ${facet}`, () => voiceFilter(facet, args[1]));
      break;
    }
    case "voice":
      count(1);
      resultStep("select voice", () => selectVoice(args[0]!));
      break;
    case "favorite":
      count(2);
      if (!["on", "off"].includes(args[1]!)) throw new InputError("Favorite requires on or off.");
      resultStep("set favorite", () => favoriteVoice(args[0]!, args[1] === "on"));
      break;
    case "sample":
      count(0, 1);
      resultStep("play sample", () => sampleVoice(args[0], out, Boolean(force)));
      break;
    case "voice-create":
      count(0, 2);
      if (
        args[0] &&
        (!["design", "replication", "remix"].includes(args[0]) ||
          (args[0] === "remix") !== (args.length === 2))
      ) {
        throw new InputError("Expected voice-create [design|replication|remix NAME].");
      }
      resultStep("open voice form", () => openVoiceCreation(args[0], args[1]));
      break;
    case "run":
    case "collect": {
      count(0);
      if (command === "collect" && !out) throw new InputError("collect requires --out TAKE.wav.");
      let duration: number;
      if (command === "run")
        add("submit screenplay", () => {
          submitSpeech();
          return "Run clicked once";
        });
      add("wait for playable audio", async () => {
        duration = await waitForAudio(timeoutMs, { submitted: command === "run" });
        result = { duration };
        return `player has ${duration.toFixed(2)} s of audio`;
      });
      if (out) resultStep("save WAV", () => exportAudio(out, Boolean(force)));
      break;
    }
    case "stop":
      count(0);
      resultStep("stop generation", async () => {
        tap("stop");
        await verify(`! (${exists("stop")})`, "AI Studio still shows an active generation.");
        clearRunBaseline();
        return "generation stopped";
      });
      break;
    case "snapshot":
      count(0);
      resultStep("inspect speech controls", snapshot);
      break;
    case "code":
      count(0);
      resultStep("read Get code snippet", generatedCode);
      break;
    case "ui": {
      count(2, 3);
      const [action, ref, value] = args;
      const withValue = ["fill", "press", "drag", "upload"];
      if (
        !["click", "hover", "focus", "check", "uncheck", ...withValue].includes(action!) ||
        withValue.includes(action!) !== (value !== undefined) ||
        !/^@?e\d+$/.test(ref!)
      ) {
        throw new InputError(
          "Expected ui ACTION REF [VALUE]. Start with snapshot on the same tab.",
        );
      }
      if (
        action === "press" &&
        !/^(Enter|Escape|Tab|Space|Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown|Backspace|Delete)$/.test(
          value!,
        )
      ) {
        throw new InputError("Use a single UI key such as Enter, Escape, Tab or ArrowDown.");
      }
      resultStep(`ui ${action} ${ref}`, () => actOnUi(action!, ref!, value));
      break;
    }
    case "map":
    case "doctor": {
      count(0);
      add("check live locator candidates", () => {
        const map = inspectMap();
        const baseline = map.voiceSearch.count
          ? (["library", "voiceList", "voiceCurrent", "closePanel", "newVoice"] as const)
          : map.block.count
            ? (["text", "speaker", "style", "expressions", "add", "run"] as const)
            : (["welcome"] as const);
        const missing = baseline.filter((key) => !map[key].count);
        result = {
          missing,
          map,
          help: "Repair selectors in scripts/page-map.ts using snapshot. See references/ui-changes.md.",
        };
        if (command === "doctor" && missing.length) {
          console.log(JSON.stringify(result, null, 2));
          throw new StepError(`Missing required controls: ${missing.join(", ")}.`);
        }
        return `${Object.keys(map).length} locator keys checked`;
      });
      break;
    }
    case "close":
      count(0);
      resultStep("close TTS tab", () => closeTabByLabel(currentTab()));
      break;
  }

  if (!opensTab && !noBrowserPrelude && !readTabs()[tab]) {
    throw new InputError(`Tab ${tab} has no registered window. Run --tab ${tab} open first.`);
  }
  const prelude: Step[] = noBrowserPrelude
    ? []
    : opensTab
      ? browserSteps
      : [chromeStep, ["prepare tab", () => prepareTab(false, { createIfMissing: false })]];
  await runSteps([...prelude, ...steps], {
    screenshot: !noBrowserPrelude,
    onDone() {
      if (result === undefined) return;
      console.log(
        !values.json && typeof result === "string" ? result : JSON.stringify(result, null, 2),
      );
    },
  });
}

try {
  await main();
} catch (error) {
  if (!(error instanceof InputError) && !(error instanceof TypeError && "code" in error))
    throw error;
  console.error(`Invalid input: ${error.message}`);
  process.exitCode = 2;
}
