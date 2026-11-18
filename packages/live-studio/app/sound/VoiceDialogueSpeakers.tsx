import { Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
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

import { providerLanguageOptions } from "../../src/voice-playground-providers.mjs";
import { Tip } from "../components/Tip";
import {
  browseCastingVoices,
  loadMoreSharedVoices,
  searchLiveSharedVoices,
  setComposerDraft,
  type VoicePlaygroundClientState,
} from "./voice-playground-client";
import {
  type ComposerDialogueSpeaker,
  type ComposerDraft,
  snapToDiscreteValue,
  withDialogueVoice,
} from "./voice-playground-view";
import { VoicePlaygroundVoicePicker } from "./VoicePlaygroundVoicePicker";
import { SliderSettingRow } from "./VoiceSettingSlider";

export function DialogueSpeakersPanel({
  draft,
  pg,
  onFocusScript,
}: {
  draft: ComposerDraft;
  pg: VoicePlaygroundClientState;
  onFocusScript: () => void;
}) {
  const uid = useId();
  const connection = draft.connection ?? "genvoice";
  const direct = connection !== "genvoice";
  const google = connection === "google";
  const catalog = direct ? pg.serviceCatalogs?.[connection] : pg.catalog;
  const configured = direct
    ? pg.status.connections?.[connection]?.configured
    : pg.status.configured;
  const [expandedIds, setExpandedIds] = useState(() => new Set<string>());
  const nameBeforeEdit = useRef("");
  const ttsModels = pg.catalog.models.filter((m) => m.can_do_text_to_speech);

  const setSpeakerExpanded = (key: string, expanded: boolean) =>
    setExpandedIds((old) => {
      const next = new Set(old);
      if (expanded) next.add(key);
      else next.delete(key);
      return next;
    });
  const updateSpeaker = (idx: number, patch: Partial<ComposerDialogueSpeaker>) => {
    const next = draft.speakers.map((sp, i) => (i === idx ? { ...sp, ...patch } : sp));
    setComposerDraft({ speakers: next });
  };

  const addSpeaker = () => {
    const idx = draft.speakers.length + 1;
    setComposerDraft({
      speakers: [
        ...draft.speakers,
        {
          id: `sp_${Date.now().toString(36)}_${idx}`,
          name: `Speaker ${idx}`,
          provider: draft.provider,
          pitch: draft.pitch,
          vol: draft.vol,
          voiceId: draft.voiceId,
          voiceName: draft.voiceName,
          modelId: draft.modelId.includes("_sts_") ? "eleven_v4" : draft.modelId,
          languageCode: "",
          stability: draft.stability,
          similarityBoost: draft.similarityBoost,
          style: draft.style,
          useSpeakerBoost: draft.useSpeakerBoost,
          speed: draft.speed,
        },
      ],
    });
  };

  const nameCounts = new Map<string, number>();
  for (const sp of draft.speakers) {
    const k = sp.name.trim();
    if (k) nameCounts.set(k, (nameCounts.get(k) ?? 0) + 1);
  }

  return (
    <div className="border-hairline bg-surface-subtle flex flex-col gap-2 rounded-lg border p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-ai-text text-sm font-semibold">
          Speakers ({draft.speakers.length}) — write <code className="font-mono">Name: line</code>
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={addSpeaker}
          disabled={google && draft.speakers.length >= 2}
        >
          <Plus className="size-3" />
          <span>Add Speaker</span>
        </Button>
      </div>
      {google && (
        <p className="text-muted-foreground text-xs">Gemini uses two prebuilt voices per scene.</p>
      )}
      <div className="flex flex-col gap-1.5">
        {draft.speakers.map((sp, idx) => {
          const spKey = sp.id || `sp-${idx}`;
          const isOpen = expandedIds.has(spKey);
          const panelId = `${uid}-speaker-${idx}`;
          const provider = sp.provider ?? "elevenlabs";
          const native = provider !== "elevenlabs";
          const speakerModels = ttsModels.filter(
            (model) => (model.provider ?? "elevenlabs") === provider,
          );
          const modelItems = speakerModels.map((model) => ({
            value: model.model_id,
            label: model.name,
          }));
          const spModel = speakerModels.find((m) => m.model_id === sp.modelId) ?? speakerModels[0];
          const langItems = [
            { value: "__auto__", label: "Auto Detect" },
            ...providerLanguageOptions(provider, pg.catalog, spModel).map((language) => ({
              value: language.code,
              label: language.name,
            })),
          ];
          const switchUid = `${spKey}-boost`;
          const trimmedName = sp.name.trim();
          const isDuplicateName = Boolean(trimmedName) && (nameCounts.get(trimmedName) ?? 0) > 1;
          return (
            <div
              key={spKey}
              className="border-hairline bg-card flex flex-col gap-1.5 rounded-md border p-1.5"
            >
              <Collapsible
                open={isOpen}
                onKeyDown={(event) => {
                  if (
                    !isOpen ||
                    event.key !== "Escape" ||
                    event.defaultPrevented ||
                    event.nativeEvent.isComposing ||
                    !event.currentTarget.contains(event.target as Node)
                  ) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  setSpeakerExpanded(spKey, false);
                  document.getElementById(`${panelId}-tune`)?.focus({ preventScroll: true });
                }}
              >
                <div className="flex items-center gap-1">
                  <Input
                    size="sm"
                    value={sp.name}
                    onChange={(e) => updateSpeaker(idx, { name: e.target.value })}
                    onFocus={() => {
                      nameBeforeEdit.current = sp.name.trim();
                    }}
                    onBlur={(event) => {
                      const previous = nameBeforeEdit.current;
                      const next = event.currentTarget.value.trim();
                      if (
                        !next ||
                        /[:[\]]/.test(next) ||
                        draft.speakers.some(
                          (candidate) => candidate.id !== sp.id && candidate.name.trim() === next,
                        )
                      ) {
                        updateSpeaker(idx, { name: previous || sp.name });
                        return;
                      }
                      if (previous && next && previous !== next) {
                        setComposerDraft((current) => ({
                          ...current,
                          text: current.text.replace(
                            /^([ \t]*)(\[[^\]\r\n:]+\]|[^:\r\n]+?)([ \t]*:)/gm,
                            (line, spacing, label, colon) => {
                              const bracketed = label.startsWith("[") && label.endsWith("]");
                              const name = bracketed ? label.slice(1, -1).trim() : label.trim();
                              return name === previous
                                ? `${spacing}${bracketed ? `[${next}]` : next}${colon}`
                                : line;
                            },
                          ),
                        }));
                      }
                    }}
                    placeholder="Speaker"
                    aria-label={`Speaker ${idx + 1} name`}
                    aria-invalid={isDuplicateName || !trimmedName || undefined}
                    className="min-w-0 flex-1"
                  />
                  {!direct && (
                    <Badge variant="secondary">
                      {provider === "minimax"
                        ? "MiniMax"
                        : provider === "capcut"
                          ? "CapCut"
                          : "ElevenLabs"}
                    </Badge>
                  )}
                  <div className="ms-auto flex flex-none items-center gap-1">
                    <Tip label={`Add a turn for ${trimmedName || "this speaker"}`}>
                      <Button
                        type="button"
                        aria-label={`Add a turn for ${trimmedName || "Speaker " + (idx + 1)}`}
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          const line = `${draft.text && !draft.text.endsWith("\n") ? "\n" : ""}${trimmedName || "Speaker"}: `;
                          setComposerDraft({ text: `${draft.text}${line}` });
                          onFocusScript();
                        }}
                      >
                        + Turn
                      </Button>
                    </Tip>
                    {(google || !direct) && (
                      <Tip
                        label={
                          google
                            ? "Edit speech direction for this speaker"
                            : "Configure per-speaker model, language & voice settings"
                        }
                      >
                        <Button
                          type="button"
                          variant={isOpen ? "lit" : "ghost"}
                          size="icon-xs"
                          aria-label={`Tune speaker ${trimmedName || idx + 1}`}
                          id={`${panelId}-tune`}
                          aria-expanded={isOpen}
                          aria-controls={panelId}
                          onClick={() => setSpeakerExpanded(spKey, !isOpen)}
                        >
                          <SlidersHorizontal className="size-3" />
                        </Button>
                      </Tip>
                    )}
                    {draft.speakers.length > 2 && (
                      <Button
                        type="button"
                        variant="remove"
                        size="icon-xs"
                        aria-label={`Remove speaker ${trimmedName || idx + 1}`}
                        onClick={() =>
                          setComposerDraft({
                            speakers: draft.speakers.filter((_, i) => i !== idx),
                          })
                        }
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="mt-1.5 flex min-w-0">
                  <VoicePlaygroundVoicePicker
                    key={connection}
                    connection={connection}
                    prebuiltOnly={google}
                    onBrowseAll={
                      google
                        ? undefined
                        : () => browseCastingVoices({ mode: "dialogue", speakerId: spKey })
                    }
                    selectedId={sp.voiceId}
                    selectedName={sp.voiceName}
                    defaultVoices={catalog?.defaultVoices ?? []}
                    sharedSearch={pg.sharedSearch}
                    configured={Boolean(configured)}
                    onSearchShared={searchLiveSharedVoices}
                    onLoadMoreShared={() => void loadMoreSharedVoices()}
                    selectedProvider={provider}
                    onSelect={(v) =>
                      updateSpeaker(
                        idx,
                        direct
                          ? { voiceId: v.id, voiceName: v.name }
                          : withDialogueVoice(sp, v, pg.catalog),
                      )
                    }
                    fullWidth
                  />
                </div>

                {google && (
                  <CollapsibleContent id={panelId} className="mt-1.5">
                    <Field>
                      <FieldLabel htmlFor={`${panelId}-direction`}>
                        Speech direction for {trimmedName || `speaker ${idx + 1}`}
                      </FieldLabel>
                      <Textarea
                        id={`${panelId}-direction`}
                        rows={2}
                        maxLength={2000}
                        value={sp.speechStyle ?? ""}
                        placeholder="Speak softly and keep an even pace"
                        onChange={(event) =>
                          updateSpeaker(idx, { speechStyle: event.target.value })
                        }
                      />
                    </Field>
                  </CollapsibleContent>
                )}
                {!direct && (
                  <CollapsibleContent id={panelId} className="mt-1.5">
                    <div className="border-hairline flex flex-col gap-2 border-t pt-1.5 pb-2">
                      <div className="grid grid-cols-2 gap-1.5">
                        <Select
                          items={modelItems}
                          value={sp.modelId}
                          onValueChange={(v) => {
                            if (!v) return;
                            const nextModel = ttsModels.find((m) => m.model_id === v);
                            const nextStab = nextModel?.stability_values?.length
                              ? snapToDiscreteValue(sp.stability, nextModel.stability_values)
                              : sp.stability;
                            updateSpeaker(idx, { modelId: v, stability: nextStab });
                          }}
                        >
                          <SelectTrigger className="h-7 w-full" aria-label="Speaker model">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent finalFocus>
                            {speakerModels.map((m) => (
                              <SelectItem key={m.model_id} value={m.model_id}>
                                {m.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          items={langItems}
                          value={sp.languageCode || "__auto__"}
                          onValueChange={(v) =>
                            updateSpeaker(idx, { languageCode: !v || v === "__auto__" ? "" : v })
                          }
                        >
                          <SelectTrigger className="h-7 w-full" aria-label="Speaker language">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent finalFocus>
                            {langItems.map((l) => (
                              <SelectItem key={l.value} value={l.value}>
                                {l.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {!native &&
                          (spModel?.stability_values?.length ? (
                            <div className="col-span-2 flex flex-col gap-1">
                              <span className="text-foreground/85 text-xs font-medium">
                                Stability Preset (v3 discrete)
                              </span>
                              <div className="bg-raised-2 grid grid-cols-3 gap-0.5 rounded-md p-0.5">
                                {[
                                  { value: 0, label: "Creative (0.0)" },
                                  { value: 0.5, label: "Natural (0.5)" },
                                  { value: 1, label: "Robust (1.0)" },
                                ].map((p) => {
                                  const active = Math.abs(sp.stability - p.value) < 0.05;
                                  return (
                                    <button
                                      key={p.value}
                                      type="button"
                                      aria-pressed={active}
                                      onClick={() => updateSpeaker(idx, { stability: p.value })}
                                      className={cn(
                                        "focus-visible:ring-ring rounded px-1.5 py-1 text-sm font-medium transition-colors outline-none focus-visible:ring-2",
                                        active
                                          ? "bg-card text-primary-text shadow-xs"
                                          : "text-muted-foreground hover:text-foreground",
                                      )}
                                    >
                                      {p.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ) : (
                            <SliderSettingRow
                              label="Stability"
                              value={sp.stability}
                              min={0}
                              max={1}
                              step={0.05}
                              onChange={(next) => updateSpeaker(idx, { stability: next })}
                            />
                          ))}
                        {spModel?.supports_similarity !== false && (
                          <SliderSettingRow
                            label="Similarity"
                            value={sp.similarityBoost}
                            min={0}
                            max={1}
                            step={0.05}
                            onChange={(next) => updateSpeaker(idx, { similarityBoost: next })}
                          />
                        )}
                        {spModel?.supports_speed === true && (
                          <SliderSettingRow
                            label="Speed"
                            value={sp.speed}
                            min={native ? 0.5 : 0.7}
                            max={native ? 2 : 1.2}
                            step={0.05}
                            formatValue={(v) => `${v.toFixed(2)}×`}
                            onChange={(next) => updateSpeaker(idx, { speed: next })}
                          />
                        )}
                        {native && (
                          <SliderSettingRow
                            label="Pitch"
                            hint="Lower or higher voice; zero keeps the original pitch"
                            formatValue={(v) => `${v} semitones`}
                            value={sp.pitch ?? 0}
                            min={-12}
                            max={12}
                            step={1}
                            onChange={(pitch) => updateSpeaker(idx, { pitch })}
                          />
                        )}
                        {provider === "minimax" && (
                          <SliderSettingRow
                            label="Volume"
                            value={sp.vol ?? 1}
                            min={0.01}
                            max={10}
                            step={0.01}
                            formatValue={(v) => `${v.toFixed(2)}\u00d7`}
                            onChange={(vol) => updateSpeaker(idx, { vol })}
                          />
                        )}
                        {spModel?.can_use_style && (
                          <SliderSettingRow
                            label="Style"
                            value={sp.style}
                            min={0}
                            max={1}
                            step={0.05}
                            onChange={(next) => updateSpeaker(idx, { style: next })}
                          />
                        )}
                      </div>
                      {spModel?.can_use_speaker_boost && (
                        <div className="flex items-center justify-between text-sm">
                          <label htmlFor={switchUid} className="text-muted-foreground text-xs">
                            Speaker Boost
                          </label>
                          <Switch
                            id={switchUid}
                            size="sm"
                            checked={sp.useSpeakerBoost}
                            onCheckedChange={(v) => updateSpeaker(idx, { useSpeakerBoost: v })}
                          />
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                )}
              </Collapsible>
            </div>
          );
        })}
      </div>
      {!direct && (
        <SliderSettingRow
          label="Pause Between Turns"
          value={draft.pauseBetweenTurns}
          min={0}
          max={3}
          step={0.1}
          formatValue={(v) => `${v.toFixed(1)}s`}
          onChange={(next) => setComposerDraft({ pauseBetweenTurns: next })}
        />
      )}
    </div>
  );
}
