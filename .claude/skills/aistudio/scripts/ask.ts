#!/usr/bin/env bun
// Send one prompt to AI Studio, optionally with files (video, image, audio, PDF, text...), wait, and save the answer.
//   new chat:   bun ask.ts [file ...] "<prompt>" [--out answer.md]           (prompt is always last; 0..n files)
//   follow-up:  bun ask.ts --chat <link|id> [file ...] "<prompt>" [--out answer.md]
//   collect:    bun ask.ts --chat <link|id> [--out answer.md]                  (wait for / fetch the chat's last answer)
//               bun ask.ts --collect [--out answer.md]                          (same, for the chat open in the tab)
// Every mode takes --tab <label> to work in its own window, in parallel with other tabs.
// Logs go to stderr, the answer to --out (or stdout). Exit 0 = answer saved, 1 = a step failed, 2 = bad input.
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { probeVideoMeta } from "../../../../scripts/review/gemini-video-input.ts";
import {
  ASK,
  browserSteps,
  CHAT_ID,
  chatUrlFrom,
  chip,
  chipCount,
  chipNameClashes,
  chipReady,
  chipsNamedReady,
  chipTextsByName,
  chipTokens,
  click,
  closeDialog,
  copyTurnMarkdown,
  currentChatUrl,
  currentTab,
  detectPossibleTruncation,
  fill,
  GENERATING,
  has,
  isVideoFile,
  js,
  one,
  openChat,
  openNewChat,
  openVideoDialog,
  pageAlerts,
  parseTokenCount,
  planUploads,
  pollUntil,
  readDeliveredTokensWithRetry,
  readSetting,
  resumeVideoVerificationArgs,
  runSteps,
  secs,
  selectOption,
  setTool,
  type Step,
  StepError,
  systemInstructions,
  TAB_RE,
  tabFlag,
  TimeoutError,
  toLF,
  toSeconds,
  TURN_COUNT,
  upload,
  useTab,
  verifyDeliveredVideoTokens,
  verifyVideoChipTokens,
  waitFor,
  waitForAnswer,
} from "./lib";
import {
  DEFAULT_MEDIA,
  DEFAULT_MODEL,
  DEFAULT_THINKING,
  dynamic,
  MEDIA,
  TEXT,
  THINKING,
  toolName,
  TOOLS,
  URLS,
  VIDEO_EXT,
} from "./page-map";

const USAGE = `Usage:
  new chat:   ${ASK} [file ...] "<prompt>" [options]                 (prompt is always last)
  follow-up:  ${ASK} --chat <link|id> [file ...] "<prompt>" [options]
  collect:    ${ASK} --chat <link|id> [--out file.md]
              ${ASK} --collect [--out file.md]             (the chat open in the tab, e.g. before it has a link)
  A prompt that starts with "-" goes after --:  ${ASK} a.mp4 --out x.md -- "- list the cuts"
Options:
  --prompt-file <file>       read the prompt from a file (long prompts); then every argument is an attachment
  --files-from <file>        also attach every path listed in this file, one per line (beats the ~32K-char Windows
                             command line, e.g. hundreds of --batch frames)
  --tab <label>              work in this tab (default main); other tabs can run at the same time
  --out <file.md>            save the answer here (default: print to stdout)
  --model <id>               new chat only, default ${DEFAULT_MODEL} (list: studio.ts models)
  --thinking <level>         e.g. ${THINKING.join(" | ")}; each model has its own list (new chat on ${DEFAULT_MODEL}: ${DEFAULT_THINKING}; otherwise the chat's own)
  --media <resolution>       ${MEDIA.join(" | ")} (new chat default ${DEFAULT_MEDIA}; follow-up keeps the chat's)
  --system "<text>"          replace the chat's system instructions before sending ("" clears; saved with the chat on Run)
  --system-file <file>       the same, read from a file (e.g. a workflow skill's system/*.md or any non-empty UTF-8 prompt file)
  --tool <name>=<on|off>     switch a tool before sending, repeatable: ${Object.keys(TOOLS).join(" | ")} or its full name
                             (AI Studio carries the Google Search switch over to every new chat, so set it when it matters)
  --min-in-tokens <n>        fail if delivered IN/total tokens fall below <n> (also works with --collect)
  --previous-tokens <in,total>  resume a follow-up delivery check with the previous token counts (use none for unavailable)
  --batch                    upload every non-video file in one go (seconds, not ~20 s per file); AI Studio then lists
                             them in upload-finish order, so label each file (e.g. a burned timecode) instead of relying
                             on order; videos still upload one by one after the batch; keep a prompt at or below
                             ~450 images (600 froze AI Studio)
Video files only (${VIDEO_EXT.join(" ")}):
  --fps <n>                  0 < n <= 24 (default 24)
  --start <t> --end <t>      clip window like 1m10s / 2m30s (default whole video)
  --agentic                  "Agentic video understanding" (replaces --fps/--start/--end); AI Studio still feeds it
                             1 frame per second, so use --batch stills for sub-second checks
                             Static video checks use ffprobe to verify the requested sampling.
Waits:
  --upload-timeout-min <n>   default 15
  --run-timeout-min <n>      default 60`;

