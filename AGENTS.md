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
| src/shotcheck.ts | After any camera or edit change: finds jump cuts, 180-degree breaks, fast pans, bad framing. | Add `draw.checks.shots = (a, b) => shotcheck({...})`, run `CHECK=shots:0,END bun run render stills`; silent means clean |
| src/shotcheck.ts | Reading the edit: one line per shot with length, lens and framing. | `shotlist({...})` the same way, `CHECK=shotlist:0,END` |
| src/safe.ts | Placing captions or titles. | `safe(W, H)` gives the EBU R 95 box; `inSafe(box, W, H)` |

- Link into a film like live-studio: `bun link` here once, `"film-kit": "link:film-kit"` in the film; import `film-kit/<name>`.
- Every module stays a pure function of film time (or bakes once); no three.js import outside tests.
- `bun test` must pass after any change; a new rule gets a test that fails without it.
- shotcheck reports, the director decides: a warning may be a deliberate choice (a montage crossing the line).
- data/shakify.json is Camera Shakify's CC0 data (licence beside it); their GPL code is not used.
