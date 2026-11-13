// The film contract checked without a studio; HELP below
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { ANIMS } from "film-stage/animate";
import { TRANSITIONS } from "film-stage/transitions";

import { cliArgs, needFilm } from "./src/cli.mjs";
import { CAM_KEYS, checkFiles, SOUND_KEYS } from "./src/contract.ts";
import { contractFiles, heardLength } from "./src/film.mjs";
import { isRead, readFaults } from "./src/readable.mjs";
import { findVaults, openSound } from "./src/sound.mjs";
import { mapTimeline } from "./src/timing-data.mjs";
import { clockForTimeline } from "./src/timing-state.mjs";

const HELP = `Checks the film's data the way the studio does, without opening it: run it after editing any file in src/timeline,
src/edit.json or package.json "live-studio". Run inside the film.
  bun run check           the problems, each under the file it is in, or "ok"
  bun run check --json    {"ok": bool, "problems": [{"where": file, "issue": text}]}
Checks every timeline file against its schema (src/contract.ts, the studio's own), that every other .json in src/ parses,
and every sound name in the sound timeline (beds, sfx and their "try" options) against the sounds the studio can play,
with the nearest names. Warns (⚠, still exit 0) of on-screen text too brief to read or too small for a phone; where it sits
and how it reads over the picture: CHECK=text bun run render stills.
Not checked here: what src/scene.ts exports and what draw(t) returns (the studio page and bun run render say those).
Exit 0 ok, 1 problems found. Find a sound or preset by meaning: bun run find <words>.`;

const json = cliArgs(HELP, ["--json"], 0).includes("--json");
const PROJECT = needFilm(process.env.LIVE_PROJECT);
// Bun's JSON errors carry no place; python's json says the line and column (python is the mix's own already)
const jsonPlace = (rel) => {
  const r = spawnSync(
    "python",
    ["-c", "import json,sys;json.load(open(sys.argv[1],encoding='utf8'))", join(PROJECT, rel)],
    { encoding: "utf8" },
  );
  return /(line \d+ column \d+)/.exec(r.stderr ?? "")?.[1];
};
// what a file should look like: the template film's own copy is one that works
const TEMPLATE = join(
  dirname(realpathSync(fileURLToPath(import.meta.url))),
  "../../templates/film",
);
// package.json names every other file checked: until it reads, nothing more can be said
const stop = (issue) => {
  if (json)
    console.log(JSON.stringify({ ok: false, problems: [{ where: "package.json", issue }] }));
  else console.error(`package.json\n${issue}`);
  process.exit(1);
};
const pkgFile = join(PROJECT, "package.json");
if (!existsSync(pkgFile))
  stop(
    "✖ missing: it names the film's timeline files. git restore package.json, or bun run new-film",
  );
let conf;
try {
  conf = JSON.parse(readFileSync(pkgFile, "utf8"))?.["live-studio"];
} catch (e) {
  const at = jsonPlace("package.json");
  stop(`✖ not valid JSON: ${e.message}${at ? ` (at ${at})` : ""}`);
}
if (!conf || typeof conf !== "object" || Array.isArray(conf))
  stop(
    `✖ no "live-studio": {...} in it, so the studio knows none of the film's files. git restore package.json, or compare with ${join(TEMPLATE, "package.json").replaceAll("\\", "/")}`,
  );

const found = checkFiles(contractFiles(PROJECT)).map((text) => {
  const [where, ...rest] = text.split("\n");
  return { where, issue: rest.join("\n") };
});

// The JSON the scene imports itself (a timeline the studio is not told of): a broken one breaks the film's build
for (const file of readdirSync(join(PROJECT, "src"), { recursive: true, withFileTypes: true })) {
  if (!file.isFile() || !file.name.endsWith(".json")) continue;
  const rel = relative(PROJECT, join(file.parentPath, file.name)).replaceAll("\\", "/");
  if (found.some((p) => p.where === rel)) continue;
  try {
    JSON.parse(readFileSync(join(PROJECT, rel), "utf8"));
  } catch (e) {
    found.push({ where: rel, issue: `✖ not JSON: ${e.message}` });
  }
}

