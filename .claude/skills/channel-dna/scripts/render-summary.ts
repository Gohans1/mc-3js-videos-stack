import type { aggregateCorpus, CategoryBucketStat } from "./aggregate.ts";
import type { CatalogBandStat } from "./catalog-metrics.ts";
import { CAMERA_ANGLES, SHOT_SCALES } from "./types.ts";

const fmtPct = (v: number | null): string => (v === null ? "-" : `${v}%`);
const fmtSec = (v: number | null): string => (v === null ? "-" : `${v}s`);
const fmtOutlier = (v: number | null): string => (v === null ? "-" : `${v}x`);
const fmtValN = (v: number | null, n: number): string => (v === null ? `- (${n})` : `${v} (${n})`);
const fmtDelta = (v: number | null): string => (v === null ? "-" : `${v > 0 ? "+" : ""}${v}`);
const fmtP = (v: number | null): string => (v === null ? "-" : v < 0.001 ? "<0.001" : v.toFixed(3));
const fmtPQ = (p: number | null, q: number | null): string =>
  p === null ? "-" : q === null ? fmtP(p) : `${fmtP(p)} (${fmtP(q)})`;
const fmtBase = (w: number | null, f: number | null): string =>
  w !== null && f !== null ? `; subsample base: W=${w}%, F=${f}%` : "";
