// One ranked list of what to look at in a whole draft; HELP below says how to run it
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cliArgs, needFilm } from "./src/cli.mjs";
import { latestStudy, referenceVideo } from "./src/ref-cuts.mjs";
import { cutItems, mean, median, sharpness, since, stretches, when } from "./src/sweep.mjs";
import { drawnCuts, filmPicture, probeVideo } from "./src/video.mjs";

const HELP = `Sweep a whole draft for what to fix, heaviest first, weighed against the film's reference. Run inside the film.
  bun run sweep                    renders/draft_video.mp4 (draft.mp4, final_video.mp4 and final.mp4 too)
  bun run sweep [video] --json     the report on stdout; progress on stderr
It gathers, each with its seconds and a reason:
  pops      framecheck's faults; a JUMP or FLASH the reference lacks (OURS ONLY) or a stutter of ours (OURS STEPS)
            comes first, one the reference has too last
  focus     3/4 s or more where ours is far blurrier (or sharper) than the reference, measured against the film's
            usual gap, since a block world and a filmed one never hold the same detail
  light     3/4 s or more where the whole picture is 35% brighter or 26% darker than the reference
  cuts      the render's cuts against the reference study's; one inside a reference whip is a look, not a fault
The reference is the one bun run reference study measured last, else references/ref.*; without one only pops come.
Cuts need a study (bun run reference study references/ref.mp4) and a render that recorded its cuts (bun run render clip).
How alike whole shots are is bun run reference compare; one shot's frames side by side is the sheet line each item gives.
Each item says (new) when the last sweep of the same video lacked it, and the ones gone since are named.
Writes renders/sweep.json. Stops after 10 minutes. Exit 0: swept, read the list; 1: a measurement failed; 2: usage.`;

const args = cliArgs(HELP, ["--json"], 1);
const json = args.includes("--json");
const log = json ? console.error : console.log;
needFilm(process.env.LIVE_PROJECT);
const PROJECT = resolve(process.env.LIVE_PROJECT ?? process.cwd());
const videoArg = args.find((a) => !a.startsWith("--")) ?? "renders/draft_video.mp4";
const video = resolve(PROJECT, videoArg);
const shown = relative(PROJECT, video).replaceAll("\\", "/");
if (!/^renders\/(?:draft|final)(?:_video)?\.mp4$/.test(shown)) {
  console.error(
    `sweep reads a whole draft (renders/draft_video.mp4, draft.mp4, final_video.mp4 or final.mp4); for this one: bun run framecheck ${shown}`,
  );
  process.exit(2);
}
if (!existsSync(video)) {
  console.error(`no ${shown}: bun run render clip makes it`);
  process.exit(2);
}
const probed = probeVideo(video);
if (!probed) {
  console.error(`${shown} has no readable picture`);
  process.exit(1);
}

const reference = referenceVideo(PROJECT);
const deadline = setTimeout(() => {
  console.error("sweep: stopped after 10 minutes; nothing was written");
  process.exit(1);
}, 10 * 60_000);
const children = new Set();
process.on("exit", () => children.forEach((c) => c.kill()));

const run = (cmd, argv, onData) =>
  new Promise((done, fail) => {
    const child = spawn(cmd, argv, {
      cwd: PROJECT,
      env: { ...process.env, LIVE_PROJECT: PROJECT },
      windowsHide: true,
    });
    children.add(child);
    const out = [];
    let err = "";
    child.stdout.on("data", (b) => (onData ? onData(b) : out.push(b)));
    child.stderr.on("data", (b) => (err += b));
    child.on("error", fail);
    child.on("close", (code) => {
      children.delete(child);
      if (code === 0) done(Buffer.concat(out).toString("utf8"));
      else
        fail(
          new Error(
            `${cmd} ${argv.slice(0, 2).join(" ")} exit ${code}: ${err.trim().split("\n").at(-1)}`,
          ),
        );
    });
  });

