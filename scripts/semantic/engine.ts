import { setTimeout as delay } from "node:timers/promises";

import { inputFor, segmentsFor, sourceHash } from "./media";
import { type Embed } from "./model";
import { type Asset, type Index, inputFingerprint } from "./store";

export const runIndex = async (
  assets: Asset[],
  index: Index,
  options: {
    allowApi: boolean;
    embed: Embed;
    maxRequests: number;
    deadline: number;
    pace?: { rpm: number; tpm: number };
    progress?: (value: { key: string; part: number; requests: number }) => void;
  },
) => {
  if (!options.allowApi) throw new Error("Embedding requires explicit opt-in (--yes)");
  if (
    !Number.isSafeInteger(options.maxRequests) ||
    options.maxRequests < 1 ||
    !Number.isFinite(options.deadline)
  )
    throw new Error("Set a finite time and request limit");
  if (
    options.pace &&
    ![options.pace.rpm, options.pace.tpm].every((n) => Number.isFinite(n) && n > 0)
  )
    throw new Error("Set positive RPM and TPM limits");
  let requests = 0;
  let nextRequestAt = 0;
  const result = (
    stopped: "complete" | "time-limit" | "request-limit" | "error",
    error?: string,
  ) => ({ requests, stopped, ...(error && { error }), ...index.status() });
  for (const asset of assets) {
    if (Date.now() >= options.deadline) return result("time-limit");
    try {
      const source = await sourceHash(asset, options.deadline);
      const previous = index.get(asset.key);
      const same = previous?.inputHash === inputFingerprint(asset, source);
      index.stage(asset, source, same ? [] : segmentsFor(asset, options.deadline));
      for (const job of index.pending(asset.key)) {
        if (requests >= options.maxRequests) return result("request-limit");
        if (Date.now() >= options.deadline) return result("time-limit");
        try {
          const input = await inputFor(asset, job.spec, options.deadline);
          if (options.pace) {
            const wait = Math.max(0, nextRequestAt - Date.now());
            if (Date.now() + wait >= options.deadline) return result("time-limit");
            if (wait) await delay(wait);
            const duration = job.spec.to - job.spec.from;
            const tokens =
              100 +
              Math.ceil(
                Buffer.byteLength(JSON.stringify(input.filter((p) => p.type === "text"))) / 2,
              ) +
              (asset.media?.kind === "audio"
                ? duration * 25
                : asset.media?.kind === "video"
                  ? Math.ceil(duration) * 66
                  : asset.media
                    ? 258
                    : 0);
            nextRequestAt =
              Date.now() + Math.max(60000 / options.pace.rpm, (tokens * 60000) / options.pace.tpm);
          }
          const remaining = options.deadline - Date.now();
          if (remaining < 1) return result("time-limit");
          requests++;
          const embedded = await options.embed(input, AbortSignal.timeout(remaining));
          index.complete(job, embedded);
          options.progress?.({ key: asset.key, part: job.part, requests });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          index.fail(job, message);
          return result("error", message);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      index.assetFailed(asset.key, message);
      return result(Date.now() >= options.deadline ? "time-limit" : "error", message);
    }
  }
  return result("complete");
};
