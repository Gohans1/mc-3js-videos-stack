// Bun runtime fields this repo's TypeScript scripts use; bun-types isn't installed, so declare only what is needed.
// import.meta.main is true when the file is the entry point (`bun scripts/timeline_fmt.ts`), false when imported.
interface ImportMeta {
  readonly main: boolean;
}
// Bun.which: the executable's path on PATH, or null
declare const Bun: { which(command: string): string | null };
