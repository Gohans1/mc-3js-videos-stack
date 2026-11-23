import "./core/boot";
import { createRoot } from "react-dom/client";

import { afterPaint } from "./core/afterPaint";
import { PHONE } from "./core/device";
import { onEvent, onHello } from "./core/events";
import { stored } from "./core/storage";
import { warmBootRequests } from "./core/warmup";

const root = document.getElementById("root")!;
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
  const [{ App }] = await Promise.all([
    PHONE ? import("./PhoneApp") : import("./App"),
    import("./index.css"),
  ]);
  stored.remove("pageTries", sessionStorage);
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
