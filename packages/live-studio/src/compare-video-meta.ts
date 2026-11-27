import { type Ratio, sizeOf } from "./frame.ts";

export type CompareVideoCategory = "compare" | "render" | "reference";
export type CompareVideoLayout = "hstack" | "vstack" | "single";
export type CompareVideoAudioMode = "video" | "studio" | "reference";

export interface CompareVideoItem {
  path: string;
  name: string;
  category: CompareVideoCategory;
  size: number;
  mtimeMs: number;
  startSec: number;
  layout: CompareVideoLayout;
  layoutExact?: true;
  referencePath?: string | null;
  studioStartSec?: number;
  embeddedAudio?: "ours" | "ref" | "none";
}

export interface CompareVideoCatalog {
  videos: CompareVideoItem[];
  defaultPath: string | null;
  canBuild: { ref: string | null; ours: string | null };
}

export interface CompareVideoMeta {
  path: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  hasAudio: boolean;
  layout: CompareVideoLayout;
}

export interface NoteCompareSource {
  path: string;
  category: CompareVideoCategory;
  layout: CompareVideoLayout;
  startSec?: number;
}

export const parseRatioPair = (filmRatio = "16:9"): [number, number] => {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(filmRatio ?? ""));
  if (m) {
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (w > 0 && h > 0) return [w, h];
  }
  return sizeOf(filmRatio as Ratio, 16);
};

export const defaultCompareLayout = (
  category: CompareVideoCategory,
  filmRatio = "16:9",
): CompareVideoLayout => {
  if (category !== "compare") return "single";
  const [fw, fh] = parseRatioPair(filmRatio);
  return fh >= fw ? "hstack" : "vstack";
};

export const inferCompareLayout = (
  category: CompareVideoCategory,
  videoWidth: number,
  videoHeight: number,
  filmRatio = "16:9",
): CompareVideoLayout => {
  if (category !== "compare") return "single";
  if (!(videoWidth > 0 && videoHeight > 0)) return defaultCompareLayout(category, filmRatio);
  const [fw, fh] = parseRatioPair(filmRatio);
  return videoWidth / videoHeight / (fw / fh) >= 1 ? "hstack" : "vstack";
};

export const compareHitForPoint = (
  x: number,
  y: number,
  category: CompareVideoCategory,
  layout: CompareVideoLayout,
): { what: string } => {
  if (category === "compare") {
    if (layout === "hstack") return { what: x < 0.5 ? "REF · left" : "OURS · right" };
    if (layout === "vstack") return { what: y < 0.5 ? "REF · top" : "OURS · bottom" };
    return { what: "Compare video" };
  }
  if (category === "reference") return { what: "Reference video" };
  return { what: "Render video" };
};

const EXPLICIT_COMPARE_NAME = /(?:^|[_-])(vs|sbs|sidebyside|compare|cmp)(?:[_.-]|$)/i;

export const pickDefaultLiteVideo = (
  videos: readonly Pick<CompareVideoItem, "path" | "category" | "name" | "layoutExact">[],
): string | null => {
  if (!Array.isArray(videos) || !videos.length) return null;
  const explicit = videos.find((v) => {
    if (v?.category !== "compare") return false;
    if (v.layoutExact === true) return true;
    const leaf = v.name ?? v.path?.split(/[\\/]/).pop() ?? "";
    return EXPLICIT_COMPARE_NAME.test(leaf);
  });
  return explicit?.path ?? videos[0]?.path ?? null;
};
