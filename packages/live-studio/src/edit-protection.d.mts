export const COLLAB_SNAPSHOTS: unique symbol;

export interface EditProtectionReport {
  protected: string[];
  notices: unknown[];
  [COLLAB_SNAPSHOTS]?: unknown[];
}

export interface EditProtection {
  notify: (incoming: unknown, retained: string[], bad?: string[]) => void;
  remember: (version: string, data: unknown) => void;
  base: (version: string) => { version: string; data: unknown } | undefined;
  rowSnapshots: () => unknown[];
  hasUnmatchedRow: (ids: Set<string>) => boolean;
  upgradeRows: () => void;
  protect: (base: unknown, data: unknown, actor: string) => void;
  reconcile: <T>(incoming: T, validate: (data: T) => string[]) => T;
  report: () => EditProtectionReport;
  reload: () => void;
  reset: (version: string, data?: unknown) => void;
}

export function formatProtectedPointer(ptr: string, docs?: unknown[]): string;
export function summarizeNotice(
  notice: unknown,
  candidateDocs?: unknown[],
  options?: { full?: boolean },
): unknown;

export function openEditProtection(
  project: string,
  rel: string,
  options?: {
    orderedRows?: boolean;
    normalize?: (data: unknown, previous?: unknown, alignRetimes?: boolean) => unknown;
  },
): EditProtection;
export function resetProtectedFiles(project: string, names: readonly string[]): void;
export function warnProtectedEdits(project: string): void;
