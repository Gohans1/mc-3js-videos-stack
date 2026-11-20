import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

import { LOCAL, vaultPath } from "../../../scripts/vault.mjs";
import {
  pickedZipState,
  preparePicksBatch,
  readPicksJson,
  removePicksBatch,
  updatePicksBatch,
} from "../../mc-assets/pick.mjs";
import {
  blockPropertyWarnings,
  loadMcAssetsCatalog,
  matchesMcPackSource,
  scanGohansPack,
  scanVaultMobs,
} from "../../mc-assets/src/catalog.ts";
import { PlacedTimeline } from "./contract.ts";
import { projectClock } from "./project-clock.mjs";
import { PROP_CODE_EXTS, PROP_MEDIA_EXTS } from "./prop-library.ts";
import { openTimelineFile } from "./timeline_file.mjs";

const FPS = 30;
const KEY_SNAP = 0.5 / FPS;
const r3 = (x) => Math.round(x * 1e3) / 1e3;
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const CODE_EXTS = new Set(PROP_CODE_EXTS);
const PROP_EXTS = new Set([...PROP_CODE_EXTS, ...PROP_MEDIA_EXTS]);
const isPropFileName = (name) => {
  const lower = name.toLowerCase();
  return PROP_EXTS.has(extname(lower)) && !lower.endsWith(".d.ts");
};
const isSymlink = (p) => Boolean(lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink());

export class AssetUsageError extends Error {
  constructor(message, code = 2) {
    super(message);
    this.code = code;
  }
}

export const resolvedVaultRoot = () =>
  process.env.MC_VAULT_ROOT?.trim() ? vaultPath(process.env.MC_VAULT_ROOT.trim()) : LOCAL;

const RESERVED_OBJECT_NAMES = new Set(["__proto__", "constructor", "prototype"]);
const hasOwn = (obj, key) => Boolean(obj) && Object.hasOwn(obj, key);
function assertAllowedObjectName(name, label = "Placed object name") {
  if (RESERVED_OBJECT_NAMES.has(name)) {
    throw new AssetUsageError(`${label} "${name}" is reserved`, 2);
  }
}

export const placedRelOf = (conf = {}) =>
  Object.entries(conf.keyFiles ?? {}).find(([, role]) => role === "placed")?.[0] ??
  "src/timeline/placed.json";

const placedKeyIndex = (conf = {}) =>
  Object.entries(conf.keyFiles ?? {}).findIndex(([, role]) => role === "placed");

async function readPlacedDoc(project, conf = {}) {
  const rel = placedRelOf(conf);
  const idx = placedKeyIndex(conf);
  const studioFile = join(project, "renders/live/studio.json");
  if (idx >= 0 && existsSync(studioFile)) {
    try {
      const studio = JSON.parse(readFileSync(studioFile, "utf8"));
      const port = studio?.port;
      const sameProject =
        typeof studio?.project !== "string" || resolve(studio.project) === resolve(project);
      if (sameProject && Number.isInteger(port) && port > 0 && port <= 65535) {
        const res = await fetch(`http://127.0.0.1:${port}/api/collaboration/keys/${idx}`, {
          signal: AbortSignal.timeout(1500),
        });
        if (res.ok) {
          const payload = await res.json();
          const data =
            payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
              ? payload.data
              : {};
          return {
            file: join(project, rel),
            rel,
            version: payload.version,
            data,
            studio: { port, idx },
          };
        }
      }
    } catch {
      // Fall back to direct file collaboration when Studio is not listening.
    }
  }
  const lane = openTimelineFile(project, rel, PlacedTimeline);
  const current = lane.read() ?? { version: "missing", data: {} };
  const data =
    current.data && typeof current.data === "object" && !Array.isArray(current.data)
      ? current.data
      : {};
  return { file: lane.FILE, rel, version: current.version, data, lane };
}

