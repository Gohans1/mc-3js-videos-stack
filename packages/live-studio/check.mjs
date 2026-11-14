// The film contract checked without a studio; HELP below
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { ANIMS } from "film-stage/animate";
import { TEXT_ITEM_KEYS } from "film-stage/titles";
import { TRANSITIONS } from "film-stage/transitions";

import { cliArgs, envTypos, needFilm } from "./src/cli.mjs";
import {
  ADJUSTMENT_KEYS,
  CAM_KEYS,
  checkFiles,
  CONFIG_KEYS,
  EDIT_KEYS,
  problems as schemaProblems,
  SHOT_KEYS,
  SHOT_SLOT_KEYS,
  SOUND_KEYS,
  StudioConfig,
  TEXT_KEYS,
  TEXT_SLOT_KEYS,
  TIMING_KEYS,
} from "./src/contract.ts";
import { contractFiles, heardLength } from "./src/film.mjs";
import { MOUTH_MAP, mouthFaults } from "./src/mouth-map.mjs";
import { isRead, readFaults, sizeFaults } from "./src/readable.mjs";
import { findVaults, openSound } from "./src/sound.mjs";
import { tell } from "./src/tell.mjs";
import { mapTimeline } from "./src/timing-data.mjs";
import { clockForTimeline } from "./src/timing-state.mjs";
import { assertInsideDir } from "./src/voice-map.mjs";

const HELP = `Checks the film's data the way the studio does, without opening it: run it after editing any file in src/timeline,
src/edit.json or package.json "live-studio". Run inside the film.
  bun run check           the problems, each under the file it is in, or "ok"
  bun run check --json    {"ok": bool, "problems": [{"where": file, "issue": text}], "warnings": [text]}
Checks every timeline file against its schema (src/contract.ts, the studio's own), that every other .json in src/ parses,
and every sound name in the sound timeline (beds, sfx and their "try" options) against the sounds the studio can play,
with the nearest names or the other film whose own sound it is, and that every take said on screen ("by") has its mouth
shapes (bun run voice:lips). Warns (⚠, still exit 0) of on-screen text too brief to read or too small for a phone; where it sits
and how it reads over the picture: CHECK=text bun run render stills.
Not checked here: what src/scene.ts exports and what draw(t) returns (the studio page and bun run render say those).
Exit 0 ok, 1 problems found. Find a sound or preset by meaning: bun run find <words>.`;

const json = cliArgs(HELP, ["--json"], 0).includes("--json");
envTypos(["LIVE_PROJECT"]);
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
    console.log(
      JSON.stringify({ ok: false, problems: [{ where: "package.json", issue }], warnings: [] }),
    );
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
// a value of the wrong shape ("soundTimeline": 123) is opened by every check after: said alone, before any is
const confFaults = schemaProblems(StudioConfig, conf, "package.json");
if (confFaults.length) stop(confFaults.map((p) => p.split("\n").slice(1).join("\n")).join("\n"));
// the template film's paths, named as examples: none when the studio runs outside this repo
const template = existsSync(join(TEMPLATE, "package.json"))
  ? (JSON.parse(readFileSync(join(TEMPLATE, "package.json"), "utf8"))["live-studio"] ?? {})
  : {};