const cleanCell = (raw: string): string =>
  raw
    .replace(/[\r\n|]+/g, " ")
    .replace(/\*\*|`/g, "")
    .replace(/\s+/g, " ")
    .trim();

export function renderStatsSummaryMd(stats: ReturnType<typeof aggregateCorpus>): string {
  const c = stats.catalogTelemetry;
  const d = stats.deepDna;
  const p = d.pacingAndTiming;
  const v2 = d.v2DeepDna;
  const v3 = d.v3DeepDna;
  const bucketRows = (list: CategoryBucketStat[], prefix = "") =>
    list.map(
      (b) =>
        `| ${prefix}${b.key} | ${b.count} (${b.reliability}) | ${b.pct}% | ${fmtOutlier(b.medianOutlier)} | ${fmtPct(b.winnerSharePct)} | ${fmtPct(b.flopSharePct)} | ${b.winnerToFlopLift ?? "-"} | ${fmtDelta(b.winnerMinusFlopPp)} | ${fmtPQ(b.pValue, b.qValue)} |`,
    );
  const bandRows = (list: CatalogBandStat[]) =>
    list.map(
      (b) =>
        `| ${cleanCell(b.band)} | ${b.n} (${b.reliability}) | ${b.sharePct}% | ${b.winnerPct}% (${fmtDelta(b.winRateDeltaPp)}pp) | ${b.flopPct}% | ${fmtOutlier(b.medianOutlier)} | ${b.medianViews !== null ? b.medianViews.toLocaleString("en-US") : "-"} | ${fmtPQ(b.pValue, b.qValue)} |`,
    );
  const crossRows = (
    tab: Record<
      string,
      {
        n: number;
        medianOutlier: number | null;
        breakdown: Array<{
          key: string;
          count: number;
          pct: number;
          medianOutlier: number;
          winnerCount: number;
          flopCount: number;
        }>;
      }
    >,
  ) =>
    Object.entries(tab).map(([topic, info]) => {
      const top = info.breakdown
        .slice(0, 3)
        .map(
          (x) =>
            `${x.key} ${x.count}/${info.n} (${x.pct}%, ${x.medianOutlier}x, W:${x.winnerCount}/F:${x.flopCount})`,
        )
        .join("; ");
      return `| ${topic} | ${info.n} | ${fmtOutlier(info.medianOutlier)} | ${top || "-"} |`;
    });

  const provSuffix =
    d.tierCounts.provisional > 0 ? `, ${d.tierCounts.provisional} Provisional` : "";
  const audioSuffix =
    d.audioVerifiedCount < d.minedCount
      ? `; audio-verified N=${d.audioVerifiedCount}/${d.minedCount}`
      : "";
  const fpsSuffix =
    d.macroLowFpsCount > 0
      ? `; micro-FPS N=${d.microFpsSampleN}, macro-lowFPS N=${d.macroLowFpsCount}`
      : "";
  const v2Suffix = v2.v2Count > 0 ? `; schema v2+ N=${v2.v2Count}` : "";
  const v3Suffix = v3.v3Count > 0 ? `; schema v3 N=${v3.v3Count}` : "";
  const schemaFilterNote =
    d.minSchema > 1 ? ` Deep DNA includes schema versions >= ${d.minSchema}.` : "";

  const fg = c.formatGeometry;
  const geomParts: string[] = [];
  if (fg.aspectSampleN > 0) {
    const aspectSummary = fg.aspectBuckets
      .slice(0, 3)
      .map((a) => `${a.bucket} ${a.pct}%`)
      .join(", ");
    geomParts.push(
      `Aspect geometry (N=${fg.aspectSampleN}): dominant ${fg.dominantAspect} (${aspectSummary})`,
    );
  }
  if (fg.fpsSampleN > 0) {
    const fpsSummary = fg.fpsBuckets
      .slice(0, 3)
      .map((f) => `${f.bucket} ${f.pct}%`)
      .join(", ");
    geomParts.push(
      `Native FPS (N=${fg.fpsSampleN}): median ${fg.medianNativeFps ?? "-"} fps (${fpsSummary})`,
    );
  }

  const wLike = c.byTier.winner.medianLikeRate;
  const fLike = c.byTier.flop.medianLikeRate;
  const dilutionNote =
    wLike !== null && fLike !== null && wLike < fLike
      ? "Note: Winner median like rate is lower than Flop median like rate — classic Broad-Audience Dilution as viral reach pushes beyond core subscribers."
      : null;

  const lines: string[] = [
    `# Channel DNA Statistics: ${stats.channel}`,
    "",
    `Catalog snapshot ${c.snapshotDate}: ${c.totalCollected} items collected (${c.matureCount} mature >= 30 days, ${c.matureEnrichedCount} mature / ${c.enrichedCount} total enriched metadata, ${c.matureTranscriptCount} mature / ${c.transcriptCount} total spoken transcripts/WPM, global mature median ${c.globalMatureMedianViews.toLocaleString("en-US")} views). Deep visual and narrative DNA sample: N=${d.minedCount} (${d.tierCounts.winner} Winner, ${d.tierCounts.median} Median, ${d.tierCounts.flop} Flop${provSuffix}${audioSuffix}${fpsSuffix}${v2Suffix}${v3Suffix}).${schemaFilterNote}`,
    "",
    ...(geomParts.length > 0 ? [`${geomParts.join(". ")}.`, ""] : []),
    "## Full-Catalog Winners vs Flops (yt-dlp + transcripts, explicit subsample N)",
    "",
    "| Tier | Count | Median Views | Rolling Outlier | Duration s (N) | WPM (N) | Word Count (N) | Like Rate % (N) | Comment Rate % (N) | Cmt/Like % (N) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...(["winner", "median", "flop"] as const).map((t) => {
      const s = c.byTier[t];
      return `| ${t} | ${s.n} | ${s.medianViews !== null ? s.medianViews.toLocaleString("en-US") : "-"} | ${fmtOutlier(s.medianOutlier)} | ${fmtValN(s.medianDurationSec, s.durationSampleN)} | ${fmtValN(s.medianWpm, s.wpmSampleN)} | ${fmtValN(s.medianWordCount, s.wordCountSampleN)} | ${fmtValN(s.medianLikeRate, s.likeRateSampleN)} | ${fmtValN(s.medianCommentRate, s.commentRateSampleN)} | ${fmtValN(s.medianCommentToLikeRatio, s.commentToLikeSampleN)} |`;
    }),
    "",
    ...(dilutionNote ? [dilutionNote, ""] : []),
  ];

  if (c.packaging.durationSampleN > 0) {
    lines.push(
      `## Catalog Duration Cliffs (${c.packaging.durationFormatMode}, N=${c.packaging.durationSampleN} mature with duration${fmtBase(c.packaging.durationBaseWinnerPct, c.packaging.durationBaseFlopPct)})`,
      "",
      "| Duration Band | N | Share (%) | Win Rate (%) | Flop Rate (%) | Median Outlier | Median Views | p (q) |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      ...bandRows(c.packaging.durationBands),
      "",
    );
  }

  if (c.packaging.wpmSampleN > 0) {
    const corruptNote =
      c.packaging.excludedCorruptWpmCount > 0
        ? `; excluded ${c.packaging.excludedCorruptWpmCount} corrupt/truncated auto-caption(s)`
        : "";
    lines.push(
      `## Catalog Spoken WPM Cliffs (${c.packaging.wpmBandMode}, N=${c.packaging.wpmSampleN} clean mature transcripts${corruptNote}${fmtBase(c.packaging.wpmBaseWinnerPct, c.packaging.wpmBaseFlopPct)})`,
      "",
      "| WPM Band | N | Share (%) | Win Rate (%) | Flop Rate (%) | Median Outlier | Median Views | p (q) |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      ...bandRows(c.packaging.wpmBands),
      "",
    );
  }

  if (c.packaging.heatmapSummary || c.packaging.chaptersSummary) {
    lines.push("## Catalog Retention Heatmap & Chapters Telemetry", "");
    if (c.packaging.heatmapSummary) {
      const hm = c.packaging.heatmapSummary;
      lines.push(
        `Most-replayed heatmap (N=${hm.sampleN}): median peak at ${fmtPct(hm.medianPeakPct)} runtime, early intensity ${hm.medianEarly ?? "-"}, end intensity ${hm.medianEnd ?? "-"}, tail lift (end/mid) ${hm.medianTailLift ?? "-"} (Winner ${hm.winnerMedianTailLift ?? "-"}, Flop ${hm.flopMedianTailLift ?? "-"}).`,
        "",
      );
    }
    if (c.packaging.chaptersSummary) {
      const ch = c.packaging.chaptersSummary;
      lines.push(
        `Chapters (N=${ch.sampleN}, ${ch.shareOfMaturePct}% of mature): median ${ch.medianChaptersCount} chapters/video, first chapter ends at ${fmtSec(ch.medianFirstChapterEndSec)}, median chapter length ${fmtSec(ch.medianChapterSec)}.`,
        "",
      );
    }
  }

  if (c.packaging.titleSummary.sampleN > 0) {
    const ts = c.packaging.titleSummary;
    const showEmojiTables = (ts.trailingEmojiPct ?? 0) >= 5;
    lines.push(
      `## Catalog Title Packaging & Modifiers (N=${ts.sampleN} mature${fmtBase(ts.baseWinnerPct, ts.baseFlopPct)})`,
      "",
      `Median title words (excluding trailing tags/emojis): ${ts.medianTitleWords ?? "-"} (Winner ${ts.winnerMedianTitleWords ?? "-"}, Flop ${ts.flopMedianTitleWords ?? "-"}); median visible chars: ${ts.medianTitleChars ?? "-"} (Winner ${ts.winnerMedianTitleChars ?? "-"}, Flop ${ts.flopMedianTitleChars ?? "-"}); median display units (CJK/emoji=2): ${ts.medianTitleDisplayUnits ?? "-"} (Winner ${ts.winnerMedianTitleDisplayUnits ?? "-"}, Flop ${ts.flopMedianTitleDisplayUnits ?? "-"}). Trailing emoji rate: ${fmtPct(ts.trailingEmojiPct)} (Winner ${fmtPct(ts.winnerTrailingEmojiPct)}, Flop ${fmtPct(ts.flopTrailingEmojiPct)}). Question titles: ${ts.questionTitlePct}% (Winner ${fmtPct(ts.winnerQuestionTitlePct)}, Flop ${fmtPct(ts.flopQuestionTitlePct)}), number titles: ${ts.numberTitlePct}% (Winner ${fmtPct(ts.winnerNumberTitlePct)}, Flop ${fmtPct(ts.flopNumberTitlePct)}).`,
      "",
      ...(!c.packaging.isNonSpaceTitles && c.packaging.titleWordBands.length > 0
        ? [
            "| Title Word Band | N | Share (%) | Win Rate (%) | Flop Rate (%) | Median Outlier | Median Views | p (q) |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
            ...bandRows(c.packaging.titleWordBands),
            "",
          ]
        : []),
      "| Title Display-Unit Band (CJK/emoji=2) | N | Share (%) | Win Rate (%) | Flop Rate (%) | Median Outlier | Median Views | p (q) |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      ...bandRows(c.packaging.titleCharBands),
      "",
    );
    if (c.packaging.isEnglishTitles && c.packaging.titleOpeners.length > 0) {
      lines.push(
        "| Title Opener (EN) | N | Share (%) | Win Rate (%) | Flop Rate (%) | Median Outlier | Median Views | p (q) |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ...bandRows(c.packaging.titleOpeners),
        "",
      );
    }
    if (c.packaging.titleModifiers.length > 0) {
      lines.push(
        "| Title Modifier | N | Share (%) | Win Rate (%) | Flop Rate (%) | Delta vs Base Win (pp) | Median Outlier | p (q) |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ...c.packaging.titleModifiers.map(
          (m) =>
            `| ${m.modifier} | ${m.n} (${m.reliability}) | ${m.sharePct}% | ${m.winnerPct}% | ${m.flopPct}% | ${fmtDelta(m.winRateDeltaPp)} | ${fmtOutlier(m.medianOutlier)} | ${fmtPQ(m.pValue, m.qValue)} |`,
        ),
        "",
      );
    }
    if (showEmojiTables) {
      lines.push(
        "| Trailing Emoji | N | Share (%) | Win Rate (%) | Flop Rate (%) | Median Outlier | Median Views | p (q) |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ...bandRows(c.packaging.topTrailingEmojis),
        "",
        "| Emoji Valence Family | N | Share (%) | Win Rate (%) | Flop Rate (%) | Median Outlier | Median Views | p (q) |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ...bandRows(c.packaging.emojiValenceFamilies),
        "",
      );
    } else {
      lines.push("Trailing emoji tables omitted (<5% prevalence on this channel).", "");
    }
    if (c.packaging.temporalStability.length >= 2 || c.packaging.eraStability.length > 0) {
      lines.push("## Temporal Format Stability", "");
      if (c.packaging.eraStability.length > 0) {
        lines.push(
          "Unbiased full-catalog chronological quartiles (all on-feed mature videos, zero enrichment skew):",
          "",
          "| Catalog Era | N | Median Views | Win Rate (%) | Flop Rate (%) | Median Outlier | Trailing Emoji (%) |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          ...c.packaging.eraStability.map(
            (e) =>
              `| ${e.era} | ${e.n} | ${e.medianViews.toLocaleString("en-US")} | ${e.winnerPct}% | ${e.flopPct}% | ${fmtOutlier(e.medianOutlier)} | ${e.trailingEmojiPct}% |`,
          ),
          "",
        );
      }
      if (c.packaging.temporalStability.length >= 2) {
        lines.push(
          "Dated enriched mature subsample by quarter (check Win/Flop % for enrichment-tier skew):",
          "",
          "| Quarter | N | Median Views | Median Duration (s) | Win Rate (%) | Flop Rate (%) | Median Outlier | Trailing Emoji (%) |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          ...c.packaging.temporalStability.map(
            (q) =>
              `| ${q.quarter} | ${q.n} | ${q.medianViews.toLocaleString("en-US")} | ${fmtSec(q.medianDurationSec)} | ${q.winnerPct}% | ${q.flopPct}% | ${fmtOutlier(q.medianOutlier)} | ${q.trailingEmojiPct}% |`,
          ),
          "",
        );
      }
    }
  }

  if (c.linguistics.sampleN > 0 || c.linguistics.openingSampleN > 0) {
    const lg = c.linguistics;
    const pronounText = lg.pronounProfilePct
      ? `2nd-person you ${lg.pronounProfilePct.secondPersonYou}%, 3rd-person story ${lg.pronounProfilePct.thirdPersonStory}%, 1st-person I/we ${lg.pronounProfilePct.firstPersonIWe}%`
      : "N/A (no English pronouns matched)";
    const corruptTxNote =
      lg.excludedCorruptCount > 0 ? `; excluded ${lg.excludedCorruptCount} corrupt` : "";
    lines.push(
      `## Catalog Script Linguistics & Opening Sentences (N=${lg.sampleN} clean transcripts${corruptTxNote}, N=${lg.punctuatedSampleN} punctuated, N=${lg.openingSampleN} openers${fmtBase(lg.openingBaseWinnerPct, lg.openingBaseFlopPct)})`,
      "",
      `Median words/sentence (punctuated N=${lg.punctuatedSampleN}): ${lg.medianWordsPerSentence ?? "-"} (IQR ${lg.sentenceLengthIqr ?? "-"}), pooled <=8w sentences: ${fmtPct(lg.shortPunchySentencePct)}, per-video median <=8w share: ${fmtPct(lg.perVideoMedianShortSentPct)}. Median sentences/video: ${lg.medianSentencesPerVideo ?? "-"}, S1 median words: ${lg.medianFirstSentenceWords ?? "-"}, final sentence median words: ${lg.medianLastSentenceWords ?? "-"} (<=8w closing rate: ${fmtPct(lg.shortClosingPct)}). Language-universal markers: in-script questions ${lg.inScriptQuestionVideoPct}%, exclamations ${lg.exclamationVideoPct}%, concrete numbers ${lg.concreteNumberVideoPct}% (mean ${lg.meanNumbersPerVideo}/video), S1-to-closing echo ${fmtPct(lg.openingClosingEchoPct)}, title-to-closing echo ${fmtPct(lg.titleClosingEchoPct)}. Pronoun balance (excluding "you see"): ${pronounText}.`,
      "",
    );
    if (lg.burstiness) {
      const b = lg.burstiness;
      lines.push(
        `Per-video sentence burstiness (N=${b.sampleN} with >=3 sentences): median CV ${b.medianPerVideoSentLenCv} (Winner ${b.winnerMedianSentLenCv ?? "-"}, Flop ${b.flopMedianSentLenCv ?? "-"}), median min..max words ${b.medianPerVideoMinSentWords}..${b.medianPerVideoMaxSentWords} (max/min ratio ${b.medianPerVideoMaxMinRatio}x), median adjacent-sentence jump ${b.medianPerVideoAdjSentJump} words.`,
        "",
      );
    }
    if (lg.englishProfile) {
      const ep = lg.englishProfile;
      const topStarters =
        ep.topSpokenStarters.map((s) => `${s.word} (${s.sentPct}%)`).join(", ") || "none";
      lines.push(
        `English prose profile: median FK grade ${ep.medianFkGrade ?? "-"}, <=2-syllable words ${fmtPct(ep.simpleWordPct)}, median avg word length ${ep.medianAvgWordLen ?? "-"} chars, contractions ${ep.contractionVideoPct}% of videos, trailing participle consequences ${ep.participleConsequenceVideoPct}% (Winner ${fmtPct(ep.winnerParticipleConsequencePct)}, Flop ${fmtPct(ep.flopParticipleConsequencePct)}), spoken sentence starters ${fmtPct(ep.spokenStarterSentPct)} (${topStarters}), pivot commas ${ep.pivotCommaVideoPct}%, bare-pronoun S1 openers ${fmtPct(ep.barePronounOpenerPct)}, mid-script POV shifts ${fmtPct(ep.midScriptPovShiftVideoPct)}, hypothetical would/could modals ${ep.hypotheticalModalVideoPct}% (Winner ${fmtPct(ep.winnerHypotheticalModalPct)}, Flop ${fmtPct(ep.flopHypotheticalModalPct)}), "you see" rewind marker ${ep.flashbackRewindMarkerPct}% (Winner ${fmtPct(ep.winnerFlashbackRewindPct)}, Flop ${fmtPct(ep.flopFlashbackRewindPct)}). Anti-slop & 4th-wall audit: formal transitions ${ep.formalTransitionVideoPct}%, AI-slop buzzwords ${ep.aiSlopBuzzwordVideoPct}%, YouTube filler intros ${ep.ytFillerIntroVideoPct}%, moralizing endings ${ep.moralizingEndingVideoPct}%, meta-directorial camera leaks ${ep.metaDirectorialLeakPct}%.`,
        "",
      );
    }
    if (lg.transcriptTimingSummary) {
      const tt = lg.transcriptTimingSummary;
      const tw = tt.byTier.winner;
      const tf = tt.byTier.flop;
      lines.push(
        `Timed caption cadence (N=${tt.sampleN}, auto-generated ${fmtPct(tt.autoGeneratedPct)}): first spoken word ${fmtSec(tt.medianFirstSpokenSec)} (zero-dead-air <=0.5s: ${fmtPct(tt.zeroDeadAirStartPct)}; W ${fmtSec(tw.medianFirstSpokenSec)}, F ${fmtSec(tf.medianFirstSpokenSec)}), speaking coverage ${fmtPct(tt.medianSpeakingCoveragePct)} (W ${fmtPct(tw.medianSpeakingCoveragePct)}, F ${fmtPct(tf.medianSpeakingCoveragePct)}), active-speech WPM ${tt.medianActiveSpeechWpm ?? "-"} (W ${tw.medianActiveSpeechWpm ?? "-"}, F ${tf.medianActiveSpeechWpm ?? "-"}), late/early WPM ratio ${tt.medianLateToEarlyWpmRatio ?? "-"}x, caption tail ${fmtSec(tt.medianCaptionTailSec)}, max internal gap ${fmtSec(tt.medianMaxGapSec)}, silence gaps >=0.35s: ${tt.medianSilenceGapCount ?? "-"}/video.`,
        "",
      );
    }
    if (lg.isEnglishOpeners && lg.openingSentencePatterns.length > 0) {
      lines.push(
        "| Opening Sentence Pattern (EN) | N | Share (%) | Win Rate (%) | Flop Rate (%) | Median Outlier | Median Views | p (q) |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ...bandRows(lg.openingSentencePatterns),
        "",
      );
    }
    lines.push(
      "| Title-to-Opening-Line Subject Anchor | N | Share (%) | Win Rate (%) | Flop Rate (%) | Median Outlier | Median Views | p (q) |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      ...bandRows(lg.titleOpeningAnchorBands),
      "",
    );
  }

  const fmtTierBoundPct = (tierN: number, val: number) => (tierN > 0 ? `${val}%` : "-");
  const fmtTierShotPct = (tierShots: number, val: number | undefined) =>
    tierShots > 0 ? `${val ?? 0}%` : "-";

  const sd = d.storyDynamics;
  const rg = sd.rehookGeometry;
  const editScopeLabel =
    d.editFpsMode === "macro_lowfps"
      ? `N=${d.editSampleN}, macro_lowfps scene/chapter-level`
      : d.editMacroExcludedCount > 0
        ? `N=${d.editSampleN} micro_24fps; excluded ${d.editMacroExcludedCount} macro_lowfps`
        : `N=${d.editSampleN}`;

  lines.push(
    `## Deep DNA Pacing and Timing by Tier (N=${d.minedCount})`,
    "",
    "| Tier | N | Median Outlier | Duration (s) | Opening Shot (s) | Re-hooks | Re-hook Spacing (s) | Twist Present | WPM (N) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...(["overall", "winner", "median", "flop"] as const).map((t) => {
      const m = p[t];
      return `| ${t} | ${m.n} | ${fmtOutlier(m.medianOutlierRolling)} | ${m.medianDurationSec ?? "-"} | ${m.medianOpeningShotSec ?? "-"} | ${m.medianRehookCount ?? "-"} | ${m.medianRehookIntervalSec ?? "-"} | ${fmtPct(m.twistPresencePct)} | ${fmtValN(m.medianWpm, m.wpmSampleN)} |`;
    }),
    "",
    `Median twist placement: ${fmtPct(p.medianTwistAtPct)} (Winner ${fmtPct(p.winnerMedianTwistAtPct)}, Flop ${fmtPct(p.flopMedianTwistAtPct)}). Late twist >=65%: ${sd.lateTwist65Pct.overall}% (Winner ${fmtPct(sd.lateTwist65Pct.winner)}, Flop ${fmtPct(sd.lateTwist65Pct.flop)}, p(q)=${fmtPQ(sd.lateTwist65Pct.pValue, sd.lateTwist65Pct.qValue)}). Stacked multi-escalation/twist loops: ${sd.stackedLoopSharePct.overall}% (Winner ${fmtPct(sd.stackedLoopSharePct.winner)}, Flop ${fmtPct(sd.stackedLoopSharePct.flop)}, p(q)=${fmtPQ(sd.stackedLoopSharePct.pValue, sd.stackedLoopSharePct.qValue)}). Beat-order topology: compact setup <=15% runtime ${sd.setupLe15Pct.overall}% (W ${fmtPct(sd.setupLe15Pct.winner)}, F ${fmtPct(sd.setupLe15Pct.flop)}, p(q)=${fmtPQ(sd.setupLe15Pct.pValue, sd.setupLe15Pct.qValue)}); escalation before explanation ${sd.escalationBeforeExplanationPct.overall}% (W ${fmtPct(sd.escalationBeforeExplanationPct.winner)}, F ${fmtPct(sd.escalationBeforeExplanationPct.flop)}, p(q)=${fmtPQ(sd.escalationBeforeExplanationPct.pValue, sd.escalationBeforeExplanationPct.qValue)}). Real re-hook geometry (N=${rg.overall.sampleN}): first re-hook ${fmtSec(rg.overall.medianFirstRehookSec)} (W ${fmtSec(rg.winner.medianFirstRehookSec)}, F ${fmtSec(rg.flop.medianFirstRehookSec)}), inter-rehook gap ${fmtSec(rg.overall.medianInterRehookGapSec)} (W ${fmtSec(rg.winner.medianInterRehookGapSec)}, F ${fmtSec(rg.flop.medianInterRehookGapSec)}), max unrehooked span ${fmtSec(rg.overall.medianMaxUnrehookedSpanSec)} (W ${fmtSec(rg.winner.medianMaxUnrehookedSpanSec)}, F ${fmtSec(rg.flop.medianMaxUnrehookedSpanSec)}). Mined opening-line subject anchor (N=${sd.openingLineAnchor.sampleN}): ${fmtPct(sd.openingLineAnchor.anchoredPct)} (W ${fmtPct(sd.openingLineAnchor.winnerAnchoredPct)}, F ${fmtPct(sd.openingLineAnchor.flopAnchoredPct)}, p(q)=${fmtPQ(sd.openingLineAnchor.pValue, sd.openingLineAnchor.qValue)}).`,
    "",
    `Median edit cuts/min (${editScopeLabel}): ${p.medianEditCutsPerMin ?? "-"} (Winner ${p.winnerMedianEditCutsPerMin ?? "-"}, Flop ${p.flopMedianEditCutsPerMin ?? "-"}), total camera beats/min: ${p.medianTotalBeatsPerMin ?? "-"} (Winner ${p.winnerMedianTotalBeatsPerMin ?? "-"}, Flop ${p.flopMedianTotalBeatsPerMin ?? "-"}), avg shot duration: ${fmtSec(p.medianAvgShotSec)} (Winner ${fmtSec(p.winnerMedianAvgShotSec)}, Flop ${fmtSec(p.flopMedianAvgShotSec)}).`,
    "",
    ...(sd.beatSequences.length > 0
      ? [
          "| Beat-Order Sequence | Videos | Share (%) | Winner / Flop | Median Outlier |",
          "| --- | --- | --- | --- | --- |",
          ...sd.beatSequences.map(
            (b) =>
              `| ${cleanCell(b.sequence)} | ${b.count} | ${b.pct}% | W:${b.winnerCount} / F:${b.flopCount} | ${fmtOutlier(b.medianOutlier)} |`,
          ),
          "",
        ]
      : []),
    `## Topic Category Distribution (N=${d.minedCount} deep DNA)`,
    "",
    "| Topic | Videos | Share (%) | Median Outlier | Winner Share (%) | Flop Share (%) | Lift W/F | Delta W-F (pp) | p (q) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...bucketRows(d.distributions.topicCategory),
    "",
    `## Hook Archetype Distribution (N=${d.minedCount} deep DNA)`,
    "",
    "| Hook | Videos | Share (%) | Median Outlier | Winner Share (%) | Flop Share (%) | Lift W/F | Delta W-F (pp) | p (q) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...bucketRows(d.distributions.hookArchetype),
    "",
    `## Storytelling Structure Distribution (N=${d.minedCount} deep DNA)`,
    "",
    "| Structure | Videos | Share (%) | Median Outlier | Winner Share (%) | Flop Share (%) | Lift W/F | Delta W-F (pp) | p (q) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...bucketRows(d.distributions.storyStructure),
    "",
    `## Hook x Topic, Story x Topic, Ending x Topic & Lighting x Topic Cross-Tabs (N=${d.minedCount} deep DNA)`,
    "",
    "| Topic | N | Median Outlier | Dominant Hook Archetypes |",
    "| --- | --- | --- | --- |",
    ...crossRows(d.crossTabs.hookByTopic),
    "",
    "| Topic | N | Median Outlier | Dominant Story Structures |",
    "| --- | --- | --- | --- |",
    ...crossRows(d.crossTabs.storyByTopic),
    "",
    "| Topic | N | Median Outlier | Dominant Ending Types |",
    "| --- | --- | --- | --- |",
    ...crossRows(d.crossTabs.endingByTopic),
    "",
    "| Topic | N | Median Outlier | Dominant Lighting Styles |",
    "| --- | --- | --- | --- |",
    ...crossRows(d.crossTabs.lightingByTopic),
    "",
    `## Story Beat Runtime Budgets (N=${d.minedCount} deep DNA)`,
    "",
    "| Beat Role | Videos Present | Presence (%) | Winner Presence (%) | Flop Presence (%) | Median Runtime When Present (%) | Winner (%) | Flop (%) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...d.beatBudgets.map(
      (b) =>
        `| ${b.role} | ${b.presentInVideos} | ${b.presencePct}% | ${fmtPct(b.winnerPresencePct)} | ${fmtPct(b.flopPresencePct)} | ${b.medianPctWhenPresent}% | ${fmtPct(b.winnerMedianPctWhenPresent)} | ${fmtPct(b.flopMedianPctWhenPresent)} |`,
    ),
    "",
    `## Narrative Connectors and Ending Types (N=${d.minedCount} deep DNA)`,
    "",
    "| Dimension / Value | Videos | Share (%) | Median Outlier | Winner Share (%) | Flop Share (%) | Lift W/F | Delta W-F (pp) | p (q) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...bucketRows(d.distributions.narrativeConnector, "connector:"),
    ...bucketRows(d.distributions.endingType, "ending:"),
    "",
    `## Boundary and Editing Ratios (${d.boundaries.totalNonOpening} non-opening boundaries across ${editScopeLabel}; Winner=${d.boundaries.byTier.winner.totalNonOpening}, Flop=${d.boundaries.byTier.flop.totalNonOpening})`,
    "",
    "| Boundary Type | Count | Pooled All (%) | Pooled Winner (%) | Pooled Flop (%) | Video Prevalence W vs F | Mean Video Share W vs F |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...(["continuous", "transition", "hidden_cut", "hard_cut"] as const).map((k) => {
      const label =
        k === "continuous"
          ? "Continuous [NO CUT]"
          : k === "transition"
            ? "Transition"
            : k === "hidden_cut"
              ? "Hidden Cut"
              : "Hard Cut";
      const vl = d.boundaries.videoLevel[k]!;
      return `| ${label} | ${d.boundaries.counts[k]} | ${d.boundaries.pcts[k]}% | ${fmtTierBoundPct(d.boundaries.byTier.winner.totalNonOpening, d.boundaries.byTier.winner.pcts[k])} | ${fmtTierBoundPct(d.boundaries.byTier.flop.totalNonOpening, d.boundaries.byTier.flop.pcts[k])} | ${fmtPct(vl.winnerPrevalencePct)} vs ${fmtPct(vl.flopPrevalencePct)} | ${fmtPct(vl.winnerMeanVideoSharePct)} vs ${fmtPct(vl.flopMeanVideoSharePct)} |`;
    }),
    "",
    `## Video-Level Edit Architecture (${editScopeLabel}, equal weight per video)`,
    "",
    "| Edit Pattern | Videos | Share (%) | Winner Share (%) | Flop Share (%) | Delta W-F (pp) | p (q) |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...(
      [
        ["Pure 1-Take (0 cuts/transitions)", d.boundaries.editArchitecture.pureOneTake],
        ["Has Styled Transition (>=1)", d.boundaries.editArchitecture.hasStyledTransition],
        [
          "Has Dynamic Motion Transition (non-dissolve)",
          d.boundaries.editArchitecture.hasDynamicMotionTransition,
        ],
        ["Hard Cuts <= 1 per Video", d.boundaries.editArchitecture.hardCutsMax1],
        ["Hard Cuts >= 2 per Video", d.boundaries.editArchitecture.hardCutsGe2],
        ["Hard-Cut Dominant (>=50%)", d.boundaries.editArchitecture.hardCutDominant],
        ["Continuous Dominant (>=50%)", d.boundaries.editArchitecture.continuousDominant],
        ["Fast Cut Pace (>=15 cuts/min)", d.boundaries.editArchitecture.fastCutPace],
        ["Deliberate Cut Pace (<6 cuts/min)", d.boundaries.editArchitecture.deliberateCutPace],
      ] as const
    ).map(
      ([label, row]) =>
        `| ${label} | ${row.count} | ${row.pct}% | ${fmtPct(row.winnerPct)} | ${fmtPct(row.flopPct)} | ${fmtDelta(row.winnerMinusFlopPp)} | ${fmtPQ(row.pValue, row.qValue)} |`,
    ),
    "",
    `## Transition Types Used Across Videos (${editScopeLabel})`,
    "",
    "| Transition | Videos | Video Share (%) | Winner Share (%) | Flop Share (%) | Delta W-F (pp) | p (q) |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...(d.boundaries.transitionTypes.length > 0
      ? d.boundaries.transitionTypes.map(
          (t) =>
            `| ${t.type} | ${t.videos} (${t.reliability}) | ${t.videoPct}% | ${fmtPct(t.winnerPct)} | ${fmtPct(t.flopPct)} | ${fmtDelta(t.winnerMinusFlopPp)} | ${fmtPQ(t.pValue, t.qValue)} |`,
        )
      : ["| none | 0 | 0% | - | - | - | - |"]),
    "",
    `## Framing Ratios (${d.framing.totalShots} shots across ${editScopeLabel}; Winner=${d.framing.byTier.winner.totalShots}, Flop=${d.framing.byTier.flop.totalShots})`,
    "",
    "| Scale | All (%) | Winner (%) | Flop (%) | Angle | All (%) | Winner (%) | Flop (%) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...Array.from({ length: Math.max(SHOT_SCALES.length, CAMERA_ANGLES.length) }, (_, idx) => {
      const s = SHOT_SCALES[idx];
      const a = CAMERA_ANGLES[idx];
      return `| ${s ?? "-"} | ${s ? `${d.framing.shotScalePcts[s] ?? 0}%` : "-"} | ${s ? fmtTierShotPct(d.framing.byTier.winner.totalShots, d.framing.byTier.winner.shotScalePcts[s]) : "-"} | ${s ? fmtTierShotPct(d.framing.byTier.flop.totalShots, d.framing.byTier.flop.shotScalePcts[s]) : "-"} | ${a ?? "-"} | ${a ? `${d.framing.cameraAnglePcts[a] ?? 0}%` : "-"} | ${a ? fmtTierShotPct(d.framing.byTier.winner.totalShots, d.framing.byTier.winner.cameraAnglePcts[a]) : "-"} | ${a ? fmtTierShotPct(d.framing.byTier.flop.totalShots, d.framing.byTier.flop.cameraAnglePcts[a]) : "-"} |`;
    }),
    "",
  );

  if (d.shotSpine.parsedVideoCount > 0) {
    const sp = d.shotSpine;
    const env = sp.shotDurationEnvelope;
    const tEnv = sp.editTakeDurationEnvelope;
    const fmtEnv = (e: typeof env.overall) =>
      e
        ? `p10=${e.p10}s, p25=${e.p25}s, p50=${e.p50}s, p75=${e.p75}s, p90=${e.p90}s (p90/p10=${e.p90ToP10Ratio ?? "-"}x, n=${e.n})`
        : "-";
    const fmtTop3 = (list: Array<{ key: string; pct: number }>) =>
      list
        .slice(0, 3)
        .map((x) => `${x.key} ${x.pct}%`)
        .join(", ") || "-";
    const macroExclNote =
      sp.macroLowFpsExcludedCount > 0
        ? `; excluded ${sp.macroLowFpsExcludedCount} macro-lowFPS clip(s)`
        : "";
    lines.push(
      `## Section 3 Shot Spine, Transition Spans & Pacing Curve (N=${sp.parsedVideoCount} ${sp.fpsMode} dossiers${macroExclNote}, ${sp.totalShots} shots; Conf High=${sp.confidenceCounts.High}, Med=${sp.confidenceCounts.Med}, Low=${sp.confidenceCounts.Low})`,
      "",
      `Sub-beat / shot duration envelope: Overall ${fmtEnv(env.overall)}; Winner ${fmtEnv(env.winner)}; Flop ${fmtEnv(env.flop)}. Unbroken editorial take duration (merging Continuous [NO CUT] rows): Overall ${fmtEnv(tEnv.overall)}; Winner ${fmtEnv(tEnv.winner)}; Flop ${fmtEnv(tEnv.flop)}. Late-to-Mid shot duration ratio (acceleration <1.0): Overall ${env.lateToMidPacingRatio.overall ?? "-"}x (Winner ${env.lateToMidPacingRatio.winner ?? "-"}x, Flop ${env.lateToMidPacingRatio.flop ?? "-"}x). Wide+Tight dynamic range: ${fmtPct(sp.scaleDynamics.wideAndTightSpanPct.overall)} (W ${fmtPct(sp.scaleDynamics.wideAndTightSpanPct.winner)}, F ${fmtPct(sp.scaleDynamics.wideAndTightSpanPct.flop)}); >=3-step scale jumps: ${fmtPct(sp.scaleDynamics.bigScaleJumpVideoPct.overall)} (W ${fmtPct(sp.scaleDynamics.bigScaleJumpVideoPct.winner)}, F ${fmtPct(sp.scaleDynamics.bigScaleJumpVideoPct.flop)}); max continuous streak: ${fmtSec(sp.scaleDynamics.medianMaxContinuousStreakSec.overall)} (W ${fmtSec(sp.scaleDynamics.medianMaxContinuousStreakSec.winner)}, F ${fmtSec(sp.scaleDynamics.medianMaxContinuousStreakSec.flop)}).`,
      "",
      `Opening shot framing: Scale W [${fmtTop3(sp.openingVsClosing.openingScale.winner)}] vs F [${fmtTop3(sp.openingVsClosing.openingScale.flop)}]; Angle W [${fmtTop3(sp.openingVsClosing.openingAngle.winner)}] vs F [${fmtTop3(sp.openingVsClosing.openingAngle.flop)}]. Closing shot framing: Scale W [${fmtTop3(sp.openingVsClosing.closingScale.winner)}] vs F [${fmtTop3(sp.openingVsClosing.closingScale.flop)}]; Angle W [${fmtTop3(sp.openingVsClosing.closingAngle.winner)}] vs F [${fmtTop3(sp.openingVsClosing.closingAngle.flop)}].`,
      "",
    );
    if (sp.dominantCraftMix.categories.length > 0) {
      lines.push(
        `Dominant Craft Pillar Mix across Section 3 shots (${sp.dominantCraftMix.taggedShots}/${sp.totalShots} shots tagged; equal-weight per-video Mann-Whitney U p/q):`,
        "",
        "| Craft Pillar | Shots | Pooled (%) | Mean Video (%) | Winner Video (%) | Flop Video (%) | Delta W-F (pp) | Video Prev (%) | MW-U p (q) |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ...sp.dominantCraftMix.categories.map(
          (cRow) =>
            `| ${cleanCell(cRow.category)} | ${cRow.shots} | ${cRow.pct}% | ${fmtPct(cRow.meanVideoSharePct)} | ${fmtPct(cRow.winnerMeanVideoSharePct)} | ${fmtPct(cRow.flopMeanVideoSharePct)} | ${fmtDelta(cRow.winnerMinusFlopPp)} | ${fmtPct(cRow.videoPrevalencePct)} | ${fmtPQ(cRow.pValue, cRow.qValue)} |`,
        ),
        "",
      );
    }
    if (sp.transitionSpans.length > 0) {
      lines.push(
        "| Transition Type | Instances | Videos | Median Frames | IQR Frames | Median Sec | Beat-Aligned (%) |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        ...sp.transitionSpans.map(
          (t) =>
            `| ${t.type} | ${t.instances} (${t.reliability}) | ${t.videos} | ${t.medianFrames ?? "-"} | ${t.iqrFrames ?? "-"} | ${fmtSec(t.medianSec)} | ${t.beatAlignmentPct}% |`,
        ),
        "",
      );
    }
    const beatDurs = Object.entries(env.byBeatRoleMedianSec);
    if (beatDurs.length > 0) {
      lines.push(
        "| Beat Role | Shots | Median Shot Duration (s) |",
        "| --- | --- | --- |",
        ...beatDurs.map(([role, info]) => `| ${role} | ${info.n} | ${info.medianSec}s |`),
        "",
      );
    }
    if (sp.hiddenCutMechanisms.length > 0) {
      lines.push(
        "| Hidden Cut Mechanism | Instances | Videos | Video Share (%) |",
        "| --- | --- | --- | --- |",
        ...sp.hiddenCutMechanisms.map(
          (h) => `| ${h.mechanism} | ${h.instances} | ${h.videos} | ${h.videoPct}% |`,
        ),
        "",
      );
    }
    if (sp.continuousBridgeMechanisms.length > 0) {
      lines.push(
        "| Continuous [NO CUT] Bridge Mechanism | Instances | Videos | Video Share (%) | Winner (%) | Flop (%) |",
        "| --- | --- | --- | --- | --- | --- |",
        ...sp.continuousBridgeMechanisms.map(
          (cb) =>
            `| ${cb.mechanism} | ${cb.instances} | ${cb.videos} | ${cb.videoPct}% | ${fmtPct(cb.winnerVideoPct)} | ${fmtPct(cb.flopVideoPct)} |`,
        ),
        "",
      );
    }
    if (sp.hardCutMechanisms.some((hc) => hc.mechanism !== "unspecified")) {
      lines.push(
        "| Hard Cut Mechanism | Instances | Videos | Video Share (%) | Winner (%) | Flop (%) |",
        "| --- | --- | --- | --- | --- | --- |",
        ...sp.hardCutMechanisms.map(
          (hc) =>
            `| ${hc.mechanism} | ${hc.instances} | ${hc.videos} | ${hc.videoPct}% | ${fmtPct(hc.winnerVideoPct)} | ${fmtPct(hc.flopVideoPct)} |`,
        ),
        "",
      );
    }
  }

  lines.push(
    `## Camera, Lighting, Easing, and Audio Profiles (N=${d.minedCount}; audio:* uses Audio Verified N=${d.audioVerifiedCount})`,
    "",
    "| Dimension / Value | Videos | Share (%) | Median Outlier | Winner Share (%) | Flop Share (%) | Lift W/F | Delta W-F (pp) | p (q) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...bucketRows(d.distributions.cameraEnergy, "camera:"),
    ...bucketRows(d.distributions.dominantLensFeel, "lens:"),
    ...bucketRows(d.distributions.lightingStyle, "lighting:"),
    ...bucketRows(d.distributions.easingEnergy, "easing:"),
    ...bucketRows(d.distributions.audioBedStyle, "audio:"),
    "",
    `## Visual, Optical, and Audio Craft Signals (N=${d.minedCount}; Audio N=${d.audioVerifiedCount}; Micro-FPS N=${d.microFpsSampleN})`,
    "",
    "| Signal | Sample N | Videos | Share (%) | Winner Share (%) | Flop Share (%) | Delta W-F (pp) | p (q) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...d.craftSignals.map(
      (s) =>
        `| ${s.signal} | ${s.sampleN} | ${s.count} (${s.reliability}) | ${s.sampleN > 0 ? `${s.pct}%` : "-"} | ${fmtPct(s.winnerPct)} | ${fmtPct(s.flopPct)} | ${fmtDelta(s.winnerMinusFlopPp)} | ${fmtPQ(s.pValue, s.qValue)} |`,
    ),
    "",
  );

  if (v2.v2Count > 0) {
    lines.push(
      `## V2 Channel Soul Profiles (N=${v2.v2Count} schema v2+; pov:*, voice:*, bgm:*, sfx:* use Audio Verified N=${v2.v2AudioVerifiedCount})`,
      "",
      `Median outro hold after final punchline: ${fmtSec(v2.medianOutroHoldSec)} (Winner ${fmtSec(v2.winnerMedianOutroHoldSec)}, Flop ${fmtSec(v2.flopMedianOutroHoldSec)}).`,
      "",
      "| Dimension / Value | Videos | Share (%) | Median Outlier | Winner Share (%) | Flop Share (%) | Lift W/F | Delta W-F (pp) | p (q) |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      ...bucketRows(v2.distributions.visualMedium, "medium:"),
      ...bucketRows(v2.distributions.protagonistFormat, "protagonist:"),
      ...bucketRows(v2.distributions.narrationPov, "pov:"),
      ...bucketRows(v2.distributions.voiceDelivery, "voice:"),
      ...bucketRows(v2.distributions.captionStyle, "captions:"),
      ...bucketRows(v2.distributions.emotionalDriver, "emotion:"),
      ...bucketRows(v2.distributions.shadowQuality, "shadows:"),
      ...bucketRows(v2.distributions.colorPaletteMood, "palette:"),
      ...bucketRows(v2.distributions.bgmMood, "bgm:"),
      ...bucketRows(v2.distributions.sfxDensity, "sfx:"),
      "",
      `## V2 Granular Craft Signals (N=${v2.v2Count}; Audio N=${v2.v2AudioVerifiedCount}; Micro-FPS N=${v2.v2MicroFpsCount})`,
      "",
      "| Signal | Sample N | Videos | Share (%) | Winner Share (%) | Flop Share (%) | Delta W-F (pp) | p (q) |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      ...v2.v2CraftSignals.map(
        (s) =>
          `| ${s.signal} | ${s.sampleN} | ${s.count} (${s.reliability}) | ${s.sampleN > 0 ? `${s.pct}%` : "-"} | ${fmtPct(s.winnerPct)} | ${fmtPct(s.flopPct)} | ${fmtDelta(s.winnerMinusFlopPp)} | ${fmtPQ(s.pValue, s.qValue)} |`,
      ),
      "",
      `## V2 Camera Move Repertoire (N=${v2.v2Count})`,
      "",
      "| Camera Move | Videos | Video Share (%) | Winner Share (%) | Flop Share (%) | Delta W-F (pp) | p (q) |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...(v2.cameraMoves.length > 0
        ? v2.cameraMoves.map(
            (m) =>
              `| ${m.move} | ${m.videos} (${m.reliability}) | ${m.videoPct}% | ${fmtPct(m.winnerPct)} | ${fmtPct(m.flopPct)} | ${fmtDelta(m.winnerMinusFlopPp)} | ${fmtPQ(m.pValue, m.qValue)} |`,
          )
        : ["| none | 0 | 0% | - | - | - | - |"]),
      "",
      `## BGM x Emotion, BGM x Topic & Story x Protagonist Cross-Tabs (N=${v2.v2Count} v2+; Audio N=${v2.v2AudioVerifiedCount})`,
      "",
      "| Emotional Driver | N | Median Outlier | Dominant BGM Moods |",
      "| --- | --- | --- | --- |",
      ...crossRows(d.crossTabs.bgmByEmotion),
      "",
      "| Topic | N | Median Outlier | Dominant BGM Moods |",
      "| --- | --- | --- | --- |",
      ...crossRows(d.crossTabs.bgmByTopic),
      "",
      "| Protagonist Format | N | Median Outlier | Dominant Story Structures |",
      "| --- | --- | --- | --- |",
      ...crossRows(d.crossTabs.storyByProtagonist),
      "",
    );
  }

  if (d.withinBucketContrasts.length > 0) {
    lines.push(
      `## Within-Bucket Winner vs Flop Contrasts (Buckets with >=3 W and >=3 F, |Delta| >= 20pp; BH-FDR across ${d.withinBucketTestsEvaluated} total tests)`,
      "",
      "| Dimension : Bucket | W / F Base | Feature | Winner | Flop | Delta W-F (pp) | p (q) |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...d.withinBucketContrasts.map(
        (x) =>
          `| ${x.dimension}:${x.bucket} | W=${x.winnerN} / F=${x.flopN} | ${x.feature} | ${x.winnerCount}/${x.winnerN} (${x.winnerPct}%) | ${x.flopCount}/${x.flopN} (${x.flopPct}%) | ${fmtDelta(x.deltaPp)} | ${fmtPQ(x.pValue, x.qValue)} |`,
      ),
      "",
    );
  }

  if (v3.v3Count > 0 || v3.audioLoudnessSummary.sampleN > 0) {
    if (v3.audioLoudnessSummary.sampleN > 0) {
      const al = v3.audioLoudnessSummary;
      const aw = al.byTier.winner;
      const af = al.byTier.flop;
      const silentNote =
        al.silentTracksExcludedCount > 0
          ? `; excluded ${al.silentTracksExcludedCount} silent/muted track(s)`
          : "";
      lines.push(
        `## FFmpeg Measured Audio Loudness & Dynamics (N=${al.sampleN} non-silent clips${silentNote})`,
        "",
        `Median integrated loudness: ${al.medianIntegratedLufs ?? "-"} LUFS (W ${aw.medianIntegratedLufs ?? "-"}, F ${af.medianIntegratedLufs ?? "-"}), max short-term S_max: ${al.medianMaxShortTermLufs ?? "-"} LUFS (W ${aw.medianMaxShortTermLufs ?? "-"}, F ${af.medianMaxShortTermLufs ?? "-"}), max momentary M_max: ${al.medianMaxMomentaryLufs ?? "-"} LUFS, true peak: ${al.medianTruePeakDbtp ?? "-"} dBTP, PLR (TP - I): ${al.medianPlrDb ?? "-"} dB (W ${aw.medianPlrDb ?? "-"}, F ${af.medianPlrDb ?? "-"}), LRA: ${al.medianLoudnessRangeLu ?? "-"} LU, climax delta (late - mid): ${fmtDelta(al.medianClimaxLoudnessDeltaLu)} LU, interior relative drops >=12 LU: ${al.medianRelativeDropCount ?? "-"}/clip, absolute silence events >=0.15s: ${al.medianSilenceCount ?? "-"}/clip (median total ${fmtSec(al.medianTotalSilenceSec)}).`,
        "",
      );
    }
    if (v3.v3Count > 0) {
      lines.push(
        `## V3 Extended Craft Profiles (N=${v3.v3Count} schema v3; Audio N=${v3.v3AudioVerifiedCount}; Thumbnails N=${v3.v3ThumbnailVerifiedCount})`,
        "",
        "| Dimension / Value | Videos | Share (%) | Median Outlier | Winner Share (%) | Flop Share (%) | Lift W/F | Delta W-F (pp) | p (q) |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ...bucketRows(v3.distributions.actingMode, "acting:"),
        ...bucketRows(v3.distributions.setArchitecture, "set:"),
        ...bucketRows(v3.distributions.visualLayerFormat, "layers:"),
        ...bucketRows(v3.distributions.stakesEngine, "stakes:"),
        ...bucketRows(v3.distributions.cameraMotionPersistence, "cam_persist:"),
        ...bucketRows(v3.distributions.cameraVelocityProfile, "cam_vel:"),
        ...bucketRows(v3.distributions.framingAnchor, "framing:"),
        ...bucketRows(v3.distributions.bgmTwistBehavior, "bgm_twist:"),
        ...bucketRows(v3.distributions.bgmEndingBehavior, "bgm_end:"),
        ...bucketRows(v3.distributions.endingValence, "valence:"),
        ...bucketRows(v3.distributions.titleHookRelation, "title_hook:"),
        ...bucketRows(v3.distributions.openingScrollStopState, "scroll_stop:"),
        ...bucketRows(v3.distributions.openLoopPayoffTiming, "loop_payoff:"),
        ...bucketRows(v3.distributions.voVisualRelation, "vo_visual:"),
        ...bucketRows(v3.distributions.narrativeTimeline, "timeline:"),
        ...bucketRows(v3.distributions.openLoopArchitecture, "loop_arch:"),
        ...bucketRows(v3.distributions.informationRevealMode, "info_reveal:"),
        ...(v3.v3ThumbnailVerifiedCount > 0
          ? [
              ...bucketRows(v3.distributions.thumbnailArchetype, "thumb_arch:"),
              ...bucketRows(v3.distributions.thumbnailTextRelation, "thumb_text:"),
              ...bucketRows(v3.distributions.thumbnailOpeningPayoff, "thumb_payoff:"),
              ...bucketRows(v3.distributions.thumbnailFocalComplexity, "thumb_complexity:"),
              ...bucketRows(v3.distributions.thumbnailGazeOrCue, "thumb_gaze:"),
            ]
          : []),
        "",
        "| V3 Multi-Label / Signal | Sample N | Videos | Share (%) | Winner Share (%) | Flop Share (%) | Delta W-F (pp) | p (q) |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ...v3.sfxLayersUsed.map(
          (s) =>
            `| sfx_layer:${s.key} | ${v3.v3AudioVerifiedCount} | ${s.videos} (${s.reliability}) | ${v3.v3AudioVerifiedCount > 0 ? `${s.videoPct}%` : "-"} | ${fmtPct(s.winnerPct)} | ${fmtPct(s.flopPct)} | ${fmtDelta(s.winnerMinusFlopPp)} | ${fmtPQ(s.pValue, s.qValue)} |`,
        ),
        ...v3.timeRemapTypes.map(
          (t) =>
            `| time_remap:${t.key} | ${v3.v3MicroFpsCount} | ${t.videos} (${t.reliability}) | ${v3.v3MicroFpsCount > 0 ? `${t.videoPct}%` : "-"} | ${fmtPct(t.winnerPct)} | ${fmtPct(t.flopPct)} | ${fmtDelta(t.winnerMinusFlopPp)} | ${fmtPQ(t.pValue, t.qValue)} |`,
        ),
        ...v3.v3CraftSignals.map(
          (s) =>
            `| ${s.signal} | ${s.sampleN} | ${s.count} (${s.reliability}) | ${s.sampleN > 0 ? `${s.pct}%` : "-"} | ${fmtPct(s.winnerPct)} | ${fmtPct(s.flopPct)} | ${fmtDelta(s.winnerMinusFlopPp)} | ${fmtPQ(s.pValue, s.qValue)} |`,
        ),
        "",
        "| Protagonist Format | N | Median Outlier | Dominant Acting Modes |",
        "| --- | --- | --- | --- |",
        ...crossRows(d.crossTabs.actingByProtagonist),
        "",
        "| Topic | N | Median Outlier | Dominant Set Architectures |",
        "| --- | --- | --- | --- |",
        ...crossRows(d.crossTabs.setByTopic),
        "",
      );
    }
  }

  if (d.exemplars.length > 0) {
    const topWinners = d.exemplars.filter((e) => e.tier === "winner").slice(0, 5);
    const botFlops = [...d.exemplars]
      .filter((e) => e.tier === "flop")
      .sort((a, b) => a.outlierRolling - b.outlierRolling || a.id.localeCompare(b.id))
      .slice(0, 5);
    const digest = [...topWinners, ...botFlops];
    if (digest.length > 0) {
      lines.push(
        "## Top Winner & Bottom Flop Exemplar Digest",
        "",
        "| ID | Tier | Outlier | Reusable Script Template | Key Secret Sauce / Drag |",
        "| --- | --- | --- | --- | --- |",
        ...digest.map((e) => {
          const notes =
            e.tier === "flop"
              ? e.weaknesses.length > 0
                ? `Drag: ${e.weaknesses[0]}`
                : "Drag: none logged (see dossier)"
              : e.secretSauce[0] || e.weaknesses[0] || "-";
          return `| ${e.id} | ${e.tier} | ${e.outlierRolling}x | ${cleanCell(e.scriptTemplate).slice(0, 140)} | ${cleanCell(notes).slice(0, 140)} |`;
        }),
        "",
      );
    }
  }

  return lines.join("\n");
}
