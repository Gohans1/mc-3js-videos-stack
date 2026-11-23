import {
  Aperture,
  Bot,
  Camera,
  Copy,
  Cpu,
  Film,
  Keyboard,
  Layers,
  ListTree,
  type LucideIcon,
  Move3d,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  Video,
  X,
} from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { Slider } from "@/components/Slider";
import { Tabs } from "@/components/Tabs";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import { type Ratio, RATIOS } from "../../src/frame.ts";
import { armActivityChime } from "../activity/chime";
import { copyCam } from "../camera/camline";
import { HelpTip } from "../components/HelpTip";
import { TabStage } from "../components/Motion";
import { Tip } from "../components/Tip";
import { AWAY } from "../core/device";
import { setAutoSave } from "../core/doc";
import { engine } from "../core/engine";
import { FLY_SPEED } from "../core/prefs";
import { S } from "../core/state";
import { set, setPref, useStudio } from "../core/store";
import { FPS, rangeText } from "../core/time";
import { copyAll } from "../notes/notes";
import { choose, pinPick, setGain, whereNext } from "../options/options";
import { GUIDE_MODES, type GuideMode } from "../picture/director-eye";
import { frameSize, setRatio } from "../picture/frame";
import { FreeCamLensFields } from "../picture/FreeCamLens";
import { exportStill } from "../picture/still";
import { jumpShot, seek, setPlaying } from "../playback/transport";
import { resumeAudio } from "../sound/clock";
import { zoomSpan } from "../timeline/timeline";
import { DirectorEyeSettings } from "./DirectorEyeSettings";
import { Speed } from "./Speed";

type SettingsTabId = "view" | "camera" | "ai" | "render";
type AccentTone = "primary" | "ai" | "warn" | "neutral";

const SETTINGS_TABS: readonly {
  id: SettingsTabId;
  label: string;
  icon: LucideIcon;
  accent: AccentTone;
}[] = [
  { id: "view", label: "View", icon: SlidersHorizontal, accent: "primary" },
  { id: "camera", label: "Camera", icon: Video, accent: "primary" },
  { id: "ai", label: "AI & Save", icon: Bot, accent: "ai" },
  { id: "render", label: "Render & Keys", icon: Keyboard, accent: "warn" },
];

const TAB_ORDER: readonly SettingsTabId[] = SETTINGS_TABS.map((t) => t.id);

const ACCENT_ICON_CLASS: Record<AccentTone, string> = {
  primary: "text-primary-text",
  ai: "text-ai-text",
  warn: "text-warn-text",
  neutral: "text-label",
};

const Keys = ({ keys }: { keys: string[] }) => (
  <span aria-hidden className="inline-flex items-center gap-0.5 pointer-coarse:hidden">
    {keys.map((k) => (
      <Kbd key={k}>{k}</Kbd>
    ))}
  </span>
);

function SettingCard({
  title,
  icon: Icon,
  accent = "primary",
  help,
  right,
  children,
  rows,
  warn,
  className,
}: {
  title: ReactNode;
  icon?: LucideIcon;
  accent?: AccentTone;
  help?: [string, string];
  right?: ReactNode;
  children: ReactNode;
  rows?: boolean;
  warn?: boolean;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex min-h-6 items-center justify-between gap-2 px-1">
        <h3
          className={cn(
            "text-ui flex items-center gap-1.5 leading-snug font-semibold",
            warn ? "text-warn-text" : "text-foreground/95",
          )}
        >
          {Icon && (
            <Icon
              size={14}
              strokeWidth={2}
              absoluteStrokeWidth
              aria-hidden
              className={cn("shrink-0", ACCENT_ICON_CLASS[warn ? "warn" : accent])}
            />
          )}
          <span className="flex items-center gap-1.5">{title}</span>
          {help && <HelpTip label={help[0]}>{help[1]}</HelpTip>}
        </h3>
        {right}
      </div>
      <div
        className={cn(
          "overflow-hidden rounded-xl border",
          warn ? "border-warn/30 bg-warn-bg/85" : "border-hairline-subtle bg-card",
          rows
            ? warn
              ? "divide-warn/15 divide-y"
              : "divide-hairline-subtle divide-y"
            : "flex flex-col gap-2.5 p-3",
        )}
      >
        {children}
      </div>
    </section>
  );
}

function SwitchRow({
  id,
  label,
  keys,
  help,
  description,
  highlight,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  keys?: string[];
  help?: string;
  description?: string;
  highlight?: boolean;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "px-3 py-1 transition-colors duration-100 motion-reduce:transition-none",
        highlight ? "bg-warn-card/70 hover:bg-warn-card" : "hover:bg-surface-subtle",
      )}
    >
      <Field orientation="horizontal" className="min-h-10 justify-between">
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <FieldLabel htmlFor={id} variant="row" className="min-h-8 cursor-pointer">
              {label}
              {keys && <Keys keys={keys} />}
            </FieldLabel>
            {help && <HelpTip label={label}>{help}</HelpTip>}
          </span>
          {description && (
            <p className="text-label text-ui leading-normal text-pretty">{description}</p>
          )}
        </div>
        <Switch id={id} checked={checked} onCheckedChange={onChange} />
      </Field>
    </div>
  );
}

const Row = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div
    className={cn(
      "hover:bg-surface-subtle flex min-h-11 items-center justify-between gap-3 px-3 py-1.5 transition-colors duration-100 motion-reduce:transition-none",
      className,
    )}
  >
    {children}
  </div>
);

