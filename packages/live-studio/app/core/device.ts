// Where this page runs: a phone, and whether it is away from the studio PC (on a line that costs)
export const PHONE = matchMedia("(pointer: coarse)").matches && Math.min(innerWidth, innerHeight) < 600;
// Anything but this machine itself is on a line that costs: small copies of everything, whatever the screen
export const AWAY = PHONE || !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
if (AWAY) window.__assets = "/lite/";
