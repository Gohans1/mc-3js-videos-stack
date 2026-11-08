// The panels beside the picture, laid out as CapCut's. On a wide screen the libraries are on the left (the note being written,
// then a toolbar of icons over their names: Notes, Audio, Objects) and the details on the right, whose text tabs are those of
// what is selected, as CapCut's are: a clip, Audio; an object, Object; keys, Keyframes; nothing (the camera, CapCut's main
// track), Camera, Speed and Animation for the shot or key picked, or on the playhead. Narrower, one column on the right (under
// the picture on an upright phone) holds both: the note being written, then a tab each for the notes, the sound, the objects,
// the camera (Camera | Speed | Animation under it) and the keys, each with its details above its library.
import { Tabs } from "@base-ui/react/tabs";
import { cn } from "cn";
import { Boxes, type LucideIcon, MessageSquareText, Music2 } from "lucide-react";
import { useSyncExternalStore } from "react";
import { AnimPanel } from "../camera/AnimPanel";
import { CamPanel } from "../camera/CamPanel";
import { SpeedPanel } from "../camera/SpeedPanel";
import { Segmented } from "../components/inspector";
import { type StudioState, set, studio, useStudio } from "../core/store";
import { KeyPanel } from "../keys/KeyPanel";
import { Compose } from "../notes/Compose";
import { NoteList } from "../notes/NoteList";
import { ObjectsPanel } from "../objects/ObjectsPanel";
import { SoundPanel } from "../sound/SoundPanel";

type SideTab = StudioState["side"];
type Lib = StudioState["lib"];

// CapCut's text tabs: the open one in the accent. The bar under it is ours (dev's call): the color alone is hard to see at a glance
const tab = "relative flex h-10 flex-none items-center gap-1.5 rounded-sm text-[13px] font-medium text-muted-foreground outline-none not-data-active:hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-active:text-primary data-active:after:absolute data-active:after:inset-x-0 data-active:after:bottom-0 data-active:after:h-0.5 data-active:after:rounded-full data-active:after:bg-primary pointer-coarse:h-11";
const tabs = "flex flex-none items-center gap-5 border-b px-3";
const panel = "mt-2 flex min-h-0 flex-1 flex-col";

const WIDE = matchMedia("(min-width: 1280px) and (min-height: 640px)");
export const useWide = () => useSyncExternalStore((f) => { WIDE.addEventListener("change", f); return () => WIDE.removeEventListener("change", f); }, () => WIDE.matches);
// A note opened (a pin, N) shows the notes in the left column too
studio.subscribe((s, was) => { if (s.side === "notes" && was.side !== "notes") set({ lib: "notes" }); });

const useParts = () => ({
  sound: useStudio((s) => s.sound), cam: useStudio((s) => s.cam), keys: useStudio((s) => !!s.keyFiles?.length), placed: useStudio((s) => s.placed),
  open: useStudio((s) => s.notes.filter((n) => !n.done).length),
});
// Whether the film gives the studio anything to edit, so a wide screen has a details column to show
export const useEditable = () => { const p = useParts(); return p.sound || p.cam || p.keys || p.placed; };

function NotesCount({ open }: { open: number }) {
  return open > 0 ? <span className="tabular-nums text-primary" aria-label={`, ${open} open`}>{open}</span> : null;
}

