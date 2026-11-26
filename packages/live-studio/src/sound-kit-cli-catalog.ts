import type { CliCommand, CliFlagDef } from "./cli-catalog.ts";
import { KIT_CATEGORY_IDS, KIT_STATUSES } from "./sound-kit-classify.mjs";

const jsonFlag = (tier: "common" | "advanced" = "common"): CliFlagDef => ({
  key: "--json",
  flag: "--json",
  label: "Output as JSON",
  type: "boolean",
  tier,
});

const categoryFlag = (
  opts: {
    tier?: "common" | "advanced";
    visibleWhen?: CliFlagDef["visibleWhen"];
    hint?: string;
  } = {},
): CliFlagDef => ({
  key: "--category",
  flag: "--category",
  label: "Category",
  type: "enum",
  options: KIT_CATEGORY_IDS,
  tier: opts.tier ?? "common",
  ...(opts.visibleWhen ? { visibleWhen: opts.visibleWhen } : {}),
  ...(opts.hint ? { hint: opts.hint } : {}),
});

const statusFlag: CliFlagDef = {
  key: "--status",
  flag: "--status",
  label: "Status",
  type: "enum",
  options: KIT_STATUSES,
  tier: "common",
};

const tierFlag: CliFlagDef = {
  key: "--tier",
  flag: "--tier",
  label: "Signature Tier",
  type: "enum",
  options: ["0", "1"],
  tier: "advanced",
};

const byFlag = (label: string): CliFlagDef => ({
  key: "--by",
  flag: "--by",
  label,
  type: "enum",
  options: ["ai", "human"],
  tier: "advanced",
});

