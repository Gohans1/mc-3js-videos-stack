import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import {
  type ClassifiableSound,
  classifyPopularSound,
  findSimilarSounds,
  recommendCoreSounds,
} from "../packages/live-studio/src/sound-kit-similar.mjs";
import {
  isSafeSoundId,
  KIT_CATEGORIES,
  KIT_CATEGORY_IDS,
  KIT_STATUSES,
  type KitCategoryId,
  type KitStatus,
  openSoundKit,
  SOUND_KIT_FILE,
  summarizeSoundKit,
} from "../packages/live-studio/src/sound-kit.mjs";
import { findVaults, openSound } from "../packages/live-studio/src/sound.mjs";
import { vaultSounds } from "./find";
import { ROOT } from "./vault.mjs";

const HELP = `Manage the shared Core Sound Kit (sound-kit/core.json) for both Human curation and AI sound selection.
Categories: ${KIT_CATEGORY_IDS.join(", ")}
Statuses:   inbox (staged for human triage), core (approved go-to kit), pass (skipped during triage; pushed to bottom, still searchable by AI), ban (excluded from AI search)

Usage:
  bun run sound:kit stats [--json]
  bun run sound:kit list [--category <cat>] [--status inbox|core|pass|ban] [--json]
  bun run sound:kit recommend [--category <cat>] [--q "<words>"] [--top 5] [--dur min-max] [--ref <id>] [--recent a,b] [--json]
  bun run sound:kit add <id...> [--category <cat>] [--status inbox|core|pass|ban] [--tags a,b] [--note "..."] [--tier 0|1] [--by ai|human] [--skip-existing] [--json]
  bun run sound:kit set <id> [--status inbox|core|pass|ban] [--category <cat>] [--tags a,b] [--note "..."] [--tier 0|1] [--by ai|human] [--json]
  bun run sound:kit remove <id...> [--json]
  bun run sound:kit ab show [--json]
  bun run sound:kit ab clear [--json]
  bun run sound:kit ab set <id1> [id2 id3 id4] [--json]
  bun run sound:kit ab pick <winner> [--category <cat>] [--ban-losers] [--clear] [--reason "..."] [--context "..."] [--json]
  bun run sound:kit similar <id> [--limit 12] [--stage] [--category <cat>] [--json]
  bun run sound:kit decisions [--limit 20] [--json]
  bun run sound:kit seed [--per-category 8] [--dry-run] [--json]

Examples:
  bun run sound:kit recommend --category whoosh --q "short whip" --top 5
  bun run sound:kit list --category bgm --status core
  bun run sound:kit add mixkit-275 of-sfx-rising-cork-pops-570fa4 --category pop-ui --status inbox
  bun run sound:kit ab set bgm-convergence bgm-code-switch
  bun run sound:kit ab pick bgm-convergence --category bgm --reason "tighter tense pulse"
  bun run sound:kit similar of-bgm-night-suspense-pulse-2b878e --limit 10 --stage`;

class SoundKitCliError extends Error {
  constructor(
    message: string,
    readonly code = 2,
  ) {
    super(message);
  }
}

const isCategory = (v: string): v is KitCategoryId =>
  (KIT_CATEGORY_IDS as readonly string[]).includes(v);

const isStatus = (v: string): v is KitStatus => (KIT_STATUSES as readonly string[]).includes(v);

const BOOL_FLAGS = new Set([
  "--help",
  "-h",
  "--json",
  "--stage",
  "--skip-existing",
  "--ban-losers",
  "--clear",
  "--dry-run",
]);

const VALUE_FLAGS = new Set([
  "--category",
  "--status",
  "--tags",
  "--note",
  "--tier",
  "--by",
  "--reason",
  "--context",
  "--limit",
  "--per-category",
  "--q",
  "--top",
  "--dur",
  "--ref",
  "--recent",
]);

const ALLOWED_FLAGS: Record<string, Set<string>> = {
  stats: new Set(["--json"]),
  list: new Set(["--category", "--status", "--json"]),
  recommend: new Set(["--category", "--q", "--top", "--dur", "--ref", "--recent", "--json"]),
  add: new Set([
    "--category",
    "--status",
    "--tags",
    "--note",
    "--tier",
    "--by",
    "--skip-existing",
    "--json",
  ]),
  set: new Set(["--category", "--status", "--tags", "--note", "--tier", "--by", "--json"]),
  remove: new Set(["--json"]),
  "ab:show": new Set(["--json"]),
  "ab:clear": new Set(["--json"]),
  "ab:set": new Set(["--json"]),
  "ab:pick": new Set(["--category", "--ban-losers", "--clear", "--reason", "--context", "--json"]),
  similar: new Set(["--limit", "--stage", "--category", "--json"]),
  decisions: new Set(["--limit", "--json"]),
  seed: new Set(["--per-category", "--dry-run", "--json"]),
};

