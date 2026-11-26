import { extname } from "node:path";
import { parseArgs } from "node:util";

import {
  browserSteps,
  cdp,
  currentTab,
  js,
  readTabs,
  runSteps,
  type Step,
  StepError,
  TAB_RE,
  useTab,
  writeTabs,
} from "../../aistudio/scripts/lib";
import { exportAudio, readSpeechAudio, submitSpeech, waitForAudio } from "./audio";
import {
  addBlock,
  addExpression,
  block,
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
import { DEFAULT_MODEL, InputError, speechUrl, validateScene } from "./input";
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
  start: ["", "Start the screenplay editor from the landing screen."],
  status: ["", "Read model, blocks, temperature and audio state."],
  apply: ["SCENE.json", "Load a screenplay into a fresh, empty editor."],
  "block-add": ["", "Append a speech block."],
  "block-remove": ["BLOCK", "Delete one draft block by its 1-based number."],
  text: ["BLOCK FILE", "Fill one block from a UTF-8 transcript file."],
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
    "[NAME] [--out SAMPLE.wav]",
    "Play a voice sample and optionally export its public catalog WAV.",
  ],
  "voice-create": [
    "[design|replication|remix [NAME]]",
    "Open a voice form. Use snapshot/ui for its live controls.",
  ],
  run: [
    "[--out TAKE.wav] [--timeout SECONDS]",
    "Submit the screenplay once and wait for new audio.",
  ],
  collect: [
    "--out TAKE.wav [--timeout SECONDS]",
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
  close: ["", "Close the dedicated tab. Export audio and save drafts first."],
} as const;

type Command = keyof typeof grammar;
const usage = [
  "Usage: bun .claude/skills/aistudio-tts/scripts/cli.ts [--tab tts-LABEL] [--json] COMMAND",
  "",
  ...Object.entries(grammar).map(
    ([name, [args, detail]]) => `  ${[name, args].filter(Boolean).join(" ")}\n    ${detail}`,
  ),
  "",
  "Default tab: tts-main. Commands use the logged-in AI Studio Chrome. Use one command per tab at a time.",
  "JSON results go to stdout. Progress and failures go to stderr. Exit 2 = invalid input; 1 = step failure.",
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
    return (await Bun.file(path).text()).replace(/^\uFEFF/, "");
  } catch (error) {
    throw new InputError(`Cannot read ${path}: ${(error as Error).message}`);
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
    throw new InputError("--tab must use a dedicated tts- label with letters, numbers or hyphens.");
  }
  useTab(tab);
  const count = (min: number, max = min) => {
    if (args.length < min || args.length > max) {
      throw new InputError(`Usage: ${command} ${grammar[command][0]}`);
    }
  };
  const index = () => numberArg(args[0]!, "Block number");
  const { account, model, block: byBlock, out, timeout } = values;
  if ((account !== undefined || model !== undefined) && command !== "open") {
    throw new InputError("--account and --model are only accepted by open.");
  }
  if (byBlock && command !== "library")
    throw new InputError("--block is only accepted by library.");
  if (out !== undefined && !["run", "collect", "sample"].includes(command))
    throw new InputError("--out is only accepted by run, collect and sample.");
  if (timeout !== undefined && !["run", "collect"].includes(command))
    throw new InputError("--timeout is only accepted by run and collect.");
  if (out !== undefined && extname(out).toLowerCase() !== ".wav")
    throw new InputError("--out must end in .wav.");
  const timeoutMs = timeout === undefined ? 180_000 : numberArg(timeout, "--timeout") * 1_000;
  if (timeoutMs > 900_000) throw new InputError("--timeout must be at most 900 seconds.");
  if (out !== undefined && (await Bun.file(out).exists()))
    throw new InputError(`Output already exists: ${out}. Use a new take path.`);

  if (command !== "open") {
    add("verify speech workspace", () => {
      const url = requireSpeechPage(command !== "close");
      return url.pathname;
    });
  }
  switch (command) {
    case "open":
      count(0);
      speechUrl(model ?? DEFAULT_MODEL, account);
      resultStep("open AI Studio TTS", () => openSpeech(model, account));
      break;
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
      if (scene.voices?.[1] && scene.blocks.length < 2)
        throw new InputError("Voice 2 requires at least two speech blocks.");
      scene.blocks.forEach(({ speaker }, i) => {
        if (speaker && speaker !== (i % 2) + 1) {
          throw new InputError(
            `Block ${i + 1} must use Speaker ${(i % 2) + 1}. AI Studio alternates speakers when adding blocks.`,
          );
        }
      });
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
        add(`set voice for speaker ${i + 1}`, () => selectVoice(name));
        add(`leave speaker ${i + 1} library`, async () =>
          js<boolean>(exists("voiceSearch"))
            ? closeLibrary()
            : "voice selection closed the library",
        );
      }
      for (const [i, speech] of scene.blocks.entries()) {
        add(`verify speaker for block ${i + 1}`, () => {
          const expected = `Speaker ${speech.speaker ?? (i % 2) + 1}`;
          const actual = js<string>(label(item("speaker", block(i + 1))));
          if (!actual.startsWith(expected + " - "))
            throw new StepError(`Block ${i + 1}: expected ${expected}, found ${actual}.`);
          return actual;
        });
        add(`fill block ${i + 1}`, () => blockText(i + 1, speech.text));
        if (speech.style !== undefined)
          resultStep(`set style of block ${i + 1}`, () => blockStyle(i + 1, speech.style));
      }
      if (scene.temperature !== undefined)
        resultStep("set temperature", () => temperature(scene.temperature));
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
      resultStep("play sample", () => sampleVoice(args[0], out));
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
        duration = await waitForAudio(timeoutMs);
        result = { duration };
        return `player has ${duration.toFixed(2)} s of audio`;
      });
      if (out) resultStep("save WAV", () => exportAudio(out));
      break;
    }
    case "stop":
      count(0);
      resultStep("stop generation", async () => {
        tap("stop");
        await verify(`! (${exists("stop")})`, "AI Studio still shows an active generation.");
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
      add("close TTS tab", async () => {
        const { phase } = readSpeechAudio();
        if (phase === "generating" || phase === "streaming")
          throw new StepError("This tab is generating or streaming audio. Collect or stop first.");
        const label = currentTab();
        const target = readTabs()[label];
        if (!target) return "tab already closed";
        const { success } = await cdp((send) =>
          send("Target.closeTarget", { targetId: target.id }),
        );
        if (!success) throw new StepError("Chrome did not close the TTS target.");
        const tabs = readTabs();
        if (tabs[label]?.id === target.id) {
          delete tabs[label];
          writeTabs(tabs);
        }
        return "owned TTS tab closed";
      });
      break;
  }
  if (command !== "open" && !readTabs()[tab]) {
    if (command === "close") return;
    throw new InputError(`Tab ${tab} has no registered window. Run open --tab ${tab} first.`);
  }
  await runSteps([...browserSteps, ...steps], {
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
