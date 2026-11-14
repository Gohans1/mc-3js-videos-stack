// Only node: built-ins and repo files here: this runs before bun install has fetched any package
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { cliArgs } from "../packages/live-studio/src/cli.mjs";
import { config, EXTERNAL, ROOT } from "./vault.mjs";

const HELP = `Sets up a new machine in one go, from the repo root: bun install, then bun run setup:vault (it names every tool
to install first), then bun run link.
  bun run setup                           fetches and builds the vault
  bun run setup --sound-zip <zip>         restores every sound from bun run pack:sound's zip first (no hours of torrents)
  bun run setup --sound-zip <link>        the same from a link (a Drive link shared with anyone who has it); a link
                                          that will not serve says to download the zip in a browser and pass its path
The heavy external vault (vault.json "external": motion, packs, tools) has no download: copy it from the old machine into
vault.json "externalRoot" (or MC_VAULT_EXTERNAL); until then setup stops before link and names what is missing.
A step that fails stops it and says why; run it again once fixed: every step reuses what is already there.`;
const args = cliArgs(HELP, ["--sound-zip FILE"], 0);
const step = (what, argv) => {
  const r = spawnSync("bun", argv, { cwd: ROOT, stdio: "inherit", windowsHide: true });
  if (r.error || r.status !== 0) {
    console.error(`${what} failed: fix what it says above, then bun run setup again`);
    process.exit(r.status || 1);
  }
};
step("bun install", ["install"]);
step("bun run setup:vault", ["scripts/setup_vault.mjs", ...args]);
// mc-sound is built (bun run setup:mc-sound) or restored from the sound zip; the rest only comes from the old machine
const missing = (config.external ?? []).filter((name) => !existsSync(join(EXTERNAL, name)));
if (missing.length) {
  const copy = missing.filter((name) => name !== "mc-sound");
  if (copy.length)
    console.log(
      `Waiting for you: copy ${copy.join(", ")} from the old machine's external vault into ${EXTERNAL} (or set MC_VAULT_EXTERNAL)`,
    );
  if (missing.includes("mc-sound"))
    console.log(`Waiting for you: bun run setup:mc-sound builds ${join(EXTERNAL, "mc-sound")}`);
  console.log("Then bun run link connects the vault to the films.");
  process.exit(0);
}
step("bun run link", ["scripts/link.ts"]);
