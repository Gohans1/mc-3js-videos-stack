export function noteNumbers(project: string): Map<string, { n: number; gone: boolean }>;
export function findNote(
  project: string,
  key: string,
): { id: string; n: number; gone: boolean } | null;
export function deletedSaid(note: { id: string; n: number }): string;
export function createNotes(project: string): {
  file: string;
  read(): Record<string, unknown>[];
  add(input: Record<string, unknown>, stamp: Record<string, unknown>): void;
  change(id: string, change: Record<string, unknown>): { ok: true } | { ok: false; why: string };
  picture(name: string): Buffer | null;
};
export function watchNotesFile(
  file: string,
  onChange: () => void,
  opts?: { debounceMs?: number },
): { sync(): void; close(): void };
