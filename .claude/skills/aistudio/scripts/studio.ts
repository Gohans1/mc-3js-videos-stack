#!/usr/bin/env bun
// Toolbox for the whole AI Studio web app: tabs, chats, settings, History, reading chats, and the health check of
// page-map.ts. Sending prompts (with or without attachments) is ask.ts. Logs go to stderr, data to stdout.
// Exit 0 = done and confirmed, 1 = a step failed (screenshot saved), 2 = bad input.
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  ab,
  abArgs,
  accountName,
  all,
  ASK,
  browserSteps,
  chatTitle,
  chatUrlFrom,
  chipReady,
  chromeStep,
  chromeUp,
  click,
  closeDialog,
  closeModelPicker,
  closePanel,
  closeWindowOf,
  copyTurnMarkdown,
  currentChatUrl,
  currentTab,
  fill,
  GENERATING,
  has,
  js,
  navigate,
  one,
  openChat,
  openModelPicker,
  openNewChat,
  openTurnMenu,
  openVideoDialog,
  pageAlerts,
  pageTargets,
  pollUntil,
  PORT,
  prepareTab,
  probe,
  readSettings,
  readTabs,
  renameChat,
  runSteps,
  selectOption,
  setTool,
  showTurn,
  SKILL_DIR,
  startChrome,
  type Step,
  StepError,
  STUDIO,
  switchModel,
  systemInstructions,
  TAB_RE,
  tabFlag,
  TURN_COUNT,
  TURNS,
  upload,
  useTab,
  waitFor,
  writeTabs,
} from "./lib";
import {
  type Candidate,
  DEFAULT_MODEL,
  dynamic,
  type Entry,
  type Key,
  MAP,
  MEDIA,
  TEXT,
  THINKING,
  toolName,
  TOOLS,
  TOOLS_SOME_MODELS,
  URLS,
  type Where,
} from "./page-map";

const USAGE = `Usage: ${STUDIO} <command> [--tab <label>] [options]
Every command acts on one tab (default main). Each tab is its own hidden Chrome window, made on first use, so
different tabs can work in parallel (one command per tab at a time). --json where noted prints data as JSON.

Tabs and chats
  tabs                            every tab: label, url, title  [--json]
  tab close <label>               close a tab's window (refused while it generates)
  status                          url, account, chat, title, turns, generating?, settings  [--json]
  open new [--model <id>]         fresh chat (default ${DEFAULT_MODEL})
  open <chat link|id>             a saved chat (not reloaded if already open there)
  rename "<title>" [--description "<text>"]   rename the open chat
  read [chat link|id] [--thoughts] [--out <file.md>]   whole chat as markdown (default: the open chat)
Settings of the open chat
  models [--search <text>]        every model in the picker: id + title + blurb  [--json]
  model <id>                      switch model
  set thinking <level>            e.g. ${THINKING.join(", ")}; each model has its own list (a wrong one prints the model's)
  set media <level>               e.g. ${MEDIA.join(", ")}
  tool <${Object.keys(TOOLS).join("|")}|full name> <on|off>   (search also becomes the default of every later new chat)
  system ["<text>"]               show the system instructions, or replace them ("" clears); AI Studio saves them with the chat on its next run
History
  history [--search <text>] [--limit <n>]   saved chats, newest first  [--json]
Health and low level
  doctor [--quick]                check every page-map.ts locator on the live UI, no model quota (--quick skips upload)  [--json]
  smoke                           full ask.ts run on assets/doctor-2s.mp4 (one small model request)
  map                             every named element of page-map.ts: page state, purpose, locators (no browser)
  screenshot [file.png]           what the tab shows now
  ab <agent-browser args...>      escape hatch: agent-browser bound to this tab (e.g. ab snapshot -i); close is refused
  chrome [--show]                 start Chrome (port ${PORT}) and the tab's window off-screen; --show puts it on screen to log in by hand
Sending prompts and files: ${ASK} --help`;

function usage(msg: string): never {
  console.error(`✗ input: ${msg}\n\n${USAGE}`);
  process.exit(2);
}

