import "./core/boot";
import { createRoot } from "react-dom/client";

import { afterPaint } from "./core/afterPaint";
import { PHONE } from "./core/device";
import { onEvent, onHello } from "./core/events";
import { stored } from "./core/storage";
import { warmBootRequests } from "./core/warmup";

const root = document.getElementById("root")!;
// What stopped the page, with the way back: a fixed save, or the studio coming back with other code, reloads it
const showFailure = (why: string, error: unknown) => {
  document.getElementById("studio-boot")?.remove();
  const box = document.createElement("pre");
  box.className =
    "studio-start-error overflow-auto rounded-lg bg-alarm-bg p-3 font-mono text-sm text-foreground";
  box.textContent = `${why}\n\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;
  root.insertAdjacentElement("afterend", box);
  for (const event of ["code", "edit"]) onEvent(event, () => location.reload());
  onHello((current) => {
    if (!current) location.reload();
  });
};

try {
  warmBootRequests();
  await afterPaint();
  // A phone gets the review-only layout, and never downloads the editor's panels
  const [{ App }] = await Promise.all([
    PHONE ? import("./PhoneApp") : import("./App"),
    import("./index.css"),
  ]);
  stored.remove("pageTries", sessionStorage);
  // A component that throws takes React's whole tree down with it: show why instead of an empty page
  createRoot(root, {
    onUncaughtError: (e) =>
      showFailure(
        "The studio crashed. Reload the page; if it happens again, send the AI the text below.",
        e,
      ),
  }).render(<App />);
} catch (e) {
  const notDownloaded =
    e instanceof Error &&
    /dynamically imported module|Importing a module script failed|Unable to preload CSS/.test(
      e.message,
    );
  const tries = Number(stored.get("pageTries", sessionStorage)) || 0;
  let recovered = false;
  if (notDownloaded && tries < 2 && stored.set("pageTries", String(tries + 1), sessionStorage)) {
    try {
      recovered = (await fetch("/api/edit.json", { cache: "no-store" })).ok;
    } catch {
      recovered = false;
    }
  }
  if (recovered) location.reload();
  else
    showFailure(
      notDownloaded
        ? "Couldn't load the studio. Check your connection, then reload."
        : "The film failed to load. The page reloads once it's fixed.",
      e,
    );
}