const FREE_TEXT_FLAGS = new Set(["--note", "--reason", "--context", "--q"]);
const isOptionToken = (token: string) => /^--?[a-z]/i.test(token);
const isKnownFlagToken = (token: string) => {
  const eq = token.indexOf("=");
  const name = (eq > 0 ? token.slice(0, eq) : token).toLowerCase();
  return BOOL_FLAGS.has(name) || VALUE_FLAGS.has(name);
};

const parseArgs = (argv: string[]) => {
  const positionals: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (!isOptionToken(arg)) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = (eq > 0 ? arg.slice(0, eq) : arg).toLowerCase();
    if (BOOL_FLAGS.has(name)) {
      if (eq > 0) throw new SoundKitCliError(`${name} takes no value`);
      flags.set(name, "1");
      continue;
    }
    if (!VALUE_FLAGS.has(name)) {
      throw new SoundKitCliError(`Unknown option "${name}". Run bun run sound:kit --help`);
    }
    if (eq > 0) {
      flags.set(name, arg.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    const nextIsFlag =
      next !== undefined &&
      (FREE_TEXT_FLAGS.has(name) ? isKnownFlagToken(next) : isOptionToken(next));
    if (next === undefined || nextIsFlag) {
      throw new SoundKitCliError(`${name} requires a value`);
    }
    i += 1;
    flags.set(name, next);
  }
  return { positionals, flags };
};

const validateFlags = (cmdKey: string, flags: Map<string, string>) => {
  const allowed = ALLOWED_FLAGS[cmdKey];
  if (!allowed) return;
  for (const key of flags.keys()) {
    if (key === "--help" || key === "-h") continue;
    if (!allowed.has(key)) {
      throw new SoundKitCliError(
        `Option ${key} is not valid for "${cmdKey.replace(":", " ")}". Allowed: ${[...allowed].join(" ")}`,
      );
    }
  }
};

const parsePosInt = (raw: string | undefined, name: string, fallback: number, max: number) => {
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new SoundKitCliError(`${name} must be a positive integer (1..${max}), got "${raw}"`);
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) {
    throw new SoundKitCliError(`${name} must be between 1 and ${max}, got "${raw}"`);
  }
  return n;
};

const parseTier = (raw: string | undefined): 0 | 1 | undefined => {
  if (raw === undefined) return undefined;
  if (raw === "0") return 0;
  if (raw === "1") return 1;
  throw new SoundKitCliError(`--tier must be 0 or 1, got "${raw}"`);
};

const parseActor = (raw: string | undefined, fallback: "ai" | "human"): "ai" | "human" => {
  if (raw === undefined) return fallback;
  const v = raw.toLowerCase();
  if (v === "ai" || v === "human") return v;
  throw new SoundKitCliError(`--by must be ai or human, got "${raw}"`);
};

const parseOptCategory = (flags: Map<string, string>): KitCategoryId | undefined => {
  if (!flags.has("--category")) return undefined;
  const v = (flags.get("--category") ?? "").toLowerCase();
  if (!isCategory(v)) {
    throw new SoundKitCliError(`Unknown category "${v}". Valid: ${KIT_CATEGORY_IDS.join(", ")}`);
  }
  return v;
};

const parseOptStatus = (flags: Map<string, string>): KitStatus | undefined => {
  if (!flags.has("--status")) return undefined;
  const v = (flags.get("--status") ?? "").toLowerCase();
  if (!isStatus(v)) {
    throw new SoundKitCliError(`Unknown status "${v}". Valid: ${KIT_STATUSES.join(", ")}`);
  }
  return v;
};

const parseDurationSpan = (raw: string | undefined): { durMin?: number; durMax?: number } => {
  if (raw === undefined) return {};
  const parts = raw.split("-");
  if (parts.length !== 2 || !parts.every((p) => /^\d+(?:\.\d+)?$/.test(p))) {
    throw new SoundKitCliError(`--dur takes min-max seconds, e.g. --dur 0-1.5, got "${raw}"`);
  }
  const lo = Number(parts[0]);
  const hi = Number(parts[1]);
  if (!(lo <= hi)) throw new SoundKitCliError(`--dur low must be <= high, got "${raw}"`);
  return { durMin: lo, durMax: hi };
};

