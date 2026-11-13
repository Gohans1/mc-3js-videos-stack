// The panels beside the picture, laid out as CapCut's. On a wide screen the libraries are on the left (the note being written,
// then a toolbar of icons over their names: Notes, Audio, Text, Objects) and the details on the right, whose text tabs are those
// of what is selected, as CapCut's are: a clip, Audio; a text or shape, Text | Animation; an object, Object; keys, Keyframes; nothing (the camera, CapCut's main
// track), Camera, Speed and Animation for the shot or key picked, or on the playhead. Narrower, one column on the right (under
// the picture on an upright phone) holds both: the note being written, then a tab each for the notes, the sound, the objects,
// the text, the camera (Camera | Speed | Animation under it) and the keys, each with its details above its library.
import { Tabs } from "@base-ui/react/tabs";
import {
  Blend,
  Boxes,
  Clapperboard,
  type LucideIcon,
  MessageSquareText,
  Music2,
  SlidersHorizontal,
  Type,
} from "lucide-react";
import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

import { noteState } from "../../src/note-state.mjs";
import { AdjustLibrary } from "../camera/AdjustLibrary";
import { AdjustPanel } from "../camera/AdjustPanel";
import { AnimPanel } from "../camera/AnimPanel";
import { CamPanel } from "../camera/CamPanel";
import { TransitionLibrary } from "../camera/TransitionLibrary";
import { TransitionPanel } from "../camera/TransitionPanel";
import { Segmented } from "../components/inspector";
import { set, studio, type StudioState, useStudio } from "../core/store";
import { KeyPanel } from "../keys/KeyPanel";
import { Compose } from "../notes/Compose";
import { NoteList } from "../notes/NoteList";
import { ObjectsPanel } from "../objects/ObjectsPanel";
import { OwnPanel } from "../own/OwnPanel";
import { SoundPanel } from "../sound/SoundPanel";
import { TextLibrary } from "../text/TextLibrary";
import { TextPanel } from "../text/TextPanel";
import { FilmSpeedPanel as SpeedPanel } from "../timeline/FilmSpeedPanel";

type SideTab = StudioState["side"];
type Lib = StudioState["lib"];

// CapCut's text tabs: the open one in the accent. The bar under it is ours (dev's call): the color alone is hard to see at a glance
const tab =
  "relative flex h-10 flex-none items-center gap-1.5 rounded-sm text-ui font-medium text-muted-foreground outline-none not-data-active:hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-active:text-primary data-active:after:absolute data-active:after:inset-x-0 data-active:after:bottom-0 data-active:after:h-0.5 data-active:after:rounded-full data-active:after:bg-primary pointer-coarse:h-11";
const tabs = "flex flex-none items-center gap-5 overflow-x-auto bg-card px-3"; // CapCut's panel head: a lighter bar, no line under it
const panel = "mt-2 flex min-h-0 flex-1 flex-col";

const WIDE = matchMedia("(min-width: 1280px) and (min-height: 640px)");
export const useWide = () =>
  useSyncExternalStore(
    (f) => {
      WIDE.addEventListener("change", f);
      return () => WIDE.removeEventListener("change", f);
    },
    () => WIDE.matches,
  );
// A note opened (a pin, N) shows the notes in the left column too
studio.subscribe((s, was) => {
  if (s.side === "notes" && was.side !== "notes") set({ lib: "notes" });
});

const useParts = () => ({
  sound: useStudio((s) => s.sound),
  text: useStudio((s) => s.text),
  cam: useStudio((s) => s.cam),
  keys: useStudio((s) => !!s.keyFiles?.length),
  placed: useStudio((s) => s.placed),
  open: useStudio((s) => s.notes.filter((n) => noteState(n) === "open").length),
  check: useStudio((s) => s.notes.filter((n) => noteState(n) === "check").length),
});
// Whether the film gives the studio anything to edit, so a wide screen has a details column to show
export const useEditable = () => {
  const p = useParts();
  return p.sound || p.text || p.cam || p.keys || p.placed;
};

// The AI's notes to fix in the accent, the creator's to check in yellow
function NotesCount({ open, check }: { open: number; check: number }) {
  return (
    <>
      {open > 0 && (
        <span className="text-primary tabular-nums" aria-label={`, ${open} to fix`}>
          {open}
        </span>
      )}
      {check > 0 && (
        <span
          className="bg-warn rounded-full px-1.5 text-xs leading-4 font-semibold text-black tabular-nums"
          aria-label={`, ${check} to check`}
        >
          {check}
        </span>
      )}
    </>
  );
}