const argv = process.argv.slice(2);
// --tab <label> or --tab=<label> works anywhere on the line, also in front of the ab escape hatch's own arguments.
const tabAt = argv.findIndex((a) => a === "--tab" || a.startsWith("--tab="));
if (tabAt >= 0) {
  const inline = argv[tabAt]!.startsWith("--tab=");
  const label = inline ? argv[tabAt]!.slice(6) : (argv[tabAt + 1] ?? "");
  if (!TAB_RE.test(label)) usage(`--tab takes a label like main, b or review-2, got "${label}"`);
  useTab(label);
  argv.splice(tabAt, inline ? 1 : 2);
}
const [command, ...rest] = argv;
if (!command || command === "help" || command === "--help") {
  console.error(USAGE);
  process.exit(command ? 0 : 2);
}

// Escape hatch: hand everything to agent-browser untouched, bound to this tab.
if (command === "ab") {
  const quit = rest.find((a) => ["close", "quit", "exit"].includes(a));
  if (quit)
    usage(`ab ${quit} would close the shared Chrome with every tab; use \`tab close <label>\``);
  await startChrome();
  await prepareTab();
  const p = Bun.spawnSync([...abArgs(), ...rest], { stdio: ["inherit", "inherit", "inherit"] });
  process.exit(p.exitCode ?? 1);
}
// The page map without opening a browser: every named element, the page state it lives in, and its locators.
if (command === "map") {
  const show = (c: Candidate) =>
    "testId" in c
      ? `testId=${c.testId}`
      : "css" in c
        ? `css ${c.css}`
        : `${c.role}${c.name === undefined ? "" : ` "${typeof c.name === "string" ? c.name : `/${c.name.re}/`}"`}`;
  for (const [key, e] of Object.entries(MAP) as [Key, Entry][]) {
    console.log(
      `${e.where.padEnd(13)} ${key.padEnd(19)} ${e.what}\n${" ".repeat(34)}${e.candidates.map(show).join("  |  ")}`,
    );
  }
  console.log(
    `\ntools (studio.ts tool <alias>): ${Object.entries(TOOLS)
      .map(([a, n]) => `${a}="${n}"`)
      .join(", ")}`,
  );
  console.log(
    `urls: new chat ${URLS.newChat("MODEL")}, chat ${URLS.chat("<id>")}, History ${URLS.library}`,
  );
  process.exit(0);
}
function parse() {
  try {
    return parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        json: { type: "boolean" },
        model: { type: "string" },
        search: { type: "string" },
        limit: { type: "string" },
        thoughts: { type: "boolean" },
        out: { type: "string" },
        quick: { type: "boolean" },
        show: { type: "boolean" },
        description: { type: "string" },
      },
    });
  } catch (e) {
    usage((e as Error).message);
  }
}
const { values: opt, positionals: args } = parse();

/** Data goes to stdout once every step is confirmed: JSON with --json, text otherwise. */
let result: { data: unknown; text: () => string } | undefined;
const emit = (data: unknown, text: () => string) => (result = { data, text });
/** What runs before the command's own steps: start Chrome and bind the tab, unless the command says otherwise. */
let prelude: Step[] = browserSteps;
const steps: Step[] = [];
const add = (name: string, run: Step[1]) => steps.push([name, run]);

async function onChat() {
  if (!js<boolean>(has("promptBox"))) {
    throw new StepError(
      `the tab is not on a chat (at ${js<string>("location.href")}); run \`${STUDIO}${tabFlag()} open new\` or \`open <chat>\``,
    );
  }
}

