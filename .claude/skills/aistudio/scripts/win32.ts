// Keeps the skill's off-screen Chrome windows out of the user's way, through user32.dll (Windows only).
import { dlopen } from "bun:ffi";

// Win32 BOOL is a 32-bit int, so it is declared i32 rather than Bun's 1-byte bool. Bun's docs say to pass HWNDs as u64.
const user32 = dlopen("user32.dll", {
  FindWindowExW: { args: ["u64", "u64", "ptr", "ptr"], returns: "u64" },
  GetWindow: { args: ["u64", "u32"], returns: "u64" },
  GetWindowThreadProcessId: { args: ["u64", "ptr"], returns: "u32" },
  IsWindowVisible: { args: ["u64"], returns: "i32" },
  GetWindowPlacement: { args: ["u64", "ptr"], returns: "i32" },
  GetWindowLongPtrW: { args: ["u64", "i32"], returns: "i64" },
  SetWindowLongPtrW: { args: ["u64", "i32", "i64"], returns: "i64" },
  SetWindowPos: { args: ["u64", "u64", "i32", "i32", "i32", "i32", "u32"], returns: "i32" },
  ShowWindow: { args: ["u64", "i32"], returns: "i32" },
  LockSetForegroundWindow: { args: ["u32"], returns: "i32" },
  GetThreadDesktop: { args: ["u32"], returns: "u64" },
  GetUserObjectInformationW: { args: ["u64", "i32", "ptr", "u32", "ptr"], returns: "i32" },
}).symbols;
const kernel32 = dlopen("kernel32.dll", {
  CreateMutexW: { args: ["ptr", "i32", "ptr"], returns: "u64" },
  WaitForSingleObject: { args: ["u64", "u32"], returns: "u32" },
  ReleaseMutex: { args: ["u64"], returns: "i32" },
  CloseHandle: { args: ["u64"], returns: "i32" },
  GetCurrentThreadId: { args: [], returns: "u32" },
}).symbols;

const GW_OWNER = 4;
const GWL_EXSTYLE = -20;
const WS_EX_TRANSPARENT = 0x20n;
const WS_EX_TOOLWINDOW = 0x80n;
const WS_EX_NOACTIVATE = 0x8000000n;
const WS_EX_APPWINDOW = 0x40000n;
const SHIELD = WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT;
const HWND_BOTTOM = 1n;
const SWP_NOSIZE = 0x1;
const SWP_NOMOVE = 0x2;
const SWP_NOACTIVATE = 0x10;
const SWP_NOOWNERZORDER = 0x200;
const UOI_NAME = 2;
const SW_HIDE = 0;
const SW_SHOWMINIMIZED = 2;
const SW_SHOWNOACTIVATE = 4;
const SW_SHOWMINNOACTIVE = 7;
const LSFW_LOCK = 1;
const LSFW_UNLOCK = 2;
const WAIT_TIMEOUT = 0x102;
const TURN_MUTEX = Uint16Array.from("Local\\aistudio-prepare-tab\0", (c) => c.charCodeAt(0));
const TURN_WAIT_MS = 15_000;
const CHROME_WINDOW = Uint16Array.from("Chrome_WidgetWin_1\0", (c) => c.charCodeAt(0));

export function currentDesktopName(): string {
  const desk = user32.GetThreadDesktop(kernel32.GetCurrentThreadId());
  if (!desk) return "";
  const buf = new Uint16Array(128);
  const need = new Uint32Array(1);
  if (!user32.GetUserObjectInformationW(desk, UOI_NAME, buf, buf.byteLength, need)) return "";
  const chars = Math.max(0, Math.floor((need[0] ?? 0) / 2) - 1);
  return String.fromCharCode(...buf.slice(0, chars));
}

export function shouldMigrateChromeDesktop(opts: {
  livePid: number;
  recordedPid?: number;
  recordedDesktop?: string;
  currentDesktop: string;
  show: boolean;
  hasVisibleOnCurrentDesktop: boolean;
}): boolean {
  const {
    livePid,
    recordedPid,
    recordedDesktop,
    currentDesktop,
    show,
    hasVisibleOnCurrentDesktop,
  } = opts;
  if (!currentDesktop) return false;
  const knownDesktop = recordedPid === livePid ? (recordedDesktop ?? "") : "";
  if (show) {
    if (knownDesktop && knownDesktop !== currentDesktop) return true;
    if (!knownDesktop && !hasVisibleOnCurrentDesktop) return true;
    return false;
  }
  if (currentDesktop === "Default") return false;
  if (knownDesktop === "Default") return true;
  if (!knownDesktop && !hasVisibleOnCurrentDesktop) return true;
  return false;
}