// the files every check after opens: one outside the film (the studio refuses it, assertInsideDir) or a folder
// (src/timeline, read as no file) is said alone, before any is opened
const pathFaults = [
  ...CONFIG_KEYS.filter((k) => k.endsWith("Timeline")).map((k) => [k, conf[k]]),
  ...Object.keys(conf.keyFiles ?? {}).map((rel) => ["keyFiles", rel]),
].flatMap(([k, rel]) => {
  if (typeof rel !== "string") return [];
  try {
    assertInsideDir(PROJECT, rel, "Timeline file");
  } catch (e) {
    return [`✖ "${k}": ${e.message}, which the studio refuses to open`];
  }
  return statSync(join(PROJECT, rel), { throwIfNoEntry: false })?.isDirectory()
    ? [
        `✖ "${k}": "${rel}" is a folder; it names one JSON file${template[k] ? ` (the template film's: "${template[k]}")` : ""}`,
      ]
    : [];
});
if (pathFaults.length) stop(pathFaults.join("\n"));

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

// A JSON file the film's code imports and that is gone: the film no longer builds. Bun's own parser reads the imports, so
// one in a comment or a string is none; a file it cannot parse is the build's to name
for (const file of readdirSync(join(PROJECT, "src"), { recursive: true, withFileTypes: true })) {
  if (!file.isFile() || !/\.[mc]?[jt]sx?$/.test(file.name)) continue;
  const code = readFileSync(join(file.parentPath, file.name), "utf8");
  let specs = [];
  try {
    specs = new Bun.Transpiler({ loader: file.name.endsWith("x") ? "tsx" : "ts" })
      .scanImports(code)
      .map((x) => x.path)
      .filter((x) => /^\.{1,2}\/.*\.json$/.test(x));
  } catch {}
  for (const spec of specs) {
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

// a take said on screen (src/edit.json takes[].by) moves its character's mouth only once voice:lips has heard it
const lips = mouthFaults(PROJECT);
if (lips.length) found.push({ where: MOUTH_MAP, issue: lips.join("\n") });

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

// two neighbouring letters swapped (gian for gain)
const swapped = (a, b) => {
  const at = [...a].flatMap((c, i) => (c === b[i] ? [] : [i]));
  return at.length === 2 && at[1] === at[0] + 1 && a[at[0]] === b[at[1]] && a[at[1]] === b[at[0]];
};
// the known name a word is taken for a typo of: neighbouring letters swapped (from three letters), a letter dropped or
// added (the shorter word four letters or more), one changed (five or more), or only the case (Fov). Under that a key of the film's own is a word
// of its own: fog by fov, cute by cut, span by pan, uid by id, ot by to; letters further apart too (laces by scale)
const nearName = (k, names) =>
  names.includes(k)
    ? null
    : names.find((n) => {
        const a = k.toLowerCase(),
          b = n.toLowerCase();
        if (a === b) return true;
        if (a.length !== b.length) return Math.min(a.length, b.length) >= 4 && distance(a, b) === 1;
        return a.length >= 3 && (swapped(a, b) || (a.length >= 5 && distance(a, b) === 1));
      });

// A fault in the lanes must not hide the others (an AI fixes what it is shown and meets the rest a run later):
// names are checked whenever the file parses; gains, keys and the end need rows of the right shape
const soundBroken = found.find((p) => p.where === conf.soundTimeline);
const soundParses = !soundBroken || !/not (valid )?JSON/.test(soundBroken.issue);
if (soundBroken)
  soundBroken.issue += `\n  gains and sounds after the end are checked once these are fixed`;
// the film's length is read through edit.json and timing.json: a fault in either would throw there, so the checks
// against the end wait for it
const clockBroken = found.find(
  (p) => p.where === conf.timingTimeline || p.where === "src/edit.json",
);
if (clockBroken)
  clockBroken.issue += `\n  sounds after the end and on-screen text (too brief, too small) are checked once this is fixed`;
const filmEnds = () => (clockBroken ? null : heardLength(PROJECT, conf));

// a sound folder the studio refuses (outside the film, a symlink): a fault, not a crash
const sound = (() => {
  try {
    return conf.soundTimeline && conf.sfx ? openSound(PROJECT, conf) : null;
  } catch (e) {
    found.push({
      where: 'package.json "live-studio"',
      issue: `✖ ${e.message}, which the studio refuses too; sound names are checked once it is fixed`,
    });
    return null;
  }
})();
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
      issue: `✖ ${missing.size} of the ${used.size} sounds it names are not on this machine (${[...missing.keys()].slice(0, 5).join(", ")}${missing.size > 5 ? ", ..." : ""}): most of the sound files are not here yet, so the names cannot be checked (a typo among them shows once they are). 1. bun run sfx:get fetches the film's own (CC0 from Freesound into ${conf.sfx}/); 2. ${conf.soundVault === false ? 'drop "soundVault": false from package.json to hear the vault' : "cd ../.. && bun run link connects the vault"}; 3. bun run check again`,
    });
  // a film's own sounds are heard by it alone: a name copied from another film is found in that film's folder
  const siblings = readdirSync(dirname(PROJECT), { withFileTypes: true }).flatMap((d) => {
    const dir = join(dirname(PROJECT), d.name);
    if (!d.isDirectory() || dir === PROJECT) return [];
    try {
      const sfx = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))?.["live-studio"]?.sfx;
      return typeof sfx === "string" ? [join(dir, sfx)] : [];
    } catch {
      return [];
    }
  });
  const elsewhere = (name) =>
    siblings
      .flatMap((dir) => [".wav", ".ogg"].map((ext) => join(dir, `${name}${ext}`)))
      .find((f) => existsSync(f));
  const issues = [...(absent ? [] : missing)].map(([name, at]) => {
    const other = elsewhere(name);
    const near = other ? [] : nearest(name);
    const where = other
      ? `: ${relative(PROJECT, other).replaceAll("\\", "/")} has it (another film's own: copy the file and its SOURCES.json row into ${conf.sfx}/)`
      : near.length
        ? `: did you mean ${near.map((n) => `"${n}"`).join(", ")}?`
        : "";
    return `✖ "${name}" (${at.length > 4 ? `${at.slice(0, 4).join(" ")} and ${at.length - 4} more` : at.join(" ")}) is no sound the studio has${where} (bun run find ${name.replaceAll(/[_-]/g, " ")})`;
  });
  if (issues.length)
    issues.push(
      `  ${missing.size} name${missing.size === 1 ? "" : "s"}. A sound lives in ${conf.sfx}/ (the film's own: bun run sfx:get fetches the CC0 ones it pins) or the vault; pick another: bun run find <words>`,
      `  replace a name: its "name" in ${conf.soundTimeline} (the row named above) with an id bun run find prints, or swap the clip in the studio's Sound panel`,
    );
  // a name find printed but this film cannot hear: the vault itself is out of its reach, not the name wrong (most names
  // missing already said how to reach it)
  const vaults = findVaults(PROJECT, conf);
  if (missing.size && !absent && conf.soundVault === false)
    issues.push(
      `  "soundVault": false in package.json shuts the vault out: this film hears only its own ${conf.sfx}/ (drop that line to hear the vault)`,
    );
  else if (missing.size && !absent && conf.soundVault !== false && !vaults.length)
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
// advice under the warnings, for a reader: text output only, never a --json warning
const hints = [];
// the studio opens the film's sounds through its sfx folder: without one no name can be looked up
if (conf.soundTimeline && !conf.sfx)
  warnings.push(
    `⚠ package.json "live-studio" names no "sfx" folder, so no sound name in ${conf.soundTimeline} is checked${template.sfx ? ` (the template film's: "${template.sfx}")` : ""}`,
  );
// a misspelt key is read by nothing: named whenever its file parses, even beside the shape faults it causes (gian for a
// missing gain). A warning, not a problem: it is a guess, and a key of the film's own that looks like one (waves by wave)
// has no other way to pass
const keyTypos = (where, lines) => {
  if (!lines.length) return;
  warnings.push(...lines.map((l) => `⚠ ${where} ${l}`));
  if (!hints.some((h) => h.includes("a key of the film's own")))
    hints.push(`  a key of the film's own is fine to leave: the studio reads only its own keys`);
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
// a film may put keys of its own on a sound row too (the Film tab lists them): as on a camera key, only a letter off or swapped
// is taken for a typo
const nearKeys = (obj, keys) =>
  Object.keys(obj).flatMap((k) => {
    const near = nearName(k, keys);
    return near ? [[k, near]] : [];
  });
const lanesRead = readJson(conf.soundTimeline);
if (lanesRead && typeof lanesRead === "object")
  keyTypos(
    conf.soundTimeline,
    [
      ...nearKeys(lanesRead, SOUND_KEYS.audio),
      ...["beds", "sfx"].flatMap((list) =>
        (Array.isArray(lanesRead[list]) ? lanesRead[list] : []).flatMap((e, i) =>
          e && typeof e === "object"
            ? nearKeys(e, SOUND_KEYS[list]).map(([k, near]) => [`${list}[${i}] "${k}"`, near])
            : [],
        ),
      ),
    ].map(([k, near]) => `${k}: no key the mix reads; did you mean "${near}"?`),
  );
// a misspelt config key leaves its file read by nothing, schema checks included
keyTypos(
  'package.json "live-studio"',
  nearKeys(conf, CONFIG_KEYS).map(
    ([k, near]) => `"${k}": no key the studio reads; did you mean "${near}"?`,
  ),
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
            return near ? [`[${i}] "${k}": no key the camera reads; did you mean "${near}"?`] : [];
          })
        : [],
    ),
  );
