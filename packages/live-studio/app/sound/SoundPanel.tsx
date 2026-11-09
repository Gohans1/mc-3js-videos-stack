// The sound tab: the clip picked on the lanes (its level, fades, length, which file), then every sound in the film's sfx folder,
// in BGM, SFX and starred tabs. A library row is dragged onto a lane, or + puts it at the playhead; ▶ plays it alone; pointing
// at it lights its clips, clicking it selects them. Each change is one undo step (Ctrl+Z)
import { cn } from "@/lib/utils";
import { Pause, Play, Plus, Redo2, Star, Trash2, Undo2 } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { matcher } from "../core/search";
import { stamp } from "../core/time";
import { startCarry } from "./lanes";
import { seek, setPlaying } from "../playback/transport";
import { canRedo, canUndo, redo, undo } from "../core/doc";
import { addClip, clipOf, cutAfter, edit, kindOf, lanes, library, type LibraryItem, lightSound, listen, listening, locked, maxClipLength, moveTo, moveToTrack, pickAt, pickUses, preview, removeClip, removeClips, resetBasic, restore, setClips, setField, snapshot, span, swapSound, usesOf } from "./sound";
import { gainAt, GAIN_KEY_EPS, toggleGainKey, writeGain } from "./gain";
import { useFrame } from "../core/useFrame";
import { FPS, r3 } from "../core/time";

const soundDoc = { snapshot, restore };
const secs = (x: number) => `${x.toFixed(x < 10 ? 2 : 1)} s`;
import { S } from "../core/state";
import { type ClipRef } from "./slice";
import { useStudio } from "../core/store";
import { FavoriteStar } from "../components/FavoriteStar";
import { FieldRow, KeyNav, Reset, Section, Segmented, SliderRow } from "../components/inspector";
import { SearchBox } from "../components/SearchBox";
import { Tip } from "../components/Tip";
import { NormalizeClip } from "./NormalizeClip";
import { AudioSpeed } from "./AudioSpeed";
import { VoiceChanger } from "./VoiceChanger";