function Options() {
  const groups = useStudio((s) => s.groups),
    groupName = useStudio((s) => s.groupName);
  const g = groups.find((x) => x.name === groupName);
  if (!g) return null;
  const items = groups.map((x) => ({ value: x.name, label: x.title }));
  const r = g.ranges;
  const go = () => {
    const at = whereNext(g.name);
    if (at === null) return;
    resumeAudio();
    seek(at);
    if (!S.playing) setPlaying(true);
  };
  return (
    <SettingCard
      title={
        <>
          Alternatives{" "}
          <span aria-hidden className="inline-flex items-center gap-0.5 pointer-coarse:hidden">
            <Kbd>0</Kbd>–<Kbd>9</Kbd>
          </span>
        </>
      }
      icon={Layers}
      accent="primary"
      help={[
        "Alternatives",
        "Each group is a prop or a sound with several versions. Pick one to see or hear it at once. Use makes the film, final render included, keep it (saved to choices.json). Off removes the sound or hides the prop.",
      ]}
    >
      <Select
        items={items}
        value={groupName}
        onValueChange={(v) => {
          set({ groupName: v as string });
          S.dirty = true;
        }}
      >
        <SelectTrigger size="readable" className="w-full" aria-label="Group">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex flex-col gap-1">
        {g.options.map((o, i) => (
          <Button
            key={o.id}
            variant="choice"
            size="row"
            aria-pressed={o.id === g.pick}
            title={o.source}
            onClick={() => choose(g.name, i)}
          >
            <span>
              {i} {o.off ? "Off" : o.title}
            </span>
            {o.id === g.chosen && (
              <span className="text-warn-text text-xs font-semibold whitespace-nowrap">in use</span>
            )}
          </Button>
        ))}
      </div>
      <p className="text-label text-ui leading-normal tabular-nums">
        {r.length
          ? `${g.picture ? "On screen" : "Plays"} at ${r.slice(0, 4).map(rangeText).join(", ")}${r.length > 4 ? ` and ${r.length - 4} more` : ""}`
          : "Never on screen"}
      </p>
      <div className="flex items-center gap-1.5">
        {!g.picture && (
          <>
            <div className="flex h-9 min-w-0 flex-1 items-center" title="Volume">
              <Slider
                min={0}
                max={2}
                step={0.05}
                value={g.gain}
                onValueChange={(v: number | readonly number[]) =>
                  setGain(g.name, typeof v === "number" ? v : v[0])
                }
                aria-label="Preview volume"
                format={{ style: "percent" }}
              />
            </div>
            <span className="text-label text-ui min-w-[4ch] text-end tabular-nums">
              {Math.round(g.gain * 100)}%
            </span>
          </>
        )}
        <Tip
          label={
            g.picture ? "Jump to where it's on screen and play" : "Jump to where it plays and play"
          }
        >
          <Button variant="secondary" size="lg" className={g.picture ? "flex-1" : ""} onClick={go}>
            {g.picture ? "Show" : "Listen"}
          </Button>
        </Tip>
        <Tip label="Use this version in the film">
          <Button size="lg" onClick={() => pinPick(g.name)}>
            Use
          </Button>
        </Tip>
      </div>
    </SettingCard>
  );
}

interface ShortcutItem {
  keys: ReactNode;
  description: ReactNode;
  search: string;
}

