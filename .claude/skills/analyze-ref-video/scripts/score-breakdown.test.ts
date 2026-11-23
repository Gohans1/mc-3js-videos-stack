import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCORER = fileURLToPath(new URL("./score-breakdown.ts", import.meta.url));

const GOOD_MD = `### 1. Global Craft DNA
- **Edit Rhythm & Hook:** Brisk pacing with 1 \`Hard Cut\`, 1 \`Hidden Cut\`, 1 \`Transition\`, and 1 \`Continuous [NO CUT]\`.
- **Camera, Lens & Optics:** Damped gimbal with wide-angle framing; clean render, no optical grit.
- **Acting, Motion & Look-Dev:** Snappy ease-out motion, soft diffuse shadows, subtle haze.
- **Soundscape:** Continuous upbeat BGM bed with voiceover pauses and audible J-cut bridge.
- **Secret-Sauce Cues (Clone-Betrayal):** Subtle 2-frame impact hit-stop right before the latch snaps.

### 2. Shot & Beat Spine (Full Timeline)
| ID | Time & Frames | Boundary | Camera, Framing & Optical Feel | Action & Staging Beat | Conf |
| --- | --- | --- | --- | --- | --- |
| S01 | 00:00.000–00:02.000 (f0–f60) | Opening | Medium-wide low wide-angle, damped push-in | Character enters hallway | High |
| S02a | 00:02.033–00:04.000 (f61–f120) | Hidden Cut (whip pan right, f59–f62) | High-angle macro, shallow DOF | Hand snaps latch with ease-out settle | High |
| S02b | 00:04.033–00:06.000 (f121–f180) | Continuous [NO CUT] (dolly push-in) | Smooth dolly push-in, normal lens | Lid lifts with overshoot | High |
| S03 | 00:06.033–00:08.000 (f181–f240) | Transition (cross-dissolve, f181–f188) | Wide eye-level normal lens | Door opens to room | High |
| S04 | 00:08.033–00:10.000 (f241–f300) | Hard Cut | Telephoto close-up | Final reaction hold | High |

### 3. Craft & Blind-Spot Delta Ledger (Chronological)
| Time & Frames | ID | Category | Craft & Observable Behavior | Conf |
| --- | --- | --- | --- | --- |
| 00:02.033–00:02.200 (f61–f66) | S02a | Motion, Acting & Prop State | **Snap Latch:** Sharp snap acceleration with slight overshoot settle. | High |
| 00:06.033–00:06.267 (f181–f188) | S03 | Audio-Visual Sync & Soundscape | **J-Cut Bridge:** Room ambience leads the dissolve by 0.2s. | Med |
| 00:08.100–00:08.300 (f243–f249) | S04 | Other | **Impact Hit-Stop:** Two-frame freeze hold accents the punchline. | High |

### 4. Pre-Build Traps & Local Verification Watchlist
- **Ambiguous boundaries:** Check whip smear across f59-f62 on native 30fps frames.
- **Audio/SFX stem checks:** Verify subtle latch click masked by voiceover at f61.
`;

test("score-breakdown awards 25/25 Pillar 1 and 25/25 Pillar 2 on clean breakdown", () => {
  const dir = mkdtempSync(join(tmpdir(), "analyze-score-"));
  try {
    const md = join(dir, "good.md");
    const scenes = join(dir, "scenes.json");
    writeFileSync(md, GOOD_MD, "utf8");
    writeFileSync(
      scenes,
      JSON.stringify({
        scenes: [
          { scene: 1, startFrame: 0, startSeconds: 0 },
          { scene: 2, startFrame: 61, startSeconds: 2.03 },
          { scene: 3, startFrame: 181, startSeconds: 6.03 },
          { scene: 4, startFrame: 241, startSeconds: 8.03 },
        ],
      }),
      "utf8",
    );
    const r = spawnSync("bun", [SCORER, md, "--scenes", scenes, "--duration", "10", "--json"], {
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    const data = JSON.parse(r.stdout);
    assert.equal(data.pillar1Max25.total, 25);
    assert.equal(data.pillar2Max25.score, 25);
    assert.equal(data.issues.length, 0);
    assert.equal(data.gtSamplingPlan.recallSlotsSec.length, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("score-breakdown catches style/engine leaks, fake mm, count mismatch, and order bugs", () => {
  const dir = mkdtempSync(join(tmpdir(), "analyze-score-bad-"));
  try {
    const bad = GOOD_MD.replace("1 `Hard Cut`", "3 `Hard Cut`")
      .replace("wide-angle framing", "35mm Minecraft blocky framing in draw(t)")
      .replace("00:08.100–00:08.300 (f243–f249)", "00:01.000–00:01.200 (f30–f36)")
      .replace("00:06.033–00:06.267 (f181–f188)", "00:00.000–END (f0–f300)");
    const md = join(dir, "bad.md");
    writeFileSync(md, bad, "utf8");
    const r = spawnSync("bun", [SCORER, md, "--json"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const data = JSON.parse(r.stdout);
    assert.ok(data.pillar1Max25.total < 20, `expected <20, got ${data.pillar1Max25.total}`);
    assert.ok(data.metrics.leaks.length >= 1);
    assert.ok(data.metrics.fakeMmHits.length >= 1);
    assert.ok(data.metrics.countMismatches.length >= 1);
    assert.ok(data.metrics.sec3OrderViolations >= 1);
    assert.equal(data.metrics.audioCatchAll, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
