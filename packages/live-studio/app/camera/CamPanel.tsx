import { MAX_FOV, MIN_FOV } from "film-kit/lens";
import {
  AudioLines,
  Hourglass,
  LockKeyhole,
  LockKeyholeOpen,
  Scissors,
  Trash2,
} from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

import { FieldRow, KeyNav, Reset, SaveStatus, Section, Segmented } from "../components/inspector";
import { NumberField } from "../components/NumberField";
import { Tip } from "../components/Tip";
import { S } from "../core/state";
import { get, useStudio } from "../core/store";
import { SAME, stamp } from "../core/time";
import { useFrame } from "../core/useFrame";
import { useFrameKey } from "../core/useFrameKey";

function PlayheadStamp() {
  useFrame();
  return <span className="tabular-nums">{stamp(S.t)}</span>;
}
import { seekExact } from "../playback/transport";
import { hasSweeteners, sweeten, SWEETS } from "../sound/sweeten";
import { shotSpan, shownShot } from "./anim";
import {
  addKeyHere,
  cameraKeyShotIndex,
  canConvertHardCut,
  canDeleteCameraKey,
  convertHardCutToKeyframe,
  edit,
  holdAfter,
  initialKeyTime,
  isHardCut,
  keys,
  removeCamKeys,
  removeKey,
  resetLens,
  retimable,
  retime,
  rollable,
  rollCut,
  room,
  setKey,
  setKeyLocked,
  shownKey,
  simplifyCameraKeys,
  splitShot,
  writeLens,
} from "./cam";
import { cameraKeyNavigation } from "./camera-edit";
import { CameraFraming } from "./CameraFraming";
import { CameraKeyStyle, CameraTakePicker } from "./CameraKeyAuthoring";
import { CameraOptics } from "./CameraOptics";
import { CameraOpticsTracksPanel } from "./CameraOpticsTracks";
import { CameraShotSettings } from "./CameraShotSettings";
import { ShotHitsSection } from "./CamKeySections";
import { FreeCamPanel } from "./FreeCamPanel";
import { renameShot, setShotCameraClock, shotsDoc } from "./shots";

const CameraEasePanel = lazy(() =>
  import("./SpeedPanel").then((m) => ({ default: m.CameraEasePanel })),
);

export const SHOT_NAME_ID = "shot-name";

function Saved() {
  const saved = useStudio((s) => s.camSaved);
  return <SaveStatus state={saved} hideWhenIdle className="block px-3 pb-1" />;
}

function ShotSection({ shot }: { shot: number }) {
  useStudio((s) => s.shotsRev);
  const shots = useStudio((s) => s.shots),
    free = useStudio((s) => s.free),
    sound = useStudio((s) => s.sound);
  const [a, b] = shotSpan(shot),
    name = S.comments[shot] ?? "";
  return (
    <Section
      title={`Shot ${shot}`}
      right={
        shots && (
          <Tip
            label={
              free
                ? "Cut to this view at the playhead: a new shot starts here (Ctrl+B)"
                : "A new shot starts at the playhead, same picture for now (Ctrl+B)"
            }
          >
            <Button variant="quiet" size="md" className="h-7" onClick={splitShot}>
              <Scissors data-icon="inline-start" />
              Split
            </Button>
          </Tip>
        )
      }
    >
      <FieldRow label="Name">
        {shots ? (
          <Input
            size="sm"
            key={name}
            id={SHOT_NAME_ID}
            aria-label={`Shot ${shot} name`}
            defaultValue={name}
            spellCheck={false}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                e.currentTarget.value = name;
                e.currentTarget.blur();
              }
            }}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== name) renameShot(shot, v);
            }}
          />
        ) : (
          <span
            className="text-ui truncate"
            title="The film keeps its shots in code: ask the AI in a note to rename one"
          >
            {name || "—"}
          </span>
        )}
      </FieldRow>
      <FieldRow label="Runs">
        <span className="text-ui tabular-nums">
          {stamp(a)} – {stamp(b)}
        </span>
        <span className="text-muted-foreground text-xs tabular-nums">{(b - a).toFixed(1)} s</span>
      </FieldRow>
      {sound && shot > 0 && (
        <FieldRow label="Cut sound">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="md" className="h-7" />}>
              <AudioLines data-icon="inline-start" />
              Add at {stamp(a)}…
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-auto min-w-48">
              {hasSweeteners() ? (
                SWEETS.map((p, i) => (
                  <DropdownMenuItem key={p.label} onClick={() => sweeten(a, i)}>
                    {p.label}
                  </DropdownMenuItem>
                ))
              ) : (
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="max-w-56">
                    This film has no cut sounds yet: ask the AI in a note to fetch the cut
                    sweeteners
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </FieldRow>
      )}
      {shots && <ShotHitsSection shot={shot} />}
    </Section>
  );
}

