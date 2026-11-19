import { Link2, Spline } from "lucide-react";

import { Button } from "@/components/ui/button";

import { CurveEditor, EaseTiles } from "../components/EasePicker";
import { EmptyCard, Section } from "../components/inspector";
import { Tip } from "../components/Tip";
import { easeToBezier } from "../core/ease";
import { S } from "../core/state";
import { setPref, useStudio } from "../core/store";
import { stamp } from "../core/time";
import { useFrameKey } from "../core/useFrameKey";
import {
  applyAlignedCustomEase,
  connectShotSpeeds,
  connectSmoothly,
  DEFAULT_EASE,
  easeKeyIndex,
  holds,
  joinMismatch,
  keys,
  preview,
  restore,
  setEase,
  shownKey,
  snapshot,
} from "./cam";

const camDoc = { snapshot, restore };

export function CameraEasePanel() {
  useStudio((s) => s.camRev);
  useStudio((s) => s.camKey);
  const autoConnect = useStudio((s) => s.autoConnectEase);
  useFrameKey(() => shownKey(S.t));
  const rawIdx = shownKey(S.t),
    rawKey = keys[rawIdx],
    i = easeKeyIndex(rawIdx),
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
  const fromSplitCut = !!rawKey?.cut && i !== rawIdx;
  const hasNeighborSegment =
    (i >= 2 &&
      !!keys[i - 1] &&
      !!keys[i - 2] &&
      !keys[i - 1].cut &&
      !holds(keys[i - 2], keys[i - 1]) &&
      !holds(keys[i - 1], k)) ||
    (i + 1 < keys.length && !!keys[i + 1] && !keys[i + 1].cut && !holds(k, keys[i + 1]));
  const mismatch = joinMismatch(i);
  const curve = Array.isArray(k.ease) ? k.ease : null;
  const baseBezier = curve ?? easeToBezier(k.ease, DEFAULT_EASE);
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
        <div className="flex items-center gap-1">
          <Tip label="Automatically match both start and end speed with neighboring keyframes in the same shot (CapCut-style continuous curve)">
            <Button
              variant="subtle"
              size="sm"
              aria-label="Auto-connect keyframe speed"
              aria-pressed={autoConnect}
              onClick={() => {
                const next = !autoConnect;
                setPref("autoConnectEase", next);
                if (next && hasNeighborSegment) connectShotSpeeds(i);
              }}
            >
              <Link2 data-icon="inline-start" aria-hidden />
              Auto-connect
            </Button>
          </Tip>
          {hasNeighborSegment && (
            <Tip label="Connect both ends smoothly with adjacent keyframes while keeping the curve editable">
              <Button
                variant={mismatch > 0.03 ? "secondary" : "quiet"}
                size="sm"
                onClick={() => connectSmoothly(i, mismatch <= 0.03)}
              >
                <Spline data-icon="inline-start" aria-hidden />
                {mismatch > 0.03 ? "Connect" : "Glide"}
              </Button>
            </Tip>
          )}
        </div>
      </div>
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
              onSave={(v) => applyAlignedCustomEase(i, v, baseBezier)}
            />
          </Section>
        </div>
      )}
    </div>
  );
}
