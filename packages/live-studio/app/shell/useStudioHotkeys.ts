import { type UseHotkeyDefinition, useHotkeys } from "@tanstack/react-hotkeys";

import { easeCameraPicks, nudgeCameraPicks, saveView, stepCameraKey } from "../camera/cam";
import { copyCam } from "../camera/camline";
import { AWAY, PHONE } from "../core/device";
import { redo, undo } from "../core/doc";
import { engine } from "../core/engine";
import { hasAnySelection, transitionSelection } from "../core/selection";
import { S } from "../core/state";
import { get, say, set, setPref, useStudio } from "../core/store";
import { FPS } from "../core/time";
import { INK_KEYS, setInk, toolsOpen, undoInk } from "../notes/ink";
import {
  approveReviewCurrent,
  cancelNote,
  nextNoteTime,
  openNote,
  setReview,
  stepReview,
} from "../notes/notes";
import { chooseInGroup } from "../options/options";
import { comparePlaybackEnd, toggleCompareVideoMode } from "../picture/compare-video";
import { DIRECTOR_EYE_HOTKEYS, nextGuideMode, nextValueCheckMode } from "../picture/director-eye";
import { restoreFreeView } from "../picture/freecam";
import {
  jumpShot,
  nudgeVolume,
  seek,
  setPlaying,
  shuttleOn,
  skipCompareVideo,
  toggleMute,
  togglePlay,
} from "../playback/transport";
import { allClips, locked, setClips, toggleMuteClips } from "../sound/sound";
import { redoKit, undoKit } from "../sound/sound-kit-client";
import { isSoundKitModalFallbackTarget } from "../sound/sound-kit-view";
import { askPaste, copyAttrs } from "../timeline/attributes";
import { setBlade } from "../timeline/blade";
import { copy, cut, hasCopy, paste } from "../timeline/clipboard";
import { deleteSelected, selectSide, splitAll, splitHere, trimSelected } from "../timeline/cut";
import { clearInOut, inOutByClip, setIn, setOut } from "../timeline/inout";
import { togglePreviewAudio, togglePreviewAxis } from "../timeline/peek";
import { toggleMagnet, zoomSpan, zoomToFit } from "../timeline/timeline";
import { toggleMainMagnet } from "../timeline/timing";
import { toggleFullscreen } from "./fullscreen";

const walkingList = (e: KeyboardEvent) =>
  e.target instanceof Element &&
  e.target.matches(":focus-visible") &&
  !!e.target.closest("[data-arrow-scroll]");
const cutKey = (d: -1 | 1): UseHotkeyDefinition => ({
  hotkey: d < 0 ? "ArrowUp" : "ArrowDown",
  callback: (e) => {
    if (walkingList(e)) return;
    e.preventDefault();
    jumpShot(d);
  },
  options: { preventDefault: false },
});
const noteKey = (d: -1 | 1) => () => {
  const t = nextNoteTime(S.t, d);
  if (t === undefined) say(`No open note ${d > 0 ? "after" : "before"} the playhead`);
  else seek(t);
};
const clip = (f: () => void) => (e: KeyboardEvent) => {
  if (getSelection()?.toString()) return;
  e.preventDefault();
  f();
};
const clipKey = { preventDefault: false, ignoreInputs: true } as const;
const fresh = (f: () => void) => (e: KeyboardEvent) => {
  if (!e.repeat) f();
};
const modalKitKey = (fn: () => Promise<unknown>) => (e: KeyboardEvent) => {
  if (e.defaultPrevented || !isSoundKitModalFallbackTarget(e.target)) return;
  e.preventDefault();
  void fn();
};
const SOUND_KIT_MODAL_KEYS: UseHotkeyDefinition[] = [
  { hotkey: "Mod+Z", callback: modalKitKey(undoKit), options: clipKey },
  { hotkey: "Mod+Shift+Z", callback: modalKitKey(redoKit), options: clipKey },
  { hotkey: "Mod+Y", callback: modalKitKey(redoKit), options: clipKey },
];
const zoomKey = (d: -1 | 1) => () => {
  if (get().free) engine.setFov(-2 * d);
  else zoomSpan(d > 0 ? 1 / 1.5 : 1.5);
};

const REVIEW_KEYS = new Set([
  "Space",
  "Q",
  "E",
  "ArrowLeft",
  "ArrowRight",
  "Shift+ArrowLeft",
  "Shift+ArrowRight",
  "Home",
  "End",
  "M",
  "Shift+M",
  "Alt+Shift+M",
  "N",
  "J",
  "K",
  "L",
  "G",
  "Shift+G",
  "V",
  "Mod+;",
  "Mod+Shift+F",
  "Mod+ArrowUp",
  "Mod+ArrowDown",
  ...Object.values(DIRECTOR_EYE_HOTKEYS),
]);