// A JSON file the film's code imports and that is gone: the film no longer builds
for (const file of readdirSync(join(PROJECT, "src"), { recursive: true, withFileTypes: true })) {
  if (!file.isFile() || !/\.[mc]?[jt]sx?$/.test(file.name)) continue;
  const code = readFileSync(join(file.parentPath, file.name), "utf8");
  for (const [, spec] of code.matchAll(/from\s+["'](\.{1,2}\/[^"']+\.json)["']/g)) {
    const rel = relative(PROJECT, join(file.parentPath, spec)).replaceAll("\\", "/");
    if (existsSync(join(PROJECT, rel)) || found.some((p) => p.where === rel)) continue;
    const by = relative(PROJECT, join(file.parentPath, file.name)).replaceAll("\\", "/");
    found.push({
      where: rel,
      issue: `✖ missing: ${by} imports it, so the film does not build. Deleted or moved? git restore ${rel}, or write it anew`,
    });
  }
}

for (const p of found) {
  const file = p.where.split(" ")[0];
  if (/not (valid )?JSON/.test(p.issue)) {
    const at = existsSync(join(PROJECT, file)) && jsonPlace(file);
    if (at) p.issue += ` (at ${at})`;
  } else if (existsSync(join(TEMPLATE, file))) {
    const near = relative(PROJECT, join(TEMPLATE, file)).replaceAll("\\", "/");
    // a film outside the repo: the full path reads better than ../ ten times
    const shown = near.startsWith("../../../") ? join(TEMPLATE, file).replaceAll("\\", "/") : near;
    p.issue += `\n  a working ${file} to compare with: ${shown}`;
  }
}

const distance = (a, b) => {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
};
// [key, the known key it is a letter or two from] for each key of obj nothing reads
const misspelt = (obj, keys) =>
  Object.keys(obj).flatMap((k) => {
    if (keys.includes(k)) return [];
    const near = keys.find(
      (n) => distance(k.toLowerCase(), n.toLowerCase()) <= (n.length >= 4 ? 2 : 1),
    );
    return near ? [[k, near]] : [];
  });

// the known name a word is taken for a typo of: a letter off, or two swapped (a film's own names sit further off)
const nearName = (k, names) =>
  names.includes(k)
    ? null
    : names.find(
        (n) =>
          distance(k.toLowerCase(), n.toLowerCase()) <= 1 ||
          (k.length === n.length &&
            k.toLowerCase().split("").sort().join() === n.toLowerCase().split("").sort().join()),
      );

// A fault in the lanes must not hide the others (an AI fixes what it is shown and meets the rest a run later):
// names are checked whenever the file parses; gains, keys and the end need rows of the right shape
const soundBroken = found.find((p) => p.where === conf.soundTimeline);
const soundParses = !soundBroken || !/not (valid )?JSON/.test(soundBroken.issue);
if (soundBroken)
  soundBroken.issue += `\n  gains and sounds after the end are checked once these are fixed`;

const sound = conf.soundTimeline && conf.sfx ? openSound(PROJECT, conf) : null;
const lanesFile = sound && join(PROJECT, conf.soundTimeline);
if (lanesFile && existsSync(lanesFile) && soundParses) {
  const lanes = JSON.parse(readFileSync(lanesFile, "utf8"));
  const names = sound.library().map((x) => x.name),
    known = new Set(names);
  const nearest = (name) =>
    names
      .map((n) => [n, distance(name.toLowerCase(), n.toLowerCase())])
      .filter(([, d]) => d <= Math.max(2, name.length / 3))
      .sort((a, b) => a[1] - b[1])
      .slice(0, 3)
      .map(([n]) => n);
  // one line per missing name, with every place it is used
  const missing = new Map(),
    used = new Set();
  for (const list of ["beds", "sfx"])
    (Array.isArray(lanes?.[list]) ? lanes[list] : []).forEach((e, i) => {
      for (const name of new Set([e?.name, ...(Array.isArray(e?.try) ? e.try : [])])) {
        if (typeof name !== "string") continue;
        used.add(name);
        if (!known.has(name)) missing.set(name, [...(missing.get(name) ?? []), `${list}[${i}]`]);
      }
    });
  // most names missing at once is a machine without the film's sounds, not a film of wrong names
  // (said once, with a few of the names: a "did you mean" for each would send an AI hunting for other sounds)
  const absent = missing.size >= 5 && missing.size >= used.size / 2;
  if (absent)
    found.push({
      where: conf.soundTimeline,
      issue: `✖ ${missing.size} of the ${used.size} sounds it names are not on this machine (${[...missing.keys()].slice(0, 5).join(", ")}, ...): most of the sound files are not here yet, so the names cannot be checked (a typo among them shows once they are). 1. bun run sfx:get fetches the film's own (CC0 from Freesound into ${conf.sfx}/); 2. cd ../.. && bun run link connects the vault; 3. bun run check again`,
    });
  const issues = [...(absent ? [] : missing)].map(([name, at]) => {
    const near = nearest(name);
    return `✖ "${name}" (${at.length > 4 ? `${at.slice(0, 4).join(" ")} and ${at.length - 4} more` : at.join(" ")}) is no sound the studio has${near.length ? `: did you mean ${near.map((n) => `"${n}"`).join(", ")}?` : ""} (bun run find ${name.replaceAll(/[_-]/g, " ")})`;
  });
  if (issues.length)
    issues.push(
      `  ${missing.size} name${missing.size === 1 ? "" : "s"}. A sound lives in ${conf.sfx}/ (the film's own: bun run sfx:get fetches the CC0 ones it pins) or the vault; pick another: bun run find <words>`,
    );
  // a name find printed but this film cannot hear: the vault itself is out of its reach, not the name wrong
  const vaults = findVaults(PROJECT, conf);
  if (missing.size && !vaults.length)
    issues.push(
      `  no vault reaches this film: it is found through vault.json in a folder above the film (the repo root), so a film outside the repo hears only its own ${conf.sfx}/. Keep films in the repo's films/, or set package.json "live-studio".soundVault`,
    );
  else if (
    missing.size &&
    [...missing.keys()].some((n) => n.startsWith("mc-")) &&
    !vaults.some((v) => v.endsWith("mc-sound"))
  )
    issues.push(
      "  the Minecraft sounds (vault/mc-sound) are not on this machine: cd ../.. && bun run setup:mc-sound --help",
    );
  if (issues.length) found.push({ where: conf.soundTimeline, issue: issues.join("\n") });
}

