import { PHONE } from "../core/device";
import { engine } from "../core/engine";
import { DURATION } from "../core/filmMeta";
import { S } from "../core/state";
import { get, invalidatePictures, say, set, setPref } from "../core/store";
import { restart as restartStudioAudioClock, resumeAudio, syncMonitorGain } from "../sound/clock";
import {
  compareHitForPoint,
  compareItemLikelyHasAudio,
  compareReferenceItem,
  type CompareVideoAudioMode,
  type CompareVideoCatalog,
  type CompareVideoItem,
  type CompareVideoLayout,
  type CompareVideoMeta,
  compareVideoUrl,
  filmToVideoTime,
  inferCompareLayout,
  isCompareVideoTail,
  type NoteCompareSource,
} from "./compare-video-model";
import {
  compareVideoMetaOf,
  compareVideoPathOf,
  type CompareVideoState,
} from "./slice";

export const compareHooks = {
  pause: () => {},
  clearInk: () => {},
  seek: (_time: number) => {},
};

type CatalogFetchState =
  | { status: "idle"; seq: number }
  | { status: "loading"; seq: number; pendingPath: string | null };

type ProbeState =
  | { status: "idle"; seq: number }
  | { status: "probing"; seq: number; path: string }
  | { status: "probed"; seq: number; path: string };

let catalogFetch: CatalogFetchState = { status: "idle", seq: 0 };
let selectSeq = 0;
let probeState: ProbeState = { status: "idle", seq: 0 };
let captureQueue: Promise<unknown> = Promise.resolve();
let compareSeekOnLoad: { path: string; time: number | null } | null = null;
const videoSizes = new Map<string, [number, number]>();

const resetProbe = (invalidateInFlight: boolean) => {
  probeState = {
    status: "idle",
    seq: invalidateInFlight ? probeState.seq + 1 : probeState.seq,
  };
};

const isProbingOrProbed = (path: string) =>
  (probeState.status === "probing" || probeState.status === "probed") && probeState.path === path;

export const isLiveCompareVideoSynced = (
  video: HTMLVideoElement | null | undefined,
  item: CompareVideoItem | null | undefined,
): video is HTMLVideoElement =>
  Boolean(
    video &&
    item &&
    video.dataset.comparePath === item.path &&
    video.getAttribute("src") === compareVideoUrl(item),
  );

export const compareVideoDimensions = (
  path: string | null | undefined,
): [number, number] | null => {
  if (!path) return null;
  const item = findCompareVideoItem(path);
  const live = S.el?.compareVideo;
  if (isLiveCompareVideoSynced(live, item) && live.videoWidth > 0 && live.videoHeight > 0) {
    return [live.videoWidth, live.videoHeight];
  }
  const meta = compareVideoMetaOf(get());
  if (meta?.path === path && meta.width > 0 && meta.height > 0) {
    return [meta.width, meta.height];
  }
  return videoSizes.get(path) ?? null;
};

const activeRate = () => (S.shuttle > 0 ? S.shuttle : get().rate);

const findCompareVideoItem = (path: string | null | undefined): CompareVideoItem | null => {
  if (!path) return null;
  return get().compareCatalog.videos.find((v) => v.path === path) ?? null;
};

export const compareLayoutForSize = (
  source: Pick<NoteCompareSource, "path" | "category">,
  width: number,
  height: number,
): CompareVideoLayout => {
  const item = findCompareVideoItem(source.path);
  return item?.layoutExact
    ? item.layout
    : inferCompareLayout(source.category, width, height, get().ratio);
};

export const activeCompareVideo = (): CompareVideoItem | null => {
  const s = get();
  const path = compareVideoPathOf(s);
  if (!s.compareVideoMode || !path) return null;
  return s.compareCatalog.videos.find((v) => v.path === path) ?? null;
};

export const activeCompareLayout = (): CompareVideoLayout | null => {
  const item = activeCompareVideo();
  if (!item) return null;
  if (item.layoutExact) return item.layout;
  const meta = compareVideoMetaOf(get());
  if (meta && meta.path === item.path) return meta.layout;
  const video = S.el?.compareVideo;
  if (isLiveCompareVideoSynced(video, item) && video.videoWidth > 0 && video.videoHeight > 0) {
    return inferCompareLayout(item.category, video.videoWidth, video.videoHeight, get().ratio);
  }
  return item.layout;
};

export const activeCompareNoteSource = (): NoteCompareSource | null => {
  const item = activeCompareVideo();
  if (!item) return null;
  const layout = activeCompareLayout() ?? item.layout;
  return {
    path: item.path,
    category: item.category,
    layout,
    ...(item.startSec > 0 ? { startSec: item.startSec } : {}),
  };
};

export const compareVideoHasAudio = (): boolean => {
  const item = activeCompareVideo();
  if (!item) return false;
  const meta = compareVideoMetaOf(get());
  if (meta && meta.path === item.path) return meta.hasAudio;
  return compareItemLikelyHasAudio(item);
};

