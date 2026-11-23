import { accessSync, constants, existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cliArgs } from "../../packages/live-studio/src/cli.mjs";
import {
  defaultVoiceCacheFile,
  sanitizeError,
  syncVoiceCatalog,
} from "../../packages/live-studio/src/voice-library.mjs";

const HELP = `Sync all English voices (including ElevenLabs v4 flags & facets) from GenVoice / ElevenLabs into the local vault cache (vault/voices/shared-en.json). From the repo root:
  bun run setup:voices         download & index English voices into vault/voices/shared-en.json
Uses ElevenLabs when ELEVENLABS_API_KEY is set, otherwise GenVoice via GENVOICE_API_KEY (ELEVENLABS_API_BASE / GENVOICE_API_BASE override endpoints).
Free catalog sync (spends no voice credits); usually finishes in seconds to a minute.
Next: pick a voice in a film's studio (cd films/<name> && bun run studio), or set "voice" in src/edit.json and run bun run voice:gen.`;

cliArgs(HELP, [], 0, process.argv.slice(2));

const cwd = process.cwd();
if (existsSync(join(cwd, "src/scene.ts"))) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const up = relative(cwd, repoRoot).replaceAll("\\", "/") || ".";
  console.error(
    `setup:voices works on the whole repo, not one film: cd ${up} && bun run setup:voices --help first, to see what it does`,
  );
  console.error(`next: cd ${up} && bun run setup:voices`);
  process.exit(2);
}

const findVaultJson = (start: string): string | null => {
  for (let dir = resolve(start), prev = ""; dir !== prev; prev = dir, dir = dirname(dir)) {
    const file = join(dir, "vault.json");
    if (existsSync(file)) return file;
  }
  return null;
};

const vaultFile = findVaultJson(cwd);
if (vaultFile) {
  try {
    const parsed = JSON.parse(readFileSync(vaultFile, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("expected a JSON object");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${vaultFile} is not valid JSON (${msg}): fix vault.json before syncing.`);
    console.error("next: bun run setup:voices");
    process.exit(1);
  }
}

const elevenKey = (process.env.ELEVENLABS_API_KEY ?? "").trim();
const genvoiceKey = (process.env.GENVOICE_API_KEY ?? "").trim();
const provider = elevenKey ? "elevenlabs" : "genvoice";
const keyVar = provider === "elevenlabs" ? "ELEVENLABS_API_KEY" : "GENVOICE_API_KEY";
const baseVar = provider === "elevenlabs" ? "ELEVENLABS_API_BASE" : "GENVOICE_API_BASE";
const apiKey = elevenKey || genvoiceKey;
if (!apiKey) {
  console.error("Missing API key: set GENVOICE_API_KEY (or ELEVENLABS_API_KEY) in environment.");
  console.error("next: set GENVOICE_API_KEY and run bun run setup:voices");
  process.exit(1);
}

const rawBase = (
  provider === "elevenlabs" ? process.env.ELEVENLABS_API_BASE : process.env.GENVOICE_API_BASE
)?.trim();
if (rawBase) {
  let valid = false;
  try {
    const parsed = new URL(rawBase);
    valid = parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    valid = false;
  }
  if (!valid) {
    console.error(`${baseVar} must be a valid http(s) URL, got ${JSON.stringify(rawBase)}.`);
    console.error(`next: fix ${baseVar} and run bun run setup:voices`);
    process.exit(2);
  }
}

const checkWritableTarget = (file: string) => {
  const target = resolve(file);
  if (existsSync(target)) {
    if (statSync(target).isDirectory()) {
      throw new Error(`target path is a directory (${target})`);
    }
    accessSync(target, constants.W_OK);
  }
  for (let cur = dirname(target), prev = ""; cur !== prev; prev = cur, cur = dirname(cur)) {
    const st = lstatSync(cur, { throwIfNoEntry: false });
    if (!st) continue;
    if (!existsSync(cur) || !statSync(cur).isDirectory()) {
      throw new Error(`parent path is not a directory (${cur})`);
    }
    accessSync(cur, constants.W_OK);
    break;
  }
};

const cacheFile = defaultVoiceCacheFile(cwd);
try {
  checkWritableTarget(cacheFile);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(
    `Cannot write voice cache ${cacheFile} (${msg}): check folder permissions or vault.json "root".`,
  );
  console.error("next: fix the cache path and run bun run setup:voices");
  process.exit(1);
}

console.log(`Syncing shared English voices (${provider}) -> ${cacheFile}`);

const cleanEnv: Record<string, string | undefined> = { ...process.env };
if (!cleanEnv.GENVOICE_API_BASE?.trim()) delete cleanEnv.GENVOICE_API_BASE;
if (!cleanEnv.ELEVENLABS_API_BASE?.trim()) delete cleanEnv.ELEVENLABS_API_BASE;

let lastShown = 0;
const started = Date.now();
const FS_ERR_CODES = new Set([
  "EACCES",
  "EPERM",
  "EROFS",
  "EEXIST",
  "ENOTDIR",
  "EISDIR",
  "ENOENT",
  "ENOSPC",
  "EBUSY",
]);

let catalog: Awaited<ReturnType<typeof syncVoiceCatalog>>;
try {
  catalog = await syncVoiceCatalog({
    provider,
    apiKey,
    project: cwd,
    cacheFile,
    env: cleanEnv,
    ...(rawBase ? { apiBase: rawBase } : {}),
    onProgress: (p: {
      pagesLoaded: number;
      totalScanned: number;
      totalEnglish: number;
      totalEnglishV4: number;
    }) => {
      const now = Date.now();
      if (now - lastShown < 5000) return;
      lastShown = now;
      console.log(
        `  pages=${p.pagesLoaded} scanned=${p.totalScanned} en=${p.totalEnglish} v4=${p.totalEnglishV4}`,
      );
    },
  });
} catch (err) {
  const msg = sanitizeError(err, apiKey);
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : "";
  const status =
    err && typeof err === "object" && "status" in err
      ? Number((err as { status?: unknown }).status)
      : undefined;
  if (FS_ERR_CODES.has(code)) {
    console.error(
      `Cannot write voice cache ${cacheFile} (${msg}): check folder permissions or vault.json "root".`,
    );
    console.error("next: fix the cache path and run bun run setup:voices");
  } else if (status === 401 || status === 403 || /\bAPI 40[13]\b/.test(msg)) {
    console.error(`Voice sync failed (${msg}): verify ${keyVar} is valid and active.`);
    console.error(`next: update ${keyVar} and run bun run setup:voices`);
  } else {
    console.error(`Voice sync failed (${msg}).`);
    console.error("next: check your network/endpoint and run bun run setup:voices");
  }
  process.exit(1);
}

const sec = ((Date.now() - started) / 1000).toFixed(1);
console.log(
  `Done in ${sec}s: ${catalog.totalEnglish} English voices (${catalog.totalEnglishV4} ElevenLabs v4) from ${catalog.totalScanned} total scanned -> ${cacheFile}`,
);
if (catalog.truncated) {
  console.error(
    `Voice sync stopped early before upstream exhaustion (page limit or repeating pages); some English voices may be omitted from ${cacheFile}.`,
  );
  console.error("next: check your endpoint/network and run bun run setup:voices again");
  process.exit(1);
}
console.log(
  'next: pick a voice in a film\'s studio (cd films/<name> && bun run studio), or set "voice" in src/edit.json and run bun run voice:gen',
);
