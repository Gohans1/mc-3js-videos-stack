import { join, resolve } from "node:path";

import { ROOT } from "../vault.mjs";

export const semanticSettings = (env: Record<string, string | undefined> = process.env) => {
  const db = resolve(
    ROOT,
    env.MC_SEMANTIC_DB?.trim() || join(ROOT, ".studio", "asset-search.sqlite"),
  );
  const quotaDb = resolve(ROOT, env.MC_SEMANTIC_QUOTA_DB?.trim() || `${db}.requests.sqlite`);
  const dailyLimit = Number(env.MC_SEMANTIC_DAILY_LIMIT ?? "1000");
  if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 1)
    throw new Error("MC_SEMANTIC_DAILY_LIMIT needs a positive whole request budget");
  if (db === quotaDb) throw new Error("Vector database and quota ledger must use separate files");
  return {
    db,
    quotaDb,
    dailyLimit,
    manifest: env.MC_SEMANTIC_MANIFEST?.trim()
      ? resolve(ROOT, env.MC_SEMANTIC_MANIFEST.trim())
      : undefined,
  };
};