export function useStudioHotkeys() {
  const settingsOpen = useStudio((s) => s.settingsOpen);
  const composeOpen = useStudio((s) => s.compose !== null);
  const pickFocus = useStudio((s) => s.pickFocus !== null);
  const compareVideoMode = useStudio((s) => s.compareVideoMode);
  const ink = useStudio((s) => s.ink),
    blindAudio = useStudio((s) => s.blindAudio),
    picks = useStudio((s) => s.clips.length),
    sound = useStudio((s) => s.sound);
  const camKey = useStudio((s) => s.camKey),
    camPicks = useStudio((s) => s.camPicks.length),
    cam = useStudio((s) => s.cam),
    keyPicks = useStudio((s) => s.keyPicks.length),
    free = useStudio((s) => s.free);
  const cameraSide = useStudio((s) => s.side === "cam" || s.side === "speed");
  const cameraSelected = camKey !== null || camPicks > 0;
  const object = useStudio((s) => s.object),
    shots = useStudio((s) => s.shots),
    blade = useStudio((s) => s.blade),
    timing = useStudio((s) => s.timing);
  const layerPicks = useStudio((s) => s.layerPicks.length);
  const textPicks = useStudio((s) => s.textPicks.length);
  const transitionPicked = useStudio((s) => s.side === "transition" && s.shotPick !== null);
  const freeze = useStudio((s) => s.freezePick !== null);
  const shotPicked = useStudio((s) => s.timing && (s.shotPick !== null || s.shotPicks.length > 0));
  const hasPick = useStudio(hasAnySelection);
  const anyPick =
    freeze ||
    shotPicked ||
    layerPicks > 0 ||
    picks > 0 ||
    camKey !== null ||
    camPicks > 0 ||
    keyPicks > 0 ||
    textPicks > 0;
  const escPopups: UseHotkeyDefinition[] = [
    {
      hotkey: "Escape",
      callback: () => set({ settingsOpen: false }),
      options: { enabled: settingsOpen },
    },
    {
      hotkey: "Escape",
      callback: () => set({ blindAudio: false }),
      options: { enabled: !settingsOpen && blindAudio },
    },
    {
      hotkey: "Escape",
      callback: () => set({ pickFocus: null }),
      options: { enabled: !settingsOpen && !blindAudio && pickFocus },
    },
    {
      hotkey: "Escape",
      callback: () => cancelNote(),
      options: { enabled: !settingsOpen && !blindAudio && !pickFocus && composeOpen },
    },
    {
      hotkey: "Escape",
      callback: () => setInk(null),
      options: { enabled: !settingsOpen && !blindAudio && !pickFocus && !composeOpen && !!ink },
    },
  ];
  const keys: UseHotkeyDefinition[] = [
    { hotkey: "Space", callback: fresh(togglePlay), options: { enabled: !free } },
    { hotkey: "Q", callback: fresh(togglePlay), options: { enabled: free } },
    { hotkey: "E", callback: () => seek(S.t - 5), options: { enabled: free } },
    {
      hotkey: "ArrowLeft",
      callback: () => (compareVideoMode ? skipCompareVideo(-1) : seek(S.t - 1 / FPS)),
    },
    {
      hotkey: "ArrowRight",
      callback: () => (compareVideoMode ? skipCompareVideo(1) : seek(S.t + 1 / FPS)),
    },
    { hotkey: "Shift+ArrowLeft", callback: () => seek(S.t - 5 / FPS) },
    { hotkey: "Shift+ArrowRight", callback: () => seek(S.t + 5 / FPS) },
    cutKey(-1),
    cutKey(1),
    { hotkey: "Home", callback: () => seek(0) },
    { hotkey: "End", callback: () => seek(comparePlaybackEnd()) },
    {
      hotkey: "Mod+B",
      callback: () => splitHere(),
      options: { enabled: layerPicks > 0 || textPicks > 0 || picks > 0 || (cam && shots) },
    },
    {
      hotkey: "Mod+Shift+B",
      callback: () => splitAll(),
      options: { enabled: sound || (cam && shots) },
    },
    { hotkey: "B", callback: () => setBlade(true) },
    { hotkey: "C", callback: () => setBlade(true) },
    { hotkey: "A", callback: () => setBlade(false), options: { enabled: blade && !free } },
    {
      hotkey: "Q",
      callback: () => trimSelected("left"),
      options: { enabled: (picks > 0 || textPicks > 0 || layerPicks > 0 || shotPicked) && !free },
    },
    {
      hotkey: "W",
      callback: () => trimSelected("right"),
      options: { enabled: (picks > 0 || textPicks > 0 || layerPicks > 0 || shotPicked) && !free },
    },
    {
      hotkey: "[",
      callback: () => {
        if (free) restoreFreeView(-1);
        else if (cam && (cameraSide || cameraSelected || !sound)) stepCameraKey(-1);
        else selectSide(-1);
      },
      options: { enabled: free || sound || cam },
    },
    {
      hotkey: "]",
      callback: () => {
        if (free) restoreFreeView(1);
        else if (cam && (cameraSide || cameraSelected || !sound)) stepCameraKey(1);
        else selectSide(1);
      },
      options: { enabled: free || sound || cam },
    },
    {
      hotkey: "D",
      callback: fresh(() => toggleMuteClips(get().clips)),
      options: { enabled: picks > 0 && !free },
    },
    {
      hotkey: "Mod+A",
      callback: () => setClips(allClips().filter((c) => !locked(c))),
      options: { enabled: sound },
    },
    { hotkey: "Mod+C", callback: clip(copy), options: { ...clipKey, enabled: anyPick } },
    { hotkey: "Mod+X", callback: clip(cut), options: { ...clipKey, enabled: anyPick } },
    {
      hotkey: "Mod+V",
      callback: (e) => {
        if (hasCopy()) clip(paste)(e);
      },
      options: clipKey,
    },
    { hotkey: "Mod+Alt+C", callback: clip(copyAttrs), options: clipKey },
    { hotkey: "Mod+Alt+V", callback: clip(askPaste), options: clipKey },
    {
      hotkey: "Mod+Z",
      callback: () => {
        if (!((get().ink || get().inkSaid) && undoInk())) undo();
      },
    },
    { hotkey: "Mod+Shift+Z", callback: redo },
    {
      hotkey: "Mod+L",
      callback: () => setPref("linkage", !get().linkage),
      options: { enabled: timing },
    },
    { hotkey: "Shift+Backspace", callback: toggleMainMagnet, options: { enabled: timing } },
    { hotkey: "Mod+Y", callback: redo },
    {
      hotkey: "Delete",
      callback: deleteSelected,
      options: { enabled: anyPick || object !== null || transitionPicked },
    },
    {
      hotkey: "Backspace",
      callback: deleteSelected,
      options: { enabled: anyPick || object !== null || transitionPicked },
    },
    { hotkey: "I", callback: setIn },
    { hotkey: "O", callback: setOut },
    { hotkey: "Shift+X", callback: inOutByClip },
    { hotkey: "Alt+X", callback: clearInOut },
    { hotkey: "S", callback: fresh(toggleMagnet), options: { enabled: !free } },
    { hotkey: "Shift+P", callback: fresh(togglePreviewAxis) },
    { hotkey: "Shift+S", callback: fresh(togglePreviewAudio), options: { enabled: !free } },
    {
      hotkey: "M",
      callback: () => {
        const stage = S.el?.stage;
        let visible = !PHONE;
        if (visible && stage && typeof getComputedStyle === "function") {
          for (let el: HTMLElement | null = stage; el; el = el.parentElement) {
            if (getComputedStyle(el).display === "none") {
              visible = false;
              break;
            }
          }
        }
        void openNote(null, true, undefined, visible ? { x: 0.5, y: 0.88 } : undefined);
      },
    },
    { hotkey: "N", callback: () => setReview(!get().review) },
    { hotkey: "Shift+M", callback: noteKey(1) },
    { hotkey: "Alt+Shift+M", callback: noteKey(-1) },
    { hotkey: "=", callback: zoomKey(1) },
    { hotkey: "-", callback: zoomKey(-1) },
    { hotkey: "Shift+Z", callback: zoomToFit },
    {
      hotkey: "Mod+;",
      callback: fresh(() => setPref("guides", !get().guides)),
      options: { enabled: !compareVideoMode },
    },
    {
      hotkey: DIRECTOR_EYE_HOTKEYS.guideMode,
      callback: fresh(() => {
        setPref("guideMode", nextGuideMode(get().guideMode));
        if (!get().guides) setPref("guides", true);
      }),
      options: { enabled: !compareVideoMode },
    },
    {
      hotkey: DIRECTOR_EYE_HOTKEYS.valueCheck,
      callback: fresh(() => set({ valueCheck: nextValueCheckMode(get().valueCheck) })),
    },
    {
      hotkey: DIRECTOR_EYE_HOTKEYS.ghost,
      callback: fresh(() => set({ ghost: !get().ghost })),
      options: { enabled: !compareVideoMode },
    },
    {
      hotkey: DIRECTOR_EYE_HOTKEYS.mute,
      callback: fresh(toggleMute),
    },
    {
      hotkey: DIRECTOR_EYE_HOTKEYS.blindAudio,
      callback: fresh(() => set({ blindAudio: !get().blindAudio })),
    },
    {
      hotkey: DIRECTOR_EYE_HOTKEYS.colorScript,
      callback: fresh(() => set({ colorScript: !get().colorScript })),
    },
    { hotkey: "Mod+Shift+F", callback: fresh(toggleFullscreen) },
    {
      hotkey: "G",
      callback: fresh(() => setInk(get().ink ? null : "pen")),
    },
    { hotkey: "V", callback: fresh(toggleCompareVideoMode) },
    { hotkey: "F", callback: fresh(() => engine.setFree(!get().free)) },
    { hotkey: "J", callback: () => shuttleOn(-1) },
    {
      hotkey: "K",
      callback: () => {
        if (S.playing) setPlaying(false);
      },
    },
    { hotkey: "L", callback: () => shuttleOn(1) },
    {
      hotkey: "Shift+K",
      callback: () => saveView(),
      options: { enabled: cam && !compareVideoMode },
    },
    {
      hotkey: "F9",
      callback: () => easeCameraPicks(false),
      options: { enabled: cam && cameraSelected },
    },
    {
      hotkey: "Shift+F9",
      callback: () => easeCameraPicks(true),
      options: { enabled: cam && cameraSelected },
    },
    {
      hotkey: "Alt+ArrowLeft",
      callback: () => nudgeCameraPicks(-1),
      options: { enabled: cam && cameraSelected },
    },
    {
      hotkey: "Alt+ArrowRight",
      callback: () => nudgeCameraPicks(1),
      options: { enabled: cam && cameraSelected },
    },
    { hotkey: "Alt+C", callback: copyCam, options: { enabled: !compareVideoMode } },
    {
      hotkey: "Shift+G",
      callback: fresh(() => engine.setFinal(!get().final)),
      options: { enabled: !AWAY && !compareVideoMode },
    },
    { hotkey: "Mod+ArrowUp", callback: () => nudgeVolume(true) },
    { hotkey: "Mod+ArrowDown", callback: () => nudgeVolume(false) },
    {
      hotkey: "W",
      callback: () => engine.setGizmo("translate"),
      options: { enabled: object !== null && !free && !compareVideoMode },
    },
    {
      hotkey: "E",
      callback: () => engine.setGizmo("rotate"),
      options: { enabled: object !== null && !free && !compareVideoMode },
    },
    {
      hotkey: "R",
      callback: () => engine.setGizmo("scale"),
      options: { enabled: object !== null && !free && !compareVideoMode },
    },
    ...escPopups,
    {
      hotkey: "Escape",
      callback: () => setBlade(false),
      options: {
        enabled: !settingsOpen && !ink && !blindAudio && !pickFocus && !composeOpen && blade,
      },
    },
    {
      hotkey: "Escape",
      callback: () => {
        set(transitionSelection({ kind: "none" }, get().side));
        S.dirty = true;
      },
      options: {
        enabled:
          !settingsOpen && !ink && !blindAudio && !pickFocus && !composeOpen && !blade && hasPick,
      },
    },
    ...Array.from(
      { length: 10 },
      (_, i) =>
        ({
          hotkey: String(i),
          callback: () =>
            i >= 1 && i <= 4 && toolsOpen(get()) ? setInk(INK_KEYS[i - 1]) : chooseInGroup(i),
        }) as UseHotkeyDefinition,
    ),
  ];
  const reviewOnlyKeys: UseHotkeyDefinition[] = [
    ...escPopups,
    {
      hotkey: "Escape",
      callback: () => setReview(false),
      options: { enabled: !settingsOpen && !ink && !blindAudio && !pickFocus && !composeOpen },
    },
    { hotkey: "ArrowUp", callback: () => void stepReview(-1) },
    { hotkey: "ArrowDown", callback: () => void stepReview(1) },
    { hotkey: "A", callback: () => void approveReviewCurrent() },
  ];
  const modalKind = useStudio((s) => s.modal);
  const review = useStudio((s) => s.review);
  useHotkeys(
    modalKind === "soundKit"
      ? SOUND_KIT_MODAL_KEYS
      : modalKind !== null
        ? []
        : review
          ? [
              ...keys.filter((k) => typeof k.hotkey === "string" && REVIEW_KEYS.has(k.hotkey)),
              ...reviewOnlyKeys,
            ]
          : keys,
    {
      preventDefault: true,
    },
  );
}
