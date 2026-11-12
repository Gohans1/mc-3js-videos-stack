import { mapTimeline, mapVoice } from "./timing-data.mjs";
import { clockForTimeline, layerDuration, setTiming } from "./timing-state.mjs";
import { clipTiming, compileTiming } from "./timing.mjs";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const { timing, duration, audio, durations, voiceIntervals } = JSON.parse(input);
setTiming(timing, duration);
const clock = clockForTimeline("voice");
process.stdout.write(
  JSON.stringify({
    audio: mapTimeline("sound", audio, clockForTimeline("sound"), false, null, durations),
    end: Math.max(1 / 30, compileTiming(timing, duration).duration, layerDuration()),
    voiceIntervals: mapVoice(
      voiceIntervals.map(([s, e]) => ({ s, e, words: [] })),
      clock,
    ).map(({ s, e }) => [s, e]),
    legacyTimeline: clipTiming(clock, 0, duration),
  }),
);
