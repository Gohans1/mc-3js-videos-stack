// The master limiter, as mix.py's alimiter=limit=0.45:level=false does it: no sample past the ceiling, ever. It looks ATTACK
// ahead, takes the lowest gain any sample in that stretch needs, and eases into it over the same stretch (the held minimum,
// averaged over the window, can't be above what the loudest sample needs when it arrives); then it comes back to unity in a
// straight line over RELEASE. alimiter's defaults, 5 ms and 50 ms. Written here, not ported from ffmpeg's code (LGPL).
// Streamed, so the page plays through it (brickwall.worklet.ts) and the meter's offline render of the film too (meter.ts):
// both hear what the final render will hold. The sound comes out ATTACK late
export const CEILING = 0.45, ATTACK = 0.005, RELEASE = 0.05;

export class Brickwall {
  readonly delay: number; // in samples: the look-ahead, and how late the sound comes out
  private readonly n: number;
  private readonly held: Float32Array[]; // the input, waiting out the look-ahead
  private readonly need: Float64Array; private readonly at: Int32Array; // the gains needed, kept rising (a sliding minimum)
  private readonly gains: Float64Array; // the last n gains after release, for the average
  private readonly ceiling: number;
  private readonly release: number; // in samples
  private head = 0; private tail = 0; private i = 0; private sum: number; private gain = 1; private step = 0;

  constructor(rate: number, channels: number, ceiling = CEILING, attack = ATTACK, release = RELEASE) {
    this.ceiling = ceiling;
    this.delay = Math.max(1, Math.round(attack * rate));
    this.n = this.delay + 1;
    this.held = Array.from({ length: channels }, () => new Float32Array(this.n));
    this.need = new Float64Array(this.n); this.at = new Int32Array(this.n);
    this.gains = new Float64Array(this.n).fill(1);
    this.sum = this.n;
    this.release = release * rate;
  }

  // in and out may be the same arrays; a missing input channel counts as silence
  process(input: readonly Float32Array[], output: readonly Float32Array[], frames: number) {
    const { n, held, need, at, gains, ceiling } = this;
    for (let f = 0; f < frames; f++) {
      const i = this.i++, slot = i % n;
      let peak = 0;
      for (let c = 0; c < held.length; c++) { const x = input[c]?.[f] ?? 0; held[c][slot] = x; const a = Math.abs(x); if (a > peak) peak = a; }
      const g = peak > ceiling ? ceiling / peak : 1;
      // The lowest gain over the last n samples, which is the lowest any of the next n needs, seen from the sample going out now
      if (this.tail > this.head && at[this.head % n] <= i - n) this.head++;
      while (this.tail > this.head && need[(this.tail - 1) % n] >= g) this.tail--;
      need[this.tail % n] = g; at[this.tail % n] = i; this.tail++;
      const low = need[this.head % n];
      if (low < this.gain) { this.gain = low; this.step = (1 - low) / this.release; } else this.gain = Math.min(low, this.gain + this.step);
      this.sum += this.gain - gains[slot]; gains[slot] = this.gain;
      const out = (i + 1) % n; // the oldest sample held: the one going out now
      for (let c = 0; c < output.length; c++) output[c][f] = (held[c] ? held[c][out] : 0) * (this.sum / n);
    }
  }
}
