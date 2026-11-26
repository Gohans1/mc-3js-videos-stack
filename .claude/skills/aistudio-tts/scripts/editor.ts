import { ab, click, focus, js, StepError, toLF } from "../../aistudio/scripts/lib";
import { inspectSpeechAudio, type SpeechAudioEvidence, speechAudioEvidence } from "./audio";
import {
  DEFAULT_MODEL,
  SPEECH_ORIGIN,
  SPEECH_PATH,
  speechAccountMatches,
  speechUrl,
} from "./input";
import { exists, fillValue, item, label, list, scopedButton, tap, value, verify } from "./page-map";

const ACCOUNT_SLOT_KEY = "gohans.aistudio-tts.account-slot";
const requestedSlot = () =>
  js<string | null>(`sessionStorage.getItem(${JSON.stringify(ACCOUNT_SLOT_KEY)})`);
const bindSlot = (account: string) =>
  js(`sessionStorage.setItem(${JSON.stringify(ACCOUNT_SLOT_KEY)}, ${JSON.stringify(account)})`);

function verifySlot(url: URL, account: string | null) {
  if (account !== null && !speechAccountMatches(url.pathname, account)) {
    throw new StepError(
      `Google opened ${url.pathname} instead of account slot ${account}. Close this tab or reopen with the intended, signed-in slot.`,
    );
  }
}

export function requireSpeechPage(checkAccount = true) {
  const url = new URL(js<string>("location.href"));
  if (url.hostname === "accounts.google.com") {
    throw new StepError(
      "AI Studio is signed out. Open the existing AI Studio Chrome with studio.ts chrome --show and sign in there.",
    );
  }
  if (url.origin !== SPEECH_ORIGIN || !SPEECH_PATH.test(url.pathname)) {
    throw new StepError(
      "This tab is outside the speech workspace. Use the open command on a dedicated TTS tab.",
    );
  }
  if (checkAccount) verifySlot(url, requestedSlot());
  return url;
}

export const modelId = () => js<string>(`AS.norm(${item("model")}?.textContent)`);

export async function openSpeech(model = DEFAULT_MODEL, account?: string) {
  const destination = speechUrl(model, account);
  const current = new URL(js<string>("location.href"));
  const alreadyOnSpeech = current.origin === SPEECH_ORIGIN && SPEECH_PATH.test(current.pathname);
  if (!alreadyOnSpeech) {
    if (current.origin === SPEECH_ORIGIN && !/^\/(?:u\/\d+\/)?library\/?$/.test(current.pathname)) {
      throw new StepError("This tab is in use outside TTS. Choose a fresh --tab to open speech.");
    }
    ab("open", destination);
  }
  await verify(
    `${exists("block")} || ${exists("welcome")} || location.origin !== ${JSON.stringify(SPEECH_ORIGIN)}`,
    "The speech workspace did not render its start screen or editor. Inspect the live tab with snapshot.",
    35_000,
  );
  const actual = requireSpeechPage(false);
  if (account !== undefined && !speechAccountMatches(actual.pathname, account)) {
    if (!alreadyOnSpeech) bindSlot(account);
    else
      throw new StepError(
        `This tab already holds the workspace at ${actual.pathname}. Use a new --tab for account slot ${account}.`,
      );
  }
  verifySlot(actual, account ?? requestedSlot());
  const activeModel = modelId() || actual.searchParams.get("model");
  if (activeModel !== model)
    throw new StepError(
      `This tab has ${activeModel ?? "no model"}. Use a fresh --tab for ${model} to keep the current draft.`,
    );
  if (account !== undefined) bindSlot(account);
  return activeModel;
}

export const block = (number: number) => item("block", undefined, number - 1);

export async function startEditor() {
  if (!js<boolean>(exists("block"))) {
    tap("welcome");
    await verify(exists("block"), "Create new dialog did not open the screenplay editor.");
  }
  return "speech editor ready";
}

export const blockCount = () => js<number>(`${list("block")}.length`);

export async function addBlock() {
  const before = blockCount();
  tap("add");
  await verify(
    `${list("block")}.length === ${before + 1}`,
    "AI Studio did not append a speech block.",
  );
  return `block ${before + 1} added`;
}

export async function removeBlock(number: number) {
  const before = blockCount();
  tap("remove", block(number));
  await verify(
    `${list("block")}.length === ${before - 1}`,
    "AI Studio did not remove the requested block.",
  );
  return `block ${number} removed`;
}

export async function blockText(number: number, text: string) {
  await fillValue(item("text", block(number)), toLF(text), `block ${number} text`);
  return `block ${number} text verified (${text.length} characters)`;
}

const styleValue = (trigger: string) => `(e => {
  if (!e) return '';
  return e.title === 'Style' && !e.classList.contains('has-style') ? '' : e.title;
})(${trigger})`;

