// The only file that knows what AI Studio's pages look like. When the UI changes, fix it here (see
// references/ui-changes.md), then run `bun studio.ts doctor`.
//
// Each entry lists candidates from most to least stable; the first one that matches wins, and `doctor`
// reports when only a fallback matched (fix it before that breaks too). Stability order, following
// Playwright's locator guidance: data-test-id (Google's own test hooks) > ARIA role + accessible name
// (what screen readers announce) > CSS on Angular component tags (most likely to change).
// Accessible names are English UI text, so the Google account must keep AI Studio in English.

export type Name = string | { re: string; flags?: string };
export type Candidate = { testId: string } | { role: string; name?: Name } | { css: string };

/** Which page state an entry can be checked on (used by doctor). */
export type Where =
  | "chat"
  | "chat-turns"
  | "video-chip"
  | "video-dialog"
  | "model-picker"
  | "library"
  | "turn-menu"
  | "rename-dialog"
  | "system-panel";

/** optional: why the element can be legitimately absent (doctor then reports it as "absent", not broken). */
export type Entry = { what: string; where: Where; candidates: Candidate[]; optional?: string };

const ORIGIN = "https://aistudio.google.com";
export const URLS = {
  origin: ORIGIN,
  newChat: (model: string) => `${ORIGIN}/prompts/new_chat?model=${encodeURIComponent(model)}`,
  chat: (id: string) => `${ORIGIN}/prompts/${id}`,
  library: `${ORIGIN}/library`,
  /** Chat ids are Drive file ids. */
  chatIdPattern: /prompts\/([\w-]{10,})/,
  /** Where AI Studio sends a chat id it cannot open (wrong, deleted, or another account's). */
  accessRestricted: "/prompt-access-restricted",
  signIn: "accounts.google.com",
};

export const DEFAULT_MODEL = "gemini-4-neon";
/** What a new chat gets unless told otherwise; thinking only on DEFAULT_MODEL, since other models offer other levels. */
export const DEFAULT_THINKING = "Extra High";
export const DEFAULT_MEDIA = "High";

/** Text patterns read off the page (in-page code builds them with new RegExp(source, flags)). */
export const TEXT = {
  /** An attachment chip is ready when it shows its token count; Agentic video mode shows "Agentic" instead. */
  chipReady: /[\d,]+ tokens|\bAgentic\b/,
  /** A model id such as gemini-3.1-flash-lite inside a picker item's name. */
  modelId: /\b[a-z][a-z0-9]*(-[a-z0-9.]+)+\b/,
};

const re = (source: string, flags = "") => ({ re: source, flags });

