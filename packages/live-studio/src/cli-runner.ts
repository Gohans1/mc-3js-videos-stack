import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

import { z } from "zod";

import {
  buildCliInvocation,
  type CliArgValue,
  type CliChoiceSource,
  type CliContext,
  type CliEnvKey,
  type CliEnvStatus,
  type CliRunChunk,
  type CliRunRequest,
  type CliRunSnapshot,
  findCliCommand,
} from "./cli-catalog.ts";
import { favoriteLists } from "./favorites.mjs";
import { killProcessTree } from "./kill-process.mjs";
import { noteNumbers } from "./notes.mjs";

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const POSTURES = ["stand", "crouch", "kneel", "sitSeat", "sitFloor", "allFours", "lie"];
const FIND_KINDS = [
  "sfx",
  "bgm",
  "mc",
  "sound",
  "mocap",
  "block",
  "item",
  "mob",
  "prop",
  "object",
  "3d",
  "transition",
  "anim",
  "text",
  "shape",
  "sticker",
  "filter",
  "look",
  "effect",
  "template",
  "asset",
  "font",
  "adjust",
  "velocity",
  "ease",
];
const FIND_SOURCES = [
  "minecraft",
  "gohans",
  "global",
  "this-film",
  "earshot",
  "mixkit",
  "mixamo",
  "film-stage",
  "builtin",
  "openfilm",
];
const WORKSPACE_PACKAGES = [
  "packages/live-studio",
  "packages/film-kit",
  "packages/film-kit-demo",
  "packages/film-stage",
  "packages/mc-actor",
];

const ArgValueSchema: z.ZodType<CliArgValue> = z.union([
  z.string().max(4000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(4000)).max(200),
]);

export const CliRunRequestSchema = z.object({
  commandId: z.string().trim().min(1).max(80),
  subcommandPath: z.array(z.string().trim().min(1).max(60)).max(4).optional().default([]),
  args: z.record(z.string().max(120), ArgValueSchema).optional().default({}),
  flags: z.record(z.string().max(120), ArgValueSchema).optional().default({}),
  env: z.record(z.string().max(120), ArgValueSchema).optional().default({}),
  targetFilm: z.string().trim().min(1).max(120).optional(),
  mode: z.enum(["execute", "help"]).optional().default("execute"),
  confirmed: z.boolean().optional().default(false),
});