// The picked clip as CapCut's Audio tab: its Basic section (volume, pan, fades, and here ducking or length), then what the app adds
// (which file, which track, where it runs). A drag previews and saves once, when let go: one undo step
function Inspector({ clip, tab }: { clip: ClipRef; tab: "basic" | "voice" | "speed" }) {
  useStudio((s) => s.soundRev);
  useFrame();
  const c = clipOf(clip);
  if (!c) return null;
  const [from, to] = span(clip), bed = clip.list === "beds";
  const u = r3(Math.min(to - from, Math.max(0, Math.round((S.t - from) * FPS) / FPS))), volume = gainAt(c, u);
  const keys = (c.gainKeys ?? []).filter((k) => k.t >= 0 && k.t <= to - from);
  const prev = keys.findLast((k) => k.t < u - GAIN_KEY_EPS), next = keys.find((k) => k.t > u + GAIN_KEY_EPS);
  const here = keys.some((k) => Math.abs(k.t - u) < GAIN_KEY_EPS);
  const item = library.find((x) => x.name === c.name);
  const names = library.map((x) => ({ value: x.name, label: x.name }));
  const tracks = [...(lanes?.tracks ?? []).map((t) => ({ value: t.id, label: `${t.name}${t.lock ? " (locked)" : ""}` })), { value: "new", label: "New track at the bottom" }];
  const live = (key: string, scale: number) => (v: number) => preview((l) => { if (key === "length") cutAfter(l.sfx[clip.i], "sfx", from + v); else ((bed ? l.beds : l.sfx)[clip.i] as Record<string, unknown>)[key] = v / scale; });
  // scale: what the slider shows per stored unit (pan is stored -1..1, shown -100..100)
  const row = (label: string, key: "gain" | "fadeIn" | "fadeOut" | "duck" | "length" | "pan", value: number, min: number, max: number, step: number, unit: string, digits: number, hint?: string, scale = 1) => (
    <SliderRow label={label} value={value} min={min} max={max} step={step} digits={digits} unit={unit} hint={hint} origin={key === "pan" ? 0 : undefined} doc={soundDoc} preview={live(key, scale)} save={(v) => setField(clip, key, v / scale)} />
  );
  const hear = () => { seek(Math.max(0, from - 0.5)); setPlaying(true); };
  const fadeMax = Math.max(0.05, Math.min(10, to - from)), fi = (c.fadeIn as number | undefined) ?? 0, fo = (c.fadeOut as number | undefined) ?? 0;
  return (
    <fieldset key={`${clip.list}${clip.i}`} aria-label="Selected clip" disabled={locked(clip)} className="flex min-w-0 flex-col">
      {locked(clip) && <p className="px-3 pb-2 text-xs text-muted-foreground">Track locked. Unlock it in the track header to edit.</p>}
      <div className="flex items-center gap-2 px-3 pb-1">
        <Badge variant="audio">{c.name === lanes?.narration ? "Voice" : bed ? "BED" : "SFX"}</Badge>
        <span className="min-w-0 flex-1 truncate text-ui text-muted-foreground" title={item?.title}>{item?.title ?? c.name}</span>
        <Tip label="Delete clip (Delete)"><Button variant="remove" size="icon-lg" className="-me-1 pointer-coarse:size-10" aria-label={`Delete ${c.name}`} onClick={() => removeClip(clip)}><Trash2 /></Button></Tip>
      </div>
      {tab === "voice" ? <VoiceChanger key={`voice:${clip.list}:${clip.i}`} clip={clip} /> : tab === "speed" ? <AudioSpeed key={`speed:${clip.list}:${clip.i}`} clip={clip} /> : <>
      <Section title="Basic" right={<Reset label="Reset volume, pan and fades" disabled={!c.gain && !c.gainKeys?.length && !c.pan && !fi && !fo} onClick={() => resetBasic(clip)} />}>
        <SliderRow label="Volume" value={volume} min={Math.min(-40, volume)} max={Math.max(20, volume)} step={0.1} digits={1} unit="dB" doc={soundDoc}
          preview={(v) => preview((l) => writeGain(l[clip.list][clip.i], u, v))} save={(v) => edit((l) => writeGain(l[clip.list][clip.i], u, v))}
          nav={<KeyNav what="volume" prev={!!prev} next={!!next} here={here} onPrev={() => prev && seek(from + prev.t)} onNext={() => next && seek(from + next.t)} onToggle={() => edit((l) => toggleGainKey(l[clip.list][clip.i], u))} />} />
        {row("Pan", "pan", Math.round((c.pan ?? 0) * 100), -100, 100, 1, "", 0, "Left −100, right 100: put the sound where it is in the picture", 100)}
        {row("Fade in", "fadeIn", fi, 0, fadeMax, 0.05, "s", 2)}
        {row("Fade out", "fadeOut", fo, 0, fadeMax, 0.05, "s", 2)}
        {bed && row("Ducking under the voice", "duck", (c.duck as number | undefined) ?? 0, 0, 24, 1, "dB", 0)}
        {bed && lanes?.voice === false && !lanes.narration && <p className="text-xs text-muted-foreground">This film has no narration in its mix yet, so nothing ducks until it does.</p>}
        {!bed && row("Duration", "length", to - from, 1 / 30, Math.max(1 / 30, maxClipLength(c)), 0.01, "s", 2)}
      </Section>
      <NormalizeClip key={`${clip.list}:${clip.i}`} clip={clip} />
      <Section title="Clip">
        <FieldRow label="Sound">
          <Select items={names} value={c.name} onValueChange={(v) => v && swapSound(clip, v as string)}>
            <SelectTrigger className="h-8 w-full min-w-0" aria-label="Sound file"><SelectValue /></SelectTrigger>
            <SelectContent>{names.map((n) => <SelectItem key={n.value} value={n.value}>{n.label}</SelectItem>)}</SelectContent>
          </Select>
        </FieldRow>
        <FieldRow label="Track">
          <Select items={tracks} value={c.track ?? ""} onValueChange={(v) => v && v !== c.track && moveToTrack(clip, v as string)}>
            <SelectTrigger className="h-8 w-full min-w-0" aria-label="Track"><SelectValue /></SelectTrigger>
            <SelectContent>{tracks.map((n) => <SelectItem key={n.value} value={n.value}>{n.label}</SelectItem>)}</SelectContent>
          </Select>
        </FieldRow>
        <FieldRow label="Runs">
          <span className="min-w-0 flex-1 text-ui tabular-nums">{stamp(from)} – {stamp(to)}</span>
        </FieldRow>
        <div className="flex gap-2">
          <Tip label="Move the clip's start to the playhead"><Button variant="secondary" size="sm" className="h-8 flex-1" onClick={() => moveTo(clip, S.t)}>Move to playhead</Button></Tip>
          <Tip label="Plays from half a second before the clip"><Button variant="secondary" size="sm" className="h-8 flex-1" onClick={hear}>Listen</Button></Tip>
        </div>
        {c.try?.length ? <p className="text-xs text-warn">{c.try.length} alternatives to try. Switch them with the chips on the picture; Use keeps one.</p> : null}
        {item?.license && <p className="text-xs text-muted-foreground">{item.license}{item.url && <> · <a className="underline underline-offset-2 hover:text-foreground" href={item.url} target="_blank" rel="noreferrer">source</a></>}</p>}
      </Section>
      </>}
    </fieldset>
  );
}

