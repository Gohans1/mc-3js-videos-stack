import { useEffect, useSyncExternalStore } from "react";

import { onDocMutated } from "../core/doc";
import { onEvent, onHello } from "../core/events";
import { DURATION } from "../core/filmMeta";
import { postJson } from "../core/net";
import { S } from "../core/state";
import { get, say, studio } from "../core/store";
import { r3, stamp } from "../core/time";
import { seek, setPlaying } from "../playback/transport";
import { getAudio, resumeAudio } from "./clock";
import { decoded } from "./mixer";
import type { ClipRef } from "./slice";
import {
  addClip,
  attachExternalAudition,
  clipOf,
  edit,
  ensureSoundLibrary,
  itemOf,
  kindOf,
  lanes,
  listen,
  listening,
  locked,
  preview,
  releaseExternalAudition,
  restore,
  seconds,
  snapshot,
  span,
  stopAudition,
  subscribeAudition,
} from "./sound";
import {
  createSoundKitController,
  type SoundKitSnapshot,
  type VideoPreviewState,
} from "./sound-kit-controller";

export type { SoundKitSnapshot, VideoPreviewState };

export const isEditableSoundClip = (clip: ClipRef | null): clip is ClipRef => {
  if (!clip || !lanes || locked(clip)) return false;
  const c = clipOf(clip);
  if (!c) return false;
  if (clip.list === "sfx" && (c.dialogue || (lanes.narration && c.name === lanes.narration))) {
    return false;
  }
  return true;
};

const controller = createSoundKitController({
  fetch: (input, init) => fetch(input, init),
  postJson,
  say,
  getLanes: () => lanes,
  getSelectedClip: () => get().clip,
  getPlayhead: () => S.t,
  getPlaying: () => S.playing,
  getDuration: () => DURATION,
  stamp,
  r3,
  isEditableSoundClip,
  span,
  itemOf,
  ensureLibrary: ensureSoundLibrary,
  kindOf,
  seconds,
  snapshot,
  preview,
  restore,
  edit,
  addClip,
  decoded,
  listen,
  listening,
  attachExternalAudition,
  releaseExternalAudition,
  stopAudition,
  resumeAudio,
  getAudio,
  seek,
  setPlaying,
});

let bindingsReady = false;
const ensureBindings = () => {
  if (bindingsReady || typeof window === "undefined") return;
  bindingsReady = true;
  onEvent("sound-kit", () => {
    void controller.reloadSoundKit();
  });
  onEvent("sound", () => {
    controller.clearAudioCache();
  });
  onEvent("voice", () => {
    controller.clearAudioCache();
  });
  onHello((_, reconnect) => {
    if (reconnect) void controller.reloadSoundKit();
  });
  onDocMutated((docName) => {
    controller.handleDocMutated(docName);
  });
  studio.subscribe((next, prev) => {
    if (next.playing && !prev.playing && !controller.getSnapshot().videoPreview.active) {
      controller.stopMiniStudioBuffer();
    }
  });
  subscribeAudition(() => {
    const active = listening();
    if (!active) return;
    if (active !== controller.getSnapshot().loudnessPlayingId) {
      controller.stopMiniStudioBuffer();
    }
    if (controller.getSnapshot().videoPreview.active) controller.stopVideoPreview(true);
  });
};

export const getSoundKitSnapshot = controller.getSnapshot;
export const reloadSoundKit = controller.reloadSoundKit;
export const ensureSoundKitLoaded = (): Promise<void> => {
  ensureBindings();
  return controller.ensureLoaded();
};

export const useSoundKit = (eager = true): SoundKitSnapshot => {
  const current = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    if (eager) void ensureSoundKitLoaded();
  }, [eager]);
  return current;
};

export const saveKitItem = controller.saveKitItem;
export const batchKitItems = controller.batchKitItems;
export const removeKitItem = controller.removeKitItem;
export const saveKitAb = controller.saveKitAb;
export const toggleKitAbSlot = controller.toggleKitAbSlot;
export const resolveKitAb = controller.resolveKitAb;
export const undoKit = controller.undoKit;
export const redoKit = controller.redoKit;
export const recordKitUse = controller.recordKitUse;
export const fetchSimilarKit = controller.fetchSimilarKit;
export const fetchRecommendedKit = controller.fetchRecommendedKit;
export const warmAbAudio = controller.warmAbAudio;
export const setAbLoudnessMatch = controller.setAbLoudnessMatch;
export const stopMiniStudioBuffer = controller.stopMiniStudioBuffer;
export const playKitSound = controller.playKitSound;
export const getVideoTargetSummary = controller.getVideoTargetSummary;
export const stopVideoPreview = controller.stopVideoPreview;
export const stopVideoPreviewIfTarget = controller.stopVideoPreviewIfTarget;
export const acquireWorkbenchMount = controller.acquireWorkbenchMount;
export const previewSoundInVideo = controller.previewSoundInVideo;
export const applyKitSoundToFilm = controller.applyKitSoundToFilm;
export const saveAbSlotsAsClipTry = controller.saveAbSlotsAsClipTry;
