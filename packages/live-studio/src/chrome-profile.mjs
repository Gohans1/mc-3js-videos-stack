// Reusable, lock-protected headless Chrome profile slots under <PROJECT>/renders/.chrome-cache/slot-<n>
// so ANGLE/D3D11 GPU shader caches persist across render runs instead of recompiling from scratch every run.
import { randomUUID } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CACHE_DIR_NAME = ".chrome-cache";
export const DEFAULT_MAX_SLOTS = 8;
const STALE_PARSE_GRACE_MS = 5000;
const CONTENDED_CODES = new Set(["EEXIST", "EPERM", "EBUSY"]);

export const isPidAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code !== "ESRCH";
  }
};

// Returns "missing" (lock vanished), "stale" (dead PID or expired unreadable lock), or "live" (active/contended)
export const inspectLock = (
  lockPath,
  isAlive = isPidAlive,
  now = () => Date.now(),
  staleGraceMs = STALE_PARSE_GRACE_MS,
) => {
  let raw;
  try {
    raw = readFileSync(lockPath, "utf8");
  } catch (err) {
    return err?.code === "ENOENT" ? "missing" : "live";
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.pid === "number")
      return isAlive(parsed.pid) ? "live" : "stale";
  } catch {
    // Another process may still be flushing right after openSync("wx")
  }
  try {
    return now() - statSync(lockPath).mtimeMs > staleGraceMs ? "stale" : "live";
  } catch (err) {
    return err?.code === "ENOENT" ? "missing" : "live";
  }
};

const tryCreateLock = (lockPath, payload) => {
  let fd;
  try {
    fd = openSync(lockPath, "wx");
  } catch (err) {
    return { ok: false, code: err?.code ?? "ERR" };
  }
  try {
    writeSync(fd, payload);
  } catch (err) {
    try {
      closeSync(fd);
    } catch {}
    try {
      unlinkSync(lockPath);
    } catch {}
    return { ok: false, code: err?.code ?? "ERR" };
  }
  closeSync(fd);
  return { ok: true, code: null };
};

const acquireReclaimGuard = (reclaimPath, payload, now, staleGraceMs) => {
  const first = tryCreateLock(reclaimPath, payload);
  if (first.ok) return true;
  if (first.code !== "EEXIST") return false;
  let expired = false;
  try {
    expired = now() - statSync(reclaimPath).mtimeMs > staleGraceMs;
  } catch (err) {
    if (err?.code === "ENOENT") return tryCreateLock(reclaimPath, payload).ok;
    return false;
  }
  if (!expired) return false;
  try {
    unlinkSync(reclaimPath);
  } catch (err) {
    if (err?.code !== "ENOENT") return false;
  }
  return tryCreateLock(reclaimPath, payload).ok;
};

export function acquireChromeProfile(
  rendersDir,
  {
    fresh = false,
    maxSlots = DEFAULT_MAX_SLOTS,
    pid = process.pid,
    isAlive = isPidAlive,
    tempDir = tmpdir(),
    now = () => Date.now(),
    staleGraceMs = STALE_PARSE_GRACE_MS,
  } = {},
) {
  const makeEphemeral = () => {
    const dir = mkdtempSync(join(tempDir, `live_render_${pid}_`));
    let released = false;
    return {
      dir,
      slot: null,
      persistent: false,
      lockPath: null,
      release() {
        if (released) return;
        released = true;
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          // Chrome helper processes may briefly hold a file on Windows
        }
      },
    };
  };

  if (fresh || !rendersDir) return makeEphemeral();

  const cacheRoot = join(rendersDir, CACHE_DIR_NAME);
  try {
    mkdirSync(cacheRoot, { recursive: true });
  } catch {
    return makeEphemeral();
  }

  for (let slot = 0; slot < maxSlots; slot++) {
    const lockPath = join(cacheRoot, `slot-${slot}.lock`);
    const dir = join(cacheRoot, `slot-${slot}`);
    const token = randomUUID();
    const payload = JSON.stringify({
      pid,
      startedAt: new Date(now()).toISOString(),
      token,
    });

    let attempt = tryCreateLock(lockPath, payload);
    if (!attempt.ok && attempt.code === "EEXIST") {
      const state = inspectLock(lockPath, isAlive, now, staleGraceMs);
      if (state === "missing") {
        // Disappeared between EEXIST and inspectLock: retry atomically without unlinking
        attempt = tryCreateLock(lockPath, payload);
      } else if (state === "stale") {
        const reclaimPath = `${lockPath}.reclaim`;
        if (acquireReclaimGuard(reclaimPath, payload, now, staleGraceMs)) {
          try {
            const rechecked = inspectLock(lockPath, isAlive, now, staleGraceMs);
            if (rechecked === "stale") {
              try {
                unlinkSync(lockPath);
              } catch (err) {
                if (err?.code !== "ENOENT") continue;
              }
              attempt = tryCreateLock(lockPath, payload);
            } else if (rechecked === "missing") {
              attempt = tryCreateLock(lockPath, payload);
            }
          } finally {
            try {
              unlinkSync(reclaimPath);
            } catch {}
          }
        }
      }
    }

    if (!attempt.ok) {
      if (CONTENDED_CODES.has(attempt.code)) continue;
      return makeEphemeral();
    }

    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      try {
        unlinkSync(lockPath);
      } catch {}
      return makeEphemeral();
    }

    let released = false;
    return {
      dir,
      slot,
      persistent: true,
      lockPath,
      release() {
        if (released) return;
        released = true;
        try {
          const current = JSON.parse(readFileSync(lockPath, "utf8"));
          if (current?.token !== token) return;
        } catch {
          return;
        }
        try {
          unlinkSync(lockPath);
        } catch {}
      },
    };
  }

  return makeEphemeral();
}
