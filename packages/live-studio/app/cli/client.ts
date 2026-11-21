import type {
  CliArgValue,
  CliCatalogResponse,
  CliRunChunk,
  CliRunRequest,
  CliRunSnapshot,
  CliTemplate,
} from "../../src/cli-catalog.ts";

export type StartCliRunResult =
  | {
      ok: true;
      run: CliRunSnapshot;
    }
  | {
      ok: false;
      status: number;
      code?: string;
      error: string;
      confirmMessage?: string;
      activeRunId?: string;
    };

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export async function fetchCliCatalog(film?: string | null): Promise<CliCatalogResponse> {
  const qs = film ? `?film=${encodeURIComponent(film)}` : "";
  const res = await fetch(`/api/cli/catalog${qs}`);
  if (!res.ok) throw new Error(`Failed to load CLI catalog (${res.status})`);
  return readJson<CliCatalogResponse>(res);
}

export async function fetchCliRuns(): Promise<{
  active: CliRunSnapshot | null;
  last: CliRunSnapshot | null;
}> {
  const res = await fetch("/api/cli/runs");
  if (!res.ok) throw new Error(`Failed to load CLI run state (${res.status})`);
  return readJson<{ active: CliRunSnapshot | null; last: CliRunSnapshot | null }>(res);
}

export async function startCliRun(request: CliRunRequest): Promise<StartCliRunResult> {
  const res = await fetch("/api/cli/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) {
    return { ok: true, run: body.run as CliRunSnapshot };
  }
  return {
    ok: false,
    status: res.status,
    code: typeof body.code === "string" ? body.code : undefined,
    error: typeof body.error === "string" ? body.error : `Command failed (${res.status})`,
    confirmMessage: typeof body.confirmMessage === "string" ? body.confirmMessage : undefined,
    activeRunId: typeof body.activeRunId === "string" ? body.activeRunId : undefined,
  };
}

export async function stopCliRun(runId: string): Promise<CliRunSnapshot | null> {
  const res = await fetch(`/api/cli/runs/${encodeURIComponent(runId)}/stop`, {
    method: "POST",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await readErrorMessage(res, `Stop request failed (${res.status})`));
  const body = await res.json().catch(() => null);
  return (body?.run as CliRunSnapshot | undefined) ?? null;
}

export interface CliRunDonePayload {
  runId: string;
  status: CliRunSnapshot["status"];
  exitCode?: number | null;
  signal?: string | null;
  durationMs?: number;
  truncated?: boolean;
  error?: string;
}

export function openCliRunStream(
  runId: string,
  afterSeq: number,
  handlers: {
    onChunk: (chunk: CliRunChunk) => void;
    onDone: (payload: CliRunDonePayload) => void;
    onError: () => void;
  },
): () => void {
  const es = new EventSource(
    `/api/cli/runs/${encodeURIComponent(runId)}/stream?afterSeq=${encodeURIComponent(String(afterSeq))}`,
  );
  let closed = false;

  es.addEventListener("chunk", (ev) => {
    if (closed) return;
    try {
      const data = JSON.parse((ev as MessageEvent<string>).data) as CliRunChunk;
      handlers.onChunk(data);
    } catch {
      // Ignore malformed chunk
    }
  });

  es.addEventListener("done", (ev) => {
    if (closed) return;
    try {
      const data = JSON.parse((ev as MessageEvent<string>).data) as CliRunDonePayload;
      handlers.onDone(data);
    } catch {
      // Ignore malformed done payload
    }
    closed = true;
    es.close();
  });

  es.onerror = () => {
    if (closed) return;
    handlers.onError();
  };

  return () => {
    closed = true;
    es.close();
  };
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const err = await res.json().catch(() => ({}));
  if (typeof err?.error === "string" && err.error.trim()) return err.error;
  const issue = err?.error?.issues?.[0]?.message;
  return typeof issue === "string" && issue.trim() ? issue : fallback;
}

export async function fetchCliTemplatesState(): Promise<{
  templates: CliTemplate[];
  warning: string | null;
}> {
  const res = await fetch("/api/cli/templates");
  if (!res.ok)
    throw new Error(await readErrorMessage(res, `Failed to load CLI templates (${res.status})`));
  const body = await readJson<{ templates: CliTemplate[]; warning?: string | null }>(res);
  return {
    templates: body.templates ?? [],
    warning: typeof body.warning === "string" && body.warning.trim() ? body.warning : null,
  };
}

export async function fetchCliTemplates(): Promise<CliTemplate[]> {
  const { templates } = await fetchCliTemplatesState();
  return templates;
}

export async function saveCliTemplate(input: {
  id?: string;
  name: string;
  commandId: string;
  subcommandPath?: string[];
  args?: Record<string, CliArgValue>;
  flags?: Record<string, CliArgValue>;
  targetFilm?: string;
  pinned?: boolean;
}): Promise<{ template: CliTemplate; templates: CliTemplate[] }> {
  const res = await fetch("/api/cli/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Save failed (${res.status})`));
  }
  return readJson<{ template: CliTemplate; templates: CliTemplate[] }>(res);
}

export async function deleteCliTemplate(id: string): Promise<CliTemplate[]> {
  const res = await fetch(`/api/cli/templates/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, `Delete failed (${res.status})`));
  const body = await readJson<{ templates: CliTemplate[] }>(res);
  return body.templates ?? [];
}