function usage(msg: string): never {
  console.error(`✗ input: ${msg}\n\n${USAGE}`);
  process.exit(2);
}

function parse() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        "prompt-file": { type: "string" },
        "files-from": { type: "string" },
        tab: { type: "string" },
        chat: { type: "string" },
        collect: { type: "boolean" },
        out: { type: "string" },
        model: { type: "string" },
        thinking: { type: "string" },
        media: { type: "string" },
        system: { type: "string" },
        "system-file": { type: "string" },
        tool: { type: "string", multiple: true },
        fps: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        agentic: { type: "boolean" },
        batch: { type: "boolean" },
        "min-in-tokens": { type: "string" },
        "previous-tokens": { type: "string" },
        "upload-timeout-min": { type: "string", default: "15" },
        "run-timeout-min": { type: "string", default: "60" },
      },
    });
  } catch (e) {
    usage((e as Error).message);
  }
}
const { values: opts, positionals: args } = parse();
if (opts.help) {
  console.error(USAGE);
  process.exit(0);
}
const isNumber = (s?: string) => s !== undefined && /^\d+(\.\d+)?$/.test(s);
let minInTokens: number | undefined;
if (opts["min-in-tokens"] !== undefined) {
  const raw = opts["min-in-tokens"].trim();
  const parsed = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(parsed) || parsed <= 0)
    usage(`--min-in-tokens must be a positive integer, got "${opts["min-in-tokens"]}"`);
  minInTokens = parsed;
}

if (opts.tab !== undefined) {
  if (!TAB_RE.test(opts.tab))
    usage(`--tab takes a label like main, b or review-2, got "${opts.tab}"`);
  useTab(opts.tab);
}

type Mode = "new" | "follow-up" | "collect";
let mode: Mode;
let files: string[] = [];
let prompt = "";
let chatUrl = "";
const videoOptions = [opts.fps, opts.start, opts.end, opts.agentic].some((v) => v !== undefined);
const tools = (opts.tool ?? []).map((t) => {
  const [, alias = "", state] =
    /^(.*)=(on|off)$/.exec(t) ?? usage(`--tool needs =on or =off, got "${t}"`);
  const name =
    toolName(alias) ?? usage(`--tool takes one of: ${Object.keys(TOOLS).join(", ")}, got "${t}"`);
  return { name, on: state === "on" };
});
if (new Set(tools.map((t) => t.name)).size < tools.length) usage("--tool names a tool twice");
const systemFile = opts["system-file"];
if (systemFile !== undefined && opts.system !== undefined)
  usage("--system and --system-file both set the system instructions; pick one");
if (systemFile !== undefined && !existsSync(systemFile))
  usage(`system file not found: ${systemFile}`);
const system = systemFile === undefined ? opts.system : readFileSync(systemFile, "utf8");
// An empty file is a template not written yet; clearing the instructions takes --system "".
if (systemFile !== undefined && !system!.trim()) usage(`system file is empty: ${systemFile}`);

