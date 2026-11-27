import "./lite.css";

import { createRoot } from "react-dom/client";

import { PHONE_QUERY, syncPhoneDataset } from "./device.ts";
import { LiteApp } from "./LiteApp.tsx";

syncPhoneDataset();
if (typeof window.matchMedia === "function") {
  window.matchMedia(PHONE_QUERY).addEventListener("change", syncPhoneDataset);
}

const fitViewport = () => {
  const vv = window.visualViewport;
  if (vv && vv.scale > 1.01) return;
  const h = Math.round(vv ? vv.height : window.innerHeight);
  if (h > 0) {
    document.documentElement.style.setProperty("--app-h", `${h}px`);
  }
  if (vv?.offsetTop) window.scrollTo(0, 0);
};

window.addEventListener("resize", fitViewport);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", fitViewport);
  window.visualViewport.addEventListener("scroll", fitViewport);
}
fitViewport();

const root = document.getElementById("root")!;
const showFailure = (error: unknown) => {
  document.getElementById("studio-boot")?.remove();
  const box = document.createElement("pre");
  box.className =
    "studio-start-error overflow-auto rounded-lg bg-alarm-bg p-3 font-mono text-sm text-foreground";
  box.textContent = `Studio Lite crashed.\n\n${
    error instanceof Error ? (error.stack ?? error.message) : String(error)
  }`;
  root.insertAdjacentElement("afterend", box);
};

createRoot(root, {
  onUncaughtError: showFailure,
}).render(<LiteApp />);
