import type { Tools } from "film/scene";
// Objects the creator drops into the scene (the film's tools.placed, mc-assets/placed.ts), the way Unreal drops an asset from the
// Content Browser into the level: the Objects library adds one where the pointer lets go or in front of the camera, a left-click on
// the picture selects one (picture/pointer.ts), and the gizmo (three's TransformControls) moves, turns and sizes it. As with Unreal's Auto Key, a
// gizmo edit keys the object at the playhead: the key there, or a new one. The objects live in one of the film's key files, so
// undo, saving and an agent's edits are keys.ts and doc.ts's, and each object's keys are an ordinary key row.
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

import { transitionSelection } from "../core/selection";
import { S } from "../core/state";
import { get, set, studio } from "../core/store";
import { FPS } from "../core/time";
import {
  editKeys,
  files,
  hold,
  keyOf,
  keysOf,
  pickKeys,
  preview,
  rows,
  sameKey,
} from "../keys/keys";
import type { KeyRef } from "../keys/slice";
import { setPlaying } from "../playback/transport";
import { path, showPath } from "./path";
import { addObject, placedData, setTransform, titleOf, tools } from "./placed-data";
import {
  boundsOf,
  hitTarget,
  inferTargetTransform,
  matchesRow,
  type SceneTarget,
  targetsForKeys,
  type TransformBinding,
  type TransformMode as GizmoMode,
} from "./targets";

export * from "./placed-data";

const DEG = 180 / Math.PI;

const transformOf = (o3: THREE.Object3D) => {
  const e = new THREE.Euler().setFromQuaternion(o3.quaternion, "YXZ");
  return {
    at: o3.position.toArray(),
    rot: [e.x, e.y, e.z].map((r) => Math.round(r * DEG * 10) / 10),
    scale: o3.scale.x,
  };
};
// A value being dragged in the Object panel: drawn as it goes, held off its keys until setTransform saves it
export const previewTransform = (
  name: string,
  v: { at?: number[]; rot?: number[]; scale?: number },
) => {
  const p = tools(),
    o3 = p?.objectOf(name);
  if (!p || !o3) return;
  p.hold = name;
  if (v.at) o3.position.fromArray(v.at);
  if (v.rot)
    o3.quaternion.setFromEuler(
      new THREE.Euler(...(v.rot.map((r) => r / DEG) as [number, number, number]), "YXZ"),
    );
  if (v.scale !== undefined) o3.scale.setScalar(Math.max(0.01, v.scale));
  S.dirty = true;
};
export const cancelPreviewTransform = (name: string) => {
  const p = tools();
  if (p?.hold === name && !gizmo?.dragging) {
    p.hold = null;
    S.dirty = true;
  }
};
// What the object is at the playhead, as drawn
export const shownTransform = (name: string) => {
  const o3 = tools()?.objectOf(name);
  return o3 ? transformOf(o3) : null;
};

// ---------- Selecting and the gizmo
let gizmo: TransformControls | null = null;
export const isGizmoDragging = () => !!gizmo?.dragging;
const overlay = new THREE.Scene();
const nativeProxy = new THREE.Object3D();
overlay.add(nativeProxy);
type NativeDrag = { ref: KeyRef; binding: TransformBinding; snapshot: string };
let nativeDrag: NativeDrag | null = null;
export const nativeTransform = (ref: KeyRef) => {
  const editName = files[ref.f]?.edit;
  if (!editName || !S.tools?.targets) return undefined;
  const explicit = S.tools.targets.find((t) => {
    const row = t.transform?.row;
    return (
      row &&
      row.edit === editName &&
      row.path.length === ref.path.length &&
      matchesRow(row, row.edit, ref.path)
    );
  })?.transform;
  if (explicit) return explicit;
  const matched = S.tools.targets.find(
    (t) => !t.transform && t.rows.some((r) => matchesRow(r, editName, ref.path)),
  );
  return matched ? inferTargetTransform({ edit: editName, path: ref.path }, keyOf(ref)) : undefined;
};
const nativeSelection = () => {
  const s = get();
  if (
    s.object ||
    s.keyPicks.length !== 1 ||
    s.clips.length ||
    s.camPicks.length ||
    s.textPicks.length
  )
    return null;
  const ref = s.keyPicks[0],
    binding = nativeTransform(ref),
    key = keyOf(ref);
  return binding && key && Math.abs(key.t - S.t) < 0.5 / FPS ? { ref, binding, key } : null;
};
const finishNative = (commit: boolean) => {
  const drag = nativeDrag;
  if (!drag) return;
  const value = transformOf(nativeProxy);
  nativeDrag = null;
  files[drag.ref.f].doc.restore(drag.snapshot);
  hold(false);
  if (commit) editKeys([drag.ref], (r, ks) => drag.binding.write(ks[r.i], value));
};
const cube = new THREE.BoxGeometry(1, 1, 1),
  edges = new THREE.EdgesGeometry(cube);
