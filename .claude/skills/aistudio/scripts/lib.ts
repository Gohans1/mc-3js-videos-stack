// Shared plumbing for ask.ts and studio.ts: the Chrome on CDP port 9333, agent-browser calls, the
// in-page element finder driven by page-map.ts, the step runner, and the AI Studio actions both use.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { type Candidate, dynamic, type Key, MAP, TEXT, URLS } from "./page-map";
import { guardWindows } from "./win32";

const AB = process.env.AGENT_BROWSER_EXE ?? "C:/Users/ADMIN/.bun/bin/agent-browser.exe";
export const AB_CONFIG =
  process.env.AGENT_BROWSER_CONFIG ?? "C:/Users/ADMIN/.claude/skills/agent-browser/standalone.json";
export const CHROME =
  process.env.CHROME_EXE ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
export const PROFILE = resolve(process.env.USERPROFILE ?? ".", ".agent-browser/profiles/aistudio");
export const PORT = 9333;
export const SKILL_DIR = resolve(import.meta.dir, "..");
export const ASK = "bun .claude/skills/aistudio/scripts/ask.ts";
export const STUDIO = "bun .claude/skills/aistudio/scripts/studio.ts";

/** A failure with a message written for the reader; anything else is a bug and prints its stack. */
export class StepError extends Error {}
/** pollUntil ran out of time. Any other error thrown while polling is a real failure and must pass through. */
export class TimeoutError extends StepError {}

export const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
/** Text boxes store line breaks as \n, so text from a Windows file must match that before it is typed and read back. */
export const toLF = (s: string) => s.replace(/\r\n?/g, "\n");

/** "1h2m3s", "1m30s", "90s", "2m" -> seconds; NaN when it is not such a time. */
export function toSeconds(time: string): number {
  const m = time.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/);
  if (!time || !m) return NaN;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

// ---------- tabs ----------

// A tab is its own off-screen Chrome window (each window's page stays visible, so dropdowns keep working) driven by
// its own agent-browser session pinned to it. Different tabs can run commands in parallel; one command per tab.
export const TAB_RE = /^[a-z][a-z0-9-]{0,30}$/i;
let tab = "main";
export const currentTab = () => tab;
export const useTab = (label: string) => void (tab = label);
/** Appended to printed commands so a hint resumes in the same tab. */
export const tabFlag = () => (tab === "main" ? "" : ` --tab ${tab}`);
export const abArgs = () => [
  AB,
  "--config",
  AB_CONFIG,
  "--session",
  `aistudio-${tab}`,
  "--cdp",
  String(PORT),
  "--pin-tab",
  // A daemon attached with --cdp never idles out by default, so one would live per label forever. Its exit leaves the
  // tab open, and the next command's daemon rebinds to the same tab; waits poll every second, so none idles mid-command.
  "--idle-timeout",
  "10m",
];

/**
 * label -> CDP target id of its window (valid while Chrome runs) and its slot: windows sit at different off-screen
 * spots, because a window exactly covering another makes Chrome report the covered page as hidden.
 */
export type TabInfo = { id: string; slot: number };
const TABS_FILE = resolve(PROFILE, "..", "aistudio-tabs.json");
export function readTabs(): Record<string, TabInfo> {
  try {
    return JSON.parse(readFileSync(TABS_FILE, "utf8"));
  } catch {
    return {};
  }
}
export const writeTabs = (tabs: Record<string, TabInfo>) =>
  writeFileSync(TABS_FILE, JSON.stringify(tabs, null, 2));

export async function pageTargets(): Promise<{ id: string; url: string; title: string }[]> {
  const { targetInfos } = await cdp((send) => send("Target.getTargets"));
  return (targetInfos as any[])
    .filter((t) => t.type === "page")
    .map(({ targetId, url, title }) => ({ id: targetId, url, title }));
}

// ---------- agent-browser ----------

