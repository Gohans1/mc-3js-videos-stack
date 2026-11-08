// The playhead's part of the page state (core/store.ts)
export interface PlaybackSlice {
  playing: boolean;
  rate: number;
  volume: number;
  muted: boolean;
}
export const playbackSlice: PlaybackSlice = { playing: false, rate: 1, volume: 1, muted: false };
