import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cliArgs, numberArg } from "../packages/live-studio/src/cli.mjs";
import { ffmpegCli } from "./media/ffmpeg.mjs";
import { runMediaJob } from "./media/job.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOOLS = JSON.parse(readFileSync(join(ROOT, "scripts/media/tools.json"), "utf8"));
const HOME = resolve(process.env.MC_MEDIA_HOME || join(ROOT, "vault/tools/media"));
const PYTHON_STDIO = { PYTHONIOENCODING: "utf-8" };
const BUNDLED = {
  id: "ffmpeg",
  name: "ffmpeg-skill",
  version: "3.10.1",
  codeLicense: "MIT",
  summary:
    "Bundled optional footage finishing/QC tools; media ffmpeg list and contract for native arguments.",
  source: "https://github.com/kajisho5/ffmpeg-skill/tree/v3.10.1",
};
const TOOL_GROUPS = [
  [
    "Audio",
    [
      "separate",
      "beat",
      "locate",
      "vad",
      "ced",
      "denoise",
      "effects",
      "melody",
      "midi",
      "tts",
      "fingerprint",
      "caption",
      "foley",
      "metadata",
    ],
  ],
  ["Visual", ["ocr", "vision", "tapir", "track"]],
  ["Finish", ["ffmpeg", "qc", "timeline"]],
];
const ALL_TOOL_IDS = [...Object.keys(TOOLS), BUNDLED.id];
const GROUPED_IDS = new Set(TOOL_GROUPS.flatMap(([, ids]) => ids));
const EXTRA_TOOL_IDS = ALL_TOOL_IDS.filter((id) => !GROUPED_IDS.has(id));
const TOOL_LABELS = {
  ffmpeg: "ffmpeg (ffmpeg list / schema <tool>)",
  qc: "qc (--contract)",
  timeline: "timeline (OTIO)",
};
const TOOL_LINES = [
  ...TOOL_GROUPS.map(([label, ids]) => [label, ids.filter((id) => ALL_TOOL_IDS.includes(id))]),
  ...(EXTRA_TOOL_IDS.length ? [["Other", EXTRA_TOOL_IDS]] : []),
]
  .filter(([, ids]) => ids.length)
  .map(
    ([label, ids]) =>
      `  ${`${label}:`.padEnd(9)}${ids.map((id) => TOOL_LABELS[id] ?? id).join(", ")}`,
  )
  .join("\n");
