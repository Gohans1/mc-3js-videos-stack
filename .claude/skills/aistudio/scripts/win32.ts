// Keeps the skill's off-screen Chrome windows out of the user's way, through user32.dll (Windows only).
import { dlopen } from "bun:ffi";

const user32 = dlopen("user32.dll", {
  FindWindowExW: { args: ["u64", "u64", "ptr", "ptr"], returns: "u64" },
  GetWindowThreadProcessId: { args: ["u64", "ptr"], returns: "u32" },
  IsWindowVisible: { args: ["u64"], returns: "bool" },
  IsIconic: { args: ["u64"], returns: "bool" },
  GetWindowRect: { args: ["u64", "ptr"], returns: "bool" },
  GetWindowLongPtrW: { args: ["u64", "i32"], returns: "i64" },
  SetWindowLongPtrW: { args: ["u64", "i32", "i64"], returns: "i64" },
  ShowWindow: { args: ["u64", "i32"], returns: "bool" },
}).symbols;

const GWL_EXSTYLE = -20;
// No taskbar button and no Alt+Tab entry (Win+M skips it too), so the user cannot reach a window they cannot see.
const WS_EX_TOOLWINDOW = 0x80n;
// Windows never hands it the keyboard, e.g. when the user's window closes or minimizes.
const WS_EX_NOACTIVATE = 0x8000000n;
const WS_EX_APPWINDOW = 0x40000n;
const SHIELD = WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
const SW_HIDE = 0;
const SW_SHOWNOACTIVATE = 4;
const CHROME_WINDOW = Uint16Array.from("Chrome_WidgetWin_1\0", (c) => c.charCodeAt(0));

function visibleWindowsOf(pid: number): bigint[] {
  const found: bigint[] = [];
  const owner = new Uint32Array(1);
  for (let h = user32.FindWindowExW(0n, 0n, CHROME_WINDOW, null); h;) {
    user32.GetWindowThreadProcessId(h, owner);
    if (owner[0] === pid && user32.IsWindowVisible(h)) found.push(h);
    h = user32.FindWindowExW(0n, h, CHROME_WINDOW, null);
  }
  return found;
}

/**
 * For every visible window of the Chrome process pid: un-minimizes it without activating it (Chrome's own restore,
 * which CDP windowState "normal" triggers, takes keyboard focus from the user's window), then shields the windows whose
 * left edge is hiddenLeft and unshields the rest (a window on screen must take clicks and typing, to log in by hand).
 */
export function guardWindows(pid: number, hiddenLeft: number) {
  const rect = new Int32Array(4);
  let restored = 0;
  let changed = 0;
  for (const h of visibleWindowsOf(pid)) {
    if (user32.IsIconic(h)) {
      user32.ShowWindow(h, SW_SHOWNOACTIVATE);
      restored++;
    }
    user32.GetWindowRect(h, rect);
    const ex = BigInt(user32.GetWindowLongPtrW(h, GWL_EXSTYLE));
    const want = rect[0] === hiddenLeft ? (ex | SHIELD) & ~WS_EX_APPWINDOW : ex & ~SHIELD;
    if (want === ex) continue;
    user32.SetWindowLongPtrW(h, GWL_EXSTYLE, want);
    // The taskbar reads the style only when a window is shown.
    user32.ShowWindow(h, SW_HIDE);
    user32.ShowWindow(h, SW_SHOWNOACTIVATE);
    changed++;
  }
  return { restored, changed };
}
