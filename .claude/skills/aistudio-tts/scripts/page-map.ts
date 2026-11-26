import { click, fill, js, StepError, waitFor } from "../../aistudio/scripts/lib";

type Locator = { css: string } | { role: string; name: string | RegExp };
const css = (selector: string): Locator => ({ css: selector });
const button = (name: string | RegExp): Locator => ({ role: "button", name });
export const VOICE_SEARCH = '[aria-label="Search voices"]';
export const FAVORITED = /^(?:Unfavorite\b|Remove (?:from favorites\b|.* from favorites\b))/i;

export const MAP = {
  model: [css('[data-test-id="model-name"]')],
  welcome: [button("Create new dialog")],
  block: [css('[aria-label="Speech block"]'), css("ms-speech-block")],
  text: [css('[aria-label="Speech block text"]'), css("textarea")],
  add: [button("Add speech block")],
  remove: [button("Delete speech block")],
  speaker: [button(/^Speaker [12](?:\s+-|$)/)],
  style: [button("Style"), css("button.attribute-chip")],
  styleText: [css('[aria-label="Describe the voice style"]')],
  styleOptions: [css('[role="menuitem"]')],
  expressions: [button(/\bExpression$/)],
  expressionChoices: [css("button.tag-chip")],
  blockPreview: [button(/^(?:Preview this block|Add text to preview|Stop preview)/)],
  modelSettings: [button("Expand or collapse Model settings")],
  temperature: [
    css('[data-test-id="temperatureSliderContainer"] [role="spinbutton"]'),
    css('[data-test-id="temperatureSliderContainer"] input[type="number"]'),
  ],
  voiceSettings: [button("Open voice settings")],
  library: [
    css("ms-voice-library .voice-section"),
    css('section:has([aria-label="Search voices"])'),
  ],
  voiceList: [css('section[aria-label="Available voices"]')],
  voiceSearch: [css(VOICE_SEARCH)],
  voiceFilters: [
    css("button.filter-dropdown-chip"),
    css('button[aria-haspopup="menu"][aria-expanded]'),
  ],
  voiceRows: [css("[data-voice-name]")],
  voiceChoice: [css("button.voice-card-content")],
  voiceCurrent: [css(".current-voice-card")],
  favorite: [button(new RegExp(`^Favorite\\b|${FAVORITED.source}`, "i"))],
  sample: [button(/^(?:(?:Play|Stop|Pause) voice sample|Pause)$/i)],
  sampleCurrent: [button(/^(?:(?:Play|Stop|Pause) current voice sample|Pause)$/i)],
  remix: [button(/^Remix /)],
  newVoice: [button(/^Create new voice$|^New voice$/)],
  closePanel: [button("Close panel")],
  dialog: [css("mat-dialog-container"), css('[role="dialog"]')],
  dialogTitle: [css("[mat-dialog-title]"), css("h2")],
  run: [button(/^Run$/)],
  stop: [button(/^Stop(?: generating)?$/)],
  player: [
    css("ms-audio-footer .player-container:has(audio)"),
    css(".player-container:has([aria-label='Seek audio position'])"),
  ],
  download: [button(/^(?:Download|Download audio)(?:\b|$)/), css("a[download]")],
  getCode: [button("Get code")],
  codeDialog: [css("#code-dialog"), css("ms-get-code-dialog")],
  codeSnippet: [css("pre > code")],
  pause: [button("Pause")],
  seek: [css('[aria-label="Seek audio position"]')],
} satisfies Record<string, Locator[]>;

export type Key = keyof typeof MAP;

const encodeLocators = (candidates: Locator[]) =>
  candidates.map((c) =>
    "css" in c
      ? c
      : {
          role: c.role,
          name:
            typeof c.name === "string" ? c.name : { source: c.name.source, flags: c.name.flags },
        },
  );
const queryLocators = `((root, candidates) => {
    if (!root) return { items: [], fallback: -1 };
    for (const [fallback, candidate] of candidates.entries()) {
      const items = [...root.querySelectorAll(candidate.css || 'button,input,textarea,select,[role]')]
        .filter(e => e.getClientRects().length && !e.closest('[inert],[aria-hidden="true"]'))
        .filter(e => candidate.css || (AS.roleOf(e) === candidate.role &&
          (typeof candidate.name === 'string' ? AS.nameOf(e) === candidate.name :
            new RegExp(candidate.name.source, candidate.name.flags).test(AS.nameOf(e)))));
      if (items.length) return { items, fallback };
    }
    return { items: [], fallback: -1 };
  })`;

export function locate(candidates: Locator[], root = "document") {
  return `${queryLocators}(${root}, ${JSON.stringify(encodeLocators(candidates))})`;
}

export const found = (key: Key, root?: string) => locate(MAP[key], root);
export const list = (key: Key, root?: string) => `${found(key, root)}.items`;
export const item = (key: Key, root?: string, index = 0) => `${list(key, root)}[${index}]`;
export const exists = (key: Key, root?: string) => `${list(key, root)}.length > 0`;
export const label = (selector: string) =>
  `AS.nameOf(${selector} ?? document.createElement('span'))`;
export const value = (selector: string) => `(${selector}?.value ?? null)`;
export const enabled = (selector: string) =>
  `(() => { const e = ${selector}; return Boolean(e && !e.disabled && e.getAttribute('aria-disabled') !== 'true'); })()`;
export const scopedButton = (name: string | RegExp, root?: string) =>
  `${locate([button(name)], root)}.items[0]`;

export async function verify(condition: string, message: string, timeout = 8_000) {
  if (!(await waitFor(condition, timeout))) throw new StepError(message);
}

export function tap(key: Key, root?: string, index = 0) {
  click(item(key, root, index), `${key}${index ? ` #${index + 1}` : ""} (see: map)`);
}

export async function fillValue(selector: string, text: string, what: string) {
  fill(selector, what, text);
  if (js<string | null>(value(selector)) !== text) {
    throw new StepError(`${what} did not retain the supplied value.`);
  }
}

export function inspectMap() {
  const encoded = Object.entries(MAP).map(([key, candidates]) => [key, encodeLocators(candidates)]);
  return js<Record<Key, { candidate: number; count: number }>>(
    `(() => {
      const query = ${queryLocators};
      return Object.fromEntries(${JSON.stringify(encoded)}.map(([key, candidates]) => {
        const { items, fallback } = query(document, candidates);
        return [key, { candidate: fallback, count: items.length }];
      }));
    })()`,
  );
}
