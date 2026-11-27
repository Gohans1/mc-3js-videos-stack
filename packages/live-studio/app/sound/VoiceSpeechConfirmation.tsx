import { Coins, Loader2 } from "lucide-react";
import { type MouseEventHandler, type RefObject, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { PlaygroundConnection } from "../../src/voice-playground.mjs";
import { setPlaygroundSubTab, type SpeechReview } from "./voice-playground-client";

const credits = (amount: number | null) =>
  amount === null ? "Unavailable" : amount.toLocaleString();

export function voiceBillingNotice(connection: PlaygroundConnection = "genvoice") {
  if (connection === "genvoice") return "GenVoice may charge credits. The final fee is unknown.";
  const account = connection === "google" ? "Google Gemini" : "ElevenLabs";
  return `This request uses your ${account} account. Studio can’t show the final charge before generation.`;
}

export function VoiceSpeechConfirmation({
  review,
  models = [],
  returnFocus,
  successFocus,
  motion = "default",
  onConfirm,
  onClose,
}: {
  review: SpeechReview;
  models?: readonly { model_id: string; name: string }[];
  returnFocus: RefObject<HTMLButtonElement | null>;
  successFocus?: RefObject<HTMLElement | null>;
  motion?: "default" | "none";
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  type ConfirmPhase =
    | { status: "ready" }
    | { status: "submitting" }
    | { status: "failed"; message: string; unconfirmed: boolean }
    | { status: "closing"; outcome: "cancel" | "succeeded" | "check-jobs" };

  const cancel = useRef<HTMLButtonElement>(null);
  const [phase, setPhase] = useState<ConfirmPhase>({ status: "ready" });
  const phaseRef = useRef<ConfirmPhase>(phase);
  const transitionPhase = (next: ConfirmPhase) => {
    phaseRef.current = next;
    setPhase(next);
  };
  const { quote, scope } = review;
  const count = quote.rows.reduce((sum, row) => sum + row.takes, 0);
  const estimate = quote.totalCredits ?? quote.modelEstimateCredits;
  const belowEstimate =
    quote.balanceCredits !== null && estimate !== null && quote.balanceCredits < estimate;
  const remaining =
    quote.balanceCredits !== null && quote.totalCredits !== null
      ? Math.max(0, quote.balanceCredits - quote.totalCredits)
      : null;
  const submitting = phase.status === "submitting";
  const failure = phase.status === "failed" ? phase.message : "";
  const submissionUnconfirmed = phase.status === "failed" && phase.unconfirmed;
  const open = phase.status !== "closing";
  const confirm = async () => {
    const current = phaseRef.current;
    if (
      current.status === "submitting" ||
      current.status === "closing" ||
      belowEstimate ||
      (current.status === "failed" && current.unconfirmed)
    )
      return;
    transitionPhase({ status: "submitting" });
    try {
      await onConfirm();
      transitionPhase({ status: "closing", outcome: "succeeded" });
    } catch (error) {
      transitionPhase({
        status: "failed",
        message:
          error instanceof Error
            ? error.message
            : "Couldn't start Speech. Check Jobs before trying again.",
        unconfirmed: error instanceof TypeError,
      });
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && phaseRef.current.status !== "submitting" && phaseRef.current.status !== "closing")
          transitionPhase({ status: "closing", outcome: "cancel" });
      }}
      onOpenChangeComplete={(next) => {
        if (next) return;
        onClose();
        if (phaseRef.current.status === "closing" && phaseRef.current.outcome === "check-jobs")
          setPlaygroundSubTab("jobs");
      }}
    >
      <DialogContent
        variant="confirmation"
        data-voice-playground
        motion={motion === "none" ? "none" : "confirmation"}
        initialFocus={cancel}
        finalFocus={() =>
          (phaseRef.current.status === "closing" && phaseRef.current.outcome === "succeeded"
            ? successFocus?.current
            : null) ?? returnFocus.current
        }
        className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-xl"
      >
        <DialogHeader className="me-7 shrink-0">
          <DialogTitle>Generate {count === 1 ? "one take" : count + " takes"}</DialogTitle>
          <DialogDescription className="max-w-[60ch]">
            GenVoice charges credits. Your takes will be saved to{" "}
            {scope === "global" ? "Global" : "this project"}.
          </DialogDescription>
        </DialogHeader>
        <dl className="border-hairline grid shrink-0 grid-cols-3 gap-4 border-b pb-4 tabular-nums">
          <div>
            <dt className="text-reading-foreground text-xs">Current balance</dt>
            <dd className="mt-1 font-medium">{credits(quote.balanceCredits)}</dd>
          </div>
          <div>
            <dt className="text-reading-foreground text-xs">
              {quote.totalCredits === null ? "Estimated model cost" : "Estimated total"}
            </dt>
            <dd className="mt-1 font-medium">{credits(estimate)}</dd>
          </div>
          <div>
            <dt className="text-reading-foreground text-xs">Balance after generation</dt>
            <dd className="mt-1 font-medium">
              {remaining === null ? "Unknown" : credits(remaining)}
            </dd>
          </div>
        </dl>
        <ul
          aria-label="Fee breakdown by voice"
          tabIndex={0}
          className="divide-hairline focus-visible:outline-ring min-h-0 divide-y overflow-y-auto overscroll-contain pe-2 focus-visible:outline-2 focus-visible:-outline-offset-2"
        >
          {quote.rows.map((row, index) => (
            <li
              key={row.voiceId + ":" + index}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium" title={row.voiceName}>
                  <bdi>{row.voiceName}</bdi>
                </p>
                <p className="text-muted-foreground text-xs">
                  {models.find((model) => model.model_id === row.modelId)?.name || row.modelId} ·{" "}
                  {row.takes} {row.takes === 1 ? "take" : "takes"}
                </p>
              </div>
              <span className="text-sm tabular-nums">
                {row.totalCredits !== null
                  ? credits(row.totalCredits) + " credits"
                  : row.modelEstimateCredits !== null
                    ? credits(row.modelEstimateCredits) + " model credits"
                    : "Fee unknown"}
              </span>
            </li>
          ))}
        </ul>
        {quote.totalCredits === null && (
          <p className="text-reading-foreground max-w-[60ch] shrink-0 text-sm leading-relaxed text-pretty">
            GenVoice has not quoted the full charge, so the remaining balance is unknown. Each
            recording shows its confirmed fee when available.
          </p>
        )}
        {(failure || belowEstimate) && (
          <p role="alert" className="text-warn-text max-w-[60ch] shrink-0 text-sm leading-relaxed text-pretty">
            {failure ||
              (review.comparison
                ? "Your balance is below the estimate. Cancel, then remove a voice or shorten the script."
                : "Your balance is below the estimate. Cancel, then reduce the number of takes or shorten the script.")}
          </p>
        )}
        <DialogFooter className="shrink-0 flex-wrap">
          <Button
            ref={cancel}
            type="button"
            variant="secondary"
            disabled={submitting || phase.status === "closing"}
            onClick={() => {
              if (phaseRef.current.status !== "closing") {
                transitionPhase({ status: "closing", outcome: "cancel" });
              }
            }}
          >
            Cancel
          </Button>
          {submissionUnconfirmed && (
            <Button
              type="button"
              size="xl"
              onClick={() => transitionPhase({ status: "closing", outcome: "check-jobs" })}
            >
              Check Jobs
            </Button>
          )}
          {!submissionUnconfirmed && (
            <Button
              type="button"
              size="xl"
              disabled={submitting || belowEstimate}
              onClick={() => void confirm()}
            >
              {submitting ? (
                <Loader2 className="animate-spin motion-reduce:animate-none" />
              ) : (
                <Coins />
              )}
              {submitting
                ? "Submitting…"
                : count === 1
                  ? "Generate take"
                  : "Generate " + count + " takes"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function VoicePaidActionConfirmation({
  action,
  description = voiceBillingNotice(),
  motion = "default",
  returnFocus,
  onConfirm,
  onClose,
}: {
  action: string;
  description?: string;
  motion?: "default" | "none";
  returnFocus: RefObject<HTMLButtonElement | null>;
  onConfirm: MouseEventHandler<HTMLButtonElement>;
  onClose: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(true);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        variant="confirmation"
        data-voice-playground
        motion={motion === "none" ? "none" : "confirmation"}
        initialFocus={cancel}
        finalFocus={returnFocus}
      >
        <DialogHeader>
          <DialogTitle>{action}</DialogTitle>
          <DialogDescription className="max-w-[60ch]">
            {description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button ref={cancel} type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="xl"
            onClick={(event) => {
              if (!open) return;
              setOpen(false);
              onConfirm(event);
            }}
          >
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