export class CliRunHttpError extends Error {
  status: number;
  code: string;
  extra?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export interface CliRunnerOptions {
  repoRoot?: string;
  bunBin?: string;
  earshotBin?: string;
  pythonBin?: string;
  bashBin?: string;
  probeStudioPort?: (port: number) => Promise<boolean>;
}

function resolveDefaultBashBin(): string {
  if (process.platform !== "win32") return "bash";
  const candidates: string[] = [];
  const git = Bun.which("git");
  if (git) {
    candidates.push(
      join(dirname(dirname(git)), "bin", "bash.exe"),
      join(dirname(dirname(dirname(git))), "bin", "bash.exe"),
    );
  }
  candidates.push(
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  );
  const gitBash = candidates.find((p) => existsSync(p));
  if (gitBash) return gitBash;
  const onPath = Bun.which("bash");
  if (onPath && !/[/\\](?:system32|sysnative|windowsapps)[/\\]bash\.exe$/i.test(onPath)) {
    return onPath;
  }
  return "bash";
}

const safeReadJson = (file: string): Record<string, unknown> | null => {
  try {
    if (!existsSync(file)) return null;
    const data = JSON.parse(readFileSync(file, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

export function resolveMonorepoRoot(startDir?: string): string {
  const candidates = [
    startDir ? resolve(startDir) : null,
    resolve(dirname(fileURLToPath(import.meta.url)), "../../.."),
  ].filter((x): x is string => Boolean(x));

  for (const base of candidates) {
    let cur = base;
    while (true) {
      const pkg = safeReadJson(join(cur, "package.json"));
      const scripts = pkg?.scripts as Record<string, unknown> | undefined;
      if (pkg && existsSync(join(cur, "films")) && typeof scripts?.["new-film"] === "string") {
        return cur;
      }
      const parent = dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}

function sameRealPath(a: string, b: string): boolean {
  try {
    const ra = realpathSync(a);
    const rb = realpathSync(b);
    return process.platform === "win32" ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
  } catch {
    return resolve(a) === resolve(b);
  }
}

function isInsideDirReal(parentDir: string, childPath: string): boolean {
  try {
    const rp = realpathSync(parentDir);
    const rc = realpathSync(childPath);
    const rel = relative(
      process.platform === "win32" ? rp.toLowerCase() : rp,
      process.platform === "win32" ? rc.toLowerCase() : rc,
    );
    return Boolean(rel) && !rel.startsWith("..") && !isAbsolute(rel);
  } catch {
    return false;
  }
}

function hasSecretEnvFile(filename: string, keyName: string): boolean {
  try {
    const file = join(homedir(), ".secrets", filename);
    if (!existsSync(file)) return false;
    const kvRe = new RegExp(`^(?:export[ \\t]+)?${keyName}[ \\t]*=[ \\t]*\\S+`);
    for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      if (kvRe.test(line)) return true;
      if (!line.includes("=") && /^\S+$/.test(line)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function readEnvStatus(): CliEnvStatus {
  const hasEnv = (k: CliEnvKey) => Boolean(process.env[k]?.trim());
  return {
    ELEVENLABS_API_KEY: hasEnv("ELEVENLABS_API_KEY"),
    GENVOICE_API_KEY: hasEnv("GENVOICE_API_KEY"),
    GEMINI_API_KEY: hasEnv("GEMINI_API_KEY"),
    GOOGLE_API_KEY: hasEnv("GOOGLE_API_KEY"),
    OPENCODE_API_KEY:
      hasEnv("OPENCODE_API_KEY") || hasSecretEnvFile("opencode_zen.env", "OPENCODE_API_KEY"),
    OPENROUTER_API_KEY:
      hasEnv("OPENROUTER_API_KEY") || hasSecretEnvFile("openrouter.env", "OPENROUTER_API_KEY"),
  };
}

async function defaultProbeStudioPort(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/notes`, {
      signal: AbortSignal.timeout(150),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function listFilmNames(repoRoot: string): string[] {
  const filmsDir = join(repoRoot, "films");
  if (!existsSync(filmsDir)) return [];
  try {
    return readdirSync(filmsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(filmsDir, d.name, "package.json")))
      .map((d) => d.name)
      .toSorted();
  } catch {
    return [];
  }
}

function listSkillChoices(repoRoot: string): { skills: string[]; skillRefs: string[] } {
  const dir = join(repoRoot, "skill-data");
  if (!existsSync(dir)) return { skills: [], skillRefs: [] };
  try {
    const skills = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "SKILL.md")))
      .map((d) => d.name)
      .toSorted();
    const refs = new Set<string>();
    for (const s of skills) {
      const refDir = join(dir, s, "references");
      if (!existsSync(refDir)) continue;
      for (const f of readdirSync(refDir, { recursive: true, withFileTypes: true })) {
        if (f.isFile() && f.name.endsWith(".md")) {
          refs.add(f.name.replace(/\.md$/, ""));
        }
      }
    }
    return { skills, skillRefs: [...refs].toSorted() };
  } catch {
    return { skills: [], skillRefs: [] };
  }
}

function listFilmChoices(filmDir: string | null): {
  notes: string[];
  shots: string[];
  takes: string[];
  renders: string[];
  labs: string[];
} {
  if (!filmDir || !existsSync(filmDir)) {
    return { notes: [], shots: [], takes: [], renders: [], labs: [] };
  }

  // Notes as `#N` so `notes`, `note`, and `at` all resolve cleanly (bare numbers mean seconds in `at`).
  let notes: string[] = [];
  try {
    const nums = noteNumbers(filmDir);
    notes = [...nums.values()]
      .filter((x) => !x.gone)
      .map((x) => x.n)
      .toSorted((a, b) => a - b)
      .slice(-200)
      .map((n) => `#${n}`);
  } catch {
    notes = [];
  }

  const pkg = safeReadJson(join(filmDir, "package.json"));
  const conf = (pkg?.["live-studio"] as Record<string, unknown> | undefined) ?? {};

  // Shots
  let shots: string[] = [];
  try {
    const shotsRel =
      typeof conf.shotsTimeline === "string" ? conf.shotsTimeline : "src/timeline/shots.json";
    const shotsPath = join(filmDir, shotsRel);
    if (existsSync(shotsPath)) {
      const raw = JSON.parse(readFileSync(shotsPath, "utf8"));
      if (Array.isArray(raw)) {
        shots = raw.map((_, i) => String(i));
      }
    }
  } catch {
    shots = [];
  }

  // Takes from edit.json + voice/takes files
  const takeSet = new Set<string>();
  const edit = safeReadJson(join(filmDir, "src/edit.json"));
  if (edit?.takes && typeof edit.takes === "object" && !Array.isArray(edit.takes)) {
    for (const k of Object.keys(edit.takes)) takeSet.add(k);
  }
  const takesDir = join(filmDir, "voice/takes");
  if (existsSync(takesDir)) {
    try {
      for (const f of readdirSync(takesDir)) {
        const m = /^([^.].+)\.(mp3|wav)$/i.exec(f);
        if (m) takeSet.add(m[1]!);
      }
    } catch {
      /* optional */
    }
  }

  // Renders (.mp4) — skip dot-prefixed internal directories (.chrome-cache, .prev)
  let renders: string[] = [];
  const rendersDir = join(filmDir, "renders");
  if (existsSync(rendersDir)) {
    const walkRenders = (dir: string) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) walkRenders(full);
        else if (e.isFile() && e.name.toLowerCase().endsWith(".mp4")) {
          renders.push(`renders/${relative(rendersDir, full).replaceAll("\\", "/")}`);
        }
      }
    };
    walkRenders(rendersDir);
    renders = renders.toSorted().slice(0, 60);
  }

  // Labs (lab/*.ts|tsx)
  let labs: string[] = [];
  const labDir = join(filmDir, "lab");
  if (existsSync(labDir)) {
    try {
      labs = readdirSync(labDir, { withFileTypes: true })
        .filter((e) => e.isFile() && /\.[mc]?[jt]sx?$/.test(e.name))
        .map((e) => `lab/${e.name}`)
        .toSorted();
    } catch {
      labs = [];
    }
  }

  return {
    notes,
    shots,
    takes: [...takeSet].toSorted(),
    renders,
    labs,
  };
}

export async function scanCliContext(
  film: { PROJECT?: string } | null | undefined,
  opts: CliRunnerOptions & { requestedFilm?: string } = {},
): Promise<CliContext> {
  const repoRoot = opts.repoRoot ?? resolveMonorepoRoot(film?.PROJECT);
  const knownFilms = listFilmNames(repoRoot);

  let activeFilm: string | null = null;
  if (film?.PROJECT) {
    for (const f of knownFilms) {
      if (sameRealPath(film.PROJECT, join(repoRoot, "films", f))) {
        activeFilm = f;
        break;
      }
    }
  }
  const isDemo = !activeFilm;
  activeFilm ??= film?.PROJECT ? basename(resolve(film.PROJECT)) : null;
  const films = activeFilm ? [activeFilm] : [];
  if (opts.requestedFilm && !["active", "root", activeFilm].includes(opts.requestedFilm)) {
    throw new CliRunHttpError(
      400,
      "INVALID_ARGS",
      "Choose the current Studio project or repo root.",
    );
  }

  // Detect running studios cleanly
  const probePort = opts.probeStudioPort ?? defaultProbeStudioPort;
  const runningFilms: string[] = activeFilm ? [activeFilm] : [];
  await Promise.all(
    knownFilms.map(async (f) => {
      if (f === activeFilm) {
        return;
      }
      const studioJson = safeReadJson(join(repoRoot, "films", f, "renders/live/studio.json"));
      const port = typeof studioJson?.port === "number" ? studioJson.port : 0;
      if (port > 0 && (await probePort(port))) {
        runningFilms.push(f);
      }
    }),
  );

  const targetDir = film?.PROJECT ?? null;
  const filmChoices = listFilmChoices(targetDir);
  const { skills, skillRefs } = listSkillChoices(repoRoot);

  let favLists = ["default"];
  try {
    favLists = favoriteLists(join(repoRoot, "favorites"))
      .lists()
      .map((l) => l.name);
  } catch {
    favLists = ["default"];
  }

  let packSources: string[] = [];
  try {
    const rawVault = process.env.MC_VAULT_ROOT?.trim();
    const vaultJson = safeReadJson(join(repoRoot, "vault.json"));
    const vaultRootRel = typeof vaultJson?.root === "string" ? vaultJson.root : "vault";
    const vaultRoot = rawVault ? resolve(repoRoot, rawVault) : join(repoRoot, vaultRootRel);
    const packsDir = join(vaultRoot, "packs");
    const packIdx = safeReadJson(join(vaultRoot, "packs_index.json"));
    const warmMc = safeReadJson(join(vaultRoot, "cache/mc-catalog.v1.json"));
    const warmPacks =
      warmMc?.packs && typeof warmMc.packs === "object"
        ? (warmMc.packs as Record<string, { entries?: unknown[]; meta?: { slug?: string } }>)
        : undefined;
    if (existsSync(packsDir)) {
      const slugSet = new Set<string>();
      for (const f of readdirSync(packsDir)) {
        if (!/\.(jar|zip)$/i.test(f)) continue;
        const cached = warmPacks?.[f];
        if (cached && Array.isArray(cached.entries) && cached.entries.length === 0) continue;
        const idxEntry =
          packIdx && typeof packIdx[f] === "object" && packIdx[f] !== null
            ? (packIdx[f] as { slug?: unknown })
            : undefined;
        const slug =
          typeof cached?.meta?.slug === "string" && cached.meta.slug
            ? cached.meta.slug
            : typeof idxEntry?.slug === "string" && idxEntry.slug
              ? idxEntry.slug
              : f.replace(/\.(jar|zip)$/i, "");
        slugSet.add(slug);
      }
      packSources = [...slugSet].toSorted();
    }
  } catch {
    packSources = [];
  }

  const choices: Record<CliChoiceSource, string[]> = {
    films,
    filmDirs: isDemo ? [] : films.map((f) => `films/${f}`),
    notes: filmChoices.notes,
    shots: filmChoices.shots,
    takes: filmChoices.takes,
    skills,
    skillRefs,
    favLists,
    findKinds: FIND_KINDS,
    findSources: [...new Set([...FIND_SOURCES, ...packSources])],
    postures: POSTURES,
    renders: filmChoices.renders,
    labs: filmChoices.labs,
    packages: WORKSPACE_PACKAGES,
  };

  return {
    repoName: basename(repoRoot),
    repoRoot: resolve(repoRoot).replaceAll("\\", "/"),
    projectRoot: film?.PROJECT ? resolve(film.PROJECT).replaceAll("\\", "/") : null,
    copyShell: process.platform === "win32" ? "powershell" : "posix",
    activeFilm,
    isDemo,
    films,
    runningFilms: runningFilms.toSorted(),
    choices,
    envStatus: readEnvStatus(),
  };
}

function assertSafeValue(val: CliArgValue, where: string, allowNewlines = false): void {
  const check = (s: string) => {
    if (s.includes("\0"))
      throw new CliRunHttpError(400, "INVALID_ARGS", `Null byte not allowed in ${where}`);
    if (!allowNewlines && /[\r\n]/.test(s)) {
      throw new CliRunHttpError(400, "INVALID_ARGS", `Line breaks not allowed in ${where}`);
    }
  };
  if (typeof val === "string") check(val);
  else if (Array.isArray(val)) for (const item of val) check(String(item));
}

const pathExistsOrLink = (p: string): boolean => {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

function assertContainedRelativePath(
  rawVal: CliArgValue,
  resolveBaseDir: string,
  containerDir: string,
  ancestorFloorDir: string,
  label: string,
): void {
  if (typeof rawVal !== "string" || !rawVal.trim()) {
    throw new CliRunHttpError(400, "INVALID_ARGS", `${label} must be a non-empty relative path.`);
  }
  const raw = rawVal.trim();
  if (
    raw === "." ||
    raw === ".." ||
    isAbsolute(raw) ||
    /^[A-Za-z]:/.test(raw) ||
    raw.startsWith("\\")
  ) {
    throw new CliRunHttpError(400, "INVALID_ARGS", `${label} must stay inside its directory.`);
  }
  const segments = raw.split(/[\\/]/).filter(Boolean);
  if (!segments.length || segments.includes("..")) {
    throw new CliRunHttpError(
      400,
      "INVALID_ARGS",
      `${label} cannot contain '..' traversal segments.`,
    );
  }
  const resolvedTarget = resolve(resolveBaseDir, raw);
  const rel = relative(containerDir, resolvedTarget);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new CliRunHttpError(400, "INVALID_ARGS", `${label} must resolve inside its directory.`);
  }
  let cur = resolvedTarget;
  while (!pathExistsOrLink(cur)) {
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  if (!pathExistsOrLink(cur)) {
    throw new CliRunHttpError(400, "INVALID_ARGS", `${label} target ancestor does not exist.`);
  }
  const safeAncestor = sameRealPath(cur, containerDir)
    ? sameRealPath(cur, ancestorFloorDir) || isInsideDirReal(ancestorFloorDir, cur)
    : isInsideDirReal(containerDir, cur);
  if (!safeAncestor) {
    throw new CliRunHttpError(
      400,
      "INVALID_ARGS",
      `${label} escapes its directory via symlink or outside path.`,
    );
  }
}

export function sliceUtf8ToByteLimit(text: string, maxBytes: number): string {
  if (maxBytes <= 0 || !text) return "";
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let bytes = 0;
  let end = 0;
  while (end < text.length) {
    const code = text.charCodeAt(end);
    const isPair =
      code >= 0xd800 &&
      code <= 0xdbff &&
      end + 1 < text.length &&
      text.charCodeAt(end + 1) >= 0xdc00 &&
      text.charCodeAt(end + 1) <= 0xdfff;
    const step = isPair ? 2 : 1;
    const cp = isPair ? (text.codePointAt(end) ?? code) : code;
    const cpBytes =
      cp >= 0xd800 && cp <= 0xdfff ? 3 : cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
    if (bytes + cpBytes > maxBytes) break;
    bytes += cpBytes;
    end += step;
  }
  return text.slice(0, end);
}

export interface CliStreamEvent {
  event: "chunk" | "done";
  data:
    | CliRunChunk
    | {
        runId: string;
        status: CliRunSnapshot["status"];
        exitCode: number | null;
        signal: string | null;
        durationMs: number;
        truncated: boolean;
        error?: string;
      };
}

interface InternalRun {
  snapshot: CliRunSnapshot;
  bytes: number;
  nextSeq: number;
  stopRequested: boolean;
  kill: () => void;
  listeners: Set<(ev: CliStreamEvent) => void>;
}

export function createCliRunner(
  film: { PROJECT?: string } | null | undefined,
  opts: CliRunnerOptions = {},
) {
  const repoRoot = opts.repoRoot ?? resolveMonorepoRoot(film?.PROJECT);
  const bunBin = opts.bunBin ?? process.execPath;
  const earshotBin = opts.earshotBin ?? "earshot";
  const pythonBin = opts.pythonBin ?? "python";
  const bashBin = opts.bashBin ?? resolveDefaultBashBin();

  let activeRun: InternalRun | null = null;
  let startingRun = false;
  let lastRun: InternalRun | null = null;
  const runsById = new Map<string, InternalRun>();

  const cloneSnapshot = (r: InternalRun | null): CliRunSnapshot | null =>
    r
      ? {
          ...r.snapshot,
          subcommandPath: [...r.snapshot.subcommandPath],
          output: [...r.snapshot.output],
        }
      : null;

  const findRun = (id: string): InternalRun | null => runsById.get(id) ?? null;

  async function start(rawBody: unknown): Promise<{
    run: CliRunSnapshot;
    spec: ReturnType<typeof buildCliInvocation>;
  }> {
    if (activeRun || startingRun) {
      throw new CliRunHttpError(409, "BUSY", "Another CLI command is currently running.", {
        activeRunId: activeRun?.snapshot.runId ?? null,
      });
    }
    startingRun = true;
    try {
      return await startUnchecked(rawBody);
    } finally {
      startingRun = false;
    }
  }

  async function startUnchecked(rawBody: unknown): Promise<{
    run: CliRunSnapshot;
    spec: ReturnType<typeof buildCliInvocation>;
  }> {
    const parsed = CliRunRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new CliRunHttpError(
        400,
        "INVALID_ARGS",
        parsed.error.issues[0]?.message ?? "Invalid run request",
      );
    }
    const req: CliRunRequest = parsed.data;
    const cmd = findCliCommand(req.commandId);
    if (!cmd) {
      throw new CliRunHttpError(404, "UNKNOWN_COMMAND", `Unknown CLI command: ${req.commandId}`);
    }

    // Boundary safety checks on incoming user values
    for (const [k, v] of Object.entries(req.args ?? {})) assertSafeValue(v, `arg:${k}`, false);
    for (const [k, v] of Object.entries(req.flags ?? {}))
      assertSafeValue(v, `flag:${k}`, k === "--prompt");
    for (const [k, v] of Object.entries(req.env ?? {})) assertSafeValue(v, `env:${k}`, false);

    if (req.targetFilm && req.targetFilm !== "active" && req.targetFilm !== "root") {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(req.targetFilm)) {
        throw new CliRunHttpError(400, "INVALID_ARGS", "Invalid targetFilm name.");
      }
    }

    const context = await scanCliContext(film, opts);
    if (cmd.cwdModes.length === 1 && cmd.cwdModes[0] === "film" && req.targetFilm === "root") {
      throw new CliRunHttpError(
        400,
        "INVALID_ARGS",
        `${cmd.label} runs inside a film workspace; targetFilm cannot be 'root'.`,
      );
    }

    const requestedFilm =
      !req.targetFilm || req.targetFilm === "active" || req.targetFilm === "root"
        ? context.activeFilm
        : req.targetFilm;

    if (req.targetFilm && req.targetFilm !== "active" && req.targetFilm !== "root") {
      if (req.targetFilm !== context.activeFilm) {
        throw new CliRunHttpError(
          400,
          "INVALID_ARGS",
          "Choose the current Studio project or repo root.",
        );
      }
    }

    const spec = buildCliInvocation(req, context);

    if (spec.mode === "help" && spec.meta.helpMode === "none") {
      throw new CliRunHttpError(
        400,
        "NO_HELP",
        spec.validationErrors[0] ?? "Command does not support --help.",
      );
    }
    if (spec.validationErrors.length) {
      throw new CliRunHttpError(400, "INVALID_ARGS", spec.validationErrors[0]!);
    }
    if (spec.mode === "execute" && cmd.id === "studio:init") {
      assertContainedRelativePath(
        req.args?.project,
        repoRoot,
        resolve(repoRoot, "films"),
        repoRoot,
        "studio:init project",
      );
    }
    if (spec.mode === "execute" && cmd.id === "eval:load") {
      const filmFlag = req.flags?.["--film"];
      if (filmFlag !== undefined && filmFlag !== false && String(filmFlag).trim() !== "") {
        const name = String(filmFlag).trim();
        if (
          !/^[a-z0-9][a-z0-9-]*$/.test(name) ||
          !context.films.includes(name) ||
          !isInsideDirReal(join(repoRoot, "films"), join(repoRoot, "films", name))
        ) {
          throw new CliRunHttpError(400, "INVALID_ARGS", `Invalid --film target: ${name}`);
        }
      }
    }
    if (spec.guardReason) {
      throw new CliRunHttpError(400, "GUARDED", spec.guardReason);
    }
    if (spec.requiresConfirm && !req.confirmed) {
      throw new CliRunHttpError(
        400,
        "CONFIRM_REQUIRED",
        spec.confirmMessage ?? "Confirmation required before running this command.",
        { confirmMessage: spec.confirmMessage },
      );
    }

    // Enforce declared env keys
    const allowedEnvKeys = new Set(spec.envDef.map((e) => e.key));
    for (const k of Object.keys(req.env ?? {})) {
      if (!allowedEnvKeys.has(k)) {
        throw new CliRunHttpError(400, "INVALID_ARGS", `Disallowed env override: ${k}`);
      }
    }
    const childEnv: Record<string, string | undefined> = {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    };
    delete childEnv.LIVE_PROJECT;
    for (const [k, v] of spec.envEntries) {
      if (!allowedEnvKeys.has(k)) {
        throw new CliRunHttpError(400, "INVALID_ARGS", `Disallowed env override: ${k}`);
      }
      childEnv[k] = v;
    }

    // Resolve authoritative cwd inside repoRoot
    let resolvedCwd = repoRoot;
    let resolvedFilmName: string | null = null;
    if (spec.cwdMode === "film") {
      if (!requestedFilm) {
        throw new CliRunHttpError(
          400,
          "GUARDED",
          "No film directory available in films/ for this command.",
        );
      }
      if (!film?.PROJECT || !existsSync(film.PROJECT)) {
        throw new CliRunHttpError(
          400,
          "GUARDED",
          "The current Studio project is unavailable. Reopen its Studio.",
        );
      }
      resolvedCwd = realpathSync(film.PROJECT);
      resolvedFilmName = requestedFilm;
    } else if (cmd.runner === "package-script" && cmd.packageDir) {
      const pkgPath = join(repoRoot, cmd.packageDir);
      if (!isInsideDirReal(repoRoot, pkgPath)) {
        throw new CliRunHttpError(400, "INVALID_ARGS", "Invalid package directory.");
      }
      resolvedCwd = pkgPath;
    }

    const assertViewsFlag = (raw: unknown) => {
      if (typeof raw !== "string") {
        throw new CliRunHttpError(400, "INVALID_ARGS", "--views must be a string.");
      }
      const trimmed = raw.trim();
      if (trimmed.startsWith("@")) {
        assertContainedRelativePath(
          trimmed.slice(1).trim(),
          resolvedCwd,
          resolvedCwd,
          repoRoot,
          "--views",
        );
      }
    };
    const entryFlag = req.flags?.["--entry"];
    if (entryFlag !== undefined && entryFlag !== false) {
      assertContainedRelativePath(entryFlag, resolvedCwd, resolvedCwd, repoRoot, "--entry");
    }
    const viewsFlag = req.flags?.["--views"];
    if (viewsFlag !== undefined && viewsFlag !== false) assertViewsFlag(viewsFlag);
    spec.argvTokens.forEach((token, i) => {
      const value = spec.argvTokens[i + 1];
      if (token === "--entry" && value !== undefined) {
        assertContainedRelativePath(value, resolvedCwd, resolvedCwd, repoRoot, "--entry");
      } else if (token === "--views" && value !== undefined) assertViewsFlag(value);
    });

    // Build exact exe + argv cleanly from allowlisted catalog entry
    const resolveRepoScript = (target: string): string => {
      const scriptFile = join(repoRoot, target);
      if (!isInsideDirReal(repoRoot, scriptFile) || !existsSync(scriptFile)) {
        throw new CliRunHttpError(404, "UNKNOWN_COMMAND", `Script not found: ${target}`);
      }
      return scriptFile;
    };
    let exe: string;
    let spawnArgs: string[];
    switch (cmd.runner) {
      case "bun-script":
      case "package-script":
        exe = bunBin;
        spawnArgs = ["run", cmd.target, ...spec.argvTokens];
        break;
      case "bun-file":
        exe = bunBin;
        spawnArgs = [resolveRepoScript(cmd.target), ...spec.argvTokens];
        break;
      case "python-file":
        exe = pythonBin;
        spawnArgs = [resolveRepoScript(cmd.target), ...spec.argvTokens];
        break;
      case "bash-file": {
        const scriptFile = resolveRepoScript(cmd.target);
        const scriptArg =
          process.platform === "win32" ? scriptFile.replaceAll("\\", "/") : scriptFile;
        exe = bashBin;
        spawnArgs = [scriptArg, ...spec.argvTokens];
        break;
      }
      case "earshot":
        exe = earshotBin;
        spawnArgs = [...spec.argvTokens];
        break;
    }

    const runId = randomUUID().replaceAll("-", "").slice(0, 12);
    const startedAt = Date.now();

    const child = spawn(exe, spawnArgs, {
      cwd: resolvedCwd,
      env: childEnv,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });

    const entry: InternalRun = {
      snapshot: {
        runId,
        commandId: cmd.id,
        subcommandPath: spec.subcommandPath,
        mode: spec.mode,
        displayCommand: spec.displayCommand,
        cwd: relative(repoRoot, resolvedCwd).replaceAll("\\", "/") || ".",
        targetFilm: resolvedFilmName,
        status: "running",
        startedAt,
        truncated: false,
        output: [],
      },
      bytes: 0,
      nextSeq: 0,
      stopRequested: false,
      kill: () => {
        if (child.pid) killProcessTree(child.pid, () => child.kill("SIGKILL"));
      },
      listeners: new Set(),
    };

    activeRun = entry;
    lastRun = entry;
    runsById.set(runId, entry);
    // Keep only recent 20 snapshots in memory
    if (runsById.size > 20) {
      const oldest = runsById.keys().next().value;
      if (oldest && oldest !== runId) runsById.delete(oldest);
    }

    const appendChunk = (stream: "stdout" | "stderr", rawText: string) => {
      const clean = stripVTControlCharacters(rawText);
      if (!clean) return;
      if (entry.snapshot.truncated) return;
      const chunkBytes = Buffer.byteLength(clean, "utf8");
      let text = clean;
      if (entry.bytes + chunkBytes > MAX_OUTPUT_BYTES) {
        const room = Math.max(0, MAX_OUTPUT_BYTES - entry.bytes);
        text = sliceUtf8ToByteLimit(clean, room);
        entry.snapshot.truncated = true;
      }
      if (text) {
        entry.bytes += Buffer.byteLength(text, "utf8");
        const chunk: CliRunChunk = { seq: entry.nextSeq++, stream, chunk: text };
        entry.snapshot.output.push(chunk);
        for (const fn of entry.listeners) fn({ event: "chunk", data: chunk });
      }
      if (entry.snapshot.truncated) {
        const notice: CliRunChunk = {
          seq: entry.nextSeq++,
          stream: "stderr",
          chunk: "\n[live-studio] Output truncated at 2 MB cap.\n",
        };
        entry.snapshot.output.push(notice);
        for (const fn of entry.listeners) fn({ event: "chunk", data: notice });
      }
    };

    const finish = (
      status: CliRunSnapshot["status"],
      exitCode: number | null,
      signal: string | null,
      error?: string,
    ) => {
      if (entry.snapshot.status !== "running") return;
      const finishedAt = Date.now();
      entry.snapshot.status = entry.stopRequested ? "stopped" : status;
      entry.snapshot.finishedAt = finishedAt;
      entry.snapshot.durationMs = finishedAt - entry.snapshot.startedAt;
      entry.snapshot.exitCode = exitCode;
      entry.snapshot.signal = signal;
      if (error) entry.snapshot.error = error;
      if (activeRun?.snapshot.runId === runId) activeRun = null;

      const doneData = {
        runId,
        status: entry.snapshot.status,
        exitCode: entry.snapshot.exitCode ?? null,
        signal: entry.snapshot.signal ?? null,
        durationMs: entry.snapshot.durationMs,
        truncated: entry.snapshot.truncated,
        ...(error ? { error } : {}),
      };
      for (const fn of entry.listeners) fn({ event: "done", data: doneData });
      entry.listeners.clear();
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (d: string) => appendChunk("stdout", d));
    child.stderr?.on("data", (d: string) => appendChunk("stderr", d));
    child.on("error", (err: Error) => {
      appendChunk("stderr", `Failed to start ${exe}: ${err.message}\n`);
      finish("error", null, null, err.message);
    });
    child.on("close", (code, sig) => {
      finish(entry.stopRequested ? "stopped" : "done", code, sig);
    });

    return { run: cloneSnapshot(entry)!, spec };
  }

  function stopRun(runId: string): CliRunSnapshot | null {
    const entry = findRun(runId);
    if (!entry) return null;
    if (entry.snapshot.status === "running" && !entry.stopRequested) {
      entry.stopRequested = true;
      entry.kill();
    }
    return cloneSnapshot(entry);
  }

  function stopActive(): void {
    if (activeRun) stopRun(activeRun.snapshot.runId);
  }

  function subscribe(
    runId: string,
    afterSeq: number,
    onEvent: (ev: CliStreamEvent) => void,
  ): (() => void) | null {
    const entry = findRun(runId);
    if (!entry) return null;
    for (const chunk of entry.snapshot.output) {
      if (chunk.seq > afterSeq) onEvent({ event: "chunk", data: chunk });
    }
    if (entry.snapshot.status !== "running") {
      onEvent({
        event: "done",
        data: {
          runId,
          status: entry.snapshot.status,
          exitCode: entry.snapshot.exitCode ?? null,
          signal: entry.snapshot.signal ?? null,
          durationMs: entry.snapshot.durationMs ?? 0,
          truncated: entry.snapshot.truncated,
          ...(entry.snapshot.error ? { error: entry.snapshot.error } : {}),
        },
      });
      return () => {};
    }
    entry.listeners.add(onEvent);
    return () => {
      entry.listeners.delete(onEvent);
    };
  }

  function getRuns(): { active: CliRunSnapshot | null; last: CliRunSnapshot | null } {
    return {
      active: cloneSnapshot(activeRun),
      last: cloneSnapshot(lastRun),
    };
  }

  return {
    getRuns,
    start,
    stopRun,
    stopActive,
    subscribe,
  };
}

export type CliRunner = ReturnType<typeof createCliRunner>;
