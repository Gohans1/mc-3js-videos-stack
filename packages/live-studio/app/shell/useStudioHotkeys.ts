// The studio's keys (listed in Settings, "Shortcuts"): CapCut desktop's default keys wherever the studio does what CapCut does,
// since those are the keys the dev's hands know; the studio's own (notes, drawing, the free camera) sit on keys CapCut leaves
// free. Ctrl + and Ctrl - stay the browser's page zoom (CapCut zooms its timeline with them; here = and - do). Letters match
// the key's place, not its letter, so they work on any keyboard layout; typing in the note box never reaches them
import { useHotkeys, type UseHotkeyDefinition } from "@tanstack/react-hotkeys";
import { DURATION } from "film/scene";
import { AWAY } from "../core/device";
import { FPS } from "../core/time";
import { nextNoteTime, openNote } from "../notes/notes";
import { setInk, undoInk } from "../notes/ink";
import { chooseInGroup } from "../options/options";
import { jumpShot, nudgeVolume, seek, setPlaying, shuttleOn, togglePlay } from "../playback/transport";
import { setFinal } from "../picture/render";
import { setFov, setFree } from "../picture/freecam";
import { S } from "../core/state";
import { removeCamKeys, removeKey, saveView, setKey } from "../camera/cam";
import { copy, cut, hasCopy, paste } from "../timeline/clipboard";
import { askPaste, copyAttrs } from "../timeline/attributes";
import { selectSide, splitAll, splitHere } from "../timeline/cut";
import { setBlade } from "../timeline/blade";
import { toggleMagnet, zoomSpan, zoomToFit } from "../timeline/timeline";
import { togglePreviewAxis } from "../timeline/peek";
import { clearInOut, inOutByClip, setIn, setOut } from "../timeline/inout";
import { redo, undo } from "../core/doc";
import { pickKeys, removeKeys } from "../keys/keys";
import { removeObject, select, setGizmo, setTool } from "../objects/placed";
import { toggleFullscreen } from "./fullscreen";
import { allClips, locked, removeClips, setClips, trimClips } from "../sound/sound";
import { get, say, set, setPref, useStudio } from "../core/store";

// The keyboard walking a list (the ones marked data-arrow-scroll: notes, settings) scrolls it with Up and Down; everywhere else
// they jump from cut to cut, as in CapCut
const walkingList = (e: KeyboardEvent) => e.target instanceof Element && e.target.matches(":focus-visible") && !!e.target.closest("[data-arrow-scroll]");
const cutKey = (d: -1 | 1): UseHotkeyDefinition => ({
  hotkey: d < 0 ? "ArrowUp" : "ArrowDown",
  callback: (e) => { if (walkingList(e)) return; e.preventDefault(); jumpShot(d); },
  options: { preventDefault: false },
});
const noteKey = (d: -1 | 1) => () => { const t = nextNoteTime(S.t, d); if (t === undefined) say(`No open note ${d > 0 ? "after" : "before"} the playhead`); else seek(t); };
// Ctrl+C, X and V take the timeline's picks unless the page has text selected or a box has focus: then they are the browser's
const clip = (f: () => void) => (e: KeyboardEvent) => { if (getSelection()?.toString()) return; e.preventDefault(); f(); };
const clipKey = { preventDefault: false, ignoreInputs: true } as const;
// An on/off key acts on a fresh press only: a key still held from flying (D) must not flip Draw once the free camera is left
const fresh = (f: () => void) => (e: KeyboardEvent) => { if (!e.repeat) f(); };
// = and - zoom the timeline; in the free camera they change its lens instead
const zoomKey = (d: -1 | 1) => () => { if (get().free) setFov(-2 * d); else zoomSpan(d > 0 ? 1 / 1.5 : 1.5); };

