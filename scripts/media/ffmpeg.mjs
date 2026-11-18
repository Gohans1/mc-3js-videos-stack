import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cliArgs, numberArg } from "../../packages/live-studio/src/cli.mjs";
import { runMediaJob } from "./job.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const VENDOR = join(ROOT, "third-party/ffmpeg-skill");
const HELP = `Pinned ffmpeg-skill backend; optional tools, no imported skill workflow.
  bun run media ffmpeg list [--json]                  Compact tool/overlap inventory
  bun run media ffmpeg schema <tool>                 One native tool spec, without global contract
  bun run media ffmpeg contract -- --static --tool cut  Parser-derived native contract
  bun run media ffmpeg doctor [--minutes 1]           Actual FFmpeg capabilities and evidence
  bun run media ffmpeg <tool> --help                  Native parser help, no processing
  bun run media ffmpeg <tool> [--out DIR] [--minutes N] -- <native arguments>
Use -- to separate wrapper controls from ALL native arguments; native -o/--output is a FILE.
Default deadline: 5 minutes, maximum: 1440. Each run keeps job.json, native.json,
process.log and result.json under a fresh run-* folder. Native output paths are unchanged:
pass -o explicitly, or read the native help for its default (often beside the source).
Native --dry-run can analyze media; verify ignores it; speech models may download.
An exit 0 records execution only: inspect native.verified, unverified, source_carry,
warnings, skipped and fallbacks. No semantic listening/viewing or film-clock conversion.
Examples: bun run media ffmpeg probe -- clip.mp4 --keyframes-near 1,3
          bun run media ffmpeg export --minutes 10 -- clip.mp4 --preset prores -o master.mov
          bun run media ffmpeg check -- draft.mp4 --compare old.mp4 --expect-changed 1-3`;

const fail = (message) => {
  console.error(`${message}; bun run media ffmpeg --help`);
  process.exit(2);
};
function python(args) {
  return spawnSync("python", ["-B", ...args], {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
}
function printProcess(result) {
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}

export async function ffmpegCli(argv) {
  const [tool, ...rest] = argv;
  if (!tool || ["help", "-h", "--help"].includes(tool)) {
    console.log(HELP);
    return;
  }
  const separator = rest.indexOf("--");
  const controls = separator < 0 ? rest : rest.slice(0, separator);
  const native = separator < 0 ? [] : rest.slice(separator + 1);
  const contractScript = join(VENDOR, "scripts/_contract.py");
  if (tool === "contract") {
    cliArgs(HELP, [], 0, controls);
    printProcess(python([contractScript, ...native]));
  }
  const inventory = python([contractScript, "--static"]);
  if (inventory.status !== 0) printProcess(inventory);
  const specs = JSON.parse(inventory.stdout).tools;
  if (tool === "schema") {
    cliArgs(HELP, [], 1, controls);
    if (native.length) fail("schema takes one tool name before any -- separator");
    const spec = specs.find((spec) => spec.name === controls[0]);
    if (!spec) fail("schema needs a native tool name, e.g. schema cut");
    console.log(JSON.stringify(spec, null, 2));
    return;
  }
  if (tool === "list") {
    cliArgs(HELP, ["--json"], 0, controls);
    if (native.length) fail("list takes no native arguments");
    const decisions = JSON.parse(readFileSync(join(VENDOR, "adoption.json"), "utf8"));
    const rows = specs.map((spec) => ({
      name: spec.name,
      summary: spec.description,
      adoption: decisions[spec.name],
      reencodesAudio: spec.reencodes_audio,
      reencodesVideo: spec.reencodes_video,
      dryRun: spec.dry_run,
      unverified: spec.unverified_properties,
    }));
    console.log(
      controls.includes("--json")
        ? JSON.stringify(rows, null, 2)
        : rows.map((row) => `${row.name}: ${row.adoption}\n  ${row.summary}`).join("\n"),
    );
    return;
  }
  if (tool !== "doctor" && !specs.some((spec) => spec.name === tool))
    fail(`unknown native tool ${tool}`);
  const script = tool === "doctor" ? contractScript : join(VENDOR, `scripts/${tool}.py`);
  if (controls.some((arg) => ["-h", "--help"].includes(arg)) || controls[0] === "help") {
    if (tool === "doctor") {
      console.log(HELP);
      return;
    }
    printProcess(python([script, "--help"]));
  }
  cliArgs(HELP, ["--out DIR", "--minutes N"], 0, controls);
  let out = resolve("renders/media/ffmpeg", tool),
    minutes = 5;
  for (let i = 0; i < controls.length; i++) {
    const flag = controls[i],
      value = controls[++i];
    if (flag === "--out") out = resolve(value);
    else minutes = numberArg(flag, value, { min: 1 / 60, max: 1440 });
  }
  if (tool !== "doctor" && separator < 0) fail("native arguments require a -- separator");
  const args = tool === "doctor" ? ["doctor", "--json", ...native] : ["--json", ...native];
  console.error(`Running ffmpeg-skill ${tool}; deadline ${minutes} min; evidence parent: ${out}`);
  const report = await runMediaJob({
    tool: `ffmpeg:${tool}`,
    command: ["python", "-B", script, ...args],
    out,
    minutes,
    stdoutFile: "native.json",
    env: { PYTHONIOENCODING: "utf-8" },
  });
  report.resultFile = join(report.folder, "result.json");
  const stdout = readFileSync(join(report.folder, "native.json"), "utf8");
  const parseNative = (payload) =>
    JSON.parse(payload, (_key, value, context) =>
      Number.isInteger(value) &&
      !Number.isSafeInteger(value) &&
      /^-?\d+$/.test(context?.source ?? "")
        ? context.source
        : value,
    );
  try {
    report.native = parseNative(stdout);
    report.nativeFormat = "json";
  } catch {
    try {
      const lines = stdout.trim().split(/\r?\n/);
      if (lines.length < 2) throw new Error("not JSONL");
      report.native = lines.map(parseNative);
      report.nativeFormat = "jsonl";
    } catch {
      report.nativeFormat = stdout.trim() ? "text" : "empty";
    }
  }
  writeFileSync(report.resultFile, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === "completed" ? 0 : report.status === "interrupted" ? 130 : 1;
}
