// The panels beside the picture, laid out as CapCut's. On a wide screen the libraries are on the left (the note being written,
// then a toolbar of icons over their names: Notes, Audio, Text, Objects) and the details on the right, whose text tabs are those
// of what is selected, as CapCut's are: a clip, Audio; a text or shape, Text | Animation; an object, Object; keys, Keyframes; nothing (the camera, CapCut's main
// track), Camera, Speed and Animation for the shot or key picked, or on the playhead. Narrower, one column on the right (under
// the picture on an upright phone) holds both: the note being written, then a tab each for the notes, the sound, the objects,
// the text, the camera (Camera | Speed | Animation under it) and the keys, each with its details above its library.
import { Tabs } from "@base-ui/react/tabs";
import {
  Blend,
  BookOpenText,
  Boxes,
  Clapperboard,
  type LucideIcon,
  MessageSquareText,
  Music2,
  SlidersHorizontal,
  Type,
} from "lucide-react";
import { Fragment, useSyncExternalStore } from "react";

import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import { noteState } from "../../src/note-state.mjs";
import { useActivity } from "../activity/activity";
import { AdjustLibrary } from "../camera/AdjustLibrary";
import { AdjustPanel } from "../camera/AdjustPanel";
import { AnimPanel } from "../camera/AnimPanel";
import { CamPanel } from "../camera/CamPanel";
import { TransitionLibrary } from "../camera/TransitionLibrary";
import { TransitionPanel } from "../camera/TransitionPanel";
import { Segmented } from "../components/inspector";
import { TabStage } from "../components/Motion";
import { set, studio, type StudioState, useStudio } from "../core/store";
import { KeyPanel } from "../keys/KeyPanel";
import { LessonsPanel } from "../lessons/LessonsPanel";
import { NoteList } from "../notes/NoteList";
import { ObjectsPanel } from "../objects/ObjectsPanel";
import { OwnPanel } from "../own/OwnPanel";
import { SoundPanel } from "../sound/SoundPanel";
import { TextLibrary } from "../text/TextLibrary";
import { TextPanel } from "../text/TextPanel";
import { FilmSpeedPanel as SpeedPanel } from "../timeline/FilmSpeedPanel";

type SideTab = StudioState["side"];
type Lib = StudioState["lib"];

// CapCut's text tabs: the open one in the accent. The bar under it slides via Tabs.Indicator
const tab =
  "relative flex h-10 flex-none items-center gap-1.5 rounded-sm text-ui font-medium text-muted-foreground outline-none transition duration-150 not-data-active:hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-active:text-primary-text motion-safe:active:scale-[0.97] pointer-coarse:h-11";
const coreTab =
  "border border-primary/25 bg-tint/75 px-2.5 text-foreground/95 not-data-active:hover:bg-tint data-active:bg-tint data-active:text-primary-text [&_svg]:size-3.5 [&_svg]:text-primary";
const isCore = (id: string) => id === "notes" || id === "lessons";
const tabs = "relative flex flex-none items-center gap-4 overflow-x-auto bg-card px-3"; // CapCut's panel head: a lighter bar, no line under it
const panel = "mt-2 flex min-h-0 flex-1 flex-col";

function TabUnderline({ inset = false }: { inset?: boolean }) {
  return (
    <Tabs.Indicator
      aria-hidden
      className={cn(
        "tab-indicator pointer-events-none h-0.5",
        inset ? "px-2.5" : "bg-primary rounded-full",
      )}
    >
      {inset && <span className="bg-primary block size-full rounded-full" />}
    </Tabs.Indicator>
  );
}

const WIDE = matchMedia("(min-width: 1280px) and (min-height: 640px)");
export const useWide = () =>
  useSyncExternalStore(
    (f) => {
      WIDE.addEventListener("change", f);
      return () => WIDE.removeEventListener("change", f);
    },
    () => WIDE.matches,
  );
// Switching between wide (Library + Details) and narrow (Side) keeps core Notes/Lessons tabs aligned
studio.subscribe((s, was) => {
  if (s.side !== was.side) {
    if ((s.side === "notes" || s.side === "lessons") && s.lib !== s.side) set({ lib: s.side });
  } else if (s.lib !== was.lib) {
    if ((s.lib === "notes" || s.lib === "lessons") && s.side !== s.lib) set({ side: s.lib });
  }
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
          className="bg-warn text-warn-foreground rounded-full px-1.5 text-xs leading-4 font-semibold tabular-nums"
          aria-label={`, ${check} to check`}
        >
          {check}
        </span>
      )}
    </>
  );
}

// A tab lit while the AI is at a note or lesson file under it (activity/activity.ts), unless it is the tab open: then the card
// or the file itself is lit
const useAiTabs = () => {
  const lit = useActivity((s) => s.lit);
  return (id: string, open: string) => (id !== open && `tab:${id}` in lit) || undefined;
};

