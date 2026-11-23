export type RowSizes = { shots: number | null; voice: number | null; action: number | null };
export const ROW_MIN = { shots: 14, voice: 40, action: 28 },
  ROW_MAX = { shots: 48, voice: 240, action: 196 };
export const WORDS_H = 22,
  LANE_H = 14,
  RULER_H = 20,
  BOTTOM_H = 6;

export const SHOTS_STRIP = 4;
export const rowLayout = (r: RowSizes, sound: boolean, cam: boolean, showVoice = true) => {
  const shots = cam ? SHOTS_STRIP : (r.shots ?? 20),
    voice = showVoice ? (r.voice ?? 66) : 0,
    action = r.action ?? (sound ? 42 : 70);
  const voiceY = shots + 2,
    actionY = voiceY + voice + (voice ? 2 : 0);
  return { shots, voice, action, voiceY, actionY, height: actionY + action + BOTTOM_H };
};
export type RowLayout = ReturnType<typeof rowLayout>;

export let rows: RowLayout = rowLayout({ shots: null, voice: null, action: null }, true, true);
export const setRowLayout = (l: RowLayout) => {
  rows = l;
};