const loadDefaultLibrary = (): ClassifiableSound[] => {
  const cwd = process.cwd();
  let studioCfg: Record<string, unknown> = {};
  try {
    const pkgFile = join(cwd, "package.json");
    if (existsSync(pkgFile)) {
      const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as Record<string, unknown>;
      const raw = pkg["live-studio"];
      if (raw && typeof raw === "object") studioCfg = raw as Record<string, unknown>;
    }
  } catch {}
  try {
    const sound = openSound(cwd, {
      soundTimeline:
        typeof studioCfg.soundTimeline === "string"
          ? studioCfg.soundTimeline
          : "src/timeline/audio.json",
      sfx: typeof studioCfg.sfx === "string" ? studioCfg.sfx : "sound/sfx",
      ...(typeof studioCfg.soundVault === "string" ? { soundVault: studioCfg.soundVault } : {}),
    });
    const lib = sound?.library?.() ?? [];
    if (lib.length > 0) return lib;
  } catch {}
  try {
    const vaults = findVaults(cwd, {});
    return vaultSounds(vaults.length ? vaults : undefined).map((item) => ({
      name: item.name,
      kind: item.kind,
      category: item.category,
      title: item.title,
      for: item.for,
      seconds: item.seconds,
      source: item.source,
      family: item.family,
    }));
  } catch {
    return [];
  }
};

const loadVerifiedCatalogueIds = (): Map<string, { role: string; real: number; z: number }> => {
  const out = new Map<string, { role: string; real: number; z: number }>();
  const file = join(ROOT, "scripts/sfx-catalogue.json");
  if (!existsSync(file)) return out;
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as {
      sounds?: {
        id?: string;
        role?: string;
        ear?: { real?: number; z?: number; verdict?: string };
      }[];
    };
    for (const row of data.sounds ?? []) {
      if (!row.id || row.ear?.verdict === "miss") continue;
      out.set(row.id, {
        role: row.role ?? "",
        real: Number(row.ear?.real ?? 0),
        z: Number(row.ear?.z ?? 0),
      });
    }
  } catch {}
  return out;
};