export function useStudioHotkeys() {
  const settingsOpen = useStudio((s) => s.settingsOpen);
  const ink = useStudio((s) => s.ink), picks = useStudio((s) => s.clips.length), sound = useStudio((s) => s.sound);
  const camKey = useStudio((s) => s.camKey), camPicks = useStudio((s) => s.camPicks.length), cam = useStudio((s) => s.cam), keyPicks = useStudio((s) => s.keyPicks.length), free = useStudio((s) => s.free);
  const object = useStudio((s) => s.object), shots = useStudio((s) => s.shots), blade = useStudio((s) => s.blade);
  const placed = useStudio((s) => s.placed), tool = useStudio((s) => s.tool);
  const anyPick = picks > 0 || camKey !== null || camPicks > 0 || keyPicks > 0;
  const keys: UseHotkeyDefinition[] = [
    // ---- CapCut's own
    // In the free camera Space flies up (picture/flight.ts), as in Minecraft
    { hotkey: "Space", callback: togglePlay, options: { enabled: !free } },
    { hotkey: "ArrowLeft", callback: () => seek(S.t - 1 / FPS) },
    { hotkey: "ArrowRight", callback: () => seek(S.t + 1 / FPS) },
    { hotkey: "Shift+ArrowLeft", callback: () => seek(S.t - 5 / FPS) },
    { hotkey: "Shift+ArrowRight", callback: () => seek(S.t + 5 / FPS) },
    cutKey(-1),
    cutKey(1),
    { hotkey: "Home", callback: () => seek(0) },
    { hotkey: "End", callback: () => seek(DURATION) },
    { hotkey: "Mod+B", callback: () => splitHere(), options: { enabled: picks > 0 || (cam && shots) } },
    { hotkey: "Mod+Shift+B", callback: () => splitAll(), options: { enabled: sound || (cam && shots) } },
    // Split mode: B as in CapCut, C as the razor of Premiere (the dev's habit); A is the select pointer again. A flies left in the free camera
    { hotkey: "B", callback: () => setBlade(true) },
    { hotkey: "C", callback: () => setBlade(true) },
    { hotkey: "A", callback: () => setBlade(false), options: { enabled: blade && !free } },
    { hotkey: "Q", callback: () => trimClips(get().clips, "left"), options: { enabled: picks > 0 && !free } },
    { hotkey: "W", callback: () => trimClips(get().clips, "right"), options: { enabled: picks > 0 && !free } },
    { hotkey: "[", callback: () => selectSide(-1), options: { enabled: sound } },
    { hotkey: "]", callback: () => selectSide(1), options: { enabled: sound } },
    { hotkey: "Mod+A", callback: () => setClips(allClips().filter((c) => !locked(c))), options: { enabled: sound } },
    // While drawing, undo takes back strokes; otherwise the last edit to the sound lanes, the camera keys or the key rows (core/doc.ts)
    { hotkey: "Mod+C", callback: clip(copy), options: { ...clipKey, enabled: anyPick } },
    { hotkey: "Mod+X", callback: clip(cut), options: { ...clipKey, enabled: anyPick } },
    { hotkey: "Mod+V", callback: (e) => { if (hasCopy()) clip(paste)(e); }, options: clipKey },
    // CapCut's Copy attributes and Paste attributes: one pick's settings onto other picks of its kind (timeline/attributes.ts)
    { hotkey: "Mod+Alt+C", callback: clip(copyAttrs), options: clipKey },
    { hotkey: "Mod+Alt+V", callback: clip(askPaste), options: clipKey },
    { hotkey: "Mod+Z", callback: () => { if (!(get().ink && undoInk())) undo(); } },
    { hotkey: "Mod+Shift+Z", callback: redo },
    { hotkey: "Mod+Y", callback: redo },
    { hotkey: "Delete", callback: () => removeClips(get().clips), options: { enabled: picks > 0 } },
    { hotkey: "Backspace", callback: () => removeClips(get().clips), options: { enabled: picks > 0 } },
    { hotkey: "Delete", callback: () => removeKey(camKey!), options: { enabled: camKey !== null } },
    { hotkey: "Backspace", callback: () => removeKey(camKey!), options: { enabled: camKey !== null } },
    { hotkey: "Delete", callback: () => removeCamKeys(get().camPicks), options: { enabled: camPicks > 0 } },
    { hotkey: "Backspace", callback: () => removeCamKeys(get().camPicks), options: { enabled: camPicks > 0 } },
    { hotkey: "Delete", callback: () => removeKeys(get().keyPicks), options: { enabled: keyPicks > 0 } },
    { hotkey: "Backspace", callback: () => removeKeys(get().keyPicks), options: { enabled: keyPicks > 0 } },
    { hotkey: "Delete", callback: () => removeObject(object!), options: { enabled: object !== null } },
    { hotkey: "Backspace", callback: () => removeObject(object!), options: { enabled: object !== null } },
    { hotkey: "N", callback: fresh(toggleMagnet) },
    { hotkey: "I", callback: setIn },
    { hotkey: "O", callback: setOut },
    { hotkey: "Shift+X", callback: inOutByClip },
    { hotkey: "Alt+X", callback: clearInOut },
    { hotkey: "S", callback: fresh(togglePreviewAxis), options: { enabled: !free } }, // in the free camera S flies back
    // CapCut's marker is the studio's note: one at the playhead, and the next or previous one
    { hotkey: "M", callback: () => openNote(null) },
    { hotkey: "Shift+M", callback: noteKey(1) },
    { hotkey: "Alt+Shift+M", callback: noteKey(-1) },
    { hotkey: "=", callback: zoomKey(1) },
    { hotkey: "-", callback: zoomKey(-1) },
    { hotkey: "Shift+Z", callback: zoomToFit },
    { hotkey: "Mod+;", callback: fresh(() => setPref("guides", !get().guides)) },
    { hotkey: "Mod+Shift+F", callback: fresh(toggleFullscreen) },
    // Figma's move tool key: a click on the picture picks an object; again, it pins notes
    { hotkey: "V", callback: fresh(() => setTool(get().tool === "select" ? "note" : "select")), options: { enabled: placed } },
    // ---- The studio's own
    // D also flies the free camera right (W A S D), so there only the Draw button draws
    { hotkey: "D", callback: fresh(() => setInk(get().ink ? null : "pen")), options: { enabled: !free } },
    { hotkey: "F", callback: fresh(() => setFree(!get().free)) },
    { hotkey: "J", callback: () => shuttleOn(-1) },
    { hotkey: "K", callback: () => { if (S.playing) setPlaying(false); } },
    { hotkey: "L", callback: () => shuttleOn(1) },
    { hotkey: "Shift+K", callback: () => saveView(), options: { enabled: cam } },
    { hotkey: "G", callback: fresh(() => setFinal(!get().final)), options: { enabled: !AWAY } },
    { hotkey: "Mod+ArrowUp", callback: () => nudgeVolume(true) },
    { hotkey: "Mod+ArrowDown", callback: () => nudgeVolume(false) },
    // Unreal's gizmo keys; in the free camera W and E walk instead
    { hotkey: "W", callback: () => setGizmo("translate"), options: { enabled: object !== null && !free } },
    { hotkey: "E", callback: () => setGizmo("rotate"), options: { enabled: object !== null && !free } },
    { hotkey: "R", callback: () => setGizmo("scale"), options: { enabled: object !== null && !free } },
    // A popup open on top (a "?" or a menu) takes Esc for itself first
    { hotkey: "Escape", callback: () => set({ settingsOpen: false }), options: { enabled: settingsOpen } },
    { hotkey: "Escape", callback: () => setInk(null), options: { enabled: !settingsOpen && !!ink } },
    { hotkey: "Escape", callback: () => setBlade(false), options: { enabled: !settingsOpen && !ink && blade } },
    { hotkey: "Escape", callback: () => setClips([]), options: { enabled: !settingsOpen && !ink && !blade && picks > 0 } },
    { hotkey: "Escape", callback: () => setKey(null), options: { enabled: !settingsOpen && !ink && !blade && (camKey !== null || camPicks > 0) } },
    { hotkey: "Escape", callback: () => pickKeys([]), options: { enabled: !settingsOpen && !ink && !blade && keyPicks > 0 } },
    { hotkey: "Escape", callback: () => select(null), options: { enabled: !settingsOpen && !ink && !blade && object !== null } },
    { hotkey: "Escape", callback: () => setTool("note"), options: { enabled: !settingsOpen && !ink && !blade && picks === 0 && camKey === null && camPicks === 0 && keyPicks === 0 && object === null && tool === "select" } },
    ...Array.from({ length: 10 }, (_, i) => ({ hotkey: String(i), callback: () => chooseInGroup(i) }) as UseHotkeyDefinition),
    // W A S D, Space, Shift, Q and E fly the free camera while held: app/picture/flight.ts, listened to in picture/pointer.ts
  ];
  // A box open over the page (Paste attributes?) takes the keys: Delete or Space must not reach the timeline under it
  const pasteAsk = useStudio((s) => s.pasteAsk);
  useHotkeys(pasteAsk ? [] : keys, { preventDefault: true });
}
