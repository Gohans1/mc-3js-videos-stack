// @ts-nocheck
// Lab: prints the review overlay's list (src/describe.ts) at a few moments, to read it as text before it is drawn.
// ENTRY=lab/describe_dump.ts AT=0 node src/render.mjs stills
import { buildScene } from "../src/scene";

const post = (url, body) => fetch(url, { method: "POST", body });
window.onerror = (m) => { post("/log", "ERROR " + m); };
window.onunhandledrejection = (e) => { post("/log", "ERROR " + (e.reason?.stack ?? e.reason)); };
(async () => {
  const cfg = await (await fetch("/config")).json();
  const draw = await buildScene(document.getElementById("gl"), cfg.W, cfg.H, true);
  for (const t of [1, 2.9, 3.8, 9.5, 12.3, 13.5, 19.5, 22]) {
    draw(t);
    const s = draw.describe(t).map((g) => `# ${g.head}\n` + g.lines.map((l) => (l.fresh ? "NEW " : "    ") + l.text).join("\n")).join("\n");
    await post("/log", `===== t=${t}\n${s}`);
  }
  await post("/done", "");
})();
