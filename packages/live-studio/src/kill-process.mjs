import { spawnSync } from "node:child_process";

export function killProcessTree(pid, fallbackKill) {
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
        timeout: 5000,
      });
    } catch {}
    try {
      fallbackKill();
    } catch {}
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
    } catch {}
  }, 1500).unref?.();
}