switch (command) {
  case "chrome":
    if (opt.show) prelude = [chromeStep, ["show window", () => prepareTab(true)]];
    break;

  case "tabs":
    prelude = []; // listing must not start Chrome or open a tab
    add("list tabs", async () => {
      if (!(await chromeUp())) {
        emit([], () => "");
        return `Chrome is not running on port ${PORT}`;
      }
      const pages = await pageTargets();
      // Forget labels whose window is gone (Chrome restarted, or closed by hand).
      const tabs = Object.fromEntries(
        Object.entries(readTabs()).filter(([, t]) => pages.some((p) => p.id === t.id)),
      );
      writeTabs(tabs);
      const labelOf = Object.fromEntries(Object.entries(tabs).map(([l, t]) => [t.id, l]));
      const rows = pages.map((p) => ({ tab: labelOf[p.id] ?? null, url: p.url, title: p.title }));
      emit(rows, () =>
        rows.map((r) => `${(r.tab ?? "-").padEnd(12)} ${r.url}  ${r.title}`).join("\n"),
      );
      return `${rows.length} windows, ${Object.keys(tabs).length} with a label`;
    });
    break;

  case "tab": {
    const label = args[1];
    if (args[0] !== "close" || !label)
      usage("tab takes: close <label> (tabs open by themselves on first --tab use)");
    prelude = [];
    add(`close tab ${label}`, async () => {
      const id = readTabs()[label]?.id;
      if (!id || !(await chromeUp()) || !(await pageTargets()).some((p) => p.id === id))
        throw new StepError(`no open tab "${label}" (see \`${STUDIO} tabs\`)`);
      useTab(label);
      ab("tab", id);
      if (js<boolean>(GENERATING)) {
        throw new StepError(
          `tab ${label} is still generating; collect it first (${ASK} --tab ${label} --collect)`,
        );
      }
      const closed = await closeWindowOf(id);
      const { [label]: _, ...others } = readTabs();
      writeTabs(others);
      return `closed its window (${closed} tab${closed === 1 ? "" : "s"})`;
    });
    break;
  }

  case "rename": {
    const title = args[0]?.trim() || usage('rename needs the new title: rename "<title>"');
    add("rename chat", async () => {
      await onChat();
      return `${chatTitle()} -> ${await renameChat(title, opt.description)}`;
    });
    break;
  }

  case "system": {
    const text = args[0];
    add(text === undefined ? "read system instructions" : "set system instructions", async () => {
      await onChat();
      const now = await systemInstructions(text);
      emit(now, () => now || "(none)");
      // AI Studio stores system instructions with the chat only when a prompt runs.
      return text === undefined
        ? `${now.length} chars`
        : `${now.length} chars, set in this tab; saved with the chat on its next run (${ASK}${tabFlag()} --chat ...)`;
    });
    break;
  }

  case "status":
    add("read page", () => {
      const onChatPage = js<boolean>(has("promptBox"));
      const data = {
        url: js<string>("location.href"),
        account: accountName(),
        chat: currentChatUrl(),
        title: chatTitle(),
        generating: js<boolean>(GENERATING),
        turns: js<number>(TURN_COUNT),
        settings: onChatPage ? readSettings(Object.values(TOOLS)) : null,
        alerts: pageAlerts(),
      };
      emit(data, () =>
        [
          `url: ${data.url}`,
          `account: ${data.account || "?"}`,
          `chat: ${data.chat || "(unsaved or not a chat)"}  title: ${data.title}`,
          `turns: ${data.turns}${data.generating ? "  (GENERATING)" : ""}`,
          data.settings
            ? `model: ${data.settings.model}  thinking: ${data.settings.thinking}  media: ${data.settings.media}  max output: ${data.settings.maxOutputTokens}\ntools: ${Object.entries(
                data.settings.tools,
              )
                .map(([n, v]) => `${n}=${v === null ? "absent" : v ? "on" : "off"}`)
                .join(", ")}`
            : "settings: (not on a chat page)",
          data.alerts ? `alerts: ${data.alerts}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
      return `${data.chat || data.url}, ${data.turns} turns`;
    });
    break;

  case "open": {
    const target = args[0] ?? usage("open needs `new` or a chat link/id");
    if (target === "new") {
      add("open new chat", () => openNewChat(opt.model ?? DEFAULT_MODEL));
    } else {
      const url = chatUrlFrom(target) ?? usage(`not an AI Studio chat link or id: ${target}`);
      add("open chat", async () => {
        const { here, turns, busy } = await openChat(url);
        return `${url}, ${turns} turns${here ? " (was already open)" : ""}${busy ? ", still generating" : ""}`;
      });
    }
    break;
  }

  case "models":
    add("open model picker", async () => {
      await onChat();
      await openModelPicker();
      return "open";
    });
    add("read models", async () => {
      const items = js<string[]>(
        `${all("modelPickerItem", one("modelPicker"))}.map((b) => AS.nameOf(b))`,
      );
      await closeModelPicker();
      const q = opt.search?.toLowerCase();
      const models = items
        .map((name) => ({ id: name.match(TEXT.modelId)?.[0] ?? "", name }))
        .filter((m) => m.id && (!q || m.name.toLowerCase().includes(q)));
      if (!models.length)
        throw new StepError(q ? `no model matches "${opt.search}"` : "the picker lists no models");
      emit(models, () =>
        models.map((m) => `${m.id.padEnd(28)} ${m.name.replace(m.id, "").trim()}`).join("\n"),
      );
      return `${models.length} models`;
    });
    break;

  case "model": {
    const id = args[0] ?? usage("model needs an id (list them with `models`)");
    add("switch model", async () => {
      await onChat();
      return switchModel(id);
    });
    break;
  }

  case "set": {
    const [which, value] = args;
    if (which !== "thinking" && which !== "media") usage("set takes `thinking` or `media`");
    if (!value)
      usage(
        `set ${which} needs a level, e.g. ${(which === "thinking" ? THINKING : MEDIA).join(", ")}`,
      );
    add(`set ${which}`, async () => {
      await onChat();
      return selectOption(which, value);
    });
    break;
  }

  case "tool": {
    const [alias, state] = args;
    const name =
      (alias && toolName(alias)) ?? usage(`tool takes one of: ${Object.keys(TOOLS).join(", ")}`);
    if (state !== "on" && state !== "off") usage("tool needs on or off");
    add(`turn ${name} ${state}`, async () => {
      await onChat();
      return setTool(name, state === "on");
    });
    break;
  }

  case "history": {
    const limit = Number(opt.limit ?? 20);
    if (!(Number.isInteger(limit) && limit > 0)) usage("--limit must be a whole number above 0");
    add("open History", async () => {
      navigate(URLS.library);
      if (!(await waitFor(has("libraryLink"), 30_000))) {
        throw new StepError(
          `History shows no saved chats (at ${js<string>("location.href")}); run \`${STUDIO}${tabFlag()} doctor\``,
        );
      }
      return `${js<number>(`${all("libraryLink")}.length`)} chats listed`;
    });
    if (opt.search) {
      add("search History", async () => {
        fill(one("librarySearch"), "History search box", opt.search!);
        const q = JSON.stringify(opt.search!.toLowerCase());
        // The list filters as you type; wait until every chat row mentions the query.
        const filtered = await waitFor(
          `${all("libraryRow")}.filter((r) => ${has("libraryLink", "r")}).every((r) => r.innerText.toLowerCase().includes(${q}))`,
          10_000,
        );
        if (!filtered)
          throw new StepError("the History list never filtered down to the search text");
        return `${js<number>(`${all("libraryLink")}.length`)} chats match`;
      });
    }
    add("read rows", () => {
      const rows = js<
        { title: string; url: string; row: string }[]
      >(`${all("libraryRow")}.map((r) => {
        const a = ${one("libraryLink", "r")};
        return a && { title: AS.norm(a.textContent), url: a.href, row: AS.norm(AS.textOf(r)) };
      }).filter(Boolean)`)
        .slice(0, limit)
        .map((r) => ({
          ...r,
          url: chatUrlFrom(r.url) ?? r.url,
          details: r.row.replace(r.title, "").trim(),
        }));
      emit(
        rows.map(({ title, url, details }) => ({ title, url, details })),
        () => rows.map((r) => `${r.url}  ${r.title}  ·  ${r.details}`).join("\n"),
      );
      return `${rows.length} rows`;
    });
    break;
  }

  case "read": {
    const url = args[0]
      ? (chatUrlFrom(args[0]) ?? usage(`not an AI Studio chat link or id: ${args[0]}`))
      : undefined;
    if (url) {
      add("open chat", async () => {
        const { turns, busy } = await openChat(url);
        if (busy)
          throw new StepError(
            `the chat is still generating; wait with ${ASK}${tabFlag()} --chat ${url}`,
          );
        return `${turns} turns`;
      });
    } else {
      add("check open chat", async () => {
        await onChat();
        if (js<boolean>(GENERATING))
          throw new StepError(
            `the chat is still generating; wait with ${ASK}${tabFlag()} --collect`,
          );
        return `${currentChatUrl() || "unsaved chat"}, ${js<number>(TURN_COUNT)} turns`;
      });
    }
    add("read turns", async () => {
      // A model's thoughts come as their own turn; its text chunks sit inside the thought chunk.
      type Turn = { role: string; media: string[]; text: boolean; thought: boolean };
      const count = js<number>(TURN_COUNT);
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        await showTurn(i); // a turn far from the screen has no content in the page
        const t = js<Turn>(`(() => {
          const t = ${TURNS}[${i}];
          const thoughts = ${all("turnThought", "t")};
          return {
            role: ${one("turnRole", "t")}?.getAttribute('data-turn-role') ?? '?',
            // Images show no text (the name is the img alt); audio shows only a player, so say what kind it is.
            media: ${all("turnMedia", "t")}.map((m) => AS.norm(AS.textOf(m)) || m.querySelector('img')?.alt || m.tagName.toLowerCase().replace(/^ms-|-chunk$/g, '')),
            text: ${all("turnText", "t")}.some((c) => !thoughts.some((th) => th.contains(c))),
            thought: thoughts.length > 0,
          };
        })()`);
        const body: string[] = t.media.map((m) => `[attachment: ${m}]`);
        if (t.text || (opt.thoughts && t.thought)) {
          const md = await copyTurnMarkdown(i);
          if (!md.trim())
            throw new StepError(`turn ${i + 1} (${t.role}) has text but copied as empty`);
          body.push(md);
        }
        if (body.length)
          parts.push(
            `## ${t.role}${t.thought && !t.text ? " thoughts" : ""}\n\n${body.join("\n\n")}`,
          );
      }
      const md = parts.join("\n\n");
      if (!md.trim()) throw new StepError("the chat has no readable turns");
      emit(md, () => md);
      return `${count} turns, ${md.length} chars`;
    });
    if (opt.out) {
      const out = resolve(opt.out);
      add("save", async () => {
        const md = String(result!.data);
        await Bun.write(out, md);
        if ((await Bun.file(out).text()) !== md)
          throw new StepError(`${out} does not match the chat`);
        emit({ saved: out }, () => out);
        return out;
      });
    }
    break;
  }

  case "screenshot": {
    const file = resolve(args[0] ?? resolve(tmpdir(), `aistudio-${currentTab()}.png`));
    add("screenshot", () => {
      ab("screenshot", file);
      return file;
    });
    break;
  }

  case "doctor":
    doctor(!!opt.quick);
    break;

  case "smoke": {
    add("ask on the test video", async () => {
      const out = resolve(tmpdir(), `aistudio-smoke-${currentTab()}.md`);
      const p = Bun.spawnSync(
        [
          "bun",
          resolve(SKILL_DIR, "scripts/ask.ts"),
          resolve(SKILL_DIR, "assets/doctor-2s.mp4"),
          "How many seconds long is this video? Reply with one number.",
          "--out",
          out,
          "--thinking",
          "Low",
          "--media",
          "Low",
          "--tab",
          currentTab(),
        ],
        { stdio: ["ignore", "inherit", "inherit"] },
      );
      if (p.exitCode !== 0) throw new StepError("ask.ts failed (its log is above)");
      const answer = (await Bun.file(out).text()).trim();
      await Bun.file(out).delete();
      return `answer: ${answer.slice(0, 80)}`;
    });
    break;
  }

  default:
    usage(`unknown command "${command}"`);
}

