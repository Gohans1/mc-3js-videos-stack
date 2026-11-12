import { CurveEditor, EaseTiles } from "../components/EasePicker";
import { EmptyCard, Section } from "../components/inspector";
import { S } from "../core/state";
import { useStudio } from "../core/store";
import { stamp } from "../core/time";
import { useFrame } from "../core/useFrame";
import { DEFAULT_EASE, keys, preview, restore, setEase, shownKey, snapshot } from "./cam";

const camDoc = { snapshot, restore };

export function CameraEasePanel() {
  useStudio((s) => s.camRev);
  useFrame();
  const i = shownKey(S.t),
    k = keys[i];
  if (!k || i === 0 || k.cut) {
    return (
      <EmptyCard className="mx-3 mt-1" title={!k ? "No keyframe picked" : "A shot starts here"}>
        {!k
          ? "Click a diamond on the Camera track, or put the playhead on one: this sets how the camera travels into it."
          : "Nothing eases into the first keyframe of a shot. Pick a later one."}
      </EmptyCard>
    );
  }
  const curve = Array.isArray(k.ease) ? k.ease : null;
  return (
    <div className="flex flex-col">
      <p className="text-ui px-3 pb-2">
        <span className="font-medium">Into keyframe {i + 1}</span>{" "}
        <span className="text-muted-foreground tabular-nums">
          {stamp(keys[i - 1].t)} → {stamp(k.t)}
        </span>
      </p>
      <div className="flex flex-col gap-2 px-3 pb-3">
        <EaseTiles value={k.ease} fallback={DEFAULT_EASE} onPick={(v) => setEase(i, v)} />
      </div>
      {curve && (
        <div className="border-t">
          <Section title="Custom curve">
            <CurveEditor
              value={curve}
              doc={camDoc}
              preview={(v) =>
                preview((ks) => {
                  ks[i].ease = v;
                })
              }
              onSave={(v) => setEase(i, v)}
            />
          </Section>
        </div>
      )}
    </div>
  );
}
