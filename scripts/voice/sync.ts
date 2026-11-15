// Syncs all English voices from GenVoice / ElevenLabs Shared Voice Library into vault/voices/shared-en.json.
import { cliArgs } from "../../packages/live-studio/src/cli.mjs";
import {
  defaultVoiceCacheFile,
  syncVoiceCatalog,
} from "../../packages/live-studio/src/voice-library.mjs";

const HELP = `Sync all English voices (including ElevenLabs v4 flags & facets) from GenVoice / ElevenLabs into the local vault cache.
  bun run setup:voices         download & index English voices into vault/voices/shared-en.json
Requires GENVOICE_API_KEY (or ELEVENLABS_API_KEY) in environment.`;

cliArgs(HELP, [], 0, process.argv.slice(2));

const cacheFile = defaultVoiceCacheFile(process.cwd());
console.log(`Syncing shared English voices -> ${cacheFile}`);

let lastShown = 0;
const started = Date.now();
const catalog = await syncVoiceCatalog({
  project: process.cwd(),
  cacheFile,
  onProgress: (p: {
    pagesLoaded: number;
    totalScanned: number;
    totalEnglish: number;
    totalEnglishV4: number;
  }) => {
    const now = Date.now();
    if (now - lastShown < 5000) return;
    lastShown = now;
    console.log(
      `  pages=${p.pagesLoaded} scanned=${p.totalScanned} en=${p.totalEnglish} v4=${p.totalEnglishV4}`,
    );
  },
});

const sec = ((Date.now() - started) / 1000).toFixed(1);
console.log(
  `Done in ${sec}s: ${catalog.totalEnglish} English voices (${catalog.totalEnglishV4} ElevenLabs v4) from ${catalog.totalScanned} total scanned -> ${cacheFile}`,
);
if (catalog.truncated) {
  console.warn(
    `Warning: voice sync hit the page limit before upstream exhaustion; some English voices may be omitted.`,
  );
}
