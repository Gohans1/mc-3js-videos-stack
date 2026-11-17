import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { cliArgs, numberArg } from "../packages/live-studio/src/cli.mjs";
import { allEntries } from "./find";
import { openBudget, readBudget } from "./semantic/budget";
import { assetFromEntry, readiness, readManifest } from "./semantic/catalog";
import { runIndex } from "./semantic/engine";
import { evaluateSearch, parseEvalCases } from "./semantic/evaluate";
import { configuredProvider, createEmbedder, type Embed } from "./semantic/model";
import { searchIndex } from "./semantic/search";
import { semanticSettings } from "./semantic/settings";
import { type Index, openIndex } from "./semantic/store";
import { ROOT } from "./vault.mjs";

const HELP = `Incremental local Gemini Embedding 2 search (Google direct or OpenRouter; evaluate relevance before bulk use).
  bun run assets:semantic plan                         counts and sample keys; no requests or vector writes
  bun run assets:semantic build                        same preview; only --yes enables embedding
  bun run assets:semantic build --yes --key '<key>'     selected asset, saved after every completed chunk
  bun run assets:semantic status                       catalog coverage, failures and daily budget
  bun run assets:semantic eval cases.json [--out report.json]  cached-only lexical/semantic/hybrid metrics
  bun run assets:semantic query "sad farewell"          cached query only; --yes permits one external query
  bun run assets:semantic remove '<key>'                hide from search; keep cached vectors for re-adding
  bun run assets:semantic remove '<key>' --purge        also permanently delete that asset's cached vectors
  bun run assets:semantic backup snapshot.sqlite       consistent SQLite copy; refuses an existing destination
  bun run assets:semantic redo '<key>' [--part 0]        clear selected completed work; next build retries it
Options:
  --db PATH              MC_SEMANTIC_DB or repo .studio/asset-search.sqlite; one index shared by search/build
  --manifest JSON        plan/build/status: MC_SEMANTIC_MANIFEST or local [{key,title,text,media?:{kind,file}}]
  --key KEY              plan/build: exact key printed by plan/query; omitted means the current catalog
  --dimensions N         768 (default), 1536 or 3072; each space needs a separate database
  --provider NAME        gemini (default), auto (Gemini alias), or explicitly openrouter; no provider fallback
  --rpm N                build: maximum requests/minute, default 60; use your project quota
  --tpm N                build: estimated input tokens/minute, default 24000, including media
  --max-requests N       build: default 10, at most 100000 attempts per invocation
  --max-seconds N        build: default 60, at most 3600; each subprocess/request also has a timeout
  --retries N            build: default 2, range 0–5; only transient 429/503, respecting retry hints and all limits
  --purge                remove only: permanently forget that asset's cached vectors
  --out PATH             eval only: save a new JSON report without overwriting an existing file
  --yes                  build/query only: allow external requests; project billing/quota determine cost
Names/descriptions join media in one vector. Filter metadata stays separate; no paid caption generation.
Audio: <=30 s per MP3 chunk, retaining source timestamps; video: <=30 s, 1 fps, no audio track; images: PNG within 768 px.
FBX/GLB/presets use text unless a manifest supplies a rendered preview. Only the catalog is included, not all raw vault files.
Rerun build after changing assets/metadata: unchanged inputs reuse vectors; append/update never removes absent entries.
Failed/interrupted builds keep completed chunks. An interrupted request can be charged and need retry.
Every external attempt reserves the shared daily budget first, including failures/retries and new query embeddings.
MC_SEMANTIC_DAILY_LIMIT is a local cap (default 1000), not proof of your provider quota; reset is midnight America/Los_Angeles.
MC_SEMANTIC_QUOTA_DB or the configured index's .requests.sqlite ledger persists across --db overrides; keep it for the same project.
Environment paths start at the repo root; CLI path flags start at cwd. Film commands inherit root dotenv defaults; caller environment wins.
Direct Bun entrypoints respect --env-file/--no-env-file. Package scripts that start another Bun do not forward those runtime flags.
For isolation invoke bun --no-env-file <absolute-path-to-scripts/asset-search.ts> directly; BUN_OPTIONS=--no-env-file also applies to descendant runtimes.
Cached queries and previews consume no allowance. Status counts current catalog coverage; media byte hashes are checked by build.
Eval cases: {labelMethod,cases:[{id,query,language,relevant:[exactAssetKey],kind?,source?,group?}]}.
Eval never sends requests: prepare uncached queries with query --yes, then rerun eval; a partial report exits 1 and still saves results.
Use scripts/evals/semantic/known-item.json (400 distinct targets) and scenes-pilot.json (28 bilingual diagnostic queries).
Known-item labels come from catalog metadata; they do not establish blind scene relevance. More independent judged scene cases are needed for that claim.
Run one builder per database. Use backup to move progress outside a disposable worktree; never copy only an open WAL database file.
remove keeps old vectors; re-adding identical inputs reuses them. Remove the source catalog/manifest row as well to exclude it from future builds.
--purge explicitly deletes that asset's retained cache; it never refunds request usage.
No requests without --yes; no index build is needed for ordinary find. Hybrid: bun run find --semantic "<scene>" (--yes on a new query).
Google free-tier content may improve Google's products. Send only assets whose rights permit that; keep restricted/unknown sources out of unpaid cloud uploads.
Daily quotas/local budget stop immediately. Other 429s may be capacity failures; bounded retries never switch provider or account.
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
    "--retries N",
    "--part N",
    "--yes",
    "--purge",
    "--out PATH",
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
if (
  !action ||
  !["plan", "build", "status", "query", "remove", "redo", "backup", "eval"].includes(action)
)
  usage("Choose plan, build, status, query, remove, redo, backup or eval");
if (args.length !== (["query", "remove", "redo", "backup", "eval"].includes(action) ? 2 : 1))
  usage("Wrong number of arguments");
for (const flag of flags.keys()) {
  if (
    (flag === "--key" && !["plan", "build"].includes(action)) ||
    (flag === "--manifest" && !["plan", "build", "status"].includes(action)) ||
    (["--max-requests", "--max-seconds", "--rpm", "--tpm", "--retries"].includes(flag) &&
      action !== "build") ||
    (flag === "--part" && action !== "redo") ||
    (flag === "--out" && action !== "eval") ||
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
let settings: ReturnType<typeof semanticSettings>;
try {
  settings = semanticSettings();
} catch (error) {
  usage(error instanceof Error ? error.message : String(error));
}
const file = resolve(flags.get("--db") ?? settings.db),
  allowApi = flags.has("--yes");
if (file === settings.quotaDb) usage("Vector database and quota ledger must use separate files");
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
const retries = numberArg("--retries", flags.get("--retries") ?? "2", {
  min: 0,
  max: 5,
  int: true,
}) as number;
let index: Index | undefined;
let budget: ReturnType<typeof openBudget> | undefined;
const embed: Embed = (parts, signal) =>
  createEmbedder({
    ...connection,
    dimensions,
    beforeRequest: () => {
      budget ??= openBudget(settings.quotaDb, settings.dailyLimit);
      budget.reserve();
    },
  })(parts, signal);
try {
  let output: unknown;
  const manifest = flags.get("--manifest") ?? settings.manifest;
  let assets = ["plan", "build", "status"].includes(action)
    ? manifest
      ? readManifest(resolve(manifest))
      : allEntries(false, ROOT).map((entry) => assetFromEntry(entry))
    : [];
  if (action === "plan" || action === "build") {
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
      const built = await runIndex(assets, index, {
        allowApi,
        embed,
        retries,
        pace: { rpm, tpm },
        maxRequests,
        deadline: Date.now() + seconds * 1000,
        progress: (done) => console.error(JSON.stringify(done)),
      });
      output = {
        ...built,
        budget: { file: settings.quotaDb, ...readBudget(settings.quotaDb, settings.dailyLimit) },
      };
      if (built.stopped === "error") process.exitCode = 1;
    }
  } else if (!existsSync(file)) {
    if (action !== "status") throw new Error("No index exists; plan first");
    output = {
      exists: false,
      db: file,
      catalog: readiness(assets),
      budget: { file: settings.quotaDb, ...readBudget(settings.quotaDb, settings.dailyLimit) },
    };
  } else {
    index = openIndex(file, dimensions);
    if (action === "eval") {
      if (statSync(value!).size > 8 * 1024 * 1024) throw new Error("Evaluation cases exceed 8 MB");
      const cases = parseEvalCases(JSON.parse(readFileSync(value!, "utf8")));
      const report = await evaluateSearch(index, allEntries(false, ROOT), cases);
      if (flags.has("--out"))
        writeFileSync(resolve(flags.get("--out")!), JSON.stringify(report, null, 2), {
          flag: "wx",
        });
      output = report;
      if (!report.complete) process.exitCode = 1;
    } else if (action === "query") {
      const hits = await searchIndex(index, value!, new Set(index.ready()), {
        allowApi,
        ...(allowApi && {
          embed,
        }),
      });
      output = hits.slice(0, 12).map((hit) => ({ ...hit, asset: index!.get(hit.key)?.asset }));
    } else {
      if (action !== "status") {
        if (action === "redo" && !index.get(value!)) usage("Unknown asset key");
        if (action === "backup") {
          const budgetTarget = `${resolve(value!)}.requests.sqlite`;
          if (existsSync(budgetTarget))
            throw new Error("Budget backup destination already exists; choose a new file");
          const backup = index.backup(value!);
          if (existsSync(settings.quotaDb)) {
            budget ??= openBudget(settings.quotaDb, settings.dailyLimit);
            output = { backup, budgetBackup: budget.backup(budgetTarget) };
          } else output = { backup };
        } else if (action === "remove") index.remove(value!, flags.has("--purge"));
        else index.redo(value!, part);
      }
      if (action !== "backup")
        output = {
          ...index.status(),
          ...(action === "status" && {
            coverage: index.coverage(assets),
            budget: {
              file: settings.quotaDb,
              ...readBudget(settings.quotaDb, settings.dailyLimit),
            },
          }),
        };
    }
  }
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  console.error(
    `assets:semantic: ${error instanceof Error ? error.message : String(error)}\nnext: inspect status, correct the input, then resume with the same database.`,
  );
  process.exitCode = 1;
} finally {
  budget?.close();
  index?.close();
}
