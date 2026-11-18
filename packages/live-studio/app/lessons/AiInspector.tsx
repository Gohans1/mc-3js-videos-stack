import {
  ArrowUpRight,
  BookOpenText,
  ChevronDown,
  MessageSquareText,
  Settings2,
} from "lucide-react";
import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

import {
  DEFAULT_LESSON_JEV_CONFIG,
  InspectorNoteSchema,
  JEV_ENGINE_FIELDS,
  type LessonJevConfig,
  LessonJevConfigSchema,
} from "../../src/lesson-config";
import { useStudio } from "../core/store";
import { useInspectorSession } from "./inspector-session";
import type { InspectNote, InspectorInfo, InspectorView, InspectResult } from "./inspector-types";
import { InspectorCode, InspectorPreview } from "./InspectorPreview";
import {
  inspectorSettingErrors,
  InspectorSettings,
  revealFocusedFieldError,
} from "./InspectorSettings";
import { JevSafetyBanner } from "./JevSafetyBanner";
import { SCOPE_LABEL } from "./lesson-ui";
import { lessons, parseLessonKey, useLessons } from "./lessons";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init).catch((cause) => {
    throw new Error("Could not reach Studio. Check the connection and try again.", { cause });
  });
  const body = await response.json().catch(() => null);
  if (body === null) throw new Error("Studio returned an unreadable response. Try again.");
  if (!response.ok)
    throw new Error(
      typeof body.error === "string"
        ? body.error
        : response.status >= 500
          ? "Studio could not complete the request. Try again."
          : "Studio rejected the request. Check your inputs and try again.",
      { cause: response.status },
    );
  return body as T;
}
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const scopes = [
  { value: "both", label: "All lessons" },
  { value: "film", label: SCOPE_LABEL.film },
  { value: "all", label: SCOPE_LABEL.all },
];
type RequestFailure = { key: string; message: string };

