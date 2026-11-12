export interface VoiceTakeRecord {
  id: string;
  text: string;
  t?: number;
  start?: number;
  voice?: string;
  model?: string;
  speed?: number;
  stability?: number;
  guide?: string;
  file: string | null;
  seconds: number;
  words: number;
  aligned: boolean;
  tries: string[];
}

export interface VoiceSwappedSpan {
  takeId: string;
  prevStart: number;
  prevEnd: number;
  prevSpokenStart?: number;
  prevSpokenEnd?: number;
  nextStart: number;
  nextEnd: number;
}

export interface VoiceController {
  VOICE_DIR: string;
  TAKES_DIR: string;
  TRY_DIR: string;
  read(): { narration: boolean; takes: VoiceTakeRecord[] };
  audioFile(kind: string, file: string): string | null;
  ownEditWrite(): boolean;
  useTry(params: { takeId: string; tryFile: string }): Promise<
    | { error: string; status: number }
    | {
        narration: boolean;
        takes: VoiceTakeRecord[];
        swapped?: VoiceSwappedSpan;
        swappedSpans?: VoiceSwappedSpan[];
      }
  >;
}

export function openVoice(
  project: string,
  conf?: Record<string, unknown>,
  hooks?: { releaseFile?: (file: string) => void; onAssemble?: () => void | Promise<void> },
): VoiceController;
