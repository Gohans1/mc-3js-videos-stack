import { useSyncExternalStore } from "react";
import { needsProcessing, processSpec, processStatus, processedRevision, subscribeProcessed } from "./processed";
import { clipOf, span } from "./sound";
import type { ClipRef } from "./slice";

export function AudioStatus({ clip }: { clip: ClipRef }) {
  useSyncExternalStore(subscribeProcessed, processedRevision, processedRevision);
  const c = clipOf(clip), [from, to] = span(clip);
  const status = c && needsProcessing(c) ? processStatus(processSpec(c, to - from, clip.list === "beds")) : undefined;
  return status && <p aria-live="polite" className="text-xs text-muted-foreground">{status.status === "loading" ? "Processing audio…" : status.status === "error" ? status.message : "Audio ready"}</p>;
}