export function AiInspector({ active, onOpenDeck }: { active: boolean; onOpenDeck: () => void }) {
  const { files, edits, inspectorLiveEnabled } = useLessons((s) => s);
  const liveNotes = useStudio((s) => s.notes),
    ready = useStudio((s) => s.ready);
  const [info, setInfo] = useState<InspectorInfo | null>(null);
  const availableNotes = ready ? liveNotes : (info?.notes ?? []);
  const { config, saved, note, excluded } = useInspectorSession();
  const scope = config.scopeFilter;
  const scopedFiles = scope === "both" ? files : files.filter((file) => file.scope === scope);
  const scopedExcluded = scopedFiles.filter((file) => excluded.includes(file.key));
  const includedCount = scopedFiles.length - scopedExcluded.length;
  const [view, setView] = useState<InspectorView>("ai");
  const [change, setChange] = useState("Ready");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [runFailure, setRunFailure] = useState<RequestFailure | null>(null);
  const [saveFailure, setSaveFailure] = useState<RequestFailure | null>(null);
  const [received, setReceived] = useState<{
    key: string;
    value: InspectResult;
    previous?: InspectResult;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [pinnedActionsHeight, setPinnedActionsHeight] = useState(0);
  const controlsRef = useRef<HTMLDivElement>(null),
    errorRef = useRef<HTMLDivElement>(null),
    noteRef = useRef<HTMLTextAreaElement>(null),
    actionsRef = useRef<HTMLDivElement>(null),
    lessonFilesSummaryRef = useRef<HTMLElement>(null);
  const running = useRef(false),
    generation = useRef(0);
  const runFailureToast = useRef<string | null>(null),
    saveFailureToast = useRef<string | null>(null);
  const enabled = active && inspectorLiveEnabled;
  const usesFreeModel =
    config.route === "free" && config.freeModel === DEFAULT_LESSON_JEV_CONFIG.freeModel;
  const providerHint =
    config.route === "free"
      ? usesFreeModel
        ? "Free model · OpenCode Zen"
        : "OpenCode Zen only"
      : config.route === "paid"
        ? "Paid · OpenRouter"
        : "May use paid OpenRouter";
  const body = useMemo(
    () => ({
      note,
      config,
      drafts: [
        ...Object.entries(edits).map(([key, e]) => ({ ...parseLessonKey(key), text: e.text })),
        ...excluded.map((key) => ({ ...parseLessonKey(key), text: null })),
      ],
    }),
    [note, config, edits, excluded],
  );
  const bodyKey = JSON.stringify(body);
  const previewKey = JSON.stringify([bodyKey, files.map((f) => [f.key, f.tag]), retry]);
  const currentBody = useRef(previewKey);
  useLayoutEffect(() => {
    currentBody.current = previewKey;
  }, [previewKey]);
  useLayoutEffect(() => {
    const controls = controlsRef.current,
      actions = actionsRef.current;
    if (!controls || !actions) return;
    const measure = () => {
      const height = actions.getBoundingClientRect().height;
      setPinnedActionsHeight(height * 2 < controls.clientHeight ? height : 0);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(controls);
    observer.observe(actions);
    measure();
    return () => observer.disconnect();
  }, []);
  const updating = received?.key !== previewKey;
  const runError = runFailure?.key === previewKey ? runFailure.message : "";
  const valid = LessonJevConfigSchema.safeParse(config);
  const configError = valid.success ? "" : "Fix the highlighted settings in Advanced settings.";
  const validNote = InspectorNoteSchema.safeParse(note);
  const noteIssues = validNote.success ? [] : validNote.error.issues;
  const noteError = noteIssues.find((issue) => issue.path[0] !== "asks")?.message;
  const repliesError = noteIssues.find((issue) => issue.path[0] === "asks")?.message;
  const validationError = noteError || repliesError || configError;
  const fieldErrors = inspectorSettingErrors(valid.success ? [] : valid.error.issues);
  const configKey = JSON.stringify(config);
  const dirty = configKey !== saved;
  const saveError = saveFailure?.key === configKey ? saveFailure.message : "";
  const saveLabel = saving
    ? "Saving…"
    : saveError
      ? "Retry save"
      : dirty
        ? "Save CLI settings"
        : "Settings up to date";
  const choosePreviewView = (next: InspectorView) => {
    setView(next);
    setReceived((current) => (current?.previous ? { ...current, previous: undefined } : current));
  };
  const revealPreviewError = () => {
    errorRef.current?.scrollIntoView({ block: "start" });
    errorRef.current?.focus({ preventScroll: true });
  };
  const accept = (key: string, value: InspectResult) =>
    setReceived((previous) => ({
      key,
      value,
      previous: previous?.key === key ? previous.previous : previous?.value,
    }));
  const changeNote = (value: InspectNote) => {
    useInspectorSession.setState({ note: value });
    setError("");
    setView("ai");
    setChange("Note edited");
  };
  const changeConfig = (
    value: LessonJevConfig,
    _key: keyof LessonJevConfig,
    label: string,
    nextView: InspectorView,
  ) => {
    useInspectorSession.setState({ config: value });
    setError("");
    setView(nextView);
    setChange(label + " changed");
  };
  const resetConfig = () =>
    changeConfig(DEFAULT_LESSON_JEV_CONFIG, "enabled", "Default settings", "ai");
  const includeFile = (key: string, included: boolean) => {
    useInspectorSession.setState({
      excluded: included ? excluded.filter((x) => x !== key) : [...excluded, key],
    });
    setError("");
    setView("lessons");
    setChange(included ? "File restored" : "File excluded");
  };
  useEffect(() => () => lessons.setState({ inspectorLiveEnabled: false }), []);
  useEffect(() => {
    const controller = new AbortController();
    void request<InspectorInfo>("/api/lessons/inspect", { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setInfo(data);
        if (!useInspectorSession.getState().hydrated)
          useInspectorSession.setState({
            config: data.config,
            saved: JSON.stringify(data.config),
            hydrated: true,
          });
        setError("");
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => {
    if (!info || !active || busy || validationError || !updating) return;
    const controller = new AbortController(),
      id = ++generation.current;
    const timer = setTimeout(() => {
      void request<InspectResult>("/api/lessons/inspect", {
        ...json("POST", { ...JSON.parse(bodyKey), runJev: false }),
        signal: controller.signal,
      })
        .then((data) => {
          if (id === generation.current) {
            accept(previewKey, data);
            setError("");
          }
        })
        .catch((e: Error) => {
          if (!controller.signal.aborted && id === generation.current) setError(e.message);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [bodyKey, previewKey, info, active, busy, validationError, retry, updating]);
  const run = async () => {
    if (!enabled || running.current || validationError || updating) return;
    if (runFailureToast.current) {
      toast.close(runFailureToast.current);
      runFailureToast.current = null;
    }
    running.current = true;
    ++generation.current;
    setBusy(true);
    setError("");
    setRunFailure(null);
    setView("ai");
    const snapshot = previewKey;
    try {
      const value = await request<InspectResult>(
        "/api/lessons/inspect",
        json("POST", { ...JSON.parse(bodyKey), runJev: true }),
      );
      if (currentBody.current === snapshot) {
        accept(snapshot, value);
        setChange(value.status === "cached" ? "Cached matches reused" : "Jev run finished");
      }
      toast.add({
        title: value.status === "cached" ? "Cached result reused · no call" : "Jev run finished",
        type: "info",
      });
    } catch (e) {
      const failure = e as Error;
      const message =
        usesFreeModel || failure.cause === 424
          ? failure.message
          : `${failure.message} The provider may still charge for this attempt.`;
      if (currentBody.current === snapshot) setRunFailure({ key: snapshot, message });
      runFailureToast.current = toast.add({
        title: "Jev run failed",
        description: message,
        type: "error",
      });
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const save = async () => {
    if (!valid.success || saving) return;
    if (saveFailureToast.current) {
      toast.close(saveFailureToast.current);
      saveFailureToast.current = null;
    }
    const snapshot = configKey;
    setSaving(true);
    setSaveFailure(null);
    try {
      await request("/api/lessons/inspect", json("PUT", config));
      useInspectorSession.setState({ saved: snapshot });
      toast.add({
        title: "Settings saved for this film",
        description: "The notes CLI now uses these settings.",
      });
    } catch (e) {
      setSaveFailure({ key: snapshot, message: (e as Error).message });
      saveFailureToast.current = toast.add({
        title: "Settings were not saved",
        description: (e as Error).message,
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };
  const missingLessons = !files.length
    ? "Add a lesson in Deck."
    : !scopedFiles.length
      ? "Choose a scope with lessons."
      : !includedCount
        ? "Include a lesson file."
        : "";
  const reason = validationError
    ? "Check the highlighted fields."
    : !note.text.trim()
      ? "Write a note."
      : missingLessons ||
        (error
          ? "Retry the preview to run Jev."
          : updating
            ? "Updating preview…"
            : !received?.value.pool.length
              ? "No lesson files available."
              : "");
  const noteOptions = [
    { value: "simulation", label: "Write a preview note" },
    ...availableNotes.map((n) => ({ value: n.id ?? "", label: n.text })),
  ];
  return (
    <div
      className="font-md text-foreground @container/inspector flex min-h-0 min-w-0 flex-1 flex-col text-sm/relaxed"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <h2 className="sr-only">AI Inspector</h2>
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,4fr)] @min-[700px]/inspector:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] @min-[700px]/inspector:grid-rows-1 @min-[20rem]/inspector:@max-[700px]/inspector:grid-rows-[minmax(0,2fr)_minmax(0,3fr)] @max-[700px]/inspector:[@media(min-width:821px)_and_(min-height:521px)]:grid-rows-[repeat(2,minmax(0,1fr))]">
        <div
          data-inspector-controls
          ref={controlsRef}
          role="region"
          tabIndex={0}
          aria-label="Inspector controls"
          className="focus-visible:outline-ring min-h-0 min-w-0 scroll-pt-(--inspector-actions-offset) scroll-pb-5 [scrollbar-width:thin] overflow-y-auto overscroll-contain outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid"
          style={{ "--inspector-actions-offset": `${pinnedActionsHeight}px` } as CSSProperties}
        >
          <div
            ref={actionsRef}
            className={pinnedActionsHeight ? "bg-background sticky top-0 z-10" : "bg-background"}
          >
            <JevSafetyBanner
              enabled={enabled}
              onChange={(value) => lessons.setState({ inspectorLiveEnabled: value })}
              onRun={() => void run()}
              busy={busy}
              disabled={!info || Boolean(validationError) || Boolean(reason)}
              reason={reason}
              providerHint={providerHint}
            >
              <Button
                size="md"
                variant={dirty ? "lit" : "outline"}
                className="w-36 max-w-full"
                disabled={!dirty || !info || !valid.success || saving || busy}
                onClick={() => void save()}
                aria-busy={saving}
              >
                {saveLabel}
              </Button>
            </JevSafetyBanner>
          </div>
          <div className="mx-auto flex w-full max-w-lg min-w-0 flex-col gap-6 p-4">
            {(runError || (!validationError && error)) && (
              <Alert variant="destructive" ref={errorRef} tabIndex={-1}>
                <AlertTitle>{runError ? "Jev run failed" : "Preview needs attention"}</AlertTitle>
                <AlertDescription>
                  {runError || error}
                  {runError && !enabled && <p>Turn on Jev calls to retry.</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="md"
                      variant="outline"
                      disabled={
                        busy ||
                        (Boolean(runError) &&
                          (!enabled || Boolean(validationError) || Boolean(reason)))
                      }
                      onClick={() => {
                        const target = runError ? controlsRef.current : noteRef.current;
                        target?.focus();
                        if (runError) void run();
                        else {
                          setError("");
                          setRetry((v) => v + 1);
                        }
                      }}
                    >
                      {runError ? "Retry Jev" : "Retry preview"}
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}
            {saveError && (
              <Alert variant="destructive">
                <AlertTitle>Settings were not saved</AlertTitle>
                <AlertDescription>
                  {saveError}
                  <div className="flex">
                    <Button
                      size="md"
                      variant="outline"
                      disabled={busy || saving || !valid.success || !info}
                      onClick={() => {
                        controlsRef.current?.focus();
                        void save();
                      }}
                    >
                      Retry save
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}
            <fieldset disabled={busy || !info} className="flex min-w-0 flex-col gap-6">
              <section className="flex flex-col gap-3" aria-labelledby="inspect-note-heading">
                <h3
                  id="inspect-note-heading"
                  className="text-ink-text flex items-center gap-2 text-base/[1.3] font-semibold"
                >
                  <MessageSquareText size={16} absoluteStrokeWidth aria-hidden />
                  Creator’s note
                </h3>
                <FieldGroup>
                  {availableNotes.length > 0 && (
                    <Field>
                      <FieldLabel variant="row" htmlFor="inspect-note">
                        Start from a note
                      </FieldLabel>
                      <Select
                        value={note.id ?? "simulation"}
                        items={noteOptions}
                        onValueChange={(id) =>
                          changeNote(
                            availableNotes.find((n) => n.id === id) ?? { text: "", asks: [] },
                          )
                        }
                      >
                        <SelectTrigger id="inspect-note" size="readable" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent alignItemWithTrigger={false} finalFocus motion="instant">
                          <SelectGroup>
                            {noteOptions.map((n) => (
                              <SelectItem key={n.value} value={n.value} size="readable">
                                {n.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                  <Field>
                    <FieldLabel variant="row" htmlFor="inspect-note-text" className="sr-only">
                      Creator’s note
                    </FieldLabel>
                    <Textarea
                      variant="inspector"
                      id="inspect-note-text"
                      ref={noteRef}
                      aria-invalid={Boolean(noteError) || undefined}
                      aria-describedby={noteError ? "inspect-note-error" : undefined}
                      value={note.text}
                      className="max-h-48 overflow-y-auto overscroll-contain @min-[700px]/inspector:min-h-24"
                      onChange={(e) => changeNote({ ...note, text: e.target.value })}
                      placeholder="Describe what should change"
                    />
                    {noteError && (
                      <FieldError id="inspect-note-error" ref={revealFocusedFieldError}>
                        {noteError}
                      </FieldError>
                    )}
                  </Field>
                  <details>
                    <summary className="focus-visible:ring-ring cursor-pointer rounded-sm py-1 font-medium tabular-nums outline-none focus-visible:ring-2">
                      Replies{note.asks?.length ? " · " + note.asks.length : " · optional"}
                    </summary>
                    <Field>
                      <FieldLabel variant="row" htmlFor="inspect-replies">
                        One reply per line
                      </FieldLabel>
                      <Textarea
                        variant="inspector"
                        id="inspect-replies"
                        aria-invalid={Boolean(repliesError) || undefined}
                        aria-describedby={repliesError ? "inspect-replies-error" : undefined}
                        className="max-h-40 overflow-y-auto overscroll-contain"
                        value={(note.asks ?? []).map((a) => a.text).join("\n")}
                        onChange={(e) =>
                          changeNote({
                            ...note,
                            asks: e.target.value
                              ? e.target.value
                                  .split("\n")
                                  .map((text, i) => ({ ...note.asks?.[i], text }))
                              : [],
                          })
                        }
                      />
                      {repliesError && (
                        <FieldError id="inspect-replies-error" ref={revealFocusedFieldError}>
                          {repliesError}
                        </FieldError>
                      )}
                    </Field>
                  </details>
                </FieldGroup>
                <p className="text-muted-foreground text-sm/relaxed">
                  Preview edits do not change the original note.
                </p>
              </section>
              <section className="flex flex-col gap-3" aria-labelledby="inspect-lessons-heading">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3
                    id="inspect-lessons-heading"
                    className="text-primary-text flex items-center gap-2 text-base/[1.3] font-semibold"
                  >
                    <BookOpenText size={16} absoluteStrokeWidth aria-hidden />
                    Lessons from Deck
                  </h3>
                  <Button size="md" variant="outline" onClick={onOpenDeck}>
                    Edit in Deck
                    <ArrowUpRight data-icon="inline-end" />
                  </Button>
                </div>
                <Field>
                  <FieldLabel variant="row" htmlFor="inspect-scope">
                    Search lessons in
                  </FieldLabel>
                  <Select
                    value={config.scopeFilter}
                    items={scopes}
                    onValueChange={(value) => {
                      if (value === "both" || value === "film" || value === "all")
                        changeConfig(
                          { ...config, scopeFilter: value },
                          "scopeFilter",
                          "Lesson scope",
                          "lessons",
                        );
                    }}
                  >
                    <SelectTrigger id="inspect-scope" size="readable" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false} finalFocus motion="instant">
                      <SelectGroup>
                        {scopes.map((s) => (
                          <SelectItem key={s.value} value={s.value} size="readable">
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Button size="md" variant="ghost" onClick={() => choosePreviewView("lessons")}>
                  View extracted lessons
                </Button>
                <details>
                  <summary
                    ref={lessonFilesSummaryRef}
                    className="focus-visible:ring-ring cursor-pointer rounded-sm py-1 font-medium tabular-nums outline-none focus-visible:ring-2"
                  >
                    Lesson files · {includedCount} of {scopedFiles.length} included
                  </summary>
                  {scopedFiles.length > 0 && (
                    <p className="text-muted-foreground mt-2 mb-3 text-sm/relaxed">
                      Uncheck files to omit them from previews and Jev runs.
                    </p>
                  )}
                  {scopedFiles.length === 0 && (
                    <p className="text-muted-foreground text-sm/relaxed">
                      Add lessons in Deck or choose another scope.
                    </p>
                  )}
                  <FieldGroup>
                    {scopedFiles.map((file, i) => (
                      <Field key={file.key} orientation="horizontal" data-inspector-file>
                        <Checkbox
                          id={"inspect-file-" + i}
                          checked={!excluded.includes(file.key)}
                          onCheckedChange={(checked) => includeFile(file.key, checked)}
                        />
                        <FieldLabel variant="row" htmlFor={"inspect-file-" + i}>
                          <span className="min-w-0 wrap-anywhere">
                            {file.path} · {SCOPE_LABEL[file.scope]}
                          </span>
                        </FieldLabel>
                      </Field>
                    ))}
                  </FieldGroup>
                </details>
                {scopedExcluded.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-muted-foreground text-sm tabular-nums">
                      {scopedExcluded.length} excluded
                    </span>
                    <Button
                      size="md"
                      variant="outline"
                      onClick={(event) => {
                        if (event.detail === 0) lessonFilesSummaryRef.current?.focus();
                        useInspectorSession.setState({
                          excluded: excluded.filter(
                            (key) => !scopedExcluded.some((file) => file.key === key),
                          ),
                        });
                        setView("lessons");
                        setChange("Files in this scope restored");
                      }}
                    >
                      Include all in scope
                    </Button>
                  </div>
                )}
              </section>
              <details className="group/advanced border-border border-t pt-3">
                <summary className="focus-visible:ring-ring flex cursor-pointer list-none items-center justify-between gap-2 rounded-sm py-2 font-medium outline-none focus-visible:ring-2">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                    <Settings2 size={16} absoluteStrokeWidth aria-hidden />
                    Advanced settings
                    {configError && <span className="text-destructive-text">· Check fields</span>}
                  </span>
                  <ChevronDown className="size-4 group-open/advanced:rotate-180" aria-hidden />
                </summary>
                <p className="text-muted-foreground mt-1 mb-4 text-sm/relaxed">
                  Prompts, matching rules and output format. Each edit opens its related preview.
                  Save settings to apply them to the notes CLI.
                </p>
                <InspectorSettings config={config} onChange={changeConfig} errors={fieldErrors} />
                <div className="mt-6 flex flex-wrap gap-2">
                  <ResetSettingsDialog onReset={resetConfig} />
                  <Dialog instantForKeyboard>
                    <DialogTrigger render={<Button size="md" variant="ghost" />}>
                      Clear Inspector cache
                    </DialogTrigger>
                    <DialogContent showCloseButton={false} motion="fade">
                      <DialogTitle>Clear Inspector cache?</DialogTitle>
                      <DialogDescription>
                        This removes saved Inspector matches and run details. Future runs may call
                        Jev again. Lesson files and CLI matches stay available.
                      </DialogDescription>
                      <DialogFooter>
                        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                        <DialogClose
                          render={<Button variant="destructive" />}
                          onClick={() =>
                            void request("/api/lessons/inspect-cache", { method: "DELETE" })
                              .then(() => {
                                setRetry((v) => v + 1);
                                setChange("Inspector cache cleared");
                                toast.add({ title: "Inspector cache cleared" });
                              })
                              .catch((e: Error) =>
                                toast.add({
                                  title: "Could not clear Inspector cache",
                                  description: e.message,
                                  type: "error",
                                }),
                              )
                          }
                        >
                          Clear cache
                        </DialogClose>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
                <details className="mt-4">
                  <summary className="focus-visible:ring-ring cursor-pointer rounded-sm py-2 font-medium outline-none focus-visible:ring-2">
                    Engine reference
                  </summary>
                  <InspectorCode>
                    {JSON.stringify(
                      { keys: info?.keys, engine: info?.engine, fields: JEV_ENGINE_FIELDS },
                      null,
                      2,
                    )}
                  </InspectorCode>
                </details>
              </details>
            </fieldset>
          </div>
          <div
            aria-hidden
            data-inspector-scroll-cue
            className="from-background pointer-events-none invisible sticky bottom-0 -mt-5 h-5 bg-linear-to-t to-transparent"
          />
        </div>
        <InspectorPreview
          hasNote={Boolean(note.text.trim())}
          canChooseNote={availableNotes.length > 0}
          allFilesExcluded={scopedFiles.length > 0 && includedCount === 0}
          result={received?.value ?? null}
          previous={received?.previous}
          view={view}
          onViewChange={choosePreviewView}
          updating={updating}
          runningJev={busy}
          change={change}
          error={validationError || runError || error}
          onReviewError={revealPreviewError}
          validationError={validationError}
          failedRun={Boolean(runError)}
        />
      </div>
    </div>
  );
}

function ResetSettingsDialog({ onReset }: { onReset: () => void }) {
  return (
    <Dialog instantForKeyboard>
      <DialogTrigger render={<Button size="md" variant="outline" />}>Reset defaults</DialogTrigger>
      <DialogContent showCloseButton={false} motion="fade">
        <DialogTitle>Reset Inspector settings?</DialogTitle>
        <DialogDescription>
          Reset replaces the current settings and discards unsaved edits. Select Save CLI settings
          to apply the defaults to the notes CLI.
        </DialogDescription>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <DialogClose render={<Button variant="destructive" />} onClick={onReset}>
            Reset defaults
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