const boxGeometry = new LineSegmentsGeometry().fromEdgesGeometry(edges);
cube.dispose();
edges.dispose();
const boxMaterial = new LineMaterial({
  color: 0xe6e4d9,
  linewidth: 1,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
});
const hoverMaterial = boxMaterial.clone();
hoverMaterial.transparent = true;
hoverMaterial.opacity = 0.45;
const makeBox = (material = boxMaterial) =>
  Object.assign(new LineSegments2(boxGeometry, material), { box: new THREE.Box3() });
const fitBox = (box: ReturnType<typeof makeBox>, objects: THREE.Object3D[]) => {
  box.visible = !boundsOf(objects, box.box).isEmpty();
  if (box.visible) {
    box.box.getCenter(box.position);
    box.box.getSize(box.scale);
  }
};
const boxes = new Map<string, ReturnType<typeof makeBox>>();
const hoverBox = makeBox(hoverMaterial);
hoverBox.visible = false;
overlay.add(path, hoverBox);
let hovered: string | null = null;
const ensureGizmo = () => {
  if (gizmo || !S.tools) return gizmo;
  gizmo = new TransformControls(S.tools.camera, S.el.canvas);
  gizmo.setSize(0.9);
  overlay.add(gizmo.getHelper());
  gizmo.addEventListener("dragging-changed", (e) => {
    if (gizmo!.object === nativeProxy) {
      if (e.value) {
        const selected = nativeSelection();
        if (!selected) return;
        nativeDrag = {
          ref: selected.ref,
          binding: selected.binding,
          snapshot: files[selected.ref.f].doc.snapshot(),
        };
        hold(true);
        if (S.playing) setPlaying(false);
      } else finishNative(true);
      return;
    }
    const p = tools(),
      name = get().object,
      o = gizmo!.object;
    if (!p || !name || !o) return;
    if (e.value) {
      p.hold = name;
      if (S.playing) setPlaying(false);
      return;
    }
    setTransform(name, transformOf(o));
    p.hold = null;
  });
  // One size for all three axes: whichever axis handle moved sets the other two
  gizmo.addEventListener("objectChange", () => {
    const o = gizmo!.object;
    if (o && gizmo!.getMode() === "scale") {
      const axis = gizmo!.axis ?? "XYZ",
        s = axis.includes("X") ? o.scale.x : axis.includes("Y") ? o.scale.y : o.scale.z;
      o.scale.setScalar(Math.max(0.05, s));
    }
    if (nativeDrag) {
      const { ref, binding } = nativeDrag,
        value = transformOf(nativeProxy);
      preview([ref], (r, ks) => binding.write(ks[r.i], value));
    }
    S.dirty = true;
  });
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && nativeDrag) {
        e.preventDefault();
        e.stopPropagation();
        finishNative(false);
        gizmo!.reset();
        gizmo!.detach();
        S.dirty = true;
      }
    },
    { capture: true },
  );
  gizmo.addEventListener("change", () => {
    S.dirty = true;
  });
  applySnap();
  return gizmo;
};
const applySnap = () => {
  if (!gizmo) return;
  const on = get().snap;
  gizmo.setTranslationSnap(on ? 1 / 16 : null); // one game pixel
  gizmo.setRotationSnap(on ? Math.PI / 12 : null); // 15 degrees
  gizmo.setScaleSnap(on ? 1 / 16 : null);
};
export const setGizmo = (mode: GizmoMode) => {
  set({ gizmo: mode });
  gizmo?.setMode(mode);
  S.dirty = true;
};
export const gizmoBusy = () => !!gizmo && (gizmo.dragging || gizmo.axis !== null);

