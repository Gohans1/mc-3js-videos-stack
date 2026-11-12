export const ROOT: string;
export const config: {
  root: string;
  externalRoot?: string;
  external?: string[];
  film_links: Record<string, string>;
};
export function vaultPath(path: string): string;
export const LOCAL: string;
export const EXTERNAL: string;
export function linkDirectory(path: string, target: string): void;
