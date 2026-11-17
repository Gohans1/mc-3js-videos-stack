// Shared CLI catalog schema, 100% repo command inventory, and pure argv/safety resolver (no Node built-ins; safe in browser & server).

export type CliCategoryId = "daily" | "voice" | "sound" | "render" | "setup" | "dev" | "pipeline";

export type CliEffect = "read" | "write" | "install" | "destructive" | "daemon";
export type CliCost = "free" | "optional-paid" | "paid";
export type CliSpeed = "instant" | "short" | "long";
export type CliHelpMode = "flag" | "subcommand" | "none";
export type CliCwdMode = "film" | "root";
export type CliRunnerKind =
  "bun-script" | "earshot" | "bun-file" | "python-file" | "bash-file" | "package-script";

export type CliChoiceSource =
  | "films"
  | "filmDirs"
  | "notes"
  | "shots"
  | "takes"
  | "skills"
  | "skillRefs"
  | "favLists"
  | "findKinds"
  | "findSources"
  | "postures"
  | "renders"
  | "labs"
  | "packages";

export type CliFieldType = "string" | "number" | "boolean" | "enum" | "choice" | "csv";

export interface CliVisibleWhen {
  field: string;
  nonEmpty?: boolean;
  in?: readonly string[];
  unsetOrIn?: readonly string[];
  unsetOrStartsWith?: readonly string[];
}

export interface CliArgDef {
  key: string;
  label: string;
  type: CliFieldType;
  multi?: boolean;
  required?: boolean;
  requiredWhen?: CliVisibleWhen;
  choiceSource?: CliChoiceSource;
  options?: readonly string[];
  default?: string | number | boolean;
  placeholder?: string;
  hint?: string;
  visibleWhen?: CliVisibleWhen;
  exclusiveGroup?: string;
  tier?: "common" | "advanced";
}

export interface CliFlagDef {
  key: string;
  flag: string;
  label: string;
  type: CliFieldType;
  required?: boolean;
  requiredWhen?: CliVisibleWhen;
  optionalValue?: boolean;
  bareLabel?: string;
  bareHint?: string;
  multi?: boolean;
  multiStyle?: "repeat" | "args";
  default?: string | number | boolean;
  choiceSource?: CliChoiceSource;
  options?: readonly string[];
  placeholder?: string;
  hint?: string;
  visibleWhen?: CliVisibleWhen;
  exclusiveGroup?: string;
  requiresConfirmIfSet?: boolean;
  tier?: "common" | "advanced";
}

export interface CliEnvDef {
  key: string;
  label: string;
  type: CliFieldType;
  required?: boolean;
  requiredWhen?: CliVisibleWhen;
  options?: readonly string[];
  choiceSource?: CliChoiceSource;
  placeholder?: string;
  hint?: string;
  visibleWhen?: CliVisibleWhen;
  exclusiveGroup?: string;
  tier?: "common" | "advanced";
}

export interface CliGuard {
  disabled?: boolean;
  disabledWhenToolsUnset?: boolean;
  disabledOnRunningFilm?: boolean;
  reason: string;
}

export interface CliConfirmRule {
  mode: "none" | "always" | "when-flagged";
  message: string;
  whenArgIn?: { key: string; values: readonly string[] };
}

export type CliEnvKey =
  | "ELEVENLABS_API_KEY"
  | "GENVOICE_API_KEY"
  | "GEMINI_API_KEY"
  | "GOOGLE_API_KEY"
  | "OPENCODE_API_KEY"
  | "OPENROUTER_API_KEY";

export interface CliMeta {
  effect: CliEffect;
  cost: CliCost;
  costHint?: string;
  speed: CliSpeed;
  cancellable: boolean;
  helpMode: CliHelpMode;
  helpArgs?: readonly string[];
  guard?: CliGuard;
  confirm?: CliConfirmRule;
  envRequired?: readonly CliEnvKey[];
  envAnyOf?: readonly (readonly CliEnvKey[])[];
  outputsHint?: string;
}

export interface CliSubcommand {
  id: string;
  label: string;
  summary: string;
  subcommandRequired?: boolean;
  args?: readonly CliArgDef[];
  flags?: readonly CliFlagDef[];
  env?: readonly CliEnvDef[];
  inheritFlags?: boolean;
  meta?: Partial<CliMeta>;
  subcommands?: readonly CliSubcommand[];
}

export interface CliCommand {
  id: string;
  label: string;
  category: CliCategoryId;
  summary: string;
  runner: CliRunnerKind;
  target: string;
  packageDir?: string;
  cwdModes: readonly CliCwdMode[];
  subcommandRequired?: boolean;
  args?: readonly CliArgDef[];
  flags?: readonly CliFlagDef[];
  env?: readonly CliEnvDef[];
  meta: CliMeta;
  subcommands?: readonly CliSubcommand[];
}

export interface CliCategory {
  id: CliCategoryId;
  label: string;
  description: string;
}

export type CliEnvStatus = Record<CliEnvKey, boolean>;

export interface CliContext {
  repoName: string;
  repoRoot: string;
  projectRoot: string | null;
  copyShell: "powershell" | "posix";
  activeFilm: string | null;
  isDemo: boolean;
  films: string[];
  runningFilms: string[];
  choices: Record<CliChoiceSource, string[]>;
  envStatus: CliEnvStatus;
}

export type CliArgValue = string | number | boolean | readonly string[] | undefined;

export interface CliRunRequest {
  commandId: string;
  subcommandPath?: readonly string[];
  args?: Record<string, CliArgValue>;
  flags?: Record<string, CliArgValue>;
  env?: Record<string, CliArgValue>;
  targetFilm?: string;
  mode?: "execute" | "help";
  confirmed?: boolean;
}

export interface CliRunChunk {
  seq: number;
  stream: "stdout" | "stderr";
  chunk: string;
}

export interface CliRunSnapshot {
  runId: string;
  commandId: string;
  subcommandPath: string[];
  mode: "execute" | "help";
  displayCommand: string;
  cwd: string;
  targetFilm: string | null;
  status: "running" | "done" | "stopped" | "error";
  startedAt: number;
  finishedAt?: number;
  exitCode?: number | null;
  signal?: string | null;
  durationMs?: number;
  error?: string;
  truncated: boolean;
  output: CliRunChunk[];
}

