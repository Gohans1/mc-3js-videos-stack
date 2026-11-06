// @ts-nocheck
// Lab: prints the review overlay's list (src/describe.ts) at a few moments, to read it as text before it is drawn.
// ENTRY=lab/describe_dump.ts AT=0 bun run render stills
import { buildScene } from "../src/scene";
import { canvas, config, done, log } from "live-studio/lab";

(async () => {
  const cfg = await config();
  const draw = await buildScene(canvas(), cfg.W, cfg.H, true);
  for (const t of [1, 2.9, 3.8, 9.5, 12.3, 13.5, 19.5, 22]) {
    draw(t);
    const s = draw.describe(t).map((g) => `# ${g.head}\n` + g.lines.map((l) => (l.fresh ? "NEW " : "    ") + l.text).join("\n")).join("\n");
    await log(`===== t=${t}\n${s}`);
  }
  await done();
})();
