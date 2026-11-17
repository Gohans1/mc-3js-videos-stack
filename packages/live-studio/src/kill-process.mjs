import { spawnSync } from "node:child_process";

export function killProcessTree(pid, fallbackKill) {
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {
      /* fallback below */
    }
    try {
      fallbackKill();
    } catch {
      /* already exited */
    }
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      fallbackKill();
    } catch {
      return;
    }
  }
  setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* exited cleanly */
    }
  }, 1500).unref?.();
}