// Wide: the left column. CapCut's toolbar: an icon over each library's name
const LIBS: { id: Lib; title: string; icon: LucideIcon }[] = [
  { id: "notes", title: "Notes", icon: MessageSquareText },
  { id: "lessons", title: "Lessons", icon: BookOpenText },
  { id: "film", title: "Film", icon: Clapperboard },
  { id: "sound", title: "Audio", icon: Music2 },
  { id: "text", title: "Text", icon: Type },
  { id: "objects", title: "Objects", icon: Boxes },
  { id: "transition", title: "Transitions", icon: Blend },
  { id: "adjust", title: "Adjustment", icon: SlidersHorizontal },
];
const tool =
  "relative flex min-w-14 flex-col items-center gap-0.5 rounded-md px-2 pt-1.5 pb-1 text-xs text-muted-foreground outline-none transition duration-150 not-data-active:hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-active:text-primary-text motion-safe:active:scale-[0.97] [&_svg]:size-5";
const coreTool =
  "border border-primary/25 bg-tint/75 text-foreground/90 not-data-active:hover:bg-tint data-active:bg-tint data-active:text-primary-text [&_svg]:text-primary";
export function Library() {
  const { sound, text, cam, placed, open, check } = useParts(),
    lib = useStudio((s) => s.lib),
    aiTab = useAiTabs();
  const shown = LIBS.filter(
    (l) =>
      l.id === "notes" ||
      l.id === "film" ||
      l.id === "lessons" ||
      (l.id === "sound"
        ? sound
        : l.id === "text"
          ? text
          : l.id === "transition" || l.id === "adjust"
            ? cam
            : placed),
  );
  const value = shown.some((l) => l.id === lib) ? lib : "notes";
  return (
    <aside
      aria-label="Library"
      className="bg-background col-start-1 row-[1/-1] flex min-h-0 min-w-0 flex-col overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg in-data-lib-folded:hidden in-data-review:hidden"
    >
      <Tabs.Root
        value={value}
        onValueChange={(v) => set({ lib: v as Lib })}
        className="flex min-h-0 flex-1 flex-col"
      >
        {/* More tools than a narrow column holds scroll sideways, the fade saying there are more (the card stays under it) */}
        <div className="bg-card flex-none">
          <Tabs.List
            aria-label="Libraries"
            className="scroll-fade-x relative flex [scrollbar-width:none] gap-1 overflow-x-auto overscroll-x-contain px-2 pt-1 pb-1"
          >
            <TabUnderline inset />
            {shown.map((l) => (
              <Fragment key={l.id}>
                <Tabs.Tab
                  value={l.id}
                  data-ai-lit={aiTab(l.id, value)}
                  className={cn(tool, "flex-none", isCore(l.id) && coreTool)}
                >
                  <l.icon aria-hidden />
                  <span className="flex items-center gap-1">
                    {l.title}
                    {l.id === "notes" && <NotesCount open={open} check={check} />}
                  </span>
                </Tabs.Tab>
                {l.id === "lessons" && shown.length > 2 && (
                  <Separator
                    orientation="vertical"
                    className="mx-1 h-7 data-vertical:self-center"
                  />
                )}
              </Fragment>
            ))}
          </Tabs.List>
        </div>
        <Tabs.Panel value={value} className="flex min-h-0 flex-1 flex-col">
          <TabStage
            activeKey={value}
            order={shown.map((l) => l.id)}
            className="relative flex min-h-0 flex-1 flex-col"
          >
            {value === "notes" ? (
              <NoteList composeDock />
            ) : value === "sound" && sound ? (
              <SoundPanel part="library" />
            ) : value === "text" && text ? (
              <div className={panel}>
                <TextLibrary />
              </div>
            ) : value === "objects" && placed ? (
              <div className={panel}>
                <ObjectsPanel part="library" />
              </div>
            ) : value === "transition" && cam ? (
              <div className={panel}>
                <TransitionLibrary />
              </div>
            ) : value === "adjust" && cam ? (
              <div className={panel}>
                <AdjustLibrary />
              </div>
            ) : value === "film" ? (
              <OwnPanel />
            ) : (
              <LessonsPanel />
            )}
          </TabStage>
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
      className="bg-background col-start-3 row-span-2 row-start-1 flex min-h-0 min-w-0 flex-col overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg in-data-review:hidden in-data-side-folded:hidden"
    >
      <Tabs.Root
        value={value}
        onValueChange={(v) => set({ side: v as SideTab })}
        className="flex min-h-0 flex-1 flex-col"
      >
        <Tabs.List aria-label="Details" className={tabs}>
          <TabUnderline />
          {list.map((x) => (
            <Tabs.Tab key={x.id} value={x.id} className={tab}>
              {x.title}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel value={value} className={panel}>
          <TabStage
            activeKey={value}
            order={list.map((x) => x.id)}
            className="flex min-h-0 flex-1 flex-col"
          >
            {value === "sound" || value === "voiceChanger" || value === "audioSpeed" ? (
              <SoundPanel
                part="clip"
                tab={
                  value === "voiceChanger" ? "voice" : value === "audioSpeed" ? "speed" : "basic"
                }
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
          </TabStage>
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
      <TabStage
        activeKey={part}
        order={GROUPS.sound.map((x) => x.id)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <SoundPanel
          tab={part === "voiceChanger" ? "voice" : part === "audioSpeed" ? "speed" : "basic"}
        />
      </TabStage>
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
      <TabStage
        activeKey={part}
        order={GROUPS.text.map((x) => x.id)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TextPanel part={part} />
      </TabStage>
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
      <TabStage
        activeKey={part}
        order={GROUPS.cam.map((x) => x.id)}
        className="flex min-h-0 flex-1 flex-col"
      >
        {part === "anim" ? (
          <AnimPanel />
        ) : part === "speed" ? (
          <SpeedPanel />
        ) : part === "adjust" ? (
          <AdjustPanel library />
        ) : (
          <CamPanel />
        )}
      </TabStage>
    </>
  );
}

export function Side({ wide }: { wide: boolean }) {
  const { sound, text, cam, keys, placed, open, check } = useParts(),
    side = useStudio((s) => s.side);
  const layer = useStudio((s) => s.layerPicks.length > 0),
    aiTab = useAiTabs();
  if (wide) return <Details />;
  const editable = sound || text || cam || keys || placed;
  const raw =
    side === "anim" || side === "speed" || side === "adjust"
      ? "cam"
      : side === "textAnim"
        ? "text"
        : side === "voiceChanger" || side === "audioSpeed"
          ? "sound"
          : side;
  const shown =
    raw === "notes" ||
    raw === "film" ||
    raw === "lessons" ||
    (raw === "sound"
      ? sound
      : raw === "text"
        ? text
        : raw === "objects"
          ? placed
          : raw === "keys"
            ? keys
            : cam);
  const value = shown ? raw : "notes";
  const sideOrder: SideTab[] = [
    "notes",
    "lessons",
    "film",
    "sound",
    "text",
    "objects",
    "keys",
    "transition",
    "cam",
  ];
  return (
    <aside
      aria-label="Panels"
      className="sideways:row-span-3 bg-background upright:flex-1 upright:rounded-none sideways:rounded-none col-start-2 row-span-2 row-start-1 flex min-h-0 min-w-0 flex-col overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg in-data-review:hidden in-data-side-folded:hidden"
    >
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
              "scroll-fade-x [scrollbar-width:none] overflow-x-auto overscroll-x-contain border-b-0 py-0.5",
              editable && "justify-between gap-2",
            )}
          >
            <TabUnderline />
            <Tabs.Tab
              value="notes"
              data-ai-lit={aiTab("notes", value)}
              className={cn(tab, coreTab)}
            >
              <MessageSquareText aria-hidden />
              Notes
              <NotesCount open={open} check={check} />
            </Tabs.Tab>
            <Tabs.Tab
              value="lessons"
              data-ai-lit={aiTab("lessons", value)}
              className={cn(tab, coreTab)}
            >
              <BookOpenText aria-hidden />
              Lessons
            </Tabs.Tab>
            <Separator orientation="vertical" className="mx-0.5 h-5 data-vertical:self-center" />
            <Tabs.Tab value="film" className={tab}>
              Film
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
            {keys && (
              <Tabs.Tab value="keys" className={tab}>
                Keyframes
              </Tabs.Tab>
            )}
            {cam && (
              <Tabs.Tab value="transition" className={tab}>
                Transitions
              </Tabs.Tab>
            )}
            {cam && (
              <Tabs.Tab value="cam" className={tab}>
                {layer ? "Adjustment" : "Camera"}
              </Tabs.Tab>
            )}
          </Tabs.List>
        </div>
        <Tabs.Panel
          value={value}
          className={
            value === "notes" || value === "film" || value === "lessons"
              ? "flex min-h-0 flex-1 flex-col"
              : panel
          }
        >
          <TabStage
            activeKey={value}
            order={sideOrder}
            className="relative flex min-h-0 flex-1 flex-col"
          >
            {value === "notes" ? (
              <NoteList composeDock />
            ) : value === "sound" && sound ? (
              <AudioTab />
            ) : value === "text" && text ? (
              <TextTab />
            ) : value === "objects" && placed ? (
              <ObjectsPanel />
            ) : value === "cam" && cam ? (
              <CameraTab />
            ) : value === "transition" && cam ? (
              <>
                <TransitionLibrary />
                <TransitionPanel />
              </>
            ) : value === "keys" && keys ? (
              <KeyPanel />
            ) : value === "film" ? (
              <OwnPanel />
            ) : (
              <LessonsPanel />
            )}
          </TabStage>
        </Tabs.Panel>
      </Tabs.Root>
    </aside>
  );
}