function TimeField({ i }: { i: number }) {
  const k = keys[i],
    canMove = retimable(i),
    canRoll = rollable(i);
  if (!canMove && !canRoll)
    return (
      <FieldRow label="Time">
        <span className="text-ui tabular-nums">{stamp(k.t)}</span>
      </FieldRow>
    );
  const baseT = initialKeyTime(i),
    [lo, hi] = canRoll ? [0, Infinity] : room(i),
    canResetTime =
      baseT !== undefined && Math.abs(baseT - k.t) > 1e-4 && baseT >= lo && baseT <= hi;
  return (
    <FieldRow
      label={canRoll ? "Cut at" : "Time"}
      nav={
        <Reset
          compact
          label={
            baseT !== undefined ? `Reset Time to ${baseT.toFixed(3)}s` : "Reset Time to default"
          }
          disabled={!canResetTime}
          onClick={() => {
            if (baseT !== undefined) (canRoll ? rollCut : retime)(i, baseT);
          }}
        />
      }
    >
      <span className="w-28">
        <NumberField
          size="sm"
          name={canRoll ? "Cut at (s)" : "Keyframe time (s)"}
          value={k.t}
          step={1 / 30}
          digits={3}
          className="text-start"
          onSave={(t) => {
            if (t !== undefined && t !== k.t) (canRoll ? rollCut : retime)(i, t);
          }}
        />
      </span>
      <span className="text-muted-foreground text-xs">s</span>
    </FieldRow>
  );
}

