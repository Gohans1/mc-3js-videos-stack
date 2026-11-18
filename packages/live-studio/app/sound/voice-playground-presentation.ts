import type { ComposerDraft } from "./voice-playground-view";

export const PLAYGROUND_MODE_PRESENTATION = {
  tts: {
    label: "Speech",
    shortLabel: "Speech",
    text: "text-primary-text",
    dot: "bg-primary",
    selected:
      "border-primary-text/75 bg-primary/15 text-primary-text shadow-[inset_0_-2px_0_var(--primary-text)]",
    panel: "border-primary/25 bg-primary/[0.04]",
    card: "border-primary/55 bg-primary/10 ring-primary/25 shadow-[inset_3px_0_0_var(--primary-text)]",
  },
  dialogue: {
    label: "Dialogue",
    shortLabel: "Dialogue",
    text: "text-ai-text",
    dot: "bg-ai",
    selected: "border-ai-text/75 bg-ai/15 text-ai-text shadow-[inset_0_-2px_0_var(--ai-text)]",
    panel: "border-ai/25 bg-ai/[0.04]",
    card: "border-ai/55 bg-ai/10 ring-ai/25 shadow-[inset_3px_0_0_var(--ai-text)]",
  },
  voice_changer: {
    label: "Voice changer",
    shortLabel: "Voice changer",
    text: "text-ink-text",
    dot: "bg-ink",
    selected: "border-ink-text/75 bg-ink/15 text-ink-text shadow-[inset_0_-2px_0_var(--ink-text)]",
    panel: "border-ink/25 bg-ink/[0.04]",
    card: "border-ink/55 bg-ink/10 ring-ink/25 shadow-[inset_3px_0_0_var(--ink-text)]",
  },
  stt: {
    label: "Transcribe",
    shortLabel: "Transcribe",
    text: "text-transcribe-text",
    dot: "bg-transcribe",
    selected:
      "border-transcribe-text/75 bg-transcribe/15 text-transcribe-text shadow-[inset_0_-2px_0_var(--transcribe-text)]",
    panel: "border-transcribe/25 bg-transcribe/[0.04]",
    card: "border-transcribe/55 bg-transcribe/10 ring-transcribe/25 shadow-[inset_3px_0_0_var(--transcribe-text)]",
  },
  dubbing: {
    label: "Dubbing",
    shortLabel: "Dubbing",
    text: "text-primary-text",
    dot: "bg-primary",
    selected: "border-primary-text/75 bg-primary/15 text-primary-text",
    panel: "border-primary/25 bg-primary/[0.04]",
    card: "border-primary/55 bg-primary/10 ring-primary/25",
  },
} satisfies Record<
  ComposerDraft["mode"] | "dubbing",
  {
    label: string;
    shortLabel: string;
    text: string;
    dot: string;
    selected: string;
    panel: string;
    card: string;
  }
>;
