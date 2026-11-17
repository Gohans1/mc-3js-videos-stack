import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { cliArgs, numberArg } from "../packages/live-studio/src/cli.mjs";
import { allEntries } from "./find";
import { assetFromEntry, readiness, readManifest } from "./semantic/catalog";
import { runIndex } from "./semantic/engine";
import { createEmbedder } from "./semantic/model";
import { DEFAULT_INDEX, searchIndex } from "./semantic/search";
import { type Index, openIndex } from "./semantic/store";
import { ROOT } from "./vault.mjs";

const HELP = `Prepare local Gemini Embedding 2 search through OpenRouter (draft; evaluate relevance before bulk use).
  bun run assets:semantic plan                         counts and sample keys; no requests or vector writes
  bun run assets:semantic build                        same preview; only --yes enables embedding
  bun run assets:semantic build --yes --key '<key>'     selected asset, saved after every completed chunk
  bun run assets:semantic status                       progress and failures
  bun run assets:semantic query "sad farewell"          cached query only; --yes permits one paid query
  bun run assets:semantic remove '<key>'                delete that asset's jobs and cached vectors, no API
  bun run assets:semantic redo '<key>' [--part 0]        clear selected completed work; next build retries it
Options:
  --db PATH              default: repo .studio/asset-search.sqlite (shared catalog, not film-local overrides)
  --manifest JSON        plan/build: local array [{key,title,text,media?:{kind,file}}], file relative to manifest
  --key KEY              plan/build: exact key printed by plan/query; omitted means the current catalog
  --dimensions N         768 (default), 1536 or 3072; each space needs a separate database
  --max-requests N       build: default 10, at most 100000 attempts per invocation
  --max-seconds N        build: default 60, at most 3600; each subprocess/request also has a timeout
  --yes                  build/query only: allow paid OpenRouter calls with OPENROUTER_API_KEY
Names/descriptions join media in one vector. Filter metadata stays separate; no paid caption generation.
Audio: <=179 s per MP3 chunk; video: <=30 s, 1 fps, no audio track; images: PNG within 768 px.
FBX/GLB/presets use text unless a manifest supplies a rendered preview. Only the catalog is included, not all raw vault files.
Rerun build after changing assets/metadata: unchanged inputs reuse vectors; append/update never removes absent entries.
Failed/interrupted builds keep completed chunks. An interrupted request can be charged and need retry; no automatic retries.
Run one builder per database. Stop it before copying the SQLite database. remove also clears old cached versions of that asset.
No requests without --yes; no index build is needed for ordinary find. Hybrid: bun run find --semantic "<scene>" (--yes on a new query).
SFX/music relevance is unverified; Google optimizes audio embeddings for speech. Listen/view before choosing an asset.`;
const raw = cliArgs(
  HELP,
  [
    "--db PATH",
    "--manifest JSON",
    "--key KEY",
    "--dimensions N",
    "--max-requests N",
    "--max-seconds N",
    "--part N",
    "--yes",
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
  const next = value === "--yes" ? "" : raw[++i]!;
  if (value !== "--yes" && !next.trim()) usage(`${value} needs a value`);
  flags.set(value, next);
}
const [action, value] = args;
if (!action || !["plan", "build", "status", "query", "remove", "redo"].includes(action))
  usage("Choose plan, build, status, query, remove or redo");
if (args.length !== (["query", "remove", "redo"].includes(action) ? 2 : 1))
  usage("Wrong number of arguments");
for (const flag of flags.keys()) {
  if (
    (["--key", "--manifest"].includes(flag) && !["plan", "build"].includes(action)) ||
    (["--max-requests", "--max-seconds"].includes(flag) && action !== "build") ||
    (flag === "--part" && action !== "redo") ||
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
let index: Index | undefined;
try {
  let output: unknown;
  if (action === "plan" || action === "build") {
    const manifest = flags.get("--manifest");
    let assets = manifest
      ? readManifest(resolve(manifest))
      : allEntries(false, ROOT).map(assetFromEntry);
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
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) usage("Set OPENROUTER_API_KEY before build --yes");
      if (!assets.length)
        usage("No catalog assets are available; restore the vault or supply a manifest");
      index = openIndex(file, dimensions);
      output = await runIndex(assets, index, {
        allowApi,
        embed: createEmbedder({ apiKey, dimensions }),
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
          embed: (parts, signal) =>
            createEmbedder({ apiKey: process.env.OPENROUTER_API_KEY ?? "", dimensions })(
              parts,
              signal,
            ),
        }),
      });
      output = hits.slice(0, 12).map((hit) => ({ ...hit, asset: index!.get(hit.key)?.asset }));
    } else {
      if (action !== "status") {
        if (action === "redo" && !index.get(value!)) usage("Unknown asset key");
        if (action === "remove") index.remove(value!);
        else index.redo(value!, part);
      }
      output = index.status();
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
