import assert from "node:assert/strict";
import { test } from "node:test";

import { pathPattern } from "../src/page.mjs";

test("a hand-edited file's pattern matches its path however the slashes and drive letter are written, and nothing else", () => {
  const f = String.raw`C:\Users\a\films\x (1)\src\timeline\cam.json`,
    re = pathPattern(f);
  assert.ok(re.test(f));
  assert.ok(re.test("C:/Users/a/films/x (1)/src/timeline/cam.json"));
  assert.ok(re.test("c:/Users/a/films/x (1)/src/timeline/cam.json"));
  assert.ok(!re.test(`${f}x`));
  assert.ok(!re.test(f.replace("cam.json", "camxjson")));
  assert.ok(!re.test(f.replace("cam.json", "props.json")));
});
