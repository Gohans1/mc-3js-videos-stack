import type { Lanes } from "./sound";
import type { Track } from "./tracks";

export const TRACK_H = 52,
  TOP = 2,
  ADD_H = 24;

type LaneRow = { track: Track; index: number; top: number; height: number };

export const laneLayout = (lanes: Lanes | null) => {
  const beatTracks = new Set<string | undefined>();
  if (lanes) {
    for (const list of [lanes.beds, lanes.sfx]) {
      for (const clip of list) if (clip.beats?.length) beatTracks.add(clip.track);
    }
  }
  const rowsByTrack = new Map<string | undefined, LaneRow>();
  let bottom = TOP;
  const rows = (lanes?.tracks ?? []).map((track, index) => {
    const height = TRACK_H + (beatTracks.has(track.id) ? 10 : 0);
    const row = { track, index, top: bottom, height };
    if (!rowsByTrack.has(track.id)) rowsByTrack.set(track.id, row);
    bottom += height;
    return row;
  });
  return { rows, rowsByTrack, bottom };
};

export const rowAt = (rows: readonly LaneRow[], y: number) =>
  rows.find((row) => y < row.top + row.height)?.index ?? rows.length;