function KeySection() {
  useStudio((s) => s.camKey);
  useFrameKey(() => {
    const i = shownKey(S.t);
    const k = keys[i];
    const nav = cameraKeyNavigation(keys, S.t, get().camKey, SAME);
    return `${get().camRev}:${i}:${nav.prev}:${nav.next}:${!!k && Math.abs(k.t - S.t) < SAME ? 1 : 0}`;
  });
  const free = useStudio((s) => s.free);
  useStudio((s) => s.shotsRev);
  useStudio((s) => s.shots);
  const i = shownKey(S.t),
    k = keys[i],
    nav = cameraKeyNavigation(keys, S.t, get().camKey, SAME);
  const here = !!k && Math.abs(k.t - S.t) < SAME,
    hardCut = isHardCut(i),
    shotCut = !!k?.cut && !hardCut;
  const go = (index: number | null) => {
    if (index === null) return;
    const key = keys[index];
    const beforeCut =
      !key.cut && keys.slice(index + 1).some((next) => next.t === key.t && next.cut);
    seekExact(beforeCut ? key.t - 1e-6 : key.t);
    setKey(index);
  };
  const canDelete = canDeleteCameraKey(i);
  const deleteLabel = hardCut
    ? "Delete hard cut"
    : shotCut
      ? "Delete cut and merge shots"
      : "Delete keyframe";
  return (
    <Section
      title="Keyframe"
      right={
        <>
          {k && (
            <Button
              variant="quiet"
              size="icon"
              aria-label={k.locked ? "Unlock camera keyframe" : "Lock camera keyframe"}
              onClick={() => setKeyLocked(i, !k.locked)}
            >
              {k.locked ? <LockKeyhole /> : <LockKeyholeOpen />}
            </Button>
          )}
          {k && (
            <Reset
              label="Reset lens, depth of field, roll and shake"
              disabled={
                !!k.locked ||
                (k.fov === undefined &&
                  k.mm === undefined &&
                  k.roll === undefined &&
                  k.wave === undefined &&
                  k.bob === undefined &&
                  k.fstop === undefined &&
                  k.focus === undefined &&
                  k.handheld === undefined)
              }
              onClick={() => resetLens(i)}
            />
          )}
          <KeyNav
            what="camera"
            prev={nav.prev !== null}
            next={nav.next !== null}
            here={here}
            onPrev={() => go(nav.prev)}
            onNext={() => go(nav.next)}
            onToggle={() => (here ? removeKey(i) : addKeyHere())}
            addTip={
              free
                ? "Add a keyframe here with the free camera's view (Shift+K)"
                : "Add a keyframe here, holding the picture as it is"
            }
            removeTip={deleteLabel}
            removeDisabled={!canDelete}
          />
        </>
      }
    >
      {!k ? (
        <p className="text-ui text-muted-foreground">
          No keyframe on the playhead. Click ◇ to key the picture as it is, or a diamond on the
          Camera track.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <p className="text-ui min-w-0 flex-1">
              <span className="font-medium">
                {hardCut
                  ? "Hard cut"
                  : i === 0
                    ? "Start"
                    : shotCut
                      ? "Shot cut"
                      : `Keyframe ${i + 1} of ${keys.length}`}
              </span>
              {!here && (
                <span className="text-muted-foreground">
                  {" "}
                  · picked, the playhead is at <PlayheadStamp />
                </span>
              )}
            </p>
            <Tip
              label={
                canDelete
                  ? `${deleteLabel} (Delete)`
                  : k.locked
                    ? "Unlock this camera keyframe first"
                    : i === 0
                      ? "The film's first keyframe can't be deleted"
                      : "This shot boundary can't be deleted here"
              }
            >
              <Button
                variant="remove"
                size="icon"
                aria-label={deleteLabel}
                disabled={!canDelete}
                className="pointer-coarse:size-10"
                onClick={() => removeKey(i)}
              >
                <Trash2 />
              </Button>
            </Tip>
          </div>
          <TimeField i={i} />
          {hardCut && (
            <Button
              variant="secondary"
              size="sm"
              disabled={!canConvertHardCut(i)}
              onClick={() => convertHardCutToKeyframe(i)}
            >
              Convert to regular keyframe
            </Button>
          )}
          {hardCut && !k.locked && !canConvertHardCut(i) && (
            <p className="text-ui text-muted-foreground">
              Two keys share this time. Move one before converting this cut.
            </p>
          )}
          {k.reason && <p className="text-muted-foreground text-xs">{k.reason}</p>}
          <CameraOptics index={i} section="basic" />
          <CameraFraming index={i} section="basic" />
          <div className="flex flex-wrap gap-1.5">
            <Tip label="Adds a copy of this keyframe 1 s later, so the camera stays still. Drag the copy to hold longer">
              <Button variant="secondary" size="sm" className="h-8" onClick={() => holdAfter(i)}>
                <Hourglass data-icon="inline-start" />
                Hold 1 s
              </Button>
            </Tip>
          </div>
        </>
      )}
    </Section>
  );
}