// one grey frame per quarter second: its detail and its brightness
const STEP = 0.25;
const LONG = 0.75;
const picture = filmPicture(PROJECT, video) ?? probed;
const W = Math.min(360, Math.trunc(picture.width / 2) * 2);
const H = Math.max(2, Math.round((W * picture.height) / picture.width / 2) * 2);
const measure = async (file, frame, seconds) => {
  const rows = [];
  let held = Buffer.alloc(0);
  await run(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      file,
      "-t",
      String(seconds),
      "-an",
      "-vf",
      `${frame}fps=${1 / STEP},scale=${W}:${H}:force_original_aspect_ratio=increase:flags=area,crop=${W}:${H},format=gray`,
      "-f",
      "rawvideo",
      "-",
    ],
    (b) => {
      held = Buffer.concat([held, b]);
      while (held.length >= W * H) {
        const g = held.subarray(0, W * H);
        rows.push({ detail: sharpness(g, W, H), light: mean(g) });
        held = held.subarray(W * H);
      }
    },
  );
  return rows;
};

const seconds = Number(
  spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video],
    { encoding: "utf8", windowsHide: true },
  ).stdout,
);
if (!(seconds > 0)) {
  console.error(`${shown} has no readable length`);
  process.exit(1);
}
const ownCrop = picture === probed ? "" : `crop=${picture.width}:${picture.height}:0:0,`;
log(
  `sweeping ${shown}${reference ? ` against ${reference}` : ""}: framecheck${reference ? ", focus and light every quarter second" : ""}`,
);
let report, ours, theirs;
try {
  [report, ours, theirs] = await Promise.all([
    run(process.execPath, [
      fileURLToPath(new URL("./framecheck.mjs", import.meta.url)),
      shown,
      "--json",
      ...(reference ? ["--vs", reference] : []),
    ]).then((out) => JSON.parse(out.trim().split("\n").at(-1))),
    reference ? measure(video, ownCrop, seconds) : [],
    reference ? measure(resolve(PROJECT, reference), "", seconds) : [],
  ]);
} catch (e) {
  console.error(`sweep: ${e.message}`);
  process.exit(1);
}
clearTimeout(deadline);

// a pop the reference lacks first, one it makes too last; one never weighed (no reference, or past its end) between.
// A freeze is often a still the film means
const popWeight = (f) => {
  if (f.kind !== "JUMP" && f.kind !== "FLASH") return f.kind === "FROZEN" ? 2 : 3;
  if (f.reference?.ours) return 5;
  return f.reference?.change === undefined ? 4 : 1;
};
const items = [];
const notes = [];
for (const f of report.findings)
  items.push({
    from: f.time,
    to: f.end ?? f.time,
    kind: f.kind,
    weight: popWeight(f),
    size: f.reference?.oursChange ?? 0,
    say: `${f.detail}${f.reference ? `; ${f.reference.said}` : ""}`,
  });
if (report.stale)
  notes.push(`it shows the film as drawn, not as it is now: ${report.stale.message}`);

