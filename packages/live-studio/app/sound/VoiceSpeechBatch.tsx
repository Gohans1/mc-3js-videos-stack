import { ListPlus, Loader2, X } from "lucide-react";
import { type RefObject, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";

import { listening, subscribeAudition } from "./sound";
import {
  comparisonSpeechDraft,
  launchReviewedSpeech,
  previewCastingVoice,
  reviewGenVoiceSpeech,
  selectSpeechConnection,
  type SpeechReview,
  switchPlaygroundTool,
  toggleSpeechComparisonVoice,
  type VoicePlaygroundClientState,
} from "./voice-playground-client";
import { castingAuditionId } from "./voice-playground-view";
import { VoiceSpeechConfirmation } from "./VoiceSpeechConfirmation";
import { VoicePlaybackIcon } from "./VoicePlaybackIcon";

export function VoiceSpeechBatch({
  pg,
  onBrowse,
  resultFocus,
}: {
  pg: VoicePlaygroundClientState;
  onBrowse: () => void;
  resultFocus: RefObject<HTMLHeadingElement | null>;
}) {
  type BatchReviewFlow =
    | { status: "idle" }
    | { status: "checking"; viaKeyboard: boolean }
    | { status: "error"; message: string }
    | { status: "reviewing"; review: SpeechReview; viaKeyboard: boolean };

  const playingVoice = useSyncExternalStore(subscribeAudition, listening, listening);
  const voices = pg.compareVoices ?? [];
  const draft = comparisonSpeechDraft(pg.draft);
  const genVoiceDraft = (draft?.connection ?? "genvoice") === "genvoice";
  const script = genVoiceDraft ? draft?.text : undefined;
  const hasScript = Boolean(script?.trim());
  const [flow, setFlow] = useState<BatchReviewFlow>({ status: "idle" });
  const reviewButton = useRef<HTMLButtonElement>(null);
  const currentVoice = draft?.voiceId
    ? {
        id: draft.voiceId,
        name: draft.voiceName,
        category: "custom",
        provider: draft.provider,
        gender: draft.voiceGender,
        previewUrl: draft.voicePreviewUrl,
        connection: draft.connection,
      }
    : null;
  const hasCurrent =
    currentVoice &&
    voices.some((voice) => castingAuditionId(voice) === castingAuditionId(currentVoice));
  const checking = flow.status === "checking";
  const requestReview = async (viaKeyboard: boolean) => {
    if (flow.status === "checking" || flow.status === "reviewing") return;
    setFlow({ status: "checking", viaKeyboard });
    try {
      const nextReview = await reviewGenVoiceSpeech(voices);
      setFlow({ status: "reviewing", review: nextReview, viaKeyboard });
    } catch (cause) {
      setFlow({
        status: "error",
        message:
          cause instanceof TypeError
            ? "Couldn't get the estimate. Reconnect to Studio, then review the batch again."
            : cause instanceof Error
              ? cause.message
              : "Couldn't get the estimate. Review the batch again to retry.",
      });
    }
  };
  return (
    <section
      aria-label="Set up the next comparison batch"
      className="border-hairline bg-card mb-5 flex flex-col gap-2.5 rounded-lg border p-5"
    >
      <div>
        <h3 className="text-heading-foreground text-base leading-tight font-semibold">
          Set up a comparison batch
        </h3>
        <p className="text-muted-foreground mt-1 text-sm tabular-nums">
          {voices.length}/7 voices · Save to {pg.scope === "global" ? "Global" : "Project"}
        </p>
      </div>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
        {hasScript ? (
          <div className="min-w-0 max-w-[60ch] text-sm">
            <p className="text-muted-foreground mb-1 text-xs font-medium">
              Script for the next batch
            </p>
            <p
              dir="auto"
              className="text-foreground line-clamp-2 wrap-anywhere whitespace-pre-wrap"
              title={script}
            >
              {script}
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {genVoiceDraft
              ? "Write or load a GenVoice Speech script to generate a comparison."
              : "Compare uses GenVoice. Open the script in GenVoice Speech to continue."}
          </p>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            switchPlaygroundTool("tts");
            if (!genVoiceDraft) selectSpeechConnection("genvoice");
          }}
        >
          {genVoiceDraft ? "Edit script" : "Edit in GenVoice Speech"}
        </Button>
      </div>
      <ul className="flex flex-wrap items-center gap-2 empty:hidden">
        {voices.map((voice) => {
          const playing = playingVoice === castingAuditionId(voice);
          return (
            <li
              key={castingAuditionId(voice)}
              className="border-hairline bg-surface-subtle inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-1"
            >
              {voice.previewUrl && (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`${playing ? "Pause" : "Play"} free sample for ${voice.name}`}
                  aria-pressed={playing}
                  onClick={() => previewCastingVoice(voice)}
                >
                  <VoicePlaybackIcon playing={playing} className="size-3" />
                </Button>
              )}
              <span className="text-foreground truncate px-1 text-xs" title={voice.name}>
                {voice.name}
              </span>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Remove ${voice.name} from batch`}
                onClick={() => toggleSpeechComparisonVoice(voice)}
              >
                <X />
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <Button size="sm" variant="secondary" onClick={onBrowse}>
          <ListPlus /> Browse voices
        </Button>
        {hasScript && currentVoice && !hasCurrent && voices.length < 7 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => toggleSpeechComparisonVoice(currentVoice)}
          >
            Add {currentVoice.name}
          </Button>
        )}
        <Button
          ref={reviewButton}
          size="xl"
          disabled={
            voices.length < 2 ||
            !hasScript ||
            !pg.status.configured ||
            Boolean(pg.busyAction) ||
            checking
          }
          onClick={(event) => void requestReview(event.detail === 0)}
        >
          {checking && <Loader2 className="animate-spin motion-reduce:animate-none" />}
          {checking
            ? "Checking credits…"
            : voices.length >= 2
              ? `Review cost for ${voices.length} takes`
              : "Review batch"}
        </Button>
        {hasScript && !pg.status.configured && (
          <p className="text-muted-foreground text-sm">Connect GenVoice to review the cost.</p>
        )}
        {hasScript && pg.status.configured && voices.length < 2 && (
          <p className="text-muted-foreground text-sm">
            Add at least two voices to review the cost.
          </p>
        )}
      </div>
      {flow.status === "error" && (
        <p role="alert" className="text-warn-text text-sm">
          {flow.message}
        </p>
      )}
      {flow.status === "reviewing" && (
        <VoiceSpeechConfirmation
          review={flow.review}
          models={pg.catalog.models}
          returnFocus={reviewButton}
          successFocus={resultFocus}
          motion={flow.viaKeyboard ? "none" : "default"}
          onConfirm={() => launchReviewedSpeech(flow.review)}
          onClose={() => setFlow({ status: "idle" })}
        />
      )}
    </section>
  );
}
