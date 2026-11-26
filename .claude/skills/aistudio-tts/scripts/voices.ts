import { ab, click, js, StepError } from "../../aistudio/scripts/lib";
import { requireWav, saveNewFile } from "./audio";
import { matchChoice, voiceSampleUrl } from "./input";
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
const visibleMenuBackdrop =
  "[...document.querySelectorAll('.cdk-overlay-transparent-backdrop')].some(e => e.getClientRects().length > 0)";

export function voices() {
  requireLibrary();
  return js<{
    query: string;
    current: string;
    filters: string[];
    collapsedGroups: string[];
    results: { name: string; group: string; description: string; favorite: boolean }[];
  }>(`({
    query: ${item("voiceSearch")}.value,
    current: AS.norm(AS.textOf(${item("voiceCurrent")} ?? document.createElement('span'))),
    filters: [...(${item("library")})?.querySelectorAll('button[aria-haspopup]') ?? []].map(AS.nameOf),
    collapsedGroups: [...(${item("library")})?.querySelectorAll('.voice-group') ?? []]
      .filter(g => [...g.querySelectorAll('button,[role="button"]')].some(b => b.getClientRects().length && /^View all\\b/i.test(AS.nameOf(b))))
      .map(g => AS.norm(g.querySelector('.group-title')?.textContent))
      .filter(Boolean),
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
  const before = js<string>(`${list("voiceRows")}.map(e => e.dataset.voiceName).join(',')`);
  await fillSearch(query);
  const trimmed = query.trim().toLowerCase();
  if (trimmed) {
    await verify(
      `(() => {
        const rows = ${list("voiceRows")};
        const names = rows.map(e => e.dataset.voiceName).join(',');
        return names !== ${JSON.stringify(before)} ||
          rows.length === 0 ||
          rows.every(e => (e.dataset.voiceName + ' ' + AS.norm(e.innerText)).toLowerCase().includes(${JSON.stringify(trimmed)}));
      })()`,
      "",
      3_000,
    ).catch(() => {});
  } else {
    await verify(
      `${list("voiceRows")}.map(e => e.dataset.voiceName).join(',') !== ${JSON.stringify(before)}`,
      "",
      1_500,
    ).catch(() => {});
  }
  return voices();
}

async function fillSearch(query: string) {
  ab("fill", VOICE_SEARCH, "--", query);
  await verify(
    `${value(item("voiceSearch"))} === ${JSON.stringify(query)}`,
    "Voice search did not retain the query.",
  );
}

async function findVoiceWithRestore(name: string): Promise<{ row: string; restoreQuery?: string }> {
  requireLibrary();
  const rows = voiceRows(name);
  let restoreQuery: string | undefined;
  if (!js<boolean>(`${rows}.length > 0`)) {
    const previous = js<string>(`${value(item("voiceSearch"))} ?? ''`);
    await fillSearch(name);
    restoreQuery = previous;
  }
  try {
    if (restoreQuery !== undefined) {
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
    return { row: `(${distinct}[0] ?? ${rows}[0])`, restoreQuery };
  } catch (error) {
    if (restoreQuery !== undefined) {
      try {
        if (js<boolean>(exists("voiceSearch"))) await fillSearch(restoreQuery);
      } catch {}
    }
    throw error;
  }
}

export async function findVoice(name: string) {
  return (await findVoiceWithRestore(name)).row;
}

export async function selectVoice(name: string, speaker?: number) {
  requireLibrary();
  if (js<boolean>(currentVoiceIs(name))) return `voice ${name} is already current`;
  const row = await findVoice(name);
  const voice = name.toLowerCase();
  const speakerCheck =
    speaker !== undefined
      ? `${list("speaker")}.some(e => AS.nameOf(e).toLowerCase() === ${JSON.stringify(`speaker ${speaker} - ${voice}`)})`
      : `${list("speaker")}.some(e => AS.nameOf(e).split(' - ').slice(1).join(' - ').toLowerCase() === ${JSON.stringify(voice)})`;
  js(`(${row}?.scrollIntoView({ block: 'center' }), true)`);
  tap("voiceChoice", row);
  await verify(
    `(${exists("voiceSearch")} && ${currentVoiceIs(name)}) || (!(${exists("voiceSearch")}) && ${speakerCheck})`,
    `Voice "${name}" did not become current in the speaker settings.`,
  );
  return `voice ${name} is shown as current`;
}

export async function favoriteVoice(name: string, enabled: boolean) {
  const { row, restoreQuery } = await findVoiceWithRestore(name);
  try {
    js(`(${row}?.scrollIntoView({ block: 'center' }), true)`);
    const isOn = favoriteOn(row);
    if (js<boolean>(isOn) !== enabled) tap("favorite", row);
    await verify(
      `${exists("favorite", row)} && (${isOn}) === ${enabled}`,
      `AI Studio did not show favorites as ${enabled ? "on" : "off"} for ${name}.`,
    );
    return `favorite ${enabled ? "on" : "off"} for ${name}`;
  } finally {
    if (restoreQuery !== undefined) {
      try {
        if (js<boolean>(exists("voiceSearch"))) await fillSearch(restoreQuery);
      } catch {}
    }
  }
}

export async function sampleVoice(name?: string, output?: string, force = false) {
  requireLibrary();
  const located = name ? await findVoiceWithRestore(name) : { row: item("voiceCurrent") };
  const root = located.row;
  const key = name ? "sample" : "sampleCurrent";
  const control = label(item(key, root));
  const playing = `/^(Stop|Pause)/i.test(${control})`;
  try {
    if (name) js(`(${root}?.scrollIntoView({ block: 'center' }), true)`);
    const otherPlaying = `${list("sample", item("library"))}.find(b => /^(Stop|Pause)/i.test(AS.nameOf(b)) && !(${root})?.contains(b))`;
    if (js<boolean>(`Boolean(${otherPlaying})`)) {
      click(otherPlaying, "stop previous sample");
      await verify(`!(Boolean(${otherPlaying}))`, "", 3_000).catch(() => {});
    }
    const wasPlaying = js<boolean>(playing);
    if (wasPlaying && output) {
      tap(key, root);
      await verify(`!(${playing})`, "Could not restart the current sample for export.");
    }
    js(`(performance.setResourceTimingBufferSize?.(1000), true)`);
    const start = js<number>("performance.now()");
    if (!wasPlaying || output) {
      tap(key, root);
      const started = await verify(playing, "", 4_000).then(
        () => true,
        () => false,
      );
      if (!started) {
        tap(key, root);
        await verify(
          playing,
          `AI Studio did not signal playback for ${name ?? "the current voice"}; inspect the sample button and any alert.`,
          10_000,
        );
      }
    }
    if (!output) return `playing sample of ${name ?? "current voice"}`;
    const resources = `performance.getEntriesByType('resource')
      .filter(e => e.initiatorType === 'audio' && e.startTime >= ${start}).map(e => e.name)`;
    const cachedSlug = name
      ? name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
      : "";
    const cachedResources = cachedSlug
      ? `performance.getEntriesByType('resource')
          .filter(e => e.initiatorType === 'audio').map(e => e.name).reverse()`
      : "[]";
    const deadline = Date.now() + 8_000;
    let url: string | undefined;
    do {
      url = js<string[]>(resources).map(voiceSampleUrl).find(Boolean);
      if (!url && cachedSlug && Date.now() - (deadline - 8_000) >= 3_000) {
        url = js<string[]>(cachedResources)
          .map(voiceSampleUrl)
          .find((u): u is string =>
            Boolean(u && new RegExp(`[-/]${cachedSlug}\\.wav$`, "i").test(u)),
          );
      }
      if (url) break;
      await Bun.sleep(500);
    } while (Date.now() < deadline);
    if (!url) {
      throw new StepError(
        "The voice played but exposed no new public catalog WAV. Listen in the browser or choose another catalog sample.",
      );
    }
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok)
      throw new StepError(`Catalog sample download returned HTTP ${response.status}.`);
    const bytes = requireWav(Buffer.from(await response.arrayBuffer()));
    const path = await saveNewFile(output, bytes, force);
    if (js<boolean>(playing)) {
      tap(key, root);
      await verify(`!(${playing})`, "", 3_000).catch(() => {});
    }
    return { path, bytes: bytes.length };
  } finally {
    if (located.restoreQuery !== undefined) {
      try {
        if (js<boolean>(exists("voiceSearch"))) await fillSearch(located.restoreQuery);
      } catch {}
    }
  }
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
  const anyExpanded = `${buttons}.some(e => e.getAttribute('aria-expanded') === 'true')`;
  const closeMenu = async () => {
    if (!js<boolean>(`${anyExpanded} || ${visibleMenuBackdrop}`)) return;
    ab("press", "Escape");
    await verify(
      `!(${anyExpanded}) && !(${visibleMenuBackdrop})`,
      "The voice filter menu stayed open.",
      5_000,
    );
  };
  if (!js<boolean>(`${trigger}?.getAttribute('aria-expanded') === 'true'`)) {
    await closeMenu();
    click(trigger, `voice filter ${name}`);
  }
  await verify(
    `${trigger}?.getAttribute('aria-expanded') === 'true'`,
    `The ${name} filter did not open.`,
  );
  const options = `${locate([{ role: "menuitem", name: /./ }])}.items`;
  try {
    const choices = js<string[]>(`${options}.map(AS.nameOf)`);
    if (!choices.some((choice) => choice.toLowerCase() === CLEAR_OPTION[index]?.toLowerCase())) {
      throw new StepError(
        `The filter menu did not identify itself as ${name}. Inspect snapshot and the voiceFilters map.`,
      );
    }
    if (option === undefined) {
      await closeMenu();
      return choices;
    }
    const matched = matchChoice(choices, option);
    if (!matched) {
      throw new StepError(`${name} has no "${option}". Available options: ${choices.join(", ")}.`);
    }
    click(
      `${options}.find(e => AS.nameOf(e) === ${JSON.stringify(matched)})`,
      `${name} option ${matched}`,
    );
    const expectedChip =
      matched.toLowerCase() === CLEAR_OPTION[index]?.toLowerCase() ? name : matched;
    await verify(
      `!(${anyExpanded}) && !(${visibleMenuBackdrop}) &&
        ${buttons}.some(e => AS.nameOf(e) === ${JSON.stringify(expectedChip)})`,
      `AI Studio did not show ${matched} as the selected ${name} filter.`,
    );
    return voices();
  } finally {
    try {
      if (js<boolean>(`${anyExpanded} || ${visibleMenuBackdrop}`)) await closeMenu();
    } catch {}
  }
}
