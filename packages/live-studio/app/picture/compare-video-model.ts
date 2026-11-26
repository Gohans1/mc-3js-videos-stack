import {
  compareHitForPoint,
  type CompareVideoAudioMode,
  type CompareVideoCatalog,
  type CompareVideoCategory,
  type CompareVideoItem,
  type CompareVideoLayout,
  type CompareVideoMeta,
  defaultCompareLayout,
  inferCompareLayout,
  type NoteCompareSource,
  parseRatioPair,
} from "../../src/compare-video-meta.ts";

export type {
  CompareVideoAudioMode,
  CompareVideoCatalog,
  CompareVideoCategory,
  CompareVideoItem,
  CompareVideoLayout,
  CompareVideoMeta,
  NoteCompareSource,
};
export { compareHitForPoint, defaultCompareLayout, inferCompareLayout };

export const compareVideoUrl = (item: Pick<CompareVideoItem, "path" | "size" | "mtimeMs">) =>
  `/api/compare-videos/file?path=${encodeURIComponent(item.path)}&v=${item.size}-${item.mtimeMs}`;

export const filmToVideoTime = (
  filmT: number,
  startSec: number,
  videoDuration: number,
): { t: number; outside: "before" | "after" | null } => {
  const safeStart = Number.isFinite(startSec) && startSec > 0 ? startSec : 0;
  const raw = filmT - safeStart;
  if (raw < -1e-4) return { t: 0, outside: "before" };
  if (videoDuration > 0 && raw > videoDuration + 1e-4) {
    return { t: Math.max(0, videoDuration - 0.01), outside: "after" };
  }
  const clamped = videoDuration > 0 ? Math.min(Math.max(0, raw), videoDuration) : Math.max(0, raw);
  return { t: Math.round(clamped * 1e6) / 1e6, outside: null };
};

export const videoToFilmTime = (videoT: number, startSec: number, filmDuration: number): number => {
  const safeStart = Number.isFinite(startSec) && startSec > 0 ? startSec : 0;
  const maxT = Math.max(0, filmDuration - 0.01);
  return Math.round(Math.max(0, Math.min(maxT, videoT + safeStart)) * 1e6) / 1e6;
};

export const isCompareVideoTail = (videoTime: number, duration: number): boolean =>
  duration > 0 && videoTime >= duration - 0.02;

export const compareStageAspect = (
  item: Pick<CompareVideoItem, "category" | "layout"> | null | undefined,
  naturalW: number,
  naturalH: number,
  filmRatio = "16:9",
): [number, number] => {
  if (naturalW > 0 && naturalH > 0) return [naturalW, naturalH];
  const [fw, fh] = parseRatioPair(filmRatio);
  if (!item || item.layout === "single") return [fw, fh];
  if (item.layout === "hstack") return [fw * 2, fh * 1.06];
  return [fw, fh * 2.12];
};

export const noteCompareAspect = (
  note: { compareVideo?: NoteCompareSource | null; context?: unknown },
  filmRatio = "16:9",
): [number, number] | null => {
  const cv = note.compareVideo;
  if (!cv || (cv.layout !== "hstack" && cv.layout !== "vstack")) return null;
  const view =
    note.context && typeof note.context === "object" && "view" in note.context
      ? (note.context as { view?: { canvas?: unknown } }).view
      : undefined;
  const canvas = Array.isArray(view?.canvas) ? view.canvas : null;
  if (
    canvas &&
    canvas.length >= 2 &&
    typeof canvas[0] === "number" &&
    typeof canvas[1] === "number" &&
    Number.isFinite(canvas[0]) &&
    Number.isFinite(canvas[1]) &&
    canvas[0] > 0 &&
    canvas[1] > 0
  ) {
    return [canvas[0], canvas[1]];
  }
  return compareStageAspect(cv, 0, 0, filmRatio);
};

export const noteMatchesStageSpace = (
  note: { compareVideo?: NoteCompareSource | null },
  compareMode: boolean,
  source: Pick<NoteCompareSource, "category" | "layout"> | null,
): boolean => {
  if (!compareMode) return !note.compareVideo;
  return Boolean(
    note.compareVideo &&
    source &&
    note.compareVideo.category === source.category &&
    note.compareVideo.layout === source.layout,
  );
};

export const composeMatchesStageSpace = (
  compose: { compareVideo?: NoteCompareSource | null },
  compareMode: boolean,
  activePath: string | null,
): boolean => {
  if (!compareMode) return !compose.compareVideo;
  return Boolean(compose.compareVideo && activePath && compose.compareVideo.path === activePath);
};

export const compareItemLikelyHasAudio = (
  item: Pick<CompareVideoItem, "path" | "embeddedAudio"> | null | undefined,
): boolean => {
  if (!item) return false;
  if (item.embeddedAudio) return item.embeddedAudio !== "none";
  return !/\/(?:draft|final)_video\.mp4$/i.test(item.path);
};

export const compareReferenceItem = (
  item: CompareVideoItem | null,
  catalog: readonly CompareVideoItem[],
  preferredPath: string | null,
): CompareVideoItem | null => {
  if (!item) return null;
  if (item.category === "reference") return item;
  const path = item.referencePath === undefined ? preferredPath : item.referencePath;
  return catalog.find((candidate) => candidate.path === path) ?? null;
};

export const compareLayoutBadge = (
  category: CompareVideoCategory,
  layout: CompareVideoLayout,
): string => {
  if (category === "compare") return layout === "vstack" ? "REF / OURS" : "REF | OURS";
  if (category === "reference") return "Reference";
  return "Render";
};

export const formatCompareBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} B`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
};

export const formatCompareAge = (mtimeMs: number, nowMs = Date.now()): string => {
  const diffSec = Math.max(0, Math.floor((nowMs - mtimeMs) / 1000));
  if (diffSec < 60) return "just now";
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};
