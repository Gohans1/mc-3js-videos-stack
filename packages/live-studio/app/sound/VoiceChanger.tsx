import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { Section, ValueBox } from "../components/inspector";
import { AudioStatus } from "./AudioStatus";
import type { VoiceFilter } from "./retime";
import type { ClipRef } from "./slice";
import { clipOf, edit } from "./sound";

const presets: { id: VoiceFilter; title: string }[] = [
  { id: "none", title: "Original" }, { id: "telephone", title: "Telephone" },
  { id: "walkieTalkie", title: "Walkie-talkie" }, { id: "megaphone", title: "Megaphone" },
];

export function VoiceChanger({ clip }: { clip: ClipRef }) {
  const c = clipOf(clip)!, preset = c.voiceFilter ?? "none", strength = c.voiceStrength ?? 100;
  const [draft, setDraft] = useState<number | null>(null);
  const commit = (v: number) => { setDraft(null); edit((l) => { l[clip.list][clip.i].voiceStrength = v; }); };
  return (
    <Section title="Voice filters">
      <div role="group" aria-label="Voice filters" className="grid grid-cols-4 gap-2 py-1">
        {presets.map((p) => <button type="button" key={p.id} aria-pressed={p.id === preset}
          className={cn("aspect-square min-w-0 rounded-lg border-2 border-transparent bg-raised-3 px-0.5 text-xs leading-snug outline-none hover:bg-raised-4 focus-visible:ring-2 focus-visible:ring-ring", p.id === preset && "border-primary")}
          onClick={() => { setDraft(null); edit((l) => { l[clip.list][clip.i].voiceFilter = p.id; }); }}>{p.title}</button>)}
      </div>
      {preset !== "none" && <div className="flex flex-col gap-2" onKeyDown={(e) => { if (e.key === "Escape") setDraft(null); }}>
        <span className="text-ui">Strength</span>
        <div className="flex items-center gap-2">
          <Slider className="min-w-0 flex-1" aria-label="Voice filter strength" min={0} max={100} step={1} value={draft ?? strength}
            onValueChange={(v) => setDraft(typeof v === "number" ? v : v[0])} onValueCommitted={(v) => commit(typeof v === "number" ? v : v[0])} />
          <ValueBox name="Voice filter strength" value={draft ?? strength} min={0} max={100} step={1} digits={0} onSave={commit} />
        </div>
      </div>}
      <AudioStatus clip={clip} />
    </Section>
  );
}
