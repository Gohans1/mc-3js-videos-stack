import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dir, "../.."),
  home = resolve(process.env.MC_MEDIA_HOME || join(root, "vault/tools/media"));
const python = (id) =>
  join(home, id, "env", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
test(
  "native ByteTrack expires identities across an actual source-clock gap",
  { timeout: 60000 },
  () => {
    assert.ok(
      existsSync(python("track")),
      "media setup track is required for this optional native check",
    );
    const out = mkdtempSync(join(tmpdir(), "tracking-time-native-"));
    const code = `import sys,json,types
from pathlib import Path
import cv2,numpy as np,supervision as sv
sys.path.insert(0,sys.argv[1])
from tracking import predict
out=Path(sys.argv[2]);cv2.imwrite(str(out/'image.png'),np.zeros((64,64,3),dtype=np.uint8))
class Detector:
 def __init__(self,**kwargs): pass
 def inference(self,**kwargs): return self
 def predict(self,*args,**kwargs): return sv.Detections(xyxy=np.array([[10.,10.,40.,40.]]),confidence=np.array([.99]),class_id=np.array([1]))
sys.modules['rfdetr']=types.SimpleNamespace(RFDETRNano=Detector)
args=types.SimpleNamespace(tool='track',threads=2,fps=5,threshold=.3,classes=[])
frames=[{'sourceSecond':t,'file':'image.png'} for t in [0,.2,3,3.2]]
rows=list(predict(args,Path('unused'),frames,out))
(out/'tracks.json').write_text(json.dumps(rows))
assert [row['boxes'][0]['trackId'] for row in rows]==[None,0,None,1],rows
`;
    const result = spawnSync(python("track"), ["-c", code, join(root, "scripts/media"), out], {
      encoding: "utf8",
      timeout: 55000,
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    console.log("native timestamp evidence", out);
  },
);

test(
  "native Foley indexes cached tags offline when enabled is omitted",
  { timeout: 240000 },
  () => {
    assert.ok(
      existsSync(python("foley")),
      "media setup foley and one cached htsat-unfused run are required",
    );
    const out = mkdtempSync(join(tmpdir(), "foley-default-native-")),
      library = join(out, "library"),
      store = join(out, "catalog");
    mkdirSync(library);
    const tone = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=2",
        "-ar",
        "48000",
        join(library, "tone.wav"),
      ],
      { encoding: "utf8", timeout: 15000 },
    );
    assert.equal(tone.status, 0, tone.stderr);
    const config = join(out, "foley.toml");
    writeFileSync(
      config,
      `[library]\nroot=${JSON.stringify(library)}\nsettle_minutes=0\n[storage]\ndata_dir=${JSON.stringify(store)}\n[models]\ndevice="cpu"\nclap=["htsat-unfused"]\n`,
    );
    writeFileSync(
      join(out, "sitecustomize.py"),
      "import urllib.request\ndef blocked(*args,**kwargs):\n raise RuntimeError('network blocked by native regression')\nurllib.request.urlopen=blocked\n",
    );
    const jobs = join(out, "jobs");
    const result = spawnSync(
      process.execPath,
      [
        join(root, "scripts/media.mjs"),
        "foley",
        "index",
        "--config",
        config,
        "--limit",
        "1",
        "--out",
        jobs,
        "--minutes",
        "3",
      ],
      {
        encoding: "utf8",
        timeout: 210000,
        env: {
          ...process.env,
          MC_MEDIA_HOME: home,
          PYTHONPATH: out,
          HF_HUB_OFFLINE: "1",
          TRANSFORMERS_OFFLINE: "1",
        },
      },
    );
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const run = join(
      jobs,
      readdirSync(jobs).find((n) => n.startsWith("run-")),
    );
    const data = JSON.parse(readFileSync(join(run, "result.json"), "utf8"));
    assert.equal(data.catalog.models.tags.done, 1);
    assert.equal(data.catalog.models.tags.pending, 0);
    assert.equal(data.catalog.error_count, 0);
    console.log("native Foley offline evidence", run);
  },
);
