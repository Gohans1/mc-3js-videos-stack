import type { NarrationLine, NarrationWord } from "./narration.ts";

export interface VoicePlacement {
  id: string;
  file: string;
  start: number;
  spokenStart: number;
  spokenEnd: number;
  naturalEnd: number;
  words: NarrationWord[];
}

export const VOICE_STEP: number;
export const TAKE_ID: RegExp;
export function assertInsideDir(baseDir: string, targetPath: string, label?: string): string;
export function wordsCommand(takes: string[]): string[];
export function voiceFileOf(projectDir: string): string;
export function planVoicePlacements(
  projectDir: string,
  opts?: { fallbackSecondsOf?: (realPath: string) => number; strict?: boolean },
): VoicePlacement[];
export function voiceFilterGraph(
  placements: readonly VoicePlacement[],
  end: number,
): { inputs: string[]; filter: string };
export function buildVoiceMap(
  projectDir: string,
  precomputedPlacements?: readonly VoicePlacement[],
): {
  step: number;
  peaks: number[];
  lines: NarrationLine[];
};
export function writeVoiceMap(
  projectDir: string,
  outFile: string,
  precomputedPlacements?: readonly VoicePlacement[],
): { step: number; peaks: number[]; lines: NarrationLine[]; words: number };
