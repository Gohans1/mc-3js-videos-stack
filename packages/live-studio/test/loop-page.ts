import { loopSources } from "../app/sound/loop";

Object.assign(window, {
  renderLoop: async (start: number, len: number, u0: number) => {
    const SR = 48000,
      D = 4 * SR;
    const ctx = new OfflineAudioContext(2, Math.round((len - u0) * SR), SR);
    const buf = ctx.createBuffer(2, D, SR);
    const [l, r] = [buf.getChannelData(0), buf.getChannelData(1)];
    for (let n = 0; n < D; n++) {
      l[n] = n / SR / 4;
      r[n] = 0.5 - n / SR / 8;
    }
    loopSources(ctx, buf, start, len, u0, 0, (u) => u - u0, 1, ctx.destination);
    const out = await ctx.startRendering();
    return [0, 1].map((c) => Array.from(out.getChannelData(c).filter((_, i) => i % 97 === 0)));
  },
});
