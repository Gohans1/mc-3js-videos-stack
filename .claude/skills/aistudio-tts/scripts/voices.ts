import { ab, click, js, StepError } from "../../aistudio/scripts/lib";
import { requireWav, saveNewFile } from "./audio";
import { voiceSampleUrl } from "./input";
import {
  exists,
  FAVORITED,
  item,
  label,
  list,
  locate,
  scopedButton,
  tap,
  value,
  verify,
  VOICE_SEARCH,
} from "./page-map";

export function requireLibrary() {
  if (!js<boolean>(exists("voiceSearch")))
    throw new StepError("Open the voice library with library first.");
}

const favoriteOn = (root: string) => `${FAVORITED}.test(${label(item("favorite", root))})`;
const currentVoiceIs = (name: string) =>
  `(${item("voiceCurrent")}?.innerText.split('\\n').some(line => line.trim().toLowerCase() === ${JSON.stringify(name.toLowerCase())}))`;

export function voices() {
  requireLibrary();
  return js<{
    query: string;
    current: string;
    filters: string[];
    results: { name: string; group: string; description: string; favorite: boolean }[];
  }>(`({
    query: ${item("voiceSearch")}.value,
    current: AS.norm(${item("voiceCurrent")}?.innerText),
    filters: [...(${item("library")})?.querySelectorAll('button[aria-haspopup]') ?? []].map(AS.nameOf),
    results: ${list("voiceRows")}.map(row => ({
      name: row.dataset.voiceName,
      group: AS.norm(row.closest('.voice-group')?.querySelector('.group-title')?.textContent),
      description: AS.norm(${item("voiceChoice", "row")}?.innerText),
      favorite: ${favoriteOn("row")}
    }))
  })`);
}

const voiceRows = (name: string) => `${list("voiceRows")}.filter(e =>
  e.dataset.voiceName?.toLowerCase() === ${JSON.stringify(name.toLowerCase())})`;

export async function searchVoices(query: string) {
  requireLibrary();
  await fillSearch(query);
  return voices();
}

async function fillSearch(query: string) {
  ab("fill", VOICE_SEARCH, "--", query);
  await verify(
    `${value(item("voiceSearch"))} === ${JSON.stringify(query)}`,
    "Voice search did not retain the query.",
  );
}

export async function findVoice(name: string) {
  requireLibrary();
  const rows = voiceRows(name);
  if (!js<boolean>(`${rows}.length > 0`)) {
    await fillSearch(name);
    await verify(
      `${rows}.length > 0`,
      `No exact voice named "${name}" in the current filters. Inspect voices and clear filters if needed.`,
      12_000,
    );
  }
  const distinct = `${rows}.filter(e => e.closest('.voice-group')?.querySelector('.group-title')?.textContent.trim() !== 'Favorites')`;
  if (js<number>(`${distinct}.length`) > 1) {
    throw new StepError(
      `Multiple voice rows are named "${name}". Narrow the filters or choose the intended row via snapshot/ui.`,
    );
  }
  return `(${distinct}[0] ?? ${rows}[0])`;
}

export async function selectVoice(name: string) {
  requireLibrary();
  if (js<boolean>(currentVoiceIs(name))) return `voice ${name} is already current`;
  const row = await findVoice(name);
  const voice = JSON.stringify(name.toLowerCase());
  tap("voiceChoice", row);
  await verify(
    `${currentVoiceIs(name)} ||
    (${list("speaker")}.some(e => AS.nameOf(e).split(' - ').slice(1).join(' - ').toLowerCase() === ${voice}))`,
    `Voice "${name}" did not become current in the speaker settings.`,
  );
  return `voice ${name} is shown as current`;
}

export async function favoriteVoice(name: string, enabled: boolean) {
  const row = await findVoice(name);
  const isOn = favoriteOn(row);
  if (js<boolean>(isOn) !== enabled) tap("favorite", row);
  await verify(
    `${exists("favorite", row)} && (${isOn}) === ${enabled}`,
    `AI Studio did not show favorites as ${enabled ? "on" : "off"} for ${name}.`,
  );
  return `favorite ${enabled ? "on" : "off"} for ${name}`;
}