// Wide: the left column. CapCut's toolbar: an icon over each library's name
const LIBS: { id: Lib; title: string; icon: LucideIcon }[] = [
  { id: "notes", title: "Notes", icon: MessageSquareText },
  { id: "sound", title: "Audio", icon: Music2 },
  { id: "objects", title: "Objects", icon: Boxes },
];
const tool = "relative flex min-w-14 flex-col items-center gap-0.5 rounded-md px-2 pt-1.5 pb-1 text-xs text-muted-foreground outline-none not-data-active:hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-active:text-primary data-active:after:absolute data-active:after:inset-x-3 data-active:after:-bottom-1 data-active:after:h-0.5 data-active:after:rounded-full data-active:after:bg-primary [&_svg]:size-5";
export function Library() {
  const { sound, placed, open } = useParts(), lib = useStudio((s) => s.lib);
  const shown = LIBS.filter((l) => l.id === "notes" || (l.id === "sound" ? sound : placed));
  return (
    <aside aria-label="Library" className="col-start-1 row-span-2 row-start-1 flex min-h-0 min-w-0 flex-col border-e in-data-lib-folded:hidden">
      <Compose />
      <Tabs.Root value={lib} onValueChange={(v) => set({ lib: v as Lib })} className="flex min-h-0 flex-1 flex-col">
        <Tabs.List aria-label="Libraries" className="flex flex-none gap-1 border-b px-2 pt-1 pb-1">
          {shown.map((l) => (
            <Tabs.Tab key={l.id} value={l.id} className={tool}>
              <l.icon aria-hidden />
              <span className="flex items-center gap-1">{l.title}{l.id === "notes" && <NotesCount open={open} />}</span>
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel value="notes" className="flex min-h-0 flex-1 flex-col"><NoteList /></Tabs.Panel>
        {sound && <Tabs.Panel value="sound" className={panel}><SoundPanel part="library" /></Tabs.Panel>}
        {placed && <Tabs.Panel value="objects" className={panel}><ObjectsPanel part="library" /></Tabs.Panel>}
      </Tabs.Root>
    </aside>
  );
}

// Wide: the right column, CapCut's details: the tabs of what is selected
type Group = "sound" | "objects" | "keys" | "cam";
const GROUPS: Record<Group, { id: SideTab; title: string }[]> = {
  sound: [{ id: "sound", title: "Audio" }],
  objects: [{ id: "objects", title: "Object" }],
  keys: [{ id: "keys", title: "Keyframes" }],
  cam: [{ id: "cam", title: "Camera" }, { id: "speed", title: "Speed" }, { id: "anim", title: "Animation" }],
};
const groupOf = (s: StudioState): Group => (s.clips.length ? "sound" : s.object ? "objects" : s.keyPicks.length ? "keys" : "cam");
function Details() {
  const { sound, cam, keys, placed } = useParts(), side = useStudio((s) => s.side);
  const has: Record<Group, boolean> = { sound, objects: placed, keys, cam };
  const picked = useStudio(groupOf), group = has[picked] ? picked : (Object.keys(has) as Group[]).find((g) => has[g])!;
  const list = GROUPS[group], value = list.some((x) => x.id === side) ? side : list[0].id;
  return (
    <aside aria-label="Details" className="col-start-3 row-span-2 row-start-1 flex min-h-0 min-w-0 flex-col border-s in-data-side-folded:hidden">
      <Tabs.Root value={value} onValueChange={(v) => set({ side: v as SideTab })} className="flex min-h-0 flex-1 flex-col">
        <Tabs.List aria-label="Details" className={tabs}>
          {list.map((x) => <Tabs.Tab key={x.id} value={x.id} className={tab}>{x.title}</Tabs.Tab>)}
        </Tabs.List>
        <Tabs.Panel value={value} className={panel}>
          {value === "sound" ? <SoundPanel part="clip" /> : value === "objects" ? <ObjectsPanel part="object" /> : value === "keys" ? <KeyPanel /> : value === "anim" ? <AnimPanel /> : value === "speed" ? <SpeedPanel /> : <CamPanel />}
        </Tabs.Panel>
      </Tabs.Root>
    </aside>
  );
}

// Narrow: the camera tab holds CapCut's three, Camera | Speed | Animation, under it
function CameraTab() {
  const side = useStudio((s) => s.side), part = side === "anim" || side === "speed" ? side : "cam";
  return (
    <>
      <Segmented label="Camera part" className="mx-3 mb-2" value={part} onChange={(v) => set({ side: v })} items={GROUPS.cam} />
      {part === "anim" ? <AnimPanel /> : part === "speed" ? <SpeedPanel /> : <CamPanel />}
    </>
  );
}

export function Side({ wide }: { wide: boolean }) {
  const { sound, cam, keys, placed, open } = useParts(), side = useStudio((s) => s.side);
  if (wide) return <Details />;
  const value = side === "anim" || side === "speed" ? "cam" : side;
  return (
    <aside className="col-start-2 row-span-2 row-start-1 flex sideways:row-span-3 min-h-0 min-w-0 flex-col border-s in-data-side-folded:hidden upright:flex-1 upright:border-s-0">
      <Compose />
      {sound || cam || keys || placed ? (
        <Tabs.Root value={value} onValueChange={(v) => set({ side: v as SideTab })} className="flex min-h-0 flex-1 flex-col">
          {/* Too many for the narrow column beside a phone's picture, the tabs scroll sideways as the timeline tools do; the
              line under them stays out of the fade, and the padding keeps the focus ring inside what the scroll clips */}
          <div className="flex-none border-b">
            <Tabs.List aria-label="Panels" className={cn(tabs, "justify-between gap-2 overflow-x-auto overscroll-x-contain border-b-0 py-0.5 [scrollbar-width:none] scroll-fade-x")}>
              <Tabs.Tab value="notes" className={tab}>Notes<NotesCount open={open} /></Tabs.Tab>
              {sound && <Tabs.Tab value="sound" className={tab}>Audio</Tabs.Tab>}
              {placed && <Tabs.Tab value="objects" className={tab}>Objects</Tabs.Tab>}
              {cam && <Tabs.Tab value="cam" className={tab}>Camera</Tabs.Tab>}
              {keys && <Tabs.Tab value="keys" className={tab}>Keyframes</Tabs.Tab>}
            </Tabs.List>
          </div>
          <Tabs.Panel value="notes" className="flex min-h-0 flex-1 flex-col"><NoteList /></Tabs.Panel>
          {sound && <Tabs.Panel value="sound" className={panel}><SoundPanel /></Tabs.Panel>}
          {placed && <Tabs.Panel value="objects" className={panel}><ObjectsPanel /></Tabs.Panel>}
          {cam && <Tabs.Panel value="cam" className={panel}><CameraTab /></Tabs.Panel>}
          {keys && <Tabs.Panel value="keys" className={panel}><KeyPanel /></Tabs.Panel>}
        </Tabs.Root>
      ) : <NoteList />}
    </aside>
  );
}
