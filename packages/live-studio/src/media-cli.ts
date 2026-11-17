import tools from "../../../scripts/media/tools.json";
import type { CliFlagDef, CliSubcommand } from "./cli-catalog.ts";

export const nativeMediaSubcommands: CliSubcommand[] = Object.entries(tools).flatMap(
  ([id, tool]) => {
    if (!("binary" in tool)) return [];
    const flags: CliFlagDef[] = [
      { key: "--out", flag: "--out", label: "Evidence Parent", type: "string" },
      {
        key: "--minutes",
        flag: "--minutes",
        label: "Deadline Minutes",
        type: "number",
        placeholder: "5",
      },
      { key: "--dry-run", flag: "--dry-run", label: "Validate Only", type: "boolean" },
    ];
    if (["ced", "tts", "caption", "vision"].includes(id))
      flags.push({
        key: "--threads",
        flag: "--threads",
        label: "CPU Threads",
        type: "number",
        tier: "advanced",
      });
    if (["denoise", "ced", "fingerprint", "caption"].includes(id))
      flags.push(
        { key: "--from", flag: "--from", label: "From File Second", type: "string" },
        { key: "--to", flag: "--to", label: "To File Second", type: "string" },
      );
    if (["ced", "tts", "caption", "vision"].includes(id))
      flags.push({
        key: "--model",
        flag: "--model",
        label: "Custom Model File",
        type: "string",
        tier: "advanced",
      });
    if (["caption", "vision"].includes(id))
      flags.push(
        {
          key: "--projector",
          flag: "--projector",
          label: "Custom Projector File",
          type: "string",
          tier: "advanced",
        },
        { key: "--prompt", flag: "--prompt", label: "Question / Creative Prompt", type: "string" },
        {
          key: "--tokens",
          flag: "--tokens",
          label: "Maximum Output Tokens",
          type: "number",
          placeholder: "96",
        },
        {
          key: "--context",
          flag: "--context",
          label: "Context Size",
          type: "number",
          placeholder: "4096",
          tier: "advanced",
        },
      );
    if (id === "vision")
      flags.push({ key: "--at", flag: "--at", label: "Video File Second", type: "string" });
    if (id === "ced")
      flags.push({
        key: "--top-k",
        flag: "--top-k",
        label: "Top Labels",
        type: "number",
        placeholder: "5",
      });
    if (id === "midi")
      flags.push({
        key: "--soundfont",
        flag: "--soundfont",
        label: "Custom SoundFont",
        type: "string",
        tier: "advanced",
      });
    if (id === "fingerprint")
      flags.push({
        key: "--length",
        flag: "--length",
        label: "Maximum File Seconds",
        type: "string",
        placeholder: "120",
      });
    if (id === "tts")
      flags.push(
        {
          key: "--text",
          flag: "--text",
          label: "Text",
          type: "string",
          requiredWhen: { field: "--text-file", unsetOrIn: [""] },
          exclusiveGroup: "speechText",
        },
        {
          key: "--text-file",
          flag: "--text-file",
          label: "UTF-8 Text File",
          type: "string",
          requiredWhen: { field: "--text", unsetOrIn: [""] },
          exclusiveGroup: "speechText",
        },
        {
          key: "--voice",
          flag: "--voice",
          label: "Native Voice ID",
          type: "string",
          placeholder: "af_heart",
        },
        {
          key: "--language",
          flag: "--language",
          label: "Voice Language",
          type: "string",
          placeholder: "en-us",
        },
        {
          key: "--seed",
          flag: "--seed",
          label: "Seed",
          type: "number",
          placeholder: "0",
          tier: "advanced",
        },
      );
    return [
      {
        id,
        label: id,
        summary: tool.summary,
        args:
          id === "tts"
            ? []
            : [
                {
                  key: "source",
                  label: id === "midi" ? "MIDI File" : "Source Media",
                  type: "string",
                  required: true,
                },
              ],
        flags,
        meta: { effect: "write", cost: "free", speed: "long" },
      },
    ];
  },
);