interface ShortcutGroup {
  id: string;
  title: string;
  items: ShortcutItem[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    id: "playback",
    title: "Playback & Navigation",
    items: [
      {
        keys: <Kbd>Space</Kbd>,
        description: "play, pause (in the free camera: fly up)",
        search: "space play pause free camera fly up",
      },
      {
        keys: (
          <>
            <Kbd>J</Kbd>
            <Kbd>K</Kbd>
            <Kbd>L</Kbd>
          </>
        ),
        description: "play backward, stop, play forward; J or L again goes faster (2×, 4×, 8×)",
        search: "j k l play backward stop forward faster speed 2x 4x 8x",
      },
      {
        keys: (
          <>
            <Kbd>←</Kbd>
            <Kbd>→</Kbd>
          </>
        ),
        description: "1 frame (Shift: 5 frames)",
        search: "arrow left right 1 frame shift 5 frames step",
      },
      {
        keys: (
          <>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
          </>
        ),
        description: "previous, next cut",
        search: "arrow up down previous next cut shot",
      },
      {
        keys: (
          <>
            <Kbd>Home</Kbd>
            <Kbd>End</Kbd>
          </>
        ),
        description: "start, end of the film",
        search: "home end start end film",
      },
      {
        keys: (
          <>
            <Kbd>Ctrl</Kbd>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
          </>
        ),
        description: "volume",
        search: "ctrl up down volume audio",
      },
      {
        keys: <Kbd>Shift+P</Kbd>,
        description:
          "preview axis on or off: pointing at the timeline shows that frame, the playhead stays (Shift+S adds its sound)",
        search: "shift+p shift+s preview axis skim sound timeline",
      },
    ],
  },
  {
    id: "camera-view",
    title: "Camera & Preview",
    items: [
      {
        keys: <Kbd>F9 / Shift+F9</Kbd>,
        description: "Easy Ease / Easy Ease In on the selected camera keys",
        search: "f9 shift+f9 easy ease camera keyframes",
      },
      {
        keys: <Kbd>Alt+← / Alt+→</Kbd>,
        description: "move the selected camera keys one frame",
        search: "alt arrow left right nudge move camera keys frame",
      },
      {
        keys: <Kbd>[ / ]</Kbd>,
        description:
          "previous / next camera key in Camera and Speed, or previous / next Free Camera view",
        search: "[ ] bracket previous next camera key free camera view history",
      },
      {
        keys: <Kbd>F</Kbd>,
        description: (
          <>
            free camera: right-click to pin a note, right-drag to draw, left-click to pick an
            object, left-drag to look (Shift+left-drag: orbit, middle-drag: pan), scroll to move in,{" "}
            <Kbd>-</Kbd>
            <Kbd>=</Kbd> lens there. Flies like Minecraft: hold <Kbd>W</Kbd>
            <Kbd>A</Kbd>
            <Kbd>S</Kbd>
            <Kbd>D</Kbd>, <Kbd>Space</Kbd> up, <Kbd>Shift</Kbd> down; <Kbd>Q</Kbd> plays and pauses
            and <Kbd>E</Kbd> steps back 5 s there; press <Kbd>W</Kbd> twice to sprint
          </>
        ),
        search:
          "f free camera wasd fly orbit pan look scroll lens space shift q e sprint minecraft",
      },
      {
        keys: <Kbd>Shift+K</Kbd>,
        description: "add a camera keyframe from the free camera",
        search: "shift+k add camera keyframe free camera",
      },
      {
        keys: <Kbd>Alt+C</Kbd>,
        description: "copy the camera angle as text, to paste into a note",
        search: "alt+c copy camera angle text note",
      },
      {
        keys: "Click the picture",
        description: "pick an object or title there; click empty space to clear the selection",
        search: "click picture pick object title empty space clear selection",
      },
      {
        keys: "Left-drag the picture",
        description:
          "move the camera (Shift+left-drag: orbit, middle-drag: pan; wakes free camera if off); F returns to film camera",
        search: "left-drag picture move camera shift orbit middle pan free camera f",
      },
      {
        keys: (
          <>
            <Kbd>Ctrl</Kbd>
            <Kbd>;</Kbd>
          </>
        ),
        description: "Toggle framing guides and safe areas",
        search: "ctrl+; guides thirds safe areas",
      },
      {
        keys: <Keys keys={["Alt", ";"]} />,
        description: "Cycle guide layout through Thirds, Phi, Diagonals and All",
        search: "alt+; guides thirds phi golden diagonals",
      },
      {
        keys: <Keys keys={["Shift", "V"]} />,
        description: "Cycle Value Check through Normal, B&W and Silhouette",
        search: "shift+v value check luminance black white silhouette",
      },
      {
        keys: <Keys keys={["Shift", "O"]} />,
        description: "Overlay the outgoing frame from the previous shot",
        search: "shift+o cut boundary ghost onion skin",
      },
      {
        keys: <Keys keys={["Alt", "M"]} />,
        description: "Mute or unmute for a picture-only review",
        search: "alt+m mute test sound audio",
      },
      {
        keys: <Keys keys={["Shift", "H"]} />,
        description: "Hide the picture for a blind audio review",
        search: "shift+h blind audio test listening",
      },
      {
        keys: <Keys keys={["Shift", "C"]} />,
        description: "Show or hide the color script strip",
        search: "shift+c color script thumbnails storyboard",
      },
      {
        keys: (
          <>
            <Kbd>Ctrl</Kbd>
            <Kbd>Shift</Kbd>
            <Kbd>F</Kbd>
          </>
        ),
        description: "full screen preview (Esc leaves)",
        search: "ctrl+shift+f full screen fullscreen preview esc",
      },
      {
        keys: (
          <>
            <Kbd>Shift</Kbd>
            <Kbd>\</Kbd>
          </>
        ),
        description: "snapshot the picture; hold \\ to compare after a change",
        search: "shift+\\ snapshot picture compare",
      },
      {
        keys: (
          <>
            <Kbd>Shift</Kbd>
            <Kbd>G</Kbd>
          </>
        ),
        description: "final quality",
        search: "shift+g final quality heavy gpu render",
      },
    ],
  },
  {
    id: "notes-draw",
    title: "Notes & Drawing",
    items: [
      {
        keys: "Right-click the picture",
        description:
          "pin a note there, then type, talk, or pick a Draw tool. On a phone, tap to pin",
        search: "right-click picture pin note type talk draw tool",
      },
      {
        keys: "Right-drag the picture",
        description:
          "draw a note: a straight stroke becomes an arrow, a closed four-cornered one a box, anything else stays a pen stroke (Ctrl+Z undoes it)",
        search: "right-drag picture draw note arrow box pen stroke ctrl+z",
      },
      {
        keys: <Kbd>M</Kbd>,
        description: "add a note here (CapCut's marker)",
        search: "m add note marker",
      },
      {
        keys: (
          <>
            <Kbd>Shift</Kbd>
            <Kbd>M</Kbd>
          </>
        ),
        description: "next note (Alt+Shift+M: previous)",
        search: "shift+m alt+shift+m next previous note",
      },
      {
        keys: <Kbd>G</Kbd>,
        description: "draw on the picture (works in the free camera too)",
        search: "g draw picture free camera",
      },
      {
        keys: (
          <>
            <Kbd>1</Kbd>–<Kbd>4</Kbd>
          </>
        ),
        description: "with the Draw tools showing: Pen, Arrow, Box, Path",
        search: "1 2 3 4 draw tools pen arrow box path",
      },
      {
        keys: (
          <>
            <Kbd>I</Kbd>
            <Kbd>O</Kbd>
          </>
        ),
        description:
          "In and Out points at the playhead: a note written between them is about the whole stretch, and played from inside it loops",
        search: "i o in out points playhead loop range stretch",
      },
      {
        keys: <Kbd>Shift+X</Kbd>,
        description: "In and Out round the picked sound clips, or the shot",
        search: "shift+x in out round sound clips shot",
      },
      {
        keys: <Kbd>Alt+X</Kbd>,
        description: "clear In and Out",
        search: "alt+x clear in out",
      },
      {
        keys: <Kbd>Esc</Kbd>,
        description: "close, stop drawing, deselect",
        search: "esc escape close stop drawing deselect",
      },
    ],
  },
  {
    id: "timeline",
    title: "Timeline & Cuts",
    items: [
      {
        keys: (
          <>
            <Kbd>Ctrl</Kbd>
            <Kbd>B</Kbd>
          </>
        ),
        description: "split at the playhead: the selected audio clips, or the shot",
        search: "ctrl+b split playhead audio clips shot",
      },
      {
        keys: (
          <>
            <Kbd>Ctrl</Kbd>
            <Kbd>Shift</Kbd>
            <Kbd>B</Kbd>
          </>
        ),
        description: "split every track at the playhead",
        search: "ctrl+shift+b split every track playhead",
      },
      {
        keys: (
          <>
            <Kbd>B</Kbd>
            <Kbd>C</Kbd>
          </>
        ),
        description: "split mode: click a clip or the camera row to cut there",
        search: "b c blade split mode click clip camera row cut",
      },
      {
        keys: <Kbd>A</Kbd>,
        description: "select mode again (or Esc)",
        search: "a select mode esc",
      },
      {
        keys: (
          <>
            <Kbd>Q</Kbd>
            <Kbd>W</Kbd>
          </>
        ),
        description: "selected audio clips: delete left, right of the playhead",
        search: "q w selected audio clips delete left right playhead",
      },
      {
        keys: (
          <>
            <Kbd>[</Kbd>
            <Kbd>]</Kbd>
          </>
        ),
        description: "select every audio clip left, right of the playhead",
        search: "[ ] select audio clip left right playhead",
      },
      {
        keys: <Kbd>Alt+drag</Kbd>,
        description: "a sound clip: drag a copy of it, the clip stays",
        search: "alt+drag sound clip drag copy",
      },
      {
        keys: "Drag a clip",
        description: "move it; drag its edge to trim. Shift: no snapping",
        search: "drag clip move trim edge shift no snapping",
      },
      {
        keys: "Drag a keyframe",
        description: "retime it. Shift: no snapping",
        search: "drag keyframe retime shift no snapping",
      },
      {
        keys: "Click empty timeline space",
        description:
          "the playhead goes there and nothing stays selected (Shift or Ctrl: keep the selection)",
        search: "click empty timeline space playhead deselect shift ctrl",
      },
      {
        keys: "Drag on empty timeline space",
        description:
          "a box: picks every clip, text item and key it touches, on the Camera row whole shot blocks (Shift: add more)",
        search: "drag empty timeline space box marquee select clip text key camera shot",
      },
      {
        keys: "Drag the playhead line",
        description: "anywhere down the timeline, as on the ruler",
        search: "drag playhead line timeline ruler",
      },
      {
        keys: "Drag a cut",
        description: "move the cut: one shot grows, the next shrinks",
        search: "drag cut move shot grows shrinks",
      },
      {
        keys: "Drag a row's bottom edge",
        description: "resize Shots, Voice or Action (double-click: reset)",
        search: "drag row bottom edge resize shots voice action double-click reset",
      },
      {
        keys: "Scroll",
        description: "on the timeline: the rows up and down",
        search: "scroll timeline rows up down",
      },
      {
        keys: (
          <>
            <Kbd>Ctrl</Kbd>+scroll
          </>
        ),
        description: "zoom the timeline",
        search: "ctrl+scroll zoom timeline",
      },
      {
        keys: (
          <>
            <Kbd>Alt</Kbd>+scroll
          </>
        ),
        description: "slide the timeline along the film (Shift+scroll too)",
        search: "alt+scroll shift+scroll slide pan timeline film",
      },
      {
        keys: (
          <>
            <Kbd>=</Kbd>
            <Kbd>-</Kbd>
          </>
        ),
        description: "zoom the timeline in, out (Ctrl+ and Ctrl- zoom the page)",
        search: "= - zoom timeline in out",
      },
      {
        keys: (
          <>
            <Kbd>Shift</Kbd>
            <Kbd>Z</Kbd>
          </>
        ),
        description: "show the whole film on the timeline",
        search: "shift+z show whole film timeline zoom fit",
      },
      {
        keys: <Kbd>S</Kbd>,
        description: "auto snapping on, off (hold Shift while dragging to skip it once)",
        search: "s auto snapping snap magnet shift",
      },
    ],
  },
  {
    id: "editing",
    title: "Editing & Objects",
    items: [
      {
        keys: (
          <>
            <Kbd>Ctrl</Kbd>
            <Kbd>Z</Kbd>
          </>
        ),
        description: "undo (while drawing: the last stroke)",
        search: "ctrl+z undo drawing stroke",
      },
      {
        keys: (
          <>
            <Kbd>Ctrl</Kbd>
            <Kbd>Y</Kbd>
          </>
        ),
        description: "redo (or Ctrl+Shift+Z)",
        search: "ctrl+y ctrl+shift+z redo",
      },
      {
        keys: <Kbd>Delete</Kbd>,
        description: "delete selected clips, keyframes or object (a cut: merge its shots)",
        search: "delete clips keyframes object cut merge shots",
      },
      {
        keys: (
          <>
            <Kbd>Ctrl</Kbd>
            <Kbd>C</Kbd>
            <Kbd>V</Kbd>
          </>
        ),
        description:
          "copy the selected clips or keyframes, paste them at the playhead (Ctrl+X: cut)",
        search: "ctrl+c ctrl+v ctrl+x copy paste cut clips keyframes playhead",
      },
      {
        keys: (
          <>
            <Kbd>Ctrl</Kbd>
            <Kbd>Alt</Kbd>
            <Kbd>C</Kbd>
            <Kbd>V</Kbd>
          </>
        ),
        description:
          "copy one clip's, shot's or camera keyframe's attributes, paste them onto the selected ones",
        search: "ctrl+alt+c ctrl+alt+v copy paste attributes clip shot camera keyframe",
      },
      {
        keys: (
          <>
            <Kbd>Ctrl</Kbd>
            <Kbd>A</Kbd>
          </>
        ),
        description: "select every audio clip (not on locked tracks)",
        search: "ctrl+a select every all audio clip",
      },
      {
        keys: (
          <>
            <Kbd>W</Kbd>
            <Kbd>E</Kbd>
            <Kbd>R</Kbd>
          </>
        ),
        description: "selected object: move, rotate, scale",
        search: "w e r selected object move rotate scale gizmo",
      },
      {
        keys: "Drag from Objects",
        description: "drop a block, prop or mob on the picture",
        search: "drag objects drop block prop mob picture",
      },
      {
        keys: (
          <>
            <Kbd>0</Kbd>–<Kbd>9</Kbd>
          </>
        ),
        description: "pick an alternative",
        search: "0 9 number pick alternative option",
      },
    ],
  },
];