export const MAP = {
  // ----- chat page: prompt box and run -----
  promptBox: {
    what: "prompt text box",
    where: "chat",
    candidates: [
      { role: "textbox", name: "Enter a prompt" },
      { css: "ms-prompt-box textarea" },
      { css: "textarea" },
    ],
  },
  runButton: {
    what: "Run button; its name starts with Run (plus shortcut badge) when idle and Stop while the model generates",
    where: "chat",
    candidates: [
      {
        role: "button",
        name: re(
          "^(Run(\\s+(Ctrl|⌘|Cmd|Meta|Alt|Shift|Enter|Return|keyboard_return).*)?|Stop(\\s+(Esc|Ctrl|⌘|Cmd|Meta|keyboard_return).*)?)$",
        ),
      },
      { css: "ms-run-button button" },
    ],
  },
  account: {
    what: "signed-in Google account button (name 'Google Account: <name> (<email>)')",
    where: "chat",
    candidates: [{ role: "button", name: re("^Google Account:") }],
  },
  alerts: {
    what: "toasts and alerts AI Studio shows (errors, quota)",
    optional: "only while AI Studio shows a message",
    where: "chat",
    candidates: [{ role: "alert" }, { css: "mat-snack-bar-container, .mat-mdc-snack-bar-label" }],
  },
  title: {
    what: "chat title (Playground on an unsaved chat); the page's only h1, while other headings belong to panels",
    where: "chat",
    candidates: [{ css: "h1" }],
  },

  // ----- run settings panel -----
  modelName: {
    what: "id of the model the chat uses, inside the button that opens the model picker",
    where: "chat",
    candidates: [{ testId: "model-name" }, { css: "ms-model-selector button .subtitle" }],
  },
  thinking: {
    what: "Thinking level dropdown",
    where: "chat",
    candidates: [{ role: "combobox", name: "Thinking Level" }],
  },
  media: {
    what: "Media resolution dropdown",
    where: "chat",
    candidates: [
      { role: "combobox", name: "Media resolution" },
      { css: '[data-test-id="mediaResolution"] [role=combobox]' },
    ],
  },
  dropdownValue: {
    what: "selected text inside a dropdown (search inside the combobox)",
    where: "chat",
    candidates: [{ css: ".mat-mdc-select-value-text" }, { css: "[id^=mat-select-value]" }],
  },
  advancedToggle: {
    what: "button that folds/unfolds Advanced settings",
    where: "chat",
    candidates: [{ role: "button", name: "Expand or collapse advanced settings" }],
  },
  toolsToggle: {
    what: "button that folds/unfolds the Tools section",
    where: "chat",
    candidates: [{ role: "button", name: "Expand or collapse tools" }],
  },
  systemInstructions: {
    what: "System instructions button (opens a text panel)",
    where: "chat",
    candidates: [{ role: "button", name: "System instructions" }],
  },
  systemText: {
    what: "System instructions text box in the side panel (saved as you type)",
    where: "system-panel",
    candidates: [{ role: "textbox", name: "System instructions" }],
  },
  renameButton: {
    what: "pencil next to the chat title; opens the rename dialog (saved chats only, a new chat has none)",
    where: "chat-turns",
    candidates: [{ role: "button", name: "Edit prompt title and description" }],
  },
  titleInput: {
    what: "chat name box in the rename dialog",
    where: "rename-dialog",
    candidates: [{ role: "textbox", name: "Prompt name text field" }],
  },
  descriptionInput: {
    what: "chat description box in the rename dialog",
    where: "rename-dialog",
    candidates: [{ role: "textbox", name: "Prompt description text field" }],
  },
  titleSave: {
    what: "Save in the rename dialog",
    where: "rename-dialog",
    candidates: [{ role: "button", name: "Save title and description" }],
  },
  maxOutputTokens: {
    what: "Output length number box",
    where: "chat",
    candidates: [{ role: "spinbutton", name: "Maximum output tokens" }],
  },

  // ----- attachments -----
  addMedia: {
    what: "Insert images, videos, audio, or files button",
    where: "chat",
    candidates: [
      { testId: "add-media-button" },
      { role: "button", name: "Insert images, videos, audio, or files" },
    ],
  },
  fileInput: {
    what: "hidden file input that takes uploads",
    where: "chat",
    candidates: [{ css: "ms-add-media-button input[type=file]" }, { css: "input[type=file]" }],
  },
  videoSettings: {
    what: "settings button on an uploaded video chip (one per video, same name on each)",
    where: "video-chip",
    candidates: [{ role: "button", name: "Edit video options" }],
  },
  removeMedia: {
    what: "remove button on an attachment chip (one per attachment; anchors the chip)",
    where: "video-chip",
    candidates: [{ role: "button", name: "Remove media" }],
  },
  dialog: {
    what: "any open dialog (AI Studio gives it no role=dialog, so only the Angular Material tag works)",
    where: "video-dialog",
    candidates: [{ css: "mat-dialog-container" }],
  },
  fpsInput: {
    what: "FPS box in the video settings dialog",
    where: "video-dialog",
    candidates: [
      { role: "spinbutton", name: "FPS (frames per second)" },
      { css: 'input[aria-label="FPS (frames per second)"]' },
    ],
  },
  startTime: {
    what: "Start Time box in the video settings dialog (e.g. 1m10s)",
    where: "video-dialog",
    candidates: [{ role: "textbox", name: re("^Start Time") }],
  },
  endTime: {
    what: "End Time box in the video settings dialog (e.g. 2m30s)",
    where: "video-dialog",
    candidates: [{ role: "textbox", name: re("^End Time") }],
  },
  agenticVideo: {
    what: "Agentic video understanding switch in the video settings dialog",
    where: "video-dialog",
    candidates: [{ role: "switch", name: "Agentic video understanding" }],
  },
  dialogSave: {
    what: "Save in a dialog",
    where: "video-dialog",
    candidates: [{ role: "button", name: "Save" }],
  },
  dialogError: {
    what: "why a dialog refused Save, e.g. 'End time must be within the video duration (1 - 2s).' (no ARIA hook)",
    where: "video-dialog",
    candidates: [{ css: ".dialog-error" }],
    optional: "only after a dialog rejects a value",
  },
  dialogCancel: {
    what: "Cancel in a dialog",
    where: "video-dialog",
    candidates: [{ role: "button", name: "Cancel" }],
  },

  // ----- conversation -----
  turn: {
    what: "one conversation turn (a user or model message part); no ARIA hook, so this is the most fragile entry",
    where: "chat-turns",
    candidates: [{ css: "ms-chat-turn" }],
  },
  turnRole: {
    what: "element inside a turn whose data-turn-role is User or Model",
    where: "chat-turns",
    candidates: [{ css: "[data-turn-role]" }],
  },
  turnBody: {
    what: "content of a turn; AI Studio renders it only for turns near the screen, so scroll the turn into view first",
    where: "chat-turns",
    candidates: [{ css: "ms-prompt-chunk" }],
  },
  turnText: {
    what: "text part of a turn",
    where: "chat-turns",
    candidates: [{ css: "ms-text-chunk" }],
  },
  turnThought: {
    what: "model thoughts part of a turn",
    where: "chat-turns",
    candidates: [{ css: "ms-thought-chunk" }],
    optional: "only in chats whose model thought",
  },
  turnMedia: {
    what: "attachment part of a turn",
    where: "chat-turns",
    candidates: [
      { css: "ms-video-chunk, ms-image-chunk, ms-audio-chunk, ms-file-chunk, ms-document-chunk" },
    ],
    optional: "only in chats with attachments",
  },
  turnOptions: {
    what: "options button of a turn (search inside the turn)",
    where: "chat-turns",
    candidates: [{ role: "button", name: "Open options" }, { css: "ms-chat-turn-options button" }],
  },
  copyMarkdown: {
    what: "Copy as markdown item of a turn's options menu",
    where: "turn-menu",
    candidates: [{ role: "menuitem", name: "Copy as markdown" }],
  },

  // ----- model picker (opened by clicking the model card) -----
  modelPicker: {
    what: "model picker panel",
    where: "model-picker",
    candidates: [{ role: "region", name: "Model carousel" }],
  },
  modelPickerSearch: {
    what: "search box in the model picker (search inside the picker)",
    where: "model-picker",
    candidates: [{ role: "textbox", name: "Search" }],
  },
  modelPickerItem: {
    what: "one model in the picker (search inside the picker); its name holds title, id, blurb and price",
    where: "model-picker",
    candidates: [{ role: "button", name: re(TEXT.modelId.source) }],
  },
  panelClose: {
    what: "Close panel button of the open side panel (model picker, system instructions); next to the panel, not inside it",
    where: "model-picker",
    candidates: [{ role: "button", name: "Close panel" }],
  },

  // ----- History (/library) -----
  libraryRow: {
    what: "one saved chat row in History (search for the /prompts/ link inside)",
    where: "library",
    candidates: [{ role: "row" }, { css: "tr" }],
  },
  libraryLink: {
    what: "link to a saved chat; href is /prompts/<id>",
    where: "library",
    candidates: [{ css: 'a[href*="/prompts/"]:not([href*="new_chat"])' }],
  },
  librarySearch: {
    what: "History search box",
    where: "library",
    candidates: [{ role: "textbox", name: "Search" }],
  },
} satisfies Record<string, Entry>;

