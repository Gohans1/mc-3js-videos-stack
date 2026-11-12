import type { ClipRef } from "./slice";
import { snapshot } from "./sound";

export const measureClip = async (
  ref: ClipRef,
  data = JSON.parse(snapshot()),
): Promise<{ loudness: number; peak: number }> => {
  const response = await fetch("/api/sound/measure", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(255000),
    body: JSON.stringify({ ...ref, data }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not measure this clip");
  if (result.loudness === null || result.peak === null)
    throw new Error("This clip is silent or too quiet to measure");
  return result;
};