// ---------- doctor ----------

type Check = {
  key: string;
  where: Where;
  status: "ok" | "fallback" | "missing" | "absent";
  detail: string;
};

function doctor(quick: boolean) {
  const checks: Check[] = [];
  const entries = Object.entries(MAP) as [Key, Entry][];
  const checkState = (where: Where) => {
    for (const [key, e] of entries.filter(([, e]) => e.where === where)) {
      const { i, count } = probe(key);
      const status = i === 0 ? "ok" : i > 0 ? "fallback" : e.optional ? "absent" : "missing";
      const detail =
        i >= 0
          ? `candidate ${i + 1}/${e.candidates.length}, ${count} found`
          : (e.optional ?? "no candidate matches");
      checks.push({ key, where, status, detail });
    }
    const bad = checks.filter(
      (c) => c.where === where && c.status !== "ok" && c.status !== "absent",
    );
    return bad.length
      ? `${bad.length} need fixing: ${bad.map((c) => c.key).join(", ")}`
      : "all match their first candidate";
  };
  const failed = (key: string, where: Where, detail: string) => {
    checks.push({ key, where, status: "missing", detail });
    return `NOT OK, ${detail} (listed in the verdict)`;
  };
  const reason = (e: unknown) => (e instanceof StepError ? e.message : String(e));
  /** A page state that cannot be reached or left is reported, and the remaining states are still checked. */
  const state = (
    name: string,
    where: Where,
    reach: () => Promise<string | void>,
    leave?: () => unknown,
  ) =>
    add(name, async () => {
      let note: string | void;
      try {
        note = await reach();
      } catch (e) {
        return failed(`(${where} page state)`, where, `could not reach it: ${reason(e)}`);
      }
      const verdict = checkState(where);
      try {
        await leave?.();
      } catch (e) {
        return failed(`(leave ${where})`, where, `could not leave it: ${reason(e)}`);
      }
      return `${verdict}${note ? ` (${note})` : ""}`;
    });

  state("new chat page", "chat", async () => {
    await openNewChat(DEFAULT_MODEL);
    const lang = js<string>("document.documentElement.lang");
    if (lang && !lang.startsWith("en"))
      throw new StepError(`page language is "${lang}"; set the Google account to English`);
    // Tool switches are matched by name from page-map TOOLS; a renamed tool shows up here.
    if (!js<boolean>(has(dynamic.toolSwitch(TOOLS.search!))) && js<boolean>(has("toolsToggle")))
      click(one("toolsToggle"), "tools toggle");
    for (const [alias, name] of Object.entries(TOOLS)) {
      const found = js<boolean>(has(dynamic.toolSwitch(name)));
      const optional = TOOLS_SOME_MODELS.has(alias);
      checks.push({
        key: `TOOLS.${alias}`,
        where: "chat",
        status: found ? "ok" : optional ? "absent" : "missing",
        detail: found
          ? name
          : `no switch named "${name}"${optional ? ` (${DEFAULT_MODEL} does not offer it)` : ""}`,
      });
    }
  });

  state(
    "model picker",
    "model-picker",
    async () => {
      await openModelPicker();
      return `${js<number>(`${all("modelPickerItem", one("modelPicker"))}.length`)} models listed`;
    },
    closeModelPicker,
  );

  if (!quick) {
    const video = resolve(SKILL_DIR, "assets/doctor-2s.mp4");
    const name = "doctor-2s.mp4";
    state("video chip", "video-chip", async () => {
      upload(one("fileInput"), "file input", video);
      await pollUntil(chipReady(0, name), 120_000);
    });
    state(
      "video settings dialog",
      "video-dialog",
      async () => {
        await openVideoDialog(0, name, 60_000);
      },
      () => closeDialog("dialogCancel"),
    );
    add("clean up test video", async () => {
      if (js<boolean>(has("fpsInput"))) await closeDialog("dialogCancel"); // the dialog step failed midway
      for (let i = 0; i < 10 && js<boolean>(has("removeMedia")); i++) {
        click(one("removeMedia"), "remove media button");
        await Bun.sleep(500);
      }
      return js<boolean>(has("removeMedia"))
        ? failed("(clean up)", "video-chip", "a test video is still attached")
        : "prompt is empty again";
    });
  }

  state("History", "library", async () => {
    navigate(URLS.library);
    await pollUntil(has("libraryLink"), 30_000);
  });

  let latest = "";
  state("latest saved chat", "chat-turns", async () => {
    latest = chatUrlFrom(js<string>(`${one("libraryLink")}?.href ?? ''`)) ?? "";
    if (!latest) throw new StepError("History lists no chat to open");
    await openChat(latest);
    return latest;
  });

  state(
    "rename dialog",
    "rename-dialog",
    async () => {
      click(one("renameButton"), MAP.renameButton.what);
      await pollUntil(has("titleInput"), 5_000);
    },
    () => closeDialog("dialogCancel"),
  );

  state(
    "system instructions panel",
    "system-panel",
    async () => {
      click(one("systemInstructions"), MAP.systemInstructions.what);
      await pollUntil(has("systemText"), 5_000);
    },
    () => closePanel("systemText"),
  );

  state(
    "turn options menu",
    "turn-menu",
    async () => {
      await openTurnMenu(-1);
    },
    () => ab("press", "Escape"),
  );

  add("verdict", () => {
    const bad = checks.filter((c) => c.status === "missing");
    const weak = checks.filter((c) => c.status === "fallback");
    const mark = { ok: "✓", fallback: "⚠", missing: "✗", absent: "·" } as const;
    emit(checks, () =>
      [
        ...checks.map(
          (c) => `${mark[c.status]} ${c.where.padEnd(13)} ${c.key.padEnd(20)} ${c.detail}`,
        ),
        "",
        "✓ first candidate  ⚠ only a fallback matched (fix soon)  ✗ broken  · absent but allowed",
        bad.length || weak.length
          ? `fix: page-map.ts entries above, guide: references/browser/ui-changes.md, inspect: ${STUDIO}${tabFlag()} ab snapshot -i`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    if (bad.length) {
      console.log(result!.text());
      throw new StepError(`${bad.length} broken: ${bad.map((c) => c.key).join(", ")}`);
    }
    return `${checks.length} checks, ${weak.length} fallback-only`;
  });
}

await runSteps([...prelude, ...steps], {
  onDone: () => {
    if (!result) return;
    console.log(opt.json ? JSON.stringify(result.data, null, 2) : result.text());
  },
});