export interface CliTemplate {
  id: string;
  name: string;
  commandId: string;
  subcommandPath: string[];
  args: Record<string, CliArgValue>;
  flags: Record<string, CliArgValue>;
  env: Record<string, CliArgValue>;
  targetFilm: string;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CliCatalogResponse {
  categories: readonly CliCategory[];
  commands: readonly CliCommand[];
  context: CliContext;
}

export interface ResolvedCliSpec {
  command: CliCommand;
  subcommands: readonly CliSubcommand[];
  subcommandPath: string[];
  mode: "execute" | "help";
  cwdMode: CliCwdMode;
  argsDef: readonly CliArgDef[];
  flagsDef: readonly CliFlagDef[];
  envDef: readonly CliEnvDef[];
  meta: CliMeta;
  baseMeta: CliMeta;
  argvTokens: string[];
  envEntries: [string, string][];
  displayCommand: string;
  copyCommand: string;
  requiresConfirm: boolean;
  confirmMessage: string | null;
  guardReason: string | null;
  missingEnvGroups: CliEnvKey[][];
  exclusiveConflicts: string[];
  validationErrors: string[];
}

export const CLI_CATEGORIES: readonly CliCategory[] = [
  {
    id: "daily",
    label: "Everyday film tools",
    description: "Inspect your film, find assets, check its data, and respond to notes.",
  },
  {
    id: "voice",
    label: "Voice and lip sync",
    description:
      "Generate narration takes, align words, shape mouths, assemble voice tracks, and read cues.",
  },
  {
    id: "sound",
    label: "Sound and mixing",
    description:
      "Fetch CC0 SFX, mix and audit soundtracks, and run Earshot audio inspection & synthesis.",
  },
  {
    id: "render",
    label: "Rendering and checks",
    description:
      "Render stills, clips, finals, contact sheets, frame checks, pacing, and YouTube delivery audits.",
  },
  {
    id: "setup",
    label: "Setup and assets",
    description:
      "Bootstrap vaults, download external sound packs, scaffold new films, and link assets.",
  },
  {
    id: "dev",
    label: "Development",
    description:
      "Tests, lint, formatting, typechecks, package suites, studios, and search/load benchmarks.",
  },
  {
    id: "pipeline",
    label: "Asset utilities",
    description:
      "Standalone asset picking, JAR slimming, mocap catalog search/review, and studio init scripts.",
  },
];

// Reusable Earshot flag factories matching `earshot <cmd> -h` without duplicating fields.
const earshotThreadsFlag: CliFlagDef = {
  key: "--threads",
  flag: "--threads",
  label: "CPU Threads",
  type: "number",
  tier: "advanced",
  placeholder: "4",
  hint: "CPU threads for torch & BLAS (default EARSHOT_THREADS)",
};

const earshotJsonFlag: CliFlagDef = {
  key: "--json",
  flag: "--json",
  label: "Output as JSON",
  type: "boolean",
  tier: "common",
  hint: "Print full result as JSON",
};

const earshotOutFlag: CliFlagDef = {
  key: "--out",
  flag: "--out",
  label: "Save JSON to file",
  type: "string",
  tier: "advanced",
  placeholder: "renders/earshot.json",
  hint: "Also write JSON result to file",
};

const earshotStd = (withOut = true): readonly CliFlagDef[] =>
  withOut
    ? [earshotJsonFlag, earshotOutFlag, earshotThreadsFlag]
    : [earshotJsonFlag, earshotThreadsFlag];

const earshotTrim = (): readonly CliFlagDef[] => [
  {
    key: "--start",
    flag: "--start",
    label: "Start time (seconds)",
    type: "number",
    tier: "common",
    placeholder: "0",
    hint: "Leave blank to start at the beginning.",
  },
  {
    key: "--end",
    flag: "--end",
    label: "End time (seconds)",
    type: "number",
    tier: "common",
    placeholder: "5",
    hint: "Leave blank to use the rest of the file.",
  },
];

const earshotCuesFlags = (): readonly CliFlagDef[] => [
  {
    key: "--video",
    flag: "--video",
    label: "Video",
    type: "string",
    choiceSource: "renders",
    tier: "common",
  },
  {
    key: "--cues",
    flag: "--cues",
    label: "Cues",
    type: "string",
    tier: "common",
    placeholder: "renders/cuts.json or 1.5,3.2",
  },
  { key: "--from", flag: "--from", label: "From (s)", type: "number", tier: "common" },
  { key: "--to", flag: "--to", label: "To (s)", type: "number", tier: "common" },
  {
    key: "--detail",
    flag: "--detail",
    label: "Detail",
    type: "enum",
    options: ["low", "normal", "high"],
    tier: "common",
  },
];

const bareListCopy = (itemsName: string): Pick<CliFlagDef, "bareLabel" | "bareHint"> => ({
  bareLabel: `(bare flag — list ${itemsName})`,
  bareHint: `Leave empty to list available ${itemsName}, or enter/pick values to filter.`,
});

const renderTargetValues = ["stills", "clip", "captions", "poster", "all", "final"] as const;

export const CLI_COMMANDS: readonly CliCommand[] = [
  // ── DAILY FILM AI LOOP ───────────────────────────────────────────────────────────────────────────
  {
    id: "help",
    label: "help",
    category: "daily",
    summary: "List commands in this folder, or print where to find help for a named command.",
    runner: "bun-script",
    target: "help",
    cwdModes: ["film", "root"],
    args: [
      {
        key: "command",
        label: "Command to look up (optional)",
        type: "string",
        placeholder: "find",
        hint: "Leave blank to list commands. Enter find to print where its help is; this does not run find.",
      },
    ],
    meta: {
      effect: "read",
      cost: "free",
      speed: "instant",
      cancellable: false,
      helpMode: "flag",
    },
  },
  {
    id: "skills",
    label: "skills",
    category: "daily",
    summary: "List AI guides from skill-data/ or read a guide and its reference docs.",
    runner: "bun-script",
    target: "skills",
    cwdModes: ["film", "root"],
    meta: {
      effect: "read",
      cost: "free",
      speed: "instant",
      cancellable: false,
      helpMode: "flag",
    },
    subcommands: [
      {
        id: "get",
        label: "get",
        summary: "Read a skill guide (e.g. core) and optionally specific reference sections.",
        args: [
          {
            key: "name",
            label: "Guide",
            type: "choice",
            required: true,
            choiceSource: "skills",
            default: "core",
          },
        ],
        flags: [
          {
            key: "--ref",
            flag: "--ref",
            label: "Reference(s)",
            type: "string",
            multi: true,
            multiStyle: "repeat",
            choiceSource: "skillRefs",
            exclusiveGroup: "skill-detail",
            tier: "common",
            hint: "One or more reference names (e.g. sound, render, contract)",
          },
          {
            key: "--full",
            flag: "--full",
            label: "Full Guide + All Refs",
            type: "boolean",
            exclusiveGroup: "skill-detail",
            tier: "common",
          },
        ],
      },
    ],
  },
  {
    id: "find",
    label: "find",
    category: "daily",
    summary:
      "Search sounds, music, mocap clips, transitions, anims, fonts, looks, or star favorites.",
    runner: "bun-script",
    target: "find",
    cwdModes: ["film", "root"],
    args: [
      {
        key: "words",
        label: "Query Words / Scene",
        type: "string",
        multi: true,
        placeholder: "creaky door",
        hint: "Plain English keywords, or scene description with --jev",
      },
    ],
    flags: [
      {
        key: "--kind",
        flag: "--kind",
        label: "Kind / Group",
        type: "csv",
        optionalValue: true,
        ...bareListCopy("kinds & groups"),
        choiceSource: "findKinds",
        tier: "common",
        hint: "e.g. sfx, bgm, mc, sound, mocap, transition, anim, text, shape, font, adjust, velocity, ease; omit value to list groups",
      },
      {
        key: "--source",
        flag: "--source",
        label: "Source / Pack",
        type: "csv",
        optionalValue: true,
        ...bareListCopy("sources & packs"),
        choiceSource: "findSources",
        tier: "common",
        hint: "Omit value to list all available sources & mod packs with counts",
      },
      {
        key: "--jev",
        flag: "--jev",
        label: "Use Jev AI Judge",
        type: "boolean",
        tier: "common",
        hint: "Rank by meaning using Jev (OpenCode free -> OpenRouter <$0.01)",
      },
      {
        key: "-n",
        flag: "-n",
        label: "Limit (-n)",
        type: "number",
        tier: "common",
        placeholder: "12",
        hint: "Hits shown (default 12, max 200)",
      },
      {
        key: "--show",
        flag: "--show",
        label: "Show ID(s)",
        type: "csv",
        tier: "common",
        placeholder: "dissolve",
        hint: "Inspect full entry details & paste snippets",
      },
      {
        key: "--dur",
        flag: "--dur",
        label: "Duration (min-max)",
        type: "string",
        optionalValue: true,
        ...bareListCopy("duration buckets"),
        tier: "common",
        placeholder: "0-1",
      },
      {
        key: "--origin",
        flag: "--origin",
        label: "Origin",
        type: "enum",
        options: ["real", "synth"],
        optionalValue: true,
        ...bareListCopy("origin values"),
        tier: "advanced",
      },
      {
        key: "--edition",
        flag: "--edition",
        label: "MC Edition",
        type: "enum",
        options: ["vanilla", "modded"],
        optionalValue: true,
        ...bareListCopy("MC editions"),
        tier: "advanced",
      },
      {
        key: "--license",
        flag: "--license",
        label: "License",
        type: "string",
        options: ["free", "credit", "claim", "minecraft", "mod", "mit", "lgpl"],
        optionalValue: true,
        ...bareListCopy("license values"),
        tier: "advanced",
      },
      {
        key: "--fav",
        flag: "--fav",
        label: "Favorites List",
        type: "choice",
        choiceSource: "favLists",
        optionalValue: true,
        ...bareListCopy("favorites lists"),
        tier: "advanced",
      },
      {
        key: "--star",
        flag: "--star",
        label: "Star ID(s)",
        type: "csv",
        exclusiveGroup: "star-op",
        tier: "advanced",
        hint: "Adds starred IDs to favorites/<list>.json",
      },
      {
        key: "--unstar",
        flag: "--unstar",
        label: "Unstar ID(s)",
        type: "csv",
        exclusiveGroup: "star-op",
        tier: "advanced",
      },
      // Mocap-only filters: shown whenever --kind is unset or starts with mocap
      {
        key: "--from",
        flag: "--from",
        label: "Start Posture",
        type: "choice",
        choiceSource: "postures",
        visibleWhen: { field: "--kind", unsetOrStartsWith: ["mocap"] },
        tier: "advanced",
      },
      {
        key: "--to",
        flag: "--to",
        label: "End Posture",
        type: "choice",
        choiceSource: "postures",
        visibleWhen: { field: "--kind", unsetOrStartsWith: ["mocap"] },
        tier: "advanced",
      },
      {
        key: "--has",
        flag: "--has",
        label: "Has Posture",
        type: "choice",
        choiceSource: "postures",
        visibleWhen: { field: "--kind", unsetOrStartsWith: ["mocap"] },
        tier: "advanced",
      },
      {
        key: "--still",
        flag: "--still",
        label: "Still (<0.3m)",
        type: "boolean",
        exclusiveGroup: "mocap-motion",
        visibleWhen: { field: "--kind", unsetOrStartsWith: ["mocap"] },
        tier: "advanced",
      },
      {
        key: "--moves",
        flag: "--moves",
        label: "Moves",
        type: "boolean",
        exclusiveGroup: "mocap-motion",
        visibleWhen: { field: "--kind", unsetOrStartsWith: ["mocap"] },
        tier: "advanced",
      },
      {
        key: "--loop",
        flag: "--loop",
        label: "Loopable",
        type: "boolean",
        visibleWhen: { field: "--kind", unsetOrStartsWith: ["mocap"] },
        tier: "advanced",
      },
      {
        key: "--energy",
        flag: "--energy",
        label: "Energy (deg/s)",
        type: "string",
        placeholder: "10-40",
        visibleWhen: { field: "--kind", unsetOrStartsWith: ["mocap"] },
        tier: "advanced",
      },
      {
        key: "--head",
        flag: "--head",
        label: "Hand at Head",
        type: "boolean",
        visibleWhen: { field: "--kind", unsetOrStartsWith: ["mocap"] },
        tier: "advanced",
      },
      {
        key: "--up",
        flag: "--up",
        label: "Hand Above Head",
        type: "boolean",
        visibleWhen: { field: "--kind", unsetOrStartsWith: ["mocap"] },
        tier: "advanced",
      },
      {
        key: "--ground",
        flag: "--ground",
        label: "Hand on Floor",
        type: "boolean",
        visibleWhen: { field: "--kind", unsetOrStartsWith: ["mocap"] },
        tier: "advanced",
      },
      {
        key: "--bend",
        flag: "--bend",
        label: "Bent Over",
        type: "boolean",
        visibleWhen: { field: "--kind", unsetOrStartsWith: ["mocap"] },
        tier: "advanced",
      },
      {
        key: "--air",
        flag: "--air",
        label: "Airborne",
        type: "enum",
        options: ["yes", "no"],
        visibleWhen: { field: "--kind", unsetOrStartsWith: ["mocap"] },
        tier: "advanced",
      },
      {
        key: "--look",
        flag: "--look",
        label: "Head Turn (deg)",
        type: "number",
        placeholder: "45",
        visibleWhen: { field: "--kind", unsetOrStartsWith: ["mocap"] },
        tier: "advanced",
      },
      {
        key: "--mood",
        flag: "--mood",
        label: "Mood",
        type: "string",
        placeholder: "scared",
        visibleWhen: { field: "--kind", unsetOrStartsWith: ["mocap"] },
        tier: "advanced",
      },
      {
        key: "--prop",
        flag: "--prop",
        label: "Prop",
        type: "string",
        placeholder: "chair",
        visibleWhen: { field: "--kind", unsetOrStartsWith: ["mocap"] },
        tier: "advanced",
      },
      {
        key: "--fights",
        flag: "--fights",
        label: "Include Fights",
        type: "boolean",
        visibleWhen: { field: "--kind", unsetOrStartsWith: ["mocap"] },
        tier: "advanced",
      },
    ],
    meta: {
      effect: "read",
      cost: "optional-paid",
      costHint: "Free offline by default; --jev queries Zen free -> OpenRouter (<$0.01/search).",
      speed: "instant",
      cancellable: true,
      helpMode: "flag",
      envAnyOf: [["OPENCODE_API_KEY", "OPENROUTER_API_KEY"]],
    },
  },
  {
    id: "check",
    label: "check",
    category: "daily",
    summary:
      "Validate all timelines, sound names, lip-sync requirements, and text readability against contract.",
    runner: "bun-script",
    target: "check",
    cwdModes: ["film"],
    flags: [
      { key: "--json", flag: "--json", label: "JSON Output", type: "boolean", tier: "common" },
    ],
    meta: {
      effect: "read",
      cost: "free",
      speed: "instant",
      cancellable: false,
      helpMode: "flag",
    },
  },
  {
    id: "at",
    label: "at",
    category: "daily",
    summary:
      "Inspect a moment in the film: shot, camera, dialogue, audio, keyframes and notes. Enter a playback time or note number.",
    runner: "bun-script",
    target: "at",
    cwdModes: ["film"],
    args: [
      {
        key: "secondOrNote",
        label: "Second / #Note / ID",
        type: "string",
        required: true,
        choiceSource: "notes",
        placeholder: "35.6 or 00:35.633 or #52",
      },
    ],
    flags: [
      { key: "--json", flag: "--json", label: "JSON Output", type: "boolean", tier: "common" },
    ],
    meta: {
      effect: "read",
      cost: "free",
      speed: "instant",
      cancellable: false,
      helpMode: "flag",
    },
  },
  {
    id: "notes",
    label: "notes",
    category: "daily",
    summary:
      "Read creator notes (list open notes, inspect full note detail + Jev lesson picks, or filter by shot).",
    runner: "bun-script",
    target: "notes",
    cwdModes: ["film"],
    args: [
      {
        key: "ids",
        label: "Note ID(s) / #N",
        type: "string",
        multi: true,
        choiceSource: "notes",
        placeholder: "3 or mw6hr1fm",
        hint: "Leave empty to list notes; provide IDs for full detail + Jev lesson suggestions",
      },
    ],
    flags: [
      {
        key: "--shot",
        flag: "--shot",
        label: "Shot #",
        type: "choice",
        choiceSource: "shots",
        tier: "common",
      },
      {
        key: "--sort",
        flag: "--sort",
        label: "Sort",
        type: "enum",
        options: ["written", "back", "film", "newest"],
        tier: "common",
      },
      {
        key: "--limit",
        flag: "--limit",
        label: "Limit",
        type: "number",
        placeholder: "25",
        tier: "common",
      },
      {
        key: "--done",
        flag: "--done",
        label: "Include Fixed/Done",
        type: "boolean",
        tier: "common",
      },
      {
        key: "--cam",
        flag: "--cam",
        label: "Include Film Cam Line",
        type: "boolean",
        tier: "advanced",
      },
    ],
    meta: {
      effect: "read",
      cost: "optional-paid",
      costHint:
        "List mode is free; detail ID or --shot mode runs Jev lesson lookup when keys are configured.",
      speed: "instant",
      cancellable: true,
      helpMode: "flag",
    },
  },
  {
    id: "note",
    label: "note",
    category: "daily",
    summary:
      "Respond to a creator note as fixed (done), question (ask), or lasting rule (learned).",
    runner: "bun-script",
    target: "note",
    cwdModes: ["film"],
    subcommandRequired: true,
    meta: {
      effect: "write",
      cost: "free",
      speed: "instant",
      cancellable: false,
      helpMode: "flag",
      outputsHint: "Updates note state via running studio or notes/notes.jsonl",
    },
    subcommands: [
      {
        id: "done",
        label: "done",
        summary: "Mark note fixed and queue it for creator check.",
        args: [
          {
            key: "id",
            label: "Note ID / #N",
            type: "choice",
            required: true,
            choiceSource: "notes",
          },
          {
            key: "text",
            label: "What Changed",
            type: "string",
            required: true,
            placeholder: "Adjusted cam timing",
          },
        ],
      },
      {
        id: "ask",
        label: "ask",
        summary: "Ask the creator a clarifying question on a note.",
        args: [
          {
            key: "id",
            label: "Note ID / #N",
            type: "choice",
            required: true,
            choiceSource: "notes",
          },
          {
            key: "text",
            label: "Your Question",
            type: "string",
            required: true,
            placeholder: "Should Steve stay sitting?",
          },
        ],
      },
      {
        id: "learned",
        label: "learned",
        summary: "Record the lasting rule kept for a remember note.",
        args: [
          {
            key: "id",
            label: "Note ID / #N",
            type: "choice",
            required: true,
            choiceSource: "notes",
          },
          {
            key: "text",
            label: "Rule & Where Kept",
            type: "string",
            required: true,
            placeholder: "Kept framing rule in lessons/cam.md",
          },
        ],
      },
    ],
  },
  {
    id: "gap",
    label: "gap",
    category: "daily",
    summary:
      "List missing CLI capabilities logged in scripts/gaps.jsonl, or record a new gap + workaround.",
    runner: "bun-script",
    target: "gap",
    cwdModes: ["film", "root"],
    args: [
      {
        key: "need",
        label: "Needed Capability",
        type: "string",
        placeholder: "zoom into one region of a still",
        hint: "Leave blank + clear --did to view all logged gaps",
      },
    ],
    flags: [
      {
        key: "--did",
        flag: "--did",
        label: "Workaround Used",
        type: "string",
        tier: "common",
        placeholder: "cropped still with ffmpeg",
      },
      {
        key: "--cmd",
        flag: "--cmd",
        label: "Command Name",
        type: "string",
        tier: "common",
        placeholder: "render",
      },
    ],
    meta: {
      effect: "read",
      cost: "free",
      speed: "instant",
      cancellable: false,
      helpMode: "flag",
      outputsHint: "Bare command reads scripts/gaps.jsonl; --did appends a row.",
    },
  },

  // ── VOICE & LIP SYNC ─────────────────────────────────────────────────────────────────────────────
  {
    id: "voice:gen",
    label: "voice:gen",
    category: "voice",
    summary:
      "Preview or generate ElevenLabs narration takes for src/edit.json (spends credits ONLY with --yes).",
    runner: "bun-script",
    target: "voice:gen",
    cwdModes: ["film"],
    args: [
      {
        key: "ids",
        label: "Take ID(s)",
        type: "string",
        multi: true,
        choiceSource: "takes",
        hint: "Omit for all missing or reworded takes",
      },
    ],
    flags: [
      {
        key: "--yes",
        flag: "--yes",
        label: "Spend Credits (--yes)",
        type: "boolean",
        requiresConfirmIfSet: true,
        tier: "common",
        hint: "Actually calls TTS/STS API and bills credits",
      },
      {
        key: "--dry-run",
        flag: "--dry-run",
        label: "Force Preview (--dry-run)",
        type: "boolean",
        tier: "common",
      },
      {
        key: "--try",
        flag: "--try",
        label: "Casting Tries (--try)",
        type: "boolean",
        tier: "common",
        hint: "Writes alternates into voice/try/<id>_<n>.mp3",
      },
      {
        key: "--takes",
        flag: "--takes",
        label: "Try Count (1-20)",
        type: "number",
        tier: "common",
        placeholder: "3",
      },
      {
        key: "--guide",
        flag: "--guide",
        label: "STS Guide Audio File",
        type: "string",
        tier: "advanced",
        placeholder: "voice/guide.wav",
        hint: "Requires exactly 1 take ID",
      },
    ],
    meta: {
      effect: "read",
      cost: "optional-paid",
      costHint:
        "Preview is free; passing --yes (without --dry-run) spends ElevenLabs/GenVoice credits.",
      speed: "short",
      cancellable: true,
      helpMode: "flag",
      envAnyOf: [["ELEVENLABS_API_KEY", "GENVOICE_API_KEY"]],
      confirm: {
        mode: "when-flagged",
        message: "This will call ElevenLabs / GenVoice with --yes and spend narration credits.",
      },
      outputsHint: "Writes voice/takes/<id>.mp3 or voice/try/<id>_<n>.mp3",
    },
  },
  {
    id: "voice:align",
    label: "voice:align",
    category: "voice",
    summary: "Run local whisperX word alignment for takes missing .words.json timings.",
    runner: "bun-script",
    target: "voice:align",
    cwdModes: ["film"],
    args: [
      {
        key: "ids",
        label: "Take ID(s)",
        type: "string",
        multi: true,
        choiceSource: "takes",
        hint: "Omit to align unaligned takes",
      },
    ],
    env: [
      {
        key: "WHISPERX_PYTHON",
        label: "WHISPERX_PYTHON",
        type: "string",
        tier: "advanced",
        placeholder: "vault/tools/whisperx/...",
      },
    ],
    meta: {
      effect: "write",
      cost: "free",
      speed: "long",
      cancellable: true,
      helpMode: "flag",
      outputsHint: "Writes voice/takes/<take>.words.json",
    },
  },
  {
    id: "voice:lips",
    label: "voice:lips",
    category: "voice",
    summary: "Generate Rhubarb Lip Sync mouth shapes for character-spoken takes (takes with 'by').",
    runner: "bun-script",
    target: "voice:lips",
    cwdModes: ["film"],
    args: [
      {
        key: "ids",
        label: "Take ID(s)",
        type: "string",
        multi: true,
        choiceSource: "takes",
        hint: "Omit for takes missing or older than audio",
      },
    ],
    env: [
      {
        key: "RHUBARB",
        label: "RHUBARB Binary Path",
        type: "string",
        tier: "advanced",
        placeholder: "vault/tools/rhubarb/rhubarb.exe",
      },
    ],
    meta: {
      effect: "write",
      cost: "free",
      speed: "short",
      cancellable: true,
      helpMode: "flag",
      outputsHint: "Writes voice/takes/<take>.mouth.json + src/timeline/mouth.json",
    },
  },
  {
    id: "voice:assemble",
    label: "voice:assemble",
    category: "voice",
    summary:
      "Assemble takes onto full_voice.wav, edit.json voice.lines, voice_map.json, and Phrase Bricks.",
    runner: "bun-script",
    target: "voice:assemble",
    cwdModes: ["film"],
    flags: [
      {
        key: "--clips",
        flag: "--clips",
        label: "Overwrite Moved Phrase Bricks",
        type: "boolean",
        requiresConfirmIfSet: true,
        tier: "common",
        hint: "Rewrites Phrase Bricks in src/timeline/audio.json even if moved by hand",
      },
    ],
    meta: {
      effect: "write",
      cost: "free",
      speed: "short",
      cancellable: true,
      helpMode: "flag",
      confirm: {
        mode: "when-flagged",
        message: "--clips overwrites hand-adjusted Phrase Bricks in src/timeline/audio.json.",
      },
      outputsHint: "Writes assets/public/agent/full_voice.wav & renders/live/voice_map.json",
    },
  },
  {
    id: "voice:cues",
    label: "voice:cues",
    category: "voice",
    summary:
      "Print exact heard seconds, WPM pace, and breathing gaps for every assembled narration line/word.",
    runner: "bun-script",
    target: "voice:cues",
    cwdModes: ["film"],
    flags: [
      {
        key: "--json",
        flag: "--json",
        label: "JSON Output (with words)",
        type: "boolean",
        tier: "common",
      },
    ],
    meta: {
      effect: "read",
      cost: "free",
      speed: "instant",
      cancellable: false,
      helpMode: "flag",
    },
  },
  {
    id: "voice:genvoice",
    label: "voice:genvoice",
    category: "voice",
    summary:
      "Direct ElevenLabs / GenVoice v4 client: search voices, list models, inspect credits, or run single-shot TTS/STS (scripts/voice/genvoice.ts).",
    runner: "bun-file",
    target: "scripts/voice/genvoice.ts",
    cwdModes: ["root"],
    subcommandRequired: true,
    meta: {
      effect: "read",
      cost: "free",
      speed: "short",
      cancellable: true,
      helpMode: "none",
      envAnyOf: [["ELEVENLABS_API_KEY", "GENVOICE_API_KEY"]],
    },
    subcommands: [
      {
        id: "voices",
        label: "voices",
        summary: "Search shared voices (page size 20).",
        args: [
          {
            key: "query",
            label: "Search Query",
            type: "string",
            placeholder: "calm narrator",
          },
        ],
        meta: {
          effect: "read",
          cost: "free",
          speed: "short",
          cancellable: true,
          envAnyOf: [["ELEVENLABS_API_KEY", "GENVOICE_API_KEY"]],
        },
      },
      {
        id: "models",
        label: "models",
        summary: "List available TTS and Speech-to-Speech model IDs.",
        meta: {
          effect: "read",
          cost: "free",
          speed: "short",
          cancellable: true,
          envAnyOf: [["ELEVENLABS_API_KEY", "GENVOICE_API_KEY"]],
        },
      },
      {
        id: "credits",
        label: "credits",
        summary: "Print active account / subscription info (JSON truncated to 800 chars).",
        meta: {
          effect: "read",
          cost: "free",
          speed: "short",
          cancellable: true,
          envAnyOf: [["ELEVENLABS_API_KEY", "GENVOICE_API_KEY"]],
        },
      },
      {
        id: "tts",
        label: "tts",
        summary:
          "Generate one TTS audio file (+ .words.json on ElevenLabs) from a text file using credits.",
        args: [
          {
            key: "voiceId",
            label: "Voice ID",
            type: "string",
            required: true,
            placeholder: "21m00Tcm4TlvDq8ikWAM",
          },
          {
            key: "textFile",
            label: "Text File Path",
            type: "string",
            required: true,
            placeholder: "line.txt",
          },
          {
            key: "out",
            label: "Output MP3 Path",
            type: "string",
            required: true,
            placeholder: "out.mp3",
          },
          {
            key: "model",
            label: "Model ID",
            type: "string",
            placeholder: "eleven_v4",
            hint: "Optional positional arg [4] (must be set before Speed)",
          },
          {
            key: "speed",
            label: "Speed",
            type: "number",
            placeholder: "1.0",
            hint: "Optional positional arg [5] (set Model ID first)",
          },
          {
            key: "stability",
            label: "Stability",
            type: "number",
            placeholder: "0.5",
            hint: "Optional positional arg [6] (set Model ID and Speed first)",
          },
        ],
        meta: {
          effect: "write",
          cost: "paid",
          speed: "short",
          cancellable: true,
          envAnyOf: [["ELEVENLABS_API_KEY", "GENVOICE_API_KEY"]],
          confirm: {
            mode: "always",
            message:
              "Calls ElevenLabs / GenVoice TTS API, consumes credits, and writes the output audio file.",
          },
        },
      },
      {
        id: "sts",
        label: "sts",
        summary:
          "Transform a guide recording with ElevenLabs Speech-to-Speech (Voice Changer) using credits.",
        args: [
          {
            key: "voiceId",
            label: "Voice ID",
            type: "string",
            required: true,
            placeholder: "21m00Tcm4TlvDq8ikWAM",
          },
          {
            key: "audioPath",
            label: "Guide Audio Path",
            type: "string",
            required: true,
            placeholder: "voice/guide.wav",
          },
          {
            key: "out",
            label: "Output MP3 Path",
            type: "string",
            required: true,
            placeholder: "out.mp3",
          },
          {
            key: "model",
            label: "STS Model ID",
            type: "string",
            placeholder: "eleven_multilingual_sts_v2",
          },
        ],
        meta: {
          effect: "write",
          cost: "paid",
          speed: "short",
          cancellable: true,
          envRequired: ["ELEVENLABS_API_KEY"],
          confirm: {
            mode: "always",
            message:
              "Calls ElevenLabs Speech-to-Speech API (requires ELEVENLABS_API_KEY), consumes credits, and writes output audio.",
          },
        },
      },
    ],
  },

  // ── SOUND, MIX & EARSHOT ─────────────────────────────────────────────────────────────────────────
  {
    id: "sfx:get",
    label: "sfx:get",
    category: "sound",
    summary: "Fetch pinned CC0 Freesound SFX into sound/sfx/ or search Freesound CC0.",
    runner: "bun-script",
    target: "sfx:get",
    cwdModes: ["film"],
    meta: {
      effect: "write",
      cost: "free",
      speed: "short",
      cancellable: true,
      helpMode: "flag",
      outputsHint: "Downloads into sound/sfx/ and updates sound/sfx/SOURCES.json",
    },
    subcommands: [
      {
        id: "find",
        label: "find",
        summary: "Search Freesound CC0 sounds (id | title | seconds | downloads).",
        args: [
          {
            key: "query",
            label: "Search Words",
            type: "string",
            required: true,
            placeholder: "cat meow",
          },
          { key: "maxSeconds", label: "Max Seconds", type: "number", placeholder: "10" },
        ],
        meta: { effect: "read", speed: "instant" },
      },
      {
        id: "sweeteners",
        label: "sweeteners",
        summary: "Fetch shared cut sweeteners (risers, whooshes, impacts, downlifters).",
      },
    ],
  },
  {
    id: "mix",
    label: "mix",
    category: "sound",
    summary:
      "Render soundtrack to sound/mix.wav and optionally mux onto a picture-only render MP4.",
    runner: "bun-script",
    target: "mix",
    cwdModes: ["film"],
    args: [
      {
        key: "video",
        label: "Picture Video (Optional)",
        type: "string",
        choiceSource: "renders",
        placeholder: "renders/draft_video.mp4",
        hint: "Muxes soundtrack -> renders/draft.mp4 or renders/final.mp4",
      },
    ],
    meta: {
      effect: "write",
      cost: "free",
      speed: "short",
      cancellable: true,
      helpMode: "flag",
      outputsHint: "Writes sound/mix.wav (and renders/draft.mp4 or final.mp4 if video provided)",
    },
  },
  {
    id: "listen",
    label: "listen",
    category: "sound",
    summary: "Measure mix LUFS/loudness/masking/cuts/mono issues and inspect audio stems.",
    runner: "bun-script",
    target: "listen",
    cwdModes: ["film"],
    flags: [
      {
        key: "--at",
        flag: "--at",
        label: "Focus Second (--at)",
        type: "string",
        tier: "common",
        placeholder: "35.2",
      },
      {
        key: "--fresh",
        flag: "--fresh",
        label: "Rebuild Stems (--fresh)",
        type: "boolean",
        tier: "common",
      },
      {
        key: "--sheet",
        flag: "--sheet",
        label: "Render Earshot Sheet",
        type: "boolean",
        tier: "common",
      },
    ],
    meta: {
      effect: "write",
      cost: "free",
      speed: "long",
      cancellable: true,
      helpMode: "flag",
      outputsHint: "Writes renders/listen.json (and renders/listen_sheet.png with --sheet)",
    },
  },
  {
    id: "earshot",
    label: "earshot",
    category: "sound",
    summary: "AI audio analysis, reference matching, sound bank synthesis, and critique CLI.",
    runner: "earshot",
    target: "earshot",
    cwdModes: ["film", "root"],
    subcommandRequired: true,
    meta: {
      effect: "read",
      cost: "free",
      speed: "short",
      cancellable: true,
      helpMode: "flag",
    },
    subcommands: [
      {
        id: "describe",
        label: "describe",
        summary: "Analyze an audio or video file and describe the sounds it contains.",
        args: [
          {
            key: "path",
            label: "Audio or video file",
            type: "string",
            required: true,
            choiceSource: "renders",
            placeholder: "Example: sound/mix.wav",
            hint: "Start from this project folder, or enter an absolute path.",
          },
        ],
        flags: [
          ...earshotTrim(),
          {
            key: "--top",
            flag: "--top",
            label: "Number of sound tags",
            type: "number",
            placeholder: "8",
            hint: "Maximum number of matching sound labels. Default: 8.",
            tier: "common",
          },
          ...earshotStd(),
        ],
      },
      {
        id: "match",
        label: "match",
        summary: "Score how well a sound matches text description(s) (calibrated z + verdict).",
        args: [
          {
            key: "path",
            label: "Audio / Video File",
            type: "string",
            required: true,
            choiceSource: "renders",
          },
          {
            key: "query",
            label: "Description(s)",
            type: "string",
            required: true,
            multi: true,
            placeholder: "heavy steel door slam",
          },
        ],
        flags: [
          {
            key: "--alts",
            flag: "--alts",
            label: "Alternative Descriptions",
            type: "string",
            multi: true,
            multiStyle: "args",
            tier: "common",
          },
          ...earshotTrim(),
          ...earshotStd(),
        ],
      },
      {
        id: "rank",
        label: "rank",
        summary: "Rank multiple audio files/folders/globs by how well they match a description.",
        args: [
          { key: "query", label: "Query Description", type: "string", required: true },
          {
            key: "paths",
            label: "Files / Folders / Globs",
            type: "string",
            required: true,
            multi: true,
            placeholder: "sound/sfx/*.wav",
          },
        ],
        flags: [
          { key: "--top", flag: "--top", label: "Top N", type: "number", tier: "common" },
          ...earshotStd(),
        ],
      },
      {
        id: "find",
        label: "find",
        summary: "Find best moments inside a long recording matching a query.",
        args: [
          { key: "path", label: "Audio File", type: "string", required: true },
          { key: "query", label: "Description", type: "string", required: true },
        ],
        flags: [
          {
            key: "--top",
            flag: "--top",
            label: "Segments (Top)",
            type: "number",
            placeholder: "5",
            tier: "common",
          },
          {
            key: "--kind",
            flag: "--kind",
            label: "Mode",
            type: "enum",
            options: ["auto", "event", "texture"],
            tier: "common",
          },
          { key: "--win", flag: "--win", label: "Window (s)", type: "number", tier: "advanced" },
          { key: "--hop", flag: "--hop", label: "Hop (s)", type: "number", tier: "advanced" },
          ...earshotTrim(),
          ...earshotStd(),
        ],
      },
      {
        id: "compare",
        label: "compare",
        summary: "Compare sound against nearest reference recordings.",
        args: [{ key: "path", label: "Audio File", type: "string", required: true }],
        flags: [
          {
            key: "--refs",
            flag: "--refs",
            label: "Reference Paths",
            type: "string",
            required: true,
            multi: true,
            multiStyle: "args",
            tier: "common",
          },
          {
            key: "-k",
            flag: "-k",
            label: "Nearest Count (-k)",
            type: "number",
            placeholder: "5",
            tier: "common",
          },
          ...earshotTrim(),
          ...earshotStd(),
        ],
      },
      {
        id: "ab",
        label: "ab",
        summary: "A/B compare two sounds (or trims) against query/refs.",
        args: [
          { key: "a", label: "Sound A", type: "string", required: true },
          { key: "b", label: "Sound B", type: "string", required: true },
        ],
        flags: [
          { key: "--query", flag: "--query", label: "Description", type: "string", tier: "common" },
          {
            key: "--refs",
            flag: "--refs",
            label: "Refs",
            type: "string",
            multi: true,
            multiStyle: "args",
            tier: "common",
          },
          {
            key: "--a-start",
            flag: "--a-start",
            label: "A Start (s)",
            type: "number",
            tier: "advanced",
          },
          { key: "--a-end", flag: "--a-end", label: "A End (s)", type: "number", tier: "advanced" },
          {
            key: "--b-start",
            flag: "--b-start",
            label: "B Start (s)",
            type: "number",
            tier: "advanced",
          },
          { key: "--b-end", flag: "--b-end", label: "B End (s)", type: "number", tier: "advanced" },
          ...earshotStd(),
        ],
      },
      {
        id: "realness",
        label: "realness",
        summary: "Score real recording / pro production vs code-synthesized audio.",
        args: [
          { key: "paths", label: "Files / Folders", type: "string", required: true, multi: true },
        ],
        flags: [
          ...earshotTrim(),
          {
            key: "--ast",
            flag: "--ast",
            label: "AudioSet Tagger",
            type: "boolean",
            tier: "common",
          },
          ...earshotStd(),
        ],
      },
      {
        id: "timeline",
        label: "timeline",
        summary: "Analyze a soundtrack or film: events, sections, loudness, beats, and cut sync.",
        args: [
          {
            key: "file",
            label: "Audio / Video",
            type: "string",
            required: true,
            choiceSource: "renders",
            placeholder: "renders/draft.mp4",
          },
        ],
        flags: [
          ...earshotCuesFlags(),
          {
            key: "--fresh",
            flag: "--fresh",
            label: "Recompute (--fresh)",
            type: "boolean",
            tier: "common",
          },
          ...earshotStd(),
        ],
        meta: { speed: "long" },
      },
      {
        id: "sheet",
        label: "sheet",
        summary: "Render annotated PNG sheet (frames, spectrogram, events, loudness, sync).",
        args: [
          {
            key: "file",
            label: "Audio / Video",
            type: "string",
            required: true,
            choiceSource: "renders",
          },
        ],
        flags: [
          {
            key: "-o",
            flag: "-o",
            label: "Output PNG",
            type: "string",
            tier: "common",
            placeholder: "renders/earshot_sheet.png",
          },
          ...earshotCuesFlags(),
          {
            key: "--width",
            flag: "--width",
            label: "Width (1000-2400)",
            type: "number",
            tier: "advanced",
            placeholder: "1800",
          },
          ...earshotStd(),
        ],
        meta: { effect: "write", speed: "long" },
      },
      {
        id: "critique",
        label: "critique",
        summary:
          "Score a soundtrack/film against professional reference films with timestamped fixes.",
        args: [
          {
            key: "file",
            label: "Soundtrack / Film",
            type: "string",
            required: true,
            choiceSource: "renders",
          },
        ],
        flags: [
          {
            key: "--video",
            flag: "--video",
            label: "Picture Video",
            type: "string",
            choiceSource: "renders",
            tier: "common",
          },
          {
            key: "--profile",
            flag: "--profile",
            label: "Profile JSON",
            type: "string",
            tier: "common",
          },
          {
            key: "--fast",
            flag: "--fast",
            label: "Skip AudioSet & Realness",
            type: "boolean",
            tier: "common",
          },
          ...earshotStd(),
        ],
      },
      {
        id: "profile",
        label: "profile",
        summary: "Build a launch-sound reference profile JSON from reference videos/soundtracks.",
        args: [
          {
            key: "refs",
            label: "Ref Files / Folders",
            type: "string",
            required: true,
            multi: true,
          },
        ],
        flags: [
          {
            key: "-o",
            flag: "-o",
            label: "Profile JSON",
            type: "string",
            tier: "common",
            placeholder: "profile.json",
          },
          {
            key: "--styles",
            flag: "--styles",
            label: "Styles JSON",
            type: "string",
            tier: "advanced",
          },
          {
            key: "--no-ast",
            flag: "--no-ast",
            label: "Skip AudioSet",
            type: "boolean",
            tier: "common",
          },
          ...earshotStd(),
        ],
        meta: { effect: "write", speed: "long" },
      },
      {
        id: "forge",
        label: "forge",
        summary: "Synthesize sounds in code and optimize via critic/search (omit recipe to list).",
        args: [{ key: "recipe", label: "Recipe Name", type: "string" }],
        flags: [
          { key: "--list", flag: "--list", label: "List Recipes", type: "boolean", tier: "common" },
          {
            key: "--render",
            flag: "--render",
            label: "Render Params",
            type: "string",
            optionalValue: true,
            bareLabel: "(bare flag — render Recipe positional without searching)",
            bareHint:
              "Leave empty to render the Recipe argument with --params without searching, or enter a recipe name.",
            tier: "common",
          },
          {
            key: "--params",
            flag: "--params",
            label: "Params JSON",
            type: "string",
            tier: "advanced",
          },
          {
            key: "--check",
            flag: "--check",
            label: "Check Out Dirs",
            type: "string",
            multi: true,
            multiStyle: "args",
            tier: "advanced",
          },
          {
            key: "--seeds",
            flag: "--seeds",
            label: "Seeds",
            type: "string",
            optionalValue: true,
            bareLabel: "(bare flag — use each pick's seed, else 0)",
            bareHint:
              "Leave empty to use default noise seeds (each pick's own, else 0), or add seed values.",
            multi: true,
            multiStyle: "args",
            tier: "advanced",
          },
          {
            key: "--target",
            flag: "--target",
            label: "Target Description",
            type: "string",
            tier: "common",
          },
          {
            key: "--alts",
            flag: "--alts",
            label: "Alts",
            type: "string",
            multi: true,
            multiStyle: "args",
            tier: "advanced",
          },
          {
            key: "--refs",
            flag: "--refs",
            label: "Refs",
            type: "string",
            multi: true,
            multiStyle: "args",
            tier: "advanced",
          },
          {
            key: "--refset",
            flag: "--refset",
            label: "Refset Category",
            type: "string",
            tier: "advanced",
          },
          {
            key: "--budget",
            flag: "--budget",
            label: "Budget",
            type: "number",
            placeholder: "160",
            tier: "advanced",
          },
          { key: "--pop", flag: "--pop", label: "Pop", type: "number", tier: "advanced" },
          {
            key: "--variants",
            flag: "--variants",
            label: "Keep Variants",
            type: "number",
            tier: "advanced",
          },
          { key: "--seed", flag: "--seed", label: "Seed", type: "number", tier: "advanced" },
          { key: "--dir", flag: "--dir", label: "Output Dir", type: "string", tier: "common" },
          {
            key: "--strategy",
            flag: "--strategy",
            label: "Strategy",
            type: "enum",
            options: ["es", "cma"],
            tier: "advanced",
          },
          {
            key: "--prescreen",
            flag: "--prescreen",
            label: "Prescreen",
            type: "number",
            tier: "advanced",
          },
          {
            key: "--robust",
            flag: "--robust",
            label: "Robust Seeds",
            type: "number",
            tier: "advanced",
          },
          {
            key: "--shortlist",
            flag: "--shortlist",
            label: "Shortlist",
            type: "number",
            tier: "advanced",
          },
          {
            key: "--no-bank",
            flag: "--no-bank",
            label: "No Seed Bank",
            type: "boolean",
            tier: "advanced",
          },
          {
            key: "--workers",
            flag: "--workers",
            label: "Workers",
            type: "number",
            tier: "advanced",
          },
          { key: "--tone", flag: "--tone", label: "Tone Weight", type: "number", tier: "advanced" },
          {
            key: "--mode",
            flag: "--mode",
            label: "Critic Mode",
            type: "enum",
            options: ["auto", "real", "designed"],
            tier: "advanced",
          },
          { key: "--reps", flag: "--reps", label: "Reps", type: "number", tier: "advanced" },
          {
            key: "--tone-target",
            flag: "--tone-target",
            label: "Tone Target",
            type: "number",
            tier: "advanced",
          },
          ...earshotStd(),
        ],
        meta: { effect: "write", speed: "long" },
      },
      {
        id: "fit",
        label: "fit",
        summary: "Fit a synthesis recipe to a real recording (analysis by synthesis).",
        args: [{ key: "file", label: "Recording File", type: "string" }],
        flags: [
          { key: "-o", flag: "-o", label: "Output Recipe (.py)", type: "string", tier: "common" },
          { key: "--dir", flag: "--dir", label: "Output Dir", type: "string", tier: "common" },
          {
            key: "--kind",
            flag: "--kind",
            label: "Fit Kind",
            type: "enum",
            options: ["auto", "modal", "spectral", "sines", "gesture", "hybrid"],
            tier: "common",
          },
          {
            key: "--layers",
            flag: "--layers",
            label: "Hybrid Layers",
            type: "string",
            tier: "advanced",
            placeholder: "modal,spectral",
          },
          {
            key: "--render",
            flag: "--render",
            label: "Resynth WAV",
            type: "string",
            tier: "advanced",
          },
          {
            key: "--report",
            flag: "--report",
            label: "Write Report JSON",
            type: "boolean",
            tier: "common",
          },
          {
            key: "--clap",
            flag: "--clap",
            label: "Use CLAP Score",
            type: "boolean",
            tier: "advanced",
          },
          {
            key: "--describe",
            flag: "--describe",
            label: "Run Describe",
            type: "boolean",
            tier: "advanced",
          },
          {
            key: "--target",
            flag: "--target",
            label: "Target Desc",
            type: "string",
            tier: "advanced",
          },
          { key: "--seed", flag: "--seed", label: "Seed", type: "number", tier: "advanced" },
          { key: "--fast", flag: "--fast", label: "Fast Preview", type: "boolean", tier: "common" },
          {
            key: "--takes",
            flag: "--takes",
            label: "Multi-Seed Takes",
            type: "boolean",
            tier: "advanced",
          },
          {
            key: "--keep-bed",
            flag: "--keep-bed",
            label: "Keep Pre-Roll Bed",
            type: "boolean",
            tier: "advanced",
          },
          {
            key: "--morph",
            flag: "--morph",
            label: "Morph A B",
            type: "string",
            multi: true,
            multiStyle: "args",
            tier: "advanced",
          },
          {
            key: "--amount",
            flag: "--amount",
            label: "Morph Amount",
            type: "number",
            tier: "advanced",
          },
          {
            key: "--forge",
            flag: "--forge",
            label: "Forge Variations",
            type: "string",
            tier: "advanced",
          },
          {
            key: "--budget",
            flag: "--budget",
            label: "Forge Budget",
            type: "number",
            tier: "advanced",
          },
          { key: "--pop", flag: "--pop", label: "Forge Pop", type: "number", tier: "advanced" },
          {
            key: "--variants",
            flag: "--variants",
            label: "Forge Variants",
            type: "number",
            tier: "advanced",
          },
          {
            key: "--refset",
            flag: "--refset",
            label: "Forge Refset",
            type: "string",
            tier: "advanced",
          },
          { key: "--quiet", flag: "--quiet", label: "Quiet", type: "boolean", tier: "advanced" },
          ...earshotStd(),
        ],
        meta: { effect: "write", speed: "long" },
      },
      {
        id: "sfx",
        label: "sfx",
        summary: "List, render, or audit shipped bank SFX sounds (model-free).",
        subcommandRequired: true,
        subcommands: [
          {
            id: "list",
            label: "list",
            summary: "List shipped SFX bank ids, lengths, peak times, cue kinds, and knobs.",
            flags: [
              {
                key: "--category",
                flag: "--category",
                label: "Category",
                type: "string",
                tier: "common",
                placeholder: "whoosh_fast",
              },
              {
                key: "--kind",
                flag: "--kind",
                label: "Cue Kind / Role",
                type: "string",
                tier: "common",
                placeholder: "whoosh",
              },
              ...earshotStd(),
            ],
            meta: { effect: "read", speed: "instant" },
          },
          {
            id: "render",
            label: "render",
            summary: "Render one shipped bank sound take to a 24-bit WAV.",
            args: [
              {
                key: "sound",
                label: "Sound ID",
                type: "string",
                required: true,
                placeholder: "whoosh_fast/crisp",
              },
            ],
            flags: [
              {
                key: "-o",
                flag: "-o",
                label: "Output WAV",
                type: "string",
                required: true,
                tier: "common",
                placeholder: "out.wav",
              },
              { key: "--seed", flag: "--seed", label: "Seed", type: "number", tier: "common" },
              {
                key: "--dur",
                flag: "--dur",
                label: "Exact Dur (s)",
                type: "number",
                tier: "common",
              },
              {
                key: "--apex",
                flag: "--apex",
                label: "Apex (s)",
                type: "number",
                tier: "advanced",
              },
              {
                key: "--pitch",
                flag: "--pitch",
                label: "Pitch (note/Hz)",
                type: "string",
                tier: "advanced",
                placeholder: "E5",
              },
              {
                key: "--peak",
                flag: "--peak",
                label: "Peak dBFS",
                type: "number",
                tier: "advanced",
                placeholder: "-1",
              },
              {
                key: "--weight",
                flag: "--weight",
                label: "Weight",
                type: "number",
                tier: "advanced",
              },
              {
                key: "--sr",
                flag: "--sr",
                label: "Sample Rate",
                type: "enum",
                options: ["44100", "48000", "88200", "96000"],
                tier: "advanced",
              },
              ...earshotStd(),
            ],
            meta: { effect: "write", speed: "instant" },
          },
          {
            id: "check",
            label: "check",
            summary:
              "Model-free audit of SFX WAV files for clicks, clipping, DC, truncation, or ring.",
            args: [
              { key: "files", label: "WAV File(s)", type: "string", required: true, multi: true },
            ],
            flags: [
              {
                key: "--category",
                flag: "--category",
                label: "Category",
                type: "string",
                tier: "common",
              },
              { key: "--role", flag: "--role", label: "Kit Role", type: "string", tier: "common" },
              ...earshotStd(),
            ],
            meta: { effect: "read", speed: "instant" },
          },
        ],
      },
      {
        id: "kit",
        label: "kit",
        summary: "Manage film sound kits: init preset, render cached takes, validate, or audition.",
        subcommandRequired: true,
        subcommands: [
          {
            id: "init",
            label: "init",
            summary: "Write a preset sound kit file.",
            flags: [
              {
                key: "--preset",
                flag: "--preset",
                label: "Preset",
                type: "enum",
                options: ["calm", "crisp", "minimal", "launch"],
                tier: "common",
              },
              {
                key: "-o",
                flag: "-o",
                label: "Output File",
                type: "string",
                tier: "common",
                placeholder: "kit.json",
              },
              {
                key: "--force",
                flag: "--force",
                label: "Overwrite (--force)",
                type: "boolean",
                requiresConfirmIfSet: true,
                tier: "common",
              },
              ...earshotStd(),
            ],
            meta: {
              effect: "write",
              speed: "instant",
              confirm: {
                mode: "when-flagged",
                message: "--force overwrites an existing kit file.",
              },
            },
          },
          {
            id: "render",
            label: "render",
            summary: "Render every take in a kit (cached) and write kit.lock.json.",
            args: [
              {
                key: "kit",
                label: "Kit File",
                type: "string",
                required: true,
                placeholder: "kit.json",
              },
            ],
            flags: [
              {
                key: "--out",
                flag: "--out",
                label: "Takes Folder",
                type: "string",
                required: true,
                tier: "common",
                placeholder: "sound/takes",
              },
              {
                key: "--force",
                flag: "--force",
                label: "Re-render All (--force)",
                type: "boolean",
                tier: "common",
              },
              ...earshotStd(false),
            ],
            meta: { effect: "write", speed: "short" },
          },
          {
            id: "check",
            label: "check",
            summary: "Validate kit schema and run model-free audit on every take.",
            args: [
              {
                key: "kit",
                label: "Kit File",
                type: "string",
                required: true,
                placeholder: "kit.json",
              },
            ],
            flags: [
              {
                key: "--out",
                flag: "--out",
                label: "Takes Folder",
                type: "string",
                tier: "common",
              },
              ...earshotStd(false),
            ],
            meta: { effect: "read", speed: "short" },
          },
          {
            id: "audition",
            label: "audition",
            summary: "Render every kit take in role order into one audition WAV + index .txt.",
            args: [
              {
                key: "kit",
                label: "Kit File",
                type: "string",
                required: true,
                placeholder: "kit.json",
              },
            ],
            flags: [
              {
                key: "-o",
                flag: "-o",
                label: "Output WAV",
                type: "string",
                required: true,
                tier: "common",
                placeholder: "audition.wav",
              },
              {
                key: "--out",
                flag: "--out",
                label: "Takes Folder",
                type: "string",
                tier: "advanced",
              },
              ...earshotStd(false),
            ],
            meta: { effect: "write", speed: "short" },
          },
        ],
      },
      {
        id: "gallery",
        label: "gallery",
        summary: "Generate static HTML forge comparison gallery.",
        args: [{ key: "folder", label: "Forge Folder", type: "string" }],
        flags: [
          {
            key: "-o",
            flag: "-o",
            label: "Output HTML",
            type: "string",
            tier: "common",
            placeholder: "gallery.html",
          },
          {
            key: "--results",
            flag: "--results",
            label: "Benchmark Results",
            type: "string",
            multi: true,
            multiStyle: "args",
            tier: "advanced",
          },
          {
            key: "--refs",
            flag: "--refs",
            label: "Refs (forge|DIR)",
            type: "string",
            tier: "advanced",
          },
          {
            key: "--compare",
            flag: "--compare",
            label: "Compare Globs",
            type: "string",
            multi: true,
            multiStyle: "args",
            tier: "advanced",
          },
          { key: "--sub", flag: "--sub", label: "Subfolder", type: "string", tier: "advanced" },
          {
            key: "--alias",
            flag: "--alias",
            label: "Aliases",
            type: "string",
            multi: true,
            multiStyle: "args",
            tier: "advanced",
          },
          {
            key: "--embed",
            flag: "--embed",
            label: "Embed Base64",
            type: "boolean",
            tier: "common",
          },
          {
            key: "--embed-compressed",
            flag: "--embed-compressed",
            label: "Embed Compressed",
            type: "boolean",
            tier: "common",
          },
          {
            key: "--embed-codec",
            flag: "--embed-codec",
            label: "Embed Codec",
            type: "enum",
            options: ["flac", "wav", "mp3", "opus", "vorbis"],
            tier: "advanced",
          },
          {
            key: "--kbps",
            flag: "--kbps",
            label: "Bitrate kbps",
            type: "number",
            tier: "advanced",
          },
          {
            key: "--max-mb",
            flag: "--max-mb",
            label: "Max MB Warn",
            type: "number",
            tier: "advanced",
          },
          { key: "--title", flag: "--title", label: "Title", type: "string", tier: "common" },
          {
            key: "--max-refs",
            flag: "--max-refs",
            label: "Max Refs",
            type: "number",
            tier: "advanced",
          },
          ...earshotStd(),
        ],
        meta: { effect: "write", speed: "short" },
      },
      {
        id: "measure",
        label: "measure",
        summary:
          "Objective audio measurements only (loudness, peaks, envelope, spectrum; no ML models).",
        args: [
          { key: "files", label: "Audio File(s)", type: "string", required: true, multi: true },
        ],
        flags: [
          {
            key: "--music",
            flag: "--music",
            label: "Tempo / Beats / Key",
            type: "boolean",
            tier: "common",
          },
          {
            key: "--light",
            flag: "--light",
            label: "Skip Slow Passes",
            type: "boolean",
            tier: "common",
          },
          ...earshotTrim(),
          ...earshotStd(),
        ],
        meta: { effect: "read", speed: "instant" },
      },
      {
        id: "llm",
        label: "llm",
        summary:
          "Optional Gemini audio critique (uploads audio ONLY with --yes-upload + Gemini key).",
        args: [
          {
            key: "file",
            label: "Audio / Video File",
            type: "string",
            required: true,
            choiceSource: "renders",
          },
        ],
        flags: [
          {
            key: "--yes-upload",
            flag: "--yes-upload",
            label: "Consent Audio Upload",
            type: "boolean",
            required: true,
            requiresConfirmIfSet: true,
            tier: "common",
          },
          {
            key: "--prompt",
            flag: "--prompt",
            label: "Extra Prompt",
            type: "string",
            tier: "common",
          },
          {
            key: "--model",
            flag: "--model",
            label: "Gemini Model",
            type: "string",
            tier: "advanced",
            placeholder: "gemini-3.8-flash",
          },
          {
            key: "--video",
            flag: "--video",
            label: "Film Video (Cuts Only)",
            type: "string",
            choiceSource: "renders",
            tier: "advanced",
          },
          {
            key: "--with-timeline",
            flag: "--with-timeline",
            label: "Include Timeline",
            type: "boolean",
            tier: "advanced",
          },
          {
            key: "--no-cuts",
            flag: "--no-cuts",
            label: "Skip Cut Detection",
            type: "boolean",
            tier: "advanced",
          },
          { key: "--start", flag: "--start", label: "Start (s)", type: "number", tier: "advanced" },
          { key: "--end", flag: "--end", label: "End (s)", type: "number", tier: "advanced" },
          {
            key: "--max-seconds",
            flag: "--max-seconds",
            label: "Max Seconds",
            type: "number",
            placeholder: "600",
            tier: "advanced",
          },
          {
            key: "--synth-intended",
            flag: "--synth-intended",
            label: "Synth Audio Intended",
            type: "boolean",
            tier: "advanced",
          },
          ...earshotStd(),
        ],
        meta: {
          effect: "read",
          cost: "paid",
          costHint: "Uploads audio to Google Gemini API (GEMINI_API_KEY or GOOGLE_API_KEY).",
          speed: "short",
          envAnyOf: [["GEMINI_API_KEY", "GOOGLE_API_KEY"]],
          confirm: {
            mode: "when-flagged",
            message: "This uploads film/audio to Google Gemini (--yes-upload) and uses API quota.",
          },
        },
      },
      {
        id: "mcp",
        label: "mcp",
        summary:
          "Inspect earshot MCP tools (--tools); stdio server mode is guarded in Live Studio.",
        flags: [
          {
            key: "--tools",
            flag: "--tools",
            label: "List MCP Tools Only",
            type: "boolean",
            tier: "common",
            hint: "Safe one-shot inspection without starting stdio server",
          },
          {
            key: "--warm",
            flag: "--warm",
            label: "Warm Models",
            type: "boolean",
            tier: "advanced",
          },
          ...earshotStd(),
        ],
        meta: {
          effect: "daemon",
          speed: "instant",
          guard: {
            disabledWhenToolsUnset: true,
            reason:
              "MCP stdio server waits forever for JSON-RPC stdin; enable --tools to list available tools.",
          },
        },
      },
      {
        id: "doctor",
        label: "doctor",
        summary: "Verify earshot install, models, CPU threads, or fetch pinned model files.",
        flags: [
          {
            key: "--load",
            flag: "--load",
            label: "Load & Time Models",
            type: "boolean",
            tier: "common",
          },
          {
            key: "--fetch",
            flag: "--fetch",
            label: "Download ~1.1 GB Models",
            type: "boolean",
            requiresConfirmIfSet: true,
            tier: "common",
          },
          ...earshotStd(),
        ],
        meta: {
          effect: "read",
          speed: "short",
          confirm: {
            mode: "when-flagged",
            message: "--fetch downloads ~1.1 GB of pinned earshot model weights.",
          },
        },
      },
    ],
  },
  {
    id: "sound:render-earshot-bank",
    label: "sound:render-earshot-bank",
    category: "sound",
    summary:
      "Render Earshot's 252 DSP sound-bank recipes into vault/sound/sfx/<category>/*.wav (48 kHz PCM16).",
    runner: "python-file",
    target: "scripts/render_earshot_bank.py",
    cwdModes: ["root"],
    args: [
      {
        key: "earshotDir",
        label: "Earshot Repo Dir",
        type: "string",
        required: true,
        placeholder: "../earshot",
      },
      {
        key: "vaultSoundDir",
        label: "Vault Sound Dir",
        type: "string",
        required: true,
        placeholder: "vault/sound",
      },
    ],
    meta: {
      effect: "write",
      cost: "free",
      speed: "short",
      cancellable: true,
      helpMode: "none",
      confirm: {
        mode: "always",
        message: "Renders Earshot's 252 DSP bank WAVs into <vaultSoundDir>/sfx/<category>/.",
      },
      outputsHint: "Prints JSON render counts + sources map and writes vault/sound/sfx/*.wav",
    },
  },
  {
    id: "sound:mc-peaks",
    label: "sound:mc-peaks",
    category: "sound",
    summary:
      "Batch-compute duration and 50 Hz waveform peak envelopes into PEAKS.json (scripts/compute_mc_peaks.py).",
    runner: "python-file",
    target: "scripts/compute_mc_peaks.py",
    cwdModes: ["root"],
    args: [
      {
        key: "vaultDir",
        label: "Vault Directory",
        type: "string",
        required: true,
        placeholder: "vault/sound",
      },
    ],
    meta: {
      effect: "write",
      cost: "free",
      speed: "short",
      cancellable: true,
      helpMode: "none",
      outputsHint: "Writes <vaultDir>/PEAKS.json and .peaks-cache.json",
    },
  },

  // ── RENDER & QA REVIEW ───────────────────────────────────────────────────────────────────────────
  {
    id: "render",
    label: "render",
    category: "render",
    summary:
      "Render draft stills, video chunks, captions, lossless poster, final upload, or motion/text checks.",
    runner: "bun-script",
    target: "render",
    cwdModes: ["film"],
    args: [
      {
        key: "target",
        label: "Render Target",
        type: "enum",
        required: true,
        options: renderTargetValues,
        default: "stills",
      },
    ],
    env: [
      {
        key: "AT",
        label: "AT (Heard Seconds)",
        type: "string",
        visibleWhen: { field: "target", in: ["stills", "poster", "all"] },
        requiredWhen: { field: "target", in: ["poster"] },
        tier: "common",
        placeholder: "12,30.5",
        hint: "Comma-separated heard seconds (e.g. 40,41.5 or 0:40,0:41.5)",
      },
      {
        key: "LIST",
        label: "LIST=1 (Describe Overlay)",
        type: "boolean",
        visibleWhen: { field: "target", in: ["stills", "all"] },
        tier: "common",
        hint: "Draw scene description HUD on stills (leave off before framecheck)",
      },
      {
        key: "SPAN",
        label: "SPAN (from,to sec)",
        type: "string",
        exclusiveGroup: "render-slice",
        visibleWhen: { field: "target", in: ["clip"] },
        tier: "common",
        placeholder: "40,44",
      },
      {
        key: "CHUNKS",
        label: "CHUNKS (0-based idx)",
        type: "string",
        exclusiveGroup: "render-slice",
        visibleWhen: { field: "target", in: ["clip", "all", "final"] },
        tier: "common",
        placeholder: "3,4",
      },
      {
        key: "CHECK",
        label: "CHECK (motion/seen/touch/text)",
        type: "string",
        visibleWhen: { field: "target", in: ["stills", "all"] },
        tier: "common",
        placeholder: "motion:cam,81,83 or text",
      },
      {
        key: "SAMPLES",
        label: "SAMPLES (1-64 sub-frames)",
        type: "number",
        visibleWhen: { field: "target", in: ["clip", "final", "poster", "all"] },
        tier: "advanced",
        placeholder: "8",
      },
      {
        key: "RES",
        label: "RES (Height Lines)",
        type: "enum",
        options: ["1080", "1440", "2160"],
        visibleWhen: { field: "target", in: ["final", "poster"] },
        tier: "advanced",
      },
      {
        key: "INSPECT",
        label: "INSPECT (px,py,pz,lx,ly,lz,fov)",
        type: "string",
        visibleWhen: { field: "target", in: ["stills", "all"] },
        tier: "advanced",
        placeholder: "0,2,5,0,1,0,50",
      },
      {
        key: "ENTRY",
        label: "ENTRY (Custom Lab Page)",
        type: "string",
        choiceSource: "labs",
        visibleWhen: { field: "target", in: ["stills", "clip", "poster", "all", "final"] },
        tier: "advanced",
        placeholder: "lab/prop.ts",
      },
      {
        key: "LAB_VIEW",
        label: "LAB_VIEW",
        type: "string",
        visibleWhen: { field: "target", in: ["stills", "clip", "poster", "all", "final"] },
        tier: "advanced",
        placeholder: "desk",
      },
    ],
    meta: {
      effect: "write",
      cost: "free",
      speed: "long",
      cancellable: true,
      helpMode: "flag",
      confirm: {
        mode: "when-flagged",
        whenArgIn: { key: "target", values: ["final"] },
        message:
          "render final runs a slow 1440p/2160p production encode on GPU (run only when requested).",
      },
      outputsHint:
        "Writes into renders/ inside target film (stills, chunks, draft_video.mp4, or final_video.mp4)",
    },
  },
  {
    id: "sheet",
    label: "sheet",
    category: "render",
    summary:
      "Build 3x2 contact sheets from rendered stills, video seconds, shot midpoints, or one cut.",
    runner: "bun-script",
    target: "sheet",
    cwdModes: ["film"],
    args: [
      {
        key: "video",
        label: "Video (Omit = Still PNGs)",
        type: "string",
        choiceSource: "renders",
        placeholder: "renders/draft_video.mp4",
      },
      {
        key: "target",
        label: "Times / shots / cut",
        type: "string",
        requiredWhen: { field: "video", nonEmpty: true },
        placeholder: "10,20,30 or shots or cut",
      },
      {
        key: "cutIndex",
        label: "Cut # (with 'cut')",
        type: "number",
        visibleWhen: { field: "target", in: ["cut"] },
        requiredWhen: { field: "target", in: ["cut"] },
        placeholder: "4",
      },
    ],
    env: [
      {
        key: "START",
        label: "START (Video Start Sec)",
        type: "string",
        tier: "advanced",
        placeholder: "60",
      },
    ],
    meta: {
      effect: "write",
      cost: "free",
      speed: "short",
      cancellable: true,
      helpMode: "flag",
      outputsHint: "Writes renders/sheet_*.jpg",
    },
  },
  {
    id: "scenes",
    label: "scenes",
    category: "render",
    summary:
      "Suggest scene boundaries in local footage with optional CPU PySceneDetect; input-file seconds.",
    runner: "bun-script",
    target: "scenes",
    cwdModes: ["root", "film"],
    args: [
      {
        key: "video",
        label: "Local Video",
        type: "string",
        required: true,
        placeholder: "reference.mp4",
      },
    ],
    flags: [
      {
        key: "--method",
        flag: "--method",
        label: "Detector",
        type: "enum",
        options: ["adaptive", "content", "threshold"],
        default: "adaptive",
      },
      {
        key: "--threshold",
        flag: "--threshold",
        label: "Detector Threshold",
        type: "number",
        tier: "advanced",
      },
      {
        key: "--from",
        flag: "--from",
        label: "From File Second",
        type: "string",
        placeholder: "0:10",
      },
      { key: "--to", flag: "--to", label: "To File Second", type: "string", placeholder: "0:30" },
      {
        key: "--min-scene",
        flag: "--min-scene",
        label: "Minimum Scene (s)",
        type: "number",
        placeholder: "0.6",
        tier: "advanced",
      },
      {
        key: "--minutes",
        flag: "--minutes",
        label: "Detector Deadline (min, max 60)",
        type: "number",
        placeholder: "5",
        tier: "advanced",
      },
      {
        key: "--out",
        flag: "--out",
        label: "Output Parent Folder",
        type: "string",
        placeholder: "renders/scenes",
      },
      {
        key: "--no-images",
        flag: "--no-images",
        label: "Skip Images and HTML",
        type: "boolean",
        tier: "advanced",
      },
    ],
    env: [
      {
        key: "SCENEDETECT_PYTHON",
        label: "Python with PySceneDetect",
        type: "string",
        tier: "advanced",
      },
    ],
    meta: {
      effect: "write",
      cost: "free",
      speed: "long",
      cancellable: true,
      helpMode: "flag",
      outputsHint:
        "Fresh run-* folder: result.json, scenes.csv, metrics.csv, detector.log; images and scenes.html by default. No film edits.",
    },
  },
  {
    id: "framecheck",
    label: "framecheck",
    category: "render",
    summary:
      "Audit encoded MP4 for black frames, flashes, jumps away from cuts, shimmer, and freezes.",
    runner: "bun-script",
    target: "framecheck",
    cwdModes: ["film"],
    args: [
      {
        key: "video",
        label: "Video Path (Default draft_video.mp4)",
        type: "string",
        choiceSource: "renders",
        placeholder: "renders/draft_video.mp4",
      },
    ],
    env: [
      {
        key: "START",
        label: "START (Video Start Sec)",
        type: "string",
        tier: "advanced",
        placeholder: "60",
      },
    ],
    meta: {
      effect: "write",
      cost: "free",
      speed: "short",
      cancellable: true,
      helpMode: "flag",
      outputsHint: "Writes renders/frames_<KIND>_<s>.jpg on detected faults",
    },
  },
  {
    id: "pace",
    label: "pace",
    category: "render",
    summary: "Measure shot durations and stagnant holds against narration words.",
    runner: "bun-script",
    target: "pace",
    cwdModes: ["film"],
    args: [
      {
        key: "video",
        label: "Video Path (Default draft_video.mp4)",
        type: "string",
        choiceSource: "renders",
        placeholder: "renders/draft_video.mp4",
      },
    ],
    flags: [
      {
        key: "--hold",
        flag: "--hold",
        label: "Hold Threshold (s)",
        type: "number",
        placeholder: "8",
        tier: "common",
      },
    ],
    meta: {
      effect: "read",
      cost: "free",
      speed: "short",
      cancellable: true,
      helpMode: "flag",
    },
  },
  {
    id: "deliver",
    label: "deliver",
    category: "render",
    summary:
      "Audit final upload against YouTube specs and optionally check AV1 re-encode banding (--youtube).",
    runner: "bun-script",
    target: "deliver",
    cwdModes: ["film"],
    args: [
      {
        key: "video",
        label: "Video Path (Default renders/final.mp4)",
        type: "string",
        choiceSource: "renders",
        placeholder: "renders/final.mp4",
      },
    ],
    flags: [
      {
        key: "--youtube",
        flag: "--youtube",
        label: "YouTube Banding Check",
        type: "string",
        optionalValue: true,
        bareLabel: "(bare flag — full-film AV1 check, ~3x duration)",
        bareHint: "Leave empty for full-film AV1 check (~3x duration), or enter seconds like 9-15.",
        tier: "common",
        placeholder: "9-15 (optional range)",
        hint: "Slow (~3x duration full film); pass seconds like 9-15 to test quickly",
      },
    ],
    meta: {
      effect: "read",
      cost: "free",
      speed: "short",
      cancellable: true,
      helpMode: "flag",
      outputsHint:
        "Exit 0 ready, 1 FIX issues; --youtube writes renders/youtube_preview.mp4 + PNGs",
    },
  },
  {
    id: "studio:stale",
    label: "studio:stale",
    category: "render",
    summary:
      "Check whether a rendered video is older than src/* files or moved narration clips (packages/live-studio/src/stale.mjs).",
    runner: "bun-file",
    target: "packages/live-studio/src/stale.mjs",
    cwdModes: ["film"],
    args: [
      {
        key: "video",
        label: "Video Path (Default renders/draft_video.mp4)",
        type: "string",
        choiceSource: "renders",
        placeholder: "renders/draft_video.mp4",
      },
    ],
    meta: {
      effect: "read",
      cost: "free",
      speed: "instant",
      cancellable: false,
      helpMode: "none",
    },
  },

  // ── SETUP & VAULTS ───────────────────────────────────────────────────────────────────────────────
  {
    id: "setup",
    label: "setup",
    category: "setup",
    summary: "Full machine bootstrap: bun install, setup:vault, and link.",
    runner: "bun-script",
    target: "setup",
    cwdModes: ["root"],
    flags: [
      {
        key: "--sound-zip",
        flag: "--sound-zip",
        label: "Sound Archive Zip / Link",
        type: "string",
        tier: "common",
        placeholder: "D:/mc-films-sound.zip",
      },
    ],
    meta: {
      effect: "install",
      cost: "free",
      speed: "long",
      cancellable: true,
      helpMode: "flag",
      confirm: {
        mode: "always",
        message: "Runs bun install, vault bootstrap downloads/builds, and film symlinks.",
      },
    },
  },
  {
    id: "setup:vault",
    label: "setup:vault",
    category: "setup",
    summary: "Populate the local runtime vault; raw downloads and backups use externalRoot.",
    runner: "bun-script",
    target: "setup:vault",
    cwdModes: ["root"],
    flags: [
      {
        key: "--sound-zip",
        flag: "--sound-zip",
        label: "Sound Archive Zip / Link",
        type: "string",
        tier: "common",
      },
    ],
    meta: {
      effect: "install",
      cost: "free",
      speed: "long",
      cancellable: true,
      helpMode: "flag",
      confirm: {
        mode: "always",
        message: "Downloads external assets and rebuilds vault directories.",
      },
    },
  },
  {
    id: "setup:sound",
    label: "setup:sound",
    category: "setup",
    summary: "Rebuild vault/sound/{bgm,sfx} WAVs (-1 dBFS) with SOURCES.json & PEAKS.json.",
    runner: "bun-script",
    target: "setup:sound",
    cwdModes: ["root"],
    meta: {
      effect: "write",
      cost: "free",
      speed: "long",
      cancellable: true,
      helpMode: "flag",
      confirm: {
        mode: "always",
        message: "Rebuilds and re-files vault/sound/ from downloaded sources.",
      },
    },
  },
  {
    id: "setup:mc-sound",
    label: "setup:mc-sound",
    category: "setup",
    summary: "Rebuild local vault/mc-sound/mc/<category>/*.ogg from Minecraft & licensed packs.",
    runner: "bun-script",
    target: "setup:mc-sound",
    cwdModes: ["root"],
    meta: {
      effect: "write",
      cost: "free",
      speed: "long",
      cancellable: true,
      helpMode: "flag",
      confirm: {
        mode: "always",
        message: "Rebuilds local vault/mc-sound from Minecraft & resource packs.",
      },
    },
  },
  {
    id: "setup:voices",
    label: "setup:voices",
    category: "setup",
    summary:
      "Sync shared English ElevenLabs/GenVoice voice catalog to vault/voices/shared-en.json.",
    runner: "bun-script",
    target: "setup:voices",
    cwdModes: ["root"],
    meta: {
      effect: "install",
      cost: "free",
      speed: "long",
      cancellable: true,
      helpMode: "flag",
      envAnyOf: [["GENVOICE_API_KEY", "ELEVENLABS_API_KEY"]],
      confirm: {
        mode: "always",
        message: "Fetches shared English voice metadata into vault/voices/shared-en.json.",
      },
    },
  },
  {
    id: "bake:physics",
    label: "bake:physics",
    category: "pipeline",
    summary: "Bake the Rapier wall demo's physics into its timeline; this film only.",
    runner: "bun-script",
    target: "bake:physics",
    cwdModes: ["film"],
    flags: [{ key: "--out", flag: "--out", label: "Output file", type: "string" }],
    meta: { effect: "write", cost: "free", speed: "short", cancellable: true, helpMode: "flag" },
  },
  {
    id: "fetch:sfx",
    label: "fetch:sfx",
    category: "setup",
    summary: "Download curated Mixkit SFX WAVs into local vault sfx/mixkit/.",
    runner: "bun-script",
    target: "fetch:sfx",
    cwdModes: ["root"],
    meta: {
      effect: "install",
      cost: "free",
      speed: "short",
      cancellable: true,
      helpMode: "flag",
      confirm: {
        mode: "always",
        message: "Downloads Mixkit SFX archive WAV files into local vault.",
      },
    },
  },
  {
    id: "fetch:sound-raw",
    label: "fetch:sound-raw",
    category: "setup",
    summary: "Download & checksum-verify raw sound packs (Kenney / Sonniss torrents via aria2c).",
    runner: "bun-script",
    target: "fetch:sound-raw",
    cwdModes: ["root"],
    meta: {
      effect: "install",
      cost: "free",
      speed: "long",
      cancellable: true,
      helpMode: "flag",
      confirm: {
        mode: "always",
        message: "Starts potentially multi-hour sound pack downloads (resumable).",
      },
    },
  },
  {
    id: "pack:sound",
    label: "pack:sound",
    category: "setup",
    summary: "Archive entire local + external sound vault into a single private zip.",
    runner: "bun-script",
    target: "pack:sound",
    cwdModes: ["root"],
    args: [
      {
        key: "out",
        label: "Output Zip Path (Optional)",
        type: "string",
        placeholder: "D:/sound.zip",
      },
    ],
    meta: {
      effect: "write",
      cost: "free",
      speed: "long",
      cancellable: true,
      helpMode: "flag",
      confirm: {
        mode: "always",
        message: "Packs full sound vault into a large private zip archive.",
      },
    },
  },
  {
    id: "new-film",
    label: "new-film",
    category: "setup",
    summary: "Scaffold films/<name> from templates/film, install links, and assign studio port.",
    runner: "bun-script",
    target: "new-film",
    cwdModes: ["root"],
    args: [
      {
        key: "name",
        label: "Film Name (kebab-case)",
        type: "string",
        required: true,
        placeholder: "cave-escape",
      },
      { key: "port", label: "Studio Port (1024-65535)", type: "number", placeholder: "47920" },
    ],
    meta: {
      effect: "write",
      cost: "free",
      speed: "short",
      cancellable: true,
      helpMode: "flag",
      confirm: {
        mode: "always",
        message: "Creates a new film folder in films/ and runs studio init + vault link.",
      },
    },
  },
  {
    id: "link",
    label: "link",
    category: "setup",
    summary: "Symlink vault assets into all films (or selected films) and build pack picks zips.",
    runner: "bun-script",
    target: "link",
    cwdModes: ["root"],
    args: [
      {
        key: "films",
        label: "Film(s) (Omit = All)",
        type: "string",
        multi: true,
        choiceSource: "films",
      },
    ],
    meta: {
      effect: "write",
      cost: "free",
      speed: "short",
      cancellable: true,
      helpMode: "flag",
      confirm: {
        mode: "always",
        message:
          "Copies real vault files into target film(s) assets/public and rebuilds picked.zip.",
      },
    },
  },
  {
    id: "postinstall",
    label: "postinstall",
    category: "setup",
    summary:
      "Film postinstall hook (mc-assets/vendor.mjs): vendors block textures/models into a film.",
    runner: "bun-script",
    target: "postinstall",
    cwdModes: ["film"],
    meta: {
      effect: "install",
      cost: "free",
      speed: "short",
      cancellable: true,
      helpMode: "none",
      confirm: {
        mode: "always",
        message: "Runs film postinstall asset vendoring (mc-assets/vendor.mjs).",
      },
    },
  },

  // ── REPO DEV & EVALS ─────────────────────────────────────────────────────────────────────────────
  {
    id: "studio",
    label: "studio",
    category: "dev",
    summary: "Launch a film's Live Studio dev server (guarded in Live Studio UI; --help is safe).",
    runner: "bun-script",
    target: "studio",
    cwdModes: ["film"],
    flags: [
      { key: "--lan", flag: "--lan", label: "Bind LAN (0.0.0.0)", type: "boolean", tier: "common" },
    ],
    meta: {
      effect: "daemon",
      cost: "free",
      speed: "long",
      cancellable: false,
      helpMode: "flag",
      guard: {
        disabled: true,
        reason: "Starts a long-lived Live Studio server; run from a terminal instead.",
      },
    },
  },
  {
    id: "test",
    label: "test",
    category: "dev",
    summary: "Run all monorepo Bun test suites (timeout 30s).",
    runner: "bun-script",
    target: "test",
    cwdModes: ["root"],
    args: [
      {
        key: "filter",
        label: "Test Pattern (Optional)",
        type: "string",
        multi: true,
        placeholder: "cli-catalog",
      },
    ],
    meta: {
      effect: "read",
      cost: "free",
      speed: "short",
      cancellable: true,
      helpMode: "flag",
    },
  },
  {
    id: "verify",
    label: "verify",
    category: "dev",
    summary: "Run root lint and typecheck in parallel.",
    runner: "bun-script",
    target: "verify",
    cwdModes: ["root"],
    meta: {
      effect: "read",
      cost: "free",
      speed: "short",
      cancellable: true,
      helpMode: "none",
    },
  },
  {
    id: "lint",
    label: "lint",
    category: "dev",
    summary: "Run oxlint on packages/ and scripts/.",
    runner: "bun-script",
    target: "lint",
    cwdModes: ["root"],
    meta: {
      effect: "read",
      cost: "free",
      speed: "short",
      cancellable: true,
      helpMode: "flag",
    },
  },
  {
    id: "typecheck",
    label: "typecheck",
    category: "dev",
    summary: "Run TypeScript check on root workspace and packages/live-studio.",
    runner: "bun-script",
    target: "typecheck",
    cwdModes: ["root"],
    meta: {
      effect: "read",
      cost: "free",
      speed: "short",
      cancellable: true,
      helpMode: "none",
    },
  },
  {
    id: "fmt",
    label: "fmt",
    category: "dev",
    summary:
      "Format ENTIRE repository (`bun fmt --no-script`). Prefer fmt:check or targeted formatting.",
    runner: "bun-script",
    target: "fmt",
    cwdModes: ["root"],
    meta: {
      effect: "destructive",
      cost: "free",
      speed: "instant",
      cancellable: false,
      helpMode: "flag",
      confirm: {
        mode: "always",
        message:
          "Repo-wide bun run fmt rewrites every file in the monorepo (may touch other active work).",
      },
    },
  },
  {
    id: "fmt:check",
    label: "fmt:check",
    category: "dev",
    summary: "Check repo formatting without writing files.",
    runner: "bun-script",
    target: "fmt:check",
    cwdModes: ["root"],
    meta: {
      effect: "read",
      cost: "free",
      speed: "instant",
      cancellable: true,
      helpMode: "flag",
    },
  },
  {
    id: "eval:find",
    label: "eval:find",
    category: "dev",
    summary: "Benchmark `find` against labeled test cases in scripts/evals/find/cases/.",
    runner: "bun-script",
    target: "eval:find",
    cwdModes: ["root"],
    flags: [
      {
        key: "--set",
        flag: "--set",
        label: "Case Set",
        type: "string",
        tier: "common",
        placeholder: "holdout-a",
      },
      {
        key: "--mode",
        flag: "--mode",
        label: "Mode",
        type: "enum",
        options: ["words", "jev", "both"],
        tier: "common",
      },
      { key: "--kind", flag: "--kind", label: "Filter Kind", type: "string", tier: "common" },
      { key: "--fresh", flag: "--fresh", label: "Restart Run", type: "boolean", tier: "common" },
      {
        key: "-j",
        flag: "-j",
        label: "Concurrency (-j)",
        type: "number",
        placeholder: "3",
        tier: "advanced",
      },
      {
        key: "--finish",
        flag: "--finish",
        label: "Score Stopped Run",
        type: "boolean",
        tier: "advanced",
      },
      { key: "--note", flag: "--note", label: "History Note", type: "string", tier: "advanced" },
    ],
    meta: {
      effect: "write",
      cost: "optional-paid",
      costHint: "words mode is free; jev/both runs Jev judge queries across the case set.",
      speed: "long",
      cancellable: true,
      helpMode: "flag",
      envAnyOf: [["OPENCODE_API_KEY", "OPENROUTER_API_KEY"]],
      confirm: {
        mode: "always",
        message:
          "eval:find runs benchmark suites into scripts/evals/find/runs/ (and Jev API calls if jev/both).",
      },
    },
  },
  {
    id: "eval:lessons",
    label: "eval:lessons",
    category: "dev",
    summary: "Score Jev lesson routing accuracy on scripts/evals/lessons/cases/.",
    runner: "bun-script",
    target: "eval:lessons",
    cwdModes: ["root"],
    flags: [
      {
        key: "--set",
        flag: "--set",
        label: "Set",
        type: "enum",
        options: ["dev", "holdout-a"],
        tier: "common",
      },
      { key: "--note", flag: "--note", label: "History Note", type: "string", tier: "advanced" },
    ],
    meta: {
      effect: "write",
      cost: "paid",
      costHint: "Calls Jev model across lesson eval cases.",
      speed: "short",
      cancellable: true,
      helpMode: "flag",
      envAnyOf: [["OPENCODE_API_KEY", "OPENROUTER_API_KEY"]],
      confirm: {
        mode: "always",
        message: "eval:lessons invokes Jev across lesson eval cases and writes runs/history.jsonl.",
      },
    },
  },
  {
    id: "eval:load",
    label: "eval:load",
    category: "dev",
    summary: "Measure headless Chrome cold/warm studio load times (desk & phone) on port 4391.",
    runner: "bun-script",
    target: "eval:load",
    cwdModes: ["root"],
    flags: [
      {
        key: "--film",
        flag: "--film",
        label: "Target Film",
        type: "choice",
        choiceSource: "films",
        tier: "common",
      },
      {
        key: "--runs",
        flag: "--runs",
        label: "Runs per Profile",
        type: "number",
        placeholder: "5",
        tier: "common",
      },
      {
        key: "--only",
        flag: "--only",
        label: "Profile",
        type: "enum",
        options: ["desk", "phone"],
        tier: "common",
      },
      {
        key: "--profile",
        flag: "--profile",
        label: "CPU Profile",
        type: "boolean",
        tier: "advanced",
      },
      { key: "--note", flag: "--note", label: "History Note", type: "string", tier: "advanced" },
    ],
    meta: {
      effect: "write",
      cost: "free",
      speed: "long",
      cancellable: true,
      helpMode: "flag",
      guard: {
        disabledOnRunningFilm: true,
        reason:
          "The target film's own Live Studio is running; stop it first (one studio per film).",
      },
    },
  },
  {
    id: "live-studio:demo",
    label: "live-studio:demo",
    category: "dev",
    summary: "Run Live Studio package in demo mode (long-lived server, guarded).",
    runner: "package-script",
    target: "demo",
    packageDir: "packages/live-studio",
    cwdModes: ["root"],
    meta: {
      effect: "daemon",
      cost: "free",
      speed: "long",
      cancellable: false,
      helpMode: "none",
      guard: { disabled: true, reason: "Starts a long-lived demo studio server; run in terminal." },
    },
  },
  {
    id: "live-studio:test",
    label: "live-studio:test",
    category: "dev",
    summary: "Run tests inside packages/live-studio (`bun test --timeout 30000`).",
    runner: "package-script",
    target: "test",
    packageDir: "packages/live-studio",
    cwdModes: ["root"],
    args: [
      { key: "pattern", label: "Filter Pattern", type: "string", multi: true, placeholder: "cli-" },
    ],
    meta: { effect: "read", cost: "free", speed: "short", cancellable: true, helpMode: "flag" },
  },
  {
    id: "live-studio:lint",
    label: "live-studio:lint",
    category: "dev",
    summary: "Run oxlint inside packages/live-studio (includes @shadcn/lint).",
    runner: "package-script",
    target: "lint",
    packageDir: "packages/live-studio",
    cwdModes: ["root"],
    meta: { effect: "read", cost: "free", speed: "short", cancellable: true, helpMode: "flag" },
  },
  {
    id: "live-studio:typecheck",
    label: "live-studio:typecheck",
    category: "dev",
    summary: "Run TypeScript check inside packages/live-studio.",
    runner: "package-script",
    target: "typecheck",
    packageDir: "packages/live-studio",
    cwdModes: ["root"],
    meta: { effect: "read", cost: "free", speed: "instant", cancellable: true, helpMode: "flag" },
  },
  {
    id: "film-kit:test",
    label: "film-kit:test",
    category: "dev",
    summary: "Run tests inside packages/film-kit.",
    runner: "package-script",
    target: "test",
    packageDir: "packages/film-kit",
    cwdModes: ["root"],
    meta: { effect: "read", cost: "free", speed: "instant", cancellable: true, helpMode: "flag" },
  },
  {
    id: "film-kit:demo",
    label: "film-kit:demo",
    category: "dev",
    summary: "Start film-kit Vite demo server (guarded).",
    runner: "package-script",
    target: "demo",
    packageDir: "packages/film-kit",
    cwdModes: ["root"],
    meta: {
      effect: "daemon",
      cost: "free",
      speed: "long",
      cancellable: false,
      helpMode: "none",
      guard: { disabled: true, reason: "Starts a Vite dev server; run in terminal." },
    },
  },
  {
    id: "film-kit-demo:demo",
    label: "film-kit-demo:demo",
    category: "dev",
    summary: "Setup & start film-kit-demo Vite server (guarded).",
    runner: "package-script",
    target: "demo",
    packageDir: "packages/film-kit-demo",
    cwdModes: ["root"],
    meta: {
      effect: "daemon",
      cost: "free",
      speed: "long",
      cancellable: false,
      helpMode: "none",
      guard: { disabled: true, reason: "Starts a Vite dev server; run in terminal." },
    },
  },
  {
    id: "film-stage:test",
    label: "film-stage:test",
    category: "dev",
    summary: "Run tests inside packages/film-stage.",
    runner: "package-script",
    target: "test",
    packageDir: "packages/film-stage",
    cwdModes: ["root"],
    meta: { effect: "read", cost: "free", speed: "instant", cancellable: true, helpMode: "flag" },
  },
  {
    id: "mc-actor:test",
    label: "mc-actor:test",
    category: "dev",
    summary: "Run tests inside packages/mc-actor.",
    runner: "package-script",
    target: "test",
    packageDir: "packages/mc-actor",
    cwdModes: ["root"],
    meta: { effect: "read", cost: "free", speed: "instant", cancellable: true, helpMode: "flag" },
  },

  // ── DIRECT ASSET & CATALOG TOOLS ─────────────────────────────────────────────────────────────────
  {
    id: "mc:pick",
    label: "mc:pick",
    category: "pipeline",
    summary:
      "Build a film's block picks zip from pack/picks.json using packages/mc-assets/pick.mjs.",
    runner: "bun-file",
    target: "packages/mc-assets/pick.mjs",
    cwdModes: ["film"],
    meta: { effect: "write", cost: "free", speed: "short", cancellable: true, helpMode: "none" },
  },
  {
    id: "mc:mobs",
    label: "mc:mobs",
    category: "pipeline",
    summary:
      "Download Minecraft mob models/textures into vault/mcasset/<version> via packages/mc-assets/mobs.ts.",
    runner: "bun-file",
    target: "packages/mc-assets/mobs.ts",
    cwdModes: ["root"],
    args: [{ key: "version", label: "MC Version", type: "string", placeholder: "1.21.11" }],
    meta: {
      effect: "install",
      cost: "free",
      speed: "short",
      cancellable: true,
      helpMode: "none",
      confirm: {
        mode: "always",
        message: "Downloads Minecraft entity assets from assets.mcasset.cloud into vault/mcasset/.",
      },
    },
  },
  {
    id: "mc:slim-jar",
    label: "mc:slim-jar",
    category: "pipeline",
    summary:
      "Strip non-client textures/assets from Minecraft jar into slim brotli zip (scripts/mc/slim_jar.mjs).",
    runner: "bun-file",
    target: "scripts/mc/slim_jar.mjs",
    cwdModes: ["film", "root"],
    flags: [
      { key: "--mc-dir", flag: "--mc-dir", label: "Minecraft Dir", type: "string", tier: "common" },
      { key: "--force", flag: "--force", label: "Force Rebuild", type: "boolean", tier: "common" },
    ],
    meta: { effect: "write", cost: "free", speed: "short", cancellable: true, helpMode: "none" },
  },
  {
    id: "catalog:search",
    label: "catalog:search",
    category: "pipeline",
    summary:
      "Direct Python mocap catalog query & optional Jev rerank (packages/clip-catalog/catalog.py).",
    runner: "python-file",
    target: "packages/clip-catalog/catalog.py",
    cwdModes: ["root"],
    args: [{ key: "words", label: "Search Words", type: "string", multi: true }],
    flags: [
      {
        key: "--lib",
        flag: "--lib",
        label: "Libraries",
        type: "string",
        placeholder: "mixamo,ual1,ual2",
        tier: "common",
      },
      {
        key: "--jev",
        flag: "--jev",
        label: "Jev Scene Rerank",
        type: "string",
        tier: "common",
        placeholder: "he searches the floor",
      },
      {
        key: "--timeline",
        flag: "--timeline",
        label: "Include Measured Timeline (~5x quota)",
        type: "boolean",
        tier: "advanced",
      },
      { key: "-n", flag: "-n", label: "Limit", type: "number", placeholder: "30", tier: "common" },
      {
        key: "--from",
        flag: "--from",
        label: "Start Posture",
        type: "choice",
        choiceSource: "postures",
        tier: "advanced",
      },
      {
        key: "--to",
        flag: "--to",
        label: "End Posture",
        type: "choice",
        choiceSource: "postures",
        tier: "advanced",
      },
      {
        key: "--has",
        flag: "--has",
        label: "Has Posture",
        type: "choice",
        choiceSource: "postures",
        tier: "advanced",
      },
      {
        key: "--still",
        flag: "--still",
        label: "Still",
        type: "boolean",
        exclusiveGroup: "cat-motion",
        tier: "advanced",
      },
      {
        key: "--moves",
        flag: "--moves",
        label: "Moves",
        type: "boolean",
        exclusiveGroup: "cat-motion",
        tier: "advanced",
      },
      { key: "--loop", flag: "--loop", label: "Loop", type: "boolean", tier: "advanced" },
      { key: "--dur", flag: "--dur", label: "Duration MIN-MAX", type: "string", tier: "advanced" },
      {
        key: "--energy",
        flag: "--energy",
        label: "Energy MIN-MAX",
        type: "string",
        tier: "advanced",
      },
      { key: "--head", flag: "--head", label: "Hand at Head", type: "boolean", tier: "advanced" },
      { key: "--up", flag: "--up", label: "Hand Up", type: "boolean", tier: "advanced" },
      {
        key: "--ground",
        flag: "--ground",
        label: "Hand Ground",
        type: "boolean",
        tier: "advanced",
      },
      { key: "--bend", flag: "--bend", label: "Bent Over", type: "boolean", tier: "advanced" },
      {
        key: "--air",
        flag: "--air",
        label: "Airborne",
        type: "enum",
        options: ["yes", "no"],
        tier: "advanced",
      },
      { key: "--look", flag: "--look", label: "Head Turn Deg", type: "number", tier: "advanced" },
      { key: "--mood", flag: "--mood", label: "Mood", type: "string", tier: "advanced" },
      { key: "--prop", flag: "--prop", label: "Prop", type: "string", tier: "advanced" },
      { key: "--style", flag: "--style", label: "Style", type: "string", tier: "advanced" },
      {
        key: "--fights",
        flag: "--fights",
        label: "Include Fights",
        type: "boolean",
        tier: "advanced",
      },
    ],
    meta: {
      effect: "read",
      cost: "optional-paid",
      costHint: "Free offline; --jev sends scene ranking query to Jev.",
      speed: "instant",
      cancellable: true,
      helpMode: "flag",
      envAnyOf: [["OPENCODE_API_KEY", "OPENROUTER_API_KEY"]],
    },
  },
  {
    id: "catalog:eval",
    label: "catalog:eval",
    category: "pipeline",
    summary: "Run mocap eval scenes through catalog.py --jev and write ranked output file.",
    runner: "python-file",
    target: "packages/clip-catalog/catalog_eval.py",
    cwdModes: ["root"],
    args: [
      {
        key: "out",
        label: "Output File (.txt)",
        type: "string",
        required: true,
        placeholder: "out.txt",
      },
    ],
    flags: [
      { key: "-n", flag: "-n", label: "Top N", type: "number", placeholder: "5", tier: "common" },
      {
        key: "--timeline",
        flag: "--timeline",
        label: "Include Timeline",
        type: "boolean",
        tier: "common",
      },
    ],
    meta: {
      effect: "write",
      cost: "paid",
      speed: "long",
      cancellable: true,
      helpMode: "flag",
      envAnyOf: [["OPENCODE_API_KEY", "OPENROUTER_API_KEY"]],
      confirm: {
        mode: "always",
        message: "Runs catalog.py --jev across all eval scenes and writes output file.",
      },
    },
  },
  {
    id: "catalog:batch",
    label: "catalog:batch",
    category: "pipeline",
    summary: "Resume mocap tagging, retarget checks or contact sheets from a film.",
    runner: "python-file",
    target: "packages/clip-catalog/batch.py",
    cwdModes: ["film"],
    args: [
      {
        key: "mode",
        label: "Mode",
        type: "enum",
        options: ["catalog", "sweep", "sheets"],
        required: true,
      },
      {
        key: "libs",
        label: "Libraries",
        type: "string",
        multi: true,
        placeholder: "mixamo ual1 ual2",
      },
    ],
    flags: [
      { key: "--limit", flag: "--limit", label: "Clip limit", type: "number", tier: "common" },
      {
        key: "--timeout",
        flag: "--timeout",
        label: "Seconds per chunk",
        type: "number",
        tier: "common",
        default: "600",
      },
    ],
    meta: { effect: "write", cost: "free", speed: "long", cancellable: true, helpMode: "flag" },
  },
  {
    id: "catalog:sweep-report",
    label: "catalog:sweep-report",
    category: "pipeline",
    summary: "Summarize clip catalog tag distribution and diff against an older report.",
    runner: "python-file",
    target: "packages/clip-catalog/sweep_report.py",
    cwdModes: ["root"],
    args: [{ key: "lib", label: "Library (Optional)", type: "string", placeholder: "mixamo" }],
    flags: [
      { key: "--top", flag: "--top", label: "Top N", type: "number", tier: "common" },
      { key: "--only", flag: "--only", label: "Only Field", type: "string", tier: "common" },
      {
        key: "--fights",
        flag: "--fights",
        label: "Include Fights",
        type: "boolean",
        tier: "common",
      },
      { key: "--diff", flag: "--diff", label: "Diff Old Report", type: "string", tier: "advanced" },
    ],
    meta: { effect: "read", cost: "free", speed: "instant", cancellable: true, helpMode: "flag" },
  },
  {
    id: "catalog:review",
    label: "catalog:review",
    category: "pipeline",
    summary: "Generate mocap review pages or patch clip verdict fields (--fix / --missing).",
    runner: "python-file",
    target: "packages/clip-catalog/catalog_review.py",
    cwdModes: ["root"],
    flags: [
      {
        key: "--page",
        flag: "--page",
        label: "Page Number (stdin)",
        type: "number",
        tier: "advanced",
        placeholder: "0",
        hint: "Read JSON slot verdicts from stdin for review page N",
      },
      {
        key: "--missing",
        flag: "--missing",
        label: "Pages Missing Field",
        type: "string",
        tier: "common",
        placeholder: "style",
      },
      {
        key: "--fix",
        flag: "--fix",
        label: "Fix REF JSON (2 tokens)",
        type: "string",
        multi: true,
        multiStyle: "args",
        tier: "advanced",
        placeholder: 'mixamo/X {"end":"kneel"}',
      },
    ],
    meta: { effect: "write", cost: "free", speed: "short", cancellable: true, helpMode: "flag" },
  },
  {
    id: "catalog:check",
    label: "catalog:check",
    category: "pipeline",
    summary: "Run consistency checks on the mocap clip catalog.",
    runner: "python-file",
    target: "packages/clip-catalog/catalog_check.py",
    cwdModes: ["root"],
    meta: { effect: "read", cost: "free", speed: "short", cancellable: true, helpMode: "none" },
  },
  {
    id: "studio:init",
    label: "studio:init",
    category: "pipeline",
    summary: "Connect a film directory to Live Studio (packages/live-studio/init.mjs).",
    runner: "bun-file",
    target: "packages/live-studio/init.mjs",
    cwdModes: ["root"],
    args: [
      {
        key: "project",
        label: "Film Folder Path",
        type: "string",
        required: true,
        choiceSource: "filmDirs",
        placeholder: "films/sealed-room",
      },
    ],
    flags: [
      { key: "--dry", flag: "--dry", label: "Dry Run (--dry)", type: "boolean", tier: "common" },
    ],
    meta: {
      effect: "write",
      cost: "free",
      speed: "short",
      cancellable: true,
      helpMode: "none",
      confirm: {
        mode: "always",
        message:
          "Modifies target project's package.json and scaffolds starter files (unless --dry is checked).",
      },
    },
  },
  {
    id: "catalog:tag-sh",
    label: "catalog:tag-sh",
    category: "pipeline",
    summary:
      "Resumable batch mocap tagging script (packages/clip-catalog/catalog.sh) writing vault/motion/catalog/<lib>.jsonl.",
    runner: "bash-file",
    target: "packages/clip-catalog/catalog.sh",
    cwdModes: ["film"],
    args: [
      {
        key: "libs",
        label: "Libraries (Optional)",
        type: "string",
        multi: true,
        placeholder: "mixamo ual1 ual2",
      },
    ],
    meta: { effect: "write", cost: "free", speed: "long", cancellable: true, helpMode: "none" },
  },
  {
    id: "catalog:review-sh",
    label: "catalog:review-sh",
    category: "pipeline",
    summary:
      "Resumable contact-sheet batch renderer for catalog review pages (packages/clip-catalog/catalog_review.sh).",
    runner: "bash-file",
    target: "packages/clip-catalog/catalog_review.sh",
    cwdModes: ["film"],
    meta: { effect: "write", cost: "free", speed: "long", cancellable: true, helpMode: "none" },
  },
  {
    id: "catalog:sweep-sh",
    label: "catalog:sweep-sh",
    category: "pipeline",
    summary:
      "Resumable retarget-health batch sweep script (packages/clip-catalog/sweep.sh) writing sweep_<lib>.jsonl.",
    runner: "bash-file",
    target: "packages/clip-catalog/sweep.sh",
    cwdModes: ["film"],
    args: [
      {
        key: "libs",
        label: "Libraries (Optional)",
        type: "string",
        multi: true,
        placeholder: "mixamo",
      },
    ],
    meta: { effect: "write", cost: "free", speed: "long", cancellable: true, helpMode: "none" },
  },
  {
    id: "catalog:sheet-clip",
    label: "catalog:sheet-clip",
    category: "pipeline",
    summary:
      "Assemble renders/clip_*_{front,left}* stills from lab/clip.ts into renders/clip_sheet_{front,left}.jpg (packages/clip-catalog/sheet_clip.py).",
    runner: "python-file",
    target: "packages/clip-catalog/sheet_clip.py",
    cwdModes: ["film"],
    meta: {
      effect: "write",
      cost: "free",
      speed: "short",
      cancellable: true,
      helpMode: "none",
      outputsHint: "Writes renders/clip_sheet_front.jpg and renders/clip_sheet_left.jpg",
    },
  },
  {
    id: "mc:pick-py",
    label: "mc:pick-py",
    category: "pipeline",
    summary:
      "Legacy Python resource-pack cherry-picker superseded by mc:pick (packages/mc-assets/pick.py).",
    runner: "python-file",
    target: "packages/mc-assets/pick.py",
    cwdModes: ["film"],
    meta: { effect: "write", cost: "free", speed: "short", cancellable: true, helpMode: "none" },
  },
  {
    id: "timeline:fmt",
    label: "timeline:fmt",
    category: "pipeline",
    summary: "Format a film's src/timeline/*.json files using compactJson.",
    runner: "bun-file",
    target: "scripts/timeline_fmt.ts",
    cwdModes: ["film"],
    meta: { effect: "write", cost: "free", speed: "instant", cancellable: false, helpMode: "none" },
  },
  {
    id: "timeline:fmt-py",
    label: "timeline:fmt-py",
    category: "pipeline",
    summary:
      "Legacy Python timeline JSON formatter superseded by timeline:fmt (scripts/timeline_fmt.py).",
    runner: "python-file",
    target: "scripts/timeline_fmt.py",
    cwdModes: ["film"],
    meta: { effect: "write", cost: "free", speed: "instant", cancellable: false, helpMode: "none" },
  },
];

export const findCliCommand = (id: string): CliCommand | undefined =>
  CLI_COMMANDS.find((c) => c.id === id);

export function resolveSubcommandChain(
  command: CliCommand,
  subcommandPath: readonly string[] = [],
): {
  subcommands: CliSubcommand[];
  resolvedPath: string[];
  argsDef: readonly CliArgDef[];
  flagsDef: readonly CliFlagDef[];
  envDef: readonly CliEnvDef[];
  meta: CliMeta;
  summary: string;
} {
  const subcommands: CliSubcommand[] = [];
  const resolvedPath: string[] = [];
  let argsDef: readonly CliArgDef[] = command.args ?? [];
  let flagsDef: readonly CliFlagDef[] = command.flags ?? [];
  let envDef: readonly CliEnvDef[] = command.env ?? [];
  let meta: CliMeta = { ...command.meta };
  let summary = command.summary;
  let children = command.subcommands;

  for (const seg of subcommandPath) {
    if (!children?.length) break;
    const hit = children.find((s) => s.id === seg);
    if (!hit) break;
    subcommands.push(hit);
    resolvedPath.push(hit.id);
    summary = hit.summary || summary;
    argsDef = hit.args ?? [];
    flagsDef = hit.inheritFlags ? [...flagsDef, ...(hit.flags ?? [])] : (hit.flags ?? []);
    envDef = hit.env ?? envDef;
    if (hit.meta) meta = { ...meta, ...hit.meta };
    children = hit.subcommands;
  }

  return { subcommands, resolvedPath, argsDef, flagsDef, envDef, meta, summary };
}

function normalizeConditionValues(raw: CliArgValue): string[] {
  if (raw === undefined || raw === null || raw === false) return [];
  const parts = Array.isArray(raw)
    ? raw.flatMap((x) => String(x).split(","))
    : String(raw).split(",");
  return parts.map((s) => s.trim()).filter(Boolean);
}

export function isFieldVisible(
  rule: CliVisibleWhen | undefined,
  values: Record<string, CliArgValue>,
): boolean {
  if (!rule) return true;
  const items = normalizeConditionValues(values[rule.field]);
  if (rule.nonEmpty !== undefined && (rule.nonEmpty ? items.length === 0 : items.length > 0)) {
    return false;
  }
  if (rule.in) return items.some((val) => rule.in!.includes(val));
  if (rule.unsetOrIn)
    return items.length === 0 || items.some((val) => rule.unsetOrIn!.includes(val));
  if (rule.unsetOrStartsWith) {
    if (items.length === 0) return true;
    return items.some((val) =>
      rule.unsetOrStartsWith!.some((prefix) => val === prefix || val.startsWith(`${prefix}/`)),
    );
  }
  return true;
}

export function isFieldRequired(
  def: { required?: boolean; requiredWhen?: CliVisibleWhen },
  values: Record<string, CliArgValue>,
): boolean {
  return (
    Boolean(def.required) || (Boolean(def.requiredWhen) && isFieldVisible(def.requiredWhen, values))
  );
}

// Split string input like `a "b c"` into discrete argv tokens without shell eval while preserving JSON literals.
export function tokenizeWords(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let stripOuterQuote = false;
  let braceDepth = 0;
  let hasToken = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quote) {
      if (ch === quote) {
        if (!stripOuterQuote) cur += ch;
        quote = null;
        stripOuterQuote = false;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      stripOuterQuote = !hasToken;
      if (!stripOuterQuote) cur += ch;
      hasToken = true;
    } else if (ch === "{") {
      braceDepth++;
      cur += ch;
      hasToken = true;
    } else if (ch === "}" && braceDepth > 0) {
      braceDepth--;
      cur += ch;
      hasToken = true;
    } else if (/\s/.test(ch) && braceDepth === 0) {
      if (hasToken || cur.length > 0) {
        out.push(cur);
        cur = "";
        hasToken = false;
      }
    } else {
      cur += ch;
      hasToken = true;
    }
  }
  if (hasToken || cur.length > 0) out.push(cur);
  return out;
}

