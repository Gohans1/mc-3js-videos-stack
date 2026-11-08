// Where this page runs: a phone, and whether it is away from the studio PC (on a line that costs)
import { useSyncExternalStore } from "react";
export const PHONE = matchMedia("(pointer: coarse)").matches && Math.min(innerWidth, innerHeight) < 600;
// Anything but this machine itself is on a line that costs: small copies of everything, whatever the screen
export const AWAY = PHONE || !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
if (AWAY) window.__assets = "/lite/";
// The phone layouts, index.css's upright and sideways variants (keep the two in step): what needs the room isn't run there at all
const SMALL = matchMedia("(max-width: 820px) and (min-height: 521px), (max-width: 559px), (max-height: 520px) and (min-width: 560px)");
export const useSmall = () => useSyncExternalStore((f) => { SMALL.addEventListener("change", f); return () => SMALL.removeEventListener("change", f); }, () => SMALL.matches);
