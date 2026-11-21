import tools from "../../../scripts/media/tools.json";
import type { CliFlagDef, CliSubcommand } from "./cli-catalog.ts";

const evidence: CliFlagDef[] = [
  { key: "--out", flag: "--out", label: "Evidence Parent", type: "string" },
  { key: "--minutes", flag: "--minutes", label: "Deadline Minutes", type: "number" },
  { key: "--dry-run", flag: "--dry-run", label: "Validate Only", type: "boolean" },
];

export const referenceMediaSubcommands: CliSubcommand[] = [
  ...(["tapir", "track"] as const).map((id): CliSubcommand => ({
    id,
    label: id,
    summary: tools[id].summary,
    args: [{ key: "source", label: "Source Video", type: "string", required: true }],
    flags: [
      ...evidence,
      { key: "--from", flag: "--from", label: "From File Second", type: "string" },
      { key: "--to", flag: "--to", label: "To File Second", type: "string" },
      { key: "--fps", flag: "--fps", label: "Sample FPS", type: "number" },
      { key: "--frames", flag: "--frames", label: "Maximum Sampled Frames", type: "number" },
      { key: "--threads", flag: "--threads", label: "CPU Threads", type: "number" },
      { key: "--model", flag: "--model", label: "Custom Model", type: "string" },
      ...(id === "tapir"
        ? ([
            {
              key: "--point",
              flag: "--point",
              label: "Original Pixels x,y",
              type: "string",
              multi: true,
              multiStyle: "repeat",
              required: true,
            },
            {
              key: "--query-frame",
              flag: "--query-frame",
              label: "Sampled Query Frame Index",
              type: "number",
            },
          ] as CliFlagDef[])
        : ([
            {
              key: "--threshold",
              flag: "--threshold",
              label: "Detection Threshold",
              type: "number",
            },
            {
              key: "--class",
              flag: "--class",
              label: "COCO Class ID",
              type: "number",
              multi: true,
              multiStyle: "repeat",
            },
          ] as CliFlagDef[])),
    ],
    meta: { effect: "write", cost: "free", speed: "long" },
  })),
  {
    id: "camera",
    label: "camera",
    summary: tools.camera.summary,
    args: [
      {
        key: "action",
        label: "Action",
        type: "enum",
        options: ["motion", "solve"],
        required: true,
      },
      { key: "source", label: "Source Video", type: "string", required: true },
    ],
    flags: [
      ...evidence,
      {
        key: "--from",
        flag: "--from",
        label: "From File Second",
        type: "number",
        visibleWhen: { field: "action", in: ["motion"] },
      },
      {
        key: "--to",
        flag: "--to",
        label: "To File Second",
        type: "number",
        visibleWhen: { field: "action", in: ["motion"] },
      },
      {
        key: "--shot",
        flag: "--shot",
        label: "Shot File (points of our set)",
        type: "string",
        requiredWhen: { field: "action", in: ["solve"] },
        visibleWhen: { field: "action", in: ["solve"] },
      },
    ],
    meta: { effect: "write", cost: "free", speed: "long" },
  },
  {
    id: "foley",
    label: "foley",
    summary: tools.foley.summary,
    subcommandRequired: true,
    subcommands: ["index", "search", "status", "describe"].map((id): CliSubcommand => ({
      id,
      label: id,
      summary: `${id} the explicitly configured local sound catalog.`,
      args: ["search", "describe"].includes(id)
        ? [
            {
              key: "value",
              label: id === "search" ? "Sound Description" : "Asset ID / Relative Path",
              type: "string",
              required: true,
            },
          ]
        : [],
      flags: [
        ...evidence,
        {
          key: "--config",
          flag: "--config",
          label: "Native Foley TOML",
          type: "string",
          required: true,
        },
        ...(["index", "search"].includes(id)
          ? ([
              { key: "--limit", flag: "--limit", label: "Result / Analysis Limit", type: "number" },
            ] as CliFlagDef[])
          : []),
        ...(id === "index"
          ? ([
              { key: "--workers", flag: "--workers", label: "Analysis Workers", type: "number" },
            ] as CliFlagDef[])
          : []),
      ],
      meta: { effect: "write", cost: "free", speed: "long" },
    })),
  },
];