const formatShellToken = (tok: string): string =>
  tok === "" || /[\s"'\\$`|&;<>()!*?#]/.test(tok) ? `"${tok.replaceAll('"', '\\"')}"` : tok;

const isActiveValue = (val: CliArgValue): boolean => {
  if (val === undefined || val === null || val === false) return false;
  if (Array.isArray(val)) return val.length > 0;
  if (typeof val === "string") return val.trim().length > 0;
  return true;
};

const isBooleanActive = (val: CliArgValue): boolean =>
  val === true || val === "true" || val === 1 || val === "1";

const isFieldValueActive = (
  def: { type: CliFieldType; optionalValue?: boolean },
  val: CliArgValue,
): boolean => {
  if (def.type === "boolean") return isBooleanActive(val);
  if (def.optionalValue) return val !== undefined && val !== false && val !== "false";
  return isActiveValue(val);
};

const validateNumberTokens = (
  def: { type: CliFieldType; label: string },
  tokens: readonly string[],
  validationErrors: string[],
) => {
  if (def.type !== "number") return;
  for (const tok of tokens) {
    if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(tok) || !Number.isFinite(Number(tok))) {
      validationErrors.push(`Invalid number for ${def.label}: "${tok}"`);
    }
  }
};

const validateArgumentTokens = (
  def: { type: CliFieldType; label: string },
  tokens: readonly string[],
  validationErrors: string[],
) => {
  for (const token of tokens) {
    if (token.startsWith("-") && token !== "-" && !Number.isFinite(Number(token))) {
      validationErrors.push(
        `${def.label}: "${token}" looks like an option. Use its option control, or prefix a file path with "./".`,
      );
    }
  }
  validateNumberTokens(def, tokens, validationErrors);
};

