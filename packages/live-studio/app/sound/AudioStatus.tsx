import { useSyncExternalStore } from "react";

import { Callout } from "@/components/ui/callout";

import {
  needsProcessing,
  processedRevision,
  processSpec,
  processStatus,
  subscribeProcessed,
} from "./processed";
import type { ClipRef } from "./slice";
import { clipOf, span } from "./sound";

export function AudioStatus({ clip }: { clip: ClipRef }) {
  useSyncExternalStore(subscribeProcessed, processedRevision, processedRevision);
  const c = clipOf(clip),
    [from, to] = span(clip);
  const status =
    c && needsProcessing(c)
      ? processStatus(processSpec(c, to - from, clip.list === "beds"))
      : undefined;
  if (!status) return null;
  if (status.status === "error") return <Callout role="alert">{status.message}</Callout>;
  return (
    <p aria-live="polite" className="text-muted-foreground text-xs">
      {status.status === "loading" ? "Processing audio…" : "Audio ready"}
    </p>
  );
}
