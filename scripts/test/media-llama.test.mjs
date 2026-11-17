import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
const script = fileURLToPath(new URL("../media/llama.py", import.meta.url));
test("local multimodal messages preserve original bytes and the creative prompt", (t) => {
  const root = mkdtempSync(join(tmpdir(), "media-message-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const media = join(root, "frame.png");
  writeFileSync(media, Buffer.from([0, 1, 2, 3, 255]));
  const code =
    "import runpy,sys,json,base64; m=runpy.run_path(sys.argv[1]); content=m['media_content']('vision',sys.argv[2],'What is visible?'); assert content[0]['text']=='What is visible?'; assert base64.b64decode(content[1]['image_url']['url'].split(',')[1])==bytes([0,1,2,3,255]); audio=m['media_content']('caption',sys.argv[2],'Describe sound.'); assert audio[1]['input_audio']['format']=='wav'; assert base64.b64decode(audio[1]['input_audio']['data'])==bytes([0,1,2,3,255])";
  const r = spawnSync("python", ["-c", code, script, media], { encoding: "utf8", timeout: 15000 });
  assert.equal(r.status, 0, r.stderr);
});
