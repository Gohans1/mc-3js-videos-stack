export interface TailscaleEndpoint {
  url: string;
  host: string;
  targetPort: number;
  allowed: boolean | null;
}

export interface NotesSummary {
  open: number;
  check: number;
  done: number;
  total: number;
}

export interface WorktreeRef {
  path: string;
  name: string;
  branch: string | null;
  isMain: boolean;
}

export interface StudioPort {
  id: string;
  port: number;
  pid: number;
  current: boolean;
  film: string | null;
  ratio: string | null;
  project: string | null;
  worktree: WorktreeRef | null;
  matchConfidence: "exact" | "inferred" | "ambiguous" | "unknown";
  candidateWorktrees: WorktreeRef[];
  localUrl: string;
  tailscale: TailscaleEndpoint[];
  notes: NotesSummary | null;
  status: "ready" | "error" | "unreachable";
}

export interface UnmatchedTailscaleRoute {
  url: string;
  host: string;
  targetPort: number;
}

export interface PortsSnapshot {
  scannedAt: number;
  currentPort: number | null;
  studios: StudioPort[];
  tailscale: {
    available: boolean;
    error: string | null;
    unmatched: UnmatchedTailscaleRoute[];
  };
  worktrees: WorktreeRef[];
  warnings: string[];
}

export interface ListenerProcess {
  pid: number;
  port: number;
  cmdline: string;
}

export interface CommandResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export interface PortsServiceOptions {
  repoRoot?: string | null;
  platform?: NodeJS.Platform;
  selfPort?: number | null;
  cacheTtlMs?: number;
  runCommand?: (
    cmd: string,
    args: string[],
    opts?: { cwd?: string; timeoutMs?: number },
  ) => Promise<CommandResult>;
  fetchJson?: (url: string, opts?: { signal?: AbortSignal }) => Promise<unknown>;
  readText?: (filePath: string) => string | null;
  readdir?: (dirPath: string) => string[] | null;
  now?: () => number;
}

export interface PortsService {
  getSnapshot(opts?: {
    currentPort?: number | null;
    forceRefresh?: boolean;
  }): Promise<PortsSnapshot>;
}

export function normalizePath(value: string): string;
export function parseWindowsListeners(jsonText: string): ListenerProcess[];
export function parseNetstatListeners(text: string): { port: number; pid: number }[];
export function parsePosixListeners(
  socketText: string,
  psText: string,
  kind?: "lsof" | "ss",
): ListenerProcess[];
export function parseWorktreeList(porcelainText: string): WorktreeRef[];
export function parseTailscaleServe(jsonText: string): UnmatchedTailscaleRoute[];
export function parseLiveHosts(text: string): string[];
export function countNotes(notesArray: unknown): NotesSummary | null;
export function resolveStudioWorktree(input: {
  port: number;
  cmdline: string;
  filmJson: Record<string, unknown> | null;
  worktrees: WorktreeRef[];
  platform?: NodeJS.Platform;
  readText: (filePath: string) => string | null;
  readdir: (dirPath: string) => string[] | null;
}): {
  film: string | null;
  project: string | null;
  worktree: WorktreeRef | null;
  matchConfidence: "exact" | "inferred" | "ambiguous" | "unknown";
  candidateWorktrees: WorktreeRef[];
};
export function createPortsService(options?: PortsServiceOptions): PortsService;