if (opts.collect) {
  if (
    opts.chat ||
    args.length ||
    opts["prompt-file"] !== undefined ||
    opts.model ||
    opts.thinking ||
    opts.media ||
    system !== undefined ||
    tools.length ||
    videoOptions
  ) {
    usage(
      "--collect takes --out, --tab, --min-in-tokens, --previous-tokens, and --run-timeout-min (it reads the chat open in the tab)",
    );
  }
  mode = "collect";
} else {
  if (opts.chat) {
    chatUrl =
      chatUrlFrom(opts.chat) ??
      usage(`--chat must be an AI Studio chat link or id, got "${opts.chat}"`);
    if (opts.model)
      usage("--model only applies to a new chat; switch a chat's model with studio.ts model <id>");
  }
  const promptFile = opts["prompt-file"];
  if (promptFile !== undefined) {
    if (!existsSync(promptFile)) usage(`prompt file not found: ${promptFile}`);
    prompt = toLF(readFileSync(promptFile, "utf8"));
    files = args.map((f) => resolve(f));
  } else {
    files = args.slice(0, -1).map((f) => resolve(f));
    prompt = toLF(args.at(-1) ?? "");
    // A forgotten prompt would otherwise send the file name as the prompt.
    if (existsSync(prompt) && statSync(prompt).isFile())
      usage(
        `the last argument is a file (${prompt}); the prompt goes last: ${ASK} <file ...> "<prompt>"`,
      );
  }
  const filesFrom = opts["files-from"];
  if (filesFrom !== undefined) {
    if (!existsSync(filesFrom)) usage(`--files-from list not found: ${filesFrom}`);
    const listed = readFileSync(filesFrom, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    files = [...files, ...listed.map((f) => resolve(f))];
  }
  if (opts.chat && !args.length && promptFile === undefined && filesFrom === undefined) {
    mode = "collect";
    if (opts.thinking || opts.media || system !== undefined || tools.length || videoOptions)
      usage("collect mode sends nothing, so it takes no settings");
  } else {
    if (!prompt.trim()) usage("the prompt is empty");
    mode = opts.chat ? "follow-up" : "new";
  }
}

const previousTokens = opts["previous-tokens"];
const decodePrevious = (value: string) => (value === "none" ? null : Number(value));
let previousBaseline: { lastTurnInTokens: number | null; topTokens: number | null } | undefined;
if (previousTokens !== undefined) {
  const fields = previousTokens.split(",");
  if (
    mode !== "collect" || minInTokens === undefined || fields.length !== 2 ||
    fields.some((value) => value !== "none" && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))))
  ) usage("--previous-tokens takes in,total (numbers or none) in collect mode with --min-in-tokens");
  previousBaseline = { lastTurnInTokens: decodePrevious(fields[0]!), topTokens: decodePrevious(fields[1]!) };
}

const isVideo = isVideoFile;
const videos = files.filter(isVideo);
if (videoOptions && !videos.length)
  usage("--fps/--start/--end/--agentic need at least one video file");
const bytes = new Map<string, number>();
for (const file of files) {
  if (!existsSync(file)) usage(`file not found: ${file}`);
  const size = statSync(file).size;
  if (!size) usage(`file is empty: ${file}`);
  // A real clip is never this small; the Downloads folder holds many 4-byte broken "mp4" files.
  if (isVideo(file) && size < 10_000)
    usage(`video is only ${size} bytes, so it is broken: ${file}`);
  bytes.set(file, size);
}
// AI Studio labels each attachment only by its file name, which is how each one's chip is found.
const names = files.map((f) => basename(f));
if (new Set(names).size !== names.length)
  usage(`two files share a name (${names.join(", ")}); rename or copy one first`);
if (opts.batch) {
  if (files.every(isVideo))
    usage("--batch needs at least one non-video file (videos always upload one by one)");
  const [clash] = chipNameClashes(names);
  if (clash) usage(`with --batch, "${clash[0]}" also appears inside "${clash[1]}"; rename one`);
}
const plan = planUploads(files, !!opts.batch);
const uploadOrder = [...plan.batch, ...plan.serial];

const model = opts.model ?? DEFAULT_MODEL;
// Levels differ per model, so only the default model gets a default level; the page reports what a model offers.
const thinking =
  opts.thinking ?? (mode === "new" && model === DEFAULT_MODEL ? DEFAULT_THINKING : undefined);