export function ab(...cmd: string[]): string {
  const p = Bun.spawnSync([...abArgs(), ...cmd], {
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const out = p.stdout.toString().trim();
  if (p.exitCode !== 0)
    throw new StepError(`agent-browser ${cmd[0]}: ${p.stderr.toString().trim() || out}`);
  return out;
}

/** Runs one agent-browser command passed on stdin, for arguments too long for a Windows command line (~32K chars). */
function abStdin(cmd: string[]): string {
  const p = Bun.spawnSync([...abArgs(), "batch", "--bail"], {
    stdin: Buffer.from(JSON.stringify([cmd])),
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const out = p.stdout.toString().trim();
  if (p.exitCode !== 0)
    throw new StepError(`agent-browser ${cmd[0]}: ${p.stderr.toString().trim() || out}`);
  return out;
}

/** Evaluates an expression in the page; agent-browser prints the result JSON-encoded. */
export function js<T>(code: string): T {
  const out = ab("eval", `(() => { ${RUNTIME}; return (${code}); })()`);
  return (out === "undefined" ? undefined : JSON.parse(out)) as T;
}

export async function pollUntil(
  code: string,
  timeoutMs: number,
  onTick?: (elapsedMs: number) => void,
) {
  const start = Date.now();
  let lastTick = start;
  while (!js<boolean>(code)) {
    const now = Date.now();
    if (now - start > timeoutMs) throw new TimeoutError(`timed out after ${secs(timeoutMs)}`);
    if (onTick && now - lastTick >= 30_000) {
      lastTick = now;
      onTick(now - start);
    }
    await Bun.sleep(1_000);
  }
}

/** pollUntil that answers whether the condition came true in time. */
export async function waitFor(code: string, timeoutMs: number): Promise<boolean> {
  try {
    await pollUntil(code, timeoutMs);
    return true;
  } catch (e) {
    if (e instanceof TimeoutError) return false;
    throw e;
  }
}

// ---------- in-page finder ----------

// Installed into the page on every eval (cheap, and survives reloads). Mirrors how agent-browser and
// Playwright name elements: aria-label, then aria-labelledby, then <label>, then visible text without
// aria-hidden icon ligatures (so the run button reads "Run", not "Run keyboard_return").
const RUNTIME_SOURCE = `(() => {
  const norm = (s) => (s ?? '').replace(/\\s+/g, ' ').trim();
  const textOf = (n) => {
    if (n.nodeType === 3) return n.textContent;
    if (n.nodeType !== 1 || n.getAttribute('aria-hidden') === 'true' || n.tagName === 'STYLE' || n.tagName === 'SCRIPT') return '';
    return [...n.childNodes].map(textOf).join(' ');
  };
  const implicit = { BUTTON: 'button', TEXTAREA: 'textbox', SELECT: 'combobox', TR: 'row', TD: 'cell', TABLE: 'table',
    H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading', DIALOG: 'dialog' };
  const inputRole = { number: 'spinbutton', checkbox: 'checkbox', radio: 'radio', search: 'searchbox', button: 'button', submit: 'button', file: '' };
  const roleOf = (e) => e.getAttribute('role') || (e.tagName === 'A' && e.hasAttribute('href') ? 'link' : '')
    || (e.tagName === 'INPUT' ? (inputRole[e.type] ?? 'textbox') : '') || implicit[e.tagName] || '';
  const nameOf = (e) => norm(e.getAttribute('aria-label')
    || (e.getAttribute('aria-labelledby') || '').split(/\\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ')
    || (e.labels && e.labels[0] && e.labels[0].textContent) || textOf(e) || e.getAttribute('title') || e.getAttribute('placeholder'));
  const nameOk = (name, want) => want === undefined ? true
    : typeof want === 'string' ? name === want : new RegExp(want.re, want.flags || '').test(name);
  const visible = (e) => e.getClientRects().length > 0;
  const matchOne = (c, root) => {
    let els;
    if (c.testId) els = root.querySelectorAll('[data-test-id="' + c.testId + '"]');
    else if (c.css) els = root.querySelectorAll(c.css);
    else els = [...root.querySelectorAll('*')].filter((e) => roleOf(e) === c.role && nameOk(nameOf(e), c.name));
    els = [...els];
    const shown = els.filter(visible);
    return shown.length ? shown : els;
  };
  const find = (cands, root = document) => {
    if (!root) return { els: [], i: -1 };
    for (let i = 0; i < cands.length; i++) {
      const els = matchOne(cands[i], root);
      if (els.length) return { els, i };
    }
    return { els: [], i: -1 };
  };
  const tag = (el) => {
    document.querySelectorAll('[data-aistudio-target]').forEach((e) => e.removeAttribute('data-aistudio-target'));
    el.setAttribute('data-aistudio-target', '');
    return true;
  };
  return { norm, textOf, roleOf, nameOf, find, tag };
})()`;
// Cached per page under a hash of its source, so an edited finder reaches tabs that are already open.
const RUNTIME = `const AS = window['__aistudio_${Bun.hash(RUNTIME_SOURCE).toString(36)}'] ??= ${RUNTIME_SOURCE}`;

const cands = (k: Key | Candidate[]) => JSON.stringify(Array.isArray(k) ? k : MAP[k].candidates);

/** JS expression: all elements matching a map entry (or candidate list), optionally inside root (a JS expression). */
export const all = (k: Key | Candidate[], root = "document") => `AS.find(${cands(k)}, ${root}).els`;
/** JS expression: first match or null. */
export const one = (k: Key | Candidate[], root = "document") => `(${all(k, root)}[0] ?? null)`;
export const has = (k: Key | Candidate[], root = "document") => `(${all(k, root)}.length > 0)`;

/** Which candidate of an entry matches right now: index (0 = most stable) and how many elements. */
export function probe(k: Key | Candidate[], root = "document"): { i: number; count: number } {
  return js(
    `(() => { const r = AS.find(${cands(k)}, ${root}); return { i: r.i, count: r.els.length }; })()`,
  );
}

/** Marks the element an expression returns so agent-browser can act on exactly it (real mouse/keyboard events). */
function target(elementExpr: string, what: string): string {
  if (!js<boolean>(`(() => { const e = ${elementExpr}; return e ? AS.tag(e) : false; })()`)) {
    throw new StepError(`could not find ${what} on the page`);
  }
  return "[data-aistudio-target]";
}

export const click = (elementExpr: string, what: string) => ab("click", target(elementExpr, what));
// The text goes over stdin (prompts can be long); "--" makes agent-browser take it literally, even when it looks like a flag.
export const fill = (elementExpr: string, what: string, text: string) =>
  abStdin(["fill", target(elementExpr, what), "--", text]);
export const upload = (elementExpr: string, what: string, ...files: string[]) =>
  ab("upload", target(elementExpr, what), ...files);
export const focus = (elementExpr: string, what: string) => ab("focus", target(elementExpr, what));

// ---------- page facts ----------

const RUN_STATE = `(() => { const b = ${one("runButton")}; if (!b) return 'missing'; const n = AS.nameOf(b);
  return /\\bStop\\b/.test(n) ? 'stop' : /\\bRun\\b/.test(n) ? 'run' : 'missing'; })()`;
export const GENERATING = `(${RUN_STATE} === 'stop')`;
const IDLE = `(${RUN_STATE} === 'run')`;
export const TURNS = all("turn");
export const TURN_COUNT = `${TURNS}.length`;
export const CHAT_ID = `(location.pathname.match(new RegExp(${JSON.stringify(URLS.chatIdPattern.source)}))?.[1] ?? '')`;
export const ALERTS = `${all("alerts")}.map((e) => AS.norm(e.innerText)).filter(Boolean).join(' | ')`;

export function pageAlerts(): string {
  try {
    return js<string>(ALERTS);
  } catch {
    return "";
  }
}

export function currentChatUrl(): string {
  const id = js<string>(CHAT_ID);
  return id ? URLS.chat(id) : "";
}

/** Accepts a chat link or bare id; returns the canonical link, or null. */
export function chatUrlFrom(linkOrId: string): string | null {
  const id = linkOrId.match(URLS.chatIdPattern)?.[1] ?? linkOrId;
  return /^[\w-]{10,}$/.test(id) ? URLS.chat(id) : null;
}

export function dropdownValue(combo: "thinking" | "media"): string {
  return js<string>(`(() => { const c = ${one(combo)}; if (!c) return '';
    const v = ${one("dropdownValue", "c")}; return AS.norm(v ? v.textContent : AS.textOf(c)); })()`);
}

export type Settings = {
  model: string;
  thinking: string;
  media: string;
  tools: Record<string, boolean | null>;
  maxOutputTokens: string;
};

export const currentModel = () => js<string>(`AS.norm(${one("modelName")}?.textContent)`);

/** Reads the run settings panel. A tool is null when its switch is not on the page. */
export function readSettings(toolNames: string[]): Settings {
  const tools = js<
    Record<string, boolean | null>
  >(`Object.fromEntries([${toolNames.map((n) => `[${JSON.stringify(n)}, ${one(dynamic.toolSwitch(n))}]`).join(", ")}]
    .map(([n, s]) => [n, s ? s.getAttribute('aria-checked') === 'true' : null]))`);
  return {
    model: currentModel(),
    thinking: dropdownValue("thinking"),
    media: dropdownValue("media"),
    tools,
    maxOutputTokens: js<string>(`${one("maxOutputTokens")}?.value ?? ''`),
  };
}

// ---------- Chrome ----------

export const chromeUp = () =>
  fetch(`http://127.0.0.1:${PORT}/json/version`).then(
    (r) => r.ok,
    () => false,
  );

/** Where the window lives: off every screen, so it never covers the user's work. The page still counts as visible. */
export const offscreen = (slot: number) => ({ left: -10000, top: slot * 1200 });

export async function startChrome(): Promise<string> {
  if (await chromeUp()) return `already running on port ${PORT}`;
  mkdirSync(PROFILE, { recursive: true });
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    "--no-first-run",
    // A startup window would take keyboard focus from the user; prepareTab opens one in the background instead.
    "--no-startup-window",
    // The dropdowns only open while the page is visible; keep it visible behind other windows.
    "--disable-backgrounding-occluded-windows",
  ];
  // Start-Process detaches Chrome from this script: a child of the agent's shell dies when that shell command ends,
  // and Chrome must outlive it so a long answer keeps generating between commands.
  const psQuote = (s: string) => `'${s.replaceAll("'", "''")}'`;
  const p = Bun.spawnSync(
    [
      "powershell",
      "-NoProfile",
      "-Command",
      `Start-Process -FilePath ${psQuote(CHROME)} -ArgumentList ${psQuote(args.map((a) => `"${a}"`).join(" "))}`,
    ],
    { stdout: "pipe", stderr: "pipe", windowsHide: true },
  );
  if (p.exitCode !== 0)
    throw new StepError(`could not start Chrome (${CHROME}): ${p.stderr.toString().trim()}`);
  for (let i = 0; i < 40; i++) {
    await Bun.sleep(500);
    if (await chromeUp()) return `started off-screen with profile ${PROFILE}`;
  }
  throw new StepError(`Chrome did not open port ${PORT} within 20 s (${CHROME})`);
}

type Send = (method: string, params?: object) => Promise<any>;

export async function cdp<T>(fn: (send: Send) => Promise<T>): Promise<T> {
  const { webSocketDebuggerUrl } = await (
    await fetch(`http://127.0.0.1:${PORT}/json/version`)
  ).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((ok, fail) => {
    ws.onopen = ok;
    ws.onerror = () =>
      fail(new StepError(`could not connect to Chrome's DevTools on port ${PORT}`));
  });
  let nextId = 0;
  const send = (method: string, params: object = {}) =>
    new Promise<any>((done, fail) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        ws.removeEventListener("message", on);
        fail(new StepError(`${method}: Chrome did not answer within 10 s`));
      }, 10_000);
      function on(e: MessageEvent) {
        const msg = JSON.parse(String(e.data));
        if (msg.id !== id) return;
        clearTimeout(timer);
        ws.removeEventListener("message", on);
        if (msg.error) fail(new StepError(`${method}: ${msg.error.message}`));
        else done(msg.result);
      }
      ws.addEventListener("message", on);
      ws.send(JSON.stringify({ id, method, params }));
    });
  try {
    return await fn(send);
  } finally {
    ws.close();
  }
}