// Wide: the left column. CapCut's toolbar: an icon over each library's name
const LIBS: { id: Lib; title: string; icon: LucideIcon }[] = [
  { id: "notes", title: "Notes", icon: MessageSquareText },
  { id: "sound", title: "Audio", icon: Music2 },
  { id: "text", title: "Text", icon: Type },
  { id: "objects", title: "Objects", icon: Boxes },
  { id: "transition", title: "Transitions", icon: Blend },
  { id: "adjust", title: "Adjustment", icon: SlidersHorizontal },
  { id: "film", title: "Film", icon: Clapperboard },
];
const tool =
  "relative flex min-w-14 flex-col items-center gap-0.5 rounded-md px-2 pt-1.5 pb-1 text-xs text-muted-foreground outline-none not-data-active:hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-active:text-primary data-active:after:absolute data-active:after:inset-x-3 data-active:after:-bottom-1 data-active:after:h-0.5 data-active:after:rounded-full data-active:after:bg-primary [&_svg]:size-5";
export function Library() {
  const { sound, text, cam, placed, open, check } = useParts(),
    lib = useStudio((s) => s.lib);
  const shown = LIBS.filter(
    (l) =>
      l.id === "notes" ||
      l.id === "film" ||
      (l.id === "sound"
        ? sound
        : l.id === "text"
          ? text
          : l.id === "transition" || l.id === "adjust"
            ? cam
            : placed),
  );
  return (
    <aside
      aria-label="Library"
      className="bg-background col-start-1 row-span-2 row-start-1 flex min-h-0 min-w-0 flex-col overflow-y-auto overscroll-contain rounded-lg in-data-lib-folded:hidden in-data-review:hidden"
    >
      <Compose />
      <Tabs.Root
        value={lib}
        onValueChange={(v) => set({ lib: v as Lib })}
        className="flex min-h-0 flex-1 flex-col"
      >
        {/* More tools than a narrow column holds scroll sideways, the fade saying there are more (the card stays under it) */}
        <div className="bg-card flex-none">
          <Tabs.List
            aria-label="Libraries"
            className="scroll-fade-x flex [scrollbar-width:none] gap-1 overflow-x-auto overscroll-x-contain px-2 pt-1 pb-1"
          >
            {shown.map((l) => (
              <Tabs.Tab key={l.id} value={l.id} className={cn(tool, "flex-none")}>
                <l.icon aria-hidden />
                <span className="flex items-center gap-1">
                  {l.title}
                  {l.id === "notes" && <NotesCount open={open} check={check} />}
                </span>
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </div>
        <Tabs.Panel value="notes" className="flex min-h-0 flex-1 flex-col">
          <NoteList />
        </Tabs.Panel>
        {sound && (
          <Tabs.Panel value="sound" className="flex min-h-0 flex-1 flex-col">
            <SoundPanel part="library" />
          </Tabs.Panel>
        )}
        {text && (
          <Tabs.Panel value="text" className={panel}>
            <TextLibrary />
          </Tabs.Panel>
        )}
        {placed && (
          <Tabs.Panel value="objects" className={panel}>
            <ObjectsPanel part="library" />
          </Tabs.Panel>
        )}
        {cam && (
          <Tabs.Panel value="transition" className={panel}>
            <TransitionLibrary />
          </Tabs.Panel>
        )}
        {cam && (
          <Tabs.Panel value="adjust" className={panel}>
            <AdjustLibrary />
          </Tabs.Panel>
        )}
        <Tabs.Panel value="film" className="flex min-h-0 flex-1 flex-col">
          <OwnPanel />
        </Tabs.Panel>
      </Tabs.Root>
    </aside>
  );
}

// Wide: the right column, CapCut's details: the tabs of what is selected
type Group = "adjustment" | "sound" | "text" | "objects" | "keys" | "cam" | "transition";
const GROUPS: Record<Group, { id: SideTab; title: string }[]> = {
  adjustment: [{ id: "adjust", title: "Adjustment" }],
  sound: [
    { id: "sound", title: "Basic" },
    { id: "voiceChanger", title: "Voice changer" },
    { id: "audioSpeed", title: "Speed" },
  ],
  text: [
    { id: "text", title: "Text" },
    { id: "textAnim", title: "Animation" },
  ],
  objects: [{ id: "objects", title: "Object" }],
  keys: [{ id: "keys", title: "Keyframes" }],
  cam: [
    { id: "cam", title: "Camera" },
    { id: "speed", title: "Speed" },
    { id: "anim", title: "Animation" },
    { id: "adjust", title: "Adjust" },
  ],
  transition: [{ id: "transition", title: "Transition" }],
};
const groupOf = (s: StudioState): Group =>
  s.layerPicks.length
    ? "adjustment"
    : s.clips.length
      ? "sound"
      : s.textPicks.length
        ? "text"
        : s.object
          ? "objects"
          : s.keyPicks.length
            ? "keys"
            : s.side === "transition"
              ? "transition"
              : "cam";
function Details() {
  const { sound, text, cam, keys, placed } = useParts(),
    side = useStudio((s) => s.side);
  const has: Record<Group, boolean> = {
    sound,
    text,
    objects: placed,
    keys,
    cam,
    transition: cam,
    adjustment: cam,
  };
  const picked = useStudio(groupOf),
    group = has[picked] ? picked : (Object.keys(has) as Group[]).find((g) => has[g])!;
  const list = GROUPS[group],
    value = list.some((x) => x.id === side) ? side : list[0].id;
  return (
    <aside
      aria-label="Details"
      className="bg-background col-start-3 row-span-2 row-start-1 flex min-h-0 min-w-0 flex-col overflow-y-auto overscroll-contain rounded-lg in-data-review:hidden in-data-side-folded:hidden"
    >
      <Tabs.Root
        value={value}
        onValueChange={(v) => set({ side: v as SideTab })}
        className="flex min-h-0 flex-1 flex-col"
      >
        <Tabs.List aria-label="Details" className={tabs}>
          {list.map((x) => (
            <Tabs.Tab key={x.id} value={x.id} className={tab}>
              {x.title}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel value={value} className={panel}>
          {value === "sound" || value === "voiceChanger" || value === "audioSpeed" ? (
            <SoundPanel
              part="clip"
              tab={value === "voiceChanger" ? "voice" : value === "audioSpeed" ? "speed" : "basic"}
            />
          ) : value === "text" || value === "textAnim" ? (
            <TextPanel part={value} />
          ) : value === "objects" ? (
            <ObjectsPanel part="object" />
          ) : value === "keys" ? (
            <KeyPanel />
          ) : value === "transition" ? (
            <TransitionPanel />
          ) : value === "adjust" ? (
            <AdjustPanel />
          ) : value === "anim" ? (
            <AnimPanel />
          ) : value === "speed" ? (
            <SpeedPanel />
          ) : (
            <CamPanel />
          )}
        </Tabs.Panel>
      </Tabs.Root>
    </aside>
  );
}

function AudioTab() {
  const side = useStudio((s) => s.side),
    part = side === "voiceChanger" || side === "audioSpeed" ? side : "sound";
  return (
    <>
      <Segmented
        label="Audio part"
        className="mx-3 mb-2"
        value={part}
        onChange={(v) => set({ side: v })}
        items={GROUPS.sound}
      />
      <SoundPanel
        tab={part === "voiceChanger" ? "voice" : part === "audioSpeed" ? "speed" : "basic"}
      />
    </>
  );
}

// Narrow: the text tab holds the picked item's Text | Animation, or the library when none is picked
function TextTab() {
  const side = useStudio((s) => s.side),
    picked = useStudio((s) => s.textPicks.length > 0),
    part = side === "textAnim" ? "textAnim" : "text";
  return picked ? (
    <>
      <Segmented
        label="Text part"
        className="mx-3 mb-2"
        value={part}
        onChange={(v) => set({ side: v })}
        items={GROUPS.text}
      />
      <TextPanel part={part} />
    </>
  ) : (
    <TextLibrary />
  );
}

// Narrow: the camera tab holds CapCut's three, Camera | Speed | Animation, under it
function CameraTab() {
  const layer = useStudio((s) => s.layerPicks.length > 0);
  const side = useStudio((s) => s.side),
    part = layer
      ? "adjust"
      : side === "anim" || side === "speed" || side === "adjust"
        ? side
        : "cam";
  return (
    <>
      {!layer && (
        <Segmented
          label="Camera part"
          className="mx-3 mb-2"
          value={part}
          onChange={(v) => set({ side: v })}
          items={GROUPS.cam}
        />
      )}
      {part === "anim" ? (
        <AnimPanel />
      ) : part === "speed" ? (
        <SpeedPanel />
      ) : part === "adjust" ? (
        <AdjustPanel library />
      ) : (
        <CamPanel />
      )}
    </>
  );
}

export function Side({ wide }: { wide: boolean }) {
  const { sound, text, cam, keys, placed, open, check } = useParts(),
    side = useStudio((s) => s.side);
  const layer = useStudio((s) => s.layerPicks.length > 0);
  if (wide) return <Details />;
  const value =
    side === "anim" || side === "speed" || side === "adjust"
      ? "cam"
      : side === "textAnim"
        ? "text"
        : side === "voiceChanger" || side === "audioSpeed"
          ? "sound"
          : side;
  return (
    <aside className="sideways:row-span-3 bg-background upright:flex-1 upright:rounded-none sideways:rounded-none col-start-2 row-span-2 row-start-1 flex min-h-0 min-w-0 flex-col overflow-y-auto overscroll-contain rounded-lg in-data-review:hidden in-data-side-folded:hidden">
      <Compose />
      {sound || text || cam || keys || placed ? (
        <Tabs.Root
          value={value}
          onValueChange={(v) => set({ side: v as SideTab })}
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* Too many for the narrow column beside a phone's picture, the tabs scroll sideways as the timeline tools do; the
              line under them stays out of the fade, and the padding keeps the focus ring inside what the scroll clips */}
          <div className="bg-card flex-none">
            <Tabs.List
              aria-label="Panels"
              className={cn(
                tabs,
                "scroll-fade-x [scrollbar-width:none] justify-between gap-2 overflow-x-auto overscroll-x-contain border-b-0 py-0.5",
              )}
            >
              <Tabs.Tab value="notes" className={tab}>
                Notes
                <NotesCount open={open} check={check} />
              </Tabs.Tab>
              {sound && (
                <Tabs.Tab value="sound" className={tab}>
                  Audio
                </Tabs.Tab>
              )}
              {text && (
                <Tabs.Tab value="text" className={tab}>
                  Text
                </Tabs.Tab>
              )}
              {placed && (
                <Tabs.Tab value="objects" className={tab}>
                  Objects
                </Tabs.Tab>
              )}
              {cam && (
                <Tabs.Tab value="cam" className={tab}>
                  {layer ? "Adjustment" : "Camera"}
                </Tabs.Tab>
              )}
              {cam && (
                <Tabs.Tab value="transition" className={tab}>
                  Transitions
                </Tabs.Tab>
              )}
              {keys && (
                <Tabs.Tab value="keys" className={tab}>
                  Keyframes
                </Tabs.Tab>
              )}
              <Tabs.Tab value="film" className={tab}>
                Film
              </Tabs.Tab>
            </Tabs.List>
          </div>
          <Tabs.Panel value="notes" className="flex min-h-0 flex-1 flex-col">
            <NoteList />
          </Tabs.Panel>
          {sound && (
            <Tabs.Panel value="sound" className={panel}>
              <AudioTab />
            </Tabs.Panel>
          )}
          {text && (
            <Tabs.Panel value="text" className={panel}>
              <TextTab />
            </Tabs.Panel>
          )}
          {placed && (
            <Tabs.Panel value="objects" className={panel}>
              <ObjectsPanel />
            </Tabs.Panel>
          )}
          {cam && (
            <Tabs.Panel value="cam" className={panel}>
              <CameraTab />
            </Tabs.Panel>
          )}
          {cam && (
            <Tabs.Panel value="transition" className={panel}>
              <TransitionLibrary />
              <TransitionPanel />
            </Tabs.Panel>
          )}
          {keys && (
            <Tabs.Panel value="keys" className={panel}>
              <KeyPanel />
            </Tabs.Panel>
          )}
          <Tabs.Panel value="film" className="flex min-h-0 flex-1 flex-col">
            <OwnPanel />
          </Tabs.Panel>
        </Tabs.Root>
      ) : (
        <NoteList />
      )}
    </aside>
  );
}