async function writePlacedDoc(project, doc, nextData) {
  PlacedTimeline.parse(nextData);
  if (doc.studio) {
    const res = await fetch(
      `http://127.0.0.1:${doc.studio.port}/api/collaboration/keys/${doc.studio.idx}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ base: doc.version ?? "", data: nextData }),
        signal: AbortSignal.timeout(2000),
      },
    );
    if (res.status === 409) {
      throw new AssetUsageError(
        `Studio has newer unsaved/conflicting changes in ${doc.rel}; read timeline again before retrying`,
        1,
      );
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new AssetUsageError(
        body?.problems ? body.problems.join("; ") : `Studio refused write (${res.status})`,
        1,
      );
    }
    return { ...body, file: doc.file };
  }
  mkdirSync(dirname(doc.file), { recursive: true });
  const saved = doc.lane.write(doc.version, nextData, { actor: "agent" });
  if (saved.conflict) {
    throw new AssetUsageError(
      `Concurrent change to ${doc.rel}; read timeline again before retrying`,
      1,
    );
  }
  if (saved.problems) throw new AssetUsageError(saved.problems.join("; "), 1);
  return { ...saved, file: doc.file };
}

function getPictureClock(project, conf, fallback = 0, options = {}) {
  return projectClock(project, conf, "picture", fallback, options).clock;
}

function mapPlacedToHeard(data, clock) {
  const out = {};
  for (const [name, obj] of Object.entries(data)) {
    out[name] = {
      ...obj,
      keys: (obj.keys ?? []).map((k) => ({ ...k, t: r4(clock.outputAt(k.t, "after")) })),
    };
  }
  return out;
}

export async function timelinePlaced(project, conf, options = {}) {
  const doc = await readPlacedDoc(project, conf);
  const maxT = Object.values(doc.data).reduce(
    (hi, o) => Math.max(hi, ...(o.keys ?? []).map((k) => k.t ?? 0)),
    0,
  );
  const clock = getPictureClock(project, conf, maxT, options);
  return {
    file: doc.file,
    version: doc.version,
    data: mapPlacedToHeard(doc.data, clock),
    targets: Object.keys(doc.data).map((k) => `placed:${k}`),
  };
}

export function timelinePicks(project) {
  const picksPath = join(project, "pack/picks.json");
  const picks = readPicksJson(project);
  const count = (k) => picks.reduce((n, p) => n + (p[k]?.length ?? 0), 0);
  return {
    file: picksPath,
    data: picks,
    zip: {
      ...pickedZipState(project, picks),
      blocks: count("blocks"),
      items: count("items"),
    },
    targets: picks.flatMap((p) => [
      ...(p.blocks ?? []).map((b) => `block:${p.namespace}:${b}`),
      ...(p.items ?? []).map((it) => `item:${p.namespace}:${it}`),
    ]),
  };
}

function matchSourceFilter(item, source) {
  if (!source) return true;
  if (item.pack) return matchesMcPackSource(source, item.pack, item.source);
  return item.source.toLowerCase() === source.toLowerCase();
}

function parsePickTarget(rawId) {
  const low = rawId.trim();
  if (/^mob:/i.test(low)) {
    throw new AssetUsageError(
      `Mobs load automatically without picking: use bun run asset use ${low} --film films/<name>`,
      2,
    );
  }
  if (/^prop:/i.test(low)) {
    throw new AssetUsageError(
      `Props are not picked into picked.zip: use bun run asset use ${low} --film films/<name>`,
      2,
    );
  }
  const mExplicit = /^(block|item):([^:]+):(.+)$/i.exec(low);
  if (mExplicit) {
    return { kind: mExplicit[1].toLowerCase(), namespace: mExplicit[2], name: mExplicit[3] };
  }
  const mNs = /^([^:]+):(.+)$/.exec(low);
  if (mNs) return { kind: undefined, namespace: mNs[1], name: mNs[2] };
  throw new AssetUsageError(`Expected block:<ns>:<id> or item:<ns>:<id> (got "${rawId}")`, 2);
}

function resolveCatalogCandidates(cat, target, source) {
  const list = cat.items.filter(
    (x) =>
      (target.kind ? x.kind === target.kind : x.kind === "block" || x.kind === "item") &&
      x.namespace === target.namespace &&
      x.name === target.name &&
      x.type !== "vanilla" &&
      (source
        ? matchSourceFilter(x, source)
        : x.namespace !== "minecraft" || x.type !== "resourcepack"),
  );
  if (target.namespace === "minecraft" && !list.length && (!source || source === "minecraft")) {
    throw new AssetUsageError(
      `Vanilla "${target.kind ?? "block"}:minecraft:${target.name}" does not need picking; pass --source <pack> only to pick a resource-pack override`,
      2,
    );
  }
  if (target.namespace === "gohans") {
    throw new AssetUsageError(
      `Built-in gohans:${target.name} is already bundled in mc-assets/pack and does not need picking`,
      2,
    );
  }
  if (!list.length) {
    throw new AssetUsageError(
      `No pack entry found for ${target.kind ? `${target.kind}:` : ""}${target.namespace}:${target.name}${source ? ` under --source ${source}` : ""}`,
      1,
    );
  }
  if (list.length > 1) {
    const packs = [...new Set(list.map((x) => x.pack ?? x.source))];
    const kinds = [...new Set(list.map((x) => `${x.kind}:${x.namespace}:${x.name}`))];
    if (packs.length === 1 && kinds.length > 1) {
      throw new AssetUsageError(
        `Both block and item exist for ${target.namespace}:${target.name}: prefix block: or item:`,
        2,
      );
    }
    throw new AssetUsageError(
      `Ambiguous ${target.namespace}:${target.name} in multiple packs (${packs.join(", ")}): pass --source <pack>`,
      2,
    );
  }
  return list[0];
}

function parseAndValidatePickTargets(ids, kind) {
  if (kind && !["block", "item"].includes(kind)) {
    throw new AssetUsageError(`--kind for pick/unpick must be block or item (got ${kind})`, 2);
  }
  return ids.map((raw) => {
    const t = parsePickTarget(raw);
    if (kind && t.kind && t.kind !== kind) {
      throw new AssetUsageError(`--kind ${kind} contradicts "${raw}"`, 2);
    }
    return { ...t, kind: t.kind ?? kind };
  });
}

export function pickObjects(
  project,
  { ids, source, build = true, kind, vaultRoot = resolvedVaultRoot() },
) {
  const parsed = parseAndValidatePickTargets(ids, kind);

  const cat = loadMcAssetsCatalog({ vaultRoot, quiet: true });
  const picks = readPicksJson(project);
  const grouped = new Map();
  const warnings = [];
  for (const target of parsed) {
    const hit = resolveCatalogCandidates(cat, target, source);
    if (!hit.pack) throw new AssetUsageError(`Cannot pick non-pack asset ${hit.id}`, 2);
    assertPickSource(findPick(picks, hit.kind, hit.namespace, hit.name), hit);
    if (hit.renderable === false) {
      warnings.push(
        `"${hit.id}" is marked non-renderable (${hit.brokenReason ?? "unknown loader or missing files"})`,
      );
    }
    const k = `${hit.pack}|${hit.namespace}`;
    let g = grouped.get(k);
    if (!g) {
      g = {
        jar: hit.pack,
        namespace: hit.namespace,
        licence: hit.license,
        page: hit.url,
        blocks: [],
        items: [],
      };
      grouped.set(k, g);
    }
    if (hit.kind === "item") g.items.push(hit.name);
    else g.blocks.push(hit.name);
  }

  const vaultDir = join(vaultRoot, "packs");
  const vanillaJar = join(vaultRoot, "jar/client_assets.zip");
  const groups = [...grouped.values()];
  const out = updatePicksBatch(project, groups, {
    vaultDir,
    vanillaJar,
    build,
    quiet: true,
    strictJars: groups.map((group) => group.jar),
  });
  return warnings.length ? { ...out, warnings } : out;
}

function findPick(picks, kind, namespace, name) {
  const key = kind === "block" ? "blocks" : "items";
  return picks.find((row) => row.namespace === namespace && row[key]?.includes(name));
}

function assertPickSource(existing, hit) {
  if (existing && existing.jar !== hit.pack) {
    throw new AssetUsageError(
      `${hit.id} already uses ${existing.jar} for this film; unpick it with --source ${existing.jar} before selecting ${hit.pack ?? hit.source}`,
    );
  }
}

function resolvePickJarsBySource(picks, vaultRoot, source) {
  const slugs = new Map();
  const idxFile = join(vaultRoot, "packs_index.json");
  if (existsSync(idxFile)) {
    try {
      const idx = JSON.parse(readFileSync(idxFile, "utf8"));
      for (const [jar, meta] of Object.entries(idx))
        if (typeof meta?.slug === "string") slugs.set(jar.toLowerCase(), meta.slug);
    } catch {}
  }
  return picks.filter(({ jar }) => matchesMcPackSource(source, jar, slugs.get(jar.toLowerCase())));
}

export async function unpickObjects(
  project,
  conf,
  { ids, source, build = true, kind, vaultRoot = resolvedVaultRoot() },
) {
  const vaultDir = join(vaultRoot, "packs");
  const vanillaJar = join(vaultRoot, "jar/client_assets.zip");
  const picks = readPicksJson(project);
  const warnings = [];
  const toRemove = parseAndValidatePickTargets(ids, kind);
  const sourceMatches = source ? resolvePickJarsBySource(picks, vaultRoot, source) : undefined;
  const groups = [];
  for (const t of toRemove) {
    const selection = {
      namespace: t.namespace,
      blocks: !t.kind || t.kind === "block" ? [t.name] : [],
      items: !t.kind || t.kind === "item" ? [t.name] : [],
    };
    if (source) {
      const matchingPacks = sourceMatches.filter(
        (p) =>
          p.namespace === t.namespace &&
          (selection.blocks.some((name) => p.blocks?.includes(name)) ||
            selection.items.some((name) => p.items?.includes(name))),
      );
      const jars = [...new Set(matchingPacks.map((p) => p.jar))];
      if (jars.length > 1)
        throw new AssetUsageError(
          `--source ${source} matches multiple picks; choose one archive filename (${jars.join(", ")})`,
        );
      if (!matchingPacks.length) {
        warnings.push(
          `No picked entry matching ${t.kind ? `${t.kind}:` : ""}${t.namespace}:${t.name} under --source ${source}`,
        );
        continue;
      }
      for (const m of matchingPacks) groups.push({ ...selection, jar: m.jar });
    } else {
      groups.push(selection);
    }
  }

  const result = removePicksBatch(project, groups, { vaultDir, vanillaJar, build, quiet: true });
  const { removed } = result;
  const placedDoc = await readPlacedDoc(project, conf).catch(() => null);
  if (placedDoc?.data) {
    for (const [objName, obj] of Object.entries(placedDoc.data)) {
      if (
        removed.includes(obj?.what) &&
        !result.picks.some((p) =>
          p.blocks?.some((name) => obj.what === `block:${p.namespace}:${name}`),
        )
      ) {
        warnings.push(`placed object "${objName}" still uses ${obj.what}`);
      }
    }
  }
  if (!removed.length && !warnings.length) {
    warnings.push("Nothing unpicked (requested ids were not in pack/picks.json)");
  }
  return {
    ...result,
    warnings,
  };
}

function assertInsideReal(parentDir, childPath, label) {
  const rp = realpathSync(parentDir);
  const rc = realpathSync(childPath);
  const rel = relative(
    process.platform === "win32" ? rp.toLowerCase() : rp,
    process.platform === "win32" ? rc.toLowerCase() : rc,
  );
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new AssetUsageError(`${label} escapes allowed directory (${childPath})`, 1);
  }
  return rc;
}

function copyGlobalProp(project, rawId, vaultRoot, force = false) {
  const segments = typeof rawId === "string" ? rawId.split("/") : [];
  if (
    !rawId ||
    rawId.includes("\0") ||
    rawId.includes("\\") ||
    rawId.includes(":") ||
    isAbsolute(rawId) ||
    segments.some((s) => !s || s === "." || s === ".." || s.startsWith("."))
  ) {
    throw new AssetUsageError(`Invalid global prop id: ${rawId}`, 2);
  }
  const propsRoot = join(vaultRoot, "props");
  if (!existsSync(propsRoot)) {
    throw new AssetUsageError(`No Global props folder in vault (${propsRoot})`, 1);
  }
  const realRoot = realpathSync(propsRoot);
  const relDir = dirname(rawId);
  const stemName = basename(rawId);
  const srcDir = relDir === "." ? realRoot : resolve(realRoot, relDir);
  if (!existsSync(srcDir)) {
    throw new AssetUsageError(`Unknown Global prop prop:global:${rawId}`, 1);
  }
  if (relDir !== ".") assertInsideReal(realRoot, srcDir, "Global prop folder");

  const filesToCopy = readdirSync(srcDir, { withFileTypes: true }).filter((d) => {
    if (!d.isFile() || !isPropFileName(d.name)) return false;
    const ext = extname(d.name).toLowerCase();
    return d.name.slice(0, -ext.length) === stemName;
  });
  if (!filesToCopy.length) {
    throw new AssetUsageError(`Unknown Global prop prop:global:${rawId}`, 1);
  }

  const destRoot = join(project, "src/props");
  if (isSymlink(destRoot)) {
    throw new AssetUsageError(`Refusing symlinked destination ${destRoot}`, 1);
  }
  const destDir = relDir === "." ? destRoot : resolve(destRoot, relDir);
  if (relDir !== ".") {
    let probe = destRoot;
    for (const seg of relDir.split("/")) {
      probe = join(probe, seg);
      if (isSymlink(probe)) {
        throw new AssetUsageError(`Refusing symlinked destination ${probe}`, 1);
      }
    }
  }

  // Pre-validate every source, leaf symlink & destination collision before mutating film files or folders.
  const plan = filesToCopy.map((d) => {
    const srcFile = assertInsideReal(realRoot, join(srcDir, d.name), "Global prop file");
    const destFile = join(destDir, d.name);
    if (isSymlink(destFile)) {
      throw new AssetUsageError(`Refusing symlinked destination ${destFile}`, 1);
    }
    if (existsSync(destFile) && !force) {
      throw new AssetUsageError(
        `Destination already exists (${relative(project, destFile).replaceAll("\\", "/")}); pass --force to overwrite`,
        1,
      );
    }
    return { name: d.name, srcFile, destFile };
  });

  mkdirSync(destRoot, { recursive: true });
  const realDestRoot = realpathSync(destRoot);
  mkdirSync(destDir, { recursive: true });
  if (relDir !== ".") assertInsideReal(realDestRoot, destDir, "Film props destination");

  const copiedFiles = [];
  for (const item of plan) {
    copyFileSync(item.srcFile, item.destFile);
    copiedFiles.push(relative(project, item.destFile).replaceAll("\\", "/"));
  }

  const warnings = [];
  const copiedSet = new Set(filesToCopy.map((d) => resolve(destDir, d.name).toLowerCase()));
  for (const d of filesToCopy) {
    const ext = extname(d.name).toLowerCase();
    if (!CODE_EXTS.has(ext)) continue;
    const destFile = join(destDir, d.name);
    const code = readFileSync(destFile, "utf8");
    const loader = ext === ".tsx" ? "tsx" : "ts";
    try {
      const imports = new Bun.Transpiler({ loader }).scanImports(code);
      for (const imp of imports) {
        if (!imp.path.startsWith(".")) continue;
        const cleanImp = imp.path.split(/[?#]/)[0];
        const targetAbs = resolve(destDir, cleanImp);
        const relToProps = relative(realDestRoot, targetAbs);
        if (relToProps.startsWith("..") || isAbsolute(relToProps)) {
          warnings.push(
            `${relative(project, destFile).replaceAll("\\", "/")} imports "${imp.path}", which escapes src/props/`,
          );
          continue;
        }
        const candidates = [
          targetAbs,
          ...[".ts", ".tsx", ".mts", ".js", ".jsx", ".json"].map((e) => `${targetAbs}${e}`),
        ];
        if (!candidates.some((c) => copiedSet.has(c.toLowerCase()) || existsSync(c))) {
          warnings.push(
            `${relative(project, destFile).replaceAll("\\", "/")} imports relative module "${imp.path}", which was not copied`,
          );
        }
      }
    } catch {}
  }

  const tsEntry = copiedFiles.find((f) => CODE_EXTS.has(extname(f).toLowerCase()));
  const importPath = tsEntry
    ? `./${tsEntry.replace(/^src\//, "").replace(/\.[mc]?[jt]sx?$/i, "")}`
    : undefined;
  return {
    copied: true,
    id: `prop:global:${rawId}`,
    files: copiedFiles,
    ...(importPath ? { importHint: `import { ... } from "${importPath}"` } : {}),
    warnings,
  };
}

const PLACED_KEY_CTRL_KEYS = new Set([
  "t",
  "at",
  "rot",
  "scale",
  "visible",
  "ease",
  "clip",
  "rate",
]);
const PLACE_CTRL_KEYS = new Set([
  "name",
  "at",
  "rot",
  "scale",
  "visible",
  "ease",
  "properties",
  "clip",
  "rate",
  "keyClip",
  "keyRate",
]);
const EDIT_CTRL_KEYS = new Set([...PLACE_CTRL_KEYS, "keys", "removeKey"]);

function isValidEase(v) {
  if (typeof v === "string") return v.length > 0;
  return (
    Array.isArray(v) &&
    v.length === 4 &&
    v.every((n) => typeof n === "number" && Number.isFinite(n)) &&
    v[0] >= 0 &&
    v[0] <= 1 &&
    v[2] >= 0 &&
    v[2] <= 1
  );
}

function applyKeyPatch(target, props) {
  if (props.at !== undefined) target.at = props.at;
  if (props.rot !== undefined) target.rot = props.rot;
  if (props.scale !== undefined) target.scale = props.scale;
  if (props.visible !== undefined) target.visible = props.visible;
  if (props.ease !== undefined) target.ease = props.ease;
  if (props.keyClip !== undefined) target.clip = props.keyClip;
  if (props.keyRate !== undefined) target.rate = props.keyRate;
}

function validateKeyControls(k, prefix = "") {
  const label = prefix ? `${prefix}.` : "";
  if (k.at !== undefined) {
    if (!Array.isArray(k.at) || k.at.length !== 3 || !k.at.every(Number.isFinite)) {
      throw new AssetUsageError(`${label}at must be [x, y, z] finite numbers`, 2);
    }
  }
  if (k.rot !== undefined) {
    if (!Array.isArray(k.rot) || k.rot.length !== 3 || !k.rot.every(Number.isFinite)) {
      throw new AssetUsageError(`${label}rot must be [rx, ry, rz] finite degrees`, 2);
    }
  }
  if (k.scale !== undefined) {
    if (typeof k.scale !== "number" || !Number.isFinite(k.scale) || k.scale <= 0) {
      throw new AssetUsageError(`${label}scale must be a positive finite number`, 2);
    }
  }
  if (k.visible !== undefined && typeof k.visible !== "boolean") {
    throw new AssetUsageError(`${label}visible must be a boolean`, 2);
  }
  for (const ck of [k.clip, k.keyClip]) {
    if (ck !== undefined && (typeof ck !== "string" || !ck.trim())) {
      throw new AssetUsageError(`${label}clip must be a non-empty string`, 2);
    }
  }
  if (k.ease !== undefined && !isValidEase(k.ease)) {
    throw new AssetUsageError(
      `${label}ease must be a non-empty name or [x1, y1, x2, y2] with x1/x2 in 0..1`,
      2,
    );
  }
  for (const rk of [k.rate, k.keyRate]) {
    if (rk !== undefined && (typeof rk !== "number" || !Number.isFinite(rk) || rk < 0)) {
      throw new AssetUsageError(`${label}rate must be a non-negative finite number`, 2);
    }
  }
}

function validatePlacedKindProps(what, props) {
  if (!props || typeof props !== "object") return;
  const hasKeyMobFields =
    Array.isArray(props.keys) &&
    props.keys.some((k) => k && (k.clip !== undefined || k.rate !== undefined));
  if (
    !what.startsWith("mob:") &&
    (props.clip !== undefined ||
      props.rate !== undefined ||
      props.keyClip !== undefined ||
      props.keyRate !== undefined ||
      hasKeyMobFields)
  ) {
    throw new AssetUsageError("clip, rate, keyClip, and keyRate apply only to mob:<id> objects", 2);
  }
  if (!what.startsWith("block:") && props.properties !== undefined) {
    throw new AssetUsageError("properties applies only to block:<ns>:<id> objects", 2);
  }
}

function validatePlacedProps(props, allowEdit = false) {
  if (!props || typeof props !== "object" || Array.isArray(props)) {
    throw new AssetUsageError("--props must be a JSON object", 2);
  }
  const allowed = allowEdit ? EDIT_CTRL_KEYS : PLACE_CTRL_KEYS;
  const unknown = Object.keys(props).filter((k) => !allowed.has(k));
  if (unknown.length) {
    throw new AssetUsageError(
      `Unknown placed control key(s): ${unknown.join(", ")} (allowed: ${[...allowed].join(", ")})`,
      2,
    );
  }
  if (props.name !== undefined && (typeof props.name !== "string" || !props.name.trim())) {
    throw new AssetUsageError("name must be a non-empty string", 2);
  }
  validateKeyControls(props);
  if (props.properties !== undefined) {
    const validVal = (v) =>
      typeof v === "string" ||
      typeof v === "boolean" ||
      (typeof v === "number" && Number.isFinite(v));
    if (
      !props.properties ||
      typeof props.properties !== "object" ||
      Array.isArray(props.properties) ||
      Object.values(props.properties).some((v) => !validVal(v))
    ) {
      throw new AssetUsageError(
        "properties must be an object mapping property names to strings, numbers, or booleans",
        2,
      );
    }
  }
  if (props.removeKey !== undefined && typeof props.removeKey !== "boolean") {
    throw new AssetUsageError("removeKey must be a boolean", 2);
  }
  if (props.removeKey === true && Object.keys(props).some((k) => k !== "removeKey")) {
    throw new AssetUsageError("removeKey cannot be combined with other controls", 2);
  }
  if (props.keys !== undefined) {
    const singleKeyConflicts = ["at", "rot", "scale", "visible", "ease", "keyClip", "keyRate"];
    if (singleKeyConflicts.some((k) => props[k] !== undefined)) {
      throw new AssetUsageError(
        "props.keys replaces all keyframes and cannot be combined with single-key fields",
        2,
      );
    }
    if (!Array.isArray(props.keys) || !props.keys.length) {
      throw new AssetUsageError("keys must be a non-empty array of keyframes", 2);
    }
    props.keys.forEach((k, idx) => {
      if (!k || typeof k !== "object" || Array.isArray(k)) {
        throw new AssetUsageError(`keys[${idx}] must be an object`, 2);
      }
      const badKeys = Object.keys(k).filter((key) => !PLACED_KEY_CTRL_KEYS.has(key));
      if (badKeys.length) {
        throw new AssetUsageError(`keys[${idx}] has unknown field(s): ${badKeys.join(", ")}`, 2);
      }
      if (typeof k.t !== "number" || !Number.isFinite(k.t) || k.t < 0) {
        throw new AssetUsageError(`keys[${idx}].t must be a finite non-negative number`, 2);
      }
      if (idx > 0 && k.t < props.keys[idx - 1].t) {
        throw new AssetUsageError("props.keys must be in non-decreasing time order", 2);
      }
      if (k.at === undefined) {
        throw new AssetUsageError(`keys[${idx}].at must be [x, y, z] finite numbers`, 2);
      }
      validateKeyControls(k, `keys[${idx}]`);
    });
  }
}

function validateMobClips(mob, clipValues) {
  const validClips = new Set((mob.clips ?? []).map((c) => c.name));
  for (const c of clipValues.filter((x) => x !== undefined && x !== "none")) {
    if (!validClips.has(c)) {
      throw new AssetUsageError(
        `Mob "${mob.name}" has no clip "${c}" (available: ${[...validClips].join(", ") || "none"})`,
        1,
      );
    }
  }
}

export async function placeObject(
  project,
  conf,
  {
    id: rawId,
    kind,
    from,
    to,
    duration,
    source,
    noPick = false,
    force = false,
    props = {},
    options = {},
  },
) {
  const vaultRoot = resolvedVaultRoot();
  let id = rawId;
  if (kind === "block" && /^[^:]+:[^:]+$/.test(id)) id = `block:${id}`;
  if (!id.includes(":") && kind) {
    const lk = kind.toLowerCase();
    if (lk === "mob") id = `mob:${id}`;
    else if (lk === "prop") {
      throw new AssetUsageError(`Prefix global props as prop:global:${id}`, 2);
    } else if (lk === "item") {
      throw new AssetUsageError(
        `Items attach in src/scene.ts, not placed.json. Pick first: bun run asset pick item:<ns>:${id} --film films/<name>`,
        2,
      );
    } else if (lk === "block") {
      const cat = loadMcAssetsCatalog({ vaultRoot, quiet: true });
      const hits = cat.items.filter(
        (x) =>
          x.kind === "block" &&
          x.name === id &&
          (source ? matchSourceFilter(x, source) : x.type !== "resourcepack"),
      );
      if (hits.length === 1) id = hits[0].id;
      else if (hits.length > 1) {
        const packSources = hits.some((h) => h.pack)
          ? [...new Set(hits.filter((h) => h.pack).map((h) => h.pack))].slice(0, 4)
          : [];
        const srcHint = packSources.length
          ? ` with --source <pack> (${packSources.join(", ")})`
          : "";
        throw new AssetUsageError(
          `Ambiguous block "${id}" (${hits
            .map((h) => h.id)
            .slice(0, 6)
            .join(", ")}); specify ${hits[0].id}${srcHint}`,
          2,
        );
      } else {
        throw new AssetUsageError(
          `Unknown block "${id}"${source ? ` under --source ${source}` : ""}`,
          1,
        );
      }
    }
  }
  if (/^item:/i.test(id)) {
    throw new AssetUsageError(
      `Items attach in src/scene.ts, not placed.json. Pick it first: bun run asset pick ${id} --film films/<name>`,
      2,
    );
  }
  if (/^prop:film:/i.test(id)) {
    throw new AssetUsageError(
      `${id} is already inside this film's src/props/; import it in src/scene.ts`,
      2,
    );
  }
  const mGlobal = /^prop:global:(.+)$/i.exec(id);
  if (mGlobal) {
    if (
      from !== undefined ||
      to !== undefined ||
      source !== undefined ||
      noPick ||
      Object.keys(props).length > 0
    ) {
      throw new AssetUsageError(
        "prop:global:<id> only copies files into src/props/; only --force applies (not --from, --to, --source, --no-pick, or --props)",
        2,
      );
    }
    return copyGlobalProp(project, mGlobal[1], vaultRoot, force);
  }
  if (to !== undefined) {
    throw new AssetUsageError(
      "placed objects use keyframe time --from <heard s> (pass keys in asset edit after placing), not --to",
      2,
    );
  }
  if (force) throw new AssetUsageError("--force applies only to prop:global:<id>");
  const atFrom = from ?? 0;
  if (typeof atFrom !== "number" || !Number.isFinite(atFrom) || atFrom < 0) {
    throw new AssetUsageError("--from must be a finite non-negative number", 2);
  }

  validatePlacedProps(props, false);
  let what = id;
  let pickGroup;
  let refreshPicks = false;
  let selectedJar;
  const warnings = [];
  if (!Object.values(conf?.keyFiles ?? {}).includes("placed")) {
    warnings.push(
      'package.json "live-studio".keyFiles does not map "placed" yet; add {"src/timeline/placed.json": "placed"} so Studio loads placed objects',
    );
  }
  if (/^mob:/i.test(id)) {
    if (noPick) throw new AssetUsageError("--no-pick applies only to blocks");
    const mobName = id.slice(4);
    const mobs = scanVaultMobs(vaultRoot);
    const mob = mobs.find((m) => m.name === mobName && matchSourceFilter(m, source));
    if (!mob)
      throw new AssetUsageError(
        `Unknown mob "${id}"${source ? ` under --source ${source}` : " in vault mcasset/1.21.11"}`,
        1,
      );
    validateMobClips(mob, [props.clip, props.keyClip]);
    what = `mob:${mobName}`;
  } else if (/^block:/i.test(id)) {
    const parts = id.split(":");
    if (parts.length < 3) throw new AssetUsageError(`Expected block:<ns>:<id> (got "${id}")`, 2);
    const ns = parts[1];
    const blockName = parts.slice(2).join(":");
    what = `block:${ns}:${blockName}`;
    if (ns === "gohans") {
      const hit = scanGohansPack().find(
        (g) => g.name === blockName && matchSourceFilter(g, source),
      );
      if (!hit) {
        throw new AssetUsageError(`Unknown built-in gohans block "${what}"`, 1);
      }
      if (props.properties)
        warnings.push(...blockPropertyWarnings(props.properties, hit.props ?? {}));
    } else {
      const cat = loadMcAssetsCatalog({ vaultRoot, quiet: true });
      const resolved = cat.items.filter(
        (x) =>
          x.kind === "block" &&
          x.namespace === ns &&
          x.name === blockName &&
          (!source || matchSourceFilter(x, source)),
      );
      if (!resolved.length) {
        throw new AssetUsageError(
          `Unknown block "${what}"${source ? ` under --source ${source}` : ""}`,
          1,
        );
      }
      const picks = readPicksJson(project);
      const current = findPick(picks, "block", ns, blockName);
      const active = current && resolved.find((hit) => hit.pack === current.jar);
      const vanilla = !source && resolved.find((hit) => hit.type === "vanilla");
      const candidates =
        !source && ns === "minecraft"
          ? resolved.filter((hit) => hit.type !== "resourcepack")
          : resolved;
      const hit = active || vanilla || (candidates.length === 1 ? candidates[0] : undefined);
      if (!hit && !noPick) {
        const eligible = candidates.length ? candidates : resolved;
        throw new AssetUsageError(
          `Choose --source <pack> for ${what} (${eligible.map((entry) => entry.pack ?? entry.source).join(", ")})`,
        );
      }
      if (!noPick && hit) assertPickSource(current, hit);
      selectedJar = hit?.pack;
      if (hit?.renderable === false) {
        warnings.push(
          `"${what}" is marked non-renderable (${hit.brokenReason ?? "unknown loader or missing files"}); verify visually with bun run render stills`,
        );
      }
      if (hit?.renderable && props.properties) {
        warnings.push(...blockPropertyWarnings(props.properties, hit.props ?? {}));
      }
      if (!noPick && hit?.pack && !current) {
        pickGroup = {
          jar: hit.pack,
          namespace: ns,
          blocks: [blockName],
          licence: hit.license,
          page: hit.url,
        };
      }
      refreshPicks = !noPick && Boolean(active) && pickedZipState(project, picks).stale;
    }
  } else {
    throw new AssetUsageError(
      `Unsupported placed asset "${id}" (expected block:<ns>:<id>, mob:<id>, or prop:global:<id>)`,
      2,
    );
  }

  validatePlacedKindProps(what, props);
  const doc = await readPlacedDoc(project, conf);
  const data = structuredClone(doc.data);
  const baseName =
    typeof props.name === "string" && props.name.trim()
      ? props.name.trim()
      : what.split(":").at(-1).replaceAll("/", "_");
  assertAllowedObjectName(baseName);
  if (props.name !== undefined && hasOwn(data, baseName)) {
    throw new AssetUsageError(
      `Placed object "${baseName}" already exists; use asset edit placed:${baseName}`,
      1,
    );
  }
  let name = baseName;
  let n = 2;
  while (hasOwn(data, name)) {
    name = `${baseName}_${n++}`;
  }

  const maxT = Object.values(data).reduce(
    (hi, o) => Math.max(hi, ...(o.keys ?? []).map((k) => k.t ?? 0)),
    atFrom,
  );
  const clock = getPictureClock(
    project,
    conf,
    maxT,
    duration !== undefined ? { ...options, duration } : options,
  );
  const sceneT = r3(clock.sourceAt(atFrom, "after"));
  const key = {
    t: sceneT,
    at: props.at ?? [0, 0, 0],
    rot: props.rot ?? [0, 0, 0],
    scale: props.scale ?? 1,
    ...(props.visible !== undefined && { visible: Boolean(props.visible) }),
    ...(props.ease !== undefined && { ease: props.ease }),
    ...(props.keyClip !== undefined && { clip: props.keyClip }),
    ...(props.keyRate !== undefined && { rate: props.keyRate }),
  };
  const object = {
    what,
    ...(props.properties !== undefined && { properties: props.properties }),
    ...(props.clip !== undefined && { clip: props.clip }),
    ...(props.rate !== undefined && { rate: props.rate }),
    keys: [key],
  };
  data[name] = object;
  const heardData = mapPlacedToHeard(data, clock);
  const staged =
    pickGroup || refreshPicks
      ? preparePicksBatch(project, pickGroup ? [pickGroup] : [], {
          vaultDir: join(vaultRoot, "packs"),
          vanillaJar: join(vaultRoot, "jar/client_assets.zip"),
          quiet: true,
          strictJars: selectedJar ? [selectedJar] : [],
        })
      : null;
  let saved;
  let picked;
  try {
    saved = await writePlacedDoc(project, doc, data);
    picked = staged?.commit();
  } finally {
    staged?.discard();
  }
  return {
    ...saved,
    data: heardData,
    target: `placed:${name}`,
    name,
    object: heardData[name],
    ...(picked && { picked: { added: picked.added, built: picked.built } }),
    ...(warnings.length && { warnings }),
  };
}

export async function editPlacedObject(
  project,
  conf,
  name,
  { from, to, duration, props = {}, remove = false, options = {} },
) {
  if (to !== undefined) {
    throw new AssetUsageError("placed objects use keyframe time --from <heard s> (not --to)", 2);
  }
  const doc = await readPlacedDoc(project, conf);
  if (!hasOwn(doc.data, name)) {
    throw new AssetUsageError(`No placed object "${name}" in ${doc.rel}`, 1);
  }
  const data = structuredClone(doc.data);
  const obj = data[name];
  const maxT = Object.values(data).reduce(
    (hi, o) => Math.max(hi, ...(o.keys ?? []).map((k) => k.t ?? 0)),
    from ?? 0,
  );
  const clock = getPictureClock(
    project,
    conf,
    maxT,
    duration !== undefined ? { ...options, duration } : options,
  );
  if (remove) {
    delete data[name];
    const saved = await writePlacedDoc(project, doc, data);
    return { ...saved, removed: `placed:${name}`, data: mapPlacedToHeard(data, clock) };
  }

  if (from !== undefined && (typeof from !== "number" || !Number.isFinite(from) || from < 0)) {
    throw new AssetUsageError("--from must be a finite non-negative number", 2);
  }
  validatePlacedProps(props, true);
  validatePlacedKindProps(obj.what ?? "", props);
  if (props.removeKey === true && from === undefined) {
    throw new AssetUsageError("removeKey requires --from <heard s>", 2);
  }
  if (from !== undefined && props.keys !== undefined) {
    throw new AssetUsageError("--from cannot be combined with props.keys", 2);
  }

  if (obj.what.startsWith("mob:")) {
    const keyClips = Array.isArray(props.keys) ? props.keys.map((k) => k.clip) : [];
    const askedClips = [props.clip, props.keyClip, ...keyClips];
    if (askedClips.some((c) => c !== undefined)) {
      const mobName = obj.what.slice(4);
      const mob = scanVaultMobs(resolvedVaultRoot()).find((m) => m.name === mobName);
      if (mob) validateMobClips(mob, askedClips);
    }
  }

  if (from !== undefined) {
    const sceneT = r3(clock.sourceAt(from, "after"));
    const ks = obj.keys;
    const near = ks.findIndex((k) => Math.abs(k.t - sceneT) < KEY_SNAP);
    if (props.removeKey === true) {
      if (near < 0) {
        throw new AssetUsageError(
          `No keyframe near ${from} s heard (${sceneT} s scene) on placed:${name}`,
          1,
        );
      }
      if (ks.length <= 1) {
        throw new AssetUsageError(
          `Cannot remove the last keyframe of placed:${name}; use bun run asset remove placed:${name}`,
          1,
        );
      }
      ks.splice(near, 1);
    } else if (near >= 0) {
      applyKeyPatch(ks[near], props);
    } else {
      const i = ks.findIndex((k) => k.t > sceneT);
      const at = i < 0 ? ks.length : i;
      const fresh = { ...structuredClone(ks[Math.max(0, at - 1)]), t: sceneT };
      delete fresh.visible;
      delete fresh.clip;
      delete fresh.rate;
      applyKeyPatch(fresh, props);
      ks.splice(at, 0, fresh);
    }
  } else {
    const keyFields = ["at", "rot", "scale", "visible", "ease", "keyClip", "keyRate"];
    const hasKeyFields = keyFields.some((f) => props[f] !== undefined);
    if (hasKeyFields) {
      if (obj.keys.length > 1) {
        throw new AssetUsageError(
          `Object "${name}" has ${obj.keys.length} keyframes; pass --from <heard s> to edit or add a keyframe`,
          2,
        );
      }
      applyKeyPatch(obj.keys[0], props);
    }
    if (Array.isArray(props.keys)) {
      obj.keys = props.keys.map((k) => ({
        ...k,
        t: r3(clock.sourceAt(k.t, "after")),
      }));
    }
  }
  if (props.properties !== undefined) obj.properties = props.properties;
  if (props.clip !== undefined) obj.clip = props.clip;
  if (props.rate !== undefined) obj.rate = props.rate;

  let outName = name;
  if (typeof props.name === "string" && props.name.trim() && props.name.trim() !== name) {
    const nextName = props.name.trim();
    assertAllowedObjectName(nextName);
    if (hasOwn(data, nextName)) {
      throw new AssetUsageError(`Placed object "${nextName}" already exists`, 1);
    }
    const entries = Object.entries(data);
    for (const k of Object.keys(data)) delete data[k];
    for (const [k, v] of entries) data[k === name ? nextName : k] = v;
    outName = nextName;
  }

  const saved = await writePlacedDoc(project, doc, data);
  return {
    ...saved,
    target: `placed:${outName}`,
    data: mapPlacedToHeard(data, clock),
  };
}
