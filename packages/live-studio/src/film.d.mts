export const STUDIO: string;
export function threeFromOf(project: string): string;
export function voiceMapOf(project: string): string;
export function contractFiles(
  project: string,
): Record<string, [import("zod").ZodType<unknown>, string | undefined]>;
export function openFilm(
  projectDir: string,
  opts: { send: (event: string, data?: unknown) => void },
): Record<string, unknown>;
