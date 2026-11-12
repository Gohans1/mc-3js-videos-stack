export interface SoundLibraryEntry {
  name: string;
  seconds: number;
  title?: string;
  license?: string;
  url?: string;
  for?: string;
  kind?: "bgm" | "sfx" | "mc";
  role?: "riser" | "whoosh" | "impact" | "downlifter";
  origin?: "real" | "synth";
  category?: string;
  source?: string;
  family?: string;
  variant?: number;
  contentId?: true;
}

export interface OpenSoundHandle {
  DIR: string;
  readonly VAULT: string | null;
  readonly VAULTS: string[];
  read: () => { version: string; data: Record<string, unknown> } | null;
  check: (base: string, data: unknown) => { conflict?: boolean; problems?: string[] } | null;
  write: (
    base: string,
    data: unknown,
  ) => { version?: string; conflict?: boolean; problems?: string[] };
  ownWrite: () => boolean;
  library: () => SoundLibraryEntry[];
  peaks: (name: string) => { step: number; peaks: number[] } | null;
  peaksAsync: (name: string) => Promise<{ step: number; peaks: number[] } | null>;
  fileOf: (name: string) => string | null;
}

export function wavInfo(
  file: string,
): { tag: number; channels: number; rate: number; bits: number; seconds: number } | null;
export function oggInfo(
  file: string,
): { channels: number; rate: number; bits: number; seconds: number } | null;
export function audioInfo(
  file: string,
): { tag?: number; channels: number; rate: number; bits: number; seconds: number } | null;
export function wavPeaks(
  file: string,
  step?: number,
  digits?: number,
): { step: number; peaks: number[] } | null;
export function oggPeaks(
  file: string,
  step?: number,
  digits?: number,
): { step: number; peaks: number[] } | null;
export function oggPeaksAsync(
  file: string,
  step?: number,
  digits?: number,
): Promise<{ step: number; peaks: number[] } | null>;
export function audioPeaks(
  file: string,
  step?: number,
  digits?: number,
): { step: number; peaks: number[] } | null;
export function audioPeaksAsync(
  file: string,
  step?: number,
  digits?: number,
): Promise<{ step: number; peaks: number[] } | null>;
export function openSound(project: string, conf?: Record<string, unknown>): OpenSoundHandle | null;
export declare const findVaults: (project: string, conf: Record<string, unknown>) => string[];
