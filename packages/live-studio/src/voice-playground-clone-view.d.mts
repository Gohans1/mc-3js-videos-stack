import type { PlaygroundClone } from "./voice-playground-clones.mjs";
import type { PlaygroundVoiceOption } from "./voice-playground.mjs";

export function visibleCloudClones<T extends { id: string }>(
  voices: T[],
  bindings: Array<{
    remoteId: string;
    localId: string;
    scope: "project" | "global";
    projectKey: string;
  }>,
  context: { scope: "project" | "global"; projectKey: string },
): T[];
export function cloneVoiceOption(record: PlaygroundClone): PlaygroundVoiceOption | null;