export async function sampleVoice(name?: string, output?: string) {
  requireLibrary();
  const key = name ? "sample" : "sampleCurrent";
  const root = name ? await findVoice(name) : item("voiceCurrent");
  const control = label(item(key, root));
  const playing = `/^(Stop|Pause)/i.test(${control})`;
  const wasPlaying = js<boolean>(playing);
  if (wasPlaying && output) {
    tap(key, root);
    await verify(`!(${playing})`, "Could not restart the current sample for export.");
  }
  const start = js<number>("performance.now()");
  if (!wasPlaying || output) tap(key, root);
  await verify(
    `/^(Stop|Pause)/i.test(${control})`,
    `AI Studio did not signal playback for ${name ?? "the current voice"}; inspect the sample button and any alert.`,
    12_000,
  );
  if (!output) return `playing sample of ${name ?? "current voice"}`;
  const resources = `performance.getEntriesByType('resource')
    .filter(e => e.initiatorType === 'audio' && e.startTime >= ${start}).map(e => e.name)`;
  const deadline = Date.now() + 8_000;
  do {
    const url = js<string[]>(resources).map(voiceSampleUrl).find(Boolean);
    if (url) {
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
      if (!response.ok)
        throw new StepError(`Catalog sample download returned HTTP ${response.status}.`);
      const bytes = requireWav(Buffer.from(await response.arrayBuffer()));
      return { path: await saveNewFile(output, bytes), bytes: bytes.length };
    }
    await Bun.sleep(500);
  } while (Date.now() < deadline);
  throw new StepError(
    "The voice played but exposed no new public catalog WAV. Listen in the browser or choose another catalog sample.",
  );
}

export async function openVoiceCreation(mode?: string, name?: string) {
  const dialog = `${list("dialog")}.at(-1)`;
  const title = `AS.norm(${item("dialogTitle", dialog)}?.innerText)`;
  if (mode === "remix" && name) {
    tap("remix", await findVoice(name));
    await verify(
      `/Remix/i.test(${title})`,
      "Remix dialog did not open. Inspect the current voice's Remix control.",
    );
  } else {
    tap("newVoice");
    await verify(
      `Boolean(${scopedButton(/^Voice Design\b/, dialog)})`,
      "Create voice did not offer Voice Design.",
    );
    if (mode === "design" || mode === "replication") {
      const option = mode === "design" ? /^Voice Design\b/ : /^Voice Replication\b/;
      click(scopedButton(option, dialog), mode);
      await verify(`/${mode}/i.test(${title})`, `Voice ${mode} did not advance to its form.`);
    }
  }
  if (js<boolean>(`/link a paid api key/i.test(${dialog}?.innerText || '')`)) {
    throw new StepError(
      `${js<string>(title)} requires a paid API key linked to a project with billing in AI Studio. The gate is open in this tab.`,
    );
  }
  return js<string>(title);
}

export const FACETS = ["Language", "Gender", "Pitch", "Style", "Use case"] as const;
const CLEAR_OPTION = ["All languages", "All genders", "All pitches", "All styles", "All use cases"];

export async function voiceFilter(name: (typeof FACETS)[number], option?: string) {
  requireLibrary();
  const root = item("library");
  const buttons = list("voiceFilters", root);
  const index = FACETS.indexOf(name);
  const trigger = `(${buttons}.find(e => AS.nameOf(e) === ${JSON.stringify(name)}) ??
    (${buttons}.length === ${FACETS.length} ? ${buttons}[${index}] : null))`;
  if (!js<boolean>(`${trigger}?.getAttribute('aria-expanded') === 'true'`)) {
    if (js<boolean>(`${buttons}.some(e => e.getAttribute('aria-expanded') === 'true')`))
      ab("press", "Escape");
    click(trigger, `voice filter ${name}`);
  }
  await verify(
    `${trigger}?.getAttribute('aria-expanded') === 'true'`,
    `The ${name} filter did not open.`,
  );
  const options = `${locate([{ role: "menuitem", name: /./ }])}.items`;
  const choices = js<string[]>(`${options}.map(AS.nameOf)`);
  if (!choices.some((choice) => choice.toLowerCase() === CLEAR_OPTION[index]?.toLowerCase())) {
    throw new StepError(
      `The filter menu did not identify itself as ${name}. Inspect snapshot and the voiceFilters map.`,
    );
  }
  if (option === undefined) return choices;
  click(
    `${options}.find(e => AS.nameOf(e) === ${JSON.stringify(option)})`,
    `${name} option ${option}`,
  );
  const expectedChip = option.toLowerCase() === CLEAR_OPTION[index]?.toLowerCase() ? name : option;
  await verify(
    `!(${buttons}.some(e => e.getAttribute('aria-expanded') === 'true')) &&
      ${buttons}.some(e => AS.nameOf(e) === ${JSON.stringify(expectedChip)})`,
    `AI Studio did not show ${option} as the selected ${name} filter.`,
  );
  return voices();
}
