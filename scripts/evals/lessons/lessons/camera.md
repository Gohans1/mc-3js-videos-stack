# Camera

## No roll unless the story asks

A tilted horizon makes viewers dizzy. Keep roll at 0 except for a deliberate Dutch angle.

## The camera never passes through blocks

Check every move against the world: no flying through walls, ground or leaves.

## Shake is earned

Use handheld presets in cam.json (find --kind shake) sparingly for intimate/tense shots, and shots.json hits ([{ t, amount, decay }]) strictly on physical impacts. A calm shot stays steady.

## Match focal length and aperture to story beats

Drive focal length cleanly via mm in cam.json (find --kind lens: 24mm for space, 50-85mm for reaction). When using shallow DOF fstop + focus ("Steve.head"), verify subject sharpness with CHECK=seen.

## Emotion = slow push-in

Push in slowly on a face for a feeling; never a fast zoom for drama.