// Where the sounds sit, read through the clocks the studio plays them on (the film's end: src/edit.json end, through the
// voice edit and Speed/Freeze). A sound after the end is never heard; a gain far over the file's own level is allowed, said once
const warnings = [];
// a misspelt key is read by nothing: named whenever its file parses, even beside the shape faults it causes (gian for a missing gain)
const keyTypos = (where, lines) => {
  if (!lines.length) return;
  const issue = lines.join("\n");
  const there = found.find((p) => p.where === where);
  if (there) there.issue = `${issue}\n${there.issue}`;
  else found.push({ where, issue });
};
const readJson = (rel) => {
  try {
    return rel && existsSync(join(PROJECT, rel))
      ? JSON.parse(readFileSync(join(PROJECT, rel), "utf8"))
      : null;
  } catch {
    return null;
  }
};
const lanesRead = readJson(conf.soundTimeline);
if (lanesRead && typeof lanesRead === "object")
  keyTypos(
    conf.soundTimeline,
    [
      ...misspelt(lanesRead, SOUND_KEYS.audio),
      ...["beds", "sfx"].flatMap((list) =>
        (Array.isArray(lanesRead[list]) ? lanesRead[list] : []).flatMap((e, i) =>
          e && typeof e === "object"
            ? misspelt(e, SOUND_KEYS[list]).map(([k, near]) => [`${list}[${i}] "${k}"`, near])
            : [],
        ),
      ),
    ].map(([k, near]) => `✖ ${k}: no key the mix reads; did you mean "${near}"?`),
  );
// a film may put keys of its own on a camera key (cell-break's live, size): only a letter off or swapped is taken for a typo
const camRead = readJson(conf.camTimeline);
if (Array.isArray(camRead))
  keyTypos(
    conf.camTimeline,
    camRead.flatMap((key, i) =>
      key && typeof key === "object"
        ? Object.keys(key).flatMap((k) => {
            const near = nearName(k, CAM_KEYS);
            return near
              ? [`✖ [${i}] "${k}": no key the camera reads; did you mean "${near}"?`]
              : [];
          })
        : [],
    ),
  );
