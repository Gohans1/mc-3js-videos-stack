// Where this page runs: a phone, and whether it is away from the studio PC (on a line that costs)
import { useSyncExternalStore } from "react";
export const PHONE =
  matchMedia("(pointer: coarse)").matches && Math.min(innerWidth, innerHeight) < 600;
// Anything but this machine itself is on a line that costs: small copies of everything, whatever the screen
export const AWAY = PHONE || !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
// Away, the sound comes as Opus in WebM, a tenth of the WAV, where the browser says it plays it: iOS Safari before 17.4 does
// not (WebKit bug 238546) and gets the WAV
export const SMALL_SOUND =
  AWAY && document.createElement("audio").canPlayType('audio/webm; codecs="opus"') !== "";
// The keyboard shrinks the page instead of covering it, so the note box under the picture stays in view while typing
// (PhoneApp). Chrome on Android does it from the viewport's interactive-widget; iOS Safari ignores that and only shrinks the
// visual viewport, so the page's height (--app-h, index.css phone-h) follows visualViewport, Telegram's way, and Safari's pan
// to the box is undone. A pinch zoom shrinks it too, and is left alone
if (PHONE) {
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute(
      "content",
      "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
    );
  const vv = window.visualViewport;
  const fitKeyboard = () => {
    if (!vv || vv.scale > 1.01) return;
    document.documentElement.style.setProperty("--app-h", `${Math.round(vv.height)}px`);
    if (vv.offsetTop) scrollTo(0, 0);
  };
  vv?.addEventListener("resize", fitKeyboard);
  vv?.addEventListener("scroll", fitKeyboard);
  fitKeyboard();
}
// The phone layouts, index.css's upright and sideways variants (keep the two in step): what needs the room isn't run there at all
const SMALL = matchMedia(
  "(max-width: 820px) and (min-height: 521px), (max-width: 559px), (max-height: 520px) and (min-width: 560px)",
);
export const useSmall = () =>
  useSyncExternalStore(
    (f) => {
      SMALL.addEventListener("change", f);
      return () => SMALL.removeEventListener("change", f);
    },
    () => SMALL.matches,
  );