/** Chrome's browser process, set by prepareTab; from then on runSteps guards its windows before every step. */
let chromePid: number | undefined;

/** Win+D can minimize even a shielded window (minimized = visibilityState "hidden", dropdowns stop opening). */
const guard = () =>
  chromePid === undefined ? undefined : guardWindows(chromePid, offscreen(0).left);

/**
 * Binds this command to its tab's own window, opening one if needed (in the background, so it takes no focus; windows
 * the tool did not open are left alone). Then un-minimizes it, sizes it to 1920x1080 (narrower and AI Studio hides the
 * run settings panel) and moves it off-screen, or on-screen with show (to log in by hand).
 */
export async function prepareTab(show = false): Promise<string> {
  const tabs = readTabs();
  let info = tabs[tab];
  const opened = !info || !(await pageTargets()).some((p) => p.id === info!.id);
  if (opened) {
    // Skip slots other labels own and spots where any window already sits (one left behind would cover the new one).
    const used = new Set(
      Object.entries(tabs)
        .filter(([l]) => l !== tab)
        .map(([, t]) => t.slot),
    );
    await cdp(async (send) => {
      for (const p of await pageTargets()) {
        const { bounds } = await send("Browser.getWindowForTarget", { targetId: p.id });
        if (bounds.left === offscreen(0).left) used.add(Math.round(bounds.top / offscreen(1).top));
      }
    });
    let slot = 0;
    while (used.has(slot)) slot++;
    const window = {
      url: URLS.library,
      newWindow: true,
      background: true,
      ...offscreen(slot),
      width: 1920,
      height: 1080,
    };
    info = { id: (await cdp((send) => send("Target.createTarget", window))).targetId, slot };
    writeTabs({ ...readTabs(), [tab]: info });
  }
  const { id, slot } = info!;
  const at = show ? { left: 0, top: 0 } : offscreen(slot);
  chromePid ??= await cdp(
    async (send) =>
      (await send("SystemInfo.getProcessInfo")).processInfo.find((p: any) => p.type === "browser")
        .id,
  );
  const { restored } = guard()!;
  // Switching tabs activates the window, and so does a new session's first command (it opens a blank tab). A session
  // keeps its tab across daemon restarts, so switch only when it is bound elsewhere: a new label or a re-created window.
  const bound = JSON.parse(ab("tab", "list", "--json")).data.tabs.find(
    (t: any) => t.active,
  )?.targetId;
  if (bound !== id) ab("tab", id);
  const strays = await cdp(async (send) => {
    // The first command of a new agent-browser session opens an about:blank page in the last used window, where it
    // becomes the active tab and hides that window's chat. This tool's off-screen windows never want a blank page.
    let blank = 0;
    for (const p of await pageTargets()) {
      if (p.url !== "about:blank") continue;
      const { bounds } = await send("Browser.getWindowForTarget", { targetId: p.id });
      if (bounds.left !== offscreen(0).left) continue;
      await send("Target.closeTarget", { targetId: p.id });
      blank++;
    }
    const { windowId, bounds } = await send("Browser.getWindowForTarget", { targetId: id });
    if (bounds.windowState !== "normal") {
      await send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
    }
    await send("Browser.setWindowBounds", {
      windowId,
      bounds: { ...at, width: 1920, height: 1080 },
    });
    return blank;
  });
  guard(); // the window may have just moved on or off screen
  const [w, h, vis, lang] = js<[number, number, string, string]>(
    `[innerWidth, innerHeight, document.visibilityState, document.documentElement.lang]`,
  );
  if (vis !== "visible") throw new StepError(`page is "${vis}" after restoring the window`);
  const english = !lang || lang.startsWith("en");
  return `tab ${tab}${opened ? " (new window)" : ""}, ${w}x${h}, ${show ? "on screen" : "off-screen"}, ${vis}${restored ? `, un-minimized ${restored} window(s) without taking focus` : ""}${strays ? `, closed ${strays} blank tab(s)` : ""}${english ? "" : `; WARNING page language is "${lang}", locators expect English`}`;
}

