import type { z } from "zod";

import type { DubbingInput } from "./voice-playground-dubbing-contract";

export interface DubbingSource {
  id: string;
  filename: string;
  bytes: number;
  lastModified?: number;
  chunkSize: number;
  uploaded: number[];
  phase: "receiving" | "verifying" | "prepared";
  durationSeconds?: number;
  hasVideo?: boolean;
  error?: string;
}
export interface DubbingJob {
  id: string;
  scope: "project" | "global";
  phase:
    | "prepared"
    | "uploading"
    | "upload_interrupted"
    | "submitting"
    | "processing"
    | "retrying"
    | "uncertain"
    | "failed"
    | "downloading"
    | "download_interrupted"
    | "completed"
    | "unavailable";
  settings: Omit<z.input<typeof DubbingInput>, "sourceId"> & { sourceId?: string; modelId: string };
  taskId?: string;
  itemId?: string;
  sourceName?: string;
  durationSeconds?: number;
  estimatedCredits?: number;
  creditsDeducted?: number;
  progress: number;
  createdAt: string;
  submittedAt?: string;
  updatedAt: string;
  lastCheckedAt?: string;
  error?: string;
  retry?: boolean;
  previousJobId?: string;
  upload?: { uploaded: number[]; uploadedBytes?: number; source?: { size: number }; phase: string };
  downloads?: Record<string, { phase: string; bytes: number; total?: number }>;
}
export interface CloudDubbingTask {
  id: string;
  status: string;
  progress?: number;
  source_lang: string;
  target_lang: string;
  provider: "elevenlabs" | "minimax" | "capcut";
  voice_id: string;
  model_id?: string;
  credits_deducted?: number;
  created_at?: string;
  metadata?: { voice_name?: string; source_file_name?: string; original_video_url?: string };
  result?: { audio_url?: string; srt_url?: string };
}
export interface DubbingController {
  getDubbing(id: string): DubbingJob | undefined;
  listDubbing(input?: { includeGlobal?: boolean }): DubbingJob[];
  prepareDubbing(input: z.input<typeof DubbingInput>): DubbingJob;
  submitDubbing(id: string): DubbingJob;
  refreshDubbing(id: string, input?: { signal?: AbortSignal }): Promise<DubbingJob>;
  retryDubbing(id: string, input?: { signal?: AbortSignal }): Promise<DubbingJob>;
  linkDubbing(id: string, taskId: string, input?: { signal?: AbortSignal }): Promise<DubbingJob>;
  importDubbing(taskId: string, input?: { signal?: AbortSignal }): Promise<DubbingJob>;
  deleteCloudDubbing(id: string): Promise<DubbingJob>;
  listCloudDubbing(input?: {
    page?: number;
    pageSize?: number;
  }): Promise<{ tasks: CloudDubbingTask[]; hasMore: boolean }>;
  stageDubbingFile(file: File, input?: { sourceId?: string }): Promise<DubbingSource>;
  stageDubbingRecording(
    id: string,
    input?: { asset?: "audio" | "source"; signal?: AbortSignal },
  ): Promise<DubbingSource>;
  stageDubbingSourceCopy(
    id: string,
    sourceScope: "project" | "global",
    input?: { signal?: AbortSignal },
  ): Promise<DubbingSource>;
  initDubbingSource(input: {
    filename: string;
    bytes: number;
    lastModified?: number;
  }): Promise<DubbingSource>;
  getDubbingSource(id: string): DubbingSource | undefined;
  appendDubbingSource(id: string, index: number, chunk: Blob): Promise<DubbingSource>;
  completeDubbingSource(id: string): Promise<DubbingSource>;
  dubbingSourcePath(id: string): string;
  dubbingAsset(id: string, asset: "source" | "result"): string | null;
  waitForDubbing(): Promise<PromiseSettledResult<unknown>[]>;
  closeDubbing(): void;
}
export function createPlaygroundDubbing(
  options: Record<string, unknown>,
): Omit<DubbingController, "dubbingAsset">;
