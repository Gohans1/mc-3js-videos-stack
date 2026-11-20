import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

import { cliArgs, needFilm } from "./src/cli.mjs";

const BUILTIN_DOCS = [
  "sound",
  "cam",
  "lights",
  "shots",
  "text",
  "adjustment",
  "timing",
  "openfilm",
];
const BUILTIN_SET = new Set(BUILTIN_DOCS);

const HELP = `Read and update a Studio document without undoing the creator's edits. Studio must be running.
  bun run collab [--film films/name] read cam [--full]            current version, data, protected paths and lean notices (--full keeps raw incoming)
  bun run collab [--film films/name] write cam <file|-> [--quiet] JSON payload {"base":"version from read","data":...} (--quiet/-q prints compact summary)
  bun run collab [--film films/name] write-many <file|-> [-q]     atomic multi-file write via /api/together: {"writes":{"cam":{"base":"...","data":...},...}}
--film is optional inside a film folder; pass - with write or write-many to read the JSON payload from stdin.
Use bun run --silent collab read cam when piping JSON stdout (omits Bun's script banner).
Names: sound, cam, lights, shots, text, adjustment, timing, openfilm, keys/0, or a package.json keyFiles edit name (e.g. cast, placed, steve).
Direct filesystem writes cannot acknowledge protected units. Cam and shots merge by stable row ID.
Keep existing IDs when editing or moving rows. Use a new ID for each new row.
The notices preserve full rejected input in .studio/collaboration/notices.jsonl; read strips incoming by default unless --full is passed.`;

const usageFail = (message) => {
  console.error(`collab: ${message}`);
  process.exit(2);
};

const canonical = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

const sameDir = (a, b) => {
  const ca = canonical(a),
    cb = canonical(b);
  return process.platform === "win32" ? ca.toLowerCase() === cb.toLowerCase() : ca === cb;
};

const loadKeyFiles = (project) => {
  const pkgPath = join(project, "package.json");
  if (!existsSync(pkgPath)) return [];
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const entries = pkg?.["live-studio"]?.keyFiles;
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) return [];
    return Object.entries(entries).map(([rel, edit], index) => ({
      index,
      rel,
      edit: typeof edit === "string" ? edit : "",
    }));
  } catch {
    return [];
  }
};

const describeAvailable = (keyFiles) => {
  const editCounts = new Map();
  for (const k of keyFiles) if (k.edit) editCounts.set(k.edit, (editCounts.get(k.edit) ?? 0) + 1);
  return [
    ...BUILTIN_DOCS,
    ...keyFiles.map((k) =>
      k.edit && !BUILTIN_SET.has(k.edit) && editCounts.get(k.edit) === 1
        ? `${k.edit} (keys/${k.index})`
        : `keys/${k.index}`,
    ),
  ].join(", ");
};

const resolveDoc = (rawName, keyFiles) => {
  if (typeof rawName !== "string" || !rawName) {
    return {
      ok: false,
      error: `unknown document ${JSON.stringify(rawName ?? "")}. Available: ${describeAvailable(keyFiles)}`,
    };
  }
  if (BUILTIN_SET.has(rawName)) return { ok: true, canonical: rawName, wire: rawName };
  if (/^keys\/(?:0|[1-9]\d*)$/.test(rawName)) {
    const index = Number(rawName.slice(5));
    if (index >= 0 && index < keyFiles.length)
      return { ok: true, canonical: rawName, wire: rawName };
    return {
      ok: false,
      error: `unknown document "${rawName}" (film has ${keyFiles.length} keyFile${keyFiles.length === 1 ? "" : "s"}). Available: ${describeAvailable(keyFiles)}`,
    };
  }
  const matches = keyFiles.filter((k) => k.edit && k.edit === rawName);
  if (matches.length === 1)
    return { ok: true, canonical: `keys/${matches[0].index}`, wire: rawName };
  if (matches.length > 1) {
    return {
      ok: false,
      error: `ambiguous document "${rawName}" (matches ${matches.map((m) => `keys/${m.index}`).join(", ")}); use keys/<index> instead. Available: ${describeAvailable(keyFiles)}`,
    };
  }
  return {
    ok: false,
    error: `unknown document "${rawName}". Available: ${describeAvailable(keyFiles)}`,
  };
};

const readInputText = (input) =>
  input === "-" ? readFileSync(0, "utf8") : readFileSync(resolve(input), "utf8");

