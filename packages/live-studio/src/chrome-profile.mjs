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

export const isPidAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code !== "ESRCH";
  }
};

const isStaleLock = (lockPath, isAlive, now, staleGraceMs) => {
  let raw;
  try {
    raw = readFileSync(lockPath, "utf8");
  } catch (err) {
    return err?.code === "ENOENT";
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.pid === "number")
      return !isAlive(parsed.pid);
  } catch {
    // Another process may still be flushing right after openSync("wx")
  }
  try {
    return now() - statSync(lockPath).mtimeMs > staleGraceMs;
  } catch (err) {
    return err?.code === "ENOENT";
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
      if (isStaleLock(lockPath, isAlive, now, staleGraceMs)) {
        try {
          unlinkSync(lockPath);
        } catch (err) {
          if (err?.code !== "ENOENT") continue;
        }
        attempt = tryCreateLock(lockPath, payload);
      }
    }

    if (!attempt.ok) {
      if (attempt.code === "EEXIST") continue;
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
