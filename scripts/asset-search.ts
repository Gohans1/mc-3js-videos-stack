import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { cliArgs, numberArg } from "../packages/live-studio/src/cli.mjs";
import { allEntries } from "./find";
import { assetFromEntry, readiness, readManifest } from "./semantic/catalog";
import { runIndex } from "./semantic/engine";
import { configuredProvider, createEmbedder } from "./semantic/model";
import { DEFAULT_INDEX, searchIndex } from "./semantic/search";
import { type Index, openIndex } from "./semantic/store";
import { ROOT } from "./vault.mjs";

const HELP = `Incremental local Gemini Embedding 2 search (Google direct or OpenRouter; evaluate relevance before bulk use).
  bun run assets:semantic plan                         counts and sample keys; no requests or vector writes
  bun run assets:semantic build                        same preview; only --yes enables embedding
  bun run assets:semantic build --yes --key '<key>'     selected asset, saved after every completed chunk
  bun run assets:semantic status                       progress and failures
  bun run assets:semantic query "sad farewell"          cached query only; --yes permits one paid query
  bun run assets:semantic remove '<key>'                hide from search; keep cached vectors for re-adding
  bun run assets:semantic remove '<key>' --purge        also permanently delete that asset's cached vectors
  bun run assets:semantic backup snapshot.sqlite       consistent SQLite copy; refuses an existing destination
  bun run assets:semantic redo '<key>' [--part 0]        clear selected completed work; next build retries it
Options:
  --db PATH              default: repo .studio/asset-search.sqlite (shared catalog, not film-local overrides)
  --manifest JSON        plan/build: local array [{key,title,text,media?:{kind,file}}], file relative to manifest
  --key KEY              plan/build: exact key printed by plan/query; omitted means the current catalog
  --dimensions N         768 (default), 1536 or 3072; each space needs a separate database
  --provider NAME        auto (default): Gemini with GEMINI_API_KEY/GOOGLE_API_KEY, otherwise OpenRouter
                         gemini or openrouter pins the provider; no automatic failover or key rotation
  --rpm N                build: maximum requests/minute, default 60; use your project quota
  --tpm N                build: estimated input tokens/minute, default 24000, including media
  --max-requests N       build: default 10, at most 100000 attempts per invocation
  --max-seconds N        build: default 60, at most 3600; each subprocess/request also has a timeout
  --purge                remove only: permanently forget that asset's cached vectors
  --yes                  build/query only: allow external requests; project billing/quota determine cost
Names/descriptions join media in one vector. Filter metadata stays separate; no paid caption generation.
Audio: <=30 s per MP3 chunk, retaining source timestamps; video: <=30 s, 1 fps, no audio track; images: PNG within 768 px.
FBX/GLB/presets use text unless a manifest supplies a rendered preview. Only the catalog is included, not all raw vault files.
Rerun build after changing assets/metadata: unchanged inputs reuse vectors; append/update never removes absent entries.
Failed/interrupted builds keep completed chunks. An interrupted request can be charged and need retry; no automatic retries.
Run one builder per database. Use backup to move progress outside a disposable worktree; never copy only an open WAL database file.
remove keeps old vectors; re-adding identical inputs reuses them. --purge explicitly deletes that asset's retained cache.
No requests without --yes; no index build is needed for ordinary find. Hybrid: bun run find --semantic "<scene>" (--yes on a new query).
Google free-tier content may improve Google's products. Send only assets whose rights permit that; keep restricted/unknown sources out of unpaid cloud uploads.
Quota/HTTP errors stop with completed work saved; no automatic retries, provider fallback or account rotation.
Keys belong in environment variables or ignored .env.local, never manifests. SFX/music relevance needs evaluation; listen/view before choosing an asset.`;
const raw = cliArgs(
  HELP,
  [
    "--db PATH",
    "--manifest JSON",
    "--key KEY",
    "--dimensions N",
    "--provider NAME",
    "--rpm N",
    "--tpm N",
    "--max-requests N",
    "--max-seconds N",
    "--part N",
    "--yes",
    "--purge",
  ],
  2,
) as string[];
const flags = new Map<string, string>(),
  args: string[] = [];
function usage(message: string): never {
  console.error(`assets:semantic: ${message}\nnext: bun run assets:semantic --help`);
  process.exit(2);
}
for (let i = 0; i < raw.length; i++) {
  const value = raw[i]!;
  if (!value.startsWith("--")) {
    args.push(value);
    continue;
  }
  if (flags.has(value)) usage(`Duplicate option ${value}`);
  const boolean = value === "--yes" || value === "--purge";
  const next = boolean ? "" : raw[++i]!;
  if (!boolean && !next.trim()) usage(`${value} needs a value`);
  flags.set(value, next);
}
const [action, value] = args;
if (!action || !["plan", "build", "status", "query", "remove", "redo", "backup"].includes(action))
  usage("Choose plan, build, status, query, remove, redo or backup");
