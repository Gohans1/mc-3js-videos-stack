import { link, mkdir, mkdtemp, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { js, pageAlerts, pollPause, secs, StepError } from "../../aistudio/scripts/lib";
import { enabled, exists, item, tap } from "./page-map";

const player = `(${item("player")}?.querySelector('audio'))`;
const source = `(${player}?.currentSrc || ${player}?.src || '')`;
const runBaseline = "window.__gohansAistudioTtsBeforeRun";
const awaitingNewAudio = `(typeof ${runBaseline} === 'string' && ${runBaseline} === ${source})`;

type PlaybackEvidence = {
  duration: number | null;
  timelineEnd: number | null;
  playing: boolean;
  mediaPaused: boolean;
  sourceSettled: boolean;
};

export type SpeechAudioEvidence = {
  generating: boolean;
  controlsReady: boolean;
  hasSource: boolean;
  awaitingNewAudio: boolean;
  playback: PlaybackEvidence;
};

export const speechAudioEvidence = `(() => {
  const panel = ${item("player")};
  const audio = panel?.querySelector('audio');
  const seek = ${item("seek", "panel")};
  return {
    generating: ${exists("stop")},
    controlsReady: ${enabled(item("run"))} && ${enabled(item("download", "panel"))},
    hasSource: Boolean(audio?.src || audio?.currentSrc),
    awaitingNewAudio: ${awaitingNewAudio},
    playback: {
      duration: audio?.duration ?? null,
      timelineEnd: seek?.max ? Number(seek.max) : null,
      playing: ${exists("pause", "panel")},
      mediaPaused: audio?.paused ?? true,
      sourceSettled: Boolean(audio?.currentSrc && (!audio.src || audio.src === audio.currentSrc))
    }
  };
})()`;

export function playbackIsFinal(
  playback: PlaybackEvidence,
): playback is PlaybackEvidence & { duration: number } {
  const { duration, timelineEnd, playing, mediaPaused, sourceSettled } = playback;
  return (
    duration !== null &&
    duration > 0 &&
    sourceSettled &&
    !(playing && mediaPaused) &&
    (timelineEnd === null || timelineEnd <= Math.ceil(duration))
  );
}

export function inspectSpeechAudio(evidence: SpeechAudioEvidence) {
  if (evidence.generating) return { phase: "generating", duration: null } as const;
  if (!playbackIsFinal(evidence.playback)) {
    return { phase: evidence.hasSource ? "streaming" : "idle", duration: null } as const;
  }
  if (evidence.controlsReady && !evidence.awaitingNewAudio) {
    return { phase: "ready", duration: evidence.playback.duration } as const;
  }
  return { phase: "idle", duration: null } as const;
}

export const readSpeechAudio = () =>
  inspectSpeechAudio(js<SpeechAudioEvidence>(speechAudioEvidence));

export const clearRunBaseline = () => {
  js(`delete ${runBaseline}`);
};

export type AudioWaitDecision =
  | { action: "ready"; duration: number }
  | { action: "wait"; idleSince: number }
  | { action: "fail"; reason: string; clearBaseline: boolean };

export function evaluateAudioWaitTick(input: {
  phase: "generating" | "streaming" | "ready" | "idle";
  duration: number | null;
  awaitingNewAudio: boolean;
  alert: string;
  submitted: boolean;
  idleSince: number;
  now: number;
  graceMs?: number;
}): AudioWaitDecision {
  const graceMs = input.graceMs ?? 10_000;
  if (input.phase === "ready" && input.duration !== null) {
    return { action: "ready", duration: input.duration };
  }
  if (input.phase === "generating" || input.phase === "streaming") {
    return { action: "wait", idleSince: 0 };
  }
  if (!input.submitted && !input.awaitingNewAudio) {
    return {
      action: "fail",
      reason: input.alert
        ? `AI Studio says: ${input.alert}`
        : "No speech generation or playable audio is present on this tab. Check status before collecting.",
      clearBaseline: true,
    };
  }
  const since = input.idleSince || input.now;
  if (input.alert && input.now - since >= 2_000) {
    return {
      action: "fail",
      reason: `AI Studio says: ${input.alert}`,
      clearBaseline: true,
    };
  }
  if (input.now - since >= graceMs) {
    return {
      action: "fail",
      reason: input.alert
        ? `AI Studio says: ${input.alert}`
        : "Speech generation stopped without producing audio. Check status and any AI Studio alert.",
      clearBaseline: true,
    };
  }
  return { action: "wait", idleSince: since };
}

export function decodeWav(data: string) {
  const prefix = "data:audio/wav;base64,";
  if (!data.startsWith(prefix))
    throw new StepError("The AI Studio player did not expose a WAV data source.");
  return requireWav(Buffer.from(data.slice(prefix.length), "base64"));
}

export function requireWav(bytes: Buffer) {
  const { correction } = inspectWav(bytes);
  if (!correction) return bytes;
  const corrected = Buffer.from(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  corrected.writeUInt32LE(correction.rate, correction.offset);
  return corrected;
}

export function inspectWav(bytes: Buffer) {
  if (
    bytes.length <= 44 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE" ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  ) {
    throw new StepError("TTS audio is truncated or is not a valid RIFF WAVE file.");
  }
  let bytesPerSecond = 0;
  let frameBytes = 0;
  let dataBytes = 0;
  let correction: { rate: number; offset: number } | undefined;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const chunk = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const content = offset + 8;
    if (content + size > bytes.length) throw new StepError("TTS audio has a truncated WAV chunk.");
    if (chunk === "fmt " && size >= 16) {
      const offset = content + 8;
      bytesPerSecond = bytes.readUInt32LE(offset);
      if (bytes.readUInt16LE(content) === 1) {
        frameBytes = bytes.readUInt16LE(content + 12);
        const pcmRate = bytes.readUInt32LE(content + 4) * frameBytes;
        if (!pcmRate || pcmRate > 0xffffffff) throw new StepError("WAV has an invalid PCM format.");
        if (bytesPerSecond !== pcmRate) correction = { rate: pcmRate, offset };
        bytesPerSecond = pcmRate;
      }
    }
    if (chunk === "data") dataBytes += size;
    offset = content + size + (size % 2);
  }
  if (!bytesPerSecond || !dataBytes || (frameBytes > 0 && dataBytes % frameBytes !== 0))
    throw new StepError("WAV output has no usable format or audio data chunk.");
  return { duration: dataBytes / bytesPerSecond, correction };
}

export async function saveNewFile(output: string, bytes: Buffer, force = false) {
  const destination = resolve(output);
  await mkdir(dirname(destination), { recursive: true });
  const stage = await mkdtemp(join(dirname(destination), ".aistudio-tts-"));
  const temporary = join(stage, "audio.wav");
  try {
    await writeFile(temporary, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    if (force) await rename(temporary, destination);
    else await link(temporary, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new StepError(
        `Output already exists: ${destination}. Choose a new take path or pass --force.`,
      );
    }
    throw error;
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    await rmdir(stage);
  }
  return destination;
}

export function submitSpeech() {
  const { phase } = readSpeechAudio();
  if (phase === "generating" || phase === "streaming") {
    throw new StepError(
      "This tab is still generating or streaming. Collect on this tab before running again.",
    );
  }
  if (!js<boolean>(enabled(item("run")))) {
    throw new StepError(
      "Run is unavailable. Check the text, open panels, and any AI Studio alert.",
    );
  }
  js(`(${runBaseline} = ${source}, true)`);
  try {
    tap("run");
  } catch (error) {
    clearRunBaseline();
    throw error;
  }
}

export async function waitForAudio(timeoutMs: number, opts: { submitted?: boolean } = {}) {
  const start = Date.now();
  let heartbeat = start;
  let idleSince = 0;
  const submitted = opts.submitted ?? false;
  while (Date.now() - start < timeoutMs) {
    const evidence = js<SpeechAudioEvidence>(speechAudioEvidence);
    const state = inspectSpeechAudio(evidence);
    const now = Date.now();
    const alert = state.phase === "idle" ? pageAlerts() : "";
    const decision = evaluateAudioWaitTick({
      phase: state.phase,
      duration: state.duration,
      awaitingNewAudio: evidence.awaitingNewAudio,
      alert,
      submitted,
      idleSince,
      now,
    });
    if (decision.action === "ready") {
      clearRunBaseline();
      return decision.duration;
    }
    if (decision.action === "fail") {
      if (decision.clearBaseline) clearRunBaseline();
      throw new StepError(decision.reason);
    }
    idleSince = decision.idleSince;
    if (now - heartbeat >= 15_000) {
      heartbeat = now;
      console.error(`… waiting for speech audio (${state.phase}, ${secs(heartbeat - start)}).`);
    }
    await pollPause();
  }
  throw new StepError(
    `No completed audio verified after ${secs(timeoutMs)}. Keep the tab open and run collect on the same tab. Check status before running again.`,
  );
}

export async function exportAudio(output: string, force = false) {
  const data = js<string>(source);
  const bytes = decodeWav(data);
  const path = await saveNewFile(output, bytes, force);
  return { path, bytes: bytes.length, duration: inspectWav(bytes).duration };
}
