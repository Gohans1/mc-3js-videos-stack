// Lip sync data, on the CLI side: Rhubarb Lip Sync's mouth shapes for each take a character speaks on screen
// (src/edit.json takes[].by) in voice/takes/<take>.mouth.json, and src/timeline/mouth.json gathering them where the voice
// places each take (voice seconds). The scene reads that file through mouthCues (lips.ts).
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { planVoicePlacements, takeAudios } from "./voice-map.mjs";

export const MOUTH_MAP = "src/timeline/mouth.json";
export const mouthFileOf = (audio) => `${audio}.mouth.json`;

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};
const writeAtomic = (file, data) => {
  mkdirSync(dirname(file), { recursive: true });
  const part = `${file}.${process.pid}.part`;
  writeFileSync(part, data);
  renameSync(part, file);
};

// The takes said on screen, with their audio: [{ id, by, text, language, audio, shapes, fresh }]
export const speakingTakes = (film) => {
  const takes = readJson(join(film, "src/edit.json"))?.takes;
  const byId = new Map((Array.isArray(takes) ? takes : []).map((k) => [k?.id, k]));
  return takeAudios(film).flatMap(({ id, audio }) => {
    const k = byId.get(id);
    if (typeof k?.by !== "string" || !k.by) return [];
    const shapes = mouthFileOf(audio);
    const fresh = existsSync(shapes) && statSync(shapes).mtimeMs >= statSync(audio).mtimeMs;
    return [{ id, by: k.by, text: k.text, language: k.language, audio, shapes, fresh }];
  });
};

// The map the scene reads, built from what is on disk now: the voice's own placement of each take (voice-map.mjs)
const mapOf = (film) => {
  const has = new Map(speakingTakes(film).map((k) => [k.id, k]));
  const takes = planVoicePlacements(film).flatMap((p) => {
    const k = has.get(p.id);
    const cues = k && existsSync(k.shapes) ? readJson(k.shapes)?.cues : null;
    return Array.isArray(cues) ? [{ id: p.id, at: p.start, cues }] : [];
  });
  return { takes };
};

export const writeMouthMap = (film) => {
  const map = mapOf(film);
  writeAtomic(join(film, MOUTH_MAP), `${JSON.stringify(map)}\n`);
  return map;
};

export const mouthFaults = (film) => {
  const said = speakingTakes(film);
  const faults = said.flatMap((k) =>
    !existsSync(k.shapes)
      ? [
          `✖ take "${k.id}" (by ${k.by}) has no mouth shapes, so ${k.by}'s mouth stays shut while it plays: bun run voice:lips`,
        ]
      : !k.fresh
        ? [
            `✖ take "${k.id}" (by ${k.by}): its audio changed after its mouth shapes were made: bun run voice:lips`,
          ]
        : // the map skips shapes it cannot read, so a map written from them agrees and says nothing
          !Array.isArray(readJson(k.shapes)?.cues)
          ? [
              `✖ take "${k.id}" (by ${k.by}): ${relative(film, k.shapes).replaceAll("\\", "/")} holds no cues (not JSON, or no "cues" list), so ${k.by}'s mouth stays shut: bun run voice:lips makes them again`,
            ]
          : [],
  );
  if (faults.length || !said.length) return faults;
  const now = readJson(join(film, MOUTH_MAP));
  if (JSON.stringify(now?.takes) !== JSON.stringify(mapOf(film).takes))
    faults.push(
      `✖ ${MOUTH_MAP} is behind the takes (one moved, was added or got new shapes): bun run voice:lips rewrites it in a moment`,
    );
  return faults;
};

// Rhubarb Lip Sync: RHUBARB names its program, else the vault's (vault/tools/Rhubarb-Lip-Sync-<version>-<os>/)
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

// One take: its audio to a mono wav (Rhubarb reads wav and ogg only), line (its words without the voice's [tags]) as the
// dialog file, the cues kept as [[take second, shape], ...]. English is recognised by word (pocketSphinx), any other
// language by sound (phonetic)
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
    if (ff.status !== 0) throw new Error(`ffmpeg could not read ${take.audio}: ${ff.stderr}`);
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
    if (run.status !== 0 || !existsSync(out))
      throw new Error(
        `Rhubarb ${run.error ? `did not finish (${run.error.message})` : `failed: ${run.stderr.trim()}`}`,
      );
    const cues = readJson(out).mouthCues.map((c) => [c.start, c.value]);
    writeAtomic(take.shapes, `${JSON.stringify({ tool: "Rhubarb Lip Sync", line, cues })}\n`);
    return cues;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
};
