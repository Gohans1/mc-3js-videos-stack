export interface CloneSettings {
  name: string;
  language: string;
  gender: string;
  noiseReduction?: boolean;
  previewText?: string;
}
export interface PlaygroundClone {
  id: string;
  scope: "project" | "global";
  projectKey: string;
  remoteId?: string;
  remoteCreatedAt?: string;
  phase:
    "prepared" | "submitting" | "processing" | "ready" | "failed" | "uncertain" | "unavailable";
  displayName?: string;
  settings: CloneSettings;
  permission: { confirmed: boolean; confirmedAt: string };
  sourceFile?: string;
  sourceName?: string;
  durationSeconds?: number;
  bytes?: number;
  sampleAudioFile?: string;
  sampleUrl?: string;
  previewError?: string;
  previewStale?: boolean;
  warning?: string;
  error?: string;
  creditsDeducted?: number;
  imported?: boolean;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  lastCheckedAt?: string;
  attempts: Array<{
    submittedAt: string;
    displayName?: string;
    settings: CloneSettings;
    retry?: boolean;
    creditsDeducted?: number;
    imported?: boolean;
  }>;
  copiedFrom?: { id: string; scope: "project" | "global" };
}
export interface CloudClone {
  id: string;
  voice_name: string;
  language_tag?: string;
  gender?: string;
  status: "processing" | "done" | "failed";
  created_at?: string;
}
export interface CloneLinkInput {
  remoteId: string;
  permissionConfirmed: true;
}
export interface CloneController {
  assertCloneAvailable(provider: "elevenlabs" | "minimax" | "capcut", voiceId: string): void;
  listClones(options?: { includeGlobal?: boolean }): PlaygroundClone[];
  refreshClones(options?: { includeGlobal?: boolean }): Promise<PlaygroundClone[]>;
  submitClone(id: string): Promise<PlaygroundClone>;
  getClone(id: string): PlaygroundClone | undefined;
  createClone(
    file: File,
    input: CloneSettings & { permissionConfirmed: true },
  ): Promise<PlaygroundClone>;
  refreshClone(id: string, options?: { signal?: AbortSignal }): Promise<PlaygroundClone>;
  listCloudClones(): Promise<CloudClone[]>;
  adoptClone(input: CloneLinkInput): Promise<PlaygroundClone>;
  linkClone(id: string, input: CloneLinkInput): Promise<PlaygroundClone>;
  patchClone(id: string, input: { favorite?: boolean; name?: string }): PlaygroundClone;
  retryClone(id: string): Promise<PlaygroundClone>;
  deleteCloudClone(id: string): Promise<PlaygroundClone>;
  copyCloneToScope(id: string, scope: "project" | "global"): Promise<PlaygroundClone>;
  cloneSource(id: string): string;
}
export function createPlaygroundClones(options: Record<string, unknown>): CloneController;
