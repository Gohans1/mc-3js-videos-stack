import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { cliArgs, numberArg } from "../../packages/live-studio/src/cli.mjs";
import { killProcessTree } from "../../packages/live-studio/src/kill-process.mjs";
import { startJob } from "../../packages/live-studio/src/tell.mjs";

async function runWorker(executable, args, minutes) {
  const child = spawn(executable, args, {
    stdio: "inherit",
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  let stopped = false;
  const stop = () => {
    stopped = true;
    if (child.pid) killProcessTree(child.pid, () => child.kill("SIGKILL"));
  };
  const timer = setTimeout(stop, minutes * 60_000);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let status;
  try {
    status = await new Promise((done, reject) => {
      child.once("error", reject);
      child.once("close", (code) => done(code ?? 1));
    });
  } catch (error) {
    console.error(`reference: ${error.message}`);
    status = 1;
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }

  return { status, stopped };
}

const HELP = `Optional reference analysis; never required to author a film.
  bun run reference inspect <video-or-URL>  Retained visual/transcript evidence; inspect --help for controls
  bun run reference study <video>
  bun run reference compare <reference> <remake>
  --out <folder>     Reports and comparison PNGs (default renders/reference/<video-name> or compare).
  --fit              Compare after scaling the remake's time to the reference's length (compare only).
  --film <film.html> Optional OpenFilm project for the upstream reused-media check (compare only).
  --minutes <N>      Stop analysis and its FFmpeg processes after N minutes (default 5, maximum 60).
study/compare need local video files and ffmpeg/ffprobe on PATH; no account or paid API.
inspect uses Python 3.11+ and ffmpeg/ffprobe for pictures; URL sources additionally use yt-dlp.
inspect --detail transcript skips media download/decoding and never starts a speech model.
Writes study.json/study.md or compare.json/compare.md with side-by-side PNGs in a fresh run-* subfolder; earlier evidence is kept.
Cuts and pace are image-change estimates, not recovered camera motion; flashes and equal-luminance cuts can fool them.
Metrics and reused-media detection are advisory, not a quality gate or a copyright certificate.
Exit 0: analysis finished; 1: failed analysis OR detected reference-media reuse (read the report); 2: usage error.
Analysis keeps completed reports but does not resume decoding after interruption; use short reference clips.
Examples: bun run reference inspect references/ref.mp4 --scenes --frames 16
          bun run reference study references/ref.mp4
          bun run reference compare references/ref.mp4 renders/draft.mp4 --fit`;

if (process.argv[2] === "inspect") {
  const args = process.argv.slice(3);
  const help = args.includes("--help") || args.includes("-h") || args[0] === "help";
  if (args[0] === "help") args[0] = "--help";
  if (!help)
    cliArgs(
      "",
      [
        "--transcript file",
        "--detail mode",
        "--start T",
        "--end T",
        "--at TIMES",
        "--frames N",
        "--scenes",
        "--find text",
        "--out folder",
        "--minutes N",
        "--expect-source-sha256 SHA",
        "--language code",
        "--cookies file",
        "--cookies-from-browser browser",
        "--js-runtime runtime",
      ],
      1,
      args,
    );
  const at = args.lastIndexOf("--minutes");
  const minutes = help
    ? 5
    : numberArg("--minutes", at >= 0 ? args[at + 1] : "5", { min: 0.01, max: 60 });
  const worker = fileURLToPath(new URL("./reference_inspect.py", import.meta.url));
  if (!help)
    console.error(
      `Reference inspection; stops after ${minutes} minute(s); no speech models or paid APIs.`,
    );
  const { status, stopped } = await runWorker("python", [worker, ...args], minutes);
  if (stopped)
    console.error(
      "reference inspect: deadline reached; inspect the printed partial index before retrying",
    );
  process.exit(status);
}

const argv = cliArgs(HELP, ["--out folder", "--fit", "--film file", "--minutes N"], 3);
const {
  positionals: [command, ...files],
  values,
} = parseArgs({
  args: argv,
  allowPositionals: true,
  options: {
    out: { type: "string" },
    fit: { type: "boolean" },
    film: { type: "string" },
    minutes: { type: "string" },
  },
});
const usage = (why) => {
  console.error(`${why}; bun run reference --help`);
  process.exit(2);
};
if (!["study", "compare"].includes(command) || files.length !== (command === "study" ? 1 : 2))
  usage("Choose study <video> or compare <reference> <remake>");
if (command === "study" && (values.fit || values.film)) usage("--fit and --film belong to compare");
const minutes = numberArg("--minutes", values.minutes ?? "5", { min: 0.01, max: 60 });
for (const file of [...files, ...(values.film ? [values.film] : [])])
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) usage(`No local file: ${file}`);
const base = resolve(
  values.out ??
    `renders/reference/${command === "study" ? basename(files[0], extname(files[0])) : "compare"}`,
);
let out;
try {
  mkdirSync(base, { recursive: true });
  out = mkdtempSync(join(base, `run-${Date.now()}-`));
} catch (error) {
  console.error(`reference: cannot create report folder ${base}: ${error.message}`);
  process.exit(1);
}
const worker = fileURLToPath(
  new URL("../../third-party/openfilm-replicate/measure.mjs", import.meta.url),
);
console.error(
  `Reference analysis (not a quality gate); stops after ${minutes} minute(s). Reports: ${out}`,
);
const ended = await startJob(process.cwd(), `reference ${command}`, {
  say: `Measuring ${basename(files[0])}`,
});
const { status, stopped } = await runWorker(
  process.execPath,
  [
    worker,
    command,
    ...files.map((f) => resolve(f)),
    "--out",
    out,
    ...(values.fit ? ["--fit"] : []),
    ...(values.film ? ["--film", resolve(values.film)] : []),
  ],
  minutes,
);
if (stopped)
  console.error(
    "reference: stopped before completion; completed reports remain, decoding must restart",
  );
await ended({
  say: `Reference ${command} ${status === 0 ? "finished" : "needs attention"}`,
  level: status === 0 ? "ok" : "warn",
});
const complete =
  !stopped &&
  [0, 1].includes(status) &&
  ["json", "md"].every((ext) =>
    statSync(join(out, `${command}.${ext}`), { throwIfNoEntry: false })?.isFile(),
  );
console.log(
  complete
    ? `next: read ${out}/${command}.json and ${out}/${command}.md; inspect comparison PNGs before deciding what to change`
    : `next: fix the error above and rerun the same reference command; partial files from this attempt only: ${out}`,
);
process.exitCode = complete ? status : 1;
