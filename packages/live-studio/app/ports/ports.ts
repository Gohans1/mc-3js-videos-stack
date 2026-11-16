// Pure client types, URL safety, formatting, and snapshot fetching for the read-only Ports tab.

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

export type MatchConfidence = "exact" | "inferred" | "ambiguous" | "unknown";
export type StudioStatus = "ready" | "error" | "unreachable";

export interface StudioPort {
  id: string;
  port: number;
  pid: number;
  current: boolean;
  film: string | null;
  ratio: string | null;
  project: string | null;
  worktree: WorktreeRef | null;
  matchConfidence: MatchConfidence;
  candidateWorktrees: WorktreeRef[];
  localUrl: string;
  tailscale: TailscaleEndpoint[];
  notes: NotesSummary | null;
  status: StudioStatus;
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

export type WorktreeDescription =
  | {
      kind: "matched";
      branch: string;
      worktreeName: string;
      path: string;
      isMain: boolean;
      inferred: boolean;
    }
  | {
      kind: "ambiguous";
      candidates: { name: string; branch: string; path: string }[];
    }
  | { kind: "unknown" };

// ASCII control characters (including newlines/null bytes) must never enter hrefs.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/** Validates that a link is an absolute http:// or https:// URL with a host. */
export function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || CONTROL_CHARS.test(trimmed)) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname) return null;
    return trimmed.replace(/^https?:/i, (scheme) => scheme.toLowerCase());
  } catch {
    return null;
  }
}

/** Formats how long ago `scannedAt` occurred for the panel header. */
export function formatRelativeScanAge(scannedAt: number, now = Date.now()): string {
  if (!Number.isFinite(scannedAt)) return "";
  const diffMs = Math.max(0, now - scannedAt);
  if (diffMs < 5_000) return "Updated just now";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `Updated ${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `Updated ${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `Updated ${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `Updated ${day}d ago`;
}

/** Formats an exact local clock string for tooltip context. */
export function formatScanClock(scannedAt: number): string {
  if (!Number.isFinite(scannedAt)) return "";
  return new Date(scannedAt).toLocaleTimeString();
}

/** Sorts studios with the current studio first, then ascending port and pid. */
export function sortStudios(studios: readonly StudioPort[]): StudioPort[] {
  return [...studios].toSorted((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    if (a.port !== b.port) return a.port - b.port;
    return a.pid - b.pid;
  });
}

/** Extracts display state for a studio's worktree attribution without inventing certainty. */
export function describeWorktree(studio: StudioPort): WorktreeDescription {
  if (
    studio.worktree &&
    (studio.matchConfidence === "exact" || studio.matchConfidence === "inferred")
  ) {
    return {
      kind: "matched",
      branch: studio.worktree.branch ?? "detached HEAD",
      worktreeName: studio.worktree.name,
      path: studio.worktree.path,
      isMain: studio.worktree.isMain,
      inferred: studio.matchConfidence === "inferred",
    };
  }
  if (studio.matchConfidence === "ambiguous" || studio.candidateWorktrees.length > 0) {
    return {
      kind: "ambiguous",
      candidates: studio.candidateWorktrees.map((w) => ({
        name: w.name,
        branch: w.branch ?? "detached",
        path: w.path,
      })),
    };
  }
  return { kind: "unknown" };
}

let cachedPortsSnapshot: PortsSnapshot | null = null;

/** Returns the most recent snapshot cached in memory across tab switches. */
export function getCachedPortsSnapshot(): PortsSnapshot | null {
  return cachedPortsSnapshot;
}

/** Updates the in-memory snapshot cache used to avoid remount loading flashes. */
export function setCachedPortsSnapshot(snapshot: PortsSnapshot | null): void {
  cachedPortsSnapshot = snapshot;
}

/** Clears the in-memory snapshot cache (primarily for isolated UI tests). */
export function clearCachedPortsSnapshot(): void {
  cachedPortsSnapshot = null;
}

/** Returns true when a focus/visibility event should avoid interrupting an active or hidden scan. */
export function shouldSkipBackgroundRefresh({
  visibilityState,
  inFlight,
}: {
  visibilityState?: string;
  inFlight: "auto" | "force" | null;
}): boolean {
  if (visibilityState !== undefined && visibilityState !== "visible") return true;
  return inFlight !== null;
}

/** Summarizes active studio and worktree counts for the panel header. */
export function summarizeSnapshot(snapshot: PortsSnapshot): {
  studioCount: number;
  worktreeCount: number;
  label: string;
} {
  const studioCount = snapshot.studios.length;
  const worktreeCount = snapshot.worktrees.length;
  const studioWord = studioCount === 1 ? "studio" : "studios";
  const worktreeWord = worktreeCount === 1 ? "worktree" : "worktrees";
  return {
    studioCount,
    worktreeCount,
    label: `${studioCount} ${studioWord} · ${worktreeCount} ${worktreeWord}`,
  };
}

/** Fetches the read-only port/worktree snapshot from `/api/ports`. */
export async function fetchPortsSnapshot({
  refresh = false,
  signal,
  fetcher = globalThis.fetch,
}: {
  refresh?: boolean;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
} = {}): Promise<PortsSnapshot> {
  const url = refresh ? "/api/ports?refresh=1" : "/api/ports";
  const res = await fetcher(url, { cache: "no-store", signal });
  if (!res.ok) {
    let message = `Failed to scan ports (${res.status})`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body?.error === "string" && body.error.trim()) message = body.error;
    } catch {
      // Non-JSON error body; keep status fallback.
    }
    throw new Error(message);
  }
  const data = (await res.json()) as Partial<PortsSnapshot> | null;
  if (!data || !Array.isArray(data.studios) || typeof data.scannedAt !== "number") {
    throw new Error("Invalid response from /api/ports");
  }
  return data as PortsSnapshot;
}