function PicksSection({ picks }: { picks: number[] }) {
  const a = keys[picks[0]].t,
    b = keys[picks[picks.length - 1]].t;
  return (
    <Section title={`${picks.length} keyframes`}>
      <div className="flex items-center gap-2">
        <p className="text-ui min-w-0 flex-1 tabular-nums">
          {stamp(a)} – {stamp(b)}
        </p>
        <Tip label="Delete these keyframes (Delete)">
          <Button
            variant="remove"
            size="icon"
            aria-label={`Delete ${picks.length} keyframes`}
            className="pointer-coarse:size-10"
            onClick={() => removeCamKeys(get().camPicks)}
          >
            <Trash2 />
          </Button>
        </Tip>
      </div>
      <p className="text-ui text-muted-foreground">
        Drag a regular keyframe to move the selected regular keys together. Drag a hard cut to move
        it on its own. Esc clears the selection.
      </p>
      {(
        [
          { key: "fov", label: "FOV", min: MIN_FOV, max: MAX_FOV, unit: "°" },
          { key: "fstop", label: "Aperture", min: 0, max: 32, unit: "f" },
        ] as const
      ).map((field) => (
        <FieldRow key={field.key} label={field.label + " (" + field.unit + ")"}>
          <NumberField
            name={"Set selected " + field.label}
            size="sm"
            value={undefined}
            min={field.min}
            max={field.max}
            step={0.1}
            digits={1}
            onSave={(value) => {
              if (value !== undefined)
                edit((rows) => {
                  for (const i of picks)
                    if (!rows[i].locked)
                      writeLens(rows[i], field.key, value, cameraKeyShotIndex(i));
                });
            }}
          />
        </FieldRow>
      ))}
      <Button variant="quiet" size="sm" onClick={() => simplifyCameraKeys(picks)}>
        Simplify selected keys
      </Button>
    </Section>
  );
}

function FilmAdvancedSection({ shot, picks }: { shot: number; picks: number[] }) {
  useStudio((s) => s.camKey);
  useStudio((s) => s.camRev);
  useStudio((s) => s.shotsRev);
  const shots = useStudio((s) => s.shots);
  const timing = useStudio((s) => s.timing);
  useFrameKey(() => shownKey(S.t));
  const i = shownKey(S.t);
  const k = keys[i];
  return (
    <Section title="Advanced" closed>
      <CameraTakePicker />
      {shots && timing && S.tools?.cameraClock && shotsDoc.data?.[shot] && (
        <FieldRow label="Camera clock">
          <Segmented
            label="Camera clock"
            value={shotsDoc.data[shot].cameraClock ?? "scene"}
            items={[
              { id: "scene", title: "Scene time" },
              { id: "output", title: "Output time" },
            ]}
            onChange={(mode) => setShotCameraClock(shot, mode)}
          />
        </FieldRow>
      )}
      {picks.length <= 1 && k && (
        <>
          <CameraKeyStyle index={i} />
          <CameraFraming index={i} section="advanced" />
          <CameraOptics index={i} section="advanced" />
        </>
      )}
      <CameraShotSettings shot={shot} />
    </Section>
  );
}

export function CamPanel() {
  useStudio((s) => s.camRev);
  useStudio((s) => s.shotPick);
  const picks = useStudio((s) => s.camPicks);
  const free = useStudio((s) => s.free);
  const [camTab, setCamTab] = useState<"film" | "free">(() => (free ? "free" : "film"));
  const prevFree = useRef(free);
  useEffect(() => {
    if (prevFree.current !== free) {
      prevFree.current = free;
      setCamTab(free ? "free" : "film");
    }
  }, [free]);
  useFrameKey(() => shownShot());
  if (!keys.length) return null;
  const shot = shownShot();
  return (
    <div
      data-arrow-scroll
      className="scroll-fade flex min-h-0 flex-1 flex-col overflow-auto overscroll-contain pb-3 *:shrink-0"
    >
      <Saved />
      <div className="px-3 pb-2">
        <Segmented
          label="Camera workspace"
          value={camTab}
          items={[
            { id: "film", title: "Film cam" },
            { id: "free", title: "Free cam" },
          ]}
          onChange={setCamTab}
        />
      </div>
      {camTab === "free" ? (
        <FreeCamPanel />
      ) : (
        <>
          <ShotSection shot={shot} />
          <CameraOpticsTracksPanel />
          {picks.length > 1 ? <PicksSection picks={picks} /> : <KeySection />}
          <Section title="Keyframe easing">
            <Suspense fallback={null}>
              <CameraEasePanel />
            </Suspense>
          </Section>
          <FilmAdvancedSection shot={shot} picks={picks} />
        </>
      )}
    </div>
  );
}
