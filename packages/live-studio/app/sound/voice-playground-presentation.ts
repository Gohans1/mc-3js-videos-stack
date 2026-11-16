import type { ComposerDraft } from "./voice-playground-view";

export const PLAYGROUND_MODE_PRESENTATION = {
  tts: {
    label: "Text to Speech",
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
    label: "Voice Changer",
    shortLabel: "Voice Changer",
    text: "text-ink-text",
    dot: "bg-ink",
    selected: "border-ink-text/75 bg-ink/15 text-ink-text shadow-[inset_0_-2px_0_var(--ink-text)]",
    panel: "border-ink/25 bg-ink/[0.04]",
    card: "border-ink/55 bg-ink/10 ring-ink/25 shadow-[inset_3px_0_0_var(--ink-text)]",
  },
  stt: {
    label: "Transcribe STT",
    shortLabel: "Transcribe",
    text: "text-ok-text",
    dot: "bg-ok",
    selected: "border-ok-text/75 bg-ok/15 text-ok-text shadow-[inset_0_-2px_0_var(--ok-text)]",
    panel: "border-ok/25 bg-ok/[0.04]",
    card: "border-ok/55 bg-ok/10 ring-ok/25 shadow-[inset_3px_0_0_var(--ok-text)]",
  },
} satisfies Record<
  ComposerDraft["mode"],
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
