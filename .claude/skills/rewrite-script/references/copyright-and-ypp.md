# Copyright, YouTube YPP & Clean-Room Rewriting

Avoiding 3-word overlap alone does **not** make a rewritten script legally safe
or monetizable on YouTube. Treat originality as a structural discipline, not a
synonym-swapping filter.

## 1. Gate 0 — Source Risk Triage (`content_risk`)

Classify every source script before writing a single word:

- **`green` — Pure Fact / Science / Historical / Real News Event**
  - Under U.S. copyright law (`17 U.S.C. §102(b)`) and *scènes à faire*, facts,
    scientific mechanisms, and indispensable chronological steps of a real event
    are unprotectible.
  - Safe to rewrite cleanly as long as you discard the source's phrasing,
    sentence rhythm, hook framing, and original analogies.

- **`yellow` — Real Facts Wrapped in Strong Creative Framing**
  - Example: a science explainer built around a creator's unique metaphor,
    personal joke, or signature twist structure.
  - Strip out the creator's custom metaphors and jokes completely; keep only the
    verifiable underlying facts and visible on-screen events, then invent your
    own everyday framing.

- **`red` — Original Creative Fiction / Comedy Skit / 1:1 Visual Clone + Light Paraphrase**
  - Copying a fictional plot's original beats and twists while merely swapping
    synonyms can still be **non-literal substantial similarity / unauthorized
    derivative work** (`17 U.S.C. §106(2)`).
  - Separately from copyright/Content ID, **YouTube Partner Program (YPP)
    Reused & Inauthentic Content policy (updated July 15, 2025)** demonetizes
    channels that take someone else's video or script, make minimal edits, and
    publish interchangeable copies — especially high-risk if the 3D visuals
    also mirror a reference video shot-for-shot.
  - **Action when `red`:** Stop and warn the user clearly before proceeding.
    Recommend changing the angle, adding original commentary/context, or
    re-structuring the narrative instead of doing a light paraphrase.

## 2. Clean-Room 2-Pass Method

Never edit the original script line-by-line in place. Editing in place anchors
your brain to the source's clause order and produces "thesaurus spin."

1. **Pass 1 — Visual-Event & Raw-Fact Extraction:**
   - Read `shots.json` (and inspect key frames of long shots).
   - Write down **only** neutral bullet facts + visual timestamps:
     `[0.0–4.3s] woman jumps from plane with group; [7.2–12.5s] another jumper's leg hits her helmet, she goes limp`.
   - List unavoidable visible concrete nouns in `allow_words` (e.g., `plane`,
     `helmet`, `parachute`, `timer`, `pressure cooker`).
2. **Pass 2 — Hide Source Prose & Draft Fresh:**
   - Close or ignore the original text.
   - Open with a **different hook angle** grounded in Frame 0 (e.g., lead with
     the stake, the mystery, or the unexpected mistake rather than mirroring
     `"She jumped from a plane..."`).
   - Change sentence boundaries: split dense multi-clause lines into short
     spoken beats; combine trivial connectors; invent fresh plain-English
     explanations of *why* things happen.

## 3. Bad (Thesaurus Spin) vs. Good (Clean-Room) Example

### Original Source
> "She jumped from a plane with a group of skydivers, but as they fell, one
> accidentally drifted towards her. And before she could get away, his leg
> slammed into her helmet, knocking her unconscious. She began spinning toward
> the ground while a third skydiver raced down after her, but he couldn't catch
> her because he had to open his own chute, leaving her falling alone."

### BAD — Clause-by-Clause Thesaurus Spin (Even with Zero 3-Grams!)
> "She leaped out of a plane with other skydivers, and as they dropped, one guy
> drifted right into her. Before she could move away, his foot smashed her
> helmet, making her black out. She started spinning toward the ground while
> another diver chased after her, but he missed her because he opened his own
> parachute, leaving her dropping by herself."

**Why this FAILS:**
- Clones 100% of the clause order, beat transitions, and phrasing skeleton
  (`"Before she could..."`, `"his foot smashed her helmet, making her..."`,
  `"leaving her dropping by herself"`).
- High lemmatized content Jaccard and high content ROUGE-L sequence overlap.
- Feels interchangeable to both human viewers and YouTube's Reused Content
  reviewers.

### GOOD — Clean-Room Plain Spoken Rewrite
> "Right after leaving the plane, a normal group jump turned deadly. One man
> slid off course straight toward her path. She had zero time to dodge. His
> boot clipped her helmet and knocked her out cold. Limp and spinning fast, she
> dropped toward the trees. A teammate dove hard to grab her ripcord, but the
> ground got too close. To stay alive, he pulled his own cord and watched her
> fall past."

**Why this PASSES:**
- Opens with an immediate Frame-0 stake instead of copying `"She jumped from a plane..."`.
- Splits dense clauses into crisp, bursty spoken beats (`6–13` words) that fit
  the exact visual cuts (`exit -> drift -> impact -> spin -> chase -> chute`).
- Plain Grade 4–5 everyday words (`slid off course`, `out cold`, `dove hard`,
  `pull his own cord`) — zero awkward thesaurus swaps.
- Near-zero n-gram overlap, low non-prop Jaccard, and low content ROUGE-L.

## 4. Multi-Layer Anti-Copy Audit Thresholds

Enforced deterministically by `scripts/audit_rewrite.py`:

- **Exact all-word 4-gram overlap:** `0` (`[Hard Stop]`).
- **Lemmatized 3-content-word n-gram overlap** (stopwords removed, `allow_words`
  kept so prop+verb triples cannot be copied verbatim): `0` (`[Hard Stop]`).
- **Lemmatized content-word Jaccard** (excluding `allow_words` and proper nouns):
  - Per-beat `<= 0.40` (evaluated only when `shared_count >= 2` so short 5-word
    beats don't false-fail on a single common verb).
  - Full-script `<= 0.32` (`[Guardrail]`).
- **Content ROUGE-L F1** (`2 * LCS / (|before| + |after|)` on lemmatized content
  words excluding `allow_words` and proper nouns): `<= 0.35` (`[Guardrail]`).
  Catches word-order cloning even when filler words are inserted between copied
  terms.
