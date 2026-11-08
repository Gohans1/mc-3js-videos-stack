// brickwall.ts as an AudioWorklet, for the master stage to play through (mixer.ts stage). Bundled on its own by Vite (?worker&url)
import { Brickwall } from "./brickwall";

declare const sampleRate: number;
declare class AudioWorkletProcessor {}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class BrickwallProcessor extends AudioWorkletProcessor {
  private readonly limiter = new Brickwall(sampleRate, 2);
  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0];
    this.limiter.process(inputs[0] ?? [], out, out[0].length); // with nothing coming in it still empties its look-ahead
    return true;
  }
}
registerProcessor("brickwall", BrickwallProcessor);
