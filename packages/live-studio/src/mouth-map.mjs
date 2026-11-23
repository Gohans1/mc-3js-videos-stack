import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertInsideDir, planVoicePlacements, takeAudios, writeAtomicSync } from "./voice-map.mjs";

export const MOUTH_MAP = "src/timeline/mouth.json";
export const mouthFileOf = (audio) => `${audio}.mouth.json`;

const isSymbolicLink = (file) => {
  try {
    return lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
};

const isCue = (c) =>
  Array.isArray(c) &&
  typeof c[0] === "number" &&
  Number.isFinite(c[0]) &&
  c[0] >= 0 &&
  typeof c[1] === "string" &&
  /^[A-HX]$/.test(c[1]);

const isCueList = (cues) =>
  Array.isArray(cues) &&
  cues.length > 0 &&
  cues.every((c, i) => isCue(c) && (i === 0 || c[0] >= cues[i - 1][0]));

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

const readMouthCues = (shapes) => {
  if (!existsSync(shapes) || isSymbolicLink(shapes)) return null;
  const parsed = readJson(shapes);
  const cues = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed.cues : null;
  return isCueList(cues) ? cues : null;
};

const writeAtomic = (file, data, baseDir = null) => {
  const target = baseDir ? assertInsideDir(baseDir, file, "Mouth file") : file;
  if (isSymbolicLink(target)) {
    throw new Error(`Mouth file cannot traverse symlink or junction: "${file}"`);
  }
  writeAtomicSync(target, data);
};

export const speakingTakes = (film) => {
  const root = resolve(film);
  let editFile;
  try {
    editFile = assertInsideDir(root, "src/edit.json", "src/edit.json");
  } catch {
    return [];
  }
  const takes = readJson(editFile)?.takes;
  const byId = new Map((Array.isArray(takes) ? takes : []).map((k) => [k?.id, k]));
  return takeAudios(root).flatMap(({ id, audio }) => {
    const k = byId.get(id);
    if (typeof k?.by !== "string" || !k.by) return [];
    const shapes = mouthFileOf(audio);
    const cues = readMouthCues(shapes);
    let fresh = false;
    if (cues) {
      try {
        fresh = statSync(shapes).mtimeMs >= statSync(audio).mtimeMs;
      } catch {
        fresh = false;
      }
    }
    return [{ id, by: k.by, text: k.text, language: k.language, audio, shapes, fresh }];
  });
};

const mapOf = (film) => {
  const has = new Map(speakingTakes(film).map((k) => [k.id, k]));
  const takes = planVoicePlacements(film).flatMap((p) => {
    const k = has.get(p.id);
    const cues = k ? readMouthCues(k.shapes) : null;
    return cues ? [{ id: p.id, at: p.start, cues }] : [];
  });
  return { takes };
};

export const writeMouthMap = (film) => {
  const map = mapOf(film);
  writeAtomic(join(film, MOUTH_MAP), `${JSON.stringify(map)}\n`, film);
  return map;
};

export const mouthFaults = (film) => {
  const said = speakingTakes(film);
  const faults = said.flatMap((k) =>
    !existsSync(k.shapes) && !isSymbolicLink(k.shapes)
      ? [
          `✖ take "${k.id}" (by ${k.by}) has no mouth shapes, so ${k.by}'s mouth stays shut while it plays: bun run voice:lips`,
        ]
      : !readMouthCues(k.shapes)
        ? [
            `✖ take "${k.id}" (by ${k.by}): ${relative(film, k.shapes).replaceAll("\\", "/")} holds no cues (not JSON, or no "cues" list), so ${k.by}'s mouth stays shut: bun run voice:lips makes them again`,
          ]
        : !k.fresh
          ? [
              `✖ take "${k.id}" (by ${k.by}): its audio changed after its mouth shapes were made: bun run voice:lips`,
            ]
          : [],
  );
  if (faults.length || !said.length) return faults;
  const mapFile = join(film, MOUTH_MAP);
  const now = !isSymbolicLink(mapFile) ? readJson(mapFile) : null;
  if (JSON.stringify(now?.takes) !== JSON.stringify(mapOf(film).takes))
    faults.push(
      `✖ ${MOUTH_MAP} is behind the takes (one moved, was added or got new shapes): bun run voice:lips rewrites it in a moment`,
    );
  return faults;
};

export const rhubarbPath = () => {
  if (process.env.RHUBARB) return process.env.RHUBARB;
  const tools = fileURLToPath(new URL("../../../vault/tools/", import.meta.url));
  const exe = process.platform === "win32" ? "rhubarb.exe" : "rhubarb";
  const dir = existsSync(tools)
    ? readdirSync(tools)
        .filter((d) => d.startsWith("Rhubarb-Lip-Sync") && existsSync(join(tools, d, exe)))
        .sort()
        .at(-1)
    : undefined;
  return join(tools, dir ?? "Rhubarb-Lip-Sync-1.14.0-Windows", exe);
};

export const shapeTake = (take, line, rhubarb = rhubarbPath()) => {
  const tmp = mkdtempSync(join(tmpdir(), "lips-"));
  try {
    const wav = join(tmp, "take.wav"),
      out = join(tmp, "cues.json"),
      dialog = join(tmp, "line.txt");
    const ff = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", take.audio, "-ac", "1", wav], {
      encoding: "utf8",
      timeout: 120_000,
    });
    if (ff.error || ff.status !== 0) {
      const why = ff.error ? ff.error.message : ff.stderr?.trim() || `exit ${ff.status}`;
      throw new Error(`ffmpeg could not read ${take.audio}: ${why}`);
    }
    if (line) writeFileSync(dialog, line);
    const english = !take.language || /^en\b/i.test(take.language);
    const run = spawnSync(
      rhubarb,
      [
        "--quiet",
        "-r",
        english ? "pocketSphinx" : "phonetic",
        "-f",
        "json",
        ...(line ? ["-d", dialog] : []),
        "-o",
        out,
        wav,
      ],
      { encoding: "utf8", timeout: 10 * 60_000 },
    );
    if (run.error || run.status !== 0 || !existsSync(out)) {
      const why = run.error
        ? `did not finish (${run.error.message})`
        : run.status !== 0
          ? `failed: ${run.stderr?.trim() || `exit ${run.status}`}`
          : "wrote no output file";
      throw new Error(`Rhubarb ${why}`);
    }
    const parsed = readJson(out);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.mouthCues)) {
      throw new Error(`Rhubarb produced invalid output JSON for ${take.id ?? take.audio}`);
    }
    const cues = parsed.mouthCues.map((c) => [c?.start, c?.value]);
    if (!isCueList(cues)) {
      throw new Error(`Rhubarb produced no usable mouth cues for ${take.id ?? take.audio}`);
    }
    writeAtomic(take.shapes, `${JSON.stringify({ tool: "Rhubarb Lip Sync", line, cues })}\n`);
    return cues;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
};
