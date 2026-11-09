import "./index.css";
import { createRoot } from "react-dom/client";
import { stored } from "./core/storage";
import { onEvent, onHello } from "./core/events";

const root = document.getElementById("root")!;
// What stopped the page, with the way back: a fixed save, or the studio coming back with other code, reloads it
const showFailure = (why: string, error: unknown) => {
  const box = document.createElement("pre");
  box.className = "m-3 overflow-auto rounded-lg bg-alarm-bg p-3 font-mono text-sm whitespace-pre-wrap text-foreground";
  box.textContent = `${why}\n\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;
  root.insertAdjacentElement("afterend", box);
  for (const event of ["code", "edit"]) onEvent(event, () => location.reload());
  onHello((current) => { if (!current) location.reload(); });
};

try {
  const { App } = await import("./App");
  stored.remove("pageTries", sessionStorage);
  // A component that throws takes React's whole tree down with it: show why instead of an empty page
  createRoot(root, { onUncaughtError: (e) => showFailure("The studio crashed. Reload the page; if it happens again, send the AI the text below.", e) }).render(<App />);
} catch (e) {
  // The film's own code loads with the app, so this is either a film that throws while loading or code that never arrived.
  // Chrome, Firefox and Safari each word the second differently, but all as a TypeError about importing; a phone that lost
  // the line halfway tries again by itself a few times
  // What Chrome, Firefox and Safari say when the code file itself did not arrive; anything else is the film's own error
  const notDownloaded = e instanceof TypeError && /dynamically imported module|Importing a module script failed/.test(e.message);
  const tries = Number(stored.get("pageTries", sessionStorage)) || 0;
  if (notDownloaded && tries < 3 && stored.set("pageTries", String(tries + 1), sessionStorage)) location.reload();
  else showFailure(notDownloaded ? "Couldn't load the studio. Check your connection, then reload." : "The film failed to load. The page reloads once it's fixed.", e);
}
