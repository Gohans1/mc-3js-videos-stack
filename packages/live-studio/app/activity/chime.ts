import { S } from "../core/state";
import { get } from "../core/store";
import { getAudioCtx, hasSounding } from "../sound/clock";
import { auditionActive } from "../sound/sound";

let last = -Infinity;

export const armActivityChime = () => {
  if (typeof AudioContext !== "undefined")
    void getAudioCtx()
      .resume()
      .catch(() => {});
};

export const listenForChimeActivation = () => {
  const unlock = (event: Event) => {
    if (!event.isTrusted || !navigator.userActivation?.isActive) return;
    window.removeEventListener("pointerup", unlock, true);
    window.removeEventListener("keydown", unlock, true);
    if (get().activityChime) armActivityChime();
  };
  window.addEventListener("pointerup", unlock, true);
  window.addEventListener("keydown", unlock, true);
};

const scheduleTing = (ctx: AudioContext, volume: number) => {
  const now = performance.now();
  if (now - last < 1500) return;
  last = now;
  const at = ctx.currentTime;
  const peak = Math.min(0.18, 0.12 * volume);
  for (const [offset, frequency, decay] of [
    [0, 880, 0.14],
    [0.065, 1318.5, 0.22],
  ] as const) {
    const start = at + offset;
    const tone = ctx.createOscillator();
    const envelope = ctx.createGain();
    tone.type = "sine";
    tone.frequency.value = frequency;
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(peak, start + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0005, start + decay);
    tone.connect(envelope).connect(ctx.destination);
    tone.onended = () => envelope.disconnect();
    tone.start(start);
    tone.stop(start + decay + 0.01);
  }
};

export const playActivityChime = () => {
  const { activityChime, muted, volume, previewAudio, modal } = get();
  if (
    !activityChime ||
    muted ||
    !volume ||
    S.playing ||
    previewAudio ||
    hasSounding() ||
    auditionActive() ||
    modal ||
    document.fullscreenElement ||
    document.hidden ||
    !navigator.userActivation?.hasBeenActive ||
    typeof AudioContext === "undefined"
  )
    return;

  if (performance.now() - last < 1500) return;
  const ctx = getAudioCtx();
  if (ctx.state === "running") {
    scheduleTing(ctx, volume);
  } else if (ctx.state === "suspended") {
    void ctx
      .resume()
      .then(() => {
        if (ctx.state === "running" && get().activityChime && !get().muted) {
          scheduleTing(ctx, get().volume);
        }
      })
      .catch(() => {});
  }
};