export const compareVideoEffectiveAudio = (): CompareVideoAudioMode => {
  const { compareVideoMode, compareVideoAudio } = get();
  return compareVideoMode ? compareVideoAudio : "studio";
};

export const compareVideoUsesMediaClock = (): boolean => compareVideoEffectiveAudio() !== "studio";

export const compareStudioOffset = (item = activeCompareVideo()): number =>
  item?.studioStartSec === undefined ? 0 : item.studioStartSec - item.startSec;

const activeReferenceItem = () => {
  const s = get();
  return compareReferenceItem(
    activeCompareVideo(),
    s.compareCatalog.videos,
    s.compareCatalog.canBuild.ref,
  );
};

export const loadCompareReferenceAudio = async (path: string, src: string, signal: AbortSignal) => {
  let state: "ready" | "silent" | "unavailable" = "unavailable";
  try {
    const response = await fetch(`/api/compare-videos/probe?path=${encodeURIComponent(path)}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(16_000)]),
    });
    if (response.ok)
      state = ((await response.json()) as CompareVideoMeta).hasAudio ? "ready" : "silent";
  } catch {}
  if (signal.aborted || S.el?.compareReferenceAudio?.getAttribute("src") !== src) return;
  if (S.el.compareReferenceAudio.error) state = "unavailable";
  set({ compareReferenceAudioStatus: { src, state } });
  reconcileCompareAudioStreams();
};

export const handleCompareReferenceError = (audio: HTMLAudioElement) => {
  const src = audio.getAttribute("src");
  if (src && audio === S.el?.compareReferenceAudio) {
    set({ compareReferenceAudioStatus: { src, state: "unavailable" } });
    reconcileCompareAudioStreams();
  }
};

export const compareLookAt = (x: number, y: number) => {
  const item = activeCompareVideo();
  return item
    ? compareHitForPoint(x, y, item.category, activeCompareLayout() ?? item.layout)
    : { what: "Compare video" };
};

export const compareVideoPlayable = (): boolean => {
  const s = get();
  const item = activeCompareVideo();
  if (!item || s.compareVideo.status === "error") return false;
  const v = S.el?.compareVideo;
  return (
    s.compareVideo.status === "ready" || (isLiveCompareVideoSynced(v, item) && v.readyState >= 1)
  );
};

export const compareVideoNaturalSize = (): [number, number] => {
  const item = activeCompareVideo();
  const video = S.el?.compareVideo;
  if (isLiveCompareVideoSynced(video, item) && video.videoWidth > 0 && video.videoHeight > 0) {
    return [video.videoWidth, video.videoHeight];
  }
  const meta = compareVideoMetaOf(get());
  if (item && meta && meta.path === item.path && meta.width > 0 && meta.height > 0) {
    return [meta.width, meta.height];
  }
  return [0, 0];
};

export const compareVideoDuration = (): number => {
  const item = activeCompareVideo();
  const video = S.el?.compareVideo;
  if (
    isLiveCompareVideoSynced(video, item) &&
    Number.isFinite(video.duration) &&
    video.duration > 0
  ) {
    return video.duration;
  }
  const meta = compareVideoMetaOf(get());
  if (item && meta && meta.path === item.path && meta.duration > 0) return meta.duration;
  return 0;
};

export const comparePlaybackEnd = (): number => {
  const item = activeCompareVideo();
  return item ? Math.max(DURATION, item.startSec + compareVideoDuration()) : DURATION;
};

export const seekRecordedCompareTime = (path: string, time: number): void => {
  if (!Number.isFinite(time) || time < 0) return;
  const videoReady = activeCompareVideo()?.path === path && compareVideoDuration() > 0;
  const seekNow = videoReady || time <= Math.max(0, DURATION - 0.01);
  compareSeekOnLoad = videoReady ? null : { path, time: seekNow ? null : time };
  if (seekNow) compareHooks.seek(time);
};

export const applyCompareVideoAudioState = (): void => {
  const { muted, volume } = get();
  const mode = compareVideoEffectiveAudio();
  const gain = Math.max(0, Math.min(1, volume));
  const mix = S.el?.audio;
  if (mix) {
    mix.muted = muted || mode !== "studio";
    mix.volume = gain;
    syncMonitorGain();
  }
  const reference = S.el?.compareReferenceAudio;
  if (reference) {
    reference.muted = muted || mode !== "reference";
    reference.volume = gain;
  }
  const video = S.el?.compareVideo;
  if (!video) return;
  video.muted = muted || mode !== "video";
  video.volume = gain;
};

export const syncCompareReferenceAudio = (time = S.t, force = false): void => {
  const ref = S.el?.compareReferenceAudio;
  if (!ref) return;
  const item = activeReferenceItem();
  const src = item && compareVideoUrl(item);
  const status = get().compareReferenceAudioStatus;
  if (
    !item ||
    !src ||
    ref.getAttribute("src") !== src ||
    status?.src !== src ||
    status.state !== "ready" ||
    compareVideoEffectiveAudio() !== "reference" ||
    ref.readyState < 1
  ) {
    if (!ref.paused) ref.pause();
    return;
  }
  const video = S.el?.compareVideo;
  const compare = activeCompareVideo();
  const { t, outside } = filmToVideoTime(
    time,
    compare?.referencePath ? 0 : item.startSec,
    ref.duration,
  );
  const pictureDuration = compareVideoDuration();
  const pictureTime = compare && filmToVideoTime(time, compare.startSec, pictureDuration);
  const playing =
    S.playing &&
    S.shuttle >= 0 &&
    isLiveCompareVideoSynced(video, compare) &&
    pictureTime !== null &&
    (pictureTime.outside !== null ||
      isCompareVideoTail(pictureTime.t, pictureDuration) ||
      video.ended ||
      (!video.paused && !video.seeking && video.readyState >= 2));
  if ((!playing || outside || ref.ended) && !ref.paused) ref.pause();
  if (outside) return;
  const rate = activeRate();
  const drift = t - ref.currentTime;
  if (force || !playing || ref.paused) {
    ref.playbackRate = rate;
    if ((force || !ref.seeking) && Math.abs(drift) > 0.015) ref.currentTime = t;
    if (playing && ref.paused && !ref.ended) ref.play().catch(() => {});
  } else if (!ref.seeking && ref.readyState >= 3) {
    if (Math.abs(drift) > 0.12 && bufferedAt(ref, t)) ref.currentTime = t;
    const correction = Math.abs(drift) <= 0.03 ? 0 : Math.max(-0.04, Math.min(0.04, drift * 0.25));
    ref.playbackRate = rate * (1 + correction);
  }
};

const bufferedAt = (media: HTMLMediaElement, t: number): boolean => {
  const buffered = media.buffered;
  for (let i = 0; i < buffered.length; i++) {
    if (t >= buffered.start(i) && t + 0.12 <= buffered.end(i)) return true;
  }
  return false;
};

export const reconcileCompareAudioStreams = (): void => {
  const video = S.el?.compareVideo;
  const audio = S.el?.audio;
  const mode = compareVideoEffectiveAudio();
  if (mode !== "reference") S.el?.compareReferenceAudio?.pause();
  if (mode !== "studio") {
    audio?.pause();
    restartStudioAudioClock();
  }
  applyCompareVideoAudioState();
  const item = activeCompareVideo();
  if (!item) {
    video?.pause();
    return;
  }
  if (mode !== "studio") {
    if (S.playing && S.shuttle >= 0 && isLiveCompareVideoSynced(video, item) && video.paused) {
      startCompareVideoPlayback(activeRate());
    }
    syncCompareReferenceAudio(S.t, true);
  } else if (S.playing && S.shuttle >= 0 && audio && audio.readyState > 0) {
    const rate = activeRate();
    audio.playbackRate = rate;
    const time = S.t + compareStudioOffset(item);
    if (time < 0 || (Number.isFinite(audio.duration) && time >= audio.duration - 0.05))
      audio.pause();
    else if (audio.paused || Math.abs(audio.currentTime - time) > 0.14) {
      audio.currentTime = time;
      if (audio.paused) audio.play().catch(() => {});
      resumeAudio();
    }
  }
};

export const syncCompareVideoElement = (
  targetFilmT = S.t,
  opts: { forceSeek?: boolean; rate?: number } = {},
): { outside: "before" | "after" | null; videoTime: number } => {
  const video = S.el?.compareVideo;
  const item = activeCompareVideo();
  if (!item || !isLiveCompareVideoSynced(video, item)) {
    S.el?.compareVideo?.pause();
    return { outside: null, videoTime: 0 };
  }
  applyCompareVideoAudioState();
  const dur = compareVideoDuration();
  const { t: targetVideoT, outside } = filmToVideoTime(targetFilmT, item.startSec, dur);
  const desiredRate = Math.max(0.25, Math.min(8, opts.rate ?? activeRate()));
  if (Math.abs(video.playbackRate - desiredRate) > 1e-3) {
    try {
      video.playbackRate = desiredRate;
    } catch {}
  }
  if (video.readyState >= 1) {
    const tolerance = opts.forceSeek ? 0.001 : S.playing && outside === null ? 0.14 : 0.015;
    if (
      (opts.forceSeek || !video.seeking) &&
      Math.abs(video.currentTime - targetVideoT) > tolerance
    ) {
      try {
        video.currentTime = targetVideoT;
      } catch {}
    }
  }
  if (outside !== null && !video.paused) video.pause();
  syncCompareReferenceAudio(targetFilmT, Boolean(opts.forceSeek));
  return { outside, videoTime: targetVideoT };
};

export const startCompareVideoPlayback = (rate = activeRate()): boolean => {
  const video = S.el?.compareVideo;
  const item = activeCompareVideo();
  if (!isLiveCompareVideoSynced(video, item) || S.shuttle < 0) return false;
  const dur = compareVideoDuration();
  const { outside, videoTime } = syncCompareVideoElement(S.t, { forceSeek: true, rate });
  if (outside !== null || video.ended || isCompareVideoTail(videoTime, dur)) {
    video.pause();
    return false;
  }
  if (video.paused) video.play().catch(() => {});
  return true;
};

export const pauseCompareVideoPlayback = (): void => {
  S.el?.compareVideo?.pause();
  S.el?.compareReferenceAudio?.pause();
};

export const probeCompareVideoPath = async (path: string | null): Promise<void> => {
  const seq = probeState.seq + 1;
  if (!path) {
    probeState = { status: "idle", seq };
    const cur = get().compareVideo;
    if (cur.status === "loading" || cur.status === "ready") {
      set({ compareVideo: { ...cur, meta: null } });
    }
    return;
  }
  const startedItem = findCompareVideoItem(path);
  probeState = { status: "probing", seq, path };
  try {
    const res = await fetch(`/api/compare-videos/probe?path=${encodeURIComponent(path)}`, {
      cache: "no-store",
    });
    if (probeState.seq !== seq) return;
    if (!res.ok) return;
    const data = (await res.json()) as CompareVideoMeta;
    if (probeState.seq !== seq) return;
    const latestItem = findCompareVideoItem(path);
    if (
      startedItem &&
      (!latestItem ||
        latestItem.size !== startedItem.size ||
        latestItem.mtimeMs !== startedItem.mtimeMs)
    ) {
      return;
    }
    if (data.width > 0 && data.height > 0) videoSizes.set(path, [data.width, data.height]);
    const cur = get().compareVideo;
    if ((cur.status !== "loading" && cur.status !== "ready") || cur.path !== path) return;
    probeState = { status: "probed", seq, path };
    set({ compareVideo: { ...cur, meta: data } });
    reconcileCompareAudioStreams();
    invalidatePictures();
    S.dirty = true;
  } catch {
  } finally {
    if (probeState.status === "probing" && probeState.seq === seq) {
      probeState = { status: "idle", seq };
    }
  }
};

export const loadCompareVideos = async (
  opts: { selectPath?: string } = {},
): Promise<CompareVideoCatalog | null> => {
  const seq = catalogFetch.seq + 1;
  const carriedPending = catalogFetch.status === "loading" ? catalogFetch.pendingPath : null;
  catalogFetch = { status: "loading", seq, pendingPath: opts.selectPath ?? carriedPending };
  const failed = (message: string) => {
    if (catalogFetch.seq !== seq) return null;
    catalogFetch = { status: "idle", seq };
    const curCatalog = get().compareCatalog;
    set({
      compareCatalog: {
        status: "error",
        videos: curCatalog.videos,
        canBuild: curCatalog.canBuild,
        error: message,
      },
    });
    if (activeCompareVideo()) say(message, 4000);
    return null;
  };
  try {
    const res = await fetch("/api/compare-videos", {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return failed(
        res.status === 404
          ? "This Studio server does not have Compare Video. Restart Studio, then retry."
          : `Studio returned HTTP ${res.status}. Retry to load project videos.`,
      );
    }
    if (catalogFetch.seq !== seq) return null;
    const data = (await res.json()) as CompareVideoCatalog;
    if (catalogFetch.seq !== seq) return null;
    const requestedPath = catalogFetch.status === "loading" ? catalogFetch.pendingPath : null;
    catalogFetch = { status: "idle", seq };

    const prev = get();
    const prevByPath = new Map(prev.compareCatalog.videos.map((v) => [v.path, v]));
    const nextByPath = new Map(data.videos.map((v) => [v.path, v]));
    for (const [p, oldItem] of prevByPath) {
      const freshItem = nextByPath.get(p);
      if (!freshItem || freshItem.size !== oldItem.size || freshItem.mtimeMs !== oldItem.mtimeMs) {
        videoSizes.delete(p);
      }
    }
    const currentPath = compareVideoPathOf(prev);
    const stillExists = Boolean(currentPath && nextByPath.has(currentPath));
    const nextPath =
      requestedPath && nextByPath.has(requestedPath)
        ? requestedPath
        : stillExists
          ? currentPath
          : data.defaultPath;

    const newestCompare = data.videos.find((v) => v.category === "compare");
    let latestNotice = prev.compareLatestNotice;
    if (
      prev.compareCatalog.status === "ready" &&
      prev.compareVideoMode &&
      newestCompare &&
      newestCompare.path !== nextPath &&
      !prevByPath.has(newestCompare.path)
    ) {
      latestNotice = newestCompare.path;
    } else if (latestNotice && (latestNotice === nextPath || !nextByPath.has(latestNotice))) {
      latestNotice = null;
    }

    const prevItem = currentPath ? (prevByPath.get(currentPath) ?? null) : null;
    const nextItem = nextPath ? (nextByPath.get(nextPath) ?? null) : null;
    const fileChanged =
      nextPath !== currentPath ||
      (prevItem &&
        nextItem &&
        (prevItem.size !== nextItem.size || prevItem.mtimeMs !== nextItem.mtimeMs));

    const nextVideo: CompareVideoState = !nextPath
      ? { status: "none" }
      : fileChanged || prev.compareVideo.status === "none"
        ? { status: "loading", path: nextPath, meta: null }
        : prev.compareVideo;

    set({
      compareCatalog: {
        status: "ready",
        videos: data.videos,
        canBuild: data.canBuild,
      },
      compareVideo: nextVideo,
      compareLatestNotice: latestNotice,
    });

    if (fileChanged) {
      pauseCompareVideoPlayback();
      resetProbe(true);
      if (currentPath) videoSizes.delete(currentPath);
      if (nextPath) videoSizes.delete(nextPath);
      invalidatePictures();
    }
    if (nextPath && (fileChanged || probeState.status !== "probed" || probeState.path !== nextPath)) {
      if (get().compareVideoMode) void probeCompareVideoPath(nextPath);
    } else if (!nextPath) {
      resetProbe(true);
      if (get().compareVideoMode) {
        if (S.playing) compareHooks.pause();
        if (get().ink) compareHooks.clearInk();
      }
    }
    S.dirty = true;
    return data;
  } catch {
    return failed("Studio did not return a video catalog. Retry or restart Studio.");
  }
};

export const retryCompareVideo = async (): Promise<void> => {
  resetProbe(true);
  const curPath = compareVideoPathOf(get());
  set({
    compareVideo: curPath ? { status: "loading", path: curPath, meta: null } : { status: "none" },
  });
  const recordedPath = compareSeekOnLoad?.path;
  const catalog = await loadCompareVideos({ selectPath: recordedPath });
  if (!get().compareVideoMode) return;
  if (
    catalog &&
    recordedPath &&
    compareSeekOnLoad?.path === recordedPath &&
    !findCompareVideoItem(recordedPath)
  ) {
    compareSeekOnLoad = null;
    if (catalog.defaultPath)
      say("Original compare video was removed; opened the latest video instead", 4000);
  }
  const path = compareVideoPathOf(get()) ?? catalog?.defaultPath ?? null;
  if (path) {
    if (!isProbingOrProbed(path)) {
      void probeCompareVideoPath(path);
    }
    S.el?.compareVideo?.load();
  }
  S.dirty = true;
};

export const selectCompareVideo = (path: string): void => {
  const s = get();
  if (!s.compareCatalog.videos.some((v) => v.path === path)) return;
  selectSeq++;
  const currentPath = compareVideoPathOf(s);
  const changed = currentPath !== path;
  if (changed) {
    compareSeekOnLoad = null;
    pauseCompareVideoPlayback();
    if (probeState.status === "probed") resetProbe(false);
  }
  const nextVideo: CompareVideoState =
    changed || s.compareVideo.status === "none" || s.compareVideo.status === "error"
      ? { status: "loading", path, meta: null }
      : s.compareVideo;
  set({
    compareVideo: nextVideo,
    compareLatestNotice: null,
  });
  if (changed) {
    invalidatePictures();
    reconcileCompareAudioStreams();
  }
  void probeCompareVideoPath(path);
  S.dirty = true;
};

export const setCompareVideoAudio = (mode: CompareVideoAudioMode): void => {
  if (get().compareVideoAudio === mode) return;
  const item = activeCompareVideo();
  const video = S.el?.compareVideo;
  if (
    item &&
    S.playing &&
    isLiveCompareVideoSynced(video, item) &&
    !video.paused &&
    !video.seeking
  ) {
    S.t = item.startSec + video.currentTime;
  }
  setPref("compareVideoAudio", mode);
  reconcileCompareAudioStreams();
};

export const setCompareVideoMode = (on: boolean, path?: string): void => {
  if (on && PHONE) return;
  const mySelect = ++selectSeq;
  compareSeekOnLoad = null;
  const s = get();
  if (on) {
    if (s.free) engine.setFree(false);
    const videos = s.compareCatalog.videos;
    const prevPath = compareVideoPathOf(s);
    const hasRequested = Boolean(path && videos.some((v) => v.path === path));
    const chosenPath = hasRequested ? path! : (prevPath ?? videos[0]?.path ?? null);
    const chosenItem = findCompareVideoItem(chosenPath);
    const pathChanged = Boolean(chosenPath && chosenPath !== prevPath);
    if (pathChanged) {
      pauseCompareVideoPlayback();
      if (probeState.status === "probed") resetProbe(false);
    }
    const domReady = Boolean(
      !pathChanged &&
      isLiveCompareVideoSynced(S.el?.compareVideo, chosenItem) &&
      S.el.compareVideo.readyState >= 1,
    );
    const keptMeta = !pathChanged ? compareVideoMetaOf(s) : null;
    const nextVideo: CompareVideoState = !chosenPath
      ? { status: "none" }
      : domReady
        ? { status: "ready", path: chosenPath, meta: keptMeta }
        : { status: "loading", path: chosenPath, meta: keptMeta };
    set({
      compareVideoMode: true,
      compareVideo: nextVideo,
      cameraPick: null,
      pickFocus: null,
      compareGrid: false,
      shotList: false,
      ...(chosenPath && chosenPath === s.compareLatestNotice ? { compareLatestNotice: null } : {}),
    });
    invalidatePictures();
    applyCompareVideoAudioState();
    if (compareVideoUsesMediaClock()) S.el?.audio?.pause();
    if (!chosenPath) {
      if (S.playing) compareHooks.pause();
      if (get().ink) compareHooks.clearInk();
    }
    if (s.compareCatalog.status !== "ready" || (path && !hasRequested)) {
      void loadCompareVideos({ selectPath: path }).then((catalog) => {
        if (!catalog || !get().compareVideoMode || mySelect !== selectSeq) return;
        const found = Boolean(path && catalog.videos.some((v) => v.path === path));
        if (path && !found && compareSeekOnLoad?.path === path) compareSeekOnLoad = null;
        if (path && !found && catalog.defaultPath) {
          say("Original compare video was removed; opened the latest video instead", 4000);
        }
        const currentNow = compareVideoPathOf(get());
        const target = found ? path! : path ? catalog.defaultPath : (currentNow ?? catalog.defaultPath);
        if (target && target !== currentNow) {
          pauseCompareVideoPlayback();
          if (probeState.status === "probed") resetProbe(false);
          set({
            compareVideo: { status: "loading", path: target, meta: null },
            ...(target === get().compareLatestNotice ? { compareLatestNotice: null } : {}),
          });
          invalidatePictures();
          reconcileCompareAudioStreams();
          S.dirty = true;
        }
        if (target && !isProbingOrProbed(target)) {
          void probeCompareVideoPath(target);
        }
      });
    } else if (chosenPath && !isProbingOrProbed(chosenPath)) {
      void probeCompareVideoPath(chosenPath);
    }
    if (S.playing && S.shuttle >= 0) {
      const started = startCompareVideoPlayback(activeRate());
      const active = activeCompareVideo();
      const dur = compareVideoDuration();
      if (!started && active && compareVideoEffectiveAudio() === "video" && dur > 0) {
        const { outside, t: vt } = filmToVideoTime(S.t, active.startSec, dur);
        if (outside === "after" || vt >= dur - 0.02) compareHooks.pause();
      }
    } else syncCompareVideoElement(S.t, { forceSeek: true });
    S.dirty = true;
    return;
  }

  if (!s.compareVideoMode) return;
  pauseCompareVideoPlayback();
  const prevPath = compareVideoPathOf(s);
  const prevMeta = compareVideoMetaOf(s);
  set({
    compareVideoMode: false,
    compareVideo: prevPath
      ? { status: "loading", path: prevPath, meta: prevMeta }
      : { status: "none" },
  });
  applyCompareVideoAudioState();
  invalidatePictures();
  if (S.t >= DURATION) {
    if (S.playing) compareHooks.pause();
    compareHooks.seek(DURATION);
  }
  if (S.playing && !S.render) {
    compareHooks.pause();
  } else {
    const audio = S.el?.audio;
    if (S.render && audio && audio.readyState > 0) {
      audio.playbackRate = activeRate();
      const past = Number.isFinite(audio.duration) && S.t >= audio.duration - 0.05;
      if (!past) {
        if (audio.paused || Math.abs(audio.currentTime - S.t) > 0.08) audio.currentTime = S.t;
        if (S.playing && S.shuttle >= 0) {
          audio.play().catch(() => {});
          resumeAudio();
        }
      }
    }
  }
  S.dirty = true;
};

export const toggleCompareVideoMode = (): void => {
  setCompareVideoMode(!get().compareVideoMode);
};

export const handleCompareVideoLoadedMetadata = (video: HTMLVideoElement): void => {
  const item = activeCompareVideo();
  if (!item || !isLiveCompareVideoSynced(video, item)) return;
  const width = video.videoWidth || 0;
  const height = video.videoHeight || 0;
  if (width > 0 && height > 0) videoSizes.set(item.path, [width, height]);
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const prevMeta = compareVideoMetaOf(get());
  const samePath = prevMeta?.path === item.path;
  const resolvedWidth = width || (samePath ? prevMeta.width : 0);
  const resolvedHeight = height || (samePath ? prevMeta.height : 0);
  const layout = compareLayoutForSize(item, resolvedWidth, resolvedHeight);
  set({
    compareVideo: {
      status: "ready",
      path: item.path,
      meta: {
        path: item.path,
        width: resolvedWidth,
        height: resolvedHeight,
        duration: duration || (samePath ? prevMeta.duration : 0),
        fps: samePath ? prevMeta.fps : 30,
        hasAudio: samePath ? prevMeta.hasAudio : compareVideoHasAudio(),
        layout,
      },
    },
  });
  const recorded = compareSeekOnLoad?.path === item.path ? compareSeekOnLoad : null;
  if (recorded) compareSeekOnLoad = null;
  if (recorded?.time != null) compareHooks.seek(recorded.time);
  else if (S.t >= comparePlaybackEnd()) compareHooks.seek(S.t);
  reconcileCompareAudioStreams();
  invalidatePictures();
  if (S.playing && S.shuttle >= 0) {
    const started = startCompareVideoPlayback(activeRate());
    if (!started && compareVideoEffectiveAudio() === "video" && duration > 0) {
      const { outside, t: vt } = filmToVideoTime(S.t, item.startSec, duration);
      if (outside === "after" || vt >= duration - 0.02) compareHooks.pause();
    }
  } else syncCompareVideoElement(S.t, { forceSeek: true });
  S.dirty = true;
};

export const handleCompareVideoError = (video: HTMLVideoElement): void => {
  const item = activeCompareVideo();
  if (!item || !isLiveCompareVideoSynced(video, item)) return;
  if (compareSeekOnLoad?.path === item.path) compareSeekOnLoad = null;
  if (S.playing) compareHooks.pause();
  if (get().ink) compareHooks.clearInk();
  resetProbe(true);
  set({
    compareVideo: {
      status: "error",
      path: item.path,
      error: `Could not decode ${item.path}. Check that the file is a valid MP4/WebM/MOV.`,
    },
  });
};

const seekVideoOnce = (video: HTMLVideoElement, rawDest: number) =>
  new Promise<void>((resolve) => {
    const dest =
      Number.isFinite(video.duration) && video.duration > 0
        ? Math.max(0, Math.min(video.duration, rawDest))
        : Math.max(0, rawDest);
    const nearDest = (tol: number) => Math.abs(video.currentTime - dest) <= tol;
    if (!video.seeking && video.readyState >= 2 && nearDest(0.012)) {
      resolve();
      return;
    }
    const needSeek = !nearDest(0.012);
    let phase: "seeking" | "awaiting-ready" | "done" = needSeek ? "seeking" : "awaiting-ready";
    const done = () => {
      if (phase === "done") return;
      phase = "done";
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("error", done);
      resolve();
    };
    const onSeeked = () => {
      if (phase === "seeking") phase = "awaiting-ready";
      if (!video.seeking && video.readyState >= 2) done();
    };
    const onReady = () => {
      if (phase === "awaiting-ready" && !video.seeking && video.readyState >= 2) done();
    };
    const timer = window.setTimeout(done, 2000);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("canplay", onReady);
    video.addEventListener("error", done, { once: true });
    if (needSeek) {
      try {
        video.currentTime = dest;
      } catch {
        done();
      }
    }
  });

const openOffscreenVideo = (src: string) =>
  new Promise<HTMLVideoElement | null>((resolve) => {
    if (typeof document === "undefined") {
      resolve(null);
      return;
    }
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      v.removeEventListener("loadeddata", onLoad);
      v.removeEventListener("error", onErr);
      if (ok && v.videoWidth > 0 && v.videoHeight > 0) resolve(v);
      else {
        v.removeAttribute("src");
        v.load();
        resolve(null);
      }
    };
    const onLoad = () => finish(true);
    const onErr = () => finish(false);
    const timer = window.setTimeout(() => finish(v.readyState >= 2), 4000);
    v.addEventListener("loadeddata", onLoad, { once: true });
    v.addEventListener("error", onErr, { once: true });
    v.src = src;
    v.load();
  });

const openCaptureVideo = async (
  target?: NoteCompareSource | null,
): Promise<{
  video: HTMLVideoElement;
  startSec: number;
  duration: number;
  dimensions: [number, number] | null;
} | null> => {
  const active = activeCompareVideo();
  const targetPath = target?.path ?? active?.path ?? null;
  if (!targetPath) return null;
  const item = findCompareVideoItem(targetPath);
  const startSec = target?.startSec ?? item?.startSec ?? 0;
  const src = item
    ? compareVideoUrl(item)
    : `/api/compare-videos/file?path=${encodeURIComponent(targetPath)}`;
  const offscreen = await openOffscreenVideo(src);
  if (!offscreen) return null;
  const dimensions: [number, number] | null =
    offscreen.videoWidth > 0 && offscreen.videoHeight > 0
      ? [offscreen.videoWidth, offscreen.videoHeight]
      : null;
  if (dimensions) videoSizes.set(targetPath, dimensions);
  const duration =
    Number.isFinite(offscreen.duration) && offscreen.duration > 0 ? offscreen.duration : 0;
  return { video: offscreen, startSec, duration, dimensions };
};

export interface CompareVideoSession {
  dimensions: [number, number] | null;
  captureAt: <T>(filmT: number, read: (video: HTMLVideoElement | null) => T) => Promise<T>;
  captureFrames: <T>(
    filmTimes: readonly number[],
    read: (video: HTMLVideoElement, index: number, filmT: number) => void,
    finish: (video: HTMLVideoElement) => T,
  ) => Promise<T | null>;
}

export const withCompareVideoSession = async <T>(
  target: NoteCompareSource | null | undefined,
  work: (session: CompareVideoSession) => Promise<T>,
): Promise<T> => {
  const run = captureQueue.then(async () => {
    const resolved = await openCaptureVideo(target);
    if (!resolved) {
      return work({
        dimensions: null,
        captureAt: async (_filmT, read) => read(null),
        captureFrames: async () => null,
      });
    }
    const { video, startSec, duration, dimensions } = resolved;
    const session: CompareVideoSession = {
      dimensions,
      captureAt: async (filmT, read) => {
        const { t: targetTime, outside } = filmToVideoTime(filmT, startSec, duration);
        if (outside) return read(null);
        await seekVideoOnce(video, targetTime);
        if (video.readyState < 2) return read(null);
        return read(video);
      },
      captureFrames: async (filmTimes, read, finish) => {
        for (let i = 0; i < filmTimes.length; i++) {
          const { t: targetTime, outside } = filmToVideoTime(filmTimes[i], startSec, duration);
          await seekVideoOnce(video, targetTime);
          if (video.readyState >= 2) {
            const actualFilmT = outside ? startSec + targetTime : filmTimes[i];
            read(video, i, actualFilmT);
          }
        }
        return finish(video);
      },
    };
    try {
      return await work(session);
    } finally {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  });
  captureQueue = run.catch(() => {});
  return run;
};

export const withCompareVideoCapture = async <T>(
  filmT: number,
  read: (video: HTMLVideoElement | null) => T,
  target?: NoteCompareSource | null,
): Promise<T> => {
  const active = activeCompareVideo();
  const targetPath = target?.path ?? active?.path ?? null;
  const item = findCompareVideoItem(targetPath);
  const startSec = target?.startSec ?? item?.startSec ?? 0;
  const live = S.el?.compareVideo;
  if (
    get().compareVideo.status === "ready" &&
    isLiveCompareVideoSynced(live, item) &&
    !live.seeking &&
    live.readyState >= 2 &&
    live.videoWidth > 0 &&
    live.videoHeight > 0
  ) {
    const dur =
      Number.isFinite(live.duration) && live.duration > 0 ? live.duration : compareVideoDuration();
    const { t: targetTime, outside } = filmToVideoTime(filmT, startSec, dur);
    if (outside) return read(null);
    if (Math.abs(live.currentTime - targetTime) <= 0.015) {
      return read(live);
    }
  }
  return withCompareVideoSession(target, (session) => session.captureAt(filmT, read));
};

export const withCompareVideoFrames = async <T>(
  filmTimes: readonly number[],
  read: (video: HTMLVideoElement, index: number, filmT: number) => void,
  finish: (video: HTMLVideoElement) => T,
  target?: NoteCompareSource | null,
): Promise<T | null> =>
  withCompareVideoSession(target, (session) => session.captureFrames(filmTimes, read, finish));

export const compareVideoCaptureSize = (
  video: HTMLVideoElement,
  maxLong = 1280,
): [number, number] => {
  const vw = Math.max(1, video.videoWidth);
  const vh = Math.max(1, video.videoHeight);
  const scale = Math.min(1, maxLong / Math.max(vw, vh));
  return [Math.max(2, Math.round(vw * scale)), Math.max(2, Math.round(vh * scale))];
};

export const compareSpanJumpTarget = (): number | null => {
  const item = activeCompareVideo();
  if (!item) return null;
  const dur = compareVideoDuration();
  const { outside } = filmToVideoTime(S.t, item.startSec, dur);
  const maxT = Math.max(0, comparePlaybackEnd() - 0.01);
  if (outside === "before") return Math.max(0, Math.min(maxT, item.startSec));
  if (outside === "after") {
    return Math.max(0, Math.min(maxT, item.startSec + Math.max(0, dur - 0.05)));
  }
  return null;
};

export const checkCompareFeedbackRange = (): boolean => {
  if (compareSpanJumpTarget() === null) return true;
  say("Use Jump to enter the video span before adding feedback", 3500);
  return false;
};
