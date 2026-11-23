import type { LinkageSettings } from "../../src/linkage.mjs";
import { stored } from "../core/storage";

export interface TimelineSlice {
  selection: string[];
  magnet: boolean;
  linkage: boolean;
  linkageKinds: LinkageSettings;
  mainMagnet: boolean;
  previewAxis: boolean;
  previewAudio: boolean;
  blade: boolean;
  inOut: [number, number] | null;
  span: number;
}
export const timelineSlice: Omit<
  TimelineSlice,
  "magnet" | "linkage" | "linkageKinds" | "mainMagnet" | "previewAxis" | "previewAudio"
> = {
  selection: [],
  blade: false,
  inOut: null,
  span: Number(stored.get("span", sessionStorage)) || Infinity,
};
