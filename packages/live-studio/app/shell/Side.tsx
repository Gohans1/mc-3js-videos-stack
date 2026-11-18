import {
  Blend,
  BookOpenText,
  Boxes,
  Clapperboard,
  type LucideIcon,
  MessageSquareText,
  Music2,
  Network,
  SlidersHorizontal,
  Terminal,
  Type,
} from "lucide-react";
import { Fragment, lazy, Suspense, useEffect, useRef, useSyncExternalStore } from "react";

// The panels beside the picture, laid out as CapCut's. On a wide screen the libraries are on the left (the note being written,
// then a toolbar of icons over their names: Notes, Audio, Text, Objects) and the details on the right, whose text tabs are those
// of what is selected, as CapCut's are: a clip, Audio; a text or shape, Text | Animation; an object, Object; keys, Keyframes; nothing (the camera, CapCut's main
// track), Camera, Speed and Animation for the shot or key picked, or on the playhead. Narrower, one column on the right (under
// the picture on an upright phone) holds both: the note being written, then a tab each for the notes, the sound, the objects,
// the text, the camera (Camera | Speed | Animation under it) and the keys, each with its details above its library.
import { Tabs } from "@/components/Tabs";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import { noteState } from "../../src/note-state.mjs";
import { useActivity } from "../activity/activity";
import { CamPanel } from "../camera/CamPanel";
import { CliPanel } from "../cli/CliPanel";
import { stopCliHotkeyPropagation, stopCliTabHotkeyPropagation } from "../cli/model";
import { Segmented } from "../components/inspector";
import { TabStage } from "../components/Motion";
import { set, studio, type StudioState, useStudio } from "../core/store";
import { NoteStatusGlyph } from "../notes/note-parts";
import { NoteList } from "../notes/NoteList";

const loadPanels = () => import("./LazyPanels");
const AdjustLibrary = lazy(() => loadPanels().then((m) => ({ default: m.AdjustLibrary })));
const AdjustPanel = lazy(() => loadPanels().then((m) => ({ default: m.AdjustPanel })));
const AnimPanel = lazy(() => loadPanels().then((m) => ({ default: m.AnimPanel })));
const TransitionLibrary = lazy(() => loadPanels().then((m) => ({ default: m.TransitionLibrary })));
const TransitionPanel = lazy(() => loadPanels().then((m) => ({ default: m.TransitionPanel })));
const KeyPanel = lazy(() => loadPanels().then((m) => ({ default: m.KeyPanel })));
const LessonsPanel = lazy(() => loadPanels().then((m) => ({ default: m.LessonsPanel })));
const ObjectsPanel = lazy(() => loadPanels().then((m) => ({ default: m.ObjectsPanel })));
const OwnPanel = lazy(() => loadPanels().then((m) => ({ default: m.OwnPanel })));
const PortsPanel = lazy(() => loadPanels().then((m) => ({ default: m.PortsPanel })));
const SoundPanel = lazy(() => loadPanels().then((m) => ({ default: m.SoundPanel })));
const TextLibrary = lazy(() => loadPanels().then((m) => ({ default: m.TextLibrary })));
const OpenFilmLibrary = lazy(() =>
  import("../openfilm/Library").then((m) => ({ default: m.OpenFilmLibrary })),
);
const TextPanel = lazy(() => loadPanels().then((m) => ({ default: m.TextPanel })));
const SpeedPanel = lazy(() => loadPanels().then((m) => ({ default: m.FilmSpeedPanel })));

type SideTab = StudioState["side"];
type Lib = StudioState["lib"];
const CORE_TABS = ["notes", "lessons", "film", "ports", "cli", "openfilm"] as const;
type CoreTab = (typeof CORE_TABS)[number];

// CapCut's text tabs: the open one in the accent. The bar under it slides via Tabs.Indicator
const tab =
  "relative flex h-10 upright:h-9 flex-none items-center gap-1.5 rounded-sm text-ui font-medium text-foreground/65 outline-none transition-colors duration-150 not-data-active:hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-active:text-primary-text motion-safe:active:scale-[0.96] pointer-coarse:h-11";
const coreTab =
  "px-2.5 upright:px-2 not-data-active:hover:text-foreground data-active:bg-tint data-active:text-foreground [&_svg]:size-3.5 data-active:[&_svg]:text-primary-text";
const isCore = (id: string): id is CoreTab => CORE_TABS.some((value) => value === id);
const tabs =
  "relative flex flex-none items-center gap-4 overflow-x-auto bg-card px-3 upright:gap-2 upright:px-2"; // CapCut's panel head: a lighter bar, no line under it
const panel = "mt-2 flex min-h-0 flex-1 flex-col";

