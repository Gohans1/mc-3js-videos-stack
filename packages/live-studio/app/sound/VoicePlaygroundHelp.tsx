import { Copy, ExternalLink } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

const tasks = [
  {
    name: "Speech & Dialogue",
    text: "Choose a voice, direct its delivery and review the estimate. Each recording keeps its complete recipe. Voice fees remain Unknown when GenVoice has not verified them.",
  },
  {
    name: "Voice changer",
    text: "Upload a performance or choose a saved recording, then select its new voice. Delivery comes from your source; each version retains the original so you can retry or change voices later.",
  },
  {
    name: "Transcribe",
    text: "Choose an audio or video source and enter a language code such as en or vi. Uploading and saving a reusable template are free; starting Scribe may cost credits, with Unknown shown until GenVoice reports a fee. The transcript, original and settings stay in Project or Global, ready to export or send to Speech.",
  },
  {
    name: "Project & Global",
    text: "This project sees its own recordings and the shared Global library. Save a copy to Global to reuse it in future films; the original stays in the project.",
  },
  {
    name: "Templates & favorites",
    text: "Save a recipe before or after generating. Loading and editing a template is free. Favorite catalog samples, recordings and templates independently.",
  },
  {
    name: "Compare & replace",
    text: "In Recordings, add up to seven takes to Compare. Choose a take to replace a film line and keep the previous take as an alternative.",
  },
  {
    name: "Edit a section",
    text: "Choose Edit a section on a recording to open the waveform. Local timing, pitch and volume changes are free; regenerating a phrase uses the recording’s speech service and may incur a charge. Every saved edit creates a new version.",
  },
  {
    name: "Dubbing & recovery",
    text: "Upload or reuse a source, choose the languages and voice, then prepare a free quote. Dubbing costs 50 credits per source second. Check Jobs after an interrupted submission; checking status is free, while a new paid attempt can charge again.",
  },
  {
    name: "Clones & rights",
    text: "Clone only a voice you own or have permission to use. Project and Global copies share the cloud identity. API access does not confirm commercial rights; keep the relevant terms and permission evidence with the recording.",
  },
];

export function VoicePlaygroundHelp() {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState(""),
    command = "bun run voice:playground --help";
  return (
    <div className="h-full overflow-y-auto overscroll-contain p-6">
      <div className="mx-auto max-w-6xl space-y-8">
        <section aria-labelledby="voice-help-cli" className="max-w-prose">
          <h3 id="voice-help-cli" className="text-foreground text-lg leading-tight font-semibold">
            AI CLI
          </h3>
          <p className="text-reading-foreground mt-2 text-sm leading-relaxed">
            The CLI exposes schemas, catalog discovery, Project/Global storage, exports and
            resumable checkpoints. Paid commands preview their request until you explicitly approve
            with --yes.
          </p>
          <div className="bg-surface-subtle mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg p-4">
            <code className="text-foreground text-sm break-all">{command}</code>
            <Button
              variant="secondary"
              onClick={() =>
                void navigator.clipboard
                  .writeText(command)
                  .then(() => {
                    setCopied(true);
                    setError("");
                  })
                  .catch(() =>
                    setError("Select and copy the command above. Clipboard access is unavailable."),
                  )
              }
            >
              <Copy />
              {copied ? "Copied" : "Copy command"}
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-warn-text mt-2 text-sm">
              {error}
            </p>
          )}
        </section>
        <div className="border-hairline grid grid-cols-1 gap-x-10 gap-y-6 border-t pt-6 @[56rem]/voice-workbench:grid-cols-2">
          {tasks.map((task) => (
            <section key={task.name}>
              <h3 className="text-foreground text-base leading-tight font-semibold">{task.name}</h3>
              <p className="text-reading-foreground mt-1 max-w-[60ch] text-sm leading-relaxed text-pretty">
                {task.text}
              </p>
            </section>
          ))}
        </div>
        <a
          href="https://genvoice.pro/llms.txt"
          target="_blank"
          rel="noreferrer"
          className="text-primary-text focus-visible:outline-ring inline-flex items-center gap-2 rounded text-sm underline underline-offset-4 focus-visible:outline-2"
        >
          Read the GenVoice API reference
          <ExternalLink className="size-4" />
        </a>
      </div>
    </div>
  );
}
