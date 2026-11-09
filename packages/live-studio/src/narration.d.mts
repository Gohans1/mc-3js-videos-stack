interface Word { w: string; s: number; e: number }
interface Line { text: string; s: number; e: number; words: Word[] }
interface Audio {
  narration?: string;
  sfx: { name: string; at: number; start?: number; length?: number; rate?: number; reverse?: boolean; track?: string }[];
  tracks?: { id: string; mute?: boolean }[];
}
export function narrationLines(lines: Line[], audio: Audio | null, duration: number, audible?: boolean): Line[];
