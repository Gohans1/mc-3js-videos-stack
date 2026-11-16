---
when: camera moves, angles, zooms, shake, roll
---

# Camera

## No roll unless the story asks

A tilted horizon makes viewers dizzy. Keep roll at 0 except for a deliberate Dutch angle.

## The camera never passes through blocks, walls, ground or leaves

Check every move against the world.

## Shake only on impact or panic, and small

Use handheld presets in cam.json (find --kind shake) sparingly for intimate/tense shots, and shots.json hits ([{ t, amount, decay }]) strictly on physical impacts. A calm shot stays steady.

## Match focal length and aperture to story beats

Drive focal length cleanly via mm in cam.json (find --kind lens: 24mm for space, 50-85mm for reaction). When using shallow DOF fstop + focus ("Steve.head"), verify subject sharpness with CHECK=seen.

## Emotion = slow push-in on a face, never a fast zoom

Push in slowly on a face for a feeling; a fast zoom for drama reads cheap.