/** Every page in the same Chrome window as targetId, that one included. */
async function sameWindow(send: Send, targetId: string) {
  const { windowId } = await send("Browser.getWindowForTarget", { targetId });
  const { targetInfos } = await send("Target.getTargets");
  const pages: { id: string; url: string }[] = [];
  for (const t of targetInfos as any[]) {
    if (t.type !== "page") continue;
    const w = await send("Browser.getWindowForTarget", { targetId: t.targetId });
    if (w.windowId === windowId) pages.push({ id: t.targetId, url: t.url });
  }
  return pages;
}

/** Closes the window holding targetId, with every tab in it. Returns how many tabs closed. */
export const closeWindowOf = (targetId: string) =>
  cdp(async (send) => {
    const pages = await sameWindow(send, targetId);
    for (const p of pages) await send("Target.closeTarget", { targetId: p.id });
    return pages.length;
  });

// ---------- navigation ----------

/** Loads url in the tab. Leaving a chat that is generating loses its answer, so that is refused. */
export function navigate(url: string) {
  if (js<boolean>(GENERATING)) {
    throw new StepError(
      `the tab is still generating in ${currentChatUrl() || "an unsaved chat"}; collect it first (${ASK}${tabFlag()} --collect) or use another --tab`,
    );
  }
  ab("open", url);
}

