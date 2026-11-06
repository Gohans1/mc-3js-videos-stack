# film-kit

Reusable modules for draw(t) films (live-studio); each file's header gives the method, its source and the exact API.

| File | When to use | How |
|---|---|---|
| src/curve.ts | Any keyed value (pose angle, prop, light) that must not stop dead at every key. | `curve([{t, v, stop?, hold?, linear?}], {angle?})(t)`, `.vel(t)` |
| src/spring.ts | A value that springs to targets or gets kicked; something that lags a moving target. | `springTrack([{t, to?, kick?}], {smooth, ratio})(t)`; `follow(target, {from, to})(t)` |
| src/transition.ts | Switching between two motions without a pop or a dead stop. | `chain([{t, f}], dur)(t)` |
| src/shake.ts | Camera jolts from impacts (a slam, a fall). | `shake([{t, amount}])(t)` gives [yaw, pitch, roll] in degrees |
| src/handheld.ts | A camera that feels held by a person (CC0 recorded wobble). | `handheld("THE_CLOSEUP", {amount, offset})(t)` gives {pos, rot, quat} in camera axes |
| src/lens.ts | Choosing a lens in mm, a dolly zoom, or real depth-of-field blur. | `camera.fov = fovOf(50, aspect)`; `dollyZoom(d0, fov0, fov1)`; `blurPx({...})` |
| src/safe.ts | Placing captions or titles. | `safe(W, H)` gives the EBU R 95 box; `inSafe(box, W, H)` |
| src/pose.ts | Blending a character's pose keys so a joint keeps moving through a key on its way instead of stopping at each. | `throughPose(prev, a, b, next, [tp, ta, tb, tn], t)`; `addPose(a, b)`; scalars: `through(...)` in curve.ts |
| src/overlap.ts | Any character body pose: the chest, head and arms trail and settle on their own, no keys. | `const lag = overlap(poseAt, end)`; `addPose(poseAt(t), lag(t))` before hand and head IK |
| src/idle.ts | Any character body pose: breathing (faster and deeper after effort), weight shifts standing still, a dip when a fast move stops. | `const life = idle(poseAt, end, { standing })`; `addPose(poseAt(t), life(t))`; needs planted-foot leg IK |
| src/cartoon.ts | Optional, low: anticipation and follow-through on every move (Cartoon Animation Filter); reads cartoony if strong. | `const toon = cartoon(poseAt, end, { amount: 0.25 })`; `addPose(poseAt(t), toon(t))` |
| src/gaze.ts | A character's eyes: fixations, saccades that lead each head turn, eyes held on the target while the head turns, a blink with big shifts. | `gaze(shifts, end, { blinkedNear })(t, aim)` gives `{ look, blink }`; `anglesOf`, `eyeTime`; worked example in demo/main.ts |
| demo/ | Watching every character layer on scenes from a film, before and after side by side, each layer switchable. | `bun run demo`, open localhost:4350 (`?scene=dig|idle`, `?t=`, `?view=face`, `?off=gaze,cartoon`) |

- Link into a film like live-studio: `bun link` here once, `"film-kit": "link:film-kit"` in the film; import `film-kit/<name>`.
- Every module stays a pure function of film time (or bakes once); no three.js import outside tests.
- `bun test` must pass after any change; a new rule gets a test that fails without it.
- data/shakify.json is Camera Shakify's CC0 data (licence beside it); their GPL code is not used.
- Character layers stack on the body pose before hand, head and leg IK: base, + overlap, + cartoon, + idle (each baked from the same base pose function); poses with breathing written in should drop it when idle's breath is on.
- demo/film/ is a copy of one film's rig code and keys, never a link: films are not touched from here. demo/public/vendor (Mojang's Steve skin, MCprep's rig) is fetched by demo/setup.ts and gitignored; never commit it.