export const SOUND_KIT_CLI_COMMAND: CliCommand = {
  id: "sound:kit",
  label: "sound:kit",
  category: "sound",
  summary:
    "Curate the shared Core Sound Kit (sound-kit/core.json) across 8 popular SFX/BGM categories, run A/B Elo picks, find similar sounds, or get Top-N core recommendations.",
  runner: "bun-script",
  target: "sound:kit",
  cwdModes: ["film", "root"],
  subcommandRequired: true,
  meta: {
    effect: "read",
    cost: "free",
    speed: "instant",
    cancellable: true,
    helpMode: "flag",
    outputsHint: "Reads or updates shared sound-kit/core.json",
  },
  subcommands: [
    {
      id: "stats",
      label: "stats",
      summary: "Show Core Sound Kit counts by category, status, A/B slots, and recorded decisions.",
      flags: [jsonFlag("common")],
      meta: { effect: "read", speed: "instant" },
    },
    {
      id: "list",
      label: "list",
      summary: "List tracked Core Sound Kit items filtered by category or status.",
      flags: [categoryFlag(), statusFlag, jsonFlag("common")],
      meta: { effect: "read", speed: "instant" },
    },
    {
      id: "recommend",
      label: "recommend",
      summary:
        "Rank Top-N human-approved Core Kit sounds via Bradley-Terry Elo, Rocchio taste, and MMR diversity.",
      flags: [
        categoryFlag(),
        {
          key: "--q",
          flag: "--q",
          label: "Query Words",
          type: "string",
          placeholder: "short whip",
          tier: "common",
        },
        {
          key: "--top",
          flag: "--top",
          label: "Top N",
          type: "number",
          placeholder: "5",
          tier: "common",
        },
        {
          key: "--dur",
          flag: "--dur",
          label: "Duration (min-max)",
          type: "string",
          placeholder: "0.2-1.5",
          tier: "common",
        },
        {
          key: "--ref",
          flag: "--ref",
          label: "Reference Sound ID",
          type: "string",
          placeholder: "mixkit-1473",
          tier: "advanced",
        },
        {
          key: "--recent",
          flag: "--recent",
          label: "Recent IDs (cooldown)",
          type: "csv",
          placeholder: "id1,id2",
          tier: "advanced",
        },
        jsonFlag("common"),
      ],
      meta: { effect: "read", speed: "short" },
    },
    {
      id: "add",
      label: "add",
      summary: "Add one or more sound IDs to sound-kit/core.json (defaults to inbox).",
      args: [
        {
          key: "ids",
          label: "Sound ID(s)",
          type: "string",
          multi: true,
          required: true,
          placeholder: "mixkit-275",
        },
      ],
      flags: [
        categoryFlag(),
        statusFlag,
        {
          key: "--tags",
          flag: "--tags",
          label: "Tags",
          type: "csv",
          placeholder: "short,whip",
          tier: "common",
        },
        {
          key: "--note",
          flag: "--note",
          label: "Taste Note",
          type: "string",
          tier: "common",
        },
        tierFlag,
        byFlag("Added By"),
        {
          key: "--skip-existing",
          flag: "--skip-existing",
          label: "Skip Existing",
          type: "boolean",
          tier: "common",
        },
        jsonFlag("advanced"),
      ],
      meta: { effect: "write", speed: "instant" },
    },
    {
      id: "set",
      label: "set",
      summary: "Update status, category, tags, note, or signature tier on one kit item.",
      args: [
        {
          key: "id",
          label: "Sound ID",
          type: "string",
          required: true,
          placeholder: "bgm-convergence",
        },
      ],
      flags: [
        statusFlag,
        categoryFlag(),
        {
          key: "--tags",
          flag: "--tags",
          label: "Tags",
          type: "csv",
          tier: "common",
        },
        {
          key: "--note",
          flag: "--note",
          label: "Taste Note",
          type: "string",
          tier: "common",
        },
        tierFlag,
        byFlag("Updated By"),
        jsonFlag("advanced"),
      ],
      meta: { effect: "write", speed: "instant" },
    },
    {
      id: "remove",
      label: "remove",
      summary: "Remove one or more sound IDs from sound-kit/core.json.",
      args: [
        {
          key: "ids",
          label: "Sound ID(s)",
          type: "string",
          multi: true,
          required: true,
          placeholder: "mixkit-275",
        },
      ],
      flags: [jsonFlag("advanced")],
      meta: { effect: "write", speed: "instant" },
    },
    {
      id: "ab",
      label: "ab",
      summary: "Inspect, populate, clear, or resolve the 4-slot A/B comparison tray.",
      subcommandRequired: true,
      subcommands: [
        {
          id: "show",
          label: "show",
          summary: "Show current A/B tray slots.",
          flags: [jsonFlag("common")],
          meta: { effect: "read", speed: "instant" },
        },
        {
          id: "clear",
          label: "clear",
          summary: "Empty the A/B comparison tray.",
          flags: [jsonFlag("advanced")],
          meta: { effect: "write", speed: "instant" },
        },
        {
          id: "set",
          label: "set",
          summary: "Load 1 to 4 sound IDs into the A/B comparison tray.",
          args: [
            {
              key: "ids",
              label: "Slot Sound IDs (1-4)",
              type: "string",
              multi: true,
              required: true,
              placeholder: "bgm-convergence bgm-code-switch",
            },
          ],
          flags: [jsonFlag("advanced")],
          meta: { effect: "write", speed: "instant" },
        },
        {
          id: "pick",
          label: "pick",
          summary: "Pick an A/B winner to update Bradley-Terry Elo and record taste decision.",
          args: [
            {
              key: "winner",
              label: "Winner Sound ID",
              type: "string",
              required: true,
              placeholder: "bgm-convergence",
            },
          ],
          flags: [
            categoryFlag(),
            {
              key: "--ban-losers",
              flag: "--ban-losers",
              label: "Ban Losers",
              type: "boolean",
              tier: "common",
            },
            {
              key: "--clear",
              flag: "--clear",
              label: "Clear Tray",
              type: "boolean",
              tier: "common",
            },
            {
              key: "--reason",
              flag: "--reason",
              label: "Taste Reason",
              type: "string",
              placeholder: "tighter tense pulse",
              tier: "common",
            },
            {
              key: "--context",
              flag: "--context",
              label: "Context",
              type: "string",
              tier: "advanced",
            },
            jsonFlag("advanced"),
          ],
          meta: { effect: "write", speed: "instant" },
        },
      ],
    },
    {
      id: "similar",
      label: "similar",
      summary: "Find acoustically similar vault sounds (optional --stage into inbox).",
      args: [
        {
          key: "id",
          label: "Target Sound ID",
          type: "string",
          required: true,
          placeholder: "bgm-amalgam",
        },
      ],
      flags: [
        {
          key: "--limit",
          flag: "--limit",
          label: "Limit",
          type: "number",
          placeholder: "12",
          tier: "common",
        },
        {
          key: "--stage",
          flag: "--stage",
          label: "Stage into Inbox",
          type: "boolean",
          tier: "common",
        },
        categoryFlag({
          tier: "advanced",
          visibleWhen: { field: "--stage", in: ["true"] },
          hint: "Override the category assigned when --stage adds hits into inbox",
        }),
        jsonFlag("common"),
      ],
      meta: { effect: "read", speed: "short" },
    },
    {
      id: "decisions",
      label: "decisions",
      summary: "Show recent recorded A/B winner and clip-pick taste decisions.",
      flags: [
        {
          key: "--limit",
          flag: "--limit",
          label: "Limit",
          type: "number",
          placeholder: "20",
          tier: "common",
        },
        jsonFlag("common"),
      ],
      meta: { effect: "read", speed: "instant" },
    },
    {
      id: "seed",
      label: "seed",
      summary:
        "Stage diverse starter inbox candidates across all 8 popular categories (never sets core or ban).",
      flags: [
        {
          key: "--per-category",
          flag: "--per-category",
          label: "Per Category",
          type: "number",
          placeholder: "8",
          tier: "common",
        },
        {
          key: "--dry-run",
          flag: "--dry-run",
          label: "Dry Run",
          type: "boolean",
          tier: "common",
        },
        jsonFlag("common"),
      ],
      meta: { effect: "write", speed: "short" },
    },
  ],
};
