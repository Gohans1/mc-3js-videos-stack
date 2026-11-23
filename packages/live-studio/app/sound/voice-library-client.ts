import { useEffect, useSyncExternalStore } from "react";

import { scheduleIdleBatch } from "../core/search";
import { say } from "../core/store";
import {
  createVoiceLibraryClient,
  type VoiceLibraryClientState,
} from "./voice-library-client-core";
import { warmVoiceSearchTokens } from "./voice-library-view";
import { registerVoiceNames } from "./voice-view";

export type { VoiceLibraryClientState };

const client = createVoiceLibraryClient({
  fetch: (input, init) => fetch(input, init),
  say,
  registerVoiceNames,
  scheduleIdleBatch,
  warmVoiceSearchTokens,
});

export const loadVoiceLibrary = client.loadVoiceLibrary;
export const handleVoiceLibraryEvent = client.handleVoiceLibraryEvent;
export const syncVoiceLibraryNow = client.syncVoiceLibraryNow;

export const useVoiceLibrary = (enabled = true): VoiceLibraryClientState => {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  useEffect(() => {
    if (!enabled) return;
    return client.acquireConsumer();
  }, [enabled]);
  return state;
};
