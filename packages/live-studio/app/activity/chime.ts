import { S } from "../core/state";
import { get } from "../core/store";
import { getAudioCtx, hasSounding } from "../sound/clock";
import { listening as auditionActive } from "../sound/sound";

let last = -Infinity;

export const armActivityChime = () => {
  if (typeof AudioContext !== "undefined")
    void getAudioCtx()
      .resume()
      .catch(() => {});
};

export const listenForChimeActivation = () => {
  if (!get().activityChime) return;
  const unlock = (event: Event) => {
    if (!event.isTrusted || !navigator.userActivation?.isActive) return;
    window.removeEventListener("pointerup", unlock, true);
    window.removeEventListener("keydown", unlock, true);
    if (get().aiActivity && get().activityChime) armActivityChime();
  };
  window.addEventListener("pointerup", unlock, true);
  window.addEventListener("keydown", unlock, true);
};

export const playActivityChime = () => {
  const { aiActivity, activityChime, muted, volume, previewAudio, modal } = get();
  if (
    !aiActivity ||
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
    !document.hasFocus() ||
    !navigator.userActivation?.hasBeenActive ||
    typeof AudioContext === "undefined"
  )
    return;

  const now = performance.now();
  if (now - last < 5000) return;
  const ctx = getAudioCtx();
  if (ctx.state !== "running") return;
  last = now;
  const at = ctx.currentTime;
  for (const [offset, frequency] of [
    [0, 660],
    [0.07, 880],
  ] as const) {
    const start = at + offset;
    const tone = ctx.createOscillator();
    const envelope = ctx.createGain();
    tone.frequency.value = frequency;
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(0.025 * volume, start + 0.012);
    envelope.gain.linearRampToValueAtTime(0, start + 0.1);
    // The film mix and meter do not receive notification audio.
    tone.connect(envelope).connect(ctx.destination);
    tone.onended = () => envelope.disconnect();
    tone.start(start);
    tone.stop(start + 0.1);
  }
};
