import {
  ArrowDown,
  Box,
  LockKeyhole,
  LockKeyholeOpen,
  PersonStanding,
  Plane,
  Route,
  ShieldAlert,
  WandSparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";

import {
  avoidCameraWall,
  cameraPathHandles,
  chooseCameraPathHandle,
  toggleCameraPath,
} from "../camera/campath";
import { Tip } from "../components/Tip";
import { S } from "../core/state";
import { useStudio } from "../core/store";
import { axisView, setFreeLock, setFreeLook, setFreeNavigation } from "./freecam";

export function FreeCameraControls() {
  const active = useStudio((s) => s.free);
  const locked = useStudio((s) => s.freeLocked);
  const walk = useStudio((s) => s.freeNavigation === "walk");
  const look = useStudio((s) => s.freeLook);
  const path = useStudio((s) => s.cameraPath);
  const key = useStudio((s) => s.camKey);
  useStudio((s) => s.camRev);
  useStudio((s) => s.shotsRev);
  if (!active) return null;
  return (
    <div
      className="bg-scrim-strong absolute top-12 right-3 z-4 flex items-center gap-1 rounded-lg p-1"
      aria-label="Free camera tools"
    >
      <Tip label={locked ? "Unlock the free camera view" : "Lock the free camera view"}>
        <Button
          size="icon"
          variant={locked ? "default" : "quiet"}
          aria-label="Lock free camera view"
          aria-pressed={locked}
          onClick={() => setFreeLock(!locked)}
        >
          {locked ? <LockKeyhole /> : <LockKeyholeOpen />}
        </Button>
      </Tip>
      <Tip label="Walk 1.62 m above the floor">
        <Button
          size="icon"
          variant={walk ? "default" : "quiet"}
          aria-label="Walk mode"
          aria-pressed={walk}
          disabled={locked}
          onClick={() => setFreeNavigation(walk ? "fly" : "walk")}
        >
          {walk ? <PersonStanding /> : <Plane />}
        </Button>
      </Tip>
      {S.tools?.free.previewEffects !== undefined && (
        <Tip label="Preview the film's optics, look and transitions">
          <Button
            size="icon"
            variant={look ? "default" : "quiet"}
            aria-label="Film look in Free Camera"
            aria-pressed={look}
            onClick={() => setFreeLook(!look)}
          >
            <WandSparkles />
          </Button>
        </Tip>
      )}
      <Tip label="Show the camera path and its position and aim handles">
        <Button
          size="icon"
          variant={path ? "default" : "quiet"}
          aria-label="Show camera path"
          aria-pressed={path}
          onClick={toggleCameraPath}
        >
          <Route />
        </Button>
      </Tip>
      {path &&
        cameraPathHandles(key).map((field) => (
          <Button
            key={field}
            size="sm"
            variant="quiet"
            aria-label={
              field === "inHandle" ? "Edit incoming Bézier handle" : "Edit outgoing Bézier handle"
            }
            onClick={() => chooseCameraPathHandle(field)}
          >
            {field === "inHandle" ? "In" : "Out"}
          </Button>
        ))}
      {path && (
        <Tip label="Move the selected camera key clear of a wall">
          <Button
            size="icon"
            variant="quiet"
            aria-label="Move camera key out of wall"
            disabled={key === null}
            onClick={avoidCameraWall}
          >
            <ShieldAlert />
          </Button>
        </Tip>
      )}
      <div
        role="group"
        aria-label="Axis cube"
        className="border-border flex items-center border-l pl-1"
      >
        <Box className="mx-1 size-3.5 opacity-70" aria-hidden />
        <Button size="sm" variant="quiet" disabled={locked} onClick={() => axisView("top")}>
          <ArrowDown aria-hidden />
          Top
        </Button>
        <Button size="sm" variant="quiet" disabled={locked} onClick={() => axisView("front")}>
          Front
        </Button>
        <Button size="sm" variant="quiet" disabled={locked} onClick={() => axisView("side")}>
          Side
        </Button>
      </div>
    </div>
  );
}
