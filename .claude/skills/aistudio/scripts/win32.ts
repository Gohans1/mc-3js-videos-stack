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
  ShowWindow: { args: ["u64", "i32"], returns: "i32" },
  LockSetForegroundWindow: { args: ["u32"], returns: "i32" },
}).symbols;
const kernel32 = dlopen("kernel32.dll", {
  CreateMutexW: { args: ["ptr", "i32", "ptr"], returns: "u64" },
  WaitForSingleObject: { args: ["u64", "u32"], returns: "u32" },
  ReleaseMutex: { args: ["u64"], returns: "i32" },
  CloseHandle: { args: ["u64"], returns: "i32" },
}).symbols;

const GW_OWNER = 4;
const GWL_EXSTYLE = -20;
// No taskbar button and no Alt+Tab entry (Win+M skips it too), so the user cannot reach a window they cannot see.
const WS_EX_TOOLWINDOW = 0x80n;
// Windows does not hand it the keyboard on its own, e.g. when the user's window closes or minimizes.
const WS_EX_NOACTIVATE = 0x8000000n;
const WS_EX_APPWINDOW = 0x40000n;
const SHIELD = WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
const SW_HIDE = 0;
const SW_SHOWMINIMIZED = 2;
const SW_SHOWNOACTIVATE = 4;
const SW_SHOWMINNOACTIVE = 7;
const LSFW_LOCK = 1;
const LSFW_UNLOCK = 2;
const WAIT_TIMEOUT = 0x102;
const TURN_MUTEX = Uint16Array.from("Local\\aistudio-prepare-tab\0", (c) => c.charCodeAt(0));
// A prepareTab takes about 1 s, a few more when it opens a new window; past this the command goes on without its turn.
const TURN_WAIT_MS = 15_000;
const CHROME_WINDOW = Uint16Array.from("Chrome_WidgetWin_1\0", (c) => c.charCodeAt(0));

const ownerPid = (h: bigint) => {
  const pid = new Uint32Array(1);
  user32.GetWindowThreadProcessId(h, pid);
  return pid[0];
};

/** WINDOWPLACEMENT as int32s: [length, flags, showCmd, minX, minY, maxX, maxY, normal left, top, right, bottom]. */
function placement(h: bigint) {
  const p = new Int32Array(11);
  p[0] = p.byteLength;
  user32.GetWindowPlacement(h, p);
  return p;
}

/** The normal (not minimized) position is in workspace coordinates, off by a taskbar on the left; half way is enough. */
const isHidden = (p: Int32Array, hiddenLeft: number) => p[7]! <= hiddenLeft / 2;

/** Visible browser frames of pid; owned windows (status bubbles, popups) follow their frame and are left alone. */
function framesOf(pid: number): bigint[] {
  const found: bigint[] = [];
  for (let h = user32.FindWindowExW(0n, 0n, CHROME_WINDOW, null); h;) {
    if (ownerPid(h) === pid && user32.IsWindowVisible(h) && !user32.GetWindow(h, GW_OWNER))
      found.push(h);
    h = user32.FindWindowExW(0n, h, CHROME_WINDOW, null);
  }
  return found;
}

/**
 * For every frame of the Chrome process pid whose normal position is hidden (left at hiddenLeft): shields it and
 * un-minimizes it without activating it (Chrome's own restore, which CDP windowState "normal" triggers, takes the
 * keyboard from the user's window). Frames on screen (--show, to log in by hand) lose the shield and are left as they
 * are, minimized or not.
 */
export function guardWindows(pid: number, hiddenLeft: number) {
  let restored = 0;
  for (const h of framesOf(pid)) {
    const p = placement(h);
    const hidden = isHidden(p, hiddenLeft);
    if (hidden && p[2] === SW_SHOWMINIMIZED) {
      // Not SetWindowPlacement: it moves a window it would show entirely off-screen onto a monitor (seen at 0,0).
      user32.ShowWindow(h, SW_SHOWNOACTIVATE);
      restored++;
    }
    const ex = BigInt(user32.GetWindowLongPtrW(h, GWL_EXSTYLE));
    const want = hidden ? (ex | SHIELD) & ~WS_EX_APPWINDOW : ex & ~SHIELD;
    if (want === ex) continue;
    // The taskbar reads the style only when a window is shown, so: hide, restyle, show (Microsoft's order).
    const minimized = placement(h)[2] === SW_SHOWMINIMIZED;
    user32.ShowWindow(h, SW_HIDE);
    user32.SetWindowLongPtrW(h, GWL_EXSTYLE, want);
    user32.ShowWindow(h, minimized ? SW_SHOWMINNOACTIVE : SW_SHOWNOACTIVATE);
  }
  return { restored };
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