// a shot, a text item and an adjustment layer take keys of the film's own too: only a near miss of a key the studio
// reads is a typo, on the row and in its slots ("anim.in", "transition", a text's "in")
const rowTypos = (rel, rows, prefix, keys, slotKeys = []) => {
  const slots = Map.groupBy(slotKeys, (p) => p.slice(0, p.lastIndexOf(".")));
  keyTypos(
    rel,
    (Array.isArray(rows) ? rows : [])
      .flatMap((row, i) =>
        row && typeof row === "object"
          ? [
              ...nearKeys(row, keys).map(([k, near]) => [`${prefix}[${i}] "${k}"`, near]),
              ...[...slots].flatMap(([slot, paths]) => {
                const at = slot.split(".").reduce((o, k) => o?.[k], row);
                return at && typeof at === "object"
                  ? nearKeys(
                      at,
                      paths.map((p) => p.slice(slot.length + 1)),
                    ).map(([k, near]) => [`${prefix}[${i}].${slot} "${k}"`, near])
                  : [];
              }),
            ]
          : [],
      )
      .map(([k, near]) => `${k}: no key the studio reads; did you mean "${near}"?`),
  );
};
rowTypos(
  conf.shotsTimeline,
  readJson(conf.shotsTimeline),
  "",
  [...SHOT_KEYS, "size", "what"],
  SHOT_SLOT_KEYS,
);
rowTypos(
  conf.textTimeline,
  readJson(conf.textTimeline)?.items,
  "items",
  [...TEXT_KEYS, ...TEXT_ITEM_KEYS],
  TEXT_SLOT_KEYS,
);
rowTypos(
  conf.adjustmentTimeline,
  readJson(conf.adjustmentTimeline)?.items,
  "items",
  ADJUSTMENT_KEYS,
);
// every top key of edit.json and timing.json is optional to the studio (timing.json's schema even drops one it does not
// know), so a near miss ("endd", "speed") is read by nothing and no fault says so
for (const [rel, keys] of [
  ["src/edit.json", EDIT_KEYS],
  [conf.timingTimeline, TIMING_KEYS],
]) {
  const doc = readJson(rel);
  if (doc && typeof doc === "object" && !Array.isArray(doc))
    keyTypos(
      rel,
      nearKeys(doc, keys).map(
        ([k, near]) => `"${k}": no key the studio reads; did you mean "${near}"?`,
      ),
    );
}
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
  // a muted track is left out of every mix (scripts/sound/mix.py MUTED): its rows are never heard, so never judged
  const muted = new Set((lanes.tracks ?? []).flatMap((k) => (k?.mute ? [k.id] : [])));
  for (const list of ["beds", "sfx"])
    (lanes[list] ?? []).forEach((e, i) => {
      if (e.gain > 12 && !muted.has(e.track))
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
  const ends = filmEnds();
  if (ends) {
    const length = ends.layers;
    const heard = mapTimeline("sound", lanes, clockForTimeline("sound"), false, null, {});
    const late = [
      ...heard.beds.flatMap((c, i) =>
        c.from >= length && !muted.has(lanes.beds[i].track)
          ? [["beds", i, c.name, lanes.beds[i].from, c.from]]
          : [],
      ),
      ...heard.sfx.flatMap((c, i) =>
        c.at >= length && !muted.has(lanes.sfx[i].track)
          ? [["sfx", i, c.name, lanes.sfx[i].at, c.at]]
          : [],
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
const textBroken = found.find((p) => p.where === conf.textTimeline);
if (textBroken)
  textBroken.issue += `\n  on-screen text (too brief, too small) is checked once this is fixed`;
const textRead = textPath && !textBroken && readJson(conf.textTimeline);
if (Array.isArray(textRead?.items)) {
  // the heard seconds need the film's length (edit.json end); without it only the size floor is said
  const ends = filmEnds();
  const heard = ends
    ? mapTimeline("text", textRead, clockForTimeline("text"), false, null, {})
    : null;
  const said = [],
    late = [];
  textRead.items.forEach((it, i) => {
    const h = heard?.items?.[i];
    // after the end, as a sound there: decor too, since nothing past the end is drawn
    if (h && !it.hidden && !textRead.tracks?.[it.track ?? 0]?.hidden && h.from >= ends.layers) {
      late.push(
        `✖ items[${i}] "${String(it.text ?? it.kind).split("\n")[0]}" at ${+(+it.from).toFixed(2)}: after the film ends (${ends.layers.toFixed(2)} s heard), so never on screen${Math.abs(h.from - it.from) > 0.01 ? ` (it would show at ${h.from.toFixed(2)} s heard)` : ""}`,
      );
      return;
    }
    if (!isRead(it, textRead.tracks)) return;
    // h.to <= h.from: the edit cuts the item out whole, so it is never on screen
    if (heard && (!h || h.to <= h.from)) return;
    const short = it.text.replace(/\s*\n\s*/g, " ").trim();
    const cut = h && h.to > ends.layers;
    for (const fault of h ? readFaults(it, h, conf.ratio, ends.layers) : sizeFaults(it, conf.ratio))
      said.push(
        `⚠ ${conf.textTimeline} items[${i}] "${short.length > 28 ? `${short.slice(0, 27)}…` : short}"${h ? ` at ${h.from.toFixed(2)}-${(cut ? ends.layers : h.to).toFixed(2)} heard${cut ? ", cut by the film's end" : ""}` : ""} ("from": ${+(+it.from).toFixed(2)}): ${fault}`,
      );
  });
  if (late.length)
    found.push({
      where: conf.textTimeline,
      issue: [
        ...late,
        "  move each earlier (bun run at <second> shows what is on screen there) or remove it",
      ].join("\n"),
    });
  if (said.length) {
    warnings.push(...said);
    hints.push(
      `  decor not meant to be read takes "read": false; where each sits and how it reads over the picture: CHECK=text bun run render stills`,
    );
  }
}

// one problem per file, as --help says: a file faulted by two checks (its schema, its sound names) has both under it
const problems = [...Map.groupBy(found, (p) => p.where)].map(([where, ps]) => ({
  where,
  issue: ps.map((p) => p.issue).join("\n"),
}));
const shownWarnings = [...warnings, ...hints];
if (json) console.log(JSON.stringify({ ok: !problems.length, problems, warnings }));
else if (!problems.length)
  console.log(
    `${shownWarnings.length ? `${shownWarnings.join("\n")}\n` : ""}ok: the film's data is what the studio expects\nnext: look at it: AT=<seconds> bun run render stills, or bun run studio`,
  );
else {
  const files = new Set(problems.map((p) => p.where.split(" ")[0]));
  console.error(
    `${problems.map((p) => `${p.where}\n${p.issue}`).join("\n\n")}${shownWarnings.length ? `\n\n${shownWarnings.join("\n")}` : ""}\n\nevery other file is as the studio expects (${files.size} with problems above)\nnext: fix each ✖ as it says, then bun run check`,
  );
}
await tell(PROJECT, {
  say: problems.length
    ? `Checked the film's files: ${problems.length} problem${problems.length > 1 ? "s" : ""} to fix`
    : warnings.length
      ? `Checked the film's files: fine, ${warnings.length} warning${warnings.length > 1 ? "s" : ""} to read`
      : "Checked the film's files: all fine",
  level: problems.length ? "fail" : warnings.length ? "warn" : "ok",
});
process.exit(found.length ? 1 : 0);
