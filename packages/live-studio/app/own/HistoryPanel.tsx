import { useEffect, useId, useReducer, useState } from "react";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { flushDocs } from "../core/doc";
import { onEvent } from "../core/events";

type Revision = {
  seq: number;
  id: string;
  name: string;
  kind: string;
  at: string;
  fingerprint: string;
};
type History = {
  revisions: Revision[];
  current: { fingerprint: string; files: number };
  next: number | null;
  problem: string | null;
};
type Phase =
  "loading" | "ready" | "load-error" | "saving" | "restoring" | "paging" | "browsing" | "error";
const request = async <T,>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
  const timeout = AbortSignal.timeout(15000);
  const response = await fetch(path, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `History request failed (${response.status})`);
  return data;
};

export function HistoryPanel() {
  const nameId = useId();
  const [data, setData] = useState<History | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [requestVersion, refreshLatest] = useReducer((version: number) => version + 1, 0);
  const watchingLatest = phase === "loading" || phase === "ready" || phase === "load-error";
  useEffect(() => {
    if (!watchingLatest) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const got = await request<History>("/api/history", undefined, controller.signal);
        if (controller.signal.aborted) return;
        setData(got);
        setPhase("ready");
        setError("");
      } catch (failed) {
        if (controller.signal.aborted) return;
        setError(failed instanceof Error ? failed.message : String(failed));
        setPhase("load-error");
      }
    };
    const offHistory = onEvent("history", refreshLatest);
    const offHello = onEvent("hello", refreshLatest);
    void load();
    return () => {
      offHistory();
      offHello();
      controller.abort();
    };
  }, [watchingLatest, requestVersion]);
  const busy =
    phase === "loading" || phase === "saving" || phase === "restoring" || phase === "paging";
  const save = async () => {
    setPhase("saving");
    setMessage("");
    setError("");
    try {
      await flushDocs();
      await request("/api/history", { name: name.trim() });
      setName("");
      setMessage("Version saved.");
      setPhase("loading");
    } catch (failed) {
      setError(failed instanceof Error ? failed.message : String(failed));
      setPhase("error");
    }
  };
  const restore = async (revision: Revision) => {
    setPhase("restoring");
    setMessage("");
    setError("");
    try {
      await flushDocs();
      const current = await request<History>("/api/history");
      const restored = await request<{ backup: Revision; restartRequired: boolean }>(
        "/api/history/restore",
        { id: revision.id, base: current.current.fingerprint },
      );
      setMessage(
        `Restored ${revision.name}. Your previous work is saved as “${restored.backup.name}”. ${restored.restartRequired ? "Restart this film's Studio to apply its configuration." : "Load the new preview if Studio offers a new version."}`,
      );
      setPhase("loading");
    } catch (failed) {
      setError(failed instanceof Error ? failed.message : String(failed));
      setPhase("error");
    }
  };
  const older = async () => {
    if (!data?.next) return;
    setPhase("paging");
    try {
      const got = await request<History>(`/api/history?before=${data.next}`);
      setData({ ...got, revisions: [...data.revisions, ...got.revisions] });
      setPhase("browsing");
    } catch (failed) {
      setError(failed instanceof Error ? failed.message : String(failed));
      setPhase("error");
    }
  };
  return (
    <section aria-label="Film versions" className="flex min-w-0 flex-col gap-4" aria-busy={busy}>
      <p className="text-muted-foreground text-sm leading-relaxed">
        Keep a named version before trying another direction. Autosaves keep changes while Studio
        runs.
      </p>
      <p className="text-muted-foreground text-ui leading-relaxed">
        Versions keep this film’s code, timelines and configuration. Shared packages and media stay
        current; a restored version can render differently.
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && name.trim()) void save();
        }}
      >
        <label htmlFor={nameId} className="text-ui flex min-w-0 flex-1 basis-40 flex-col gap-1">
          Version name
          <Input
            id={nameId}
            value={name}
            maxLength={160}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            placeholder="Cold light, slower cuts"
          />
        </label>
        <Button type="submit" disabled={busy || !name.trim()}>
          Save version
        </Button>
        <Button
          type="button"
          variant="quiet"
          disabled={busy}
          onClick={() => {
            setPhase("loading");
            refreshLatest();
          }}
        >
          Refresh
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-warn-text text-sm">
          {error}
        </p>
      )}
      {data?.problem && (
        <p role="alert" className="text-warn-text text-sm">
          Autosave: {data.problem}
        </p>
      )}
      <p role="status" className="text-muted-foreground text-ui">
        {busy
          ? phase === "saving"
            ? "Saving version…"
            : phase === "restoring"
              ? "Restoring version…"
              : "Loading versions…"
          : message}
      </p>
      {data && !data.revisions.length && (
        <p className="text-muted-foreground text-sm">
          No versions yet. Save a named version to keep this direction.
        </p>
      )}
      <ul className="divide-hairline-subtle flex min-w-0 flex-col divide-y">
        {data?.revisions.map((revision) => (
          <li key={revision.id} className="flex min-w-0 flex-wrap items-center gap-2 py-3">
            <div className="min-w-0 flex-1 basis-40">
              <p className="text-sm font-medium wrap-anywhere">{revision.name}</p>
              <p className="text-muted-foreground text-ui">
                {new Date(revision.at).toLocaleString()} · {revision.kind}
              </p>
            </div>
            <Button
              variant="quiet"
              disabled={busy || revision.fingerprint === data.current.fingerprint}
              onClick={() => void restore(revision)}
              aria-label={`Restore ${revision.name}`}
            >
              Restore
            </Button>
          </li>
        ))}
      </ul>
      {data?.next && (
        <Button variant="quiet" disabled={busy} onClick={() => void older()}>
          Load older versions
        </Button>
      )}
    </section>
  );
}
