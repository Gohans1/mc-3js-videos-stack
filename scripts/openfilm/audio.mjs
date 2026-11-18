import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { wavInfo, wavPeaks } from "../../packages/live-studio/src/sound.mjs";
import { writeAtomicSync } from "../../packages/live-studio/src/voice-map.mjs";
import { convertToPcmWav } from "../build_sound_vault.mjs";
import { audioEntry, safePath } from "./catalog.mjs";

const load = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {});
function merge(file, added) {
  writeAtomicSync(file, JSON.stringify({ ...load(file), ...added }, null, 2) + "\n");
}

export async function buildAudio({
  library,
  vaultSound,
  items,
  deadline = Date.now() + 3600_000,
  log = console.log,
}) {
  mkdirSync(vaultSound, { recursive: true });
  const audio = items.filter((x) => ["sound", "music"].includes(x.cat));
  const sourcesFile = join(vaultSound, "SOURCES.json"),
    peaksFile = join(vaultSound, "PEAKS.json");
  const sources = load(sourcesFile),
    peaks = load(peaksFile),
    added = {},
    addedPeaks = {},
    failures = [];
  let next = 0,
    done = 0,
    converted = 0,
    last = 0;
  const flush = () => {
    if (Object.keys(added).length) merge(sourcesFile, added);
    if (Object.keys(addedPeaks).length) merge(peaksFile, addedPeaks);
    for (const key of Object.keys(added)) delete added[key];
    for (const key of Object.keys(addedPeaks)) delete addedPeaks[key];
  };
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < audio.length && Date.now() < deadline) {
        const item = audio[next++];
        try {
          const meta = audioEntry(item),
            raw = safePath(library, item.id);
          const file = join(vaultSound, meta.kind, meta.category, `${meta.name}.wav`);
          const old = sources[meta.name];
          if (old && old.source !== "openfilm")
            throw new Error(`Audio name collision: ${meta.name}`);
          if (!existsSync(raw)) throw new Error(`Missing source ${raw}`);
          let info = existsSync(file) ? wavInfo(file) : null;
          let changed = false;
          if (
            !info ||
            info.tag !== 1 ||
            info.bits !== 16 ||
            info.rate !== 48000 ||
            info.channels !== 2 ||
            info.seconds <= 0
          ) {
            await convertToPcmWav(raw, file, { rate: 48000, channels: 2, normalize: true });
            changed = true;
            info = wavInfo(file);
          }
          if (!info?.seconds) throw new Error(`Invalid converted audio: ${file}`);
          let st = statSync(file);
          const previous = peaks[meta.name];
          const cached = previous?.size === st.size && previous?.mtimeMs === Math.round(st.mtimeMs);
          let wave = cached ? previous : wavPeaks(file, 0.02, 3);
          if (!wave?.peaks.length) throw new Error(`No waveform: ${file}`);
          if (wave.peaks.some((x) => x > 0.893)) {
            await convertToPcmWav(file, file, { rate: 48000, channels: 2, normalize: true });
            changed = true;
            st = statSync(file);
            wave = wavPeaks(file, 0.02, 3);
            if (!wave?.peaks.length || wave.peaks.some((x) => x > 0.893))
              throw new Error(`Output peak exceeds -1 dBFS: ${file}`);
          }
          added[meta.name] = { ...meta, seconds: info.seconds };
          if (!cached || changed) {
            addedPeaks[meta.name] = {
              ...wave,
              size: st.size,
              mtimeMs: Math.round(st.mtimeMs),
              seconds: info.seconds,
            };
          }
          if (changed) converted++;
          done++;
        } catch (error) {
          failures.push({ id: item.id, error: error.message });
          log(`OpenFilm conversion failed: ${item.id}: ${error.message}`);
        }
        if (Date.now() - last > 5000) {
          last = Date.now();
          flush();
          log(
            `OpenFilm WAV: ${done}/${audio.length}, ${converted} converted, ${failures.length} failed`,
          );
        }
      }
    }),
  );
  flush();
  for (const item of audio.slice(next))
    failures.push({ id: item.id, error: "Run time limit reached; run again to resume" });
  if (failures.length) {
    writeFileSync(
      join(vaultSound, "OPENFILM-FAILED.json"),
      JSON.stringify(failures, null, 2) + "\n",
    );
    throw new Error(
      `${failures.length} OpenFilm sounds unfinished; see ${join(vaultSound, "OPENFILM-FAILED.json")}`,
    );
  }
  log(`OpenFilm WAV: ${done}/${audio.length}, ${converted} converted`);
  rmSync(join(vaultSound, "OPENFILM-FAILED.json"), { force: true });
  return { count: done, converted };
}