const media = opts.media ?? (mode === "new" ? DEFAULT_MEDIA : undefined);
if (opts.thinking === "" || opts.media === "") usage("--thinking/--media need a level");
const agentic = !!opts.agentic;
// In AI Studio's video dialog the Agentic switch hides the FPS and clip boxes: the two modes exclude each other.
if (agentic && [opts.fps, opts.start, opts.end].some((v) => v !== undefined))
  usage(
    "--agentic replaces --fps/--start/--end in AI Studio (the dialog hides them); use one or the other",
  );
const fps = Number(opts.fps ?? 24);
if (!(isNumber(opts.fps ?? "24") && fps > 0 && fps <= 24))
  usage("--fps must be a number > 0 and <= 24 (AI Studio's limit)");
for (const t of [opts.start, opts.end]) {
  if (t !== undefined && Number.isNaN(toSeconds(t)))
    usage(`--start/--end look like 1m10s, 90s or 1h2m3s, got "${t}"`);
}
const uploadTimeoutMs = Number(opts["upload-timeout-min"]) * 60_000;
const runTimeoutMs = Number(opts["run-timeout-min"]) * 60_000;
if (
  ![opts["upload-timeout-min"], opts["run-timeout-min"]].every(isNumber) ||
  !(uploadTimeoutMs > 0 && runTimeoutMs > 0)
)
  usage("timeouts must be positive numbers of minutes");
const outPath = opts.out ? resolve(opts.out) : undefined;
const outArg = outPath ? ` --out "${outPath}"` : "";

type VideoSettings = { fps: number; start: string; end: string; agentic: boolean | null };
const readDialog = () =>
  js<VideoSettings>(`({
    fps: Number(${one("fpsInput")}?.value),
    start: ${one("startTime")}?.value ?? '',
    end: ${one("endTime")}?.value ?? '',
    agentic: ${one("agenticVideo")} ? ${one("agenticVideo")}.getAttribute('aria-checked') === 'true' : null,
  })`);

function checkDialog(name: string, got: VideoSettings) {
  const bad: string[] = [];
  if (agentic) {
    if (got.agentic !== true) bad.push(`agentic ${got.agentic}`);
  } else if (got.fps !== fps) bad.push(`FPS ${got.fps} (wanted ${fps})`);
  // AI Studio rewrites the times it saves (0m2s -> 2s), so compare them as seconds.
  if (opts.start !== undefined && toSeconds(got.start) !== toSeconds(opts.start))
    bad.push(`start "${got.start}" (wanted ${opts.start})`);
  if (opts.end !== undefined && toSeconds(got.end) !== toSeconds(opts.end))
    bad.push(`end "${got.end}" (wanted ${opts.end})`);
  if (bad.length) throw new StepError(`${name} shows ${bad.join(", ")} after saving`);
}

const describe = (s: VideoSettings) =>
  s.agentic
    ? "agentic video understanding"
    : `${s.fps} fps${s.start || s.end ? `, ${s.start || "start"}-${s.end || "end"}` : ""}`;

// ---------- steps ----------

let answer = "";
let turnsBefore: number | undefined;
const steps: Step[] = [];
const add = (name: string, run: Step[1]) => steps.push([name, run]);

add("check input", () => {
  if (outPath) mkdirSync(dirname(outPath), { recursive: true });
  const settings = [thinking && `thinking ${thinking}`, media && `media ${media}`]
    .filter(Boolean)
    .join(", ");
  const list = files.map((f) => `${basename(f)} ${(bytes.get(f)! / 1e6).toFixed(1)} MB`);
  const attached = files.length
    ? `; ${files.length} file(s): ${list.join(", ")}${videos.length ? (agentic ? "; videos agentic" : `; videos ${fps} fps`) : ""}`
    : "";
  if (mode === "new") return `new chat, tab ${currentTab()}, ${model}, ${settings}${attached}`;
  if (mode === "follow-up")
    return `follow-up in ${chatUrl}, tab ${currentTab()}${settings ? `; ${settings}` : ""}${attached}`;
  return `collect the last answer of ${chatUrl || "the chat open in the tab"} (tab ${currentTab()})`;
});

steps.push(...browserSteps);

const shouldVerifyDelivery =
  (mode !== "collect" && videos.length > 0 && !agentic) || minInTokens !== undefined;
let baselineTokens: { topTokens: number | null; lastTurnInTokens: number | null } = {
  topTokens: null,
  lastTurnInTokens: null,
};

