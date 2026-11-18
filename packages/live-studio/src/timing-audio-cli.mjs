import { isTornByReorder } from "./layer-timing.mjs";
import { mapTimeline, mapVoice } from "./timing-data.mjs";
import { clockForTimeline, layerDuration, setTiming } from "./timing-state.mjs";
import { clipTiming, compileTiming } from "./timing.mjs";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const { timing, duration, audio, durations, voiceIntervals, voiceClips } = JSON.parse(input);
setTiming(timing, duration);
const clock = clockForTimeline("voice");
const heardIntervals = voiceClips
  ? voiceClips.flatMap((clip) => {
      if (isTornByReorder(clock, clip.from, clip.to)) {
        const shift = clock.outputAt(clip.from) - clip.from;
        return clip.intervals.map(([s, e]) => [s + shift, e + shift]);
      }
      return mapVoice(
        clip.intervals.map(([s, e]) => ({ s, e, words: [] })),
        clock,
      ).map(({ s, e }) => [s, e]);
    })
  : mapVoice(
      voiceIntervals.map(([s, e]) => ({ s, e, words: [] })),
      clock,
    ).map(({ s, e }) => [s, e]);
process.stdout.write(
  JSON.stringify({
    audio: mapTimeline("sound", audio, clockForTimeline("sound"), false, null, durations),
    end: Math.max(1 / 30, compileTiming(timing, duration).duration, layerDuration()),
    voiceIntervals: heardIntervals,
    legacyTimeline: clipTiming(clock, 0, duration),
  }),
);
