# Still-Frame Field-Split Audit (AI Studio Route)

Use timecoded JPEGs for scene dailies and full-film visual review. Hydrogen High returned all frame counters in the 150-, 300-, and 450-image readback tests. The short 550-image probe verified delivery and the reported frame range. Evidence is recorded in [prompt-design.md](prompt-design.md) and `stillFrameAuditAistudio20261126` in [eval-baseline.json](eval-baseline.json).

## Recipe

1. Package the scene from the film directory: `bun run reference frames references/ref.mp4 renders/draft.mp4 --range 12,32`. For a standalone scene starting at film time 12 s, pass `--start 12` instead. Studio `span` and `chunk` exports auto-align to the reference: omit `--range` on a `span_*.mp4` to avoid 30 fps 2-decimal rounding errors, and floor `--range` end to `min(refEnd, remEnd)` on full-video slices. The command burns film timecode into each REF-left/OURS-right JPEG, prints `list.txt` or numbered lists in a fresh run folder, and warns on stderr if the remake was rendered with `--samples 1`. Do not concatenate `list.txt` files from separate runs: every run writes `f000001.jpg...` and `ask.ts` rejects duplicate basenames. Outside this repo, generate the same labeled composite and absolute-path lists with your local tools.
2. Use 15 fps for scene dailies (up to 300 images in 20 s). Keep each prompt to one list of at most 450 images (30 s at 15 fps). Keep the numbered lists separate for longer scenes. Use `--fps native` over a short range around a cut or motion pop. The [550-image stress test](prompt-design.md#batch-capacity-follow-up-2026-11-26) used a short frame-count response.
3. Submit each list in order (serially in one tab — concurrent tabs trigger CDP upload timeouts) with Hydrogen High, High media, and Search off. Start a fresh chat for each pass and save its report beside the list. `--upload-timeout-min` defaults to `15` (`ask.ts`). Use the example below for a quick scan (`review-001.md`). For a detailed audit, reuse the same `list.txt` ONLY across prompts auditing the exact same frozen render (`review-001-acting.md`, etc.) — re-run `bun run reference frames` after any re-render.
4. Merge findings on the burned film clock and verify them on the reviewed render at source FPS ([Step 5](../SKILL.md#review-gate--iterative-qa-loop)). Check audio locally. Keep completed reports and mark missing windows or fields pending. Recover an already-started chat before resending. For overload or truncation, retry a shorter window on Hydrogen High. On failures at the `copy answer` step, inspect the saved failure screenshot to distinguish a daily quota card from a transient CDP error, and resume pending passes after quota recovers. See [AI Studio error recovery](../../aistudio/SKILL.md#common-errors--recovery).

```bash
ASK --tab scene-review --batch --files-from <absolute-list-path> --model gemini-4-hydrogen --thinking High --media High --tool search=off --out <run-dir>/review-001.md "Review the visual differences in this scene window. REF is on the left and OURS is on the right. Read the burned timecodes in chronological order regardless of attachment order. Return a concise list of visible issues with timecode, REF evidence, and OURS evidence. Mark uncertain timing for local verification."
```

`ASK` is `bun .claude/skills/aistudio/scripts/ask.ts` from the repository root. Quote list and report paths that contain spaces. Use a unique tab per active review. If generation already started when collection failed, recover the same chat via `--chat <url-or-id>` or `--collect`. Close your tab after saving the report with `bun .claude/skills/aistudio/scripts/studio.ts tab close <tab>`. If you override the layout, name the actual panel positions in the prompt.

## Single-Source Stills

For a reference-only breakdown or an original film, use a single panel directly with `bun run reference frames`:

```bash
bun run reference frames references/ref.mp4 --range 0,30 --fps 15 --label REF
```

Repeat with `--range 30,60` (etc.) or omit `--range` to auto-split into <=450-image `list-001.txt`, `list-002.txt` batches in a fresh run folder with burned timecode and frame counter (`--label OURS` for original renders). Single-source mode auto-strips the studio draft bottom bar on canonical draft renders (`renders/draft.mp4`, `renders/draft_video.mp4`, `renders/chunks/c<N>.mp4`, `renders/span_<from>-<to>.mp4`), auto-aligns canonical spans/chunks (including `renders/final_chunks/c<N>.mp4`) to their film-time start (`--range` takes film seconds; omit `--range` on `span_*.mp4` to avoid 30 fps 2-decimal rounding errors; external, copied/renamed, and full-film videos start at `0`, and non-canonical copies like `renders/draft_v2.mp4` are not auto-cropped), and warns on stderr if the rendered film input used `--samples 1`. Outside this repo, burn film timecode and extract `fps=15:round=up` JPEGs into `list.txt` (1-450 images per window) with your local tools.

Upload each list with the same Hydrogen High settings and use the single-source prompt from the calling skill. Check visual events at source FPS and listen to audio locally.

## Prompt Template

Replace `<TARGET STYLE>` and `<SCOPE>` with one field below. For an intentional all-fields scan, list all scopes and ask for the field name in each finding. In the completed 305-image, 10 fps, Extra High benchmark, the grouped arm caught 18/36 notes across the five matched fields and separate passes caught 32/36. The 15 fps grouped-versus-split follow-up has no scored pair because it hit the daily quota. [Evaluation details](prompt-design.md#batch-capacity-follow-up-2026-11-26)

```text
You compare a reference video (REF) with a remake (OURS) using still frames.
Every attached image is one moment: REF on the LEFT panel, OURS on the RIGHT panel, and a bottom bar with the timecode (HH:MM:SS.mmm) and frame counter (f<n>). Images may arrive in any order; order them by the bottom-bar timecode.

The remake is intentionally built in <TARGET STYLE>. Ignore ONLY what that style forces on shapes and textures. Everything else must match REF as closely as possible, so do not excuse differences as "stylistic".

Audit ONLY this scope:
<SCOPE>

Rules:
- Check every image. Report every moment where OURS differs from REF within the scope, including differences that last only a few frames.
- Each finding must cite the bottom-bar timecodes where it starts and ends and describe what REF shows and what OURS shows. Report only what is visible; never invent.
- Merge consecutive images showing the same difference into one finding with a time span.

Output format, one finding per line, nothing else:
- [MM:SS.mmm-MM:SS.mmm] <Major|Minor> | <field> | REF: <what REF shows> | OURS: <what OURS shows>
If there is no difference in scope, output exactly: NO DIFFERENCES
```

## Field Scopes

| Field | Scope text |
| --- | --- |
| `direction` | Screen direction and handedness: which way each character, animal or vehicle travels across the frame (screen-left/right, toward/away from camera); which way bodies, faces and directional props point; which hand performs each action (report the SCREEN SIDE the hand is on and whether the character faces the camera); whether OURS looks horizontally mirrored versus REF. |
| `camera` | Shot scale and subject size in frame, camera distance, height and angle, tilt/roll and horizon level, lens feel, what is inside vs outside the frame (missing or extra subjects), and camera movement across consecutive frames (push-in, pull-out, pan, orbit, zoom, its direction and speed). |
| `set` | The environment and everything behind the subject: terrain, sky, coastline, street and buildings, water, room, walls, floor, furniture size, background props and people; anything missing, extra, or of clearly different shape, size, layout or colour. |
| `asset` | Is every hero object and character in OURS clearly recognisable as the same thing REF shows? Overall shape, proportions, 3D volume versus flat/2D look, broken or disconnected parts, and any object whose identity a viewer cannot tell. |
| `lighting` | Key light direction and hardness, sun/sky look, exposure and contrast, colour temperature and palette, the colours of specific things (clothes, road, paper, floor, water), material realism (water surface, reflections), haze/atmosphere. |
| `optics` | Which plane is in sharp focus and what is blurred, amount of depth of field and background blur, focus changes over time, motion blur present in REF but missing in OURS or the opposite. |
| `acting` | Body pose, gesture and action, what each hand holds, facial expression, gaze and eye contact with the camera, gait (stride length, cadence), speed and smoothness between consecutive frames, sudden pops or teleports of limbs, faces or props, and contact problems such as a hand passing through an object. |
| `text` | Caption wording, when each caption appears and disappears, legibility, size relative to frame, font style, weight, outline and position. |
| `transition` | Where one shot ends and the next begins, and the type of change (hard cut, dissolve, whip pan, zoom, slide), its direction and timing. |

## Fast-Event Prompt (30 FPS Windows)

Swap the scope and output for this when a window holds cuts or fast action:

```text
Audit ONLY fast events that a 1-frame-per-second look would miss. Compare consecutive images.
1. Every shot transition (cut, dissolve, wipe, slide, whip) in REF and in OURS: the first and last frame counter of each transition and its type.
2. Every moment where a character, limb, head or object in OURS jumps, flips or teleports to a new position within 5 frames or fewer.
3. Every caption change whose timing differs between REF and OURS by 3 frames or more.
Cite only frame counters you actually read from the bottom bar. Never invent.
Output one finding per line, nothing else:
- [f<start>-f<end>] <transition|pop|caption> | REF: <what REF does> | OURS: <what OURS does>
```

## Scoring Note

Time-overlap recall is meaningless here: one blanket row (e.g. a caption-style finding spanning `0-30 s`) "covers" every note, so the all-fields run scored 100% by overlap but 44% by meaning. Judge each creator note by hand as hit, partial or miss.
