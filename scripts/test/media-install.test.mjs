import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../media/install.py", import.meta.url));
const prefix =
  "import runpy,sys,zipfile,hashlib; from pathlib import Path; m=runpy.run_path(sys.argv[1]); root=Path(sys.argv[2]); ";
test("verified archives extract dependencies and keep files outside their destination", (t) => {
  const root = mkdtempSync(join(tmpdir(), "media-assets-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const code =
    prefix +
    "archive=root/'asset.zip'; z=zipfile.ZipFile(archive,'w'); z.writestr('bin/tool.exe',b'tool'); z.writestr('LICENSE',b'terms'); z.close(); sha=hashlib.sha256(archive.read_bytes()).hexdigest(); m['extract_verified'](archive,root/'out',sha,archive.stat().st_size); assert (root/'out/bin/tool.exe').read_bytes()==b'tool'; assert (root/'out/LICENSE').read_bytes()==b'terms'";
  const r = spawnSync("python", ["-c", code, script, root], { encoding: "utf8", timeout: 15000 });
  assert.equal(r.status, 0, r.stderr);
});

test("archive traversal to a new path is rejected before extraction starts", (t) => {
  const root = mkdtempSync(join(tmpdir(), "media-assets-path-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const code =
    prefix +
    "archive=root/'asset.zip'; z=zipfile.ZipFile(archive,'w'); z.writestr('../new-file',b'bad'); z.close(); sha=hashlib.sha256(archive.read_bytes()).hexdigest()\ntry: m['extract_verified'](archive,root/'out',sha,archive.stat().st_size)\nexcept ValueError: pass\nelse: raise AssertionError('unsafe archive accepted')\nassert not (root/'out').exists()\nassert not (root/'new-file').exists()";
  const r = spawnSync("python", ["-c", code, script, root], { encoding: "utf8", timeout: 15000 });
  assert.equal(r.status, 0, r.stderr);
});

test("fresh and interrupted source clones check out files when HEAD already equals their pin", (t) => {
  const root = mkdtempSync(join(tmpdir(), "media-source-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const code =
    prefix +
    "import subprocess; repo=root/'origin'; repo.mkdir(); subprocess.run(['git','init',str(repo)],check=True,capture_output=True); (repo/'CMakeLists.txt').write_text('project(test)'); subprocess.run(['git','-C',str(repo),'add','.'],check=True); subprocess.run(['git','-C',str(repo),'-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','fixture'],check=True,capture_output=True); pin=subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip()\nfor name in ['fresh','resumed']:\n source=root/name\n if name=='resumed': subprocess.run(['git','clone','--no-checkout',str(repo),str(source)],check=True,capture_output=True)\n m['prepare_source'](str(repo),pin,source)\n assert (source/'CMakeLists.txt').read_text()=='project(test)'";
  const r = spawnSync("python", ["-c", code, script, root], { encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
});

test("interrupted archive extraction can resume from the verified archive", (t) => {
  const root = mkdtempSync(join(tmpdir(), "media-extract-resume-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const code =
    prefix +
    "archive=root/'asset.zip'; destination=root/'out'; payload=b'a'*3000000\nwith zipfile.ZipFile(archive,'w') as z: z.writestr('runtime.dll',payload)\nsha=hashlib.sha256(archive.read_bytes()).hexdigest(); size=archive.stat().st_size; original=zipfile.ZipExtFile.read; calls=0\ndef interrupted(self,*args,**kwargs):\n global calls\n calls+=1\n if calls==2: raise KeyboardInterrupt('interrupted read')\n return original(self,*args,**kwargs)\nzipfile.ZipExtFile.read=interrupted\ntry: m['extract_verified'](archive,destination,sha,size)\nexcept KeyboardInterrupt: pass\nfinally: zipfile.ZipExtFile.read=original\nassert not (destination/'runtime.dll').exists()\nm['extract_verified'](archive,destination,sha,size)\nassert (destination/'runtime.dll').read_bytes()==payload\nassert hashlib.sha256(archive.read_bytes()).hexdigest()==sha";
  const r = spawnSync("python", ["-c", code, script, root], { encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
});
test("bad hashes and traversal cannot overwrite existing files", (t) => {
  const root = mkdtempSync(join(tmpdir(), "media-assets-bad-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const code =
    prefix +
    "archive=root/'asset.zip'; sentinel=root/'keep'; sentinel.write_bytes(b'kept'); z=zipfile.ZipFile(archive,'w'); z.writestr('../keep',b'overwritten'); z.close(); sha=hashlib.sha256(archive.read_bytes()).hexdigest(); errors=[]\nfor checksum in ['0'*64,sha]:\n try: m['extract_verified'](archive,root/'out',checksum,archive.stat().st_size)\n except ValueError as e: errors.append(str(e))\nassert len(errors)==2,errors\nassert sentinel.read_bytes()==b'kept'\nassert not (root/'out').exists()";
  const r = spawnSync("python", ["-c", code, script, root], { encoding: "utf8", timeout: 15000 });
  assert.equal(r.status, 0, r.stderr);
});