const HELP = `Optional local media tools for AI, with independent environments and retained evidence.
  bun run media list [--json]             Available tools and upstream/license information
  bun run media doctor [tool] [--json]    Installed packages, binaries and runtimes; does not load/download models
  bun run media setup <tool>              Install pinned packages or verified Windows binaries/models
  bun run media <tool> --help             Tool-specific inputs, outputs and native configuration
  bun run media <tool> <arguments>        Run a structured local adapter
  bun run media ffmpeg --help             Pinned FFmpeg finishing/inspection backend, native contract
  --out DIR       Parent for fresh run-* evidence folders (default renders/media/<tool>)
  --minutes N     Wall-clock deadline (default 5; setup default 10). Logs and finished files survive failure.
Tools (bun run media <tool> --help for syntax and limits):
${TOOL_LINES}
MC_MEDIA_HOME overrides the environment/model cache root (default vault/tools/media).
setup uses the network; execution is local, free and does not upload media. First model
use may download official weights, as each tool's help says. Models remain cached.
Output: job.json/process.log plus tool artifacts, preserving all previous runs.
Examples: bun run media doctor --json
          bun run media ocr reference.mp4 --at 5,10 --language vi
          bun run media separate clip.mp4 --from 0 --to 20
          bun run media ffmpeg probe -- clip.mp4 --keyframes-near 1,3
Built-ins are conveniences; native configuration and custom creative code stay available.`;
const fail = (message) => {
  console.error(`${message}; bun run media --help`);
  process.exit(2);
};
const python = (id) =>
  join(HOME, id, "env", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const runtimeVersions = (binaries) =>
  Object.fromEntries(
    binaries.map((binary) => {
      const result = spawnSync(binary, [binary === "python" ? "--version" : "-version"], {
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
      });
      return [
        binary,
        { available: result.status === 0, version: result.stdout?.split(/\r?\n/)[0] },
      ];
    }),
  );
const [verb, ...rest] = process.argv.slice(2);

if (verb === "ffmpeg") {
  await ffmpegCli(rest);
  process.exit(process.exitCode ?? 0);
}

if (!verb || ["help", "--help", "-h"].includes(verb)) {
  console.log(HELP);
  process.exit(0);
}
if (verb === "list" || verb === "doctor") {
  const args = cliArgs(HELP, ["--json"], verb === "doctor" ? 1 : 0, rest);
  const id = args.find((arg) => arg !== "--json");
  if (id && !TOOLS[id] && id !== "ffmpeg") fail(`unknown tool ${id}`);
  const results = Object.entries(TOOLS)
    .filter(([key]) => !id || key === id)
    .map(([key, tool]) => {
      const result = {
        id: key,
        ...tool,
        ...(tool.runtime
          ? {}
          : tool.binary
            ? { binaryPath: join(HOME, key, tool.binary) }
            : { pythonPath: python(key) }),
      };
      if (verb === "doctor") result.installed = false;
      if (verb === "doctor" && tool.runtime) {
        result.runtime = runtimeVersions(tool.runtime);
        result.installed = Object.values(result.runtime).every((runtime) => runtime.available);
      } else if (verb === "doctor" && tool.binary) {
        const required = [
          tool.binary,
          tool.defaultModel,
          tool.defaultProjector,
          tool.defaultSoundfont,
          ...(tool.requiredFiles ?? []),
        ].filter(Boolean);
        try {
          const receipt = JSON.parse(readFileSync(join(HOME, key, "installed.json"), "utf8"));
          result.installed =
            receipt.status === "completed" &&
            required.every((file) => statSync(join(HOME, key, file)).isFile()) &&
            tool.assets.every(
              (asset) =>
                statSync(join(HOME, key, asset.path)).size === asset.size &&
                receipt.assets.some(
                  (record) =>
                    record.path === asset.path && record.sha256 === asset.sha256 && record.verified,
                ),
            );
        } catch {
          result.installed = false;
        }
        result.version = tool.version;
      } else if (verb === "doctor" && existsSync(result.pythonPath)) {
        const probe = spawnSync(
          result.pythonPath,
          [
            "-c",
            "import importlib.metadata as m,sys,json; print(json.dumps({p:m.version(p) for p in sys.argv[1:]}))",
            ...tool.packages.map((pkg) => pkg.match(/^[\w.-]+/)[0]),
          ],
          { encoding: "utf8", timeout: 10_000, windowsHide: true },
        );
        result.installed = probe.status === 0;
        if (result.installed) result.versions = JSON.parse(probe.stdout);
        else result.error = probe.error?.message ?? probe.stderr.trim();
      }
      return result;
    });
  if (!id || id === "ffmpeg") {
    const bundled = { ...BUNDLED };
    if (verb === "doctor") {
      bundled.runtime = runtimeVersions(["python", "ffmpeg", "ffprobe"]);
      bundled.installed = Object.values(bundled.runtime).every((runtime) => runtime.available);
    }
    results.push(bundled);
  }
  if (args.includes("--json")) console.log(JSON.stringify(results, null, 2));
  else
    for (const tool of results)
      console.log(
        `${tool.id}: ${tool.name} — ${tool.summary}${verb === "doctor" ? ` (${tool.installed ? (tool.id === "ffmpeg" ? "runtime ready; media ffmpeg doctor for capabilities" : tool.binary ? "setup complete; run tool to verify runtime" : "packages ready; model availability is separate") : "needs setup"})` : ""}\n  ${tool.source}`,
      );
  process.exit(verb === "doctor" && results.some((tool) => !tool.installed) ? 1 : 0);
}
const setup = verb === "setup";
if (setup && (rest.some((arg) => ["--help", "-h"].includes(arg)) || rest[0] === "help")) {
  console.log(HELP);
  process.exit(0);
}
const id = setup ? rest.shift() : verb;
const tool = TOOLS[id];
if (!tool) fail(`unknown tool ${id ?? "(missing)"}; available: ${Object.keys(TOOLS).join(", ")}`);
if (rest.some((arg) => ["--help", "-h"].includes(arg)) || rest[0] === "help") {
  if (setup) console.log(HELP);
  else {
    const help = spawnSync(
      "python",
      ["-B", join(ROOT, tool.worker), ...(tool.arguments ?? []), "--help"],
      {
        encoding: "utf8",
        timeout: 15_000,
        windowsHide: true,
        env: { ...process.env, ...PYTHON_STDIO },
      },
    );
    process.stdout.write(help.stdout ?? "");
    process.stderr.write(help.stderr ?? "");
    process.exit(help.status ?? 1);
  }
  process.exit(0);
}
let out = resolve("renders/media", id);
let minutes = setup ? 10 : 5;
const args = [];
for (let i = 0; i < rest.length; i++) {
  if (/^--[^=]+=/.test(rest[i]))
    fail(
      `write ${rest[i].replace("=", " ")}: a space between an option and its value, instead of =`,
    );
  if (["--out", "--minutes"].includes(rest[i])) {
    const flag = rest[i];
    const value = rest[++i];
    if (!value || value.startsWith("--")) fail(`${flag} needs a value`);
    if (flag === "--out") out = resolve(value);
    else minutes = numberArg(flag, value, { min: Number.MIN_VALUE });
  } else args.push(rest[i]);
}
const finish = (report) => {
  console.log(JSON.stringify(report, null, 2));
  return report.status === "completed";
};
if (setup) {
  cliArgs(HELP, [], 0, args);
  const commands = [];
  if (tool.packages.length && !existsSync(python(id)))
    commands.push(["uv", "venv", "--python", tool.python, join(HOME, id, "env")]);
  if (tool.packages.length)
    if (tool.cpuPackages?.length)
      commands.push([
        "uv",
        "pip",
        "install",
        "--python",
        python(id),
        ...tool.cpuPackages,
        "--index-url",
        "https://download.pytorch.org/whl/cpu",
      ]);
  if (tool.packages.length)
    commands.push(["uv", "pip", "install", "--python", python(id), ...tool.packages]);
  if (tool.assets?.length || tool.build)
    commands.push(["python", join(ROOT, "scripts/media/install.py"), id, "--home", HOME]);
  for (const command of commands) {
    if (!finish(await runMediaJob({ tool: `setup:${id}`, command, out, minutes }))) process.exit(1);
  }
} else {
  if (args[0] === "help") args[0] = "--help";
  const worker = join(ROOT, tool.worker);
  const preflight = spawnSync(
    "python",
    ["-B", worker, ...(tool.arguments ?? []), ...args, "--dry-run"],
    {
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
      env: { ...process.env, ...PYTHON_STDIO, MC_MEDIA_TOOL_HOME: join(HOME, id) },
    },
  );
  if (
    preflight.status !== 0 ||
    args.some((arg) => ["--help", "-h", "--dry-run", ...(tool.discoveryFlags ?? [])].includes(arg))
  ) {
    process.stdout.write(preflight.stdout ?? "");
    process.stderr.write(preflight.stderr ?? "");
    if (preflight.error) console.error(preflight.error.message);
    process.exit(preflight.status ?? 1);
  }
  const plan = JSON.parse(preflight.stdout);
  for (const file of plan.requiredFiles ?? [])
    if (!existsSync(file)) fail(`missing ${file}: bun run media setup ${id}`);
  if (tool.packages.length && !existsSync(python(id)))
    fail(`tool ${id} is not installed: bun run media setup ${id}`);
  const models = join(HOME, id, "models");
  mkdirSync(models, { recursive: true });
  console.error(`Running ${tool.name}; deadline ${minutes} min; evidence parent: ${out}`);
  const report = await runMediaJob({
    tool: id,
    command: [
      tool.packages.length ? python(id) : "python",
      "-B",
      worker,
      ...(tool.arguments ?? []),
      ...args,
    ],
    out,
    minutes,
    env: {
      ...PYTHON_STDIO,
      MC_MEDIA_MODELS_DIR: models,
      MC_MEDIA_TOOL_HOME: join(HOME, id),
      MC_MEDIA_TIMEOUT_SECONDS: String(minutes * 60),
    },
  });
  if (tool.worker === "scripts/media/sdk.py" && report.artifacts.includes("result.json")) {
    const result = JSON.parse(readFileSync(join(report.folder, "result.json"), "utf8"));
    if (result.audioCoverage) report.audioCoverage = result.audioCoverage;
    if (result.error) report.error ??= result.error;
  }
  process.exit(finish(report) ? 0 : report.status === "interrupted" ? 130 : 1);
}