export type Key = keyof typeof MAP;

/** Switches in the Tools section: short alias -> accessible name. */
export const TOOLS: Record<string, string> = {
  search: "Grounding with Google Search",
  url: "Browse the url context",
  code: "Code execution",
  structured: "Structured outputs",
  functions: "Function calling",
  maps: "Grounding with Google Maps",
};
/** A TOOLS alias or full switch name → the full name, or undefined. */
export const toolName = (alias: string): string | undefined =>
  TOOLS[alias] ?? (Object.values(TOOLS).includes(alias) ? alias : undefined);
/** Tools only some models offer (Maps: flash-lite yes, gemini-4-neon no); doctor reports them absent, not broken. */
export const TOOLS_SOME_MODELS = new Set(["maps"]);

/** Levels seen on gemini-4-neon, for help text only: each model offers its own (flash-lite has Minimal, no Extra High). */
export const THINKING = ["Low", "Medium", "High", "Extra High"];
export const MEDIA = ["Default", "Low", "Medium", "High"];
export const VIDEO_EXT = [
  ".mp4",
  ".mov",
  ".webm",
  ".mkv",
  ".avi",
  ".mpeg",
  ".mpg",
  ".wmv",
  ".flv",
  ".3gp",
];

/** Dynamic candidates for things whose accessible name is data. */
export const dynamic = {
  option: (name: string): Candidate[] => [{ role: "option", name }],
  /** Any option of the open dropdown list: the list is open while one exists. */
  anyOption: [{ role: "option" }] as Candidate[],
  toolSwitch: (name: string): Candidate[] => [{ role: "switch", name }],
};
