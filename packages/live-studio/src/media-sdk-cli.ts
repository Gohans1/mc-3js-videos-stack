import tools from "../../../scripts/media/tools.json";
import type { CliFlagDef, CliSubcommand } from "./cli-catalog.ts";

export const sdkMediaSubcommands: CliSubcommand[] = Object.entries(tools).flatMap(([id, tool]) => {
  if (tool.worker !== "scripts/media/sdk.py") return [];
  const flags: CliFlagDef[] = [
    { key: "--out", flag: "--out", label: "Evidence Parent", type: "string" },
    { key: "--minutes", flag: "--minutes", label: "Deadline Minutes", type: "number" },
    { key: "--dry-run", flag: "--dry-run", label: "Validate Only", type: "boolean" },
  ];
  if (id !== "timeline")
    flags.push(
      { key: "--from", flag: "--from", label: "From File Second", type: "string" },
      { key: "--to", flag: "--to", label: "To File Second", type: "string" },
    );
  if (["beat", "effects", "vad", "melody", "separate"].includes(id))
    flags.push({
      key: "--config",
      flag: "--config",
      label: "Native JSON Configuration",
      type: "string",
      required: id === "effects",
    });
  if (["beat", "vad", "melody", "separate", "locate"].includes(id))
    flags.push({
      key: "--model",
      flag: "--model",
      label: "Custom Model File / Directory",
      type: "string",
      tier: "advanced",
    });
  if (["beat", "vad", "locate"].includes(id))
    flags.push({
      key: "--threads",
      flag: "--threads",
      label: "CPU Threads",
      type: "number",
      tier: "advanced",
    });
  if (id === "effects")
    flags.push({
      key: "--tail",
      flag: "--tail",
      label: "Tail Seconds",
      type: "string",
      placeholder: "2",
    });
  if (id === "locate")
    flags.push(
      {
        key: "--query",
        flag: "--query",
        label: "Sound Description",
        type: "string",
        required: true,
        multi: true,
        multiStyle: "repeat",
        placeholder: '"a man speaking" "a dog barking"',
        hint: "Quote each complete phrase, or pass a string array through the command API.",
      },
      {
        key: "--threshold",
        flag: "--threshold",
        label: "Raw Logit Threshold",
        type: "number",
        placeholder: "0",
      },
    );
  return [
    {
      id,
      label: id,
      summary: tool.summary,
      args: [
        {
          key: "source",
          label: id === "timeline" ? "Timeline JSON / OTIO" : "Source Audio / Video",
          type: "string",
          required: true,
        },
      ],
      flags,
      meta: { effect: "write", cost: "free", speed: "long" },
    },
  ];
});
