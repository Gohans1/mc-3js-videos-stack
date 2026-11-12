import { FFmpegLimiter } from "./vendor/ffmpeg-alimiter.ts";

export const CEILING = 0.45,
  ATTACK = 0.005,
  RELEASE = 0.05;

export class Brickwall extends FFmpegLimiter {
  constructor(
    rate: number,
    channels: number,
    ceiling = CEILING,
    attack = ATTACK,
    release = RELEASE,
  ) {
    super(rate, channels, ceiling, attack, release);
  }
}