// CapCut's Music and Sound effects, plus the creator's starred sounds. Music (BGM) goes on a bed that loops, an SFX is a one-shot
const TABS = [
  { id: "bgm", title: "Music", one: "music track", help: "BGM and room tone: added as a bed that loops under the scene." },
  { id: "sfx", title: "Sound effects", one: "sound effect", help: "SFX: one-shot hits, steps, rustles." },
  { id: "fav", title: "Favorites", one: "favorite", help: "Your starred sounds, kept for every film." },
] as const;
type Tab = (typeof TABS)[number]["id"];

// side: a wide library, its sections in a column down the left as CapCut's are
function Library({ side }: { side: boolean }) {
  useStudio((s) => s.soundRev);
  const favs = useStudio((s) => s.favorites.sounds);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("sfx");
  const now = listening();
  // Every tab's matches, so the tabs say how many each holds for the words typed. Favorites newest first
  const found = useMemo(() => {
    const hit = matcher(q);
    const all = library.filter((x) => hit(`${x.name} ${x.title ?? ""} ${x.for ?? ""}`));
    const fav = [...favs].reverse().map((n) => all.find((x) => x.name === n)).filter((x) => x !== undefined);
    return { bgm: all.filter((x) => kindOf(x) === "bgm"), sfx: all.filter((x) => kindOf(x) === "sfx"), fav } as Record<Tab, LibraryItem[]>;
  }, [q, library.length, favs]);
  const shown = found[tab], meta = TABS.find((t) => t.id === tab)!, typed = q.trim() !== "";
  const elsewhere = TABS.filter((t) => t.id !== tab && found[t.id].length);
  // Dragged: a few pixels of movement turn the press into carrying the sound to a lane. The press must not also start a text
  // selection: Chrome then drags the selection natively, a ghost of half the panel, and cancels the carry (pointercancel).
  // A press let go where it began picks every clip of the sound instead
  const press = (name: string) => (e: ReactPointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    getSelection()?.removeAllRanges();
    const x0 = e.clientX, y0 = e.clientY;
    let carried = false;
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      carried = true;
      removeEventListener("pointermove", move);
      startCarry(name, ev);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", () => { removeEventListener("pointermove", move); if (!carried) pickUses(name); }, { once: true });
  };
  return (
    <section aria-label="Sound library" className={cn("flex gap-2 px-3", side ? "items-start" : "flex-col")}>
      <Segmented
        label="Sound kind" vertical={side} value={tab} onChange={setTab} className={cn(side && "sticky top-0 w-27")}
        items={TABS.map((t) => ({ id: t.id, title: <>{t.id === "fav" && <Star aria-hidden className="size-3.5 flex-none" />}<span className="truncate">{t.title}</span>{typed && <span className="ms-auto tabular-nums text-muted-foreground">{found[t.id].length}</span>}</> }))}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <SearchBox name="sound-search" value={q} onChange={setQ} label="Search sounds" placeholder={`Search ${library.length} sounds…`} />
        <p className="px-0.5 text-xs text-muted-foreground">{meta.help} Drag one onto a track or click +; click a sound to select its clips.</p>
        <ul className="flex flex-col">
          {shown.map((x) => {
            const uses = usesOf(x.name).length;
            return (
              <li
                key={x.name} onPointerDown={press(x.name)} onDragStart={(e) => e.preventDefault()}
                onPointerEnter={() => lightSound(x.name)} onPointerLeave={() => lightSound(null)}
                onFocus={() => lightSound(x.name)} onBlur={() => lightSound(null)}
                className="group flex min-h-11 cursor-grab touch-none items-center select-none gap-1 rounded-lg px-1 hover:bg-card active:cursor-grabbing"
              >
                <Button variant={now === x.name ? "lit" : "quiet"} size="icon-lg" className="flex-none pointer-coarse:size-10" aria-label={`${now === x.name ? "Stop" : "Preview"} ${x.name}`} onClick={() => listen(x.name)}>
                  {now === x.name ? <Pause /> : <Play />}
                </Button>
                <span className="flex min-w-0 flex-1 flex-col py-1">
                  <span translate="no" className="truncate text-ui">{x.name}</span>
                  {x.title && <span className="truncate text-xs text-muted-foreground" title={x.for ?? x.title}>{x.title}</span>}
                </span>
                {uses > 0 && (
                  <Tip label={uses > 1 ? `Select its ${uses} clips on the tracks` : "Select its clip on the tracks"}>
                    <Button variant="quiet" size="sm" className="h-7 flex-none" aria-label={`Select the ${uses > 1 ? `${uses} clips` : "clip"} of ${x.name}`} onClick={() => pickUses(x.name)}>
                      <span className="tabular-nums">{uses}×</span>
                    </Button>
                  </Tip>
                )}
                <span className="w-11 flex-none text-end text-xs text-muted-foreground tabular-nums">{secs(x.seconds)}</span>
                <FavoriteStar kind="sounds" id={x.name} name={x.name} reveal={!favs.includes(x.name)} />
                <Tip label="Add at the playhead, on the first free track">
                  <Button variant="quiet" size="icon-lg" className="flex-none pointer-coarse:size-10" aria-label={`Add ${x.name} at the playhead`} onClick={() => addClip(x.name, S.t)}>
                    <Plus />
                  </Button>
                </Tip>
              </li>
            );
          })}
          {!shown.length && (
            <li className="flex flex-col items-start gap-1.5 px-1 py-2 text-ui text-muted-foreground">
              {!library.length ? "The film's sound folder is empty" : typed ? `No ${meta.one}s match "${q.trim()}"` : tab === "fav" ? "No favorite sounds yet. Click the star on a sound to keep it here, for every film." : `This film has no ${meta.one}s`}
              {elsewhere.map((t) => <Button key={t.id} variant="secondary" size="md" onClick={() => setTab(t.id)}>{found[t.id].length} in {t.title}</Button>)}
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}

// part: the whole tab (one column), or on a wide screen the clip in the right column and the library in the left one
export function SoundPanel({ part = "all", tab = "basic" }: { part?: "all" | "clip" | "library"; tab?: "basic" | "voice" | "speed" }) {
  const clip = useStudio((s) => s.clip), clips = useStudio((s) => s.clips), saved = useStudio((s) => s.soundSaved);
  useStudio((s) => s.soundRev);
  return (
    <div data-arrow-scroll className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto overscroll-contain pt-1 pb-3 scroll-fade *:shrink-0">
      {part !== "library" && <>
      <div className="flex items-center gap-1 px-3">
        <p role="status" className={cn("min-w-0 flex-1 px-0.5 text-xs text-muted-foreground", saved === "fail" && "font-semibold text-warn")}>
          {saved === "busy" ? "Saving…" : saved === "fail" ? "Not saved. Retrying…" : "All changes saved"}
        </p>
        <Tip label="Select the clip playing at the playhead; click again for the next one there"><Button variant="quiet" size="md" onClick={() => pickAt(S.t)}>At playhead</Button></Tip>
        <Tip label="Undo (Ctrl+Z)"><Button variant="quiet" size="icon-lg" className="pointer-coarse:size-10" aria-label="Undo" disabled={!canUndo()} onClick={undo}><Undo2 /></Button></Tip>
        <Tip label="Redo (Ctrl+Y)"><Button variant="quiet" size="icon-lg" className="pointer-coarse:size-10" aria-label="Redo" disabled={!canRedo()} onClick={redo}><Redo2 /></Button></Tip>
      </div>
      {clip ? <Inspector clip={clip} tab={tab} /> : clips.length > 1 ? (
        <section aria-label="Selected clips" className="mx-3 flex items-center gap-2 rounded-xl bg-card p-3">
          <p className="min-w-0 flex-1 text-ui">{clips.length} clips selected<span className="block text-xs text-muted-foreground">Drag one to move them all</span></p>
          <Button variant="ghost" size="sm" className="h-8" onClick={() => setClips([])}>Deselect</Button>
          <Tip label="Delete selected clips (Delete)"><Button variant="remove" size="icon-lg" className="-me-1 pointer-coarse:size-10" aria-label={`Delete ${clips.length} selected clips`} onClick={() => removeClips(clips)}><Trash2 /></Button></Tip>
        </section>
      ) : <div className="mx-3 rounded-xl bg-card p-3 text-ui">
          <p className="font-medium">No clip selected</p>
          <p className="text-muted-foreground">Click a clip on an audio track to change its volume, fades and duration.</p>
        </div>}
      </>}
      {part !== "clip" && <Library side={part === "library"} />}
    </div>
  );
}