if (mode === "new") {
  add("open new chat", () => openNewChat(model));
} else {
  add("open chat", async () => {
    if (opts.collect) {
      if (!js<boolean>(`location.origin === ${JSON.stringify(URLS.origin)} && ${TURN_COUNT} > 0`)) {
        throw new StepError(
          `the open tab holds no AI Studio chat (at ${js<string>("location.href")})`,
        );
      }
      chatUrl = currentChatUrl();
      return `open tab, ${js<number>(TURN_COUNT)} turns, ${chatUrl || "unsaved chat"}${js<boolean>(GENERATING) ? ", still generating" : ""}`;
    }
    const { here, turns, busy } = await openChat(chatUrl);
    if (mode === "follow-up" && busy)
      throw new StepError(
        "this chat is still generating; collect that answer before sending another prompt",
      );
    if (mode === "follow-up" && shouldVerifyDelivery) {
      baselineTokens = await readDeliveredTokensWithRetry();
    }
    return `${turns} turns${here ? ", tab was already on it (not reloaded)" : ""}${busy ? ", still generating" : ""}`;
  });
}

if (thinking) add("set thinking level", () => selectOption("thinking", thinking));
if (media) add("set media resolution", () => selectOption("media", media));
if (system !== undefined) {
  add(
    "set system instructions",
    async () =>
      `${(await systemInstructions(system)).length} chars${systemFile === undefined ? "" : ` from ${systemFile}`}`,
  );
}
for (const { name, on } of tools) add(`turn ${name} ${on ? "on" : "off"}`, () => setTool(name, on));

const videoChipTokensByIndex = new Map<number, number>();
let sourceTokenFloor = 0;
let checkedMedia = media;
const expectedChipTokens = () => [...videoChipTokensByIndex.values()].reduce((sum, n) => sum + n, 0);
if (plan.batch.length) {
  const batchNames = plan.batch.map((f) => basename(f));
  add(`upload ${plan.batch.length} file(s) at once`, async () => {
    const before = js<number>(chipCount);
    if (before !== 0) {
      throw new StepError(
        `the prompt box already holds ${before} attachment(s) from an earlier run in this tab; remove them or use another --tab`,
      );
    }
    const t0 = Date.now();
    upload(one("fileInput"), "file input", ...plan.batch);
    try {
      await pollUntil(
        `${chipCount} === ${plan.batch.length} && ${chipsNamedReady(batchNames)}`,
        uploadTimeoutMs,
        (ms) => console.error(`  … still uploading, ${js<number>(chipCount)}/${plan.batch.length} chips (${secs(ms)})`),
      );
    } catch (e) {
      if (!(e instanceof TimeoutError)) throw e;
      throw new StepError(
        `the batch is still uploading after ${secs(uploadTimeoutMs)} (${js<number>(chipCount)}/${plan.batch.length} chips); raise --upload-timeout-min. AI Studio alerts: ${pageAlerts() || "none"}`,
      );
    }
    const tokens = js<(string | null)[]>(chipTextsByName(batchNames))
      .map((t) => parseTokenCount(t?.match(TEXT.chipReady)?.[0] ?? "") ?? 0)
      .reduce((sum, n) => sum + n, 0);
    return `${plan.batch.length} file(s) ready in ${secs(Date.now() - t0)}, ${tokens.toLocaleString("en-US")} tokens, listed in upload-finish order`;
  });
}