export async function waitForPromptBox(where: string) {
  const elsewhere = [URLS.signIn, URLS.accessRestricted];
  const ok = await waitFor(
    `${has("promptBox")} || ${JSON.stringify(elsewhere)}.some((u) => location.href.includes(u))`,
    60_000,
  );
  const url = js<string>("location.href");
  if (url.includes(URLS.signIn)) {
    throw new StepError(
      `signed out (at ${url}). Run \`${STUDIO}${tabFlag()} chrome --show\`, log in by hand in that window, then rerun.`,
    );
  }
  if (url.includes(URLS.accessRestricted)) {
    throw new StepError(
      `AI Studio cannot open that chat (wrong id, deleted, or saved under another Google account)`,
    );
  }
  if (!ok)
    throw new StepError(
      `${where}: prompt box never appeared (at ${url}); run \`${STUDIO}${tabFlag()} doctor\``,
    );
}

export function accountName(): string {
  return js<string>(`(() => { const a = ${one("account")}; return a ? AS.nameOf(a) : ''; })()`)
    .replace(/^Google Account:\s*/, "")
    .replace(/\s*\([^)]*@[^)]*\)$/, ""); // the name is enough evidence; keep the email out of logs
}

export async function openNewChat(model: string): Promise<string> {
  navigate(URLS.newChat(model));
  await waitForPromptBox("new chat");
  const now = currentModel();
  if (now !== model) {
    throw new StepError(
      `asked for model ${model} but the page shows "${now || "no model"}" (wrong id? see \`${STUDIO}${tabFlag()} models\`)`,
    );
  }
  return `${model}, ${accountName() || "account unknown"}`;
}

/** Opens a saved chat. A chat that is generating loses its answer on reload, so an already-open chat is not reloaded. */
export async function openChat(
  chatUrl: string,
): Promise<{ here: boolean; turns: number; busy: boolean }> {
  const here = currentChatUrl() === chatUrl;
  if (!here) navigate(chatUrl);
  await waitForPromptBox("open chat");
  if (!(await waitFor(`${TURN_COUNT} > 0`, 30_000))) {
    throw new StepError(
      `no messages in ${chatUrl} (wrong id, deleted, or saved under another Google account)`,
    );
  }
  return { here, turns: js<number>(TURN_COUNT), busy: js<boolean>(GENERATING) };
}

// ---------- settings ----------

/** On a fresh chat the prompt box takes focus back from mouse clicks, so dropdowns are opened with the keyboard. */
export async function selectOption(combo: "thinking" | "media", option: string): Promise<string> {
  const label = MAP[combo].what;
  if (!js<boolean>(has(combo))) {
    // Media resolution lives under Advanced settings, which can be folded.
    if (js<boolean>(has("advancedToggle")))
      click(one("advancedToggle"), "advanced settings toggle");
    if (!(await waitFor(has(combo), 3_000))) {
      throw new StepError(
        `no ${label} on the page (panel closed, or the UI changed; run \`${STUDIO}${tabFlag()} doctor\`)`,
      );
    }
  }
  if (dropdownValue(combo) === option) return `already "${option}"`;
  const anyOption = has(dynamic.anyOption);
  for (let attempt = 1; !js<boolean>(anyOption); attempt++) {
    if (attempt > 10) throw new StepError(`the ${label} list never opened`);
    focus(one(combo), label);
    ab("press", "Enter");
    await Bun.sleep(500);
  }
  // Each model offers its own levels (flash-lite: Minimal, no Extra High), so the list is read, not assumed.
  const optionCands = dynamic.option(option);
  if (!js<boolean>(has(optionCands))) {
    const offered = js<string[]>(`${all(dynamic.anyOption)}.map((o) => AS.nameOf(o))`);
    ab("press", "Escape");
    throw new StepError(
      `${label} has no "${option}" on this model; it offers: ${offered.join(", ")}`,
    );
  }
  click(one(optionCands), `option "${option}"`);
  await waitFor(`!${anyOption}`, 5_000);
  const now = dropdownValue(combo);
  if (now !== option) throw new StepError(`${label} shows "${now}" after picking "${option}"`);
  return `"${now}"`;
}