studio.subscribe((s, was) => {
  if (s.snap !== was.snap) applySnap();
  if (
    s.object !== was.object ||
    s.gizmo !== was.gizmo ||
    s.keysRev !== was.keysRev ||
    s.keyPicks !== was.keyPicks
  )
    attach();
  if (s.object !== was.object || s.keyPicks !== was.keyPicks) {
    S.finalAt = -1;
    S.dirty = true;
  }
});
// Re-points the gizmo whenever the selection or the built objects change (a rename or an undo builds a new one)
export const attach = (redraw = true) => {
  if (gizmo?.dragging) return;
  const name = get().object;
  if (name && files.length && !placedData()[name]) {
    set({ object: null });
    return;
  } // undone, or an agent took it out
  const o = name ? tools()?.objectOf(name) : null;
  if (redraw) S.dirty = true;
  const native = !o ? nativeSelection() : null;
  if (!o && !native) {
    gizmo?.detach();
    return;
  }
  const g = ensureGizmo();
  if (!g) return;
  let mode = get().gizmo;
  if (native) {
    const v = native.binding.read(native.key);
    nativeProxy.position.fromArray(v.at);
    nativeProxy.quaternion.setFromEuler(
      new THREE.Euler(...(v.rot.map((r) => r / DEG) as [number, number, number]), "YXZ"),
    );
    nativeProxy.scale.setScalar(v.scale);
    if (!native.binding.axes[mode]) mode = Object.keys(native.binding.axes)[0] as GizmoMode;
  }
  const axes = native?.binding.axes[mode] ?? [true, true, true];
  [g.showX, g.showY, g.showZ] = axes;
  const object = o ?? nativeProxy;
  if (g.object !== object) g.attach(object);
  g.setMode(mode);
};
export const hover = (target: SceneTarget | null) => {
  if ((target?.id ?? null) === hovered) return;
  hovered = target?.id ?? null;
  if (S.el?.canvas) S.el.canvas.style.cursor = "default";
  S.finalAt = -1;
  S.dirty = true;
};
const targets = (sceneTools: Tools): SceneTarget[] => {
  const p = sceneTools.placed;
  return [
    ...(sceneTools.targets ?? []),
    ...Object.keys(placedData()).flatMap((name) => {
      const object = p?.objectOf(name);
      return object && p
        ? [
            {
              id: `placed:${name}`,
              title: name,
              objects: [object],
              rows: [{ edit: p.key, path: [name, "keys"] }],
            },
          ]
        : [];
    }),
  ];
};
export const selectTarget = (target: SceneTarget | null, additive = false) => {
  if (!target) {
    set(transitionSelection({ kind: "none" }, get().side));
    S.dirty = true;
    return;
  }
  const row = rows.find((r) => target.rows.some((b) => matchesRow(b, files[r.f].edit, r.path)));
  if (!row) return;
  const ks = keysOf(row.f, row.path);
  const i = Math.max(
    0,
    ks.findLastIndex((k) => k.t <= S.t),
  );
  const ref = { f: row.f, path: row.path, i },
    before = get().keyPicks;
  pickKeys(
    additive
      ? before.some((r) => sameKey(r, ref))
        ? before.filter((r) => !sameKey(r, ref))
        : [...before, ref]
      : [ref],
  );
};
// After the film draws: the selection's box, what the pointer is over and the gizmo, on top of the picture, outside the film's
// own effects and its scene
export const drawGizmo = (sceneTools = S.tools) => {
  if (!sceneTools) return;
  if (!gizmo?.dragging && get().keyPicks.length) attach(false);
  const all = targets(sceneTools),
    name = get().object;
  const selected = targetsForKeys(all, get().keyPicks, files);
  const own = name ? all.find((t) => t.id === `placed:${name}`) : null;
  if (own && !selected.includes(own)) selected.push(own);
  for (const box of boxes.values()) box.visible = false;
  for (const target of selected) {
    let box = boxes.get(target.id);
    if (!box) {
      box = makeBox();
      boxes.set(target.id, box);
      overlay.add(box);
    }
    fitBox(box, target.objects);
  }
  const h = all.find((t) => t.id === hovered && !selected.includes(t));
  if (h) fitBox(hoverBox, h.objects);
  else hoverBox.visible = false;
  showPath(sceneTools.placed ?? null, own ? name : null, get().keysRev);
  const r = sceneTools.renderer;
  if (!r) return;
  // Both render sizes occupy the same CSS frame; keep the selection one screen pixel wide in either quality.
  boxMaterial.linewidth = hoverMaterial.linewidth =
    r.domElement.width / Math.max(1, S.el.canvas.clientWidth);
  if (gizmo) gizmo.camera = sceneTools.camera;
  const auto = r.autoClear;
  r.autoClear = false;
  r.clearDepth();
  r.render(overlay, sceneTools.camera);
  r.autoClear = auto;
};
export const pickAt = (x: number, y: number) => {
  return S.tools ? hitTarget(S.tools.scene, S.tools.camera, targets(S.tools), x, y) : null;
};

