# Critic lens: Director (the one review pass)

The default review of a film is this one pass against the checklist below (`references/review-loop.md` §1). Fill every
`{{FIELD}}` and hand the file to a subagent, or follow it yourself with the sheet open before any code. The other
lenses in this folder (`forensics.md`, `sound-sync.md`, `detail.md`, `verifier.md`) are optional: run them when the user
asks for a deeper review or a gate keeps failing in their area.

## Context

- Film: {{FILM}}, {{SPEC}} (for example `1920x1080@30, 24 s, 112 BPM`). The subject in one line: {{PRODUCT}}
- Project root: {{ROOT}}. Read `BRIEF.md` and the timeline (`timeline/*.json` / `src/scene.ts`) after reading the
  contact sheet, not before.
- File under review: {{VIDEO}} (preview or master). Frame = t x {{FPS}}.
- The contact sheet: {{SHEET}} (`python3 scripts/sheet.py`, labelled tiles over the film), and the gate reports in
  {{QA}} (`forensics.py`, `look-audit.py`, `check-sync.py`, `av-audit.py`, `grid-check.ts`).
- Round {{ROUND}}. Changed since the last round: {{CHANGED}}. Already fixed, do not re-report: {{FIXED}}

The brief, word for word:

```
{{BRIEF}}
```

## The pass

1. **The picture alone first.** Read the sheet with the words ignored (cover them, or inspect only the 3D shot beats).
   For each shot beat write one line: what happens physically in the 3D space. A beat that reads "nothing happens" or
   "camera floats aimlessly" gets real 3D staging and action before any word is added.
2. **Then the checklist.** Every item is a yes or a no with frames. A no is a P0 on the hook, a shot's core action,
   the end card or a hard ban; a P1 elsewhere.

### The checklist

1. **Words in the middle.** Every standalone statement centred in the middle band (35-65 % height) for 85 % of its hold;
   none flush left at top or bottom unless motivated by a lower-third title over a full-bleed 3D shot.
2. **Line, then 3D action.** Type beats and 3D visual beats complement rather than duplicate each other; first hook
   visible by 1 s; no caption repeating what the 3D action already shows clearly.
3. **One face, rotating voices, quiet emphasis.** Statements share one primary font family while rotating entrance/exit
   voices (`wordRise`, `clipRise`, `oversize`, `inkIn`, `scramble`, etc.); emphasis (accent tint or shape mark) on at
   most two lines; zero text overlap or clipping.
4. **Seams that flow.** Every cut carries momentum, focus, light or a shared subject (`seam` paired `ANIMS` or optical
   `TRANSITIONS`); no accidental slow cross-dissolve across unrelated 3D scenes; no seam kind over 40 % of cuts
   (`forensics.py --seams`).
5. **Clean 3D staging & framing.** Clear silhouettes, readable focal subject, zero z-fighting, zero unintentional mesh
   clipping, zero HUD/text collisions with key 3D action.
6. **Marks & end card.** Extruded 3D marks or official vectors (`trace-logo.py` / `logos.mjs`) clean and bevelled; end
   card centred, creeping gently (`creepIn`) while music rings out, never a generic star/sparkle stand-in.
7. **Its own film.** Camera grammar, world palette, seam set and title voices feel authored for this story, never a
   copy-paste replay.
8. **Words a stranger reads.** 1-5 words a line typically, 2-7 at most; plain, concrete language; zero hype clichés.
9. **Less text.** No text in 15 % of frames or more; at most two text elements on screen at once.
10. **The 3D picture tells it.** With words covered (step 1), every shot beat communicates the story through staging,
    camera perspective and lighting.
11. **Colour & light.** Coherent world palette, motivated key + rim + fill light, at least one light/value event per
    act, settled text contrast >= 4.5:1, zero 8-bit sky/ground banding.
12. **Premium, not just clean.** Depth falloff between near/mid/far 3D planes, front-loaded camera moves that land
    cleanly (else locked still — zero aimless float), directional shutter smear only on fast velocity peaks.
13. **Time.** Rank fixes by visual impact per minute against remaining budget.

Then name **the weakest 3 seconds** and why, and any **hard bans** (`SKILL.md` "Hard bans").

## Rules

- At most 10 changes, ranked by impact per minute. Every change is concrete: the file, shot/keyframe/cue id, and exact
  numbers.
- Never propose adding filler text; propose stronger 3D staging, camera framing, lighting, or tighter copy.
- Read the contact sheet first, and grab single full-res frames (`bash scripts/grab.sh`) only to confirm a finding.
- Do not list what is fine. Do not re-report fixed issues.

## Return

JSON only. `frame` is a frame number or an `"a-b"` range; `item` is the checklist number (or `ban`, `weakest`).

```json
{
  "pictures": [
    {
      "beat": "a1",
      "frame": "120-260",
      "reads": "yes | partly | no",
      "what": "the memo becomes three tasks"
    }
  ],
  "checklist": {
    "1": "yes",
    "2": "no: 1 type-only beat",
    "3": "yes",
    "4": "yes",
    "5": "yes",
    "6": "yes",
    "7": "yes",
    "8": "yes",
    "9": "yes",
    "10": "partly",
    "11": "n/a",
    "12": "no",
    "13": "52 min"
  },
  "issues": [
    {
      "id": "short-kebab-id",
      "item": "2",
      "priority": "P1",
      "frame": "300-420",
      "problem": "what the viewer sees and why it hurts",
      "fix": { "file": "scene.ts", "change": "the edit, with values" }
    }
  ],
  "weakest": "frames and why",
  "overall": "3-5 sentences: what is great, what most holds it back",
  "score": 7.5
}
```
