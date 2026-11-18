import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { AdjustmentTimeline, ShotsTimeline, SoundTimeline, TextTimeline } from "./contract.ts";
import { projectClock } from "./project-clock.mjs";
import { openSound } from "./sound.mjs";
import { openTimelineFile } from "./timeline_file.mjs";
import { mapTimeline } from "./timing-data.mjs";
import { effectLength, effectSpan, transitionAvailable } from "./timing-effects.mjs";
import { warp } from "./warp.mjs";

export const NATIVE_LANES = {
  text: { key: "textTimeline", schema: TextTimeline, clock: "text", map: "text" },
  adjustment: {
    key: "adjustmentTimeline",
    schema: AdjustmentTimeline,
    clock: "adjustment",
    map: "adjustment",
  },
  transitions: { key: "shotsTimeline", schema: ShotsTimeline, clock: "picture" },
  audio: { key: "soundTimeline", schema: SoundTimeline },
};

export function nativeLane(project, conf, name, options = {}) {
  const spec = NATIVE_LANES[name];
  if (!spec || !conf[spec.key])
    throw new Error(`No ${name} lane configured in the film's live-studio settings`);
  const lane = openTimelineFile(project, conf[spec.key], spec.schema);
  const clockFor = (kind, fallback = 0) => projectClock(project, conf, kind, fallback, options);
  const sound =
    name === "audio" ? openSound(project, { ...conf, sfx: conf.sfx ?? "sound/sfx" }) : null;
  const read = () =>
    lane.read() ?? {
      version: "missing",
      data: name === "transitions" ? [] : name === "audio" ? { beds: [], sfx: [] } : { items: [] },
    };
  const write = (version, data) => {
    const problem = lane.check(version, data);
    if (problem) throw new Error(JSON.stringify(problem));
    mkdirSync(dirname(lane.FILE), { recursive: true });
    const result = lane.write(version, data);
    if (result.conflict || result.problems) throw new Error(JSON.stringify(result));
    return result;
  };
  const audioClock = () => {
    const clocks = Object.fromEntries(
      ["voice", "audio", "sfx"].map((kind) => [kind, clockFor(kind).clock]),
    );
    return {
      ...clocks.sfx,
      forClip: (clip, list, input) =>
        clocks[
          clip._narration || clip.name === input.narration
            ? "voice"
            : list === "beds"
              ? "audio"
              : "sfx"
        ],
    };
  };
  const soundDurations = () =>
    Object.fromEntries((sound?.library() ?? []).map((it) => [it.name, it.seconds]));
  const map = (data, inverse = false, previous = null) => {
    if (name === "transitions") {
      const { clock, voiceWarp } = clockFor("picture", data.at(-1)?.t ?? 0);
      return data.map((shot, i) => {
        const t = warp(voiceWarp, shot.t, 0, 1),
          transition = shot.transition;
        const span = transition && effectSpan(clock, t, 0.5, 0.5, transition.len ?? 0.5);
        return {
          ...shot,
          t: clock.outputAt(t),
          ...(transition && { transition: { ...transition, len: span[1] - span[0] } }),
          target: `transitions:${i}`,
        };
      });
    }
    if (name === "audio") {
      return mapTimeline(
        "sound",
        { beds: [], sfx: [], ...data },
        audioClock(),
        inverse,
        previous,
        soundDurations(),
      );
    }
    return mapTimeline(spec.map, data, clockFor(spec.clock).clock, inverse, previous);
  };
  const checkAudioTimes = (expected, source) => {
    if (name !== "audio") return;
    const actual = map(source);
    const differs = (a, b) =>
      Number.isFinite(a) && (!Number.isFinite(b) || Math.abs(a - b) > 1 / 48000);
    for (const list of ["beds", "sfx"])
      for (const [i, clip] of expected[list].entries()) {
        const out = actual[list][i];
        const fields = ["at", "from", "to", "length", "fadeIn", "fadeOut"];
        if (
          fields.some((key) => differs(clip[key], out?.[key])) ||
          clip.gainKeys?.some((key, n) => differs(key.t, out?.gainKeys?.[n]?.t)) ||
          clip.beats?.some((beat, n) => differs(beat, out?.beats?.[n]))
        )
          throw new Error(
            `Audio ${list}[${i}] cannot represent the requested heard times on its current clock; use an independent audio/SFX clock in ${conf.timingTimeline ?? "timing.json"} or a custom output-time mix`,
          );
      }
  };
  const view = () => {
    const current = read(),
      data = map(current.data);
    const targets =
      name === "transitions"
        ? data.filter((it) => it.transition).map((it) => it.target)
        : (name === "audio" ? ["beds", "sfx"] : ["items"]).flatMap((list) =>
            (data[list] ?? []).map(
              (it, i) => `${name}:${list === "items" ? "" : `${list}:`}${it.id ?? i}`,
            ),
          );
    return { ...current, file: lane.FILE, data, targets };
  };
  const append = (props, list = "items") => {
    const current = read(),
      id = randomUUID();
    const data = map(current.data);
    data[list] ??= [];
    let item = { ...props, id };
    if (name === "audio" && list === "sfx" && props.length === undefined) {
      const clock = audioClock().forClip(item, list, current.data),
        durations = soundDurations();
      if (!Number.isFinite(durations[props.name]))
        throw new Error(`Cannot determine waveform duration for ${props.name}`);
      const seed = { ...item, at: clock.sourceAt(props.at, "after") };
      item = {
        ...mapTimeline("sound", { beds: [], sfx: [seed] }, clock, false, null, durations).sfx[0],
        ...item,
      };
    }
    data[list].push({
      ...(spec.clock &&
        spec.clock !== "picture" && {
          track: 0,
          timebase: clockFor(spec.clock, props.to).basis,
        }),
      ...item,
    });
    const source = map(data, true, current.data);
    checkAudioTimes(data, source);
    const saved = write(current.version, source);
    return {
      ...saved,
      file: lane.FILE,
      target: `${name}:${list === "items" ? "" : `${list}:`}${id}`,
      item: view().data[list].find((it) => it.id === id),
    };
  };
  const change = (id, patch, remove = false) => {
    const current = read();
    const heard = map(current.data);
    if (name === "transitions") {
      const index = Number(id),
        data = structuredClone(current.data);
      if (!Number.isInteger(index) || index < 1 || !data[index]?.transition)
        throw new Error(`No transition at boundary ${id}`);
      if (remove) delete data[index].transition;
      else
        return placeTransition(
          project,
          conf,
          { ...heard[index].transition, ...patch },
          index,
          options,
        );
      return { ...write(current.version, data), file: lane.FILE, data: view().data };
    }
    const split = id.indexOf(":"),
      [list, row] = name === "audio" ? [id.slice(0, split), id.slice(split + 1)] : ["items", id];
    if (!["items", "beds", "sfx"].includes(list)) throw new Error(`Unknown clip list ${list}`);
    const data = heard,
      items = data[list],
      matches = (it, i) => String(it.id ?? i) === row;
    if (!items?.some(matches)) throw new Error(`No ${name} item ${id}`);
    data[list] = remove
      ? items.filter((it, i) => !matches(it, i))
      : items.map((it, i) =>
          matches(it, i) ? { ...it, ...patch, ...(it.id && { id: it.id }) } : it,
        );
    const source = map(data, true, current.data);
    checkAudioTimes(data, source);
    return {
      ...write(current.version, source),
      file: lane.FILE,
      data: view().data,
    };
  };
  return { read, write, view, append, change, file: lane.FILE, schema: spec.schema };
}

export function placeTransition(project, conf, transition, shot, options = {}) {
  const lane = nativeLane(project, conf, "transitions", options),
    current = lane.read(),
    data = structuredClone(current.data);
  if (!Number.isInteger(shot) || shot < 1 || !data[shot])
    throw new Error("Choose a cut with --shot N (1 is the cut into the second shot)");
  const { clock, voiceWarp } = projectClock(
    project,
    conf,
    "picture",
    data.at(-1).t + (transition.len ?? 0.5),
    options,
  );
  const at = (i) => warp(voiceWarp, data[i].t, 0, 1),
    cut = at(shot);
  if (!transitionAvailable(clock, cut))
    throw new Error("This cut is hidden, frozen or removed by the current timing plan");
  const room = Math.min(
    cut - at(shot - 1),
    (data[shot + 1] ? at(shot + 1) : clock.sourceDuration) - cut,
  );
  data[shot].transition = {
    ...transition,
    len: effectLength(clock, cut, 0.5, 0.5, transition.len ?? 0.5, room),
  };
  return {
    ...lane.write(current.version, data),
    file: lane.file,
    target: `transitions:${shot}`,
    shot,
    transition: data[shot].transition,
  };
}
