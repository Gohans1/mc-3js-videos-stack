// Only node: built-ins and repo files here: this runs before bun install has fetched any package
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { cliArgs } from "../packages/live-studio/src/cli.mjs";
import { config, LOCAL, ROOT } from "./vault.mjs";

const HELP = `Sets up a new machine in one go, from the repo root: bun install, then bun run setup:vault (it names every tool
to install first), then bun run link.
  bun run setup                                               fetches and builds the vault
  bun run setup --vault-zip <core.zip> --vault-zip <heavy.zip> restores private vault archives from bun run pack:vault first
  bun run setup --sound-zip <zip-or-link>                     restores a legacy sound zip from bun run pack:sound
Drive share links ("anyone with the link") work for --vault-zip / --sound-zip; private links explain how to download in a browser.
Optional local tools (earshot, Rhubarb, bun run media setup) are installed separately on the new machine (never copied from vault/tools/).
externalRoot (or MC_VAULT_EXTERNAL) is only for raw downloads and backups, never runtime asset junctions.
A failed step stops it; rerun after fixing it.
The dependency install has a 5-minute limit; vault downloads/builds take longer and reuse completed files on rerun.
next: bun run new-film <name> after setup succeeds.`;
const args = cliArgs(HELP, ["--vault-zip FILE", "--sound-zip FILE"], 0);
const step = (what, argv) => {
  const r = spawnSync("bun", argv, {
    cwd: ROOT,
    stdio: "inherit",
    windowsHide: true,
    timeout: argv[0] === "install" ? 300_000 : 3_600_000,
  });
  if (r.error || r.status !== 0) {
    console.error(
      `${what} failed${r.error ? `: ${r.error.message}` : ""}: fix what it says above.\nnext: bun run setup${args.length ? " with the same archive flags" : ""}`,
    );
    process.exit(r.status || 1);
  }
};
step("bun install", ["install"]);
step("bun run setup:vault", ["scripts/setup_vault.mjs", ...args]);
// mc-sound is built (bun run setup:mc-sound) or restored from an archive; motion and packs come from --vault-zip or the old machine
const missing = (config.requiredDirectories ?? []).filter((name) => !existsSync(join(LOCAL, name)));
if (missing.length) {
  const copy = missing.filter((name) => name !== "mc-sound");
  if (copy.length)
    console.log(
      `Waiting for you: restore ${copy.join(", ")} with bun run setup --vault-zip <core.zip> (from bun run pack:vault), or copy them from the old machine into ${LOCAL} as real directories`,
    );
  if (missing.includes("mc-sound"))
    console.log(`Waiting for you: bun run setup:mc-sound builds ${join(LOCAL, "mc-sound")}`);
  console.log("Setup incomplete.\nnext: restore the missing folders, then bun run link");
  process.exit(1);
}
step("bun run link", ["scripts/link.ts"]);
console.log(
  "Setup complete. Optional local tools (earshot, Rhubarb, bun run media setup) install separately; see INSTALL.md.\nnext: bun run new-film <name>",
);
