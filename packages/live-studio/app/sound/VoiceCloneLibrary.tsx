import {
  Bookmark,
  Check,
  CloudDownload,
  Copy,
  Loader2,
  Mic,
  Pause,
  Play,
  RefreshCw,
  Star,
  Trash2,
} from "lucide-react";
import {
  type ComponentProps,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import type { CloudClone, PlaygroundClone } from "../../src/voice-playground-clones.mjs";
import { say } from "../core/store";
import { listening, subscribeAudition } from "./sound";
import { useVoiceTakes } from "./voice-client";
import {
  chooseCastingVoice,
  cloneAction,
  cloneVoiceOption,
  createPlaygroundClone,
  getPlaygroundSnapshot,
  loadPlaygroundClones,
  previewCastingVoice,
  selectComposerVoice,
  setComposerDraft,
  setPlaygroundSubTab,
  useVoicePlaygroundSelector,
} from "./voice-playground-client";
import { activeFilmVoices } from "./voice-playground-view";

const EMPTY_CLONES: PlaygroundClone[] = [];
const LIBRARIES = [
  { value: "project", label: "This project" },
  { value: "global", label: "Global - every project" },
];
const LANGUAGES = [
  { value: "English", label: "English" },
  { value: "Vietnamese", label: "Vietnamese / Tiếng Việt" },
];
const PREVIEW_SCRIPTS = {
  English: "Hello, this is my voice.",
  Vietnamese: "Xin chào, đây là giọng của tôi.",
};
const cloneTitle = (clone: PlaygroundClone) => clone.displayName ?? clone.settings.name;
const PHASE_LABELS = {
  prepared: "Sample saved",
  submitting: "Sending to GenVoice",
  processing: "Cloning voice",
  ready: "Ready",
  failed: "Failed",
  uncertain: "Response unconfirmed",
  unavailable: "Cloud voice unavailable",
};
type CloneAction = import("./voice-playground-client").CloneAction;
type Operation =
  { status: "idle" } | { status: "creating"; startedAt: number } | { status: "acting"; id: string };

function CloneCard({
  clone,
  now,
  busy,
  inUse,
  otherScopeSaved,
  onAction,
  onUse,
  onCloud,
}: {
  clone: PlaygroundClone;
  now: number;
  busy: boolean;
  inUse: boolean;
  otherScopeSaved: boolean;
  onAction: (clone: PlaygroundClone, action: CloneAction, input?: Record<string, unknown>) => void;
  onUse: (clone: PlaygroundClone, template?: boolean) => void;
  onCloud: (clone: PlaygroundClone) => void;
}) {
  const elapsed = Math.max(
    0,
    Math.floor((now - Date.parse(clone.submittedAt ?? clone.createdAt)) / 1000),
  );
  const active = ["submitting", "processing"].includes(clone.phase);
  const preview =
    clone.sampleAudioFile && !clone.previewStale
      ? `/api/voice/playground/audio/${encodeURIComponent(clone.sampleAudioFile)}?scope=${clone.scope}`
      : "";
  const auditionId = `gv:minimax:${clone.remoteId}`,
    playing = useSyncExternalStore(subscribeAudition, listening, listening) === auditionId;
  const [confirm, setConfirm] = useState<"retry" | "delete" | null>(null);
  return (
    <article
      className={cn(
        "rounded-xl border p-4",
        clone.phase === "ready" ? "border-primary/30 bg-primary/[0.04]" : "border-hairline bg-card",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-foreground text-base font-semibold break-words">
            {cloneTitle(clone)}
            {inUse && (
              <span className="text-ok-text ms-2 inline-flex items-center gap-1 text-xs">
                <Check className="size-3" />
                In use
              </span>
            )}
          </h3>
          <p className="text-muted-foreground mt-1 text-xs">
            MiniMax · {clone.settings.language} · {clone.settings.gender} ·{" "}
            {clone.scope === "global" ? "Global" : "This project"}
          </p>
        </div>
        <Button
          variant="favorite"
          size="icon-sm"
          aria-label={`${clone.favorite ? "Unfavorite" : "Favorite"} ${cloneTitle(clone)}`}
          aria-pressed={clone.favorite}
          disabled={busy}
          onClick={() => onAction(clone, "update", { favorite: !clone.favorite })}
        >
          <Star className={clone.favorite ? "fill-current" : ""} />
        </Button>
      </div>
      <p
        role="status"
        className={cn(
          "mt-3 flex items-center gap-2 text-sm font-medium",
          clone.phase === "ready"
            ? "text-ok-text"
            : clone.phase === "failed"
              ? "text-destructive"
              : "text-primary-text",
        )}
      >
        {active ? (
          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
        ) : clone.phase === "ready" ? (
          <Check className="size-3.5" />
        ) : null}
        {PHASE_LABELS[clone.phase]}
        {active ? ` · ${elapsed}s elapsed` : ""}
      </p>
      {(clone.error || clone.warning || clone.previewError) && (
        <p className="text-warn-text mt-2 text-xs leading-relaxed">
          {clone.error || clone.warning || clone.previewError}
        </p>
      )}
      {clone.phase === "failed" && (
        <p className="text-warn-text mt-2 text-xs leading-relaxed">
          {clone.remoteId
            ? `${clone.sourceFile ? "Your sample is saved." : "Your saved settings are kept."} Open Recovery below to recreate this voice; GenVoice may charge again.`
            : "Your sample is saved, but no cloud ID was captured. Find and link the existing cloud voice before creating another one."}
        </p>
      )}
      {clone.phase === "ready" && !preview && (
        <p className="text-muted-foreground mt-2 text-xs">
          {!clone.lastCheckedAt
            ? "Saving the preview…"
            : "No preview was returned. Use this voice to generate a short sample, or Refresh to check again."}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={!preview || busy}
          onClick={() =>
            previewCastingVoice({
              id: clone.remoteId ?? clone.id,
              name: cloneTitle(clone),
              provider: "minimax",
              category: "Cloned voice",
              language: clone.settings.language,
              previewUrl: preview,
            })
          }
        >
          {playing ? <Pause /> : <Play />}
          {playing ? "Pause" : "Listen"}
        </Button>
        <Button
          size="sm"
          disabled={clone.phase !== "ready" || !clone.remoteId || busy}
          onClick={() => onUse(clone)}
        >
          Use voice
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={clone.phase !== "ready" || busy}
          onClick={() => onUse(clone, true)}
        >
          <Bookmark />
          Set up template
        </Button>
        {otherScopeSaved ? (
          <Badge variant="secondary">
            <Check />
            {clone.scope === "global" ? "Saved in this project" : "Saved in Global"}
          </Badge>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() =>
              onAction(clone, "copy", { scope: clone.scope === "global" ? "project" : "global" })
            }
          >
            <Copy />
            {clone.scope === "global" ? "Copy to this project" : "Copy to Global"}
          </Button>
        )}
        {clone.remoteId && (
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            aria-label={`Refresh ${cloneTitle(clone)}`}
            onClick={() => onAction(clone, "refresh")}
          >
            <RefreshCw className={busy ? "animate-spin motion-reduce:animate-none" : ""} />
          </Button>
        )}
      </div>
      {clone.phase === "prepared" && (
        <Button
          className="mt-3"
          size="sm"
          disabled={busy}
          onClick={() => onAction(clone, "submit")}
        >
          Submit saved sample · fee unknown
        </Button>
      )}
      {((!clone.remoteId && clone.phase !== "prepared") || clone.phase === "uncertain") && (
        <Button className="mt-3" variant="secondary" size="sm" onClick={() => onCloud(clone)}>
          <CloudDownload />
          Find and link the existing cloud voice
        </Button>
      )}
      <details className="border-hairline mt-3 border-t pt-3 text-xs">
        <summary className="focus-visible:outline-ring cursor-pointer rounded font-medium focus-visible:outline-2">
          {clone.phase === "failed" ? "Recovery, details & rename" : "Details & rename"}
        </summary>
        <Field className="mt-3">
          <FieldLabel variant="form" htmlFor={`${clone.id}-name`}>
            Library name
          </FieldLabel>
          <Input
            id={`${clone.id}-name`}
            defaultValue={cloneTitle(clone)}
            maxLength={200}
            disabled={busy}
            onBlur={(event) => {
              const name = event.currentTarget.value.trim();
              if (name && name !== cloneTitle(clone)) onAction(clone, "update", { name });
              else if (!name) event.currentTarget.value = cloneTitle(clone);
            }}
          />
        </Field>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 leading-relaxed">
          <dt className="text-muted-foreground">Original clone name</dt>
          <dd>{clone.settings.name}</dd>
          <dt className="text-muted-foreground">Created</dt>
          <dd>{new Date(clone.createdAt).toLocaleString()}</dd>
          <dt className="text-muted-foreground">Source</dt>
          <dd className="break-words">
            {clone.sourceName ?? "Imported from GenVoice; original sample not recorded"}
            {clone.durationSeconds ? ` · ${clone.durationSeconds.toFixed(1)}s` : ""}
          </dd>
          <dt className="text-muted-foreground">Noise reduction</dt>
          <dd>
            {clone.settings.noiseReduction === undefined
              ? "Not recorded"
              : clone.settings.noiseReduction
                ? "On"
                : "Off"}
          </dd>
          <dt className="text-muted-foreground">Preview text</dt>
          <dd className="break-words">{clone.settings.previewText ?? "Not recorded"}</dd>
          <dt className="text-muted-foreground">Actual fee</dt>
          <dd>
            {typeof clone.creditsDeducted === "number"
              ? `${clone.creditsDeducted} credits`
              : "Not reported by GenVoice"}
          </dd>
          <dt className="text-muted-foreground">Permission to clone</dt>
          <dd>Confirmed by you · {new Date(clone.permission.confirmedAt).toLocaleString()}</dd>
          <dt className="text-muted-foreground">Commercial rights</dt>
          <dd>Unverified</dd>
          <dt className="text-muted-foreground">Cloud ID</dt>
          <dd className="font-mono break-all">
            {clone.remoteId ?? "Not captured; check cloud voices"}
          </dd>
        </dl>
        {clone.sourceFile && (
          <a
            className="text-primary-text focus-visible:outline-ring mt-3 inline-block rounded underline focus-visible:outline-2"
            href={`/api/voice/playground/clones/${encodeURIComponent(clone.id)}/source?scope=${clone.scope}`}
            download
          >
            Download original sample
          </a>
        )}
        {clone.remoteId && (
          <div className="mt-3 flex flex-wrap gap-2">
            {["failed", "ready"].includes(clone.phase) && (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => setConfirm("retry")}
              >
                Recreate cloud clone · paid
              </Button>
            )}
            <Button variant="remove" size="sm" disabled={busy} onClick={() => setConfirm("delete")}>
              <Trash2 />
              Delete cloud voice
            </Button>
          </div>
        )}
        {confirm && (
          <div
            className="border-warn/40 bg-warn/10 mt-3 rounded-lg border p-3"
            role="group"
            aria-label="Confirm cloud voice action"
          >
            <p>
              {confirm === "retry"
                ? "GenVoice will charge again using the original sample/settings. This cloud ID is shared by every saved copy. Existing recordings are kept."
                : "Delete this voice from the GenVoice account for every project. Source files and existing recordings are kept; future generation with this ID will stop working."}
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                variant={confirm === "delete" ? "remove" : "default"}
                size="sm"
                disabled={busy}
                onClick={() => {
                  onAction(clone, confirm);
                  setConfirm(null);
                }}
              >
                {confirm === "delete" ? "Delete from GenVoice" : "Recreate · fee unknown"}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </details>
    </article>
  );
}

function CloneLibraryGroup({
  copies,
  ...props
}: Omit<ComponentProps<typeof CloneCard>, "clone"> & {
  copies: PlaygroundClone[];
}) {
  const [scope, setScope] = useState(copies[0]!.scope),
    id = useId();
  const clone = copies.find((copy) => copy.scope === scope) ?? copies[0]!;
  return (
    <div className="flex flex-col gap-2">
      {copies.length > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <p className="text-muted-foreground text-sm">
            Saved in Project + Global · one cloud voice
          </p>
          <Select
            items={LIBRARIES}
            value={clone.scope}
            onValueChange={(value) => {
              if (value === "project" || value === "global") setScope(value);
            }}
          >
            <SelectTrigger
              size="readable"
              id={id}
              aria-label={`Manage library copy of ${cloneTitle(clone)}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent finalFocus>
              {LIBRARIES.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <CloneCard key={`${clone.scope}:${clone.id}`} clone={clone} {...props} />
    </div>
  );
}

export function VoiceCloneLibraryButton({
  embedded = false,
  favoritesOnly: forceFavorites = false,
  initialTab = "saved",
}: { embedded?: boolean; favoritesOnly?: boolean; initialTab?: "saved" | "cloud" } = {}) {
  const id = useId(),
    fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(embedded),
    [search, setSearch] = useState(""),
    [favoritesOnly, setFavoritesOnly] = useState(false),
    [file, setFile] = useState<File | null>(null),
    [name, setName] = useState(""),
    [language, setLanguage] = useState("English"),
    [gender, setGender] = useState("Male"),
    [noiseReduction, setNoiseReduction] = useState(true),
    [previewText, setPreviewText] = useState("Hello, this is my voice."),
    [permission, setPermission] = useState(false),
    [destination, setDestination] = useState<"project" | "global">("project");
  const configured = useVoicePlaygroundSelector((state) => state.status.configured, false);
  const [operation, setOperation] = useState<Operation>(
      initialTab === "cloud" && configured ? { status: "acting", id: "cloud" } : { status: "idle" },
    ),
    [error, setError] = useState(""),
    [createError, setCreateError] = useState(""),
    [now, setNow] = useState(Date.now),
    [tab, setTab] = useState<"saved" | "cloud">(initialTab),
    [cloud, setCloud] = useState<CloudClone[]>([]),
    [linkTarget, setLinkTarget] = useState<PlaygroundClone | null>(null),
    [cloudPermission, setCloudPermission] = useState(false),
    [filter, setFilter] = useState<"all" | "project" | "global">("all");
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setFile(null);
      setCreateError("");
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const clones = useVoicePlaygroundSelector((state) => state.clones ?? EMPTY_CLONES, false);
  const takes = useVoiceTakes(),
    usage = useVoicePlaygroundSelector((state) => state.usage, false);
  const inUse = activeFilmVoices(takes, usage ?? []);
  const loading = useVoicePlaygroundSelector((state) => state.clonesLoading, false);
  const loadError = useVoicePlaygroundSelector(
    (state) => state.clonesError || state.clonesCloudError,
    false,
  );
  const creating = operation.status === "creating";
  const failedCount = new Set(
    clones.filter((clone) => clone.phase === "failed").map((clone) => clone.remoteId ?? clone.id),
  ).size;
  const observing = clones.some(
    (clone) =>
      ["submitting", "processing"].includes(clone.phase) ||
      (clone.phase === "uncertain" && Boolean(clone.remoteId)) ||
      (clone.phase === "ready" &&
        !clone.previewError &&
        (!clone.lastCheckedAt || clone.previewStale)),
  );
  useEffect(() => {
    if (!open) return;
    void loadPlaygroundClones({ observe: true });
    if (!observing && !creating) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open, observing, creating, configured]);
  const run = async (
    clone: PlaygroundClone,
    action: CloneAction,
    input?: Record<string, unknown>,
  ) => {
    setOperation({ status: "acting", id: clone.id });
    setError("");
    try {
      await cloneAction(action, clone.id, clone.scope, input);
      say(
        action === "copy"
          ? `Voice saved to ${input?.scope === "global" ? "Global" : "this project"}`
          : action === "delete"
            ? "Cloud voice deleted; recordings kept"
            : "Voice library updated",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update voice");
    } finally {
      setOperation({ status: "idle" });
    }
  };
  const useVoice = (clone: PlaygroundClone, template = false) => {
    const voice = cloneVoiceOption(clone);
    if (!voice) return;
    if (!template && getPlaygroundSnapshot().castingTarget) {
      chooseCastingVoice(voice);
      return;
    }
    setComposerDraft({ mode: "tts", languageCode: clone.settings.language });
    selectComposerVoice(voice);
    if (template) setComposerDraft({ title: `${cloneTitle(clone)} template` });
    setPlaygroundSubTab("create");
    if (!embedded) changeOpen(false);
    say(
      template
        ? "Voice loaded. Edit its settings, then Save template."
        : `Using ${cloneTitle(clone)}`,
    );
  };
  const loadCloud = async (target: PlaygroundClone | null = null) => {
    setTab("cloud");
    setLinkTarget(target);
    setOperation({ status: "acting", id: "cloud" });
    setError("");
    try {
      const data = await cloneAction("cloud", undefined, target?.scope ?? destination);
      setCloud(data.voices ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load cloud voices");
    } finally {
      setOperation({ status: "idle" });
    }
  };
  useEffect(() => {
    if (initialTab !== "cloud" || !configured) return;
    let active = true;
    void cloneAction("cloud", undefined, "project")
      .then((data) => {
        if (active) setCloud(data.voices ?? []);
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "Unable to load cloud voices");
      })
      .finally(() => {
        if (active) setOperation({ status: "idle" });
      });
    return () => {
      active = false;
    };
  }, [initialTab, configured]);
  const visible = clones.filter(
    (clone) =>
      (filter === "all" || clone.scope === filter) &&
      (!(forceFavorites || favoritesOnly) || clone.favorite) &&
      `${cloneTitle(clone)} ${clone.settings.language} ${clone.settings.gender}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  const grouped = new Map<string, PlaygroundClone[]>();
  for (const clone of visible) {
    const key = clone.remoteId || `${clone.scope}:${clone.id}`;
    grouped.set(key, [...(grouped.get(key) ?? []), clone]);
  }
  const content = (
    <>
      {!embedded && (
        <div className="border-primary/25 bg-primary/[0.05] border-b p-5">
          <DialogHeader>
            <DialogTitle>My cloned voices</DialogTitle>
            <DialogDescription>
              Make a MiniMax voice from a sample. Save it for this project or every film.
            </DialogDescription>
          </DialogHeader>
        </div>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(20rem,24rem)_minmax(0,1fr)]">
        <form
          className="border-hairline flex min-h-0 min-w-0 flex-col overflow-y-auto overscroll-contain border-e"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!file || !name.trim() || !permission) return;
            setOperation({
              status: "creating",
              startedAt: performance.timeOrigin + event.timeStamp,
            });
            setError("");
            setCreateError("");
            try {
              const created = await createPlaygroundClone(
                file,
                {
                  name: name.trim(),
                  language,
                  gender,
                  noiseReduction,
                  previewText,
                  permissionConfirmed: true,
                },
                destination,
              );
              setName("");
              setFile(null);
              if (fileInput.current) fileInput.current.value = "";
              if (["failed", "uncertain"].includes(created.phase)) {
                setError(
                  created.error ||
                    "The response was not confirmed. Check the saved submission and cloud voices before creating another clone.",
                );
                say("Sample saved. Check the existing submission before creating again.");
              } else
                say(
                  created.phase === "ready"
                    ? "Your voice is ready."
                    : "Sample saved. GenVoice is creating your voice.",
                );
            } catch (cause) {
              setCreateError(
                cause instanceof Error
                  ? cause.message
                  : "Clone request failed; inspect saved voices before trying again",
              );
              await loadPlaygroundClones();
            } finally {
              setOperation({ status: "idle" });
            }
          }}
        >
          <div className="flex flex-none flex-col gap-4 p-5">
            <div>
              <p className="text-primary-text text-xs font-semibold tracking-wide uppercase">
                Create a voice
              </p>
              <h3 className="text-foreground mt-1 text-lg leading-tight font-semibold">
                Start with a clean sample
              </h3>
              <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                One person speaking naturally. 10 seconds to 5 minutes, up to 80 MB. Your original
                file stays saved here.
              </p>
            </div>
            <Field>
              <FieldLabel variant="form" htmlFor={`${id}-file`}>
                Voice sample
              </FieldLabel>
              <Input
                ref={fileInput}
                id={`${id}-file`}
                type="file"
                accept="audio/*,video/*"
                disabled={creating}
                aria-describedby={createError ? `${id}-sample-error` : undefined}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setCreateError("");
                }}
              />
              {createError && (
                <p id={`${id}-sample-error`} role="alert" className="text-destructive text-xs">
                  {createError}
                </p>
              )}
            </Field>
            <Field>
              <FieldLabel variant="form" htmlFor={`${id}-name`}>
                Voice name
              </FieldLabel>
              <Input
                id={`${id}-name`}
                value={name}
                maxLength={200}
                disabled={creating}
                placeholder="My narrator"
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel variant="form" htmlFor={`${id}-language`}>
                Sample language
              </FieldLabel>
              <Select
                items={LANGUAGES}
                value={language}
                onValueChange={(value) => {
                  if (!value) return;
                  setLanguage(value);
                  if (Object.values(PREVIEW_SCRIPTS).includes(previewText))
                    setPreviewText(PREVIEW_SCRIPTS[value as keyof typeof PREVIEW_SCRIPTS]);
                }}
                disabled={creating}
              >
                <SelectTrigger size="readable" id={`${id}-language`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent finalFocus>
                  {LANGUAGES.map((value) => (
                    <SelectItem key={value.value} value={value.value}>
                      {value.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <details className="border-hairline rounded-lg border p-3">
              <summary className="focus-visible:outline-ring cursor-pointer rounded text-xs font-medium focus-visible:outline-2">
                Preview script & sample settings
              </summary>
              <div className="mt-3 flex flex-col gap-4">
                <Field>
                  <FieldLabel variant="form" htmlFor={`${id}-gender`}>
                    Gender label
                  </FieldLabel>
                  <Input
                    id={`${id}-gender`}
                    list={`${id}-genders`}
                    value={gender}
                    maxLength={40}
                    disabled={creating}
                    onChange={(event) => setGender(event.target.value)}
                  />
                  <datalist id={`${id}-genders`} aria-label="Gender suggestions">
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </datalist>
                </Field>
                <Field>
                  <FieldLabel variant="form" htmlFor={`${id}-preview`}>
                    Preview script
                  </FieldLabel>
                  <Textarea
                    id={`${id}-preview`}
                    value={previewText}
                    maxLength={200}
                    disabled={creating}
                    onChange={(event) => setPreviewText(event.target.value)}
                  />
                </Field>
                <Field orientation="horizontal">
                  <Switch
                    id={`${id}-noise`}
                    checked={noiseReduction}
                    disabled={creating}
                    onCheckedChange={setNoiseReduction}
                  />
                  <FieldLabel variant="form" htmlFor={`${id}-noise`}>
                    Reduce background noise
                  </FieldLabel>
                </Field>
              </div>
            </details>
          </div>
          <div className="border-hairline bg-background flex shrink-0 flex-col gap-3 border-t p-4">
            <Field>
              <FieldLabel variant="form" htmlFor={`${id}-scope`}>
                Save voice to
              </FieldLabel>
              <Select
                items={LIBRARIES}
                value={destination}
                onValueChange={(value) =>
                  (value === "project" || value === "global") && setDestination(value)
                }
                disabled={creating}
              >
                <SelectTrigger size="readable" id={`${id}-scope`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent finalFocus>
                  {LIBRARIES.map((value) => (
                    <SelectItem key={value.value} value={value.value}>
                      {value.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id={`${id}-permission`}
                checked={permission}
                disabled={creating}
                onCheckedChange={(value) => setPermission(value === true)}
              />
              <FieldLabel variant="form" htmlFor={`${id}-permission`}>
                I own this voice or have permission to clone it
              </FieldLabel>
            </Field>
            <div className="border-warn/30 bg-warn/10 rounded-lg border p-3 text-xs leading-relaxed">
              <p className="text-warn-text font-semibold">Clone fee unknown</p>
              <p className="text-reading-foreground mt-1">
                GenVoice may charge credits. Permission to clone does not confirm commercial usage
                rights.
              </p>
            </div>
            <Button
              type="submit"
              disabled={
                operation.status !== "idle" ||
                !configured ||
                !file ||
                !name.trim() ||
                !gender.trim() ||
                !permission
              }
            >
              {creating ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Mic />}
              {creating
                ? `Sending sample · ${Math.max(0, Math.floor((now - operation.startedAt) / 1000))}s`
                : "Create voice · fee unknown"}
            </Button>
          </div>
        </form>
        <section
          aria-label="Saved cloned voices"
          className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto overscroll-contain p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-[1_1_9rem] wrap-anywhere">
              <h3 className="text-foreground text-lg leading-tight font-semibold">
                Your voice library
              </h3>
              <p className="text-muted-foreground mt-1 text-xs">
                This project and Global. Voices belonging only to other projects stay hidden.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="h-auto min-h-6 max-w-full wrap-anywhere whitespace-normal"
              disabled={operation.status !== "idle" || !configured}
              onClick={() => void loadCloud()}
            >
              <CloudDownload />
              Cloud voices
            </Button>
          </div>
          {(error || loadError) && (
            <p
              role="alert"
              className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm"
            >
              {error || loadError}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {[
              { value: "all", label: "Project + Global" },
              { value: "project", label: "This project" },
              { value: "global", label: "Global" },
            ].map((value) => (
              <Button
                key={value.value}
                variant={tab === "saved" && filter === value.value ? "lit" : "ghost"}
                aria-pressed={tab === "saved" && filter === value.value}
                size="sm"
                className="h-auto min-h-6 max-w-full text-start wrap-anywhere whitespace-normal"
                onClick={() => {
                  setTab("saved");
                  setFilter(value.value as typeof filter);
                }}
              >
                {value.label}
              </Button>
            ))}
          </div>
          {tab !== "cloud" && (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="min-w-0 flex-[1_1_9rem]"
                type="search"
                aria-label="Search my cloned voices"
                placeholder="Search name, language or gender…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <Button
                variant={forceFavorites || favoritesOnly ? "lit" : "secondary"}
                size="sm"
                className="h-auto min-h-6 max-w-full wrap-anywhere whitespace-normal"
                aria-pressed={favoritesOnly}
                onClick={() => setFavoritesOnly(!favoritesOnly)}
              >
                <Star className={favoritesOnly ? "fill-current" : ""} />
                Favorites
              </Button>
            </div>
          )}
          {tab === "cloud" ? (
            <div className="flex flex-col gap-3">
              <div className="border-hairline bg-surface-subtle rounded-lg border p-3">
                <h4 className="text-foreground text-sm font-semibold">
                  {linkTarget
                    ? `Link the existing voice to ${linkTarget.settings.name}`
                    : "Voices already in your GenVoice account"}
                </h4>
                <p className="text-muted-foreground mt-2 max-w-[59ch] text-xs leading-relaxed text-pretty">
                  Saving or linking an existing voice is free. It does not create another clone.
                  Cloud retention is controlled by GenVoice; no permanent voice-ID lifetime is
                  promised.
                </p>
                <Field orientation="horizontal" className="mt-3">
                  <Checkbox
                    id={`${id}-cloud-permission`}
                    checked={cloudPermission}
                    onCheckedChange={(value) => setCloudPermission(value === true)}
                  />
                  <FieldLabel variant="form" htmlFor={`${id}-cloud-permission`}>
                    I have permission to use this voice
                  </FieldLabel>
                </Field>
              </div>
              {cloud.map((voice) => (
                <article key={voice.id} className="border-hairline rounded-lg border p-3">
                  <h4 className="text-foreground text-sm font-semibold">{voice.voice_name}</h4>
                  <p className="text-muted-foreground mt-1 text-xs">
                    MiniMax · {voice.language_tag || "Language not recorded"} ·{" "}
                    {voice.gender || "Gender not recorded"} · {voice.status === "done" ? "Ready" : voice.status}
                  </p>
                  <p className="text-muted-foreground mt-1 font-mono text-xs break-all">
                    {voice.id}
                  </p>
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="secondary"
                    disabled={!cloudPermission || operation.status !== "idle"}
                    onClick={async () => {
                      setOperation({ status: "acting", id: voice.id });
                      setError("");
                      try {
                        await cloneAction(
                          linkTarget ? "link" : "adopt",
                          linkTarget?.id,
                          linkTarget?.scope ?? destination,
                          { remoteId: voice.id, permissionConfirmed: true },
                        );
                        setTab("saved");
                        setLinkTarget(null);
                        say("Existing cloud voice saved; no new clone was created.");
                      } catch (cause) {
                        setError(
                          cause instanceof Error ? cause.message : "Unable to save cloud voice",
                        );
                      } finally {
                        setOperation({ status: "idle" });
                      }
                    }}
                  >
                    {linkTarget
                      ? "Link existing voice"
                      : `Save to ${destination === "global" ? "Global" : "this project"}`}
                  </Button>
                </article>
              ))}
              {!cloud.length && (
                <p className="text-muted-foreground text-sm">
                  {operation.status !== "idle"
                    ? "Loading cloud voices…"
                    : "No unassigned, current-project or Global cloud voices were found."}
                </p>
              )}
            </div>
          ) : loading && !clones.length ? (
            <p role="status" className="text-muted-foreground text-sm">
              Loading saved voices…
            </p>
          ) : visible.length ? (
            [...grouped.entries()].map(([key, copies]) => (
              <CloneLibraryGroup
                key={key}
                copies={copies}
                otherScopeSaved={Boolean(
                  copies[0]?.remoteId &&
                  clones.some(
                    (clone) =>
                      clone.remoteId === copies[0]?.remoteId && clone.scope !== copies[0]?.scope,
                  ),
                )}
                now={now}
                inUse={inUse.some(
                  (voice) => voice.provider === "minimax" && voice.voiceId === copies[0]!.remoteId,
                )}
                busy={operation.status !== "idle"}
                onAction={(...args) => void run(...args)}
                onUse={useVoice}
                onCloud={(target) => void loadCloud(target)}
              />
            ))
          ) : (
            <div className="border-primary/25 bg-primary/[0.04] rounded-xl border p-6">
              <Mic className="text-primary-text size-7" />
              <h4 className="text-foreground mt-3 text-base font-semibold">
                {clones.length ? "No matching voices" : "Keep a voice worth reusing"}
              </h4>
              <p className="text-muted-foreground mt-2 max-w-[59ch] text-sm leading-relaxed text-pretty">
                {clones.length
                  ? "Try another search, turn off Favorites, or switch the library filter."
                  : "Create one from a sample, or save an existing cloud voice. Add a project voice to Global when you want it available in future films."}
              </p>
            </div>
          )}
          <p className="text-muted-foreground max-w-[59ch] text-xs leading-relaxed text-pretty">
            Source audio, clone settings and permissions are saved on disk. A copied Global voice
            uses the same cloud ID; deleting or recreating it affects future generation from every
            copy. Existing recordings are kept.
          </p>
        </section>
      </div>
    </>
  );
  if (embedded) return <div className="flex h-full min-h-0 flex-col">{content}</div>;
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {observing ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Mic />}My
        voices{observing ? " · updating" : ""}
        {failedCount > 0 && <span className="text-destructive"> · {failedCount} failed</span>}
      </Button>
      <DialogContent
        variant="workbench"
        className="flex h-[min(52rem,90dvh)] w-full flex-col overflow-hidden sm:max-w-[min(68rem,94vw)]"
      >
        {content}
      </DialogContent>
    </Dialog>
  );
}
