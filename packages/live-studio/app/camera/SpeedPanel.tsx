import { CAMERA_MOTIONS } from "film-stage/camera";

import { CurveEditor, EaseTiles } from "../components/EasePicker";
import { EmptyCard, Section, Segmented } from "../components/inspector";
import { S } from "../core/state";
import { useStudio } from "../core/store";
import { stamp } from "../core/time";
import { useFrameKey } from "../core/useFrameKey";
import {
  canMatchCameraKey,
  DEFAULT_EASE,
  easeKeyIndex,
  edit,
  keys,
  preview,
  restore,
  setCameraKeyMatchSpeed,
  setEase,
  shownKey,
  snapshot,
} from "./cam";
import { CameraGraph } from "./CameraGraph";

const camDoc = { snapshot, restore };

export function CameraEasePanel() {
  useStudio((s) => s.camRev);
  useStudio((s) => s.camKey);
  useFrameKey(() => shownKey(S.t));
  const rawIdx = shownKey(S.t),
    i = easeKeyIndex(rawIdx);
  return (
    <>
      <CameraKeyEase index={i} rawIndex={rawIdx} />
      <CameraGraph index={i} />
    </>
  );
}

function CameraKeyEase({ index: i, rawIndex: rawIdx }: { index: number; rawIndex: number }) {
  const rawKey = keys[rawIdx],
    k = keys[i];
  if (i < 0 || !k) {
    return (
      <EmptyCard
        className="mx-3 mt-1"
        title={!rawKey ? "No keyframe picked" : "A shot starts here"}
      >
        {!rawKey
          ? "Click a diamond on the Camera track, or put the playhead on one: this sets how the camera travels into it."
          : rawKey.cut
            ? "No closing keyframe before this cut to ease into. Pick a keyframe inside a shot."
            : "Nothing eases into the first keyframe of a shot. Pick a later one."}
      </EmptyCard>
    );
  }
  if (k.locked)
    return (
      <EmptyCard className="mx-3 mt-1" title="Keyframe locked">
        Unlock it in Camera to change its path or easing.
      </EmptyCard>
    );
  const fromSplitCut = !!rawKey?.cut && i !== rawIdx;
  const curve = k.motion !== "hold" && Array.isArray(k.ease) ? k.ease : null;
  const canJoin = canMatchCameraKey(i);
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-1.5 px-3 pb-2">
        <p className="text-ui min-w-0">
          <span className="font-medium">
            {fromSplitCut ? `Into split · keyframe ${i + 1}` : `Into keyframe ${i + 1}`}
          </span>{" "}
          <span className="text-muted-foreground tabular-nums">
            {stamp(keys[i - 1].t)} → {stamp(k.t)}
          </span>
        </p>
      </div>
      <div className="flex flex-col gap-2 px-3 pb-3">
        <Segmented
          label="Camera path"
          value={k.motion ?? "smooth"}
          items={CAMERA_MOTIONS.map((id) => ({ id, title: id[0].toUpperCase() + id.slice(1) }))}
          onChange={(motion) =>
            edit((rows) => {
              if (rows[i].motion !== motion) delete rows[i].reversePath;
              rows[i].motion = motion;
            })
          }
        />
        {k.motion !== "hold" && (
          <EaseTiles value={k.ease} fallback={DEFAULT_EASE} onPick={(v) => setEase(i, v)} />
        )}
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
      {canJoin && (
        <div className="flex flex-col gap-2 border-t px-3 py-2">
          <span className="text-ui">Through keyframe {i + 1}</span>
          <Segmented
            label="Speed through keyframe"
            value={k.matchSpeed ? "match" : "independent"}
            items={[
              { id: "independent", title: "Independent" },
              { id: "match", title: "Match speed" },
            ]}
            onChange={(mode) => setCameraKeyMatchSpeed(i, mode === "match")}
          />
        </div>
      )}
    </div>
  );
}