export async function setTool(name: string, on: boolean): Promise<string> {
  const cands = dynamic.toolSwitch(name);
  if (!js<boolean>(has(cands)) && js<boolean>(has("toolsToggle")))
    click(one("toolsToggle"), "tools toggle");
  await waitFor(has(cands), 3_000);
  const state = () => js<string | null>(`${one(cands)}?.getAttribute('aria-checked') ?? null`);
  const disabled = js<boolean>(
    `(() => { const s = ${one(cands)}; return !!s && (s.disabled || s.getAttribute('aria-disabled') === 'true'); })()`,
  );
  if (state() === null)
    throw new StepError(`no "${name}" switch on the page (some tools exist only on some models)`);
  if ((state() === "true") === on) return `"${name}" already ${on ? "on" : "off"}`;
  if (disabled)
    throw new StepError(
      `"${name}" is disabled right now (AI Studio allows it only with some models/tools)`,
    );
  click(one(cands), `"${name}" switch`);
  await waitFor(`${one(cands)}?.getAttribute('aria-checked') === '${on}'`, 5_000);
  if ((state() === "true") !== on)
    throw new StepError(`"${name}" did not switch ${on ? "on" : "off"}`);
  return `"${name}" ${on ? "on" : "off"}`;
}

export async function switchModel(model: string): Promise<string> {
  const before = currentModel();
  if (before === model) return `already ${model}`;
  await openModelPicker();
  const item = pickerItemFor(model);
  if (!js<boolean>(`!!${item}`)) {
    await closeModelPicker();
    throw new StepError(`no model "${model}" in the picker (see \`${STUDIO}${tabFlag()} models\`)`);
  }
  click(item, `model ${model}`);
  await waitFor(`AS.norm(${one("modelName")}?.textContent) === ${JSON.stringify(model)}`, 10_000);
  // Picking a model closes the picker by itself, with an animation; clicking Close meanwhile misses.
  await waitFor(`!${has("modelPicker")}`, 3_000);
  await closeModelPicker();
  const now = currentModel();
  if (now !== model) throw new StepError(`model shows "${now}" after picking ${model}`);
  return `${before} -> ${now}`;
}

export async function openModelPicker() {
  if (js<boolean>(has("modelPicker"))) return;
  click(`${one("modelName")}?.closest('button')`, "model card");
  if (!(await waitFor(has("modelPicker"), 10_000)))
    throw new StepError(`the model picker did not open; run \`${STUDIO}${tabFlag()} doctor\``);
}

/** Closes a side panel (identified by an element inside it) with the shared Close panel button. */
export async function closePanel(inside: "modelPicker" | "systemText") {
  if (!js<boolean>(has(inside))) return;
  click(one("panelClose"), "Close panel button");
  if (!(await waitFor(`!${has(inside)}`, 5_000)))
    throw new StepError(`the ${MAP[inside].what} did not close`);
}
export const closeModelPicker = () => closePanel("modelPicker");

// ---------- chat title and system instructions ----------

export const chatTitle = () => js<string>(`AS.norm(${one("title")}?.textContent)`);

export async function renameChat(title: string, description?: string): Promise<string> {
  if (!js<boolean>(has("renameButton"))) {
    throw new StepError(
      "only a saved chat can be renamed; this one has no link yet (send a prompt, or open a saved chat)",
    );
  }
  click(one("renameButton"), MAP.renameButton.what);
  if (!(await waitFor(has("titleInput"), 5_000)))
    throw new StepError("the rename dialog did not open");
  fill(one("titleInput"), "chat name box", title);
  if (description !== undefined) fill(one("descriptionInput"), "chat description box", description);
  click(one("titleSave"), MAP.titleSave.what);
  if (!(await waitFor(`!${has("titleInput")}`, 10_000)))
    throw new StepError("the rename dialog did not close after Save");
  await waitFor(`AS.norm(${one("title")}?.textContent) === ${JSON.stringify(title)}`, 10_000);
  const now = chatTitle();
  if (now !== title) throw new StepError(`the title shows "${now}" after saving "${title}"`);
  return `"${now}"`;
}

async function openSystemPanel() {
  if (!js<boolean>(has("systemText")))
    click(one("systemInstructions"), MAP.systemInstructions.what);
  if (!(await waitFor(has("systemText"), 5_000)))
    throw new StepError("the System instructions panel did not open");
}

/** Reads the chat's system instructions, or replaces them with text and reads them back after reopening the panel. */
export async function systemInstructions(text?: string): Promise<string> {
  const read = () => js<string>(`${one("systemText")}?.value ?? ''`);
  if (text !== undefined) text = toLF(text);
  await openSystemPanel();
  if (text !== undefined) {
    fill(one("systemText"), "System instructions box", text);
    await closePanel("systemText");
    await openSystemPanel();
  }
  const now = read();
  await closePanel("systemText");
  if (text !== undefined && now !== text)
    throw new StepError(`System instructions read back as "${now.slice(0, 80)}"`);
  return now;
}

/** JS expression: the picker button whose name holds the exact model id as a word. */
function pickerItemFor(model: string): string {
  // The first id in an item's name is its own; an alias item also names its target ("Points to <id>").
  return `(${all("modelPickerItem", one("modelPicker"))}.find((b) =>
    AS.nameOf(b).match(new RegExp(${JSON.stringify(TEXT.modelId.source)}))?.[0] === ${JSON.stringify(model)}) ?? null)`;
}

// ---------- answers ----------

// The model's thoughts are a Model turn of their own, so a run stopped mid-thought ends on one: an answer is a Model
// turn with text outside its thought chunk.
const LAST_IS_ANSWER = `(() => { const t = ${TURNS}.at(-1);
  if (!t || ${one("turnRole", "t")}?.getAttribute('data-turn-role') !== 'Model') return false;
  const thoughts = ${all("turnThought", "t")};
  return ${all("turnText", "t")}.some((c) => !thoughts.some((th) => th.contains(c))); })()`;

