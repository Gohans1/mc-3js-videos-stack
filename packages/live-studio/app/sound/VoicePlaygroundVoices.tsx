import { ArrowLeft } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import type {
  PlaygroundConnection,
  PlaygroundVoiceOption,
  PlaygroundVoiceProfile,
} from "../../src/voice-playground.mjs";
import {
  cancelCasting,
  chooseCastingVoice,
  loadMoreSharedVoices,
  loadSpeechCatalog,
  searchLiveSharedVoices,
  switchPlaygroundTool,
  type VoicePlaygroundClientState,
} from "./voice-playground-client";
import { castingAuditionId } from "./voice-playground-view";
import { VoiceCloneLibraryButton } from "./VoiceCloneLibrary";
import { VoicePlaygroundProfilePanel } from "./VoicePlaygroundProfilePanel";
import { VoicePlaygroundShortlist } from "./VoicePlaygroundShortlist";
import { VoicePlaygroundVoicePicker } from "./VoicePlaygroundVoicePicker";

export type PlaygroundVoicesTab = "catalog" | "shortlist" | "clones";

export function VoicePlaygroundVoices({
  pg,
  tab: controlledTab,
  onTabChange,
  favoritesOnly = false,
  onShowAll,
  openCloudClones = false,
  comparisonDirectory = false,
}: {
  pg: VoicePlaygroundClientState;
  favoritesOnly?: boolean;
  onShowAll?: () => void;
  openCloudClones?: boolean;
  comparisonDirectory?: boolean;
  tab?: PlaygroundVoicesTab;
  onTabChange?: (tab: PlaygroundVoicesTab) => void;
}) {
  const [localTab, setLocalTab] = useState<PlaygroundVoicesTab>("catalog");
  const [directoryVoice, setDirectoryVoice] = useState<PlaygroundVoiceOption | null>(null);
  const [profile, setProfile] = useState<PlaygroundVoiceProfile | null>(null);
  const [profileRevision, setProfileRevision] = useState(0);
  const [service, setService] = useState<PlaygroundConnection | null>(
    comparisonDirectory ? "genvoice" : null,
  );
  const catalogTabRef = useRef<HTMLButtonElement>(null);
  const profileBackRef = useRef<HTMLButtonElement>(null);
  const profileOpener = useRef<HTMLElement | null>(null);
  const restoreListFocus = useRef(false);
  const [showProfile, setShowProfile] = useState(false);
  const target = pg.castingTarget;
  const directDialogue =
    target?.mode === "dialogue" &&
    Boolean(pg.draft.connection && pg.draft.connection !== "genvoice");
  const tab = directDialogue ? "catalog" : target ? localTab : (controlledTab ?? localTab);
  const connection =
    tab === "clones" || target?.mode === "voice_changer" || target?.mode === "dubbing"
      ? "genvoice"
      : target?.mode === "dialogue"
        ? (pg.draft.connection ?? "genvoice")
        : (service ?? pg.draft.connection ?? "genvoice");
  const direct = connection !== "genvoice";
  const catalog = direct ? pg.serviceCatalogs?.[connection]?.catalog : pg.catalog;
  const configured = direct
    ? pg.status.connections?.[connection]?.configured
    : pg.status.configured;
  useEffect(() => {
    if (connection !== "genvoice") void loadSpeechCatalog(connection);
  }, [connection]);
  const recipient =
    target?.mode === "dialogue"
      ? pg.draft.speakers.find((speaker) => speaker.id === target.speakerId)
      : target?.mode === "dubbing"
        ? {
            voiceId: pg.draft.dubbing?.ttsVoiceId || pg.draft.dubbing?.voiceId || pg.draft.voiceId,
            voiceName: pg.draft.dubbing?.voiceName || pg.draft.voiceName,
            provider: pg.draft.dubbing?.provider || pg.draft.provider,
          }
        : pg.draft;
  const targetLabel =
    target?.mode === "dialogue"
      ? pg.draft.speakers.find((speaker) => speaker.id === target.speakerId)?.name || "this speaker"
      : target?.mode === "dubbing"
        ? "Dubbing"
        : target?.mode === "voice_changer"
          ? "Voice Changer"
          : "Text to speech";
  const setTab = (value: string) => {
    if (value === "catalog" || value === "clones" || value === "shortlist") {
      setShowProfile(false);
      setLocalTab(value);
      onTabChange?.(value);
    }
  };
  const activeVoice = tab === "shortlist" ? profile?.voice : directoryVoice;
  const compactProfileOpen = showProfile && Boolean(activeVoice) && tab !== "clones";
  const openProfile = () => {
    const opener = document.activeElement;
    profileOpener.current = opener instanceof HTMLElement ? opener : null;
    setShowProfile(true);
  };
  useLayoutEffect(() => {
    if (compactProfileOpen && profileBackRef.current?.getClientRects().length) {
      profileBackRef.current.focus({ preventScroll: true });
    } else if (restoreListFocus.current) {
      restoreListFocus.current = false;
      (profileOpener.current?.isConnected ? profileOpener.current : catalogTabRef.current)?.focus({
        preventScroll: true,
      });
    }
  }, [compactProfileOpen]);
  const activeVoiceKey = activeVoice ? castingAuditionId(activeVoice) : "";
  const favorite = pg.favoriteVoices.some((voice) => castingAuditionId(voice) === activeVoiceKey);
  const inComparison = (pg.compareVoices ?? []).some(
    (voice) => castingAuditionId(voice) === activeVoiceKey,
  );
  const choose = (voice: PlaygroundVoiceOption) => {
    if (!target) switchPlaygroundTool("tts");
    chooseCastingVoice(voice);
  };
  return (
    <section
      aria-label="Casting directory"
      className="@container/casting flex h-full min-h-0 flex-col gap-4 p-5"
    >
      {favoritesOnly && (
        <div className="bg-primary/10 flex flex-none items-center justify-between gap-3 rounded-lg p-3 text-sm">
          <p>Favorite voice samples · Project + Global</p>
          <Button
            variant="secondary"
            onClick={() => {
              setTab("catalog");
              onShowAll?.();
              catalogTabRef.current?.focus();
            }}
          >
            Browse all voices
          </Button>
        </div>
      )}
      {target && (
        <div className="bg-primary/10 flex flex-none items-center justify-between gap-3 rounded-lg p-3 text-sm">
          <p>Choose a voice for {targetLabel}. Your recipe is kept.</p>
          <Button variant="secondary" onClick={cancelCasting}>
            Back to recipe
          </Button>
        </div>
      )}
      <div className="flex flex-none flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          variant="pick"
          aria-label="Voice directory source"
          value={[tab]}
          onValueChange={(values) => {
            if (values[0]) setTab(values[0]);
          }}
        >
          <ToggleGroupItem ref={catalogTabRef} value="catalog">
            {favoritesOnly ? "Favorite voices" : "Directory"}
          </ToggleGroupItem>
          {!directDialogue && <ToggleGroupItem value="shortlist">Shortlist</ToggleGroupItem>}
          {!directDialogue && <ToggleGroupItem value="clones">My voices</ToggleGroupItem>}
        </ToggleGroup>
        {tab === "catalog" && (!target || target.mode === "tts") && (
          <ToggleGroup
            variant="pick"
            aria-label="Voice catalog service"
            value={[connection]}
            onValueChange={(values) => {
              if (values[0] && values[0] !== connection) {
                setShowProfile(false);
                setDirectoryVoice(null);
                setService(values[0] as PlaygroundConnection);
              }
            }}
          >
            <ToggleGroupItem value="genvoice">GenVoice</ToggleGroupItem>
            <ToggleGroupItem value="elevenlabs">ElevenLabs direct</ToggleGroupItem>
            <ToggleGroupItem value="google">Google Gemini</ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>
      <div
        className={
          tab === "clones"
            ? "hidden"
            : "border-hairline grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden rounded-lg border @4xl/casting:grid-cols-[minmax(0,1fr)_23rem]"
        }
      >
        <div
          className={cn(
            "col-start-1 row-start-1 min-h-0 min-w-0 flex-col overflow-hidden p-3",
            tab !== "catalog" ? "hidden" : compactProfileOpen ? "hidden @4xl/casting:flex" : "flex",
          )}
        >
          <VoicePlaygroundVoicePicker
            key={connection}
            connection={connection}
            initialTab={comparisonDirectory && !target && !direct ? "live" : undefined}
            embedded
            favoritesOnly={favoritesOnly}
            selectedId={recipient?.voiceId || ""}
            selectedName={recipient?.voiceName || ""}
            selectedProvider={recipient?.provider}
            inspection={
              target
                ? undefined
                : {
                    voiceKey: directoryVoice ? castingAuditionId(directoryVoice) : "",
                    draftKey: pg.draft.voiceId
                      ? castingAuditionId({
                          id: pg.draft.voiceId,
                          provider: pg.draft.provider,
                          connection: pg.draft.connection,
                        })
                      : "",
                  }
            }
            allowedProviders={
              pg.castingTarget?.mode === "voice_changer" ? ["elevenlabs"] : undefined
            }
            defaultVoices={catalog?.defaultVoices ?? []}
            sharedSearch={pg.sharedSearch}
            configured={Boolean(configured)}
            onSearchShared={searchLiveSharedVoices}
            onLoadMoreShared={() => void loadMoreSharedVoices()}
            onSelect={(voice) => {
              if (target) chooseCastingVoice(voice);
              else {
                setDirectoryVoice({
                  ...voice,
                  category: (voice as PlaygroundVoiceOption).category || "custom",
                });
                openProfile();
              }
            }}
          />
        </div>
        {tab === "shortlist" && (
          <div
            className={cn(
              "col-start-1 row-start-1 min-h-0 min-w-0",
              compactProfileOpen && "hidden @4xl/casting:block",
            )}
          >
            <VoicePlaygroundShortlist
              selected={profile}
              revision={profileRevision}
              onSelect={(saved) => {
                setProfile(saved);
                openProfile();
              }}
            />
          </div>
        )}
        {activeVoice && tab !== "clones" ? (
          <div
            className={cn(
              "border-hairline col-start-1 row-start-1 min-h-0 min-w-0 flex-col @4xl/casting:col-start-2 @4xl/casting:border-s",
              compactProfileOpen ? "flex" : "hidden @4xl/casting:flex",
            )}
          >
            <div className="bg-card border-hairline shrink-0 border-b p-3 @4xl/casting:hidden">
              <Button
                ref={profileBackRef}
                variant="secondary"
                size="md"
                onClick={() => {
                  restoreListFocus.current = true;
                  setShowProfile(false);
                }}
              >
                <ArrowLeft className="rtl:rotate-180" /> Back to voices
              </Button>
            </div>
            <VoicePlaygroundProfilePanel
              key={tab === "shortlist" ? `${profile?.scope}:${profile?.id}` : activeVoiceKey}
              voice={activeVoice}
              profile={tab === "shortlist" ? (profile ?? undefined) : undefined}
              preferredScope={pg.scope}
              favorite={favorite}
              inComparison={inComparison}
              onChoose={choose}
              onChange={(saved) => {
                if (tab === "shortlist" && saved.scope === profile?.scope) setProfile(saved);
                setProfileRevision((revision) => revision + 1);
              }}
            />
          </div>
        ) : (
          <div className="text-muted-foreground col-start-2 row-start-1 hidden p-5 text-sm @4xl/casting:block">
            Select a voice to see its sample, rate and details.
          </div>
        )}
      </div>
      {!directDialogue && (
        <div className={tab === "clones" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <VoiceCloneLibraryButton
            key={openCloudClones ? "cloud" : "saved"}
            embedded
            favoritesOnly={favoritesOnly}
            initialTab={openCloudClones ? "cloud" : "saved"}
          />
        </div>
      )}
    </section>
  );
}