const pickSeedCandidates = (
  library: readonly ClassifiableSound[],
  perCategory: number,
  existingIds: ReadonlySet<string>,
) => {
  const verified = loadVerifiedCatalogueIds();
  const buckets = new Map<KitCategoryId, ClassifiableSound[]>(KIT_CATEGORY_IDS.map((c) => [c, []]));
  for (const item of library) {
    if (existingIds.has(item.name)) continue;
    if (item.kind === "mc") continue;
    const cat = classifyPopularSound(item);
    if (!cat) continue;
    const secs = Number(item.seconds ?? 0);
    if (cat === "bgm" && secs > 0 && secs < 20) continue;
    if (cat !== "bgm" && cat !== "ambience" && secs > 12) continue;
    buckets.get(cat)?.push(item);
  }

  const chosen: { id: string; category: KitCategoryId; tags: string[]; note: string }[] = [];
  const bgmMoodOrder = ["tense", "playful", "lofi", "cinematic", "upbeat", "warm", "electronic"];

  const titleKeyOf = (item: ClassifiableSound) =>
    `${item.title ?? item.name}`
      .replaceAll("_", " ")
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 3 && w !== "the" && w !== "and" && w !== "sfx" && w !== "sound")
      .slice(0, 2)
      .join(" ");

  for (const cat of KIT_CATEGORY_IDS) {
    const pool = buckets.get(cat) ?? [];
    const seenFamilies = new Set<string>();
    const seenTitleKeys = new Set<string>();
    const takeFrom = (list: ClassifiableSound[], maxCount: number, diversifyTitle = false) => {
      const picked: ClassifiableSound[] = [];
      const overflow: ClassifiableSound[] = [];
      for (const item of list) {
        if (picked.length >= maxCount) break;
        const fam = item.family || item.name;
        if (seenFamilies.has(fam)) continue;
        const tk = diversifyTitle ? titleKeyOf(item) : "";
        if (diversifyTitle && tk && seenTitleKeys.has(tk)) {
          overflow.push(item);
          continue;
        }
        seenFamilies.add(fam);
        if (tk) seenTitleKeys.add(tk);
        picked.push(item);
      }
      if (diversifyTitle && picked.length < maxCount) {
        for (const item of overflow) {
          if (picked.length >= maxCount) break;
          const fam = item.family || item.name;
          if (seenFamilies.has(fam)) continue;
          seenFamilies.add(fam);
          picked.push(item);
        }
      }
      return picked;
    };

    if (cat === "bgm") {
      const picked: ClassifiableSound[] = [];
      const moodQueues = bgmMoodOrder.map((mood) =>
        pool
          .filter((x) => (x.category ?? "").toLowerCase() === mood)
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      let madeProgress = true;
      while (picked.length < perCategory && madeProgress) {
        madeProgress = false;
        for (const queue of moodQueues) {
          if (picked.length >= perCategory) break;
          while (queue.length > 0) {
            const candidate = queue.shift()!;
            const fam = candidate.family || candidate.name;
            if (seenFamilies.has(fam)) continue;
            seenFamilies.add(fam);
            picked.push(candidate);
            madeProgress = true;
            break;
          }
        }
      }
      if (picked.length < perCategory) {
        const sortedPool = [...pool].sort((a, b) => a.name.localeCompare(b.name));
        picked.push(...takeFrom(sortedPool, perCategory - picked.length));
      }
      for (const item of picked) {
        const mood = (item.category ?? "").toLowerCase();
        chosen.push({
          id: item.name,
          category: "bgm",
          tags: mood ? [mood] : [],
          note: "seeded for triage",
        });
      }
      continue;
    }

    const scored = [...pool].sort((a, b) => {
      const va = verified.get(a.name);
      const vb = verified.get(b.name);
      const sa =
        (va ? 10 + va.real * 2 + Math.min(va.z, 5) * 0.4 : 0) +
        (a.source === "openfilm"
          ? 3
          : a.source === "mixkit"
            ? 2.5
            : a.source === "sonniss"
              ? 1.5
              : 0);
      const sb =
        (vb ? 10 + vb.real * 2 + Math.min(vb.z, 5) * 0.4 : 0) +
        (b.source === "openfilm"
          ? 3
          : b.source === "mixkit"
            ? 2.5
            : b.source === "sonniss"
              ? 1.5
              : 0);
      return sb - sa || a.name.localeCompare(b.name);
    });
    const picked = takeFrom(scored, perCategory, true);
    for (const item of picked) {
      const v = verified.get(item.name);
      const dur = Number(item.seconds ?? 0);
      const tags: string[] = [];
      if (cat === "whoosh" && dur > 0)
        tags.push(dur <= 0.6 ? "short" : dur <= 1.2 ? "medium" : "long");
      if (v?.role) tags.push(v.role.split(".")[0]!);
      chosen.push({
        id: item.name,
        category: cat,
        tags,
        note: v ? "earshot-verified candidate" : "seeded for triage",
      });
    }
  }
  return chosen;
};

export interface SoundKitCliOptions {
  kitFile?: string;
  library?: readonly ClassifiableSound[];
  semanticDb?: string;
}

