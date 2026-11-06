# film-kit

Motion building blocks for films drawn with `draw(t)` ([live-studio](https://github.com/Gohans1/live-studio)): every function is pure in film time, so any frame renders on its own; each file's header says what it does and whose method it follows.

- `film-kit/curve`: keyframes that keep their speed through keys (Blender Auto Clamped / PCHIP), with stop, hold and linear keys.
- `film-kit/spring`: exact springs to targets and kicks (`springTrack`), and a baked chase of a moving target (`follow`).
- `film-kit/transition`: switching motions without a pop or a dead stop (Bollo's inertialization, `chain`).
- `film-kit/shake`: camera shake from hits (Eiserloh's trauma × noise).

A film links it like live-studio (`bun link` here, `"film-kit": "link:film-kit"` there); `bun test` checks every module by numbers.
