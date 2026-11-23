import { bootData } from "./boot";
import { prefetchFile } from "./net";

let warmed = false;

export const warmBootRequests = () => {
  if (warmed) return;
  warmed = true;
  if (!(bootData()?.film?.name && bootData()?.film?.ratio)) prefetchFile("/api/film.json");
  prefetchFile("/api/shots.json");
  prefetchFile("/api/notes");
  prefetchFile("/api/favorites");
  const has = bootData()?.film?.has;
  if (!has) return;
  if (has.timing) prefetchFile("/api/timing");
  if (has.shots) prefetchFile("/api/shots");
  if (has.voiceMap) prefetchFile("/api/voice_map.json");
  if (has.voice) prefetchFile("/api/voice");
  if (has.cam) prefetchFile("/api/cam");
  if (has.lights) prefetchFile("/api/lights");
  if (has.keys) prefetchFile("/api/keys");
  if (has.text) prefetchFile("/api/text");
  if (has.adjustment) prefetchFile("/api/adjustment");
  if (has.sound) prefetchFile("/api/sound?used=1");
  if (has.trials) prefetchFile("/api/trials.json");
  if (has.choices) prefetchFile("/api/choices.json");
};