const ownerPid = (h: bigint) => {
  const pid = new Uint32Array(1);
  user32.GetWindowThreadProcessId(h, pid);
  return pid[0];
};

function placement(h: bigint) {
  const p = new Int32Array(11);
  p[0] = p.byteLength;
  user32.GetWindowPlacement(h, p);
  return p;
}

const isHidden = (p: Int32Array, hiddenLeft: number) => p[7]! <= hiddenLeft / 2;

function framesOf(pid: number): bigint[] {
  const found: bigint[] = [];
  for (let h = user32.FindWindowExW(0n, 0n, CHROME_WINDOW, null); h;) {
    if (ownerPid(h) === pid && user32.IsWindowVisible(h) && !user32.GetWindow(h, GW_OWNER))
      found.push(h);
    h = user32.FindWindowExW(0n, h, CHROME_WINDOW, null);
  }
  return found;
}

export const hasVisibleFrames = (pid: number) => framesOf(pid).length > 0;

export function guardWindows(
  pid: number,
  hiddenLeft: number,
  opts: { allowOnScreen?: boolean } = {},
) {
  const frames = framesOf(pid);
  let restored = 0;
  let pushedBack = 0;
  for (const h of frames) {
    const p = placement(h);
    let hidden = isHidden(p, hiddenLeft);
    if (!hidden && !opts.allowOnScreen) {
      user32.SetWindowPos(
        h,
        HWND_BOTTOM,
        hiddenLeft,
        0,
        0,
        0,
        SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
      );
      hidden = true;
      pushedBack++;
    }
    if (hidden && p[2] === SW_SHOWMINIMIZED) {
      user32.ShowWindow(h, SW_SHOWNOACTIVATE);
      restored++;
    }
    const ex = BigInt(user32.GetWindowLongPtrW(h, GWL_EXSTYLE));
    const want = hidden ? (ex | SHIELD) & ~WS_EX_APPWINDOW : ex & ~SHIELD;
    if (want !== ex) {
      const minimized = placement(h)[2] === SW_SHOWMINIMIZED;
      user32.ShowWindow(h, SW_HIDE);
      user32.SetWindowLongPtrW(h, GWL_EXSTYLE, want);
      user32.ShowWindow(h, minimized ? SW_SHOWMINNOACTIVE : SW_SHOWNOACTIVATE);
    }
    if (hidden) {
      user32.SetWindowPos(
        h,
        HWND_BOTTOM,
        0,
        0,
        0,
        0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
      );
    }
  }
  return { found: frames.length, restored, pushedBack };
}

/**
 * Runs fn with every app barred from taking the foreground (LockSetForegroundWindow, made for this): Chrome activates a
 * window when agent-browser switches to its tab or a new session opens its blank tab, and Windows allows it when the
 * user has been idle a while or works in the agent's parent app. A user click or Alt lifts the lock early by design.
 * Only one process can hold the lock, so commands take turns on a named mutex (another tab preparing in parallel would
 * otherwise run unlocked). Windows also refuses the lock (locked is false, same error 5) to a process that may not
 * change the foreground itself, e.g. while the user has not touched the agent's app; Chrome usually may not either.
 */
export async function withForegroundLocked<T>(fn: (locked: boolean) => Promise<T>): Promise<T> {
  const turn = kernel32.CreateMutexW(null, 0, TURN_MUTEX);
  // WAIT_ABANDONED (a command died holding it) still hands over the turn.
  const owned = turn !== 0n && kernel32.WaitForSingleObject(turn, TURN_WAIT_MS) !== WAIT_TIMEOUT;
  const locked = user32.LockSetForegroundWindow(LSFW_LOCK) !== 0;
  try {
    return await fn(locked);
  } finally {
    if (locked) user32.LockSetForegroundWindow(LSFW_UNLOCK);
    if (owned) kernel32.ReleaseMutex(turn);
    if (turn) kernel32.CloseHandle(turn);
  }
}
