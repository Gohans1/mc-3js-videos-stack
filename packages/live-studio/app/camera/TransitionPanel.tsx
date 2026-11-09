import { Button } from "@/components/ui/button";
import { Footer, Reset, Section, SliderRow } from "../components/inspector";
import { useStudio } from "../core/store";
import { shownShot } from "./anim";
import { shotsDoc } from "./shots";
import { applyTransitionToAll, setTransition, setTransitionDuration, transitionDuration, transitionOf, transitionRoom, transitions } from "./transitions";

export function TransitionPanel() {
  useStudio((s) => s.shotsRev);
  useStudio((s) => s.shotPick);
  const shot = shownShot(), current = transitionOf(shot), fx = transitions().find((x) => x.id === current?.fx);
  if (!current || !fx) return <p className="px-3 text-ui text-muted-foreground">Drag a transition from the library onto a cut between two shots.</p>;
  return <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
    <Section title="Transition parameters" right={<Reset label="Reset transition duration" onClick={() => setTransitionDuration(shot, 0.5)} />}>
      <p className="flex gap-4 text-ui"><span className="text-muted-foreground">Name</span>{fx.title}</p>
      <SliderRow label="Duration" value={transitionDuration(shot)} min={Math.min(transitionRoom(shot), 1 / 30)} max={transitionRoom(shot)} step={1 / 30} digits={2} unit="s" doc={shotsDoc} preview={(v) => setTransitionDuration(shot, v, false)} save={(v) => setTransitionDuration(shot, v)} />
    </Section>
    <Footer>
      <Button variant="quiet" onClick={() => setTransition(shot, null)}>Remove</Button>
      <Button variant="secondary" onClick={() => applyTransitionToAll(shot)}>Apply to all</Button>
    </Footer>
  </div>;
}
