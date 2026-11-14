export type MouthCue = [number, string];
export interface SpeakingTake {
  id: string;
  by: string;
  text?: string;
  language?: string;
  audio: string;
  shapes: string;
  fresh: boolean;
}
export interface MouthMap {
  takes: { id: string; at: number; cues: MouthCue[] }[];
}

export const MOUTH_MAP: string;
export function mouthFileOf(audio: string): string;
export function speakingTakes(film: string): SpeakingTake[];
export function writeMouthMap(film: string): MouthMap;
export function mouthFaults(film: string): string[];
export function rhubarbPath(): string;
export function shapeTake(take: SpeakingTake, line: string, rhubarb?: string): MouthCue[];