if (args.length !== (["query", "remove", "redo", "backup"].includes(action) ? 2 : 1))
  usage("Wrong number of arguments");
for (const flag of flags.keys()) {
  if (
    (["--key", "--manifest"].includes(flag) && !["plan", "build"].includes(action)) ||
    (["--max-requests", "--max-seconds", "--rpm", "--tpm"].includes(flag) && action !== "build") ||
    (flag === "--part" && action !== "redo") ||
    (flag === "--purge" && action !== "remove") ||
    (flag === "--yes" && !["build", "query"].includes(action))
  )
    usage(`${flag} does not apply to ${action}`);
}
const dimensions = numberArg("--dimensions", flags.get("--dimensions") ?? "768", {
  int: true,
}) as number;
if (![768, 1536, 3072].includes(dimensions)) usage("Dimensions must be 768, 1536 or 3072");
const maxRequests = numberArg("--max-requests", flags.get("--max-requests") ?? "10", {
  min: 1,
  max: 100000,
  int: true,
}) as number;
const seconds = numberArg("--max-seconds", flags.get("--max-seconds") ?? "60", {
  min: 1,
  max: 3600,
}) as number;
const part = flags.has("--part")
  ? (numberArg("--part", flags.get("--part"), { min: 0, int: true }) as number)
  : undefined;
const file = resolve(flags.get("--db") ?? DEFAULT_INDEX),
  allowApi = flags.has("--yes");
if (!["auto", "gemini", "openrouter"].includes(flags.get("--provider") ?? "auto"))
  usage("Choose provider auto, gemini or openrouter");
const connection = configuredProvider(flags.get("--provider"));
const rpm = numberArg("--rpm", flags.get("--rpm") ?? "60", {
  min: 1,
  max: 10000,
  int: true,
}) as number;
const tpm = numberArg("--tpm", flags.get("--tpm") ?? "24000", {
  min: 100,
  max: 10000000,
  int: true,
}) as number;
let index: Index | undefined;
try {
  let output: unknown;
  if (action === "plan" || action === "build") {
    const manifest = flags.get("--manifest");
    let assets = manifest
      ? readManifest(resolve(manifest))
      : allEntries(false, ROOT).map((entry) => assetFromEntry(entry));
    if (flags.has("--key")) {
      assets = assets.filter((asset) => asset.key === flags.get("--key"));
      if (!assets.length) usage("No asset has that exact key");
    }
    const plan = readiness(assets);
    if (action === "plan" || !allowApi)
      output = {
        ...plan,
        db: file,
        sample: assets.slice(0, 10),
        next: "Review the plan, then build --yes with explicit request/time limits.",
      };
    else {
      if (!connection.apiKey)
        usage(
          `Set ${connection.provider === "gemini" ? "GEMINI_API_KEY" : "OPENROUTER_API_KEY"} before build --yes`,
        );
      if (!assets.length)
        usage("No catalog assets are available; restore the vault or supply a manifest");
      index = openIndex(file, dimensions);
      output = await runIndex(assets, index, {
        allowApi,
        embed: createEmbedder({ ...connection, dimensions }),
        pace: { rpm, tpm },
        maxRequests,
        deadline: Date.now() + seconds * 1000,
        progress: (done) => console.error(JSON.stringify(done)),
      });
      if ((output as { stopped: string }).stopped === "error") process.exitCode = 1;
    }
  } else if (!existsSync(file)) {
    if (action !== "status") throw new Error("No index exists; plan first");
    output = { exists: false, db: file };
  } else {
    index = openIndex(file, dimensions);
    if (action === "query") {
      const hits = await searchIndex(index, value!, new Set(index.ready()), {
        allowApi,
        ...(allowApi && {
          embed: (parts, signal) => createEmbedder({ ...connection, dimensions })(parts, signal),
        }),
      });
      output = hits.slice(0, 12).map((hit) => ({ ...hit, asset: index!.get(hit.key)?.asset }));
    } else {
      if (action !== "status") {
        if (action === "redo" && !index.get(value!)) usage("Unknown asset key");
        if (action === "backup") {
          output = { backup: index.backup(value!) };
        } else if (action === "remove") index.remove(value!, flags.has("--purge"));
        else index.redo(value!, part);
      }
      if (action !== "backup") output = index.status();
    }
  }
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  console.error(
    `assets:semantic: ${error instanceof Error ? error.message : String(error)}\nnext: inspect status, correct the input, then resume with the same database.`,
  );
  process.exitCode = 1;
} finally {
  index?.close();
}
