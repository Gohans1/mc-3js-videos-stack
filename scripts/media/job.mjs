import { spawn } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { killProcessTree } from "../../packages/live-studio/src/kill-process.mjs";

export async function runMediaJob({ tool, command, out, minutes, cwd = process.cwd(), env = {} }) {
  mkdirSync(out, { recursive: true });
  const folder = mkdtempSync(join(resolve(out), "run-"));
  const file = join(folder, "job.json");
  const report = {
    schemaVersion: 1,
    tool,
    folder,
    command,
    cwd,
    minutes,
    startedAt: new Date().toISOString(),
    status: "running",
  };
  const save = () => {
    writeFileSync(`${file}.tmp`, JSON.stringify(report, null, 2) + "\n");
    renameSync(`${file}.tmp`, file);
  };
  save();
  const log = openSync(join(folder, "process.log"), "a");
  let child;
  let stopped;
  let timer;
  const stop = (status) => {
    if (stopped) return;
    stopped = status;
    if (child?.pid) killProcessTree(child.pid, () => child.kill("SIGKILL"));
  };
  const interrupt = () => stop("interrupted");
  try {
    child = spawn(command[0], command.slice(1), {
      cwd,
      env: { ...process.env, ...env, MC_MEDIA_RUN_DIR: folder },
      stdio: ["ignore", log, log],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    timer = setTimeout(() => stop("timed_out"), minutes * 60_000);
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    const code = await new Promise((done, fail) => {
      child.once("error", fail);
      child.once("close", done);
    });
    report.exitCode = code;
    report.status = stopped ?? (code === 0 ? "completed" : "failed");
  } catch (error) {
    report.status = stopped ?? "failed";
    report.error = error.message;
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    closeSync(log);
  }
  report.finishedAt = new Date().toISOString();
  report.artifacts = readdirSync(folder).filter((name) => name !== "job.json");
  save();
  return report;
}