const n = Math.min(ours.length, theirs.length);
if (n) {
  const pct = (r) => `${Math.round(Math.abs(r - 1) * 100)}%`;
  const detail = ours.slice(0, n).map((o, i) => (o.detail + 1) / (theirs[i].detail + 1));
  const usual = median(detail);
  for (const r of stretches(
    detail.map((q) => q / usual),
    STEP,
    0.5,
    2,
    LONG,
  ))
    items.push({
      ...r,
      kind: r.ratio < 1 ? "blurrier" : "sharper",
      weight: r.ratio < 1 ? 4 : 2,
      size: (r.to - r.from) * Math.abs(Math.log(r.ratio)),
      say:
        r.ratio < 1
          ? `ours holds ${(1 / r.ratio).toFixed(1)}x less detail than the reference, against the film's usual gap: focus, depth of field or motion blur`
          : `ours holds ${r.ratio.toFixed(1)}x more detail than the reference: its focus is soft, racks or smears here`,
    });
  const light = ours.slice(0, n).map((o, i) => (o.light + 4) / (theirs[i].light + 4));
  for (const r of stretches(light, STEP, 0.74, 1.35, LONG))
    items.push({
      ...r,
      kind: r.ratio > 1 ? "brighter" : "darker",
      weight: 3,
      size: (r.to - r.from) * Math.abs(Math.log(r.ratio)),
      say: `the whole picture is ${pct(r.ratio)} ${r.ratio > 1 ? "brighter" : "darker"} than the reference: REF=${reference} AT=${+((r.from + r.to) / 2).toFixed(2)} REF_REGION=x,y,w,h bun run render stills names the part`,
    });
} else if (!reference)
  notes.push(
    "no reference video in references/ (bun run reference add <video>): pops are not weighed, focus, light and cuts not swept",
  );

const study = reference ? latestStudy(PROJECT) : null;
const cuts = drawnCuts(PROJECT, video, report.stale);
if (reference && !study)
  notes.push(
    `no study of ${reference}, so cuts are not matched: bun run reference study ${reference}`,
  );
else if (reference && !cuts.times)
  notes.push(
    `the render recorded no cuts (${cuts.reason ?? cuts.status}): bun run render clip records them`,
  );
else if (reference)
  items.push(...cutItems(study, cuts.times, seconds).map((x) => ({ ...x, size: 0 })));

items.sort((a, b) => b.weight - a.weight || b.size - a.size || a.from - b.from);
const look = (x) => {
  const from = Math.max(0, x.to > x.from ? x.from : x.from - 0.1);
  const to = x.to > x.from ? x.to : x.from + 0.1;
  return `bun run sheet ${shown} frames ${+from.toFixed(3)}-${+to.toFixed(3)}/6${reference ? ` --vs ${reference}` : ""}`;
};
const out = join(PROJECT, "renders/sweep.json");
let before = null;
try {
  const last = JSON.parse(readFileSync(out, "utf8"));
  if (last.video === shown && Array.isArray(last.items)) before = last.items;
} catch {}
const { fresh, gone } = since(before, items);
const result = {
  video: shown,
  reference,
  study: study && relative(PROJECT, study.file).replaceAll("\\", "/"),
  framecheck: report.index,
  notes,
  items: items.map(({ size: _size, ...x }, i) => ({
    rank: i + 1,
    ...x,
    ...(before && { new: fresh.has(items[i]) }),
    look: look(x),
  })),
  gone: gone.map(({ from, to, kind }) => ({ from, to, kind })),
};
mkdirSync(join(PROJECT, "renders"), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 2) + "\n");

const SHOWN = 20;
log(
  `sweep of ${shown}${reference ? ` against ${reference}` : ""}: ${items.length ? `${items.length} to look at, heaviest first` : "nothing the meters catch"}`,
);
for (const x of result.items.slice(0, SHOWN))
  log(`  ${x.rank}. ${when(x)} ${x.kind}${x.new ? " (new)" : ""}: ${x.say}`);
if (items.length > SHOWN) log(`  ${items.length - SHOWN} more in renders/sweep.json`);
if (before)
  log(
    `since the last sweep: ${fresh.size} new, ${gone.length ? `gone ${gone.map((x) => `${when(x)} ${x.kind}`).join(", ")}` : "none gone"}`,
  );
for (const note of notes) log(`note: ${note}`);
log("wrote renders/sweep.json");
if (json) console.log(JSON.stringify(result));
log(
  items.length
    ? `next: ${result.items[0].look} (number 1; fix it, render again, then bun run sweep)`
    : `next: bun run sheet ${shown} overview${reference ? ` --vs ${reference}` : ""} (a clean sweep is not a good film: the eye still judges)`,
);
