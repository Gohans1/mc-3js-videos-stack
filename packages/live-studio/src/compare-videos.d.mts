import type {
  CompareVideoCatalog,
  CompareVideoCategory,
  CompareVideoItem,
  CompareVideoLayout,
  CompareVideoMeta,
} from "./compare-video-meta.ts";

export type {
  CompareVideoCatalog,
  CompareVideoCategory,
  CompareVideoItem,
  CompareVideoLayout,
  CompareVideoMeta,
};

export const COMPARE_VIDEO_EXTS: Set<string>;
export function isSkippedRenderDir(name: string): boolean;
export function isValidCompareVideoPath(rawPath: string | null | undefined): boolean;
export function classifyCompareVideo(relPath: string): CompareVideoCategory;
export function defaultCompareLayout(
  category: CompareVideoCategory,
  filmRatio?: string,
): CompareVideoLayout;
export function inferCompareLayout(
  category: CompareVideoCategory,
  videoWidth: number,
  videoHeight: number,
  filmRatio?: string,
): CompareVideoLayout;
export function listCompareVideos(projectDir: string): CompareVideoCatalog;
export function compareVideosFingerprint(projectDir: string): string;
export function resolveCompareVideoFile(
  projectDir: string,
  rawPath?: string | null,
): { ok: true; file: string; rel: string } | { ok: false; status: number; error: string };

export function probeCompareVideo(
  projectDir: string,
  rawPath?: string | null,
): Promise<({ ok: true } & CompareVideoMeta) | { ok: false; status: number; error: string }>;
