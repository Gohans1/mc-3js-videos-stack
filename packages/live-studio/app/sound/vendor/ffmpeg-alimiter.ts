/*!
 * Copyright (C) 2001-2010 Krzysztof Foltman, Markus Schmidt, Thor Harald Johansen and others
 * Copyright (c) 2015 Paul B Mahol
 *
 * This file is part of FFmpeg.
 *
 * FFmpeg is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2.1 of the License, or (at your option) any later version.
 *
 * FFmpeg is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with FFmpeg; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA
 */

// SPDX-License-Identifier: LGPL-2.1-or-later
// Adapted from FFmpeg n8.1.1 af_alimiter.c, 2026-11-09: planar streaming I/O;
// fixed level_in/out=1, level=false, asc=false, latency=false. Original and license are alongside this file.
export class FFmpegLimiter {
  readonly delay: number;
  private readonly channels: number;
  private readonly size: number;
  private readonly buffer: Float64Array;
  private readonly nextpos: Int32Array;
  private readonly nextdelta: Float64Array;
  private readonly limit: number;
  private readonly releaseSamples: number;
  private pos = 0;
  private att = 1;
  private delta = 0;
  private nextiter = 0;
  private nextlen = 0;

  constructor(rate: number, channels: number, limit: number, attack: number, release: number) {
    this.channels = channels;
    this.limit = limit;
    this.releaseSamples = rate * release;
    const size = Math.floor(rate * attack * channels);
    this.size = size - (size % channels);
    if (this.size < channels) throw new RangeError("Limiter attack must cover at least one sample");
    this.delay = this.size / channels - 1;
    this.buffer = new Float64Array(this.size);
    this.nextpos = new Int32Array(this.size).fill(-1);
    this.nextdelta = new Float64Array(this.size);
  }

  process(input: readonly Float32Array[], output: readonly Float32Array[], frames: number) {
    const { channels, size, buffer, nextpos, nextdelta, limit, releaseSamples } = this;
    for (let n = 0; n < frames; n++) {
      let peak = 0;
      for (let c = 0; c < channels; c++) {
        const sample = input[c]?.[n] ?? 0;
        buffer[this.pos + c] = sample;
        peak = Math.max(peak, Math.abs(sample));
      }
      if (peak > limit) {
        const patt = Math.min(limit / peak, 1);
        const rdelta = (1 - patt) / releaseSamples;
        const delta = ((limit / peak - this.att) / size) * channels;
        if (delta < this.delta) {
          this.delta = delta;
          nextpos[0] = this.pos;
          nextpos[1] = -1;
          nextdelta[0] = rdelta;
          this.nextlen = 1;
          this.nextiter = 0;
        } else {
          let found = false,
            i;
          for (i = this.nextiter; i < this.nextiter + this.nextlen; i++) {
            const j = i % size;
            let ppeak = 0;
            if (nextpos[j] >= 0)
              for (let c = 0; c < channels; c++)
                ppeak = Math.max(ppeak, Math.abs(buffer[nextpos[j] + c]));
            const pdelta =
              (limit / peak - limit / ppeak) / (((size - nextpos[j] + this.pos) % size) / channels);
            if (pdelta < nextdelta[j]) {
              nextdelta[j] = pdelta;
              found = true;
              break;
            }
          }
          if (found) {
            this.nextlen = i - this.nextiter + 1;
            nextpos[(this.nextiter + this.nextlen) % size] = this.pos;
            nextdelta[(this.nextiter + this.nextlen) % size] = rdelta;
            nextpos[(this.nextiter + this.nextlen + 1) % size] = -1;
            this.nextlen++;
          }
        }
      }
      const at = (this.pos + channels) % size;
      peak = 0;
      for (let c = 0; c < channels; c++) peak = Math.max(peak, Math.abs(buffer[at + c]));
      this.att += this.delta;
      for (let c = 0; c < output.length; c++)
        output[c][n] =
          c < channels ? Math.max(-limit, Math.min(limit, buffer[at + c] * this.att)) : 0;
      if (at === nextpos[this.nextiter]) {
        this.delta = nextdelta[this.nextiter];
        this.att = limit / peak;
        this.nextlen--;
        nextpos[this.nextiter] = -1;
        this.nextiter = (this.nextiter + 1) % size;
      }
      if (this.att > 1) {
        this.att = 1;
        this.delta = 0;
        this.nextiter = 0;
        this.nextlen = 0;
        nextpos[0] = -1;
      }
      if (this.att <= 0) {
        this.att = 1e-13;
        this.delta = (1 - this.att) / releaseSamples;
      }
      if (this.att !== 1 && 1 - this.att < 1e-13) this.att = 1;
      if (this.delta !== 0 && Math.abs(this.delta) < 1e-14) this.delta = 0;
      this.pos = at;
    }
  }
}
