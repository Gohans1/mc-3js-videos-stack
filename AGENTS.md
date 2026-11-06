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
| src/pose.ts | Blending a character's pose keys so a joint keeps moving through a key on its way instead of stopping at each. | `throughPose(prev, a, b, next, [tp, ta, tb, tn], t)`; `addPose(a, b)`; `scalePose`, `mask(spans)`, `canonical(p)`; scalars: `through(...)` in curve.ts |
| src/overlap.ts | Any character body pose: the chest, head and arms trail and settle on their own, no keys. | `const lag = overlap(poseAt, end)`; `addPose(poseAt(t), lag(t))` before hand and head IK |
| src/idle.ts | Any character body pose: breathing (faster and deeper after effort), weight shifts standing still, a dip when a fast move stops. | `const life = idle(poseAt, end, { standing })`; `addPose(poseAt(t), life(t))`; needs planted-foot leg IK |
| src/cartoon.ts | Optional, low: anticipation and follow-through on every move (Cartoon Animation Filter); reads cartoony if strong. | `const toon = cartoon(poseAt, end, { amount: 0.25 })`; `addPose(poseAt(t), toon(t))` |
| src/gaze.ts | A character's eyes: fixations, saccades that lead each head turn, eyes held on the target while the head turns, a blink with big shifts, lids that follow the eyes up and down. | `gaze(shifts, end, { blinkedNear })(t, aim)` gives `{ look, blink, lid }`; `lidOpen(lid)` adds to the face's open; `anglesOf`, `eyeTime`; worked example in demo/main.ts |
| src/attention.ts | A character who looks at something: the chest and hips join a big head turn, later and less (eyes, head, chest, hips). | `const chain = attention((t) => ({ down, yaw, w }), end)`; `addPose(pose, chain(t))` before head IK; aim from headTo |
| src/steady.ts | Any character body pose: the head holds level against fast trunk tilts (pitch and roll), not against a look. | `const s = steady(poseAt, end)`; add `s(t).head` after head IK, its pitch times (1 - look weight) |
| src/lean.ts | A character who walks or runs: the body tilts into speeding up, braking and turns. | `const l = lean((t) => ({ x, z, yaw }), end)`; `addPose(pose, l(t))` |
| src/micro.ts | Any character held still: a tiny coherent drift (Perlin) so a hold never freezes. | `const drift = micro({ seed })`; `addPose(pose, drift(t))` last |
| src/arc.ts | Hand (or any IK) targets between two keys: the path swings round the shoulder instead of a straight slide. | `arc(shoulder, keyA, keyB, k)` with the blend's own eased k; the shoulder as posed at that frame |
| src/effort.ts | One mood knob (Laban Effort: space, weight, time, flow, plus sink) that sets every layer's options. | `const fx = effort(MOOD.tense)`; pass `fx.overlap`, `fx.cartoon`, `fx.idle`, `fx.gaze`, `fx.micro`; `phrase(keys, fx.hold)`; `addPose(pose, fx.posture)` |
| demo/ | Watching every character layer on scenes from a film, before and after side by side, each layer switchable. | `bun run demo`, open localhost:4350 (`?scene=dig|idle|walk|reach|mocap`, `?mood=tense|tired`, `?t=`, `?view=face`, `?off=gaze,cartoon`) |

- Link into a film like live-studio: `bun link` here once, `"film-kit": "link:film-kit"` in the film; import `film-kit/<name>`.
- Every module stays a pure function of film time (or bakes once); no three.js import outside tests.
- `bun test` must pass after any change; a new rule gets a test that fails without it.
- data/shakify.json is Camera Shakify's CC0 data (licence beside it); their GPL code is not used.
- Character layers stack on the body pose: base, + overlap, + cartoon, + idle, + lean, + mood posture, + attention (each baked from the same base pose function); then leg, head and hand IK with steady and micro added after the head; poses with breathing written in should drop it when idle's breath is on.
- Mocap clips (Mixamo, UAL) already carry overlap, breath, sway and drift: fade those layers out over each clip span with `scalePose(layer(t), mask(spans)(t))`; gaze, lids, blinks and attention stay on. Blend into and out of clips by quaternion slerp (the film's slerpPose), never Euler lerp.
- A baked layer reads its input through `canonical()` (pose.ts): slerped poses come out with the same rotation spelled two ways (x, y, z) and (180 - x, y + 180, z + 180), and a spring chasing that jump whips the joint.
- demo/film/ is a copy of one film's rig code and keys, never a link: films are not touched from here. demo/public/vendor (Mojang's Steve skin, MCprep's rig) and demo/public/motion (two Mixamo clips: free in a film, never redistributed as files) are fetched by demo/setup.ts and gitignored; never commit them.
