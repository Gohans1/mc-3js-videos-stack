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
| src/gaze.ts | A character's eyes: fixations, saccades that lead each head turn, eyes held on the target while the head turns. | `gaze(shifts, end)(t, aim)` gives the face's look; `anglesOf`, `eyeTime`; worked example in demo/main.ts |
| demo/ | Watching the character layers on a scene copied from a film, before and after side by side. | `bun run demo`, open localhost:4350 (`?t=`, `?view=face`, `?off=gaze`) |

- Link into a film like live-studio: `bun link` here once, `"film-kit": "link:film-kit"` in the film; import `film-kit/<name>`.
- Every module stays a pure function of film time (or bakes once); no three.js import outside tests.
- `bun test` must pass after any change; a new rule gets a test that fails without it.
- data/shakify.json is Camera Shakify's CC0 data (licence beside it); their GPL code is not used.
- demo/film/ is a copy of one film's rig code and keys, never a link: films are not touched from here. demo/public/vendor (Mojang's Steve skin, MCprep's rig) is fetched by demo/setup.ts and gitignored; never commit it.
