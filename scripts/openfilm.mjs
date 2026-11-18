import { join } from "node:path";

import { cliArgs, numberArg } from "../packages/live-studio/src/cli.mjs";
import { buildAudio } from "./openfilm/audio.mjs";
import { writeAssetCatalog } from "./openfilm/catalog.mjs";
import { fetchOpenFilm } from "./openfilm/fetch.mjs";
import { verifyImport } from "./openfilm/verify.mjs";
import { LOCAL } from "./vault.mjs";

const HELP = `Usage: bun run fetch:openfilm [--verify] [--minutes N]

Imports the complete pinned OpenFilm library. Existing sources and duplicate functionality are kept.
Audio: vault/sound/{bgm,sfx}/<category>/of-*.wav, stereo PCM16 48 kHz, -1 dBFS peaks.
Credits/categories/provenance: SOURCES.json; waveforms: PEAKS.json. Published audio has unverified
recording provenance; the 20 generated sounds are Code-gen. OpenFilm assets are CC0; Fluent Emoji
is MIT, with Microsoft's notice retained in vault/openfilm/library/LICENSE.md.
Editable HTML/CSS/JSON, images, fonts and template previews: vault/openfilm/library/.
Find: bun run find --source openfilm; bun run find --kind transition --source openfilm.
Inspect controls/source: bun run find --show <id>; place and edit: bun run asset --help.

--verify       Check catalog coverage, WAV format, categories, waveforms and downloaded checksums; no download.
--minutes N    Stop scheduling work after N minutes (default 60, 1-180). Each request/conversion also has a timeout.
Completed downloads and conversions are kept; rerun the same command to resume.`;

if (import.meta.main) {
  const args = cliArgs(HELP, ["--verify", "--minutes N"], 0);
  const minutesAt = args.indexOf("--minutes");
  const minutes =
    minutesAt < 0 ? 60 : numberArg("--minutes", args[minutesAt + 1], { min: 1, max: 180 });
  const home = join(LOCAL, "openfilm"),
    vaultSound = join(LOCAL, "sound");
  try {
    if (!args.includes("--verify")) {
      const deadline = Date.now() + minutes * 60_000;
      const { library, items } = await fetchOpenFilm({ home, deadline });
      writeAssetCatalog(items, library);
      await buildAudio({ library, items, vaultSound, deadline });
    }
    verifyImport({ home, vaultSound });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