function computeEffectiveMeta(
  commandId: string,
  subcommandPath: readonly string[],
  baseMeta: CliMeta,
  flags: Record<string, CliArgValue>,
  args: Record<string, CliArgValue>,
): CliMeta {
  const next: CliMeta = { ...baseMeta };
  if (commandId === "find") {
    if (flags["--star"] || flags["--unstar"]) next.effect = "write";
    if (isBooleanActive(flags["--jev"])) {
      next.cost = "paid";
      next.speed = "short";
    } else {
      next.envAnyOf = undefined;
    }
  } else if (commandId === "voice:gen") {
    if (!isBooleanActive(flags["--yes"]) || isBooleanActive(flags["--dry-run"])) {
      next.envAnyOf = undefined;
      next.envRequired = undefined;
    }
    if (isBooleanActive(flags["--dry-run"])) {
      next.cost = "free";
    } else if (isBooleanActive(flags["--yes"])) {
      next.effect = "write";
      next.cost = "paid";
    }
  } else if (commandId === "deliver") {
    if (
      flags["--youtube"] !== undefined &&
      flags["--youtube"] !== false &&
      flags["--youtube"] !== "false"
    ) {
      next.effect = "write";
      next.speed = "long";
    }
  } else if (commandId === "earshot") {
    if (subcommandPath[0] === "mcp" && isBooleanActive(flags["--tools"])) {
      next.effect = "read";
    }
    if (subcommandPath[0] === "doctor" && isBooleanActive(flags["--fetch"])) {
      next.effect = "install";
      next.speed = "long";
    }
    if (subcommandPath[0] === "forge") {
      if (isBooleanActive(flags["--list"])) {
        next.effect = "read";
        next.speed = "instant";
      } else if (isActiveValue(flags["--check"])) {
        next.effect = "read";
        next.speed = "short";
      }
    }
  } else if (commandId === "studio:init" && isBooleanActive(flags["--dry"])) {
    next.effect = "read";
  } else if (commandId === "eval:find") {
    if (flags["--mode"] === "words") {
      next.cost = "free";
      next.envAnyOf = undefined;
    } else {
      next.cost = "paid";
    }
  } else if (commandId === "catalog:search") {
    if (isActiveValue(flags["--jev"]) && flags["--jev"] !== "false") {
      next.cost = "paid";
    } else {
      next.envAnyOf = undefined;
    }
  } else if (commandId === "gap") {
    if (isActiveValue(args.need) && isActiveValue(flags["--did"])) {
      next.effect = "write";
    }
  }
  return next;
}