// Where a drop at (x, y) on the picture lands: the surface under it, else 3 m in front of the camera; facing the camera
export const dropPoint = (x: number, y: number, hitWorld?: number[]) => {
  const cam = S.tools!.camera;
  const at = hitWorld
    ? new THREE.Vector3(...hitWorld)
    : (() => {
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), cam);
        return ray.ray.at(3, new THREE.Vector3());
      })();
  if (get().snap)
    at.set(Math.round(at.x * 16) / 16, Math.round(at.y * 16) / 16, Math.round(at.z * 16) / 16);
  const to = cam.position.clone().sub(at);
  return { at: at.toArray(), yaw: Math.atan2(-to.x, -to.z) * DEG };
};

// The library's drag: a ghost follows the pointer, and letting go over the picture drops the object on what lies under it
export const startObjectCarry = (
  what: string,
  e: PointerEvent,
  look: (x: number, y: number) => { world?: number[] },
) => {
  const ghost = document.createElement("div"),
    name = titleOf(what);
  ghost.className = "carry";
  document.body.append(ghost);
  const over = (ev: PointerEvent) => {
    const r = S.el.canvas.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width,
      y = (ev.clientY - r.top) / r.height;
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
  };
  const move = (ev: PointerEvent) => {
    ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 8}px)`;
    const o = over(ev);
    ghost.toggleAttribute("data-over", !!o);
    ghost.textContent = o ? `${name} → drop here` : `${name}: drop it on the picture`;
  };
  const end = (ev: PointerEvent) => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", end);
    removeEventListener("pointercancel", end);
    ghost.remove();
    const o = ev.type === "pointerup" ? over(ev) : null;
    if (!o) return;
    const p = dropPoint(o.x, o.y, look(o.x, o.y).world);
    addObject(what, p.at, what.startsWith("mob:") ? p.yaw : 0);
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", end);
  addEventListener("pointercancel", end);
  move(e);
};
// The + button: the middle of the picture
export const addInFront = (what: string, look: (x: number, y: number) => { world?: number[] }) => {
  const p = dropPoint(0.5, 0.6, look(0.5, 0.6).world);
  addObject(what, p.at, what.startsWith("mob:") ? p.yaw : 0);
};
