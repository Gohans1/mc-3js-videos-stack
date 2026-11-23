export interface OptionView {
  id: string;
  title: string;
  source?: string;
  off?: boolean;
}
export interface GroupView {
  name: string;
  title: string;
  picture: boolean;
  options: OptionView[];
  chosen: string;
  pick: string;
  gain: number;
  ranges: [number, number][];
}
export interface ChipView {
  name: string;
  range: [number, number];
}

export interface OptionsSlice {
  groups: GroupView[];
  groupName: string | null;
  chips: ChipView[];
  tryOn: boolean;
}
export const optionsSlice: Omit<OptionsSlice, "tryOn"> = { groups: [], groupName: null, chips: [] };