function TabUnderline({
  inset = false,
  animated = true,
}: {
  inset?: boolean;
  animated?: boolean;
}) {
  return (
    <Tabs.Indicator
      aria-hidden
      className={cn(
        "tab-indicator pointer-events-none h-0.5",
        !animated && "transition-none",
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
// Switching between wide (Library + Details) and narrow (Side) keeps core tabs aligned
studio.subscribe((s, was) => {
  if (s.side !== was.side) {
    if (isCore(s.side) && s.lib !== s.side) set({ lib: s.side });
  } else if (s.lib !== was.lib) {
    if (isCore(s.lib) && s.side !== s.lib) set({ side: s.lib });
  }
});

const useParts = () => {
  const notes = useStudio((s) => s.notes);
  let open = 0,
    check = 0,
    asking = 0;
  for (const n of notes) {
    const st = noteState(n);
    if (st === "open") open++;
    else if (st === "check") {
      if (n.fixes?.at(-1)?.ask) asking++;
      else check++;
    }
  }
  return {
    sound: useStudio((s) => s.sound),
    text: useStudio((s) => s.text),
    cam: useStudio((s) => s.cam),
    keys: useStudio((s) => !!s.keyFiles?.length),
    placed: useStudio((s) => s.placed),
    open,
    check,
    asking,
  };
};
// Whether the film gives the studio anything to edit, so a wide screen has a details column to show
export const useEditable = () => {
  const p = useParts();
  return p.sound || p.text || p.cam || p.keys || p.placed;
};

// Pending notes ordered by triage urgency (To check amber · AI asks purple · To fix cyan) in one restrained obsidian counter pill
function NotesCount({ open, check, asking }: { open: number; check: number; asking: number }) {
  if (open <= 0 && check <= 0 && asking <= 0) return null;
  const parts: {
    key: "check" | "asking" | "open";
    textCls: string;
    count: number;
    label: string;
  }[] = [
    ...(check > 0
      ? [
          {
            key: "check" as const,
            textCls: "text-warn-text",
            count: check,
            label: `${check} to check`,
          },
        ]
      : []),
    ...(asking > 0
      ? [
          {
            key: "asking" as const,
            textCls: "text-ai-text",
            count: asking,
            label: `${asking} asking`,
          },
        ]
      : []),
    ...(open > 0
      ? [
          {
            key: "open" as const,
            textCls: "text-primary-text",
            count: open,
            label: `${open} to fix`,
          },
        ]
      : []),
  ];
  return (
    <span
      title={parts.map((p) => p.label).join(" · ")}
      className="bg-backdrop/90 text-tag border-hairline inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono leading-none tabular-nums"
    >
      {parts.map((p) => (
        <span
          key={p.key}
          className={cn(p.textCls, "inline-flex items-center gap-0.5 font-semibold")}
        >
          <NoteStatusGlyph
            state={p.key === "asking" ? "check" : p.key}
            asking={p.key === "asking"}
            className="size-2.5"
          />
          <span aria-hidden>{p.count}</span>
          <span className="sr-only">{p.label}</span>
        </span>
      ))}
    </span>
  );
}

const useAiTabs = () => {
  const enabled = useStudio((s) => s.aiActivity);
  const lit = useActivity((s) => s.lit);
  return (id: string, open: string, aliases: readonly string[] = []) => {
    const on = enabled &&
      (id !== open || (id !== "notes" && id !== "lessons")) &&
      [id, ...aliases].some((name) => `tab:${name}` in lit);
    return { "data-ai-lit": on || undefined, "aria-description": on ? "Recent activity" : undefined };
  };
};

// Wide: the left column. CapCut's toolbar: an icon over each library's name
const LIBS: { id: Lib; title: string; icon: LucideIcon }[] = [
  { id: "notes", title: "Notes", icon: MessageSquareText },
  { id: "lessons", title: "Lessons", icon: BookOpenText },
  { id: "sound", title: "Audio", icon: Music2 },
  { id: "ports", title: "Ports", icon: Network },
  { id: "cli", title: "CLI", icon: Terminal },
  { id: "film", title: "Film", icon: Clapperboard },
  { id: "text", title: "Text", icon: Type },
  { id: "openfilm", title: "Effects", icon: Blend },
  { id: "objects", title: "Objects", icon: Boxes },
  { id: "transition", title: "Transitions", icon: Blend },
  { id: "adjust", title: "Adjustment", icon: SlidersHorizontal },
];
const tool =
  "relative flex min-w-14 flex-col items-center gap-0.5 rounded-md px-2 pt-1.5 pb-1 text-xs text-muted-foreground outline-none transition-colors duration-150 not-data-active:hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-active:text-primary-text motion-safe:active:scale-[0.96] [&>svg]:size-5";
const coreTool =
  "data-active:bg-tint data-active:text-foreground data-active:[&>svg]:text-primary-text";
export function Library({ lessonsLockW = null }: { lessonsLockW?: number | null } = {}) {
  const { sound, text, cam, placed, open, check, asking } = useParts(),
    lib = useStudio((s) => s.lib),
    aiTab = useAiTabs();
  const notesTone = check > 0 ? "check" : asking > 0 ? "ai" : "open";
  const available = (id: Lib) =>
    isCore(id) ||
    (id === "sound"
      ? sound
      : id === "text"
        ? text
        : id === "transition" || id === "adjust"
          ? cam
          : placed);
  const value = available(lib) ? lib : "notes";
  return (
    <aside
      aria-label="Library"
      className="bg-background col-start-1 row-[1/-1] flex min-h-0 min-w-0 flex-col overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg in-data-cli-expanded:col-[1/-1] in-data-cli-expanded:row-[1/-1] in-data-lib-folded:hidden in-data-review:hidden"
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
            onKeyDown={stopCliTabHotkeyPropagation}
            className="scroll-fade-x relative flex [scrollbar-width:none] gap-1 overflow-x-auto overscroll-x-contain px-2 pt-1 pb-1"
          >
            <TabUnderline inset animated={false} />
            {LIBS.map((l) => (
              <Fragment key={l.id}>
                <Tabs.Tab
                  value={l.id}
                  disabled={!available(l.id)}
                  data-cli-tab={l.id === "cli" || undefined}
                  data-tone={l.id === "notes" ? notesTone : undefined}
                  {...aiTab(l.id, value)}
                  className={cn(tool, "flex-none", isCore(l.id) && coreTool)}
                >
                  <l.icon aria-hidden />
                  <span className="flex items-center gap-1">
                    {l.title}
                    {l.id === "notes" && <NotesCount open={open} check={check} asking={asking} />}
                  </span>
                </Tabs.Tab>
                {l.id === "cli" && LIBS.some((x) => !isCore(x.id)) && (
                  <Separator
                    orientation="vertical"
                    className="mx-1 h-7 data-vertical:self-center"
                  />
                )}
              </Fragment>
            ))}
          </Tabs.List>
        </div>
        <Tabs.Panel
          value={value}
          onKeyDown={value === "cli" ? stopCliHotkeyPropagation : undefined}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabStage
            activeKey={value}
            animated={value !== "notes" && value !== "cli"}
            order={LIBS.map((l) => l.id)}
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
            ) : value === "openfilm" ? (
              <OpenFilmLibrary />
            ) : value === "cli" ? (
              <CliPanel />
            ) : value === "ports" ? (
              <PortsPanel />
            ) : (
              <LessonsPanel desktop lockWidthPx={lessonsLockW} dock="start" />
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
  const aiTab = useAiTabs();
  const has: Record<Group, boolean> = {
    cam,
    transition: cam,
    adjustment: cam,
    sound,
    text,
    objects: placed,
    keys,
  };
  const picked = useStudio(groupOf),
    group = has[picked] ? picked : (Object.keys(has) as Group[]).find((g) => has[g])!;
  const list = GROUPS[group],
    value = list.some((x) => x.id === side) ? side : list[0].id;
  return (
    <aside
      aria-label="Details"
      className="bg-background col-start-3 row-span-2 row-start-1 flex min-h-0 min-w-0 flex-col overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg in-data-cli-expanded:hidden in-data-review:hidden in-data-side-folded:hidden"
    >
      <Tabs.Root
        value={value}
        onValueChange={(v) => set({ side: v as SideTab })}
        className="flex min-h-0 flex-1 flex-col"
      >
        <Tabs.List aria-label="Details" className={tabs}>
          <TabUnderline />
          {list.map((x) => (
            <Tabs.Tab key={x.id} value={x.id} {...aiTab(x.id, value)} className={tab}>
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
            <Suspense fallback={null}>
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
            </Suspense>
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
        <Suspense fallback={null}>
          <SoundPanel
            tab={part === "voiceChanger" ? "voice" : part === "audioSpeed" ? "speed" : "basic"}
          />
        </Suspense>
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
        <Suspense fallback={null}>
          <TextPanel part={part} />
        </Suspense>
      </TabStage>
    </>
  ) : (
    <Suspense fallback={null}>
      <TextLibrary />
    </Suspense>
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
        <Suspense fallback={null}>
          {part === "anim" ? (
            <AnimPanel />
          ) : part === "speed" ? (
            <SpeedPanel />
          ) : part === "adjust" ? (
            <AdjustPanel library />
          ) : (
            <CamPanel />
          )}
        </Suspense>
      </TabStage>
    </>
  );
}

export function Side({
  wide,
  desktop = true,
  lessonsLockW = null,
}: {
  wide: boolean;
  desktop?: boolean;
  lessonsLockW?: number | null;
}) {
  const { sound, text, cam, keys, placed, open, check, asking } = useParts(),
    side = useStudio((s) => s.side);
  const notesTone = check > 0 ? "check" : asking > 0 ? "ai" : "open";
  const layer = useStudio((s) => s.layerPicks.length > 0),
    aiTab = useAiTabs();
  const tabListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (wide) return;
    const list = tabListRef.current;
    if (!list) return;
    const keepSelectedVisible = () => {
      list
        .querySelector('[aria-selected="true"]')
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    keepSelectedVisible();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(keepSelectedVisible);
    ro.observe(list);
    return () => ro.disconnect();
  }, [wide, side, sound, text, cam, keys, placed]);
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
    isCore(raw) ||
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
    "sound",
    "ports",
    "cli",
    "film",
    "text",
    "openfilm",
    "objects",
    "keys",
    "transition",
    "cam",
  ];
  return (
    <aside
      aria-label="Side panels"
      className="sideways:row-span-3 bg-background upright:flex-1 upright:rounded-none sideways:rounded-none col-start-2 row-span-2 row-start-1 flex min-h-0 min-w-0 flex-col overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg in-data-cli-expanded:col-[1/-1] in-data-cli-expanded:row-[1/-1] in-data-cli-side:row-span-3 in-data-inspector-active:col-[1/-1] in-data-inspector-active:row-[1/-1] in-data-review:hidden in-data-side-folded:hidden in-data-[cli-expanded=library]:hidden"
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
            ref={tabListRef}
            aria-label="Panels"
            onKeyDown={stopCliTabHotkeyPropagation}
            className={cn(
              tabs,
              "scroll-fade-x [scrollbar-width:none] overflow-x-auto overscroll-x-contain border-b-0 py-0.5",
              editable && "justify-between gap-2",
            )}
          >
            <TabUnderline />
            <Tabs.Tab
              value="notes"
              data-tone={notesTone}
              {...aiTab("notes", value)}
              className={cn(tab, coreTab)}
            >
              <MessageSquareText aria-hidden />
              Notes
              <NotesCount open={open} check={check} asking={asking} />
            </Tabs.Tab>
            <Tabs.Tab
              value="lessons"
              {...aiTab("lessons", value)}
              className={cn(tab, coreTab)}
            >
              <BookOpenText aria-hidden />
              Lessons
            </Tabs.Tab>
            <Tabs.Tab value="sound" {...aiTab("sound", value)} disabled={!sound} className={tab}>
              Audio
            </Tabs.Tab>
            <Tabs.Tab value="ports" className={cn(tab, coreTab)}>
              <Network aria-hidden />
              Ports
            </Tabs.Tab>
            <Tabs.Tab value="cli" {...aiTab("cli", value)} data-cli-tab className={cn(tab, coreTab)}>
              <Terminal aria-hidden />
              CLI
            </Tabs.Tab>
            {(sound || text || placed || keys || cam) && (
              <Separator orientation="vertical" className="mx-0.5 h-5 data-vertical:self-center" />
            )}
            <Tabs.Tab value="film" {...aiTab("film", value)} className={cn(tab, coreTab)}>
              <Clapperboard aria-hidden />
              Film
            </Tabs.Tab>
            <Tabs.Tab value="text" {...aiTab("text", value)} disabled={!text} className={tab}>
              Text
            </Tabs.Tab>
            <Tabs.Tab value="openfilm" {...aiTab("openfilm", value)} className={tab}>
              Effects
            </Tabs.Tab>
            <Tabs.Tab value="objects" {...aiTab("objects", value)} disabled={!placed} className={tab}>
              Objects
            </Tabs.Tab>
            <Tabs.Tab value="keys" {...aiTab("keys", value)} disabled={!keys} className={tab}>
              Keyframes
            </Tabs.Tab>
            <Tabs.Tab value="transition" {...aiTab("transition", value)} disabled={!cam} className={tab}>
              Transitions
            </Tabs.Tab>
            <Tabs.Tab value="cam" {...aiTab("cam", value, ["speed", "adjust", "anim"])} disabled={!cam} className={tab}>
              {layer ? "Adjustment" : "Camera"}
            </Tabs.Tab>
          </Tabs.List>
        </div>
        <Tabs.Panel
          value={value}
          onKeyDown={value === "cli" ? stopCliHotkeyPropagation : undefined}
          className={isCore(value) ? "flex min-h-0 flex-1 flex-col" : panel}
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
            ) : value === "openfilm" ? (
              <OpenFilmLibrary />
            ) : value === "cli" ? (
              <CliPanel />
            ) : value === "ports" ? (
              <PortsPanel />
            ) : (
              <LessonsPanel desktop={desktop} lockWidthPx={lessonsLockW} dock="end" />
            )}
          </TabStage>
        </Tabs.Panel>
      </Tabs.Root>
    </aside>
  );
}
