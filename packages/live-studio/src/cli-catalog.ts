import { nativeMediaSubcommands } from "./media-cli.ts";
import { referenceMediaSubcommands } from "./media-reference-cli.ts";
import { sdkMediaSubcommands } from "./media-sdk-cli.ts";
import { KIT_CATEGORY_IDS } from "./sound-kit-classify.mjs";
import { SOUND_KIT_CLI_COMMAND } from "./sound-kit-cli-catalog.ts";
import { PLAYGROUND_CLI_COMMAND } from "./voice-playground-cli-catalog";

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
  and?: CliVisibleWhen;
  or?: CliVisibleWhen;
}

export interface CliArgDef {
  key: string;
  label: string;
  type: CliFieldType;
  multi?: boolean;
  passthrough?: boolean;
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
  meta: CliMeta;
  baseMeta: CliMeta;
  argvTokens: string[];
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
      "Curate Core Sound Kit picks, fetch CC0 SFX, mix and audit soundtracks, and run Earshot audio inspection & synthesis.",
  },
  {
    id: "render",
    label: "Rendering and checks",
    description: "Render stills, clips, finals, inspect picture and sound, or run delivery audits.",
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
const assetManifestFlag: CliFlagDef = {
  key: "--manifest",
  flag: "--manifest",
  label: "Local manifest",
  type: "string",
  hint: "Optional JSON array of assets; relative media paths start at the manifest.",
};
const semanticObjectKindFlag: CliFlagDef = {
  key: "--kind",
  flag: "--kind",
  label: "3D asset kind",
  type: "enum",
  options: ["object", "block", "item", "mob", "prop"],
};
const assetSelectionFlags: readonly CliFlagDef[] = [
  assetManifestFlag,
  semanticObjectKindFlag,
  {
    key: "--key",
    flag: "--key",
    label: "Exact asset key",
    type: "string",
    hint: "Copy a key from plan or query to prepare one asset.",
  },
];

export const CLI_COMMANDS: readonly CliCommand[] = [
  PLAYGROUND_CLI_COMMAND,
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
    flags: [
      { key: "--json", flag: "--json", label: "JSON output", type: "boolean", tier: "common" },
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
    id: "history",
    label: "history",
    category: "daily",
    summary: "Save and restore editing versions of one film without changing monorepo Git.",
    runner: "bun-file",
    target: "packages/live-studio/history.mjs",
    cwdModes: ["film", "root"],
    subcommandRequired: true,
    flags: [{ key: "--film", flag: "--film", label: "Film path", type: "string" }],
    subcommands: [
      {
        id: "list",
        inheritFlags: true,
        label: "list",
        summary: "List versions and the current fingerprint.",
        flags: [{ key: "--before", flag: "--before", label: "Before sequence", type: "number" }],
        meta: { effect: "read" },
      },
      {
        id: "save",
        inheritFlags: true,
        label: "save",
        summary: "Keep a named version of editing files on disk.",
        args: [{ key: "name", label: "Version name", type: "string", required: true }],
      },
      {
        id: "restore",
        inheritFlags: true,
        label: "restore",
        summary: "Restore a version, keeping a recovery snapshot first.",
        args: [{ key: "id", label: "Version ID", type: "string", required: true }],
        flags: [
          {
            key: "--base",
            flag: "--base",
            label: "Current fingerprint",
            type: "string",
            required: true,
          },
        ],
      },
    ],
    meta: { effect: "write", cost: "free", speed: "short", cancellable: false, helpMode: "flag" },
  },
  {
    id: "collab",
    label: "collab",
    category: "daily",
    summary: "Read protected Studio edits and save intentional AI revisions with an explicit base.",
    runner: "bun-file",
    target: "packages/live-studio/collab.mjs",
    cwdModes: ["root", "film"],
    subcommandRequired: true,
    flags: [{ key: "--film", flag: "--film", label: "Film path", type: "string" }],
    subcommands: [
      {
        id: "read",
        inheritFlags: true,
        label: "read",
        summary: "Read the canonical document and retained-write notices.",
        args: [
          {
            key: "name",
            label: "Document",
            type: "string",
            required: true,
            placeholder: "cam, lights, or keyFile edit name (e.g. cast)",
          },
        ],
        flags: [
          {
            key: "--full",
            flag: "--full",
            label: "Include full incoming notice payloads",
            type: "boolean",
          },
        ],
        meta: { effect: "read" },
      },
      {
        id: "write",
        inheritFlags: true,
        label: "write",
        summary: "Save a JSON envelope with the base version read earlier.",
        args: [
          {
            key: "name",
            label: "Document",
            type: "string",
            required: true,
            placeholder: "cam, lights, or keyFile edit name (e.g. cast)",
          },
          {
            key: "input",
            label: "JSON envelope path (or '-' for stdin)",
            type: "string",
            required: true,
            placeholder: "- or payload.json",
          },
        ],
        flags: [
          {
            key: "--quiet",
            flag: "--quiet",
            label: "Compact JSON output",
            type: "boolean",
          },
        ],
      },
      {
        id: "write-many",
        inheritFlags: true,
        label: "write-many",
        summary: "Atomically save multiple documents via /api/together with strict base checks.",
        args: [
          {
            key: "input",
            label: "Batch JSON path (or '-' for stdin)",
            type: "string",
            required: true,
            placeholder: "- or batch.json",
          },
        ],
        flags: [
          {
            key: "--quiet",
            flag: "--quiet",
            label: "Compact JSON output",
            type: "boolean",
          },
        ],
      },
    ],
    meta: { effect: "write", cost: "free", speed: "instant", cancellable: false, helpMode: "flag" },
  },
  {
    id: "skills",
    label: "skills",
    category: "daily",
    summary: "Read version-matched AI guides or locate a repo agent skill and its resources.",
    runner: "bun-script",
    target: "skills",
    cwdModes: ["film", "root"],
    flags: [
      { key: "--json", flag: "--json", label: "JSON output", type: "boolean", tier: "common" },
    ],
    meta: {
      effect: "read",
      cost: "free",
      speed: "instant",
      cancellable: false,
      helpMode: "flag",
    },
    subcommands: [
      {
        id: "list",
        label: "list",
        summary: "List the available version-matched guides and repo agent skills.",
        inheritFlags: true,
      },
      {
        id: "path",
        label: "path",
        summary: "Print a guide or repo agent-skill directory; open SKILL.md there.",
        inheritFlags: true,
        args: [
          {
            key: "name",
            label: "Guide or agent skill (optional)",
            type: "string",
            placeholder: "earshot",
            hint: "core, earshot, real-sound, or another repo skill. Omit for skill-data/.",
          },
        ],
      },
      {
        id: "get",
        label: "get",
        summary: "Read a skill guide (e.g. core) and optionally specific reference sections.",
        inheritFlags: true,
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
      "Find native and imported assets, toon faces, 3D objects, and code helpers. Inspect recipes, previews, and placement commands.",
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
        hint: "Keywords then OpenFilm meaning candidates. Toon faces also match common Vietnamese aliases.",
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
        hint: "Examples include face, face/ramp, face/mark, sound, mocap, object (3D), transition, text, filter, and effect. Omit value to list groups.",
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
        key: "--group",
        flag: "--group",
        label: "Category / Visual Group",
        type: "string",
        optionalValue: true,
        ...bareListCopy("catalogue groups"),
        tier: "advanced",
        hint: "Native category or imported visual group, e.g. Basic or fade",
      },
      {
        key: "--offset",
        flag: "--offset",
        label: "Page offset",
        type: "number",
        tier: "advanced",
        hint: "Skip N entries in offline lists or word results; combine with -n",
      },
      {
        key: "--jev",
        flag: "--jev",
        label: "Use Jev AI Judge",
        exclusiveGroup: "search-engine",
        type: "boolean",
        tier: "common",
        hint: "Rank by meaning using Jev (OpenCode free -> OpenRouter <$0.01)",
      },
      {
        key: "--semantic",
        flag: "--semantic",
        label: "Hybrid semantic search",
        type: "boolean",
        exclusiveGroup: "search-engine",
        hint: "Local vectors + keywords. Requires a prepared index; cached queries stay offline.",
      },
      {
        key: "--json",
        flag: "--json",
        label: "JSON results",
        type: "boolean",
        tier: "advanced",
        hint: "Schema v2: independent blocks; semantic hits marked alsoKeyword reference keyword records by key. Explicit --semantic keeps its vector-index schema.",
      },
      {
        key: "--offline",
        flag: "--offline",
        label: "Cached searches only",
        type: "boolean",
        tier: "common",
        hint: "Skip external queries and read saved results. Cannot combine with --jev or --yes.",
      },
      {
        key: "--yes",
        flag: "--yes",
        label: "Allow query API",
        type: "boolean",
        visibleWhen: { field: "--semantic", in: ["true"] },
        requiresConfirmIfSet: true,
        hint: "Permit an external query embedding on a cache miss; provider billing/quota applies.",
      },
      {
        key: "--db",
        flag: "--db",
        label: "Semantic database",
        type: "string",
        visibleWhen: { field: "--semantic", in: ["true"] },
        tier: "advanced",
      },
      {
        key: "--provider",
        flag: "--provider",
        label: "Embedding provider",
        type: "enum",
        options: ["auto", "gemini", "openrouter"],
        visibleWhen: { field: "--semantic", in: ["true"] },
        tier: "advanced",
        hint: "Gemini by default; auto is a Gemini alias. OpenRouter requires explicit selection.",
      },
      {
        key: "--dimensions",
        flag: "--dimensions",
        label: "Embedding dimensions",
        type: "enum",
        options: ["768", "1536", "3072"],
        visibleWhen: { field: "--semantic", in: ["true"] },
        tier: "advanced",
      },
      {
        key: "-n",
        flag: "-n",
        label: "Limit (-n)",
        type: "number",
        tier: "common",
        placeholder: "12",
        hint: "Hits per independent block (default 12, max 200)",
      },
      {
        key: "--show",
        flag: "--show",
        label: "Show ID(s)",
        type: "csv",
        tier: "common",
        placeholder: "dissolve",
        hint: "Full recipe, source, units, example controls and placement ID; code helpers include scene snippets",
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
        options: ["real", "synth", "unknown"],
        optionalValue: true,
        ...bareListCopy("origin values"),
        tier: "advanced",
        hint: "Real / Studio is a grouping, not verified recording provenance. Inspect --show for explicit unknown origins.",
      },
      {
        key: "--edition",
        flag: "--edition",
        label: "MC Edition",
        type: "enum",
        options: ["vanilla", "modded"],
        optionalValue: true,
        ...bareListCopy("MC editions"),
        visibleWhen: {
          field: "--kind",
          unsetOrStartsWith: [
            "mc",
            "minecraft",
            "sound",
            "sounds",
            "audio",
            "block",
            "blocks",
            "item",
            "items",
            "mob",
            "mobs",
            "object",
            "objects",
            "3d",
            "entity",
            "entities",
            "creature",
            "creatures",
            "model",
            "models",
          ],
        },
        tier: "advanced",
        hint: "Minecraft sounds and 3D objects: vanilla or modded packs",
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
        key: "--variants",
        flag: "--variants",
        label: "Expand Variants",
        type: "boolean",
        visibleWhen: {
          field: "--kind",
          unsetOrStartsWith: [
            "block",
            "blocks",
            "item",
            "items",
            "mob",
            "mobs",
            "prop",
            "props",
            "custom",
            "object",
            "objects",
            "3d",
            "entity",
            "entities",
            "creature",
            "creatures",
            "model",
            "models",
          ],
        },
        tier: "advanced",
        hint: "With 3D object kinds: unfold grouped wood/color/tier variants onto separate lines",
      },
      {
        key: "--broken",
        flag: "--broken",
        label: "Include Broken",
        type: "boolean",
        visibleWhen: {
          field: "--kind",
          unsetOrStartsWith: [
            "block",
            "blocks",
            "item",
            "items",
            "mob",
            "mobs",
            "prop",
            "props",
            "custom",
            "object",
            "objects",
            "3d",
            "entity",
            "entities",
            "creature",
            "creatures",
            "model",
            "models",
          ],
        },
        tier: "advanced",
        hint: "With 3D object kinds: include non-renderable models (.geo.json, .obj, custom loaders, missing parent/texture)",
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
        key: "--kit",
        flag: "--kit",
        label: "Core Sound Kit",
        type: "enum",
        options: KIT_CATEGORY_IDS,
        optionalValue: true,
        bareLabel: "(bare flag — all approved Core Kit sounds)",
        bareHint: "Omit value to search across all 8 approved Core Sound Kit categories",
        visibleWhen: {
          field: "--kind",
          unsetOrStartsWith: [
            "sound",
            "sounds",
            "audio",
            "sfx",
            "sfxs",
            "effect",
            "effects",
            "bgm",
            "bgms",
            "music",
            "song",
            "songs",
            "soundtrack",
            "soundtracks",
            "mc",
            "minecraft",
          ],
        },
        tier: "common",
        hint: "Only human-approved Core Sound Kit sounds (sound-kit/core.json); all or one category",
      },
      {
        key: "--include-banned",
        flag: "--include-banned",
        label: "Include Banned",
        type: "boolean",
        visibleWhen: {
          field: "--kind",
          unsetOrStartsWith: [
            "sound",
            "sounds",
            "audio",
            "sfx",
            "sfxs",
            "effect",
            "effects",
            "bgm",
            "bgms",
            "music",
            "song",
            "songs",
            "soundtrack",
            "soundtracks",
            "mc",
            "minecraft",
          ],
        },
        tier: "advanced",
        hint: "Include sounds marked ban in sound-kit/core.json (excluded from sound search by default)",
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
        key: "--style",
        flag: "--style",
        label: "Style",
        type: "string",
        placeholder: "natural",
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
      costHint:
        "Default queries send text to OpenFilm without a key; --offline reads cache only. --semantic --yes uses provider quota/billing; --jev uses its judge service.",
      speed: "instant",
      cancellable: true,
      helpMode: "flag",
      envAnyOf: [["OPENCODE_API_KEY", "OPENROUTER_API_KEY"]],
      confirm: {
        mode: "when-flagged",
        message:
          "--yes permits sending this query to the selected provider; its quota, billing and data-use terms apply.",
      },
    },
  },
  {
    id: "assets:semantic",
    subcommandRequired: true,
    label: "assets:semantic",
    category: "setup",
    summary: "Prepare incremental local multimodal embeddings; preview first, API only with --yes.",
    runner: "bun-file",
    target: "scripts/asset-search.ts",
    cwdModes: ["root", "film"],
    flags: [
      {
        key: "--provider",
        flag: "--provider",
        label: "Embedding provider",
        type: "enum",
        options: ["auto", "gemini", "openrouter"],
        hint: "Gemini by default; auto is a Gemini alias. OpenRouter requires explicit selection.",
      },
      {
        key: "--db",
        flag: "--db",
        label: "Index database",
        type: "string",
        hint: "MC_SEMANTIC_DB or repository .studio/asset-search.sqlite; quota accounting is shared across overrides.",
      },
      {
        key: "--dimensions",
        flag: "--dimensions",
        label: "Dimensions",
        type: "enum",
        options: ["768", "1536", "3072"],
        tier: "advanced",
      },
    ],
    subcommands: [
      {
        id: "plan",
        inheritFlags: true,
        label: "plan",
        summary: "Count catalog assets and sample keys without embedding or vector writes.",
        flags: assetSelectionFlags,
      },
      {
        id: "build",
        inheritFlags: true,
        label: "build",
        summary: "Preview by default; --yes prepares missing/changed chunks and saves each result.",
        flags: [
          ...assetSelectionFlags,
          {
            key: "--yes",
            flag: "--yes",
            label: "Allow embedding API",
            type: "boolean",
            requiresConfirmIfSet: true,
          },
          {
            key: "--max-requests",
            flag: "--max-requests",
            label: "Request limit",
            type: "number",
            hint: "Default 10 attempts; at most 100000.",
          },
          {
            key: "--max-seconds",
            flag: "--max-seconds",
            label: "Time limit (seconds)",
            type: "number",
            hint: "Default 60; at most 3600. Completed work survives stopping.",
          },
          {
            key: "--rpm",
            flag: "--rpm",
            label: "Requests per minute",
            type: "number",
            hint: "Default 60; use your project's limit.",
          },
          {
            key: "--tpm",
            flag: "--tpm",
            label: "Input tokens per minute",
            type: "number",
            hint: "Estimated including media; default 24000.",
          },
          {
            key: "--retries",
            flag: "--retries",
            label: "Transient retries per chunk",
            type: "number",
            tier: "advanced",
            hint: "Default 2, range 0–5; every attempt counts toward request/time and daily budgets.",
          },
        ],
      },
      {
        id: "status",
        inheritFlags: true,
        label: "status",
        summary: "Read catalog coverage, resumable chunks and the shared daily request budget.",
        flags: [assetManifestFlag, semanticObjectKindFlag],
      },
      {
        id: "eval",
        inheritFlags: true,
        label: "eval",
        summary:
          "Compare cached lexical, semantic and hybrid retrieval; report missing data separately without API calls.",
        args: [{ key: "cases", label: "Labeled cases JSON", type: "string", required: true }],
        flags: [
          semanticObjectKindFlag,
          {
            key: "--out",
            flag: "--out",
            label: "New report JSON",
            type: "string",
            hint: "Optional; refuses to overwrite an existing report. Partial reports exit 1.",
          },
        ],
      },
      {
        id: "query",
        inheritFlags: true,
        label: "query",
        summary: "Search all indexed assets; cached queries work offline.",
        args: [{ key: "query", label: "Scene or meaning", type: "string", required: true }],
        flags: [
          {
            key: "--yes",
            flag: "--yes",
            label: "Allow query API",
            type: "boolean",
            requiresConfirmIfSet: true,
          },
        ],
      },
      {
        id: "remove",
        inheritFlags: true,
        label: "remove",
        summary:
          "Remove an asset from search; retain vectors for re-adding identical inputs without API calls.",
        args: [{ key: "key", label: "Exact asset key", type: "string", required: true }],
        flags: [
          {
            key: "--purge",
            flag: "--purge",
            label: "Permanently delete retained vectors",
            type: "boolean",
            requiresConfirmIfSet: true,
          },
        ],
        meta: {
          effect: "write",
          confirm: {
            mode: "when-flagged",
            message:
              "Permanently delete this asset's retained vectors with --purge. Original media files are never deleted.",
          },
        },
      },
      {
        id: "redo",
        inheritFlags: true,
        label: "redo",
        summary: "Reset one asset or chunk locally; next build retries it.",
        args: [{ key: "key", label: "Exact asset key", type: "string", required: true }],
        flags: [
          { key: "--part", flag: "--part", label: "Chunk number (starts at 0)", type: "number" },
        ],
        meta: { effect: "write" },
      },
      {
        id: "backup",
        inheritFlags: true,
        label: "backup",
        summary: "Create a consistent SQLite snapshot; refuse an existing destination.",
        args: [{ key: "file", label: "New backup file", type: "string", required: true }],
        meta: { effect: "write" },
      },
    ],
    meta: {
      effect: "read",
      cost: "free",
      speed: "instant",
      cancellable: true,
      helpMode: "flag",
      costHint:
        "No API without --yes. Build can be resumed; an interrupted request may be charged and need retry.",
      confirm: {
        mode: "when-flagged",
        message:
          "Send selected media/text to the chosen provider within request/time limits. Billing/quota and data-use terms apply.",
      },
    },
  },
  {
    id: "check",
    label: "check",
    category: "daily",
    summary:
      "Validate film data offline: timelines, sound names, lip-sync requirements and text readability. Use render stills --check pops for scene motion.",
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
        label: "Playback time or note",
        type: "string",
        required: true,
        choiceSource: "notes",
        placeholder: "35.6 or 00:35.633 or #52",
        hint: "Enter playback seconds, a timecode, or a note number or ID.",
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
        key: "--deleted",
        flag: "--deleted",
        label: "Deleted Notes",
        type: "boolean",
        tier: "common",
      },
      {
        key: "--json",
        flag: "--json",
        label: "Structured JSON",
        type: "boolean",
        tier: "common",
        hint: "Export selected notes without Jev lesson lookup",
      },
      {
        key: "--no-lessons",
        flag: "--no-lessons",
        label: "Skip Lesson Lookup",
        type: "boolean",
        tier: "common",
        hint: "Print text note details without running Jev lesson lookup",
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
        "List, --json, and --no-lessons are free. Text detail runs Jev lesson lookup when configured.",
      speed: "instant",
      cancellable: true,
      helpMode: "flag",
    },
  },
  {
    id: "note",
    label: "note",
    category: "daily",
    summary: "Respond to a creator note or restore a deleted one.",
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
        summary:
          "Mark note fixed and queue it for creator check (requires --after image or --no-after reason).",
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
        flags: [
          {
            key: "--after",
            flag: "--after",
            label: "After Image",
            type: "string",
            placeholder: "renders/still_12s.jpg",
            hint: "Proof frame after fixing (PNG/JPG/WebP). Capture a custom --inspect angle if the target moved.",
          },
          {
            key: "--no-after",
            flag: "--no-after",
            label: "No-After Reason",
            type: "string",
            placeholder: "Audio-only mix tweak; no visual change",
            hint: "Required if --after is omitted; pass either --after or --no-after.",
          },
          {
            key: "--cam",
            flag: "--cam",
            label: "Custom Camera View",
            type: "string",
            tier: "advanced",
            placeholder: "px,py,pz,lx,ly,lz,fov",
            hint: "Custom FreeCam pose (same 6-7 numbers as render --inspect) to fly creator straight to fixed spot.",
          },
          {
            key: "--t",
            flag: "--t",
            label: "After Timestamp",
            type: "string",
            tier: "advanced",
            placeholder: "12.5",
            hint: "Heard second or mm:ss where the After view lives if timing shifted.",
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
        flags: [
          {
            key: "--after",
            flag: "--after",
            label: "Reference Image",
            type: "string",
            tier: "advanced",
            placeholder: "renders/still_12s.jpg",
            hint: "Optional image attached to your question.",
          },
          {
            key: "--cam",
            flag: "--cam",
            label: "Custom Camera View",
            type: "string",
            tier: "advanced",
            placeholder: "px,py,pz,lx,ly,lz,fov",
            hint: "Optional FreeCam pose to inspect alongside the question.",
          },
          {
            key: "--t",
            flag: "--t",
            label: "Timestamp",
            type: "string",
            tier: "advanced",
            placeholder: "12.5",
            hint: "Optional heard second or mm:ss for the attached view.",
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
      {
        id: "restore",
        label: "restore",
        summary: "Restore a deleted note using its stable ID from notes --deleted.",
        args: [{ key: "id", label: "Deleted Note ID", type: "string", required: true }],
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

  SOUND_KIT_CLI_COMMAND,
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
        hint: "Whole-film renders update draft/final; other videos get separate previews",
      },
    ],
    flags: [
      {
        key: "--start",
        flag: "--start",
        label: "Film Audio Start",
        type: "string",
        tier: "advanced",
        placeholder: "40",
      },
    ],
    meta: {
      effect: "write",
      cost: "free",
      speed: "short",
      cancellable: true,
      helpMode: "flag",
      outputsHint: "Writes sound/mix.wav and canonical draft/final, or renders/mixed_*/preview.mp4",
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
    summary:
      "Make sound effects from words or parts (make, build, sounds, recipe, pack) and analyze, match, or critique audio.",
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
        id: "make",
        label: "make",
        summary: "Make a sound from a request in words (or a whole set from --set / --spec).",
        args: [
          {
            key: "want",
            label: "Sound Request",
            type: "string",
            placeholder: "a soft wooden knock",
            hint: "Words describing the sound; omit when using --set, --spec, --sound, or --recipe.",
          },
        ],
        flags: [
          {
            key: "-o",
            flag: "-o",
            label: "Output File / Folder",
            type: "string",
            tier: "common",
            placeholder: "sound/sfx/knock.wav",
            hint: "File path (extension picks format) or output folder with --set / --spec.",
          },
          {
            key: "--set",
            flag: "--set",
            label: "Ready-Made Set",
            type: "enum",
            options: ["ui", "game", "arcade", "film"],
            tier: "common",
          },
          {
            key: "--spec",
            flag: "--spec",
            label: "Set Spec JSON",
            type: "string",
            tier: "common",
            placeholder: "sounds.json",
          },
          {
            key: "--sound",
            flag: "--sound",
            label: "Design ID",
            type: "string",
            tier: "common",
            placeholder: "step/pebbles",
          },
          {
            key: "--recipe",
            flag: "--recipe",
            label: "Recipe (JSON / cookbook)",
            type: "string",
            tier: "common",
            placeholder: "car_crash",
          },
          { key: "--n", flag: "--n", label: "Takes", type: "number", tier: "common" },
          { key: "--seed", flag: "--seed", label: "Seed", type: "number", tier: "common" },
          {
            key: "--dur",
            flag: "--dur",
            label: "Duration (s)",
            type: "number",
            tier: "common",
          },
          {
            key: "--events",
            flag: "--events",
            label: "Events Count",
            type: "number",
            tier: "common",
          },
          {
            key: "--pitch",
            flag: "--pitch",
            label: "Pitch (note/Hz)",
            type: "string",
            tier: "advanced",
            placeholder: "C5",
          },
          {
            key: "--theme",
            flag: "--theme",
            label: "Theme",
            type: "enum",
            options: [
              "soft",
              "glass",
              "wood",
              "felt",
              "tine",
              "metal",
              "electric",
              "digital",
              "retro",
            ],
            tier: "advanced",
          },
          {
            key: "--voice",
            flag: "--voice",
            label: "Voice / Instrument",
            type: "string",
            tier: "advanced",
            placeholder: "marimba",
          },
          {
            key: "--material",
            flag: "--material",
            label: "Material",
            type: "string",
            tier: "advanced",
            placeholder: "wood",
          },
          {
            key: "--format",
            flag: "--format",
            label: "Set Format(s)",
            type: "string",
            tier: "advanced",
            placeholder: "wav",
          },
          {
            key: "--sprite",
            flag: "--sprite",
            label: "Sprite File",
            type: "string",
            tier: "advanced",
          },
          { key: "--lufs", flag: "--lufs", label: "Target LUFS", type: "number", tier: "advanced" },
          { key: "--mono", flag: "--mono", label: "Mono", type: "boolean", tier: "advanced" },
          {
            key: "--no-loop",
            flag: "--no-loop",
            label: "No Loop (fade once)",
            type: "boolean",
            tier: "advanced",
          },
          {
            key: "--listen",
            flag: "--listen",
            label: "Rank & Hear with CLAP",
            type: "boolean",
            tier: "advanced",
          },
          ...(
            ["bright", "hard", "ring", "size", "space", "width", "energy", "motion"] as const
          ).map((axis): CliFlagDef => ({
            key: `--${axis}`,
            flag: `--${axis}`,
            label: `Axis: ${axis} (-1..1)`,
            type: "number",
            tier: "advanced",
          })),
          ...earshotStd(),
        ],
        meta: { effect: "write", speed: "short" },
      },
      {
        id: "sounds",
        label: "sounds",
        summary: "Search or filter the catalogue of designs `earshot make` can render.",
        flags: [
          {
            key: "--search",
            flag: "--search",
            label: "Search Words",
            type: "string",
            tier: "common",
            placeholder: "footstep gravel",
          },
          {
            key: "--domain",
            flag: "--domain",
            label: "Domain",
            type: "enum",
            options: ["ui", "game", "motion", "ambience", "music"],
            tier: "common",
          },
          { key: "--kind", flag: "--kind", label: "Kind", type: "string", tier: "common" },
          { key: "--family", flag: "--family", label: "Family", type: "string", tier: "common" },
          ...earshotStd(),
        ],
        meta: { effect: "read", speed: "instant" },
      },
      {
        id: "recipe",
        label: "recipe",
        summary: "Inspect, list, or validate multi-layer recipes and the built-in cookbook.",
        args: [
          {
            key: "name",
            label: "Cookbook Recipe Name",
            type: "string",
            placeholder: "car_crash",
          },
        ],
        flags: [
          {
            key: "--list",
            flag: "--list",
            label: "List Cookbook Recipes",
            type: "boolean",
            tier: "common",
          },
          {
            key: "--example",
            flag: "--example",
            label: "Show Example Recipes",
            type: "boolean",
            tier: "common",
          },
          {
            key: "--check",
            flag: "--check",
            label: "Check Recipe JSON",
            type: "string",
            tier: "common",
            placeholder: "roar.json",
          },
          ...earshotStd(),
        ],
        meta: { effect: "read", speed: "instant" },
      },
      {
        id: "build",
        label: "build",
        summary:
          "Build a sound the catalogue lacks from recorded parts: draft, render, hear, and tune.",
        args: [
          {
            key: "want",
            label: "Sound Request",
            type: "string",
            required: true,
            placeholder: "a stampede of horses",
          },
        ],
        flags: [
          {
            key: "-o",
            flag: "-o",
            label: "Output File",
            type: "string",
            tier: "common",
            placeholder: "sound/sfx/stampede.wav",
          },
          {
            key: "--part",
            flag: "--part",
            label: "Part Phrase(s)",
            type: "string",
            multi: true,
            multiStyle: "repeat",
            tier: "common",
            placeholder: "hundreds of hoofbeats, for 6 s, getting louder",
          },
          {
            key: "--recipe",
            flag: "--recipe",
            label: "Starting Recipe",
            type: "string",
            tier: "common",
          },
          {
            key: "--rounds",
            flag: "--rounds",
            label: "Tuning Rounds",
            type: "number",
            tier: "common",
            placeholder: "20",
          },
          {
            key: "--without",
            flag: "--without",
            label: "Exclude Design/Family",
            type: "string",
            multi: true,
            multiStyle: "args",
            tier: "advanced",
          },
          { key: "--seed", flag: "--seed", label: "Seed", type: "number", tier: "advanced" },
          {
            key: "--no-listen",
            flag: "--no-listen",
            label: "Skip Listening Model",
            type: "boolean",
            tier: "common",
          },
          ...earshotStd(),
        ],
        meta: { effect: "write", speed: "long" },
      },
      {
        id: "pack",
        label: "pack",
        summary: "Pack multiple sound files or a folder into one audio sprite with a map.",
        args: [
          {
            key: "files",
            label: "Audio Files / Folder",
            type: "string",
            required: true,
            multi: true,
            placeholder: "sound/sfx/",
          },
        ],
        flags: [
          {
            key: "-o",
            flag: "-o",
            label: "Output Sprite File",
            type: "string",
            required: true,
            tier: "common",
            placeholder: "sprite.ogg",
          },
          {
            key: "--gap",
            flag: "--gap",
            label: "Silence Gap (s)",
            type: "number",
            tier: "common",
          },
          { key: "--mono", flag: "--mono", label: "Mono", type: "boolean", tier: "advanced" },
          ...earshotStd(),
        ],
        meta: { effect: "write", speed: "short" },
      },
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
      helpMode: "flag",
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
      helpMode: "flag",
      outputsHint: "Writes <vaultDir>/PEAKS.json and .peaks-cache.json",
    },
  },

  {
    id: "reference",
    label: "reference",
    category: "render",
    summary:
      "Add a reference, make timecoded review media, inspect frames and captions, study timing, compare timing and per-shot look, or matchmove a shot's camera. Advisory analysis.",
    runner: "bun-script",
    target: "reference",
    cwdModes: ["film", "root"],
    args: [
      {
        key: "operation",
        label: "Operation",
        type: "enum",
        options: [
          "add",
          "timecode",
          "sidebyside",
          "frames",
          "inspect",
          "study",
          "compare",
          "solve",
        ],
        required: true,
      },
      {
        key: "reference",
        label: "Reference Video / URL (solve: Shot File)",
        type: "string",
        required: true,
      },
      {
        key: "remake",
        label: "Remake Video",
        type: "string",
        requiredWhen: { field: "operation", in: ["compare", "sidebyside"] },
        visibleWhen: { field: "operation", in: ["compare", "sidebyside", "frames"] },
        hint: "Optional for frames (omit for single-source timecoded stills).",
      },
    ],
    flags: [
      {
        key: "--out",
        flag: "--out",
        label: "Output File / Report Folder",
        type: "string",
        visibleWhen: {
          field: "operation",
          in: ["timecode", "sidebyside", "frames", "inspect", "study", "compare"],
        },
      },
      {
        key: "--start",
        flag: "--start",
        label: "Reference Start Offset (sec)",
        type: "string",
        placeholder: "12.0",
        exclusiveGroup: "reference-window",
        visibleWhen: {
          field: "operation",
          in: ["sidebyside"],
          or: { field: "operation", in: ["frames"], and: { field: "remake", nonEmpty: true } },
        },
        hint: "Two-video sidebyside/frames only.",
      },
      {
        key: "--range",
        flag: "--range",
        label: "Shared Film Time Range",
        type: "string",
        placeholder: "1:45,3:35",
        exclusiveGroup: "reference-window",
        visibleWhen: { field: "operation", in: ["sidebyside", "frames"] },
        hint: "Film seconds (from,to). Omit on span_*.mp4 to auto-align; floor end to min(refEnd, remEnd).",
      },
      {
        key: "--fps",
        flag: "--fps",
        label: "Sample FPS (or native)",
        type: "string",
        placeholder: "15",
        visibleWhen: { field: "operation", in: ["frames"] },
      },
      {
        key: "--batch-size",
        flag: "--batch-size",
        label: "Max Images per List",
        type: "number",
        placeholder: "450",
        visibleWhen: { field: "operation", in: ["frames"] },
      },
      {
        key: "--label",
        flag: "--label",
        label: "Timecode Strip Label",
        type: "string",
        placeholder: "REFERENCE",
        visibleWhen: {
          field: "operation",
          in: ["timecode"],
          or: { field: "operation", in: ["frames"], and: { field: "remake", nonEmpty: false } },
        },
        hint: "Single-video timecode or single-source frames only (omit Remake Video).",
      },
      {
        key: "--short-edge",
        flag: "--short-edge",
        label: "Max Short Edge (px)",
        type: "number",
        placeholder: "720",
        exclusiveGroup: "reference-size",
        visibleWhen: { field: "operation", in: ["timecode", "sidebyside", "frames"] },
      },
      {
        key: "--full",
        flag: "--full",
        label: "Keep Native Resolution",
        type: "boolean",
        exclusiveGroup: "reference-size",
        visibleWhen: { field: "operation", in: ["timecode", "sidebyside", "frames"] },
      },
      {
        key: "--crf",
        flag: "--crf",
        label: "H.264 CRF (0-51)",
        type: "number",
        placeholder: "22",
        visibleWhen: { field: "operation", in: ["timecode", "sidebyside"] },
      },
      {
        key: "--audio",
        flag: "--audio",
        label: "Side-by-Side Audio Track",
        type: "enum",
        options: ["ours", "ref", "none"],
        visibleWhen: { field: "operation", in: ["sidebyside"] },
      },
      {
        key: "--layout",
        flag: "--layout",
        label: "Side-by-Side Layout",
        type: "enum",
        options: ["auto", "hstack", "vstack"],
        visibleWhen: {
          field: "operation",
          in: ["sidebyside"],
          or: { field: "operation", in: ["frames"], and: { field: "remake", nonEmpty: true } },
        },
        hint: "Two-video sidebyside/frames only.",
      },
      {
        key: "--name",
        flag: "--name",
        label: "Name in references/",
        type: "string",
        placeholder: "ref",
        visibleWhen: { field: "operation", in: ["add"] },
      },
      {
        key: "--video",
        flag: "--video",
        label: "Reference Video",
        type: "string",
        placeholder: "references/ref.mp4",
        visibleWhen: { field: "operation", in: ["solve"] },
      },
      {
        key: "--write",
        flag: "--write",
        label: "Write Keys to cam.json",
        type: "boolean",
        visibleWhen: { field: "operation", in: ["solve"] },
      },
      {
        key: "--transcript",
        flag: "--transcript",
        label: "VTT / SRT / Segment JSON",
        type: "string",
        visibleWhen: { field: "operation", in: ["inspect"] },
      },
      {
        key: "--detail",
        flag: "--detail",
        label: "Evidence",
        type: "enum",
        options: ["overview", "transcript"],
        visibleWhen: { field: "operation", in: ["inspect"] },
      },
      {
        key: "--start",
        flag: "--start",
        label: "Source Start",
        type: "string",
        visibleWhen: { field: "operation", in: ["inspect"] },
      },
      {
        key: "--end",
        flag: "--end",
        label: "Source End",
        type: "string",
        visibleWhen: { field: "operation", in: ["inspect"] },
      },
      {
        key: "--at",
        flag: "--at",
        label: "Pinned Source Seconds",
        type: "string",
        visibleWhen: { field: "operation", in: ["inspect"] },
      },
      {
        key: "--frames",
        flag: "--frames",
        label: "Frame Budget (1–96)",
        type: "number",
        visibleWhen: { field: "operation", in: ["inspect"] },
      },
      {
        key: "--scenes",
        flag: "--scenes",
        label: "Add Estimated Scene Changes",
        type: "boolean",
        visibleWhen: { field: "operation", in: ["inspect"] },
      },
      {
        key: "--find",
        flag: "--find",
        label: "Find Transcript Text",
        type: "string",
        visibleWhen: { field: "operation", in: ["inspect"] },
      },
      {
        key: "--language",
        flag: "--language",
        label: "URL Caption Language",
        type: "string",
        visibleWhen: { field: "operation", in: ["inspect"] },
      },
      {
        key: "--cookies",
        flag: "--cookies",
        label: "Explicit URL Cookie Jar",
        type: "string",
        exclusiveGroup: "reference-auth",
        visibleWhen: { field: "operation", in: ["inspect"] },
      },
      {
        key: "--cookies-from-browser",
        flag: "--cookies-from-browser",
        label: "Explicit URL Browser / Profile",
        type: "string",
        exclusiveGroup: "reference-auth",
        visibleWhen: { field: "operation", in: ["inspect"] },
      },
      {
        key: "--js-runtime",
        flag: "--js-runtime",
        label: "URL JavaScript Runtime",
        type: "string",
        visibleWhen: { field: "operation", in: ["inspect"] },
      },
      {
        key: "--expect-source-sha256",
        flag: "--expect-source-sha256",
        label: "Expected Local Source SHA-256",
        type: "string",
        tier: "advanced",
        visibleWhen: { field: "operation", in: ["inspect"] },
      },
      {
        key: "--minutes",
        flag: "--minutes",
        label: "Time Limit (minutes)",
        type: "number",
        hint: "See the selected operation's help for its default and limit.",
      },
      {
        key: "--fit",
        flag: "--fit",
        label: "Scale Remake Timing",
        type: "boolean",
        visibleWhen: { field: "operation", in: ["compare"] },
        hint: "Align the remake to the reference duration and total motion over each aligned interval.",
      },
      {
        key: "--film",
        flag: "--film",
        label: "Optional OpenFilm film.html",
        type: "string",
        visibleWhen: { field: "operation", in: ["compare"] },
      },
    ],
    meta: {
      effect: "write",
      cost: "free",
      speed: "long",
      cancellable: true,
      helpMode: "flag",
      outputsHint:
        "add copies the video into references/ (an H.264 copy beside the untouched source when needed). timecode writes an H.264 review copy with a bottom timecode strip. sidebyside writes a synced REF/OURS MP4 with a shared timecode. frames uses the same alignment to write JPEGs at up to 15 fps and lists of up to 450 images in a fresh run-* folder for --batch --files-from. --range cuts sidebyside or frames to one film-time window. solve writes solve.json and sheet.jpg to renders/reference/solve/<shot>/run-*; --write replaces the shot's span in the camera timeline. In a fresh run-* folder, inspect writes index.json, raw captions and frames, and study/compare write JSON and Markdown reports. After bun run media setup camera, compare adds Look per shot (camera and subject motion, brightness, warmth and focus). URL inspection uses yt-dlp. No speech models or paid AI.",
    },
  },
  {
    id: "render",
    label: "render",
    category: "render",
    summary:
      "Render drafts, captions, posters or final video. Final checks for pops and foot slides before encoding. Run --check for scene diagnostics on demand.",
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
    flags: [
      {
        key: "--at",
        flag: "--at",
        label: "Heard Seconds",
        type: "string",
        visibleWhen: { field: "target", in: ["stills", "poster", "all"] },
        requiredWhen: { field: "target", in: ["poster"] },
        tier: "common",
        placeholder: "12,30.5",
        hint: "Comma-separated heard seconds (e.g. 40,41.5 or 0:40,0:41.5)",
      },
      {
        key: "--list",
        flag: "--list",
        label: "Describe Overlay",
        type: "boolean",
        visibleWhen: { field: "target", in: ["stills", "all"] },
        tier: "common",
        hint: "Draw scene description HUD on stills (leave off before framecheck)",
      },
      {
        key: "--span",
        flag: "--span",
        label: "Span (from,to sec)",
        type: "string",
        exclusiveGroup: "render-slice",
        visibleWhen: { field: "target", in: ["clip"] },
        tier: "common",
        placeholder: "40,44",
      },
      {
        key: "--chunks",
        flag: "--chunks",
        label: "Chunks (0-based idx)",
        type: "string",
        exclusiveGroup: "render-slice",
        visibleWhen: { field: "target", in: ["clip", "all", "final"] },
        tier: "common",
        placeholder: "3,4",
      },
      {
        key: "--crop",
        flag: "--crop",
        label: "Native crop (x,y,w,h)",
        type: "string",
        visibleWhen: { field: "target", in: ["stills", "poster"] },
        placeholder: "0.25,0.25,0.5,0.5",
        hint: "Normalized rectangle within the frame, rendered at native pixel density.",
      },
      {
        key: "--ref",
        flag: "--ref",
        label: "Reference Video",
        type: "string",
        visibleWhen: { field: "target", in: ["stills", "poster"] },
        placeholder: "references/ref.mp4",
        hint: "Place each still/poster beside the reference frame (renders/vs_*.jpg) with luma, saturation, and sharpness ratio. Incompatible with --inspect, --views, --crop, --entry, and --list.",
      },
      {
        key: "--ref-region",
        flag: "--ref-region",
        label: "Reference Region (x,y,w,h)",
        type: "string",
        visibleWhen: {
          field: "target",
          in: ["stills", "poster"],
          and: { field: "--ref", nonEmpty: true },
        },
        placeholder: "0.2,0.2,0.5,0.5",
        hint: "Normalized x,y,w,h subject box for mean RGB, brightness, and sharpness ratio isolated from burnt-in captions.",
      },
      {
        key: "--compare",
        flag: "--compare",
        label: "Compare with previous still",
        type: "boolean",
        visibleWhen: { field: "target", in: ["stills", "poster"] },
        hint: "Keep the old frame under renders/.prev/ and write a before/after comparison.",
      },
      {
        key: "--check",
        flag: "--check",
        label: "Check (pops/motion/seen/touch/text/order/probe)",
        type: "string",
        visibleWhen: { field: "target", in: ["stills", "all"] },
        tier: "common",
        placeholder: "pops or pops:20,45 or touch:handR,20,45 or motion:cam,81,83",
        hint: "Times are heard seconds. Pops (30 fps) writes renders/pops.json (misses .visible pop-ins and 3+ frame snaps; pair with framecheck). Prefer targeted 30 fps touch:<part>,<from>,<to> for thick solid contacts over slow 10 fps whole-film touch.",
      },
      {
        key: "--fresh-cache",
        flag: "--fresh-cache",
        label: "Fresh Chrome profile (bypass shader cache)",
        type: "boolean",
        visibleWhen: { field: "target", in: ["stills", "clip", "poster", "all", "final"] },
        tier: "advanced",
        hint: "Bypass renders/.chrome-cache/ and launch headless Chrome with an ephemeral temp profile.",
      },
      {
        key: "--samples",
        flag: "--samples",
        label: "Sub-frames (1-64)",
        type: "number",
        visibleWhen: { field: "target", in: ["stills", "clip", "final", "poster", "all"] },
        tier: "advanced",
        placeholder: "8",
        hint: "Motion blur: stills and clip default to 1, final and poster to 8. Draft forces apertureSamples=1; --samples 1 does not turn off post-DOF (fstop > 0).",
      },
      {
        key: "--res",
        flag: "--res",
        label: "Height Lines",
        type: "enum",
        options: ["1080", "1440", "2160"],
        visibleWhen: { field: "target", in: ["final", "poster"] },
        tier: "advanced",
      },
      {
        key: "--inspect",
        flag: "--inspect",
        label: "Free Cam (px,py,pz,lx,ly,lz,fov)",
        type: "string",
        exclusiveGroup: "render-camera",
        visibleWhen: { field: "target", in: ["stills", "all"] },
        tier: "advanced",
        placeholder: "0,2,5,0,1,0,50",
      },
      {
        key: "--views",
        flag: "--views",
        label: "Views (multi-angle spec or @json)",
        type: "string",
        exclusiveGroup: "render-camera",
        visibleWhen: { field: "target", in: ["stills", "poster"] },
        tier: "advanced",
        placeholder: "front:0,2,5,0,1,0,50;top:0,8,0.1,0,0,0,50",
        hint: "Render multiple named Free Cam viewpoints in a single Chrome boot (writes renders/view_<name>_<t>s.jpg; .png for poster).",
      },
      {
        key: "--entry",
        flag: "--entry",
        label: "Custom Lab Page",
        type: "string",
        choiceSource: "labs",
        visibleWhen: { field: "target", in: ["stills", "clip", "poster", "all"] },
        tier: "advanced",
        placeholder: "lab/prop.ts",
      },
      {
        key: "--lab",
        flag: "--lab",
        label: "Lab Values (key=value)",
        type: "string",
        multi: true,
        multiStyle: "repeat",
        visibleWhen: {
          field: "--entry",
          nonEmpty: true,
          and: { field: "target", in: ["stills", "clip", "poster", "all"] },
        },
        tier: "advanced",
        placeholder: "view=desk",
        hint: "Reaches the --entry page as cfg.lab.<key>.",
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
          "Final checks the whole film for pops and foot slides (up to 10 minutes), then runs a full-quality GPU encode if the check passes.",
      },
      outputsHint:
        "Writes into renders/ inside the film. The final pops check writes pops.json before encoding final_video.mp4. An explicit --check pops also writes pops.json.",
    },
  },
  {
    id: "sheet",
    label: "sheet",
    category: "render",
    summary:
      "Inspect file pictures: bounded overview, exact native frames, shot/cut sheets, rendered stills (or vs), or explicit image lists/globs.",
    runner: "bun-script",
    target: "sheet",
    cwdModes: ["film"],
    args: [
      {
        key: "video",
        label: "Video (Omit = Still PNGs)",
        type: "string",
        choiceSource: "renders",
        visibleWhen: { field: "images", nonEmpty: false },
        placeholder: "renders/draft_video.mp4",
      },
      {
        key: "target",
        label: "Times / overview / frames / shots / cut",
        type: "string",
        visibleWhen: { field: "images", nonEmpty: false },
        requiredWhen: { field: "video", nonEmpty: true, and: { field: "images", nonEmpty: false } },
        placeholder: "overview, frames, shots, cut, or 10,20,30",
      },
      {
        key: "cutIndex",
        label: "Cut # (with 'cut')",
        type: "number",
        visibleWhen: { field: "target", in: ["cut"], and: { field: "images", nonEmpty: false } },
        requiredWhen: { field: "target", in: ["cut"], and: { field: "images", nonEmpty: false } },
        placeholder: "4",
      },
      {
        key: "frameTimes",
        label: "Native Frame Times",
        type: "string",
        visibleWhen: { field: "target", in: ["frames"], and: { field: "images", nonEmpty: false } },
        requiredWhen: {
          field: "target",
          in: ["frames"],
          and: { field: "images", nonEmpty: false },
        },
        placeholder: "12.2-12.6/12",
      },
      {
        key: "overviewRange",
        label: "Overview Range (Optional)",
        type: "string",
        visibleWhen: {
          field: "target",
          in: ["overview"],
          and: { field: "images", nonEmpty: false },
        },
        placeholder: "10-20/16",
      },
      {
        key: "images",
        label: "Image Files (Multi-image contact sheet)",
        type: "string",
        multi: true,
        visibleWhen: { field: "video", nonEmpty: false },
        placeholder: "renders/view_a.png renders/view_b.png",
        hint: "Pass 1+ PNG/JPG/WEBP paths (instead of video) to stitch a captioned contact sheet.",
      },
    ],
    flags: [
      {
        key: "--out",
        flag: "--out",
        label: "Output Sheet Path (Image-list mode)",
        type: "string",
        tier: "common",
        visibleWhen: { field: "images", nonEmpty: true, and: { field: "video", nonEmpty: false } },
        placeholder: "renders/views_sheet.jpg",
      },
      {
        key: "--per-sheet",
        flag: "--per-sheet",
        label: "Max Images Per Sheet (Image-list mode)",
        type: "number",
        tier: "common",
        visibleWhen: { field: "images", nonEmpty: true, and: { field: "video", nonEmpty: false } },
        placeholder: "6",
        hint: "Paginate large image lists (1-36 per sheet) into <stem>_0.<ext>, <stem>_1.<ext>, ...",
      },
      {
        key: "--start",
        flag: "--start",
        label: "Video Start (film sec)",
        type: "string",
        visibleWhen: { field: "images", nonEmpty: false },
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
      outputsHint:
        "Overview/frames retain renders/review_*/index.json and pictures; legacy modes write sheet_*.jpg",
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
    id: "media",
    label: "media",
    category: "render",
    summary:
      "Optional local audio, OCR, vision, tracking, sound catalog, metadata, OTIO, QC and FFmpeg tools with retained evidence.",
    runner: "bun-script",
    target: "media",
    cwdModes: ["root", "film"],
    subcommandRequired: true,
    subcommands: [
      ...nativeMediaSubcommands,
      ...sdkMediaSubcommands,
      ...referenceMediaSubcommands,
      {
        id: "qc",
        label: "qc",
        summary:
          "Optional loop seams, subtitles/word timing, alpha/key-fill and delivery-package checks.",
        args: [{ key: "request", label: "QC Request JSON", type: "string" }],
        flags: [
          { key: "--contract", flag: "--contract", label: "Native Rule Contract", type: "boolean" },
          { key: "--out", flag: "--out", label: "Evidence Parent", type: "string" },
          { key: "--minutes", flag: "--minutes", label: "Deadline Minutes", type: "number" },
          { key: "--dry-run", flag: "--dry-run", label: "Validate Request Only", type: "boolean" },
        ],
        meta: {
          effect: "write",
          speed: "long",
          outputsHint:
            "Retains original request and native verdicts. Process success and measured FAIL/UNKNOWN are distinct; no creative gate.",
        },
      },
      {
        id: "ffmpeg",
        label: "ffmpeg",
        summary:
          "Pinned native footage backend: contract/list/doctor, QC, sync, alpha/NLE exports and advanced edits.",
        args: [
          {
            key: "invocation",
            label: "Native Invocation",
            type: "string",
            multi: true,
            passthrough: true,
            placeholder: "probe -- clip.mp4",
            hint: "Tool, wrapper --out/--minutes, then -- and native arguments. Use list --json or contract -- --static --tool NAME for parser-derived fields.",
          },
        ],
        meta: {
          effect: "write",
          speed: "long",
          outputsHint:
            "Fresh run evidence; native outputs follow native paths. Execution does not imply verified media; native ASR may download models.",
        },
      },
      {
        id: "list",
        label: "list",
        summary: "List tools, upstream sources and license boundaries.",
        flags: [{ key: "--json", flag: "--json", label: "JSON", type: "boolean" }],
      },
      {
        id: "doctor",
        label: "doctor",
        summary: "Check installed packages, binaries and runtimes without loading models.",
        args: [{ key: "tool", label: "Tool (optional)", type: "string", placeholder: "ocr" }],
        flags: [{ key: "--json", flag: "--json", label: "JSON", type: "boolean" }],
      },
      {
        id: "setup",
        label: "setup",
        summary:
          "Install pinned packages or verified native binaries/models; network, no inference.",
        args: [{ key: "tool", label: "Tool", type: "string", required: true, placeholder: "ocr" }],
        flags: [
          {
            key: "--minutes",
            flag: "--minutes",
            label: "Deadline Minutes per Step",
            type: "number",
          },
          { key: "--out", flag: "--out", label: "Evidence Parent", type: "string" },
        ],
        meta: { effect: "install", speed: "long" },
      },
      {
        id: "ocr",
        label: "ocr",
        summary: "Read text boxes from images or sampled source-video frames.",
        args: [{ key: "source", label: "Image / Video", type: "string", required: true }],
        flags: [
          { key: "--at", flag: "--at", label: "File Seconds", type: "string", placeholder: "5,10" },
          { key: "--from", flag: "--from", label: "From File Second", type: "string" },
          {
            key: "--to",
            flag: "--to",
            label: "To File Second",
            type: "string",
            hint: "Omit to scan to exact probed video duration.",
          },
          {
            key: "--frames",
            flag: "--frames",
            label: "Frame Budget",
            type: "number",
            placeholder: "12",
          },
          {
            key: "--crop",
            flag: "--crop",
            label: "Band x,y,w,h (fractions)",
            type: "string",
            placeholder: "0,0.7,1,0.2",
            hint: "Studio drafts carry a bottom bar (0,0,1,0.946 excludes it on 9:16).",
          },
          { key: "--captions", flag: "--captions", label: "Timed Captions", type: "boolean" },
          {
            key: "--score",
            flag: "--score",
            label: "Minimum Model Score",
            type: "number",
            tier: "advanced",
          },
          {
            key: "--language",
            flag: "--language",
            label: "Recognizer Language",
            type: "string",
            placeholder: "vi",
          },
          {
            key: "--config",
            flag: "--config",
            label: "Native RapidOCR YAML",
            type: "string",
            tier: "advanced",
          },
          { key: "--out", flag: "--out", label: "Evidence Parent", type: "string" },
          {
            key: "--minutes",
            flag: "--minutes",
            label: "Deadline Minutes",
            type: "number",
            placeholder: "5",
          },
          { key: "--dry-run", flag: "--dry-run", label: "Validate Only", type: "boolean" },
        ],
        meta: { effect: "write", speed: "long" },
      },
    ],
    meta: {
      effect: "read",
      cost: "free",
      speed: "short",
      cancellable: true,
      helpMode: "flag",
      outputsHint:
        "Runs retain job.json/process.log and tool artifacts; OCR writes result.json, frames.jsonl and source frames. Scores need visual verification.",
    },
  },
  {
    id: "qc",
    label: "qc",
    category: "render",
    summary:
      "Check encoded video, audio sync, camera motion, or inspect image regions and differences.",
    runner: "bun-file",
    target: "scripts/review/qc.ts",
    cwdModes: ["film", "root"],
    args: [{ key: "video", label: "Video path", type: "string", choiceSource: "renders" }],
    flags: [
      {
        key: "--checks",
        flag: "--checks",
        label: "Checks",
        type: "string",
        placeholder: "probe,forensics,sync,audio,look,speed,cam-motion,text",
      },
      { key: "--strict", flag: "--strict", label: "Fail on warnings", type: "boolean" },
      { key: "--json", flag: "--json", label: "JSON report", type: "boolean" },
    ],
    subcommands: [
      {
        id: "box",
        label: "box",
        summary: "Measure brightness, RGB and contrast inside an image region.",
        args: [
          { key: "image", label: "Image path", type: "string", required: true },
          { key: "rect", label: "Region (x,y,w,h)", type: "string", required: true },
        ],
        flags: [
          { key: "--norm", flag: "--norm", label: "Normalized coordinates", type: "boolean" },
          { key: "--json", flag: "--json", label: "JSON report", type: "boolean" },
        ],
        meta: { speed: "short" },
      },
      {
        id: "compare",
        label: "compare",
        summary: "Quantify changed pixels and write a before/after comparison.",
        args: [
          { key: "before", label: "Before image", type: "string", required: true },
          { key: "after", label: "After image", type: "string", required: true },
        ],
        flags: [
          { key: "--out", flag: "--out", label: "Comparison image path", type: "string" },
          {
            key: "--threshold",
            flag: "--threshold",
            label: "Pixel threshold (0–255)",
            type: "number",
          },
          { key: "--json", flag: "--json", label: "JSON report", type: "boolean" },
        ],
        meta: { effect: "write", speed: "short" },
      },
      {
        id: "motion",
        label: "motion",
        summary: "Find rapid camera turns, zoom changes and the responsible key rows.",
        flags: [
          { key: "--cam", flag: "--cam", label: "Camera timeline path", type: "string" },
          { key: "--from", flag: "--from", label: "Start second", type: "number" },
          { key: "--to", flag: "--to", label: "End second", type: "number" },
          { key: "--json", flag: "--json", label: "JSON report", type: "boolean" },
        ],
        meta: { speed: "short" },
      },
    ],
    meta: {
      effect: "read",
      cost: "free",
      speed: "long",
      cancellable: true,
      helpMode: "flag",
      outputsHint: "Exit 0 passed, 1 found failures, 2 invalid input or nothing checked.",
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
    flags: [
      { key: "--json", flag: "--json", label: "JSON Report", type: "boolean", tier: "common" },
      {
        key: "--vs",
        flag: "--vs",
        label: "Reference Video (default references/)",
        type: "string",
        tier: "advanced",
        placeholder: "references/ref.mp4",
      },
      {
        key: "--start",
        flag: "--start",
        label: "Video Start (film sec)",
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
      outputsHint: "Writes renders/framecheck_*/index.json and fault strips",
    },
  },
  {
    id: "sweep",
    label: "sweep",
    category: "render",
    summary:
      "One ranked list of what to fix in a whole draft: pops, focus, light and cuts against the reference.",
    runner: "bun-script",
    target: "sweep",
    cwdModes: ["film"],
    args: [
      {
        key: "video",
        label: "Whole Draft (Default draft_video.mp4)",
        type: "string",
        choiceSource: "renders",
        placeholder: "renders/draft_video.mp4",
      },
    ],
    flags: [
      { key: "--json", flag: "--json", label: "JSON Report", type: "boolean", tier: "common" },
    ],
    meta: {
      effect: "write",
      cost: "free",
      speed: "short",
      cancellable: true,
      helpMode: "flag",
      outputsHint: "Writes renders/sweep.json and a framecheck run",
    },
  },
  {
    id: "pace",
    label: "pace",
    category: "render",
    summary:
      "Measure shot durations and holds on a current whole-film render, with planned narration.",
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
      "Check a file against the project upload profile; optionally measure local AV1 preview banding.",
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
        "Exit 0 technical checks pass, 1 FIX issues; --youtube retains a fresh renders/youtube_*/ run",
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
    flags: [
      {
        key: "--json",
        flag: "--json",
        label: "Render Context JSON",
        type: "boolean",
        tier: "advanced",
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
    id: "setup",
    label: "setup",
    category: "setup",
    summary: "Full machine bootstrap: bun install, setup:vault, and link.",
    runner: "bun-script",
    target: "setup",
    cwdModes: ["root"],
    flags: [
      {
        key: "--vault-zip",
        flag: "--vault-zip",
        label: "Vault Archive Zip / Link (Repeatable)",
        type: "string",
        multi: true,
        multiStyle: "repeat",
        tier: "common",
        placeholder: "D:/mc-films-vault-core.zip",
        hint: "Repeat for split core + heavy archives from bun run pack:vault.",
      },
      {
        key: "--sound-zip",
        flag: "--sound-zip",
        label: "Legacy Sound Archive Zip / Link",
        type: "string",
        tier: "advanced",
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
        message: "Runs bun install, vault bootstrap downloads/builds, and film asset links.",
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
        key: "--vault-zip",
        flag: "--vault-zip",
        label: "Vault Archive Zip / Link (Repeatable)",
        type: "string",
        multi: true,
        multiStyle: "repeat",
        tier: "common",
        placeholder: "D:/mc-films-vault-core.zip",
        hint: "Repeat for split core + heavy archives from bun run pack:vault.",
      },
      {
        key: "--sound-zip",
        flag: "--sound-zip",
        label: "Legacy Sound Archive Zip / Link",
        type: "string",
        tier: "advanced",
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
    id: "fetch:openfilm",
    label: "fetch:openfilm",
    category: "setup",
    summary: "Import or verify the pinned OpenFilm sources and audio in the local vault.",
    runner: "bun-script",
    target: "fetch:openfilm",
    cwdModes: ["root"],
    flags: [
      { key: "--verify", flag: "--verify", label: "Verify only", type: "boolean" },
      {
        key: "--minutes",
        flag: "--minutes",
        label: "Time limit (minutes)",
        type: "number",
        placeholder: "60",
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
        message: "Downloads and converts OpenFilm assets; completed work is kept.",
      },
    },
  },
  {
    id: "asset",
    label: "asset",
    category: "daily",
    summary:
      "Pick/unpick MC pack assets, preview 3D models beside Steve, place and edit 2D lanes or 3D placed objects, or copy Global props into src/props/.",
    runner: "bun-script",
    target: "asset",
    cwdModes: ["root", "film"],
    subcommandRequired: true,
    flags: [
      {
        key: "--film",
        flag: "--film",
        label: "Film folder",
        type: "choice",
        choiceSource: "filmDirs",
      },
      { key: "--json", flag: "--json", label: "JSON output (default)", type: "boolean" },
    ],
    meta: { effect: "read", cost: "free", speed: "short", cancellable: true, helpMode: "flag" },
    subcommands: [
      {
        id: "timeline",
        label: "timeline",
        summary: "Read one placed, picks, or 2D lane in heard/output seconds",
        inheritFlags: true,
        flags: [
          {
            key: "--lane",
            flag: "--lane",
            label: "Timeline lane",
            type: "enum",
            options: ["effects", "text", "adjustment", "transitions", "audio", "placed", "picks"],
          },
          {
            key: "--duration",
            flag: "--duration",
            label: "Code-defined source duration (scene seconds)",
            type: "number",
          },
        ],
      },
      {
        id: "validate",
        label: "validate",
        summary: "Validate configured lanes, placed.json, and pack/picks.json schemas",
        inheritFlags: true,
      },
      ...(["pick", "unpick"] as const).map((id) => ({
        id,
        label: id,
        summary: `${id} pack blocks/items into pack/picks.json & picked.zip`,
        inheritFlags: true,
        args: [{ key: "id", label: "Block/Item ID(s)", type: "string" as const, required: true }],
        flags: [
          {
            key: "--kind",
            flag: "--kind",
            label: "Asset type",
            type: "enum" as const,
            options: ["block", "item"],
          },
          { key: "--source", flag: "--source", label: "Source / Pack", type: "string" as const },
          {
            key: "--no-build",
            flag: "--no-build",
            label: "Skip zip build",
            type: "boolean" as const,
          },
        ],
        meta: { effect: "write" as const },
      })),
      {
        id: "preview",
        label: "preview",
        summary:
          "Render a labelled 3D Front + 3/4 sheet of blocks/items beside a 1.875m Steve scale figure",
        inheritFlags: true,
        args: [
          {
            key: "id",
            label: "Block/Item ID(s) (optional; defaults to pack/picks.json)",
            type: "string" as const,
            multi: true,
            placeholder: "block:minecraft:oak_stairs item:minecraft:iron_sword",
          },
        ],
        flags: [
          {
            key: "--kind",
            flag: "--kind",
            label: "Asset type filter / default",
            type: "enum" as const,
            options: ["block", "item"],
          },
          {
            key: "--source",
            flag: "--source",
            label: "Pack slug or jar (disambiguate unpicked vault assets)",
            type: "string" as const,
            placeholder: "modern-furniture",
          },
          {
            key: "--out",
            flag: "--out",
            label: "Output filename in renders/",
            type: "string" as const,
            placeholder: "asset_preview.jpg",
          },
          {
            key: "--size",
            flag: "--size",
            label: "Item scale (default 0.42)",
            type: "number" as const,
          },
          {
            key: "--limit",
            flag: "--limit",
            label: "Max assets per sheet (1-36)",
            type: "number" as const,
          },
          {
            key: "--no-scale",
            flag: "--no-scale",
            label: "Hide 1.875m Steve scale figure",
            type: "boolean" as const,
          },
        ],
        meta: { effect: "write" as const, speed: "short" as const },
      },
      {
        id: "plan",
        label: "plan",
        summary: "Preview template layers, music, and camera-slot timings",
        inheritFlags: true,
        args: [{ key: "id", label: "Template/Asset ID", type: "string" as const, required: true }],
        flags: [
          {
            key: "--kind",
            flag: "--kind",
            label: "Asset type",
            type: "enum",
            options: ["template", "transition", "effect", "text", "filter", "sticker", "sound"],
          },
          { key: "--source", flag: "--source", label: "Source", type: "string" },
          { key: "--from", flag: "--from", label: "From (heard seconds)", type: "number" },
          { key: "--to", flag: "--to", label: "To (heard seconds)", type: "number" },
        ],
      },
      {
        id: "use",
        label: "use",
        summary: "Place an asset in its lane or copy prop:global:<id> into src/props/",
        inheritFlags: true,
        args: [
          { key: "id", label: "Asset ID or /page.html", type: "string" as const, required: true },
        ],
        flags: [
          {
            key: "--kind",
            flag: "--kind",
            label: "Asset type",
            type: "enum",
            options: [
              "transition",
              "effect",
              "text",
              "filter",
              "sticker",
              "template",
              "sound",
              "block",
              "item",
              "mob",
              "prop",
            ],
          },
          { key: "--source", flag: "--source", label: "Source / Pack", type: "string" },
          {
            key: "--duration",
            flag: "--duration",
            label: "Code-defined source duration (scene seconds)",
            type: "number",
          },
          { key: "--from", flag: "--from", label: "From (heard seconds)", type: "number" },
          { key: "--to", flag: "--to", label: "To (heard seconds)", type: "number" },
          { key: "--shot", flag: "--shot", label: "Cut into shot", type: "number" },
          { key: "--no-pick", flag: "--no-pick", label: "Skip auto-pick", type: "boolean" },
          { key: "--force", flag: "--force", label: "Overwrite existing", type: "boolean" },
          {
            key: "--props",
            flag: "--props",
            label: "Creative controls (JSON)",
            type: "string",
            exclusiveGroup: "asset-props",
          },
          {
            key: "--props-file",
            flag: "--props-file",
            label: "Creative controls file",
            type: "string",
            exclusiveGroup: "asset-props",
          },
        ],
        meta: { effect: "write" as const },
      },
      {
        id: "edit",
        label: "edit",
        summary: "Edit a saved asset target or placed object keyframe",
        inheritFlags: true,
        args: [
          {
            key: "id",
            label: "Saved target (e.g. placed:NAME)",
            type: "string" as const,
            required: true,
          },
        ],
        flags: [
          {
            key: "--duration",
            flag: "--duration",
            label: "Code-defined source duration (scene seconds)",
            type: "number",
          },
          { key: "--from", flag: "--from", label: "From (heard seconds)", type: "number" },
          {
            key: "--props",
            flag: "--props",
            label: "Creative controls (JSON)",
            type: "string",
            exclusiveGroup: "asset-props",
          },
          {
            key: "--props-file",
            flag: "--props-file",
            label: "Creative controls file",
            type: "string",
            exclusiveGroup: "asset-props",
          },
        ],
        meta: { effect: "write" as const },
      },
      {
        id: "remove",
        label: "remove",
        summary: "Remove a saved asset or placed object",
        inheritFlags: true,
        args: [
          {
            key: "id",
            label: "Saved target (e.g. placed:NAME)",
            type: "string" as const,
            required: true,
          },
        ],
        flags: [
          {
            key: "--duration",
            flag: "--duration",
            label: "Code-defined source duration (scene seconds)",
            type: "number",
          },
        ],
        meta: { effect: "write" as const },
      },
    ],
  },
  {
    id: "openfilm",
    label: "openfilm",
    category: "daily",
    summary:
      "Compatibility alias for asset actions with the OpenFilm source selected; discover with find.",
    runner: "bun-script",
    target: "openfilm",
    cwdModes: ["root", "film"],
    subcommandRequired: true,
    flags: [
      {
        key: "--film",
        flag: "--film",
        label: "Film folder",
        type: "choice",
        choiceSource: "filmDirs",
      },
      { key: "--json", flag: "--json", label: "JSON output", type: "boolean", tier: "advanced" },
    ],
    meta: { effect: "read", cost: "free", speed: "short", cancellable: true, helpMode: "flag" },
    subcommands: [
      {
        id: "timeline",
        label: "timeline",
        summary: "Read OpenFilm or native lane data in heard seconds",
        inheritFlags: true,
        flags: [
          {
            key: "--lane",
            flag: "--lane",
            label: "Lane",
            type: "enum",
            options: ["effects", "text", "adjustment", "transitions", "audio", "placed", "picks"],
          },
          {
            key: "--duration",
            flag: "--duration",
            label: "Code-defined source duration (scene seconds)",
            type: "number",
          },
        ],
      },
      {
        id: "validate",
        label: "validate",
        summary: "Validate configured OpenFilm and native lanes",
        inheritFlags: true,
      },
      {
        id: "plan",
        label: "plan",
        summary: "Preview an OpenFilm template plan without writing",
        inheritFlags: true,
        args: [{ key: "id", label: "Asset or layer ID", type: "string" as const, required: true }],
        flags: [
          {
            key: "--kind",
            flag: "--kind",
            label: "Asset type",
            type: "enum",
            options: ["transition", "effect", "text", "filter", "sticker", "template"],
          },
          { key: "--from", flag: "--from", label: "From (heard seconds)", type: "number" },
          { key: "--to", flag: "--to", label: "To (heard seconds)", type: "number" },
        ],
      },
      {
        id: "use",
        label: "use",
        summary: "Place an OpenFilm asset or layer",
        inheritFlags: true,
        args: [{ key: "id", label: "Asset or layer ID", type: "string" as const, required: true }],
        flags: [
          {
            key: "--kind",
            flag: "--kind",
            label: "Asset type",
            type: "enum",
            options: ["transition", "effect", "text", "filter", "sticker", "template", "sound"],
          },
          { key: "--from", flag: "--from", label: "From (heard seconds)", type: "number" },
          { key: "--to", flag: "--to", label: "To (heard seconds)", type: "number" },
          { key: "--shot", flag: "--shot", label: "Cut before shot", type: "number" },
          {
            key: "--duration",
            flag: "--duration",
            label: "Code-defined source duration (scene seconds)",
            type: "number",
          },
          {
            key: "--props",
            flag: "--props",
            label: "Creative controls (JSON)",
            type: "string",
            exclusiveGroup: "openfilm-props",
          },
          {
            key: "--props-file",
            flag: "--props-file",
            label: "Creative controls file",
            type: "string",
            exclusiveGroup: "openfilm-props",
          },
        ],
        meta: { effect: "write" as const },
      },
      {
        id: "edit",
        label: "edit",
        summary: "Edit a saved OpenFilm layer target",
        inheritFlags: true,
        args: [{ key: "id", label: "Asset or layer ID", type: "string" as const, required: true }],
        flags: [
          { key: "--from", flag: "--from", label: "From (heard seconds)", type: "number" },
          {
            key: "--duration",
            flag: "--duration",
            label: "Code-defined source duration (scene seconds)",
            type: "number",
          },
          {
            key: "--props",
            flag: "--props",
            label: "Creative controls (JSON)",
            type: "string",
            exclusiveGroup: "openfilm-props",
          },
          {
            key: "--props-file",
            flag: "--props-file",
            label: "Creative controls file",
            type: "string",
            exclusiveGroup: "openfilm-props",
          },
        ],
        meta: { effect: "write" as const },
      },
      {
        id: "remove",
        label: "remove",
        summary: "Remove a saved OpenFilm layer target",
        inheritFlags: true,
        args: [{ key: "id", label: "Asset or layer ID", type: "string" as const, required: true }],
        flags: [
          {
            key: "--duration",
            flag: "--duration",
            label: "Code-defined source duration (scene seconds)",
            type: "number",
          },
        ],
        meta: { effect: "write" as const },
      },
    ],
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
    id: "pack:vault",
    label: "pack:vault",
    category: "setup",
    summary:
      "Archive pure static vault assets into split private core + heavy zips (excludes tools/ and cache/).",
    runner: "bun-script",
    target: "pack:vault",
    cwdModes: ["root"],
    args: [
      {
        key: "out",
        label: "Output Directory or Zip Path (Optional)",
        type: "string",
        placeholder: "D:/backup",
      },
    ],
    flags: [
      {
        key: "--part",
        flag: "--part",
        label: "Archive Part",
        type: "enum",
        options: ["split", "core", "heavy", "all"],
        tier: "common",
        hint: "split writes core (~1.2 GB) and heavy (~13.8 GB) archives; core/heavy/all writes one zip.",
      },
      {
        key: "--json",
        flag: "--json",
        label: "JSON Output",
        type: "boolean",
        tier: "advanced",
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
        message: "Packs pure static vault assets into private zip archive(s).",
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
    flags: [
      {
        key: "--ratio",
        flag: "--ratio",
        label: "Aspect Ratio",
        type: "enum",
        options: ["16:9", "9:16"],
        tier: "common",
        hint: "Set live-studio.ratio on creation (default 16:9; use 9:16 for Shorts).",
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
        message: "Creates a new film folder in films/ and runs studio init + vault link.",
      },
    },
  },
  {
    id: "link",
    label: "link",
    category: "setup",
    summary: "Copy vault assets into all films (or selected films) and build pack picks ZIPs.",
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
      {
        key: "--detach",
        flag: "--detach",
        label: "Start Detached (Background)",
        type: "boolean",
        exclusiveGroup: "studio-mode",
        tier: "common",
      },
      {
        key: "--status",
        flag: "--status",
        label: "Check Running Status",
        type: "boolean",
        exclusiveGroup: "studio-mode",
        tier: "common",
      },
      {
        key: "--stop",
        flag: "--stop",
        label: "Stop Recorded Studio",
        type: "boolean",
        exclusiveGroup: "studio-mode",
        tier: "common",
      },
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
    id: "studio:lite",
    label: "studio:lite",
    category: "dev",
    summary:
      "Launch a film's lightweight Live Studio Lite server for desktop & mobile MP4 review & notes (guarded in Live Studio UI; --help is safe).",
    runner: "bun-script",
    target: "studio:lite",
    cwdModes: ["film"],
    args: [
      {
        key: "port",
        label: "Port (Optional)",
        type: "number",
        placeholder: "5330",
        hint: "Defaults to film studio port + 1000 (fallback 5321)",
      },
    ],
    flags: [
      { key: "--lan", flag: "--lan", label: "Bind LAN (0.0.0.0)", type: "boolean", tier: "common" },
      {
        key: "--detach",
        flag: "--detach",
        label: "Start Detached (Background)",
        type: "boolean",
        exclusiveGroup: "studio-lite-mode",
        tier: "common",
      },
      {
        key: "--status",
        flag: "--status",
        label: "Check Running Status",
        type: "boolean",
        exclusiveGroup: "studio-lite-mode",
        tier: "common",
      },
      {
        key: "--stop",
        flag: "--stop",
        label: "Stop Recorded Lite Studio",
        type: "boolean",
        exclusiveGroup: "studio-lite-mode",
        tier: "common",
      },
    ],
    meta: {
      effect: "daemon",
      cost: "free",
      speed: "short",
      cancellable: false,
      helpMode: "flag",
      guard: {
        disabled: true,
        reason: "Starts a long-lived Live Studio Lite server; run from a terminal instead.",
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
    id: "test:parallel",
    label: "test:parallel",
    category: "dev",
    summary:
      "Run the full test suite with 2 isolated Bun workers; native timing and shard flags apply.",
    runner: "bun-script",
    target: "test:parallel",
    cwdModes: ["root"],
    meta: {
      effect: "read",
      cost: "free",
      speed: "long",
      cancellable: true,
      helpMode: "flag",
    },
  },
  {
    id: "ci",
    label: "ci",
    category: "dev",
    summary:
      "Run lint, typecheck and the full parallel test suite together, including Studio builds.",
    runner: "bun-script",
    target: "ci",
    cwdModes: ["root"],
    meta: {
      effect: "read",
      cost: "free",
      speed: "long",
      cancellable: true,
      helpMode: "flag",
    },
  },
  {
    id: "doctor",
    label: "doctor",
    category: "dev",
    summary:
      "React Doctor source diagnostics for Studio; advisory, local checks, 120-second budget.",
    runner: "bun-script",
    target: "doctor",
    cwdModes: ["root"],
    flags: [
      { key: "--json", flag: "--json", label: "JSON report", type: "boolean" },
      { key: "--verbose", flag: "--verbose", label: "All diagnostics", type: "boolean" },
      {
        key: "--blocking",
        flag: "--blocking",
        label: "Fail on",
        type: "enum",
        options: ["none", "error", "warning"],
      },
    ],
    meta: {
      effect: "read",
      cost: "free",
      speed: "long",
      cancellable: true,
      helpMode: "flag",
      outputsHint:
        "Advisory by default; JSON includes diagnostics and per-project completion/skipped checks.",
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
    id: "comments",
    label: "comments",
    category: "dev",
    summary: "List, measure, safely strip, and ratchet code comments across the repository.",
    runner: "bun-script",
    target: "comments",
    cwdModes: ["root"],
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
        id: "list",
        label: "list",
        summary: "Emit JSONL of prose comment blocks (excluding allowed tool directives).",
        args: [
          {
            key: "paths",
            label: "Paths (optional)",
            type: "string",
            multi: true,
            placeholder: "packages/film-kit",
            hint: "Relative paths to inspect; defaults to tracked workspace scopes.",
          },
        ],
        flags: [
          {
            key: "--out",
            flag: "--out",
            label: "Output JSONL file",
            type: "string",
            placeholder: "verdicts-input.jsonl",
            hint: "Write UTF-8 JSONL directly to a file instead of stdout.",
            tier: "common",
          },
        ],
      },
      {
        id: "stats",
        label: "stats",
        summary: "Show per-package prose comment counts and sheddable LOC estimate.",
        args: [
          {
            key: "paths",
            label: "Paths (optional)",
            type: "string",
            multi: true,
            placeholder: "packages/live-studio",
            hint: "Relative paths to measure; defaults to tracked workspace scopes.",
          },
        ],
        flags: [
          {
            key: "--json",
            flag: "--json",
            label: "JSON output",
            type: "boolean",
            tier: "common",
          },
        ],
      },
      {
        id: "strip",
        label: "strip",
        summary:
          "Safely strip selected comment blocks from a JSONL verdict file after AST/token verification.",
        args: [
          {
            key: "jsonl",
            label: "Selection JSONL",
            type: "string",
            required: true,
            placeholder: "doomed.jsonl",
            hint: "JSONL file with {file, line, text} records to remove.",
          },
        ],
        flags: [
          {
            key: "--dry-run",
            flag: "--dry-run",
            label: "Dry run",
            type: "boolean",
            tier: "common",
          },
        ],
        meta: { effect: "write" },
      },
      {
        id: "ratchet",
        label: "ratchet",
        summary: "Tighten or verify scripts/lint/comment-ratchet.json without raising ceilings.",
        args: [
          {
            key: "paths",
            label: "Paths (optional)",
            type: "string",
            multi: true,
            placeholder: "packages/film-kit",
            hint: "Relative paths to check or tighten; defaults to tracked workspace scopes.",
          },
        ],
        flags: [
          {
            key: "--check",
            flag: "--check",
            label: "Check only",
            type: "boolean",
            exclusiveGroup: "ratchet-mode",
            tier: "common",
          },
          {
            key: "--init",
            flag: "--init",
            label: "Initialize baseline",
            type: "boolean",
            exclusiveGroup: "ratchet-mode",
            requiresConfirmIfSet: true,
            tier: "advanced",
          },
        ],
        meta: {
          effect: "write",
          confirm: {
            mode: "when-flagged",
            message:
              "Overwrite scripts/lint/comment-ratchet.json with a fresh baseline from current comments?",
          },
        },
      },
    ],
  },
  {
    id: "lint",
    label: "lint",
    category: "dev",
    summary:
      "Run oxlint and comment ratchet check across packages/, scripts/, templates/ and .claude/hooks/.",
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
        visibleWhen: { field: "--mode", unsetOrIn: ["words", "jev", "both"] },
      },
      {
        key: "--mode",
        flag: "--mode",
        label: "Mode",
        type: "enum",
        options: ["words", "jev", "both", "dual"],
        tier: "common",
      },
      {
        key: "--live",
        flag: "--live",
        label: "Allow OpenFilm requests",
        type: "boolean",
        visibleWhen: { field: "--mode", in: ["dual"] },
        hint: "Only text queries to OpenFilm; no Jev or embedding provider calls.",
      },
      {
        key: "--plan",
        flag: "--plan",
        label: "Preview evaluation corpus",
        type: "boolean",
        visibleWhen: { field: "--mode", in: ["dual"] },
      },
      {
        key: "--out",
        flag: "--out",
        label: "Report path",
        type: "string",
        visibleWhen: { field: "--mode", in: ["dual"] },
      },
      {
        key: "--max-seconds",
        flag: "--max-seconds",
        label: "Time limit (seconds)",
        type: "number",
        placeholder: "600",
        visibleWhen: { field: "--mode", in: ["dual"] },
      },
      {
        key: "--max-requests",
        flag: "--max-requests",
        label: "OpenFilm request limit",
        type: "number",
        placeholder: "1000",
        visibleWhen: { field: "--mode", in: ["dual"] },
      },
      {
        key: "--kind",
        flag: "--kind",
        label: "Filter Kind",
        type: "string",
        tier: "common",
        visibleWhen: { field: "--mode", unsetOrIn: ["words", "jev", "both"] },
      },
      {
        key: "--fresh",
        flag: "--fresh",
        label: "Restart Run",
        type: "boolean",
        tier: "common",
        visibleWhen: { field: "--mode", unsetOrIn: ["words", "jev", "both"] },
      },
      {
        key: "-j",
        flag: "-j",
        label: "Concurrency (-j)",
        type: "number",
        placeholder: "3",
        tier: "advanced",
        visibleWhen: { field: "--mode", unsetOrIn: ["words", "jev", "both"] },
      },
      {
        key: "--finish",
        flag: "--finish",
        label: "Score Stopped Run",
        type: "boolean",
        tier: "advanced",
        visibleWhen: { field: "--mode", unsetOrIn: ["words", "jev", "both"] },
      },
      {
        key: "--note",
        flag: "--note",
        label: "History Note",
        type: "string",
        tier: "advanced",
        visibleWhen: { field: "--mode", unsetOrIn: ["words", "jev", "both"] },
      },
    ],
    meta: {
      effect: "write",
      cost: "optional-paid",
      costHint:
        "words/dual are free; dual is cached-only unless --live. jev/both calls Jev across the case set.",
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
      {
        key: "--panels",
        flag: "--panels",
        label: "Measure Cold Settings Open",
        type: "boolean",
        tier: "advanced",
      },
      {
        key: "--frames",
        flag: "--frames",
        label: "Capture Canvas Seconds",
        type: "string",
        placeholder: "0,2.4,4.7",
        tier: "advanced",
      },
      {
        key: "--audio",
        flag: "--audio",
        label: "Offline Audio RMS (0-15s)",
        type: "boolean",
        tier: "advanced",
      },
      {
        key: "--playback",
        flag: "--playback",
        label: "Measure 8s Play/Pause & Note Cancel",
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

  {
    id: "mc:pick",
    label: "mc:pick",
    category: "pipeline",
    summary:
      "Build a film's block & item picks zip from pack/picks.json using packages/mc-assets/pick.mjs (prefer bun run asset pick).",
    runner: "bun-file",
    target: "packages/mc-assets/pick.mjs",
    cwdModes: ["film"],
    meta: { effect: "write", cost: "free", speed: "short", cancellable: true, helpMode: "flag" },
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
      helpMode: "flag",
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
    meta: { effect: "write", cost: "free", speed: "short", cancellable: true, helpMode: "flag" },
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
      {
        key: "--scenes",
        flag: "--scenes",
        label: "Scenes File",
        type: "string",
        placeholder: "catalog_eval.txt",
        tier: "advanced",
      },
      {
        key: "--limit",
        flag: "--limit",
        label: "Max Pending Scenes",
        type: "number",
        tier: "common",
      },
      {
        key: "--timeout",
        flag: "--timeout",
        label: "Seconds per Scene",
        type: "number",
        placeholder: "180",
        tier: "advanced",
      },
      {
        key: "--resume",
        flag: "--resume",
        label: "Resume Checkpoint",
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
        label: "Page Number (stdin or --notes)",
        type: "number",
        exclusiveGroup: "catalog-review-mode",
        tier: "advanced",
        placeholder: "0",
        hint: "Read JSON slot verdicts from stdin or --notes for review page N",
      },
      {
        key: "--notes",
        flag: "--notes",
        label: "Page Notes JSON File",
        type: "string",
        visibleWhen: { field: "--page", nonEmpty: true },
        tier: "common",
        placeholder: "notes.json",
        hint: "PowerShell-friendly verdict JSON file for --page; omits stdin.",
      },
      {
        key: "--missing",
        flag: "--missing",
        label: "Pages Missing Field",
        type: "enum",
        options: ["desc", "mood", "prop", "style", "flaw"],
        exclusiveGroup: "catalog-review-mode",
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
        exclusiveGroup: "catalog-review-mode",
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
    flags: [
      {
        key: "--fights",
        flag: "--fights",
        label: "Include Weapons & Fights",
        type: "boolean",
        tier: "common",
      },
    ],
    meta: { effect: "read", cost: "free", speed: "short", cancellable: true, helpMode: "flag" },
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
      helpMode: "flag",
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
    meta: { effect: "write", cost: "free", speed: "long", cancellable: true, helpMode: "flag" },
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
    meta: { effect: "write", cost: "free", speed: "long", cancellable: true, helpMode: "flag" },
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
    meta: { effect: "write", cost: "free", speed: "long", cancellable: true, helpMode: "flag" },
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
      helpMode: "flag",
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
    meta: { effect: "write", cost: "free", speed: "short", cancellable: true, helpMode: "flag" },
  },
  {
    id: "timeline:fmt",
    label: "timeline:fmt",
    category: "pipeline",
    summary:
      "Format src/timeline/*.json files using compactJson (skips Studio-protected files when no targets are passed).",
    runner: "bun-file",
    target: "scripts/timeline_fmt.ts",
    cwdModes: ["film"],
    args: [
      {
        key: "target",
        label: "Optional timeline stem(s) or path(s)",
        type: "string",
        multi: true,
        placeholder: "cast lights or src/timeline/cast.json",
      },
    ],
    meta: { effect: "write", cost: "free", speed: "instant", cancellable: false, helpMode: "flag" },
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
    meta: { effect: "write", cost: "free", speed: "instant", cancellable: false, helpMode: "flag" },
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
  meta: CliMeta;
  summary: string;
} {
  const subcommands: CliSubcommand[] = [];
  const resolvedPath: string[] = [];
  let argsDef: readonly CliArgDef[] = command.args ?? [];
  let flagsDef: readonly CliFlagDef[] = command.flags ?? [];
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
    if (hit.meta) meta = { ...meta, ...hit.meta };
    children = hit.subcommands;
  }

  return { subcommands, resolvedPath, argsDef, flagsDef, meta, summary };
}

function normalizeConditionValues(raw: CliArgValue): string[] {
  if (raw === undefined || raw === null || raw === false) return [];
  const parts = Array.isArray(raw)
    ? raw.flatMap((x) => String(x).split(","))
    : String(raw).split(",");
  return parts.map((s) => s.trim()).filter(Boolean);
}

function matchesCondition(rule: CliVisibleWhen, values: Record<string, CliArgValue>): boolean {
  if (rule.and && !isFieldVisible(rule.and, values)) return false;
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

export function isFieldVisible(
  rule: CliVisibleWhen | undefined,
  values: Record<string, CliArgValue>,
): boolean {
  if (!rule) return true;
  return matchesCondition(rule, values) || (Boolean(rule.or) && isFieldVisible(rule.or, values));
}

export function isFieldRequired(
  def: { required?: boolean; requiredWhen?: CliVisibleWhen },
  values: Record<string, CliArgValue>,
): boolean {
  return (
    Boolean(def.required) || (Boolean(def.requiredWhen) && isFieldVisible(def.requiredWhen, values))
  );
}

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
  tok === "" || tok.startsWith("@") || /[\s"'\\$`|&;<>()!*?#]/.test(tok)
    ? `"${tok.replaceAll('"', '\\"')}"`
    : tok;

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
    const numbers = token.split(",");
    if (
      token.startsWith("-") &&
      token !== "-" &&
      !numbers.every((n) => n.trim() !== "" && Number.isFinite(Number(n)))
    ) {
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
      if (isBooleanActive(flags["--semantic"])) {
        next.cost = isBooleanActive(flags["--yes"]) ? "optional-paid" : "free";
        next.speed = "short";
      } else {
        next.cost = "free";
        next.speed = isBooleanActive(flags["--offline"]) ? "instant" : "short";
      }
    }
  } else if (
    commandId === "assets:semantic" &&
    ["build", "query"].includes(subcommandPath[0] ?? "")
  ) {
    if (isBooleanActive(flags["--yes"])) {
      next.effect = "write";
      next.cost = "optional-paid";
      next.speed = subcommandPath[0] === "build" ? "long" : "short";
      if (subcommandPath[0] === "build")
        next.envAnyOf = [
          flags["--provider"] === "openrouter"
            ? ["OPENROUTER_API_KEY"]
            : ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
        ];
    }
  } else if (commandId === "assets:semantic" && subcommandPath[0] === "eval") {
    if (isActiveValue(flags["--out"])) next.effect = "write";
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
    if (subcommandPath[0] === "make" && isBooleanActive(flags["--listen"])) {
      next.speed = "long";
    }
    if (subcommandPath[0] === "build" && isBooleanActive(flags["--no-listen"])) {
      next.speed = "short";
    }
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
    if (["words", "dual"].includes(String(flags["--mode"]))) {
      next.cost = "free";
      next.envAnyOf = undefined;
      if (flags["--mode"] === "dual" && isBooleanActive(flags["--plan"])) {
        next.effect = "read";
        next.confirm = { mode: "none", message: "" };
      }
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
  } else if (commandId === "comments") {
    if (
      (subcommandPath[0] === "strip" && isBooleanActive(flags["--dry-run"])) ||
      (subcommandPath[0] === "ratchet" && isBooleanActive(flags["--check"]))
    ) {
      next.effect = "read";
    } else if (subcommandPath[0] === "list" && isActiveValue(flags["--out"])) {
      next.effect = "write";
    }
  } else if (commandId === "sound:kit") {
    if (subcommandPath[0] === "similar" && isBooleanActive(flags["--stage"])) {
      next.effect = "write";
    } else if (subcommandPath[0] === "seed" && isBooleanActive(flags["--dry-run"])) {
      next.effect = "read";
    }
  }
  return next;
}

function formatCliCopyCommand(
  cwd: string,
  argv: readonly string[],
  shell: "powershell" | "posix",
): string {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const command = `cd ${quote(cwd)} && ${argv.map(quote).join(" ")}`;
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

  const combinedFieldValues: Record<string, CliArgValue> = { ...args, ...flags };
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
    if (command.id === "sheet" && isActiveValue(args.video) && isActiveValue(args.images)) {
      validationErrors.push("Give Video or Image Files, not both.");
    }
    if (
      (command.id === "studio" || command.id === "studio:lite") &&
      isBooleanActive(flags["--lan"]) &&
      (isBooleanActive(flags["--stop"]) || isBooleanActive(flags["--status"]))
    ) {
      validationErrors.push(
        "--lan only applies when starting the studio (not with --status or --stop).",
      );
    }
  }
  const exclusiveConflicts: string[] = [];

  const argvTokens: string[] = [];

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

    const groupHits = new Map<string, string[]>();
    const trackExclusive = (group: string | undefined, label: string, active: boolean) => {
      if (!group || !active) return;
      const list = groupHits.get(group) ?? [];
      list.push(label);
      groupHits.set(group, list);
    };

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
      if (!def.passthrough) validateArgumentTokens(def, tokens, validationErrors);
      argvTokens.push(...tokens);
    }

    const activeVisibleFlags = new Set<string>();
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
      activeVisibleFlags.add(def.key);

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

    if (command.id === "render" && activeVisibleFlags.has("--ref")) {
      const conflicts = ["--inspect", "--views", "--crop", "--entry", "--list"].filter((flag) =>
        activeVisibleFlags.has(flag),
      );
      if (conflicts.length) {
        validationErrors.push(
          `--ref cannot be combined with ${conflicts.join(", ")} (they draw another picture than the reference's).`,
        );
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
    if (
      !guardReason &&
      command.id === "catalog:review" &&
      isActiveValue(flags["--page"]) &&
      !isActiveValue(flags["--notes"])
    ) {
      guardReason =
        "catalog:review --page N without --notes requires verdict JSON on piped stdin; pass --notes <file>, use --missing or --fix from Studio, or pipe stdin in a terminal.";
    }
    if (
      !guardReason &&
      command.id === "collab" &&
      (chain.resolvedPath[0] === "write" || chain.resolvedPath[0] === "write-many") &&
      String(args.input ?? "").trim() === "-"
    ) {
      guardReason = `collab ${chain.resolvedPath[0]} - reads JSON from piped stdin; pass a file path in Studio, or pipe stdin in a terminal.`;
    }
    if (!guardReason && cwdMode === "film" && !resolvedFilm && context) {
      guardReason = "No film workspace available in films/ for this film-scoped command.";
    }
  }

  let requiresConfirm = false;
  let confirmMessage: string | null = null;
  if (mode === "execute" && effectiveMeta.confirm && effectiveMeta.confirm.mode !== "none") {
    const rule = effectiveMeta.confirm;
    if (rule.mode === "always") {
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
      ? `(cd ${formatShellToken(command.packageDir)} && ${cmdString})`
      : cmdString;
  const copyCwd =
    cwdMode === "film"
      ? context?.projectRoot
      : command.packageDir && context?.repoRoot
        ? `${context.repoRoot}/${command.packageDir}`
        : context?.repoRoot;
  const copyCommand = copyCwd
    ? formatCliCopyCommand(copyCwd, [...baseParts, ...argvTokens], context?.copyShell ?? "posix")
    : displayCommand;

  return {
    command,
    subcommands: chain.subcommands,
    subcommandPath: chain.resolvedPath,
    mode,
    cwdMode,
    argsDef: chain.argsDef,
    flagsDef: chain.flagsDef,
    meta: effectiveMeta,
    baseMeta: chain.meta,
    argvTokens,
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