const parseWriteMany = (rawText, keyFiles) => {
  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch (error) {
    usageFail(`write-many payload is not valid JSON: ${error.message}`);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    usageFail(
      'write-many expects {"writes":{"cam":{"base":"...","data":...},...}} or {"files":[...]}',
    );
  }
  let entries;
  if (Array.isArray(payload.files)) {
    entries = payload.files.map((f) => ({ key: f?.name, base: f?.base, data: f?.data }));
  } else if (
    payload.writes &&
    typeof payload.writes === "object" &&
    !Array.isArray(payload.writes)
  ) {
    entries = Object.entries(payload.writes).map(([key, entry]) => ({
      key,
      base: entry?.base,
      data: entry?.data,
    }));
  } else {
    usageFail(
      'write-many expects {"writes":{"cam":{"base":"...","data":...},...}} or {"files":[...]}',
    );
  }
  if (!entries.length) usageFail("write-many needs at least one document");
  const seenTargets = new Set();
  return entries.map((entry) => {
    if (typeof entry.key !== "string" || !entry.key)
      usageFail("each write-many entry needs a document name");
    if (typeof entry.base !== "string" || entry.data === undefined)
      usageFail(`write-many entry "${entry.key}" needs string "base" and "data"`);
    const resolved = resolveDoc(entry.key, keyFiles);
    if (!resolved.ok) usageFail(resolved.error);
    if (seenTargets.has(resolved.canonical))
      usageFail(`duplicate target "${resolved.canonical}" in write-many`);
    seenTargets.add(resolved.canonical);
    return { key: entry.key, wire: resolved.wire, base: entry.base, data: entry.data };
  });
};

const argv = cliArgs(HELP, ["--film PATH", "--full", "--quiet", "-q"], 3);
let projectArg = process.env.LIVE_PROJECT ?? process.cwd();
let full = false;
let quiet = false;
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--film") projectArg = argv[++i];
  else if (a === "--full") full = true;
  else if (a === "--quiet" || a === "-q") quiet = true;
  else pos.push(a);
}

const [action, arg1, arg2] = pos;
const validRead = action === "read" && pos.length === 2;
const validWrite = action === "write" && pos.length === 3;
const validWriteMany = action === "write-many" && pos.length === 2;
if (!validRead && !validWrite && !validWriteMany) {
  console.error(HELP);
  process.exit(2);
}
if (full && action !== "read") usageFail("--full is only supported with read");
if (quiet && action === "read") usageFail("--quiet/-q is only supported with write and write-many");

const project = resolve(needFilm(projectArg, { warnProtected: false }));
const keyFiles = loadKeyFiles(project);

let targetDoc = null;
let docLabel = null;
if (action === "read" || action === "write") {
  docLabel = arg1;
  const resolved = resolveDoc(arg1, keyFiles);
  if (!resolved.ok) usageFail(resolved.error);
  targetDoc = resolved.wire;
}

let writeBody;
let manyPlan = null;
try {
  if (action === "write") writeBody = readInputText(arg2);
  else if (action === "write-many") manyPlan = parseWriteMany(readInputText(arg1), keyFiles);
} catch (error) {
  console.error(`collab: ${error.message}`);
  process.exit(1);
}

try {
  const info = JSON.parse(readFileSync(join(project, "renders/live/studio.json"), "utf8"));
  if (
    !sameDir(info.project, project) ||
    !Number.isInteger(info.port) ||
    info.port < 1 ||
    info.port > 65535
  )
    throw new Error("Studio belongs to another film; start this film's Studio");

  if (action === "write-many") {
    const response = await fetch(`http://127.0.0.1:${info.port}/api/together`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor: "agent",
        files: manyPlan.map(({ wire, base, data }) => ({ name: wire, base, data })),
      }),
      signal: AbortSignal.timeout(10000),
    });
    const text = await response.text();
    if (!response.ok) {
      if (text) console.log(text);
      else console.error(`collab: HTTP ${response.status} for write-many`);
      process.exitCode = 1;
    } else {
      const parsed = JSON.parse(text);
      const versions = Object.fromEntries(
        manyPlan.map(({ key, wire }) => [key, parsed.versions?.[wire]]),
      );
      if (quiet) {
        console.log(JSON.stringify({ ok: true, versions, retained: parsed.retained ?? [] }));
      } else {
        const files = Object.fromEntries(
          manyPlan.map(({ key, wire }) => [key, parsed.files?.[wire]]),
        );
        console.log(JSON.stringify({ ...parsed, versions, files }));
      }
    }
  } else {
    const encoded = targetDoc.split("/").map(encodeURIComponent).join("/");
    const url =
      action === "read"
        ? `http://127.0.0.1:${info.port}/api/collaboration/${encoded}?full=${full ? "1" : "0"}`
        : `http://127.0.0.1:${info.port}/api/collaboration/${encoded}`;
    const response = await fetch(url, {
      ...(action === "write"
        ? {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: writeBody,
          }
        : {}),
      signal: AbortSignal.timeout(10000),
    });
    const text = await response.text();
    if (!response.ok) {
      if (text) console.log(text);
      else console.error(`collab: HTTP ${response.status} for ${docLabel}`);
      process.exitCode = 1;
    } else if (action === "write" && quiet) {
      const parsed = JSON.parse(text);
      console.log(
        JSON.stringify({
          ok: true,
          doc: docLabel,
          version: parsed.version,
          retained: parsed.retained ?? [],
        }),
      );
    } else {
      console.log(text);
    }
  }
} catch (error) {
  console.error(`collab: ${error.message}`);
  process.exitCode = 1;
}
