// The alternatives' part of the page state (core/store.ts): each group of versions (A, B, C…) and the chips on the picture
export interface OptionView { id: string; title: string; source?: string; off?: boolean }
export interface GroupView { name: string; title: string; picture: boolean; options: OptionView[]; chosen: string; pick: string; gain: number; ranges: [number, number][] }
export interface ChipView { name: string; range: [number, number] }

export interface OptionsSlice {
  groups: GroupView[];
  groupName: string | null;
  chips: ChipView[];
  tryOn: boolean; // chips show near a prop or sound with several versions (core/prefs.ts)
}
export const optionsSlice: Omit<OptionsSlice, "tryOn"> = { groups: [], groupName: null, chips: [] };
