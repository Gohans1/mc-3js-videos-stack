import { clampFov, fovOf } from "film-kit/lens";
import {
  type CameraOpticsSample,
  type CameraOpticsTrack,
  type FocusTargetSpec,
  opticsKeys,
} from "film-stage/camera";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

import { FieldRow, KeyNav, Section, Segmented, ValueBox } from "../components/inspector";
import { engine } from "../core/engine";
import { S } from "../core/state";
import { get, say, set, showError, useStudio } from "../core/store";
import { stamp } from "../core/time";
import { useFrameKey } from "../core/useFrameKey";
import { readSceneFrame } from "../picture/render";
import { seekExact, setPlaying } from "../playback/transport";
import { cameraLensAspect, opticsOfKey, shownKey } from "./cam";
import { cancelCameraPick } from "./camera-framing";
import {
  canKeyOpticsHere,
  editOpticsLane,
  findOpticsKey,
  type OpticsLane,
  opticsOutputsAt,
  opticsTime,
} from "./camera-optics-track";
import { cameraShotIndex } from "./camera-rig";
import { FocalLengthRow, FocusControls } from "./OpticsWidgets";
import { type ShotRow, shotsDoc } from "./shots";

const EASES = [
  { id: "smooth", title: "Smooth" },
  { id: "linear", title: "Linear" },
  { id: "hold", title: "Hold" },
] as const;

function OpticsKeyBar<T>({
  label,
  lane,
  row,
  shot,
  track,
  add,
}: {
  label: string;
  lane: OpticsLane;
  row: ShotRow;
  shot: number;
  track: CameraOpticsTrack<T> | undefined;
  add: () => void;
}) {
  const points = opticsKeys(track);
  const time = opticsTime();
  const here = findOpticsKey(points, time);
  const marks = points.flatMap(({ t }) => opticsOutputsAt(shot, t)).sort((a, b) => a - b);
  const previous = marks.findLast((t) => t < S.t - 1e-7);
  const next = marks.find((t) => t > S.t + 1e-7);
  const go = (t: number | undefined) => {
    if (t === undefined) return;
    if (S.playing) setPlaying(false);
    seekExact(t);
  };
  const ease = EASES.find(({ id }) => id === (here?.ease ?? "smooth"))?.id;
  return (
    <>
      <FieldRow
        label={label}
        nav={
          <KeyNav
            what={label}
            prev={previous !== undefined}
            next={next !== undefined}
            here={!!here}
            onPrev={() => go(previous)}
            onNext={() => go(next)}
            onToggle={() => {
              if (!canKeyOpticsHere())
                return say("Move to a visible picture frame to edit optics keys");
              if (here)
                editOpticsLane(row, lane, (records) => {
                  delete records[here.id];
                });
              else add();
            }}
          />
        }
      >
        <span className="text-muted-foreground text-xs tabular-nums">
          {here ? stamp(S.t) : points.length ? `${points.length} keys` : "From camera keys"}
        </span>
        {points.length > 0 && (
          <Button
            variant="quiet"
            size="sm"
            aria-label={`Clear ${label} track`}
            onClick={() =>
              editOpticsLane(row, lane, (records) => {
                for (const id of Object.keys(records)) delete records[id];
              })
            }
          >
            Clear
          </Button>
        )}
      </FieldRow>
      {here && (
        <>
          <FieldRow label={label + " key time"}>
            <ValueBox
              name={label + " key time (camera seconds)"}
              value={here.t}
              min={0}
              step={0.01}
              digits={3}
              unit="s"
              onSave={(t) => {
                if (points.some((key) => key.id !== here.id && Math.abs(key.t - t) < 1e-7))
                  return say("There is already an optics key at that time");
                if (t !== here.t && !opticsOutputsAt(shot, t).length)
                  return say("Enter a camera time that appears in this shot");
                editOpticsLane(row, lane, (records) => {
                  const record = records[here.id];
                  if (record) {
                    const { contextOf: _context, ...author } = record;
                    records[here.id] = { ...author, t };
                  }
                });
                const outputs = opticsOutputsAt(shot, t);
                const nearest = outputs.reduce<number | undefined>(
                  (best, output) =>
                    best === undefined || Math.abs(output - S.t) < Math.abs(best - S.t)
                      ? output
                      : best,
                  undefined,
                );
                go(nearest);
              }}
            />
          </FieldRow>
          <Segmented
            label={label + " incoming easing"}
            items={ease ? [...EASES] : [...EASES, { id: "custom", title: "Custom" }]}
            value={ease ?? "custom"}
            onChange={(value) => {
              if (value === "custom") return;
              editOpticsLane(row, lane, (records) => {
                const record = records[here.id];
                if (record) {
                  const { contextOf: _context, ...author } = record;
                  records[here.id] = { ...author, ease: value };
                }
              });
            }}
          />
        </>
      )}
    </>
  );
}

