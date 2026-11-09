import { BookmarkPlus, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tip } from "../components/Tip";
import { get, say, useStudio } from "../core/store";
import { S } from "../core/state";
import { useFrame } from "../core/useFrame";
import { FPS, r3 } from "../core/time";
import { processSpec } from "./processed";
import { audibleName, clipBeats, clipOf, edit, locked, snapshot, span } from "./sound";

type Status = { kind: "idle" } | { kind: "analyzing" } | { kind: "error"; message: string };

export function BeatMenu() {
  const clip = useStudio((s) => s.clip);
  useStudio((s) => s.soundRev);
  useFrame();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const c = clipOf(clip), [from, to] = clip ? span(clip) : [0, 0], u = r3(S.t - from);
  const marks = clip ? clipBeats(clip) : [], here = marks.find((t) => Math.abs(t - u) < .5 / FPS);
  const disabled = !clip || !c || locked(clip) || status.kind === "analyzing";
  const clear = () => { if (clip && !disabled) edit((l) => { const x = l[clip.list][clip.i]; delete x.beats; delete x.beatMode; delete x.bpm; delete x.beatSource; }); };
  const detect = async (mode: 1 | 2) => {
    if (!clip || !c || disabled) return;
    const before = snapshot(), name = audibleName(c);
    if (!name) { say("Choose an audible sound before marking beats"); return; }
    setStatus({ kind: "analyzing" });
    try {
      const settings = processSpec({ ...c, name, start: name === c.name ? c.start : 0 }, to - from, clip.list === "beds");
      const res = await fetch("/api/sound/beats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(settings), signal: AbortSignal.timeout(255000) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not detect beats");
      const selected = get().clip;
      if (snapshot() !== before || !selected || selected.list !== clip.list || selected.i !== clip.i || audibleName(clipOf(clip)!) !== name || locked(clip)) throw new Error("The clip changed. Mark beats again when ready");
      if (!data.beats.length) { setStatus({ kind: "idle" }); say("No regular beat found in this clip"); return; }
      edit((l) => { const x = l[clip.list][clip.i]; x.beats = data.beats.filter((_: number, i: number) => mode === 2 || i % 4 === 0); x.beatMode = mode; x.bpm = data.bpm; x.beatSource = name; });
      setStatus({ kind: "idle" });
      say(`Marked ${clipBeats(clip).length} beats · ${data.bpm.toFixed(1)} BPM`);
    } catch (e) { const message = e instanceof Error ? e.message : "Could not detect beats"; setStatus({ kind: "error", message }); say(message, 6000); }
  };
  const toggle = () => {
    if (!clip || disabled || u < 0 || u >= to - from) return;
    edit((l) => { const x = l[clip.list][clip.i], name = audibleName(x); if (!name) return; const old = (x.beatSource ?? x.name) === name ? x.beats ?? [] : []; x.beats = here === undefined ? [...old, u].sort((a, b) => a - b) : old.filter((t) => t !== here); x.beatSource = name; });
  };
  return <DropdownMenu>
    <Tip label={status.kind === "analyzing" ? "Detecting beats…" : status.kind === "error" ? status.message : "Auto mark beats: Beats 1 marks every fourth beat; Beats 2 marks every beat"}>
      <DropdownMenuTrigger render={<Button variant="quiet" size="icon-lg" aria-label="Auto mark beats" aria-pressed={marks.length > 0} disabled={disabled} className="pointer-coarse:size-10" />}>
        {status.kind === "analyzing" ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <BookmarkPlus className="size-4" />}
      </DropdownMenuTrigger>
    </Tip>
    <DropdownMenuContent align="start" className="w-52">
      <DropdownMenuGroup><DropdownMenuLabel>Auto mark beats</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={c?.beats?.length ? String(c.beatMode ?? 2) : "none"} onValueChange={(v) => { if (v === "none") clear(); else void detect(Number(v) as 1 | 2); }}>
          <DropdownMenuRadioItem value="none" indicatorSide="start">None</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="1" indicatorSide="start">Beats 1</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="2" indicatorSide="start">Beats 2</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={u < 0 || u >= to - from} onClick={toggle}>{here === undefined ? "Add beat at playhead" : "Remove beat at playhead"}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