export async function runSoundKitCli(
  argv: string[],
  opts: SoundKitCliOptions = {},
): Promise<string> {
  if (argv.some((a) => a === "--help" || a === "-h") || argv[0]?.toLowerCase() === "help") {
    return HELP;
  }
  const { positionals, flags } = parseArgs(argv);
  const cmd = (positionals[0] ?? "stats").toLowerCase();
  const kit = openSoundKit(opts.kitFile ?? SOUND_KIT_FILE);
  let cachedLib: readonly ClassifiableSound[] | null = null;
  let cachedByName: Map<string, ClassifiableSound> | null = null;
  const getLibrary = () => (cachedLib ??= opts.library ?? loadDefaultLibrary());
  const getByName = () => (cachedByName ??= new Map(getLibrary().map((x) => [x.name, x])));
  const asJson = flags.has("--json");

  if (cmd === "stats") {
    validateFlags("stats", flags);
    if (positionals.length > 1) throw new SoundKitCliError("stats takes no positional arguments");
    const state = kit.read();
    const summary = summarizeSoundKit(state);
    if (asJson) return JSON.stringify({ file: kit.file, summary, abSlots: state.abSlots }, null, 2);
    return [
      `Core Sound Kit (${relative(ROOT, kit.file).replaceAll("\\", "/") || kit.file})`,
      `total: ${summary.totals.total} (core: ${summary.totals.core}, inbox: ${summary.totals.inbox}, pass: ${summary.totals.pass}, ban: ${summary.totals.ban}) | A/B tray: ${summary.abCount}/4 | decisions: ${summary.decisionCount}`,
      "",
      ...KIT_CATEGORIES.map((c) => {
        const b = summary.byCategory[c.id];
        return `  ${c.id.padEnd(14)} core: ${b.core}, inbox: ${b.inbox}, pass: ${b.pass}, ban: ${b.ban}  (${c.hint})`;
      }),
    ].join("\n");
  }

  if (cmd === "list") {
    validateFlags("list", flags);
    if (positionals.length > 1) throw new SoundKitCliError("list takes no positional arguments");
    const state = kit.read();
    const catFlag = parseOptCategory(flags);
    const statusFlag = parseOptStatus(flags);
    const items = Object.values(state.items)
      .filter(
        (item) =>
          (!catFlag || item.category === catFlag) && (!statusFlag || item.status === statusFlag),
      )
      .sort(
        (a, b) =>
          a.category.localeCompare(b.category) ||
          a.status.localeCompare(b.status) ||
          b.elo - a.elo ||
          a.id.localeCompare(b.id),
      );
    if (asJson) return JSON.stringify({ items, abSlots: state.abSlots }, null, 2);
    if (!items.length) return "No sound kit items match that filter.";
    return items
      .map(
        (x) =>
          `${x.category.padEnd(14)} ${x.status.padEnd(6)} ${x.tier ? "★ " : "  "}${x.id}  (elo ${Math.round(x.elo)}, ${x.picks}x)${x.tags.length ? `  [${x.tags.join(", ")}]` : ""}${x.note ? `  — ${x.note}` : ""}`,
      )
      .join("\n");
  }

  if (cmd === "recommend") {
    validateFlags("recommend", flags);
    const extraWords = positionals.slice(1).join(" ").trim();
    const query = [flags.get("--q") ?? "", extraWords].filter(Boolean).join(" ").trim();
    const catFlag = parseOptCategory(flags);
    const topN = parsePosInt(flags.get("--top"), "--top", 5, 25);
    const { durMin, durMax } = parseDurationSpan(flags.get("--dur"));
    const refSound = flags.get("--ref");
    if (flags.has("--ref") && (!refSound || !isSafeSoundId(refSound))) {
      throw new SoundKitCliError(`Invalid --ref sound id "${refSound ?? ""}"`);
    }
    const recentIds = flags.get("--recent")
      ? flags
          .get("--recent")!
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const res = recommendCoreSounds(kit.read(), getLibrary(), {
      category: catFlag ?? null,
      query,
      topN,
      durMin,
      durMax,
      ...(refSound ? { refSound } : {}),
      recentIds,
      ...(opts.semanticDb ? { semanticDb: opts.semanticDb } : {}),
    });
    if (asJson) return JSON.stringify(res, null, 2);
    if (!res.picks.length) {
      if (res.totalCore > 0) {
        return `No core sounds matched those filters (${res.totalCore} approved core sounds in pool${catFlag ? ` for ${catFlag}` : ""}). Try widening --dur or query.`;
      }
      return `No approved core sounds available${catFlag ? ` in ${catFlag}` : ""}. Curate candidates in Studio's Audio Kit tab first.`;
    }
    return [
      `Top ${res.picks.length} from human-curated Core Kit (${res.mode}, pool: ${res.totalCore}${catFlag ? `, category: ${catFlag}` : ""}${query ? `, query: "${query}"` : ""}):`,
      ...res.picks.map(
        (p, idx) =>
          `  ${idx + 1}. ${p.id}  (${p.category} · ${p.seconds.toFixed(2)}s · score ${p.score.toFixed(3)} · elo ${Math.round(p.elo)})${p.why.length ? `  [${p.why.join("; ")}]` : ""}${p.note ? `  — ${p.note}` : ""}`,
      ),
    ].join("\n");
  }

  if (cmd === "add") {
    validateFlags("add", flags);
    const ids = positionals.slice(1);
    if (!ids.length) throw new SoundKitCliError("add requires at least one sound id");
    for (const id of ids) {
      if (!isSafeSoundId(id)) throw new SoundKitCliError(`Invalid sound id "${id}"`);
    }
    const catFlag = parseOptCategory(flags);
    const statusFlag = parseOptStatus(flags);
    const actor = flags.has("--by") ? parseActor(flags.get("--by"), "ai") : undefined;
    const tier = parseTier(flags.get("--tier"));
    const tags = flags.has("--tags")
      ? flags
          .get("--tags")!
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : undefined;
    const note = flags.get("--note");
    const existingItems = kit.read().items;
    const batch = ids.map((id) => {
      const existing = Object.hasOwn(existingItems, id) ? existingItems[id] : undefined;
      const inferred: KitCategoryId | null =
        catFlag ?? existing?.category ?? classifyPopularSound(getByName().get(id) ?? { name: id });
      if (!inferred) {
        throw new SoundKitCliError(
          `Could not infer category for "${id}". Pass --category <${KIT_CATEGORY_IDS.join("|")}>`,
        );
      }
      return {
        id,
        category: inferred,
        ...(statusFlag !== undefined ? { status: statusFlag } : {}),
        ...(tags !== undefined ? { tags } : {}),
        ...(note !== undefined ? { note } : {}),
        ...(tier !== undefined ? { tier } : {}),
        ...(actor !== undefined ? { addedBy: actor } : {}),
      };
    });
    const res = kit.batchSet(batch, { skipExisting: flags.has("--skip-existing") });
    if (asJson) return JSON.stringify(res, null, 2);
    return `Updated sound kit: added ${res.added}, updated ${res.updated}, skipped ${res.skipped} (${batch.map((b) => `${b.id}:${res.state.items[b.id]?.category ?? b.category}/${res.state.items[b.id]?.status ?? "inbox"}`).join(", ")})`;
  }

  if (cmd === "set") {
    validateFlags("set", flags);
    if (positionals.length < 2) throw new SoundKitCliError("set requires a sound id");
    if (positionals.length > 2) {
      throw new SoundKitCliError(`set takes one sound id at a time; use add for multiple ids`);
    }
    const id = positionals[1]!;
    if (!isSafeSoundId(id)) throw new SoundKitCliError(`Invalid sound id "${id}"`);
    const state = kit.read();
    const existing = Object.hasOwn(state.items, id) ? state.items[id] : undefined;
    const explicitStatus = parseOptStatus(flags);
    if (!explicitStatus && !existing) {
      throw new SoundKitCliError(`set requires --status <${KIT_STATUSES.join("|")}>`);
    }
    const category =
      parseOptCategory(flags) ??
      existing?.category ??
      classifyPopularSound(getByName().get(id) ?? { name: id });
    if (!category) {
      throw new SoundKitCliError(`Pass --category <${KIT_CATEGORY_IDS.join("|")}> for "${id}"`);
    }
    const tags = flags.has("--tags")
      ? flags
          .get("--tags")!
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : undefined;
    const note = flags.get("--note");
    const tier = parseTier(flags.get("--tier"));
    const actor = flags.has("--by") ? parseActor(flags.get("--by"), "human") : undefined;
    const next = kit.setItem({
      id,
      category,
      ...(explicitStatus !== undefined ? { status: explicitStatus } : {}),
      ...(tags !== undefined ? { tags } : {}),
      ...(note !== undefined ? { note } : {}),
      ...(tier !== undefined ? { tier } : {}),
      ...(actor !== undefined ? { addedBy: actor } : {}),
    });
    const saved = next.items[id]!;
    if (asJson) return JSON.stringify(saved, null, 2);
    return `Set ${id} -> ${saved.category} (${saved.status})`;
  }

  if (cmd === "remove") {
    validateFlags("remove", flags);
    const ids = positionals.slice(1);
    if (!ids.length) throw new SoundKitCliError("remove requires at least one sound id");
    for (const id of ids) {
      if (!isSafeSoundId(id)) throw new SoundKitCliError(`Invalid sound id "${id}"`);
    }
    const next = kit.removeItems(ids);
    if (asJson)
      return JSON.stringify({ removed: ids, remaining: Object.keys(next.items).length }, null, 2);
    return `Removed ${ids.join(", ")} from sound kit.`;
  }

  if (cmd === "ab") {
    const sub = (positionals[1] ?? "show").toLowerCase();
    if (sub === "show") {
      validateFlags("ab:show", flags);
      if (positionals.length > 2) throw new SoundKitCliError("ab show takes no extra arguments");
      const slots = kit.read().abSlots;
      if (asJson) return JSON.stringify({ abSlots: slots }, null, 2);
      if (!slots.length) return "A/B tray is empty.";
      return slots.map((id, idx) => `${String.fromCharCode(65 + idx)}: ${id}`).join("\n");
    }
    if (sub === "clear") {
      validateFlags("ab:clear", flags);
      if (positionals.length > 2) throw new SoundKitCliError("ab clear takes no extra arguments");
      const next = kit.setAb([]);
      if (asJson) return JSON.stringify({ abSlots: next.abSlots }, null, 2);
      return "Cleared A/B tray.";
    }
    if (sub === "set") {
      validateFlags("ab:set", flags);
      const ids = positionals.slice(2);
      if (!ids.length) throw new SoundKitCliError("ab set requires 1-4 sound ids");
      for (const id of ids) {
        if (!isSafeSoundId(id)) throw new SoundKitCliError(`Invalid sound id "${id}"`);
      }
      if (new Set(ids).size > 4) {
        throw new SoundKitCliError("ab set accepts at most 4 unique sound ids");
      }
      const next = kit.setAb(ids);
      if (asJson) return JSON.stringify({ abSlots: next.abSlots }, null, 2);
      return `A/B tray: ${next.abSlots.map((id, i) => `${String.fromCharCode(65 + i)}=${id}`).join("  ")}`;
    }
    if (sub === "pick") {
      validateFlags("ab:pick", flags);
      if (positionals.length < 3)
        throw new SoundKitCliError("ab pick requires the winning sound id");
      if (positionals.length > 3)
        throw new SoundKitCliError("ab pick takes a single winning sound id");
      const winner = positionals[2]!;
      if (!isSafeSoundId(winner)) throw new SoundKitCliError(`Invalid sound id "${winner}"`);
      const state = kit.read();
      if (!state.abSlots.length) {
        throw new SoundKitCliError(
          "A/B tray is empty. Load candidates first with: bun run sound:kit ab set <id1> <id2>",
        );
      }
      if (!state.abSlots.includes(winner)) {
        throw new SoundKitCliError(
          `"${winner}" is not in the A/B tray (${state.abSlots.join(", ")}). Pick one of the loaded slots.`,
        );
      }
      const existingWinner = Object.hasOwn(state.items, winner) ? state.items[winner] : undefined;
      const category =
        parseOptCategory(flags) ??
        existingWinner?.category ??
        classifyPopularSound(getByName().get(winner) ?? { name: winner });
      if (!category) {
        throw new SoundKitCliError(
          `Pass --category <${KIT_CATEGORY_IDS.join("|")}> for "${winner}"`,
        );
      }
      const rejected = state.abSlots.filter((id) => id !== winner);
      const next = kit.resolveAb({
        winner,
        rejected,
        category,
        reason: flags.get("--reason") ?? "",
        context: flags.get("--context") ?? "",
        banRejected: flags.has("--ban-losers"),
        clearTray: flags.has("--clear"),
      });
      if (asJson) return JSON.stringify(next, null, 2);
      return `Picked ${winner} -> core (${category}, elo ${Math.round(next.items[winner]?.elo ?? 1500)})${rejected.length ? `; losers: ${rejected.join(", ")}${flags.has("--ban-losers") ? " [banned]" : ""}` : ""}`;
    }
    throw new SoundKitCliError(`Unknown ab subcommand "${sub}". Use show, set, pick or clear.`);
  }

  if (cmd === "decisions") {
    validateFlags("decisions", flags);
    if (positionals.length > 1)
      throw new SoundKitCliError("decisions takes no positional arguments");
    const limit = parsePosInt(flags.get("--limit"), "--limit", 20, 200);
    const decisions = kit.read().decisions.slice(-limit).reverse();
    if (asJson) return JSON.stringify({ decisions }, null, 2);
    if (!decisions.length) return "No taste decisions recorded yet.";
    return decisions
      .map(
        (d) =>
          `[${d.category}] winner=${d.winner}${d.rejected.length ? ` vs ${d.rejected.join(",")}` : ""}${d.reason ? ` — ${d.reason}` : ""}`,
      )
      .join("\n");
  }

  if (cmd === "similar") {
    validateFlags("similar", flags);
    if (positionals.length < 2) throw new SoundKitCliError("similar requires a target sound id");
    if (positionals.length > 2)
      throw new SoundKitCliError("similar takes a single target sound id");
    const target = positionals[1]!;
    if (!isSafeSoundId(target)) throw new SoundKitCliError(`Invalid sound id "${target}"`);
    const limit = parsePosInt(flags.get("--limit"), "--limit", 12, 40);
    const catOverride = parseOptCategory(flags);
    if (catOverride && !flags.has("--stage")) {
      throw new SoundKitCliError("--category on similar requires --stage");
    }
    const state = kit.read();
    const bannedIds = new Set(
      Object.values(state.items)
        .filter((x) => x.status === "ban")
        .map((x) => x.id),
    );
    const lib = getLibrary();
    const res = findSimilarSounds(target, lib, {
      limit,
      bannedIds,
      ...(opts.semanticDb ? { semanticDb: opts.semanticDb } : {}),
    });
    if (flags.has("--stage") && res.hits.length) {
      const targetItem = getByName().get(target);
      const fallbackCat =
        (catOverride as KitCategoryId | undefined) ??
        (Object.hasOwn(state.items, target) ? state.items[target]?.category : undefined) ??
        (targetItem ? classifyPopularSound(targetItem) : null) ??
        "foley-core";
      const batch = res.hits.map((hit) => ({
        id: hit.name,
        category: (catOverride as KitCategoryId | undefined) ?? hit.kitCategory ?? fallbackCat,
        status: "inbox" as const,
        note: `similar to ${target} (${res.mode} ${hit.score})`.slice(0, 240),
        addedBy: "ai" as const,
      }));
      kit.batchSet(batch, { skipExisting: true });
    }
    if (asJson) return JSON.stringify(res, null, 2);
    if (!res.hits.length) return `No similar sounds found for "${target}".`;
    return [
      `Similar to ${target} (${res.mode} search, ${res.hits.length} hits${flags.has("--stage") ? ", staged new hits to inbox" : ""}):`,
      ...res.hits.map(
        (h) =>
          `  ${h.score.toFixed(3)}  ${h.name}  (${h.kitCategory ?? h.category} · ${h.seconds.toFixed(2)}s · ${h.title})`,
      ),
    ].join("\n");
  }

  if (cmd === "seed") {
    validateFlags("seed", flags);
    if (positionals.length > 1) throw new SoundKitCliError("seed takes no positional arguments");
    const perCat = parsePosInt(flags.get("--per-category"), "--per-category", 8, 30);
    const state = kit.read();
    const existing = new Set(Object.keys(state.items));
    const picked = pickSeedCandidates(getLibrary(), perCat, existing);
    if (flags.has("--dry-run")) {
      if (asJson)
        return JSON.stringify({ dryRun: true, count: picked.length, items: picked }, null, 2);
      return `Dry run: would stage ${picked.length} sounds into inbox (${KIT_CATEGORY_IDS.map((c) => `${c}:${picked.filter((x) => x.category === c).length}`).join(", ")})`;
    }
    if (!picked.length) {
      if (asJson) return JSON.stringify({ state, added: 0, updated: 0, skipped: 0 }, null, 2);
      return "No new starter candidates to stage.";
    }
    const res = kit.batchSet(
      picked.map((p) => ({ ...p, status: "inbox" as const, addedBy: "ai" as const })),
      { skipExisting: true },
    );
    if (asJson) return JSON.stringify(res, null, 2);
    return `Seeded inbox: added ${res.added} candidates (${KIT_CATEGORY_IDS.map((c) => `${c}:${picked.filter((x) => x.category === c).length}`).join(", ")})`;
  }

  throw new SoundKitCliError(`Unknown command "${cmd}". Run bun run sound:kit --help`);
}

const formatCliError = (err: unknown): { message: string; code: number } => {
  if (err instanceof SoundKitCliError) return { message: err.message, code: err.code };
  if (err && typeof err === "object" && (err as { name?: string }).name === "ZodError") {
    const issues = (err as { issues?: { path?: (string | number)[]; message?: string }[] }).issues;
    const first = issues?.[0];
    const path = first?.path?.length ? `${first.path.join(".")}: ` : "";
    return { message: `${path}${first?.message ?? "Invalid input"}`, code: 2 };
  }
  return { message: (err as Error)?.message ?? String(err), code: 1 };
};

if (import.meta.main) {
  try {
    console.log(await runSoundKitCli(process.argv.slice(2)));
  } catch (err) {
    const { message, code } = formatCliError(err);
    console.error(message);
    process.exit(code);
  }
}
