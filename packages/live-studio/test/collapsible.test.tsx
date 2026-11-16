import { test } from "bun:test";
import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Collapsible, CollapsibleContent } from "../app/components/ui/collapsible";

test("CollapsibleContent preserves state-based class names with and without motion", () => {
  for (const variant of ["default", "animated", "reveal"] as const) {
    for (const open of [false, true]) {
      const html = renderToStaticMarkup(
        createElement(
          Collapsible,
          { defaultOpen: open },
          createElement(
            CollapsibleContent,
            {
              keepMounted: true,
              variant,
              className: (state) => (state.open ? "probe-open" : "probe-closed"),
            },
            "Details",
          ),
        ),
      );
      assert.match(html, new RegExp(open ? "probe-open" : "probe-closed"));
    }
  }
});