function ShortcutsSection() {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    if (!needle) return SHORTCUT_GROUPS;
    const terms = needle.split(/\s+/).filter(Boolean);
    return SHORTCUT_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((item) => {
        const hay = `${g.title} ${item.search}`.toLowerCase();
        return terms.every((term) => hay.includes(term));
      }),
    })).filter((g) => g.items.length > 0);
  }, [needle]);

  const totalShown = filteredGroups.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <SettingCard
      title="Shortcuts"
      icon={Keyboard}
      accent="primary"
      className="pointer-coarse:hidden"
      right={
        <span className="text-label text-xs tabular-nums">
          {needle ? `${totalShown} match${totalShown === 1 ? "" : "es"}` : `${totalShown} keys`}
        </span>
      }
    >
      <div className="flex items-center gap-1.5">
        <div className="relative flex min-w-0 flex-1 items-center">
          <Search
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute start-2.5 size-4"
          />
          <Input
            size="search"
            type="text"
            name="settings-shortcuts-search"
            autoComplete="off"
            spellCheck={false}
            value={query}
            placeholder="Filter shortcuts (e.g. split, free cam, Ctrl+B)…"
            aria-label="Filter keyboard shortcuts"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape" && query) {
                e.preventDefault();
                setQuery("");
              }
            }}
          />
        </div>
        {query && (
          <Tip label="Clear filter">
            <Button
              variant="quiet"
              size="icon-lg"
              aria-label="Clear shortcut filter"
              onClick={() => setQuery("")}
            >
              <X />
            </Button>
          </Tip>
        )}
      </div>

      {filteredGroups.length === 0 ? (
        <div className="border-hairline-subtle bg-backdrop/50 flex flex-col items-start gap-2 rounded-lg border p-3">
          <p className="text-label text-ui leading-normal">No shortcuts match “{query.trim()}”.</p>
          <Button variant="secondary" size="sm" onClick={() => setQuery("")}>
            Clear filter
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredGroups.map((group) => (
            <div key={group.id} className="flex flex-col gap-1">
              <h4 className="text-primary-text px-0.5 text-xs font-semibold">{group.title}</h4>
              <dl className="divide-hairline-subtle border-hairline-subtle bg-backdrop/55 divide-y rounded-lg border">
                {group.items.map((item, idx) => (
                  <div
                    key={idx}
                    className="hover:bg-surface-subtle grid grid-cols-[auto_1fr] items-baseline gap-x-2.5 px-2.5 py-2 transition-colors duration-100 motion-reduce:transition-none"
                  >
                    <dt className="text-foreground flex flex-wrap items-center gap-0.5 text-xs font-medium">
                      {item.keys}
                    </dt>
                    <dd className="text-label text-ui leading-normal text-pretty">
                      {item.description}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}
    </SettingCard>
  );
}

function Footer() {
  const shot = useStudio((s) => s.shot),
    perf = useStudio((s) => s.perf);
  return (
    <div className="border-hairline-subtle bg-card/55 text-label text-ui flex flex-none items-center justify-between gap-3 border-t px-3 py-2">
      <span className="min-w-0 flex-1 truncate">{shot}</span>
      <span className="whitespace-nowrap tabular-nums pointer-coarse:hidden">{perf}</span>
    </div>
  );
}

export function Settings() {
  const [tab, setTab] = useState<SettingsTabId>("view");
  const scrollRef = useRef<HTMLDivElement>(null);
  const s = useStudio(
    useShallow((x) => ({
      contract: x.contract,
      captions: x.captions,
      guides: x.guides,
      guideMode: x.guideMode,
      guideSafe: x.guideSafe,
      valueCheck: x.valueCheck,
      ghost: x.ghost,
      ghostOpacity: x.ghostOpacity,
      blindAudio: x.blindAudio,
      colorScript: x.colorScript,
      tryOn: x.tryOn,
      free: x.free,
      flySpeed: x.flySpeed,
      nightVision: x.nightVision,
      final: x.final,
      selection: x.selection,
      scopes: x.scopes,
      meter: x.meter,
      ratio: x.ratio,
      aiActivity: x.aiActivity,
      noteNotify: x.noteNotify,
      activityChime: x.activityChime,
      manualConfirm: x.manualConfirm,
    })),
  );
  const step = (d: number) => seek(S.t + d);
  const handleTabChange = (next: string) => {
    setTab(next as SettingsTabId);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  return (
    <div id="settings" className="flex min-h-0 flex-1 flex-col text-sm">
      <div className="border-hairline-subtle bg-card/55 flex flex-none items-center justify-between border-b py-2 pr-1.5 pl-3">
        <h2
          id="settings-title"
          className="text-heading-foreground text-base leading-snug font-semibold"
        >
          Settings
        </h2>
        <Tip label="Esc">
          <Button
            variant="quiet"
            size="icon-lg"
            className="size-9 pointer-coarse:size-10"
            aria-label="Close settings"
            onClick={() => set({ settingsOpen: false })}
          >
            <X />
          </Button>
        </Tip>
      </div>

      {s.contract.length > 0 && (
        <div className="border-warn/30 bg-warn-bg/85 mx-3 mt-2.5 flex flex-none flex-col gap-1.5 rounded-xl border p-2.5">
          <div className="text-warn-text text-ui flex items-center gap-1.5 font-semibold">
            <TriangleAlert size={14} strokeWidth={2} absoluteStrokeWidth aria-hidden />
            <span>Film contract errors</span>
          </div>
          <p className="text-label text-ui leading-normal text-pretty">
            Send this to the AI working on the film; it also shows in the studio's terminal. Rules:
            bun run skills get core --ref contract.
          </p>
          <pre className="bg-backdrop/75 border-hairline-subtle text-foreground max-h-32 overflow-auto overscroll-contain rounded-lg border px-2.5 py-2 font-mono text-xs/normal wrap-anywhere whitespace-pre-wrap">
            {s.contract.join("\n\n")}
          </pre>
        </div>
      )}

      <Tabs.Root
        value={tab}
        onValueChange={handleTabChange}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="border-hairline-subtle bg-card/45 flex-none border-b px-2.5 py-1.5">
          <Tabs.List
            aria-label="Settings categories"
            className="relative flex [scrollbar-width:none] items-center justify-between gap-1 overflow-x-auto overscroll-x-contain"
          >
            <Tabs.Indicator className="tab-pill-indicator bg-raised-3 ring-hairline-strong pointer-events-none z-0 rounded-md shadow-xs ring-1" />
            {SETTINGS_TABS.map((t) => {
              const active = tab === t.id;
              const Icon = t.icon;
              return (
                <Tabs.Tab
                  key={t.id}
                  value={t.id}
                  className={cn(
                    "focus-visible:ring-ring studio-press text-ui relative z-1 flex h-8.5 flex-none items-center justify-center gap-1 rounded-md px-2 leading-none whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:h-10",
                    active
                      ? "text-heading-foreground font-semibold"
                      : "text-muted-foreground hover:bg-surface-subtle hover:text-foreground font-medium",
                  )}
                >
                  <Icon
                    size={14}
                    strokeWidth={active ? 2 : 1.5}
                    absoluteStrokeWidth
                    aria-hidden
                    className={cn(
                      "shrink-0 transition-colors duration-150 motion-reduce:transition-none",
                      active ? ACCENT_ICON_CLASS[t.accent] : "text-current",
                    )}
                  />
                  <span>{t.label}</span>
                </Tabs.Tab>
              );
            })}
          </Tabs.List>
        </div>

        <div
          ref={scrollRef}
          data-arrow-scroll
          className="scroll-fade flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain px-3 py-3"
        >
          <TabStage activeKey={tab} order={TAB_ORDER} duration={150} className="flex flex-col">
            <Tabs.Panel
              value="view"
              hidden={tab !== "view"}
              className={tab === "view" ? "flex flex-col gap-3.5" : "hidden"}
            >
              <SettingCard title="Jump" className="hidden pointer-coarse:flex">
                <div className="grid grid-cols-4 gap-1.5">
                  <Button variant="secondary" className="h-11" onClick={() => step(-5)}>
                    −5 s
                  </Button>
                  <Button
                    variant="secondary"
                    className="h-11 whitespace-nowrap"
                    onClick={() => step(-1 / FPS)}
                  >
                    −1 frame
                  </Button>
                  <Button
                    variant="secondary"
                    className="h-11 whitespace-nowrap"
                    onClick={() => step(1 / FPS)}
                  >
                    +1 frame
                  </Button>
                  <Button variant="secondary" className="h-11" onClick={() => step(5)}>
                    +5 s
                  </Button>
                  <Button
                    variant="secondary"
                    className="col-span-2 h-11"
                    onClick={() => zoomSpan(1.5)}
                  >
                    Timeline −
                  </Button>
                  <Button
                    variant="secondary"
                    className="col-span-2 h-11"
                    onClick={() => zoomSpan(1 / 1.5)}
                  >
                    Timeline +
                  </Button>
                </div>
              </SettingCard>

              <SettingCard title="Playback & Frame" icon={Film} accent="primary" rows>
                <Row>
                  <span className="text-foreground text-sm whitespace-nowrap">Speed</span>
                  <Speed />
                </Row>
                <Row>
                  <span className="text-foreground flex items-center gap-1.5 text-sm whitespace-nowrap">
                    Aspect ratio
                    <HelpTip label="Aspect ratio">
                      16:9 for YouTube videos, 9:16 for Shorts. It belongs to the film (its
                      package.json, "live-studio" ratio): the picture here, the drafts and the
                      checks all take it. Changing it reloads the studio at this second.
                    </HelpTip>
                  </span>
                  <ToggleGroup
                    value={[s.ratio]}
                    onValueChange={(v: string[]) => {
                      if (v[0]) setRatio(v[0] as Ratio);
                    }}
                    aria-label="Aspect ratio"
                    spacing={0.5}
                    variant="segment"
                    size="lg"
                  >
                    {RATIOS.map((r) => (
                      <ToggleGroupItem key={r} value={r} className="pointer-coarse:h-10">
                        {r}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Row>
                <Row>
                  <span className="text-foreground flex items-center gap-1.5 text-sm">
                    Shot <Keys keys={["↑", "↓"]} />
                  </span>
                  <span className="flex gap-1.5">
                    <Button
                      variant="secondary"
                      size="lg"
                      aria-label="Previous shot"
                      onClick={() => jumpShot(-1)}
                    >
                      ‹ Previous
                    </Button>
                    <Button
                      variant="secondary"
                      size="lg"
                      aria-label="Next shot"
                      onClick={() => jumpShot(1)}
                    >
                      Next ›
                    </Button>
                  </span>
                </Row>
              </SettingCard>

              <SettingCard title="Overlays & Scopes" icon={Layers} accent="primary" rows>
                <SwitchRow
                  id="captions"
                  label="Captions"
                  checked={s.captions}
                  onChange={(on) => setPref("captions", on)}
                />
                <SwitchRow
                  id="guides"
                  label="Guides"
                  keys={["Ctrl", ";"]}
                  checked={s.guides}
                  onChange={(on) => setPref("guides", on)}
                  help="Over the picture: Thirds, Golden Ratio (38.2%), Baroque/Sinister diagonals, and SMPTE/Shorts safe areas. Alt+; cycles layout. Kept in this browser."
                />
                <Row>
                  <span className="flex items-center gap-1.5 text-sm whitespace-nowrap">
                    Guide layout <Keys keys={["Alt", ";"]} />
                  </span>
                  <ToggleGroup
                    value={[s.guideMode]}
                    onValueChange={(v: string[]) => {
                      if (!v[0]) return;
                      setPref("guideMode", v[0] as GuideMode);
                      if (!s.guides) setPref("guides", true);
                    }}
                    aria-label="Guide layout"
                    spacing={0.5}
                    variant="segment"
                    size="sm"
                  >
                    {GUIDE_MODES.map((m) => (
                      <ToggleGroupItem key={m} value={m} className="pointer-coarse:h-10">
                        {m === "thirds"
                          ? "Thirds"
                          : m === "phi"
                            ? "Phi"
                            : m === "diagonals"
                              ? "Diag"
                              : "All"}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Row>
                <SwitchRow
                  id="guide-safe"
                  label="Safe zones in guides"
                  checked={s.guideSafe}
                  onChange={(on) => setPref("guideSafe", on)}
                  help="Include 93% action / 90% title safe boxes (16:9) or Shorts/TikTok safe zone (9:16) inside framing guides."
                />
                <div className="upright:hidden sideways:hidden contents">
                  <SwitchRow
                    id="scopes"
                    label="Color oscilloscope"
                    checked={s.scopes}
                    onChange={(on) => setPref("scopes", on)}
                    help="Under the picture, as CapCut shows it: RGB parade, RGB waveform and vectorscope of the frame on screen. For a dark scene: a trace flat on the 0 line is pure black with no detail left, and the waveform's corner says how much of the picture is. Kept in this browser."
                  />
                </div>
                <div className="upright:hidden sideways:hidden contents">
                  <SwitchRow
                    id="audio-meter"
                    label="Audio meter"
                    checked={s.meter}
                    onChange={(on) => setPref("meter", on)}
                    help="At the right of the timeline: the left and right peaks, the short-term loudness against the film's target (-14 LUFS for YouTube) and a red light when the sound clips. Every number is the final video's, after its loudness pass. Kept in this browser."
                  />
                </div>
                <SwitchRow
                  id="try-on"
                  label="Show alternatives on the picture"
                  checked={s.tryOn}
                  onChange={(on) => setPref("tryOn", on)}
                  help="Near a prop or sound with several versions, chips show at the top right of the picture. Click A, B, C… to switch, Use to keep one."
                />
              </SettingCard>

              <SettingCard title="Director’s Eye" icon={Layers} accent="primary" rows>
                <div className="px-3">
                  <DirectorEyeSettings
                    valueCheck={s.valueCheck}
                    ghost={s.ghost}
                    ghostOpacity={s.ghostOpacity}
                    colorScript={s.colorScript}
                    blindAudio={s.blindAudio}
                  />
                </div>
              </SettingCard>

              <Options />
            </Tabs.Panel>

            <Tabs.Panel
              value="camera"
              hidden={tab !== "camera"}
              className={tab === "camera" ? "flex flex-col gap-3.5" : "hidden"}
            >
              <SettingCard
                title="Free Camera"
                icon={Move3d}
                accent="primary"
                rows
                className="pointer-coarse:hidden"
              >
                <SwitchRow
                  id="free-cam"
                  label="Free camera"
                  keys={["F"]}
                  checked={s.free}
                  onChange={(on) => engine.setFree(on)}
                  help="Look around the scene freely. The film doesn't change: its own camera stays in the corner (Film camera) to compare. Turn it off to go back to the film's camera."
                />
                <SwitchRow
                  id="night-vision"
                  label="Night vision"
                  checked={s.nightVision}
                  onChange={(on) => setPref("nightVision", on)}
                  help="Lights up the free camera's view and clears the fog, to find your way round a dark set, as Minecraft's night vision. Only while flying the free camera, only on this screen: the film's own light, its camera corner, drafts and the video stay as they are. Kept in this browser."
                />
                <Row>
                  <span className="text-foreground flex items-center gap-1.5 text-sm whitespace-nowrap">
                    Fly speed
                    <HelpTip label="Fly speed">
                      How fast W A S D, Space and Shift move the free camera. Press W twice to
                      sprint at double this. Kept in this browser.
                    </HelpTip>
                  </span>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="flex h-9 min-w-0 flex-1 items-center">
                      <Slider
                        min={FLY_SPEED.min}
                        max={FLY_SPEED.max}
                        step={0.5}
                        value={s.flySpeed}
                        onValueChange={(v: number | readonly number[]) =>
                          setPref("flySpeed", typeof v === "number" ? v : v[0])
                        }
                        aria-label="Fly speed"
                        format={{ style: "unit", unit: "meter-per-second" }}
                      />
                    </span>
                    <span className="text-label min-w-[6.5ch] text-end text-sm tabular-nums">
                      {s.flySpeed} m/s
                    </span>
                  </span>
                </Row>
              </SettingCard>

              <SettingCard
                title="Lens & Framing"
                icon={Aperture}
                accent="primary"
                rows
                className="pointer-coarse:hidden"
              >
                <div className="flex flex-col gap-2.5 p-3">
                  <FreeCamLensFields />
                </div>
                <Row>
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="text-foreground text-sm">Camera angle</span>
                    <Keys keys={["Alt+C"]} />
                    <HelpTip label="Copy camera angle">
                      Copies the camera's position and direction as one line of text. Paste it into
                      a note to have the AI frame the shot exactly so. Shortcut: Alt+C.
                    </HelpTip>
                  </span>
                  <Button
                    variant="secondary"
                    size="lg"
                    aria-label="Copy camera angle"
                    onClick={copyCam}
                  >
                    <Copy data-icon="inline-start" />
                    Copy
                  </Button>
                </Row>
              </SettingCard>

              <div className="border-hairline-subtle bg-card hidden flex-col items-start gap-1.5 rounded-xl border p-3 pointer-coarse:flex">
                <div className="text-foreground flex items-center gap-1.5 text-sm font-medium">
                  <Camera size={15} strokeWidth={2} absoluteStrokeWidth aria-hidden />
                  <span>Desktop camera controls</span>
                </div>
                <p className="text-label text-ui leading-normal">
                  Free camera flying and lens sliders require a mouse and keyboard.
                </p>
              </div>
            </Tabs.Panel>

            <Tabs.Panel
              value="ai"
              hidden={tab !== "ai"}
              className={tab === "ai" ? "flex flex-col gap-3.5" : "hidden"}
            >
              <SettingCard title="Saving & Export" icon={ShieldCheck} accent="warn" rows>
                <SwitchRow
                  id="manual-confirm"
                  label="Confirm before saving changes"
                  highlight
                  description="Holds edits in preview until you Confirm or Revert."
                  checked={s.manualConfirm}
                  onChange={(on) => {
                    setPref("manualConfirm", on);
                    setAutoSave(!on);
                  }}
                  help="Hold timeline, camera, object, sound, and adjustment tweaks in preview until you click Confirm or Revert, so the AI isn't blocked by unconfirmed experiments."
                />
                <Row>
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="text-foreground text-sm">All open notes</span>
                    <HelpTip label="Copy notes">
                      Copies every open note as text, to paste to an AI elsewhere.
                    </HelpTip>
                  </span>
                  <Button
                    variant="secondary"
                    size="lg"
                    aria-label="Copy all open notes"
                    onClick={copyAll}
                  >
                    <Copy data-icon="inline-start" />
                    Copy
                  </Button>
                </Row>
              </SettingCard>

              <SettingCard title="AI Presence & Alerts" icon={Sparkles} accent="ai" rows>
                <SwitchRow
                  id="ai-activity"
                  label="Show what the AI is doing"
                  checked={s.aiActivity}
                  onChange={(on) => setPref("aiActivity", on)}
                  help="Under the picture, a dot lit while the AI works and its latest step beside it (click it for the steps before). The note it reads or answers, the lesson file it reads or writes and the seconds it looks at or renders light up for a moment. Nothing moves the playhead, scrolls or takes the focus. Kept in this browser."
                />
                <SwitchRow
                  id="note-notify"
                  label="Notify when AI resolves a note"
                  checked={s.noteNotify}
                  onChange={(on) => {
                    setPref("noteNotify", on);
                    if (on && s.activityChime) armActivityChime();
                  }}
                  help="Shows a toast alert and sounds the chime when the AI resolves a note or asks a question. On by default; kept in this browser."
                />
                <SwitchRow
                  id="activity-chime"
                  label="Play ting chime on AI alerts"
                  checked={s.activityChime}
                  onChange={(on) => {
                    setPref("activityChime", on);
                    if (on) armActivityChime();
                  }}
                  help="Sounds a short ting once for resolved notes or activity errors while Studio is open and playback is paused. On by default; kept in this browser."
                />
              </SettingCard>
            </Tabs.Panel>

            <Tabs.Panel
              value="render"
              hidden={tab !== "render"}
              className={tab === "render" ? "flex flex-col gap-3.5" : "hidden"}
            >
              {!AWAY && (
                <SettingCard title="Heavy / GPU" icon={Cpu} warn rows>
                  <div className="flex items-start gap-2 px-3 py-2.5">
                    <TriangleAlert
                      size={15}
                      strokeWidth={2}
                      absoluteStrokeWidth
                      aria-hidden
                      className="text-warn-text mt-0.5 shrink-0"
                    />
                    <p className="text-foreground/90 text-ui leading-normal text-pretty">
                      Uses more memory and GPU. The PC may stutter during a render.
                    </p>
                  </div>
                  <SwitchRow
                    id="final"
                    label="Final quality"
                    keys={["Shift", "G"]}
                    checked={s.final}
                    onChange={(on) => {
                      void engine.setFinal(on);
                    }}
                    help={`Draws the paused frame at ${frameSize(1920).join("×")} with every effect, as in the video. Pauses playback. The first time takes about 10 s.`}
                  />
                  <Row>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="text-foreground text-sm">Still frame</span>
                      <HelpTip label="Export still frame">{`Saves the frame at the playhead at final quality (${frameSize(1920).join("×")}), as PNG or JPEG, for a thumbnail. Guides, pins and the gizmo stay out; with the free camera on, its view is the one saved. The first time takes about 10 s.`}</HelpTip>
                    </span>
                    <Button
                      variant="secondary"
                      size="lg"
                      aria-label="Export still frame"
                      onClick={exportStill}
                    >
                      Export
                    </Button>
                  </Row>
                </SettingCard>
              )}

              <SettingCard
                title="Timeline selection"
                icon={ListTree}
                accent="primary"
                help={[
                  "Timeline",
                  "Click a block on the timeline (a sentence or an action) to see its second and word here.",
                ]}
              >
                {s.selection.length > 0 ? (
                  <div className="text-label text-ui first:*:text-heading-foreground flex flex-col gap-0.5 leading-normal tabular-nums first:*:font-medium">
                    {s.selection.map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </div>
                ) : (
                  <p className="text-label text-ui leading-normal">
                    Click a block on the timeline to see its second and word here.
                  </p>
                )}
              </SettingCard>

              <ShortcutsSection />
            </Tabs.Panel>
          </TabStage>
        </div>
      </Tabs.Root>

      <Footer />
    </div>
  );
}