/** Waits until the model is idle and the last turn is its answer. turnsBefore = turn count before the run, if one was sent here. */
export async function waitForAnswer(opts: {
  turnsBefore?: number;
  timeoutMs: number;
  resumeHint: () => string;
}): Promise<string> {
  const done =
    `${IDLE} && ${LAST_IS_ANSWER}` +
    (opts.turnsBefore === undefined ? "" : ` && ${TURN_COUNT} > ${opts.turnsBefore}`);
  // LAST_IS_ANSWER reads the last turn's content, which AI Studio renders only near the screen.
  const showLast = () => js(`(${TURNS}.at(-1)?.scrollIntoView({ block: 'end' }), true)`);
  showLast();
  if (opts.turnsBefore === undefined && js<boolean>(`${IDLE} && !${LAST_IS_ANSWER}`)) {
    throw new StepError(
      "the last prompt in this chat has no answer (its run was stopped or the page was reloaded mid-run); send it again as a follow-up",
    );
  }
  if (js<boolean>(done)) return "answer was already there";
  // Idle with no answer means the run ended in an error (quota, safety, server). Right after the click the button can
  // still read Run for a moment, hence the grace period.
  const state = `(${done}) ? 'done' : ${IDLE} ? 'idle' : 'busy'`;
  const start = Date.now();
  let lastTick = start;
  let idleSince = 0;
  for (let s = js<string>(state); s !== "done"; s = js<string>(state)) {
    const now = Date.now();
    idleSince = s === "idle" ? idleSince || now : 0;
    if (s === "idle") showLast();
    if (idleSince && now - idleSince > 10_000) {
      const alerts = pageAlerts();
      throw new StepError(
        `the run stopped without an answer; ${alerts ? `AI Studio says: ${alerts}` : "AI Studio shows no message (see the screenshot)"}`,
      );
    }
    if (now - start > opts.timeoutMs) {
      throw new StepError(
        `no answer after ${secs(opts.timeoutMs)}. The model keeps going in Chrome (leave that tab alone); collect it later with: ${opts.resumeHint()}`,
      );
    }
    if (now - lastTick >= 30_000) {
      lastTick = now;
      console.error(`  … still generating (${secs(now - start)})`);
    }
    await Bun.sleep(1_000);
  }
  const generated = secs(Date.now() - start);
  // AI Studio saves a new chat (and gives it a /prompts/<id> link) up to about a minute after the first answer.
  if (!js<string>(CHAT_ID)) {
    console.error("  … answer done, waiting for AI Studio to save the chat and give it a link");
    await waitFor(`${CHAT_ID} !== ''`, 120_000);
  }
  const alerts = pageAlerts();
  return `answered after ${generated}${js<string>(CHAT_ID) ? "" : "; chat still has no link (get it later with --collect)"}${alerts ? `; AI Studio says: ${alerts}` : ""}`;
}

/** Scrolls a turn (index into the turn list; -1 = last) to the top of the view and waits until its content is rendered. */
export async function showTurn(index: number) {
  const turn = `${TURNS}.at(${index})`;
  js(`(${turn}?.scrollIntoView({ block: 'start' }), true)`);
  if (!(await waitFor(has("turnBody", turn), 5_000)))
    throw new StepError(`turn ${index} never rendered its content`);
}

/** Opens a turn's options menu (index into the turn list; -1 = last). */
export async function openTurnMenu(index = -1) {
  const turn = `${TURNS}.at(${index})`;
  await showTurn(index);
  // The button takes clicks only while the pointer is over its turn. Aim at a visible point of the turn that nothing
  // covers: the middle of a turn taller than the window is off-screen, the button can sit just above a short turn, and
  // the "Copied to clipboard" toast covers the top of the page for a few seconds after each copy.
  const at = js<[number, number] | null>(`(() => { const t = ${turn}; if (!t) return null;
    const r = t.getBoundingClientRect(), top = Math.max(r.top, 0), bottom = Math.min(r.bottom, innerHeight);
    for (const fy of [0.5, 0.75, 0.25, 0.9]) for (const fx of [0.5, 0.05, 0.95]) {
      const x = r.left + (r.right - r.left) * fx, y = top + (bottom - top) * fy;
      if (t.contains(document.elementFromPoint(x, y))) return [Math.round(x), Math.round(y)];
    }
    return null; })()`);
  if (!at) throw new StepError(`turn ${index} is not visible or something covers it`);
  ab("mouse", "move", String(at[0]), String(at[1]));
  const button = one("turnOptions", turn);
  const hit = `(() => { const b = ${button}; if (!b) return null; const r = b.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); })()`;
  // The hover takes a moment to make the button clickable, and a toast may still cover it.
  if (!(await waitFor(`${button}?.contains(${hit}) ?? false`, 8_000))) {
    const under = js<string>(`${hit}?.tagName.toLowerCase() ?? 'nothing'`);
    throw new StepError(`turn ${index}'s options button stays covered by <${under}>`);
  }
  click(button, "turn options button");
  if (!(await waitFor(has("copyMarkdown"), 5_000))) {
    ab("press", "Escape");
    throw new StepError('the turn\'s options menu did not open or has no "Copy as markdown"');
  }
}