for (const [j, file] of plan.serial.entries()) {
  const i = plan.batch.length + j;
  const name = basename(file);
  const tag = files.length > 1 ? ` ${i + 1}/${files.length} (${name})` : ` (${name})`;

  add(`upload${tag}`, async () => {
    // Chips are found by position, so the box must hold only this run's attachments.
    const before = js<number>(chipCount);
    if (before !== i) {
      throw new StepError(
        `the prompt box already holds ${before - i} attachment(s) from an earlier run in this tab; remove them or use another --tab`,
      );
    }
    upload(one("fileInput"), "file input", file);
    if (!(await waitFor(`${chipCount} > ${i} && !!${chip(i, name)}`, 30_000))) {
      throw new StepError(
        `the chip for ${name} never appeared; AI Studio alerts: ${pageAlerts() || "none"}`,
      );
    }
    try {
      await pollUntil(chipReady(i, name), uploadTimeoutMs, (ms) =>
        console.error(`  … still uploading ${name} (${secs(ms)})`),
      );
    } catch (e) {
      if (!(e instanceof TimeoutError)) throw e;
      throw new StepError(
        `${name} is still uploading after ${secs(uploadTimeoutMs)}; raise --upload-timeout-min`,
      );
    }
    const count = js<number>(chipCount);
    if (count !== i + 1)
      throw new StepError(`expected ${i + 1} attachment(s) in the prompt, found ${count}`);
    return `${chipTokens(i, name)}${isVideo(file) ? " at the default frame rate" : ""}`;
  });

  if (!isVideo(file)) continue;
  add(`video settings${tag}`, async () => {
    await openVideoDialog(i, name, uploadTimeoutMs);
    if (!agentic) {
      fill(one("fpsInput"), "FPS box", String(fps));
      if (opts.start !== undefined) fill(one("startTime"), "Start Time box", opts.start);
      if (opts.end !== undefined) fill(one("endTime"), "End Time box", opts.end);
    } else if (
      js<string | null>(`${one("agenticVideo")}?.getAttribute('aria-checked') ?? null`) !== "true"
    ) {
      if (!js<boolean>(has("agenticVideo")))
        throw new StepError("no Agentic video understanding switch in the dialog");
      click(one("agenticVideo"), "Agentic video understanding switch");
    }
    await closeDialog("dialogSave");
    await openVideoDialog(i, name, uploadTimeoutMs);
    const saved = readDialog();
    await closeDialog("dialogCancel");
    checkDialog(name, saved);
    await pollUntil(chipReady(i, name), uploadTimeoutMs);
    const tokLabel = chipTokens(i, name);
    if (!agentic) {
      const tokNum = parseTokenCount(tokLabel);
      if (tokNum === null)
        throw new StepError(`could not parse token count from chip of ${name} (got "${tokLabel}")`);
      videoChipTokensByIndex.set(i, tokNum);
    }
    return `${describe(saved)} saved, now ${tokLabel}`;
  });
}

if (videos.length > 1) {
  add("recheck all videos", async () => {
    // Saving one video's settings must not have reset another's.
    const report: string[] = [];
    for (const [i, file] of uploadOrder.entries()) {
      if (!isVideo(file)) continue;
      const name = basename(file);
      await openVideoDialog(i, name, uploadTimeoutMs);
      const saved = readDialog();
      await closeDialog("dialogCancel");
      checkDialog(name, saved);
      await pollUntil(chipReady(i, name), uploadTimeoutMs);
      const tokLabel = chipTokens(i, name);
      if (!agentic) {
        const tokNum = parseTokenCount(tokLabel);
        if (tokNum === null)
          throw new StepError(
            `could not parse token count from chip of ${name} (got "${tokLabel}")`,
          );
        videoChipTokensByIndex.set(i, tokNum);
      }
      report.push(`${name} ${describe(saved)} ${tokLabel}`);
    }
    return report.join("; ");
  });
}

if (videos.length && !agentic) {
  add("verify video chip counts", async () => {
    const actualMedia = await readSetting("media");
    if (!MEDIA.includes(actualMedia))
      throw new StepError(`Media resolution could not be verified (got "${actualMedia}")`);
    checkedMedia = actualMedia;
    for (const [index, tokens] of videoChipTokensByIndex) {
      const file = uploadOrder[index]!;
      const { floor, reason } = verifyVideoChipTokens(tokens, probeVideoMeta(file), {
        start: opts.start === undefined ? undefined : toSeconds(opts.start),
        end: opts.end === undefined ? undefined : toSeconds(opts.end),
        fps,
        media: actualMedia,
      });
      if (reason) throw new StepError(`${basename(file)}: ${reason}`);
      sourceTokenFloor += floor;
    }
    return `${sourceTokenFloor.toLocaleString("en-US")} minimum input tokens from source video`;
  });
}