export async function blockStyle(number: number, text?: string, preset = false) {
  const root = block(number);
  const trigger = item("style", root);
  const open = `${trigger}?.getAttribute('aria-expanded') === 'true' && ${exists("styleText")}`;
  const close = async () => {
    ab("press", "Escape");
    await verify(`!(${exists("styleText")})`, "The Style menu stayed open.");
  };
  if (!js<boolean>(open)) {
    if (js<boolean>(exists("styleText"))) await close();
    tap("style", root);
  }
  await verify(open, `Style menu for block ${number} did not open.`);
  const choices = list("styleOptions");
  const presetName =
    "(e => e.innerText.split('\\n').map(line => line.trim()).find(Boolean) || AS.nameOf(e))";
  if (text === undefined) {
    const menu = js<{ current: string; presets: { name: string; label: string }[] }>(`({
      current: ${value(item("styleText"))},
      presets: ${choices}.map(e => ({ name: ${presetName}(e), label: AS.nameOf(e) }))
    })`);
    await close();
    return menu;
  }
  if (preset) {
    const requested = JSON.stringify(text);
    const choice = `${choices}.find(e => ${presetName}(e) === ${requested} || AS.nameOf(e) === ${requested})`;
    const expected = js<string>(
      `(() => { const e = ${choice}; return e ? ${presetName}(e) : ''; })()`,
    );
    if (!expected)
      throw new StepError(`Unknown preset "${text}". Run style ${number} for the live choices.`);
    click(choice, `style preset ${text}`);
    await verify(
      `!(${exists("styleText")}) && ${styleValue(trigger)} === ${JSON.stringify(expected)}`,
      `AI Studio did not show preset ${expected} on block ${number}.`,
    );
    return `block ${number} style preset ${expected} verified`;
  }
  const expected = toLF(text);
  await fillValue(item("styleText"), expected, `block ${number} style`);
  await close();
  if (js<string>(styleValue(trigger)) !== expected) {
    throw new StepError(`AI Studio did not show the new style on block ${number}.`);
  }
  return `block ${number} style verified`;
}

export async function temperature(input?: number) {
  if (!js<boolean>(exists("temperature"))) tap("modelSettings");
  await verify(exists("temperature"), "Temperature is unavailable for the current model.");
  const field = item("temperature");
  const current = () =>
    js<{ value: number; min: string; max: string; step: string }>(
      `(() => {
      const e = ${field};
      return { value: Number(e.value), min: e.getAttribute('aria-valuemin') || e.min,
        max: e.getAttribute('aria-valuemax') || e.max, step: e.step };
    })()`,
    );
  if (input === undefined) return current();
  const range = current();
  if (
    (range.min !== "" && input < Number(range.min)) ||
    (range.max !== "" && input > Number(range.max))
  ) {
    throw new StepError(
      `Temperature ${input} is outside the live range ${range.min}–${range.max}.`,
    );
  }
  await fillValue(field, String(input), "temperature");
  ab("press", "Tab");
  await verify(
    `Number(${value(field)}) === ${input}`,
    "AI Studio changed the temperature after blur.",
  );
  return current();
}

export function speechStatus() {
  const url = requireSpeechPage();
  const { evidence, ...status } = js<{
    url: string;
    model: string;
    temperature: string | null;
    evidence: SpeechAudioEvidence;
    voiceLibraryOpen: boolean;
    blocks: { number: number; text: string; speaker: string; style: string }[];
  }>(`({
    url: ${JSON.stringify(url.href)},
    model: AS.norm(${item("model")}?.textContent) || new URL(location.href).searchParams.get('model'),
    temperature: ${value(item("temperature"))},
    evidence: ${speechAudioEvidence},
    voiceLibraryOpen: ${exists("voiceSearch")},
    blocks: ${list("block")}.map((e, i) => ({
      number: i + 1, text: ${value(item("text", "e"))},
      speaker: ${label(item("speaker", "e"))}, style: ${styleValue(item("style", "e"))}
    }))
  })`);
  const { phase } = inspectSpeechAudio(evidence);
  return {
    ...status,
    audioPhase: phase,
    running: phase === "generating" || phase === "streaming",
    audio: phase === "ready",
    awaitingNewAudio: evidence.awaitingNewAudio,
  };
}

export async function openLibrary(target: number, source: "block" | "speaker" = "speaker") {
  if (js<boolean>(exists("voiceSearch"))) {
    await closeLibrary();
  }
  if (source === "block") tap("speaker", block(target));
  else tap("voiceSettings", undefined, target - 1);
  await verify(
    exists("voiceSearch"),
    "Speaker settings did not open. Inspect the block speaker menu with snapshot.",
  );
  return `voice library opened for ${source} ${target}`;
}

export async function closeLibrary() {
  const name = js<string>(label(item("closePanel")));
  if (!name) throw new StepError("The voice library's close control is missing. Inspect snapshot.");
  ab("find", "role", "button", "click", "--name", name, "--exact");
  await verify(
    `! (${exists("voiceSearch")})`,
    "Voice settings stayed open. Inspect the active overlay.",
  );
  return "voice settings closed";
}

export async function addExpression(number: number, name?: string) {
  const root = block(number);
  const after = `${list("expressionChoices", root)}.map(AS.nameOf)`;
  if (!js<boolean>(`${after}.length > 0`)) tap("expressions", root);
  await verify(`${after}.length > 0`, "Expression picker did not expose any choices.");
  if (name === undefined) return js<string[]>(after);
  if (!js<string[]>(after).includes(name))
    throw new StepError(`Unknown expression "${name}". List expressions first.`);
  const field = item("text", root);
  const before = js<string>(value(field));
  focus(scopedButton(name, root), `expression ${name}`);
  ab("press", "Enter");
  const inserted = js<string>(value(field));
  if (inserted === before || !inserted.includes(`<${name}>`)) {
    throw new StepError(`AI Studio did not insert <${name}> into block ${number}.`);
  }
  return `<${name}> is in block ${number}`;
}

export async function generatedCode() {
  if (!js<boolean>(exists("codeDialog"))) tap("getCode");
  const output = item("codeSnippet", item("codeDialog"));
  await verify(
    `Boolean(${output}?.textContent?.trim())`,
    "Get code did not expose a generated snippet. Check the dialog and selected language.",
  );
  return js<string>(`${output}.textContent`).replace(/\bAIza[A-Za-z0-9_-]{35}\b/g, "YOUR_API_KEY");
}