/** Copies one turn through its own "Copy as markdown" menu item. */
export async function copyTurnMarkdown(index = -1): Promise<string> {
  // The menu copies through a hidden textarea + execCommand('copy'), not navigator.clipboard: catch it in the copy event,
  // and cancel the event so the user's Windows clipboard keeps what they put there.
  js(`(() => {
    window.__aistudioCopied = null;
    document.addEventListener('copy', (e) => {
      const a = document.activeElement;
      window.__aistudioCopied = (a && 'value' in a && a.value) || String(getSelection());
      e.preventDefault();
    }, { capture: true, once: true });
    return true;
  })()`);
  await openTurnMenu(index);
  click(one("copyMarkdown"), "Copy as markdown");
  if (!(await waitFor(`window.__aistudioCopied !== null`, 5_000)))
    throw new StepError(`"Copy as markdown" of turn ${index} copied nothing`);
  return js<string>("window.__aistudioCopied");
}

// ---------- attachment chips ----------

// Attachment n (0-based, in upload order) is the chip of the n-th Remove button: its smallest ancestor whose text holds
// the file name as a whole word (an icon word such as "docs" may come first) and that holds no other Remove button. By
// position, because one name can sit inside another chip's text ("a.mp4" in "x a.mp4"). A video chip also holds a
// settings button. A chip says "Loading..." while uploading (a video again while recounting after a Save); a video's
// settings button ignores clicks until the chip shows "<N> tokens" (or "Agentic", which replaces the count).
export const chip = (n: number, name: string) => `(() => {
  let c = ${all("removeMedia")}[${n}];
  while (c && !(' ' + AS.norm(c.innerText) + ' ').includes(${JSON.stringify(` ${name} `)})) c = c.parentElement;
  return c && ${all("removeMedia", "c")}.length === 1 ? { chip: c, button: ${one("videoSettings", "c")} } : null;
})()`;
const chipText = (n: number, name: string) => `AS.norm(${chip(n, name)}?.chip.innerText)`;
export const chipReady = (n: number, name: string) =>
  `new RegExp(${JSON.stringify(TEXT.chipReady.source)}).test(${chipText(n, name)})`;
/** "41,851 tokens" or "Agentic" (that mode shows no count). */
export const chipTokens = (n: number, name: string) =>
  js<string>(chipText(n, name)).match(TEXT.chipReady)?.[0] ?? "?";
export const chipCount = `${all("removeMedia")}.length`;
const DIALOG = one("dialog");

export async function openVideoDialog(n: number, name: string, timeoutMs: number) {
  for (let attempt = 1; ; attempt++) {
    await pollUntil(chipReady(n, name), timeoutMs);
    click(`${chip(n, name)}?.button`, `settings button of ${name}`);
    if (await waitFor(has("dialogSave", DIALOG), 3_000)) return;
    if (attempt === 10) throw new StepError(`the settings dialog of ${name} never opened`);
  }
}

export async function closeDialog(button: "dialogSave" | "dialogCancel") {
  click(one(button, DIALOG), MAP[button].what);
  if (!(await waitFor(`!${has("dialog")}`, 10_000))) {
    const why = js<string>(
      `${all("dialogError", DIALOG)}.map((e) => AS.norm(e.innerText)).join(' ')`,
    );
    throw new StepError(
      `the dialog did not close after ${MAP[button].what}${why ? `; AI Studio says: ${why}` : ""}`,
    );
  }
}

// ---------- step runner ----------

export type Step = [name: string, run: () => Promise<string> | string];

/**
 * Runs steps in order: "→ [n/N] name" when a step starts, "✓ ... : <evidence read back from the page>" when it is
 * confirmed, "✗ ... failed: <reason>" plus a screenshot when it is not. Exit 0 = all confirmed, 1 = a step failed.
 */
export async function runSteps(steps: Step[], opts: { onDone?: () => void } = {}) {
  const t0 = Date.now();
  let current = "";
  let stepNo = 0;
  try {
    for (const [name, run] of steps) {
      stepNo++;
      current = `[${stepNo}/${steps.length}] ${name}`;
      console.error(`→ ${current}`);
      guard();
      const start = Date.now();
      const confirmed = await run();
      console.error(`✓ ${current}: ${confirmed} (${secs(Date.now() - start)})`);
    }
    console.error(`✓ done in ${secs(Date.now() - t0)}`);
    opts.onDone?.();
  } catch (e) {
    const reason = e instanceof StepError ? e.message : ((e as Error).stack ?? String(e));
    console.error(`✗ ${current} failed: ${reason}`);
    if (await chromeUp()) {
      const shot = resolve(tmpdir(), `aistudio-failed-${tab}-step${stepNo}.png`);
      try {
        ab("screenshot", shot);
        console.error(`  screenshot: ${shot}`);
      } catch {
        console.error("  (could not take a screenshot)");
      }
    }
    process.exit(1);
  }
}

export const chromeStep: Step = ["start Chrome", startChrome];
/** The steps a command that works on a page starts with. */
export const browserSteps: Step[] = [chromeStep, ["prepare tab", () => prepareTab()]];