if (mode !== "collect") {
  add("type prompt", () => {
    const count = js<number>(chipCount);
    if (count !== files.length)
      throw new StepError(`expected ${files.length} attachment(s) in the prompt, found ${count}`);
    fill(one("promptBox"), "prompt box", prompt);
    const now = js<string>(`${one("promptBox")}?.value ?? ''`);
    if (now !== prompt)
      throw new StepError("the prompt box does not hold the prompt that was typed");
    return `${prompt.length} chars`;
  });

  add("run", async () => {
    turnsBefore = js<number>(TURN_COUNT);
    click(one("runButton"), "Run button");
    if (!(await waitFor(`${GENERATING} || ${TURN_COUNT} > ${turnsBefore}`, 30_000)))
      throw new StepError(`the run never started; AI Studio alerts: ${pageAlerts() || "none"}`);
    chatUrl = currentChatUrl() || chatUrl;
    // The search switch carries over between new chats, so every log says which one this answer used.
    const search = js<string | null>(
      `${one(dynamic.toolSwitch(TOOLS.search!))}?.getAttribute('aria-checked') ?? null`,
    );
    const grounding = `Google Search grounding ${search === "true" ? "on" : search === "false" ? "off" : "not offered"}`;
    return chatUrl
      ? `generating in ${chatUrl}, ${grounding}`
      : `generating, ${grounding} (a new chat gets its saved link when the answer is done)`;
  });
}

add("wait for answer", () =>
  waitForAnswer({
    turnsBefore,
    timeoutMs: runTimeoutMs,
    resumeHint: () => {
      const url = chatUrl || currentChatUrl();
      const minArg = resumeVideoVerificationArgs(
        expectedChipTokens(),
        Math.max(sourceTokenFloor, minInTokens ?? 0),
        mode === "follow-up" ? baselineTokens : previousBaseline,
      );
      return `${ASK}${tabFlag()} ${url ? `--chat ${url}` : "--collect"}${minArg}${outArg}`;
    },
  }),
);

if (shouldVerifyDelivery) {
  add("verify video delivery", async () => {
    const hasNonAgenticVideos = mode !== "collect" && videos.length > 0 && !agentic;
    if (hasNonAgenticVideos && videoChipTokensByIndex.size !== videos.length) {
      throw new StepError(
        `missing parsed chip token counts (${videoChipTokensByIndex.size}/${videos.length} videos)`,
      );
    }
    const delivered = await readDeliveredTokensWithRetry();
    const baseline = mode === "follow-up" ? baselineTokens : previousBaseline;
    const verdict = verifyDeliveredVideoTokens({
      expectedVideoTokens: expectedChipTokens(),
      actualInTokens: delivered.lastTurnInTokens,
      topTokens: delivered.topTokens,
      requestedFps: fps,
      requestedMedia: checkedMedia,
      baselineInTokens: baseline?.lastTurnInTokens,
      baselineTopTokens: baseline?.topTokens,
      requireBaseline: baseline !== undefined,
      hasNonAgenticVideos,
      minDeliveredTokens: Math.max(sourceTokenFloor, minInTokens ?? 0),
    });
    if (!verdict.ok) throw new StepError(verdict.reason!);
    return verdict.summary;
  });
}

let truncationReason: string | null = null;

add("copy answer", async () => {
  if (js<string>(CHAT_ID)) chatUrl = currentChatUrl();
  answer = await copyTurnMarkdown(-1);
  if (!answer.trim())
    throw new StepError(`the answer is empty; AI Studio alerts: ${pageAlerts() || "none"}`);
  truncationReason = detectPossibleTruncation(answer);
  return `${answer.length} chars of markdown${truncationReason ? ` (⚠ may be truncated: ${truncationReason})` : ""}`;
});

add("save answer", async () => {
  if (!outPath) {
    console.log(answer);
    return "printed to stdout";
  }
  await Bun.write(outPath, answer);
  if ((await Bun.file(outPath).text()) !== answer)
    throw new StepError(`${outPath} does not match the copied answer`);
  return outPath;
});

await runSteps(steps, {
  onDone: () => {
    if (truncationReason)
      console.error(
        `  ⚠ warning: answer may be truncated (${truncationReason}); send a follow-up to continue from where it stopped`,
      );
    console.error(
      `  chat: ${chatUrl || `(not saved yet; run ${ASK}${tabFlag()} --collect later to get its link)`}`,
    );
    if (chatUrl)
      console.error(
        `  follow-up: ${ASK}${tabFlag()} --chat ${chatUrl} "<prompt>"${outArg ? " --out <file.md>" : ""}`,
      );
  },
});