function formatCliCopyCommand(
  cwd: string,
  argv: readonly string[],
  env: readonly [string, string][],
  shell: "powershell" | "posix",
): string {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const command = `cd ${quote(cwd)} && ${env.map(([key, value]) => `${key}=${quote(value)} `).join("")}${argv.map(quote).join(" ")}`;
  if (shell === "posix") return `env -u LIVE_PROJECT bun exec ${quote(command)}`;
  return [
    "& {",
    "  $cliPreviousProject = [Environment]::GetEnvironmentVariable('LIVE_PROJECT')",
    "  try {",
    "    $env:LIVE_PROJECT = $null",
    `    $cliCommand = '${command.replaceAll("'", "''")}'`,
    // PowerShell Legacy mode otherwise strips quotes from native command arguments.
    String.raw`    if ((Get-Variable PSNativeCommandArgumentPassing -ValueOnly -ErrorAction SilentlyContinue) -notin @('Standard', 'Windows')) { $cliCommand = $cliCommand -replace '(\\*)"', '$1$1\"' }`,
    "    bun exec $cliCommand",
    "  } finally {",
    "    [Environment]::SetEnvironmentVariable('LIVE_PROJECT', $cliPreviousProject)",
    "  }",
    "}",
  ].join("\n");
}

export function buildCliInvocation(
  request: CliRunRequest,
  context?: Partial<
    Pick<
      CliContext,
      | "activeFilm"
      | "isDemo"
      | "films"
      | "runningFilms"
      | "envStatus"
      | "repoRoot"
      | "projectRoot"
      | "copyShell"
    >
  >,
): ResolvedCliSpec {
  const command = findCliCommand(request.commandId);
  if (!command) throw new Error(`Unknown CLI command: ${request.commandId}`);

  const mode = request.mode === "help" ? "help" : "execute";
  const chain = resolveSubcommandChain(command, request.subcommandPath);
  const args = request.args ?? {};
  const flags = request.flags ?? {};
  const env = request.env ?? {};

  // Match Studio init-like behavior when resolving relative targetFilm for runner display
  const filmOnly = command.cwdModes.length === 1 && command.cwdModes[0] === "film";
  const rawFilm =
    request.targetFilm === "active" || request.targetFilm === "root"
      ? undefined
      : request.targetFilm;
  const resolvedFilm =
    filmOnly && request.targetFilm === "root" ? null : rawFilm || context?.activeFilm || null;

  const cwdMode: CliCwdMode =
    command.cwdModes.length === 1
      ? command.cwdModes[0]!
      : resolvedFilm && request.targetFilm !== "root" && command.cwdModes.includes("film")
        ? "film"
        : "root";

  const combinedFieldValues: Record<string, CliArgValue> = { ...args, ...flags, ...env };
  const effectiveMeta = computeEffectiveMeta(
    command.id,
    chain.resolvedPath,
    chain.meta,
    flags,
    args,
  );
  const validationErrors: string[] = [];
  if (filmOnly && request.targetFilm === "root") {
    validationErrors.push(
      `${command.label} runs inside a film workspace; targetFilm cannot be 'root'.`,
    );
  }
  if (mode === "execute") {
    if (
      command.id === "notes" &&
      isActiveValue(args.ids) &&
      (isActiveValue(flags["--shot"]) || isActiveValue(flags["--limit"]))
    ) {
      validationErrors.push("Give Note ID(s) or --shot / --limit, not both.");
    }
    if (command.id === "gap") {
      if (isActiveValue(args.need) && !isActiveValue(flags["--did"])) {
        validationErrors.push("Enter Workaround Used (--did) to log a gap.");
      } else if (
        !isActiveValue(args.need) &&
        (isActiveValue(flags["--did"]) || isActiveValue(flags["--cmd"]))
      ) {
        validationErrors.push("Enter Needed Capability before logging a gap.");
      }
    }
  }
  const exclusiveConflicts: string[] = [];

  const argvTokens: string[] = [];
  const envEntries: [string, string][] = [];

  if (mode === "help") {
    if (effectiveMeta.helpMode === "none") {
      validationErrors.push(
        `${command.label} has no --help mode; inspect summary and fields instead.`,
      );
    } else {
      const helpArgs =
        effectiveMeta.helpArgs ?? (effectiveMeta.helpMode === "subcommand" ? ["help"] : ["--help"]);
      argvTokens.push(...chain.resolvedPath, ...helpArgs);
    }
  } else {
    if (command.subcommands?.length && command.subcommandRequired && !chain.resolvedPath.length) {
      validationErrors.push(`Choose a ${command.label} subcommand first.`);
    } else {
      const leaf = chain.subcommands.at(-1);
      if (leaf?.subcommands?.length && leaf.subcommandRequired) {
        validationErrors.push(
          `Choose a ${command.label} ${chain.resolvedPath.join(" ")} subcommand first.`,
        );
      }
    }

    // Track exclusive groups across args, flags, env
    const groupHits = new Map<string, string[]>();
    const trackExclusive = (group: string | undefined, label: string, active: boolean) => {
      if (!group || !active) return;
      const list = groupHits.get(group) ?? [];
      list.push(label);
      groupHits.set(group, list);
    };

    // Positionals come after selected subcommand segments (except command-level positionals? No command with subcommands has parent args)
    argvTokens.push(...chain.resolvedPath);

    let firstSkippedOptionalArg: string | null = null;
    for (const def of chain.argsDef) {
      if (!isFieldVisible(def.visibleWhen, combinedFieldValues)) continue;
      const raw = args[def.key] ?? def.default;
      const active = isFieldValueActive(def, raw);
      trackExclusive(def.exclusiveGroup, def.label, active);
      if (isFieldRequired(def, combinedFieldValues) && !active) {
        validationErrors.push(`Missing required argument: ${def.label}`);
        continue;
      }
      if (!active) {
        firstSkippedOptionalArg ??= def.label;
        continue;
      }
      if (firstSkippedOptionalArg) {
        validationErrors.push(`Fill ${firstSkippedOptionalArg} before setting ${def.label}.`);
        continue;
      }
      const tokens = Array.isArray(raw)
        ? raw.map((item) => String(item).trim()).filter(Boolean)
        : def.multi
          ? tokenizeWords(String(raw).trim())
          : [String(raw).trim()];
      validateArgumentTokens(def, tokens, validationErrors);
      argvTokens.push(...tokens);
    }

    for (const def of chain.flagsDef) {
      if (!isFieldVisible(def.visibleWhen, combinedFieldValues)) continue;
      const raw = flags[def.key];
      const active = isFieldValueActive(def, raw);
      trackExclusive(def.exclusiveGroup, def.flag, active);

      if (isFieldRequired(def, combinedFieldValues) && !active) {
        validationErrors.push(`Missing required option: ${def.flag}`);
        continue;
      }
      if (!active) continue;

      if (def.type === "boolean") {
        argvTokens.push(def.flag);
        continue;
      }
      if (def.optionalValue && (raw === true || raw === "" || raw === null)) {
        argvTokens.push(def.flag);
        continue;
      }
      if (def.type === "csv") {
        const joined = Array.isArray(raw)
          ? raw
              .map((x) => String(x).trim())
              .filter(Boolean)
              .join(",")
          : String(raw).trim();
        if (joined) {
          validateArgumentTokens(def, [joined], validationErrors);
          argvTokens.push(def.flag, joined);
        } else if (def.optionalValue) argvTokens.push(def.flag);
        continue;
      }
      if (def.multi) {
        const vals = Array.isArray(raw)
          ? raw.map((x) => String(x).trim()).filter(Boolean)
          : tokenizeWords(String(raw));
        if (!vals.length) continue;
        validateArgumentTokens(def, vals, validationErrors);
        if (def.multiStyle === "args") argvTokens.push(def.flag, ...vals);
        else for (const v of vals) argvTokens.push(def.flag, v);
        continue;
      }
      const valStr = String(raw).trim();
      if (valStr) {
        validateArgumentTokens(def, [valStr], validationErrors);
        argvTokens.push(def.flag, valStr);
      }
    }

    for (const def of chain.envDef) {
      if (!isFieldVisible(def.visibleWhen, combinedFieldValues)) continue;
      const raw = env[def.key];
      const active = isFieldValueActive(def, raw);
      trackExclusive(def.exclusiveGroup, def.key, active);
      if (isFieldRequired(def, combinedFieldValues) && !active) {
        validationErrors.push(`Missing required env: ${def.key}`);
        continue;
      }
      if (!active) continue;
      if (def.type === "boolean") {
        envEntries.push([def.key, "1"]);
      } else {
        const valStr = String(raw).trim();
        validateNumberTokens(def, [valStr], validationErrors);
        envEntries.push([def.key, valStr]);
      }
    }

    for (const [, names] of groupHits) {
      if (names.length > 1) {
        const msg = `Mutually exclusive options set together: ${names.join(" + ")}`;
        exclusiveConflicts.push(msg);
        validationErrors.push(msg);
      }
    }
  }

  // Evaluate guard conditions
  let guardReason: string | null = null;
  if (mode === "execute") {
    if (effectiveMeta.guard?.disabled) {
      guardReason = effectiveMeta.guard.reason;
    } else if (effectiveMeta.guard?.disabledWhenToolsUnset && !isBooleanActive(flags["--tools"])) {
      guardReason = effectiveMeta.guard.reason;
    } else if (effectiveMeta.guard?.disabledOnRunningFilm && context) {
      const evalFilm =
        (typeof flags["--film"] === "string" && flags["--film"].trim()) || context.activeFilm;
      if (evalFilm && context.runningFilms?.includes(evalFilm)) {
        guardReason = effectiveMeta.guard.reason;
      }
    }
    if (!guardReason && command.id === "catalog:review" && isActiveValue(flags["--page"])) {
      guardReason =
        "catalog:review --page N requires verdict JSON on piped stdin; use --missing or --fix from Studio, or run python packages/clip-catalog/catalog_review.py --page N < notes.json in terminal.";
    }
    if (!guardReason && cwdMode === "film" && !resolvedFilm && context) {
      guardReason = "No film workspace available in films/ for this film-scoped command.";
    }
  }

  // Evaluate confirmation gate (disabled when running Help)
  let requiresConfirm = false;
  let confirmMessage: string | null = null;
  if (mode === "execute" && effectiveMeta.confirm && effectiveMeta.confirm.mode !== "none") {
    const rule = effectiveMeta.confirm;
    if (rule.mode === "always") {
      // studio:init with --dry is non-mutating
      if (!(command.id === "studio:init" && isBooleanActive(flags["--dry"]))) {
        requiresConfirm = true;
        confirmMessage = rule.message;
      }
    } else if (rule.mode === "when-flagged") {
      const flaggedTrigger = chain.flagsDef.some(
        (f) =>
          f.requiresConfirmIfSet &&
          isFieldVisible(f.visibleWhen, combinedFieldValues) &&
          isFieldValueActive(f, flags[f.key]),
      );
      const argDefault = rule.whenArgIn
        ? chain.argsDef.find((a) => a.key === rule.whenArgIn!.key)?.default
        : undefined;
      const argTrigger =
        rule.whenArgIn &&
        rule.whenArgIn.values.includes(String(args[rule.whenArgIn.key] ?? argDefault ?? ""));
      const dryBlocked = command.id === "voice:gen" && isBooleanActive(flags["--dry-run"]);
      if ((flaggedTrigger || argTrigger) && !dryBlocked) {
        requiresConfirm = true;
        confirmMessage = rule.message;
      }
    }
  }

  // Missing env status groups (all keys in an OR group missing -> surface warning pill)
  const missingEnvGroups: CliEnvKey[][] = [];
  if (context?.envStatus) {
    const requiredGroups: CliEnvKey[][] = [
      ...(effectiveMeta.envRequired ? effectiveMeta.envRequired.map((k) => [k]) : []),
      ...(effectiveMeta.envAnyOf ? effectiveMeta.envAnyOf.map((g) => [...g]) : []),
    ];
    for (const grp of requiredGroups) {
      if (grp.length && !grp.some((k) => context.envStatus?.[k])) {
        missingEnvGroups.push(grp);
      }
    }
  }

  const envPrefix = envEntries.map(([k, v]) => `${k}=${formatShellToken(v)} `).join("");
  const targetToken =
    cwdMode === "film"
      ? context?.repoRoot
        ? `${context.repoRoot}/${command.target}`
        : `../../${command.target}`
      : command.target;
  let baseParts: readonly string[];
  switch (command.runner) {
    case "bun-script":
    case "package-script":
      baseParts = ["bun", "run", command.target];
      break;
    case "earshot":
      baseParts = ["earshot"];
      break;
    case "bun-file":
      baseParts = ["bun", targetToken];
      break;
    case "python-file":
      baseParts = ["python", targetToken];
      break;
    case "bash-file":
      baseParts = ["bash", targetToken];
      break;
  }

  const cmdString = [...baseParts, ...argvTokens].map(formatShellToken).join(" ");
  const displayCommand =
    command.runner === "package-script" && command.packageDir
      ? `(cd ${formatShellToken(command.packageDir)} && ${envPrefix}${cmdString})`
      : `${envPrefix}${cmdString}`;
  const copyCwd =
    cwdMode === "film"
      ? context?.projectRoot
      : command.packageDir && context?.repoRoot
        ? `${context.repoRoot}/${command.packageDir}`
        : context?.repoRoot;
  const copyCommand = copyCwd
    ? formatCliCopyCommand(
        copyCwd,
        [...baseParts, ...argvTokens],
        envEntries,
        context?.copyShell ?? "posix",
      )
    : displayCommand;

  return {
    command,
    subcommands: chain.subcommands,
    subcommandPath: chain.resolvedPath,
    mode,
    cwdMode,
    argsDef: chain.argsDef,
    flagsDef: chain.flagsDef,
    envDef: chain.envDef,
    meta: effectiveMeta,
    baseMeta: chain.meta,
    argvTokens,
    envEntries,
    displayCommand,
    copyCommand,
    requiresConfirm,
    confirmMessage,
    guardReason,
    missingEnvGroups,
    exclusiveConflicts,
    validationErrors,
  };
}
