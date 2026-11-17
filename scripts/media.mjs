import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cliArgs, numberArg } from "../packages/live-studio/src/cli.mjs";
import { runMediaJob } from "./media/job.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOOLS = JSON.parse(readFileSync(join(ROOT, "scripts/media/tools.json"), "utf8"));
const HOME = resolve(process.env.MC_MEDIA_HOME || join(ROOT, "vault/tools/media"));
const HELP = `Optional local media tools for AI, with independent environments and retained evidence.
  bun run media list [--json]             Available tools and upstream/license information
  bun run media doctor [tool] [--json]    Installed package versions; does not load/download models
  bun run media setup <tool>              Install pinned packages or verified Windows binaries/models
  bun run media <tool> --help             Tool-specific inputs, outputs and native configuration
  bun run media <tool> <arguments>        Run a structured local adapter
  --out DIR       Parent for fresh run-* evidence folders (default renders/media/<tool>)
  --minutes N     Wall-clock deadline (default 5; setup default 10). Logs and finished files survive failure.
MC_MEDIA_HOME overrides the environment/model cache root (default vault/tools/media).
setup uses the network; execution is local, free and does not upload media. First model
use may download official weights, as each tool's help says. Models remain cached.
Output: job.json/process.log plus tool artifacts, preserving all previous runs.
Examples: bun run media setup ocr
          bun run media ocr reference.mp4 --at 5,10 --minutes 5
          bun run media ocr image.png --language vi
Built-ins are conveniences; native configuration and custom creative code stay available.`;
const fail = (message) => {
  console.error(`${message}; bun run media --help`);
  process.exit(2);
};
const python = (id) =>
  join(HOME, id, "env", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const [verb, ...rest] = process.argv.slice(2);

if (!verb || ["help", "--help", "-h"].includes(verb)) {
  console.log(HELP);
  process.exit(0);
}
if (verb === "list" || verb === "doctor") {
  const args = cliArgs(HELP, ["--json"], verb === "doctor" ? 1 : 0, rest);
  const id = args.find((arg) => arg !== "--json");
  if (id && !TOOLS[id]) fail(`unknown tool ${id}`);
  const results = Object.entries(TOOLS)
    .filter(([key]) => !id || key === id)
    .map(([key, tool]) => {
      const result = {
        id: key,
        ...tool,
        ...(tool.binary
          ? { binaryPath: join(HOME, key, tool.binary) }
          : { pythonPath: python(key) }),
      };
      if (verb === "doctor") result.installed = false;
      if (verb === "doctor" && tool.binary) {
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
            ...tool.packages.map((pkg) => pkg.split(/[<>=]/, 1)[0].split("[", 1)[0]),
          ],
          { encoding: "utf8", timeout: 10_000, windowsHide: true },
        );
        result.installed = probe.status === 0;
        if (result.installed) result.versions = JSON.parse(probe.stdout);
        else result.error = probe.error?.message ?? probe.stderr.trim();
      }
      return result;
    });
  if (args.includes("--json")) console.log(JSON.stringify(results, null, 2));
  else
    for (const tool of results)
      console.log(
        `${tool.id}: ${tool.name} — ${tool.summary}${verb === "doctor" ? ` (${tool.installed ? (tool.binary ? "setup complete; run tool to verify runtime" : "packages ready; model availability is separate") : "needs setup"})` : ""}\n  ${tool.source}`,
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
      [join(ROOT, tool.worker), ...(tool.arguments ?? []), "--help"],
      {
        encoding: "utf8",
        timeout: 15_000,
        windowsHide: true,
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
  const preflight = spawnSync("python", [worker, ...(tool.arguments ?? []), ...args, "--dry-run"], {
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
    env: { ...process.env, MC_MEDIA_TOOL_HOME: join(HOME, id) },
  });
  if (preflight.status !== 0 || args.some((arg) => ["--help", "-h", "--dry-run"].includes(arg))) {
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
      worker,
      ...(tool.arguments ?? []),
      ...args,
    ],
    out,
    minutes,
    env: {
      MC_MEDIA_MODELS_DIR: models,
      MC_MEDIA_TOOL_HOME: join(HOME, id),
      MC_MEDIA_TIMEOUT_SECONDS: String(minutes * 60),
    },
  });
  process.exit(finish(report) ? 0 : report.status === "interrupted" ? 130 : 1);
}
