export interface SharedVoiceEntry {
  id: string;
  name: string;
  creatorId?: string;
  category: string;
  useCase: string;
  gender: string;
  age: string;
  accent: string;
  descriptive: string;
  description: string;
  previewUrl: string;
  v4: boolean;
  v4Post: boolean;
  v4Turbo: boolean;
  v4Fast: boolean;
  rate: number;
  free: boolean;
  usage1y: number;
  usage7d: number;
  clones: number;
  likes: number;
  featured: boolean;
  addedAt: number;
}

export interface VoiceLibraryCatalog {
  version: number;
  syncedAt: string | null;
  totalScanned: number;
  totalEnglish: number;
  totalEnglishV4: number;
  truncated?: boolean;
  source: string | null;
  voices: SharedVoiceEntry[];
}

export interface VoiceLibraryState {
  status: "idle" | "syncing" | "ready" | "error";
  syncedAt: string | null;
  totalScanned: number;
  totalEnglish: number;
  totalEnglishV4: number;
  truncated?: boolean;
  pagesLoaded: number;
  hasKey: boolean;
  error: string | null;
}

export interface VoiceLibraryPayload extends VoiceLibraryState {
  voices: SharedVoiceEntry[];
}

export interface VoiceLibraryHandle {
  cacheFile: string;
  voices: () => SharedVoiceEntry[];
  state: () => VoiceLibraryState;
  hasKey: () => boolean;
  ensureWarm: () => boolean;
  sync: () => Promise<VoiceLibraryCatalog>;
  waitForSync: () => Promise<VoiceLibraryCatalog>;
  payloadJson: () => string;
}

export function sanitizeError(err: unknown, secret?: string): string;
export function defaultVoiceCacheFile(project?: string): string;
export function normalizeSharedVoice(raw: Record<string, unknown>): SharedVoiceEntry | null;
export function syncVoiceCatalog(opts?: Record<string, unknown>): Promise<VoiceLibraryCatalog>;
export function openVoiceLibrary(opts?: Record<string, unknown>): VoiceLibraryHandle;