// a transition or anim name nothing has plays a hard cut or no move, silently; a film's own names (passed to
// makeTransitions, or in draw.anims) are not known here, so only a near miss of a built-in is named
const shotsRead = readJson(conf.shotsTimeline);
if (Array.isArray(shotsRead)) {
  const ids = (list) => list.map((x) => x.id);
  shotsRead.forEach((shot, i) => {
    const near = (where, fx, names) => {
      const to = typeof fx === "string" && nearName(fx, names);
      if (to)
        warnings.push(
          `⚠ ${conf.shotsTimeline} [${i}].${where} "${fx}": no built-in has that name; did you mean "${to}"? (left as it is it plays ${where === "transition" ? "a hard cut" : "no move"}, unless the film defines its own)`,
        );
    };
    near("transition", shot?.transition?.fx, ids(TRANSITIONS));
    for (const slot of ["in", "out", "combo"])
      near(`anim.${slot}`, shot?.anim?.[slot]?.fx, ids(ANIMS[slot]));
  });
}
const lanesPath = conf.soundTimeline && join(PROJECT, conf.soundTimeline);
if (lanesPath && existsSync(lanesPath) && !soundBroken) {
  const lanes = JSON.parse(readFileSync(lanesPath, "utf8"));
  for (const list of ["beds", "sfx"])
    (lanes[list] ?? []).forEach((e, i) => {
      if (e.gain > 12)
        warnings.push(
          `⚠ ${list}[${i}] "${e.name}" gain +${e.gain} dB (${conf.soundTimeline}): over +12 a sound is pushed far past its file's own level and the limiter flattens it; meant? bun run listen --at <its second> hears it`,
        );
    });
  if (typeof lanes.lufs === "number" && (lanes.lufs > -12 || lanes.lufs < -20))
    warnings.push(
      `⚠ lufs ${lanes.lufs} (${conf.soundTimeline}): YouTube plays every video at -14 LUFS, ${lanes.lufs > -12 ? "turning a louder one down, so the loudness bought with limiting is lost" : "never turning a quieter one up"}; -14 unless the film means it`,
    );
  if (typeof lanes.drive === "number" && lanes.drive > 12)
    warnings.push(
      `⚠ drive +${lanes.drive} dB (${conf.soundTimeline}): the mix's push into its limiter; over +12 every hit is flattened into the bed; the films use 0-12`,
    );
  const ends = heardLength(PROJECT, conf);
  if (ends) {
    const length = ends.layers;
    const heard = mapTimeline("sound", lanes, clockForTimeline("sound"), false, null, {});
    const late = [
      ...heard.beds.flatMap((c, i) =>
        c.from >= length ? [["beds", i, c.name, lanes.beds[i].from, c.from]] : [],
      ),
      ...heard.sfx.flatMap((c, i) =>
        c.at >= length ? [["sfx", i, c.name, lanes.sfx[i].at, c.at]] : [],
      ),
    ].map(
      ([list, i, name, written, at]) =>
        `✖ ${list}[${i}] "${name}" at ${+written.toFixed(2)}: after the film ends (${length.toFixed(2)} s heard), so never heard${Math.abs(at - written) > 0.01 ? ` (it plays at ${at.toFixed(2)} s heard)` : ""}`,
    );
    if (late.length)
      found.push({
        where: conf.soundTimeline,
        issue: [
          ...(json ? late : late.slice(0, 8)),
          ...(late.length > 8 && !json
            ? [`  and ${late.length - 8} more (bun run check --json lists every one)`]
            : []),
          "  move each earlier (bun run at <second> shows what plays there) or remove it",
        ].join("\n"),
      });
  }
}

const textPath = conf.textTimeline && join(PROJECT, conf.textTimeline);
const textRead =
  textPath && !found.some((p) => p.where === conf.textTimeline) && readJson(conf.textTimeline);
if (Array.isArray(textRead?.items) && heardLength(PROJECT, conf)) {
  const heard = mapTimeline("text", textRead, clockForTimeline("text"), false, null, {});
  const said = [];
  textRead.items.forEach((it, i) => {
    const h = heard?.items?.[i];
    if (!isRead(it) || !h) return;
    const short = it.text.replace(/\s*\n\s*/g, " ").trim();
    for (const fault of readFaults(it, h))
      said.push(
        `⚠ ${conf.textTimeline} items[${i}] "${short.length > 28 ? `${short.slice(0, 27)}…` : short}" at ${h.from.toFixed(2)}-${h.to.toFixed(2)} heard: ${fault}`,
      );
  });
  if (said.length)
    warnings.push(
      ...said,
      `  decor not meant to be read takes "read": false; where each sits and how it reads over the picture: CHECK=text bun run render stills`,
    );
}

if (json) console.log(JSON.stringify({ ok: !found.length, problems: found, warnings }));
else if (!found.length)
  console.log(
    `${warnings.length ? `${warnings.join("\n")}\n` : ""}ok: the film's data is what the studio expects. Look at it: AT=<seconds> bun run render stills, or bun run studio`,
  );
else {
  const files = new Set(found.map((p) => p.where.split(" ")[0]));
  console.error(
    `${found.map((p) => `${p.where}\n${p.issue}`).join("\n\n")}${warnings.length ? `\n\n${warnings.join("\n")}` : ""}\n\nevery other file is as the studio expects (${files.size} with problems above)`,
  );
}
process.exit(found.length ? 1 : 0);
