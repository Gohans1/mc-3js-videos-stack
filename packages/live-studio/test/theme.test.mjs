// Every step the theme names itself (app/index.css @theme: text-ui, shadow-float...) is one cn() knows (app/lib/utils.ts):
// an unknown text-ui counts as a colour, and cn("text-ui", "text-primary") would silently drop the size
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { cn } from "../app/lib/utils.ts";

const css = readFileSync(new URL("../app/index.css", import.meta.url), "utf8");
const own = (scale) =>
  [...css.matchAll(new RegExp(`^\\s*--${scale}-([a-z]+):`, "gm"))].map((m) => m[1]);

test("a theme font size stays beside a text colour, and replaces another size", () => {
  const sizes = own("text");
  assert.ok(sizes.length > 0);
  for (const n of sizes) {
    assert.equal(cn(`text-${n}`, "text-primary"), `text-${n} text-primary`, `text-${n}`);
    assert.equal(cn("text-sm", `text-${n}`), `text-${n}`, `text-${n}`);
  }
});

test("a theme shadow replaces another shadow", () => {
  const shadows = own("shadow");
  assert.ok(shadows.length > 0);
  for (const n of shadows)
    assert.equal(cn("shadow-sm", `shadow-${n}`), `shadow-${n}`, `shadow-${n}`);
});
