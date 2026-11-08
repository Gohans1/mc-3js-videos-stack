// The heights of the stretch's rows (Shots, Voice with its words, Action), dragged by their bottom edges in TimelinePanel.tsx and
// drawn by timeline/timeline.ts. null is a row's own height
export type RowSizes = { shots: number | null; voice: number | null; action: number | null };
export const ROW_MIN = { shots: 14, voice: 40, action: 28 }, ROW_MAX = { shots: 48, voice: 240, action: 196 };
export const WORDS_H = 22, LANE_H = 14, RULER_H = 20, BOTTOM_H = 6; // BOTTOM_H: under Action, the bars of where alternatives show

export const rowLayout = (r: RowSizes, sound: boolean) => {
  // With sound tracks below, Action starts with 2 lanes for moves and 1 for sounds; without, 3 and 2
  const shots = r.shots ?? 20, voice = r.voice ?? 66, action = r.action ?? (sound ? 42 : 70);
  const voiceY = shots + 2, actionY = voiceY + voice + 2;
  return { shots, voice, action, voiceY, actionY, height: actionY + action + BOTTOM_H };
};
export type RowLayout = ReturnType<typeof rowLayout>;

export let rows: RowLayout = rowLayout({ shots: null, voice: null, action: null }, true);
export const setRowLayout = (l: RowLayout) => { rows = l; };