function ShotOpticsEditor({ row, shot }: { row: ShotRow; shot: number }) {
  useFrameKey(() => S.t);
  useStudio((s) => s.shotsRev);
  useStudio((s) => s.timingRev);
  const pick = useStudio((s) => s.cameraPick);
  const focus = row.optics?.focus;
  const focalLength = row.optics?.focalLength;
  const focusKey = findOpticsKey(opticsKeys(focus), opticsTime());
  const lensKey = findOpticsKey(opticsKeys(focalLength), opticsTime());
  const { id, t } = row;
  const mine = pick?.target === "optics-focus" && pick.id === id && pick.t === t;
  useEffect(
    () => () => {
      const pick = get().cameraPick;
      if (pick?.target === "optics-focus" && pick.id === id && pick.t === t) cancelCameraPick();
    },
    [id, t],
  );

  const withSample = (write: (sample: CameraOpticsSample, time: number) => void) => {
    if (!canKeyOpticsHere()) return say("Move to a visible picture frame to add an optics key");
    if (S.playing) setPlaying(false);
    const frame = S.t;
    const time = opticsTime();
    void readSceneFrame(frame, () => {
      const sample = S.tools?.cameraOpticsSample?.();
      if (sample) write(sample, time);
    }).catch(showError);
  };
  const editFocus = (value: FocusTargetSpec | undefined, time = opticsTime()) => {
    if (!canKeyOpticsHere()) return say("Move to a visible picture frame to edit focus");
    editOpticsLane(row, "focus", (records) => {
      const key = findOpticsKey(opticsKeys(records), time);
      const { contextOf: _context, ...existing } = records[key?.id ?? ""] ?? {};
      records[key?.id ?? crypto.randomUUID()] = {
        ...existing,
        t: time,
        value: value ?? null,
      };
    });
  };
  const editLens = (value: number, time = opticsTime()) => {
    const fov = fovOf(value, cameraLensAspect(shot));
    if (fov !== clampFov(fov)) return say("Enter a focal length that gives a usable field of view");
    if (!canKeyOpticsHere()) return say("Move to a visible picture frame to edit focal length");
    editOpticsLane(row, "focalLength", (records) => {
      const key = findOpticsKey(opticsKeys(records), time);
      records[key?.id ?? crypto.randomUUID()] = { ...records[key?.id ?? ""], t: time, value };
    });
  };
  const fallback = opticsOfKey(shownKey(S.t));
  const sample = S.tools?.cameraOpticsSample?.();
  const mm = lensKey?.value ?? sample?.mm ?? fallback.mm ?? S.tools?.optics?.mm ?? 35;
  const focusValue = focusKey ? focusKey.value : sample?.focus;
  return (
    <>
      <OpticsKeyBar
        label="Focus"
        lane="focus"
        row={row}
        shot={shot}
        track={focus}
        add={() => withSample(({ focus }, time) => editFocus(focus, time))}
      />
      <FocusControls
        syncKey={`${id ?? t}:${opticsTime()}`}
        authoredFocus={focusValue}
        effectiveFocus={focusValue}
        pickingFocus={mine}
        disabled={!canKeyOpticsHere()}
        onTogglePickFocus={() => {
          if (mine) return cancelCameraPick();
          if (!canKeyOpticsHere()) return;
          if (S.playing) setPlaying(false);
          if (get().free) engine.setFree(false);
          set({
            cameraPick: { field: "focus", target: "optics-focus", id, t, time: opticsTime() },
            pickFocus: null,
          });
          say("Click a surface to set this focus key. Esc cancels");
        }}
        onCommitFocus={editFocus}
        resetLabel="Set focus key to Auto"
      />
      <OpticsKeyBar
        label="Focal length"
        lane="focalLength"
        row={row}
        shot={shot}
        track={focalLength}
        add={() => withSample(({ mm }, time) => editLens(mm, time))}
      />
      <FocalLengthRow mm={mm} onApplyMm={editLens} disabled={!canKeyOpticsHere()} />
    </>
  );
}

export function CameraOpticsTracksPanel() {
  useFrameKey(() => cameraShotIndex(S.t));
  useStudio((s) => s.shotsRev);
  useStudio((s) => s.ready);
  const shot = cameraShotIndex(S.t);
  const row = shotsDoc.data?.[shot];
  if (!row) return null;
  if (!S.tools?.cameraOpticsSample)
    return row.optics ? (
      <p className="text-muted-foreground px-3 py-2 text-xs">
        This film’s renderer ignores its saved optics tracks.
      </p>
    ) : null;
  return (
    <Section title="Optics tracks" closed>
      <p className="text-muted-foreground text-xs">
        Focus and focal length keys apply to the shot at the playhead. Dolly Zoom still drives the
        lens on its spans.
      </p>
      <ShotOpticsEditor row={row} shot={shot} />
    </Section>
  );
}
