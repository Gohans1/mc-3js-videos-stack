// @ts-nocheck
// The page side of fast_render.mjs: draws frames with the same scene the studio shows and encodes them in the browser
// (mediabunny on WebCodecs, GPU H.264). Same t gives the same picture.
import { buildScene, SHOTS_OUT as SHOTS } from "./scene";
import { BufferTarget, Mp4OutputFormat, Output, VideoSample, VideoSampleSource } from "mediabunny";

const FPS = 30;
const shotAt = (t) => SHOTS.filter((s) => t >= s.t).length;
const post = (url, body) => fetch(url, { method: "POST", body });
const log = (m) => post("/log", String(m));
window.onerror = (m) => { log("ERROR " + m); };
window.onunhandledrejection = (e) => { log("ERROR " + (e.reason?.stack ?? e.reason)); };

(async () => {
  const cfg = await (await fetch("/config")).json();
  const canvas = document.getElementById("gl");
  canvas.width = cfg.W; canvas.height = cfg.H;
  const out = document.createElement("canvas");
  out.width = cfg.W; out.height = cfg.H;
  const ctx = out.getContext("2d");
  const t0 = performance.now();
  const render = await buildScene(canvas, cfg.W, cfg.H, cfg.draft, log);
  log(`scene built in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  const draw = (frame, samples) => {
    const t = frame / FPS;
    ctx.globalAlpha = 1;
    if (samples === 1) { render(t); ctx.drawImage(canvas, 0, 0); }
    else for (let i = 0; i < samples; i++) {
      const ts = (frame + (i / samples) * 0.5) / FPS;
      render(shotAt(ts) === shotAt(t) ? ts : t); // never blur across a cut
      ctx.globalAlpha = 1 / (i + 1);
      ctx.drawImage(canvas, 0, 0);
    }
    if (!cfg.draft) return out;
    // The creator gives feedback by timestamp: mm:ss.sss in the top right of every draft
    const ms = Math.round(t * 1000);
    const label = `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
    ctx.globalAlpha = 1;
    ctx.font = "bold 26px Consolas, monospace"; ctx.textAlign = "right";
    ctx.fillStyle = "rgba(0,0,0,.65)"; ctx.fillRect(cfg.W - 162, 10, 152, 36);
    ctx.fillStyle = "#fff"; ctx.fillText(label, cfg.W - 18, 37);
    return out;
  };

  for (const s of cfg.stills ?? []) {
    const c = draw(s.frame, 1);
    await post(`/still/${s.name}`, await new Promise((res) => c.toBlob(res, "image/jpeg", cfg.quality)));
  }

  for (const job of cfg.jobs ?? []) {
    const started = performance.now();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
    const source = new VideoSampleSource({ codec: "avc", bitrate: cfg.webcodecs.bitrate, hardwareAcceleration: cfg.webcodecs.hardware, keyFrameInterval: 2 });
    output.addVideoTrack(source, { frameRate: FPS });
    await output.start();
    for (let f = job.start; f <= job.stop; f++) {
      const sample = new VideoSample(draw(f, job.samples), { timestamp: (f - job.start) / FPS, duration: 1 / FPS });
      await source.add(sample);
      sample.close();
    }
    await output.finalize();
    await post(`/file/${job.index}`, output.target.buffer);
    log(`shot ${job.index}: ${job.stop - job.start + 1} frames x${job.samples} in ${((performance.now() - started) / 1000).toFixed(1)}s`);
  }
  await post("/done", "");
})();
