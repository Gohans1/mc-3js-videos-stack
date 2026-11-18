import type { CliCommand, CliFlagDef, CliSubcommand } from "./cli-catalog";
import { PLAYGROUND_COMMANDS } from "./voice-playground-commands";

const flags: CliFlagDef[] = [
  {
    key: "--input-file",
    flag: "--input-file",
    label: "JSON input file",
    type: "string",
    hint: "Every setting is available in schema <command>. Prefer a file for long text.",
    exclusiveGroup: "input",
  },
  {
    key: "--input",
    flag: "--input",
    label: "JSON input",
    type: "string",
    exclusiveGroup: "input",
    tier: "advanced",
  },
  {
    key: "--server",
    flag: "--server",
    label: "Running Studio URL",
    type: "string",
    placeholder: "http://127.0.0.1:3333",
    hint: "Use the intended Studio while it is open; no port is guessed.",
  },
  {
    key: "--project",
    flag: "--project",
    label: "Headless film",
    type: "choice",
    choiceSource: "filmDirs",
    hint: "Use --server while this project is open in Studio.",
  },
  {
    key: "--scope",
    flag: "--scope",
    label: "Library",
    type: "enum",
    options: ["project", "global"],
  },
  {
    key: "--yes",
    flag: "--yes",
    label: "Execute paid/delete action",
    type: "boolean",
    requiresConfirmIfSet: true,
    hint: "Without this, paid/delete commands only preview.",
  },
  { key: "--dry-run", flag: "--dry-run", label: "Preview only", type: "boolean" },
  { key: "--out", flag: "--out", label: "Export file", type: "string", tier: "advanced" },
  {
    key: "--wait",
    flag: "--wait",
    label: "Wait limit (seconds)",
    type: "number",
    tier: "advanced",
    hint: "1–1800; default 900. Progress is checkpointed.",
  },
  {
    key: "--checkpoint",
    flag: "--checkpoint",
    label: "Checkpoint file",
    type: "string",
    tier: "advanced",
  },
  { key: "--json", flag: "--json", label: "JSON output", type: "boolean", tier: "advanced" },
];
const nodes = (prefix: string[] = []): CliSubcommand[] => {
  const matches = PLAYGROUND_COMMANDS.filter((command) =>
    prefix.every((word, index) => command.name.split(" ")[index] === word),
  );
  return [...new Set(matches.map((command) => command.name.split(" ")[prefix.length]!))].map(
    (word) => {
      const path = [...prefix, word],
        leaf = matches.find((command) => command.name === path.join(" "));
      if (!leaf)
        return {
          id: word,
          label: word,
          summary: `${word} commands`,
          subcommandRequired: true,
          subcommands: nodes(path),
        };
      const paid = leaf.effect === "paid" || leaf.name === "region edit";
      return {
        id: word,
        label: word,
        summary: leaf.description,
        args: leaf.argument
          ? [{ key: "id", label: leaf.argument, type: "string", required: true }]
          : [],
        meta: {
          effect:
            leaf.effect === "read" ? "read" : leaf.effect === "delete" ? "destructive" : "write",
          cost: paid ? "optional-paid" : "free",
          speed: paid || leaf.name.startsWith("region ") ? "long" : "short",
          confirm: {
            mode: "when-flagged",
            message:
              "This command can spend GenVoice credits or delete an archive entry. Review the input and selected Project/Global library.",
          },
        },
      };
    },
  );
};
export const PLAYGROUND_CLI_COMMAND: CliCommand = {
  id: "voice:playground",
  label: "voice:playground",
  category: "voice",
  summary:
    "GenVoice casting, pricing, Project/Global archives, templates, versions and section repair; full JSON schemas for AI.",
  runner: "bun-script",
  target: "voice:playground",
  cwdModes: ["root"],
  subcommandRequired: true,
  flags,
  meta: {
    effect: "read",
    cost: "optional-paid",
    speed: "short",
    cancellable: true,
    helpMode: "flag",
    costHint: "Paid/delete actions preview until --yes. Local section edits are free.",
    outputsHint: "Permanent Project/Global audio plus resumable checkpoints in the user cache.",
  },
  subcommands: [
    ...nodes(),
    {
      id: "schema",
      label: "schema",
      summary: "Full input JSON Schema for a command; never generates audio.",
      args: [
        { key: "command", label: "Command words", type: "string", multi: true, required: true },
      ],
      meta: {
        effect: "read",
        cost: "free",
        speed: "instant",
        confirm: { mode: "none", message: "" },
      },
    },
    {
      id: "resume",
      label: "resume",
      summary: "Continue a checkpoint without generating again.",
      args: [{ key: "checkpoint", label: "Checkpoint file", type: "string", required: true }],
      meta: {
        effect: "write",
        cost: "free",
        speed: "long",
        confirm: { mode: "none", message: "" },
      },
    },
  ],
};
