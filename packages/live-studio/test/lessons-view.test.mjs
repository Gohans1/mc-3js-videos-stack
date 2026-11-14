import { describe, test } from "bun:test";
import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LessonMarkdownView } from "../app/lessons/LessonMarkdownView.tsx";
import {
  filterLessons,
  findActiveHeading,
  findFoldedMatches,
  foldText,
  parseInlines,
  parseLessonBlocks,
  parseLessonHeadings,
} from "../app/lessons/markdown.ts";

describe("lessons search folding (ported from md-phone)", () => {
  test("foldText normalizes Vietnamese diacritics and stroke d case-insensitively", () => {
    assert.equal(foldText("Đổi góc quay camera ở đây"), "doi goc quay camera o day");
    assert.equal(foldText("Chớp mắt tự nhiên"), "chop mat tu nhien");
  });

  test("findFoldedMatches maps folded query positions back to original UTF-16 indices", () => {
    const src = "Đèn phòng bật chậm ở shot đầu";
    const m = findFoldedMatches(src, "den phong");
    assert.equal(m.length, 1);
    assert.equal(src.slice(m[0].start, m[0].end), "Đèn phòng");

    const m2 = findFoldedMatches(src, "shot dau");
    assert.equal(m2.length, 1);
    assert.equal(src.slice(m2[0].start, m2[0].end), "shot đầu");
    assert.deepEqual(findFoldedMatches(src, "   "), []);
  });
});

describe("lessons headings & bullet counts", () => {
  test("counts bullets under each heading and ignores frontmatter, fenced code, and horizontal rules", () => {
    const md = [
      "---",
      "when: lighting, indoor scenes",
      "---",
      "# Lighting",
      "- Key light stays warm",
      "* Rim separates Steve from wall",
      "---",
      "```md",
      "# Not a heading",
      "- Not a bullet",
      "```",
      "## Fill & Bounce",
      "+ Keep shadow floor readable",
    ].join("\n");

    const heads = parseLessonHeadings(md);
    assert.equal(heads.length, 2);
    assert.deepEqual(heads[0], { line: 4, depth: 1, title: "Lighting", bullets: 2 });
    assert.deepEqual(heads[1], { line: 12, depth: 2, title: "Fill & Bounce", bullets: 1 });
  });
});

describe("lessons markdown block parser for Read view", () => {
  test("emits typed blocks with 1-based source line numbers and strips frontmatter", () => {
    const md = [
      "---",
      "when: hands",
      "---",
      "# Hands & Props",
      "",
      "Keep **wrist** aligned with `propRoot` and see [guide](https://example.com/hands).",
      "",
      "> Never snap joints on 1 frame.",
      "",
      "- Step one",
      "- Step two",
      "",
      "1. First",
      "2. Second",
      "",
      "| Part | Rule |",
      "| --- | --- |",
      "| Elbow | Follow shoulder arc |",
      "",
      "```ts",
      "const ease = 0.25;",
      "```",
      "",
      "---",
    ].join("\n");

    const blocks = parseLessonBlocks(md);
    assert.deepEqual(
      blocks.map((b) => [b.type, b.line]),
      [
        ["heading", 4],
        ["paragraph", 6],
        ["blockquote", 8],
        ["list", 10],
        ["list", 13],
        ["table", 16],
        ["code", 20],
        ["hr", 24],
      ],
    );

    const h = blocks[0];
    if (h?.type === "heading") assert.equal(h.depth, 1);

    const p = blocks[1];
    if (p?.type === "paragraph") {
      assert.ok(p.inlines.some((t) => t.kind === "strong" && t.text === "wrist"));
      assert.ok(p.inlines.some((t) => t.kind === "code" && t.text === "propRoot"));
      assert.ok(
        p.inlines.some(
          (t) => t.kind === "link" && t.text === "guide" && t.href === "https://example.com/hands",
        ),
      );
    }

    const tbl = blocks[5];
    if (tbl?.type === "table") {
      assert.deepEqual(tbl.headers, ["Part", "Rule"]);
      assert.equal(tbl.rows.length, 1);
      assert.deepEqual(tbl.rows[0], ["Elbow", "Follow shoulder arc"]);
    }

    const code = blocks[6];
    if (code.type === "code") {
      assert.equal(code.lang, "ts");
      assert.equal(code.code, "const ease = 0.25;");
    }
  });

  test("drops javascript:/data: links and renders link text safely", () => {
    const md = "Click [bad](javascript:alert(1)) or [ok](/lessons/pose.md).";
    const [b] = parseLessonBlocks(md);
    assert.equal(b?.type, "paragraph");
    if (b?.type === "paragraph") {
      assert.equal(
        b.inlines.some((t) => t.kind === "link" && /javascript:/i.test(t.href)),
        false,
      );
      assert.ok(b.inlines.some((t) => t.kind === "link" && t.href === "/lessons/pose.md"));
    }
  });

  test("preserves intraword snake_case underscores while parsing delimited _emphasis_", () => {
    const tokens = parseInlines("Use voice_map_json and make_lite for _real emphasis_ only");
    assert.equal(
      tokens.some((t) => t.kind === "em" && t.text === "map"),
      false,
    );
    assert.ok(tokens.some((t) => t.kind === "em" && t.text === "real emphasis"));
    assert.equal(
      tokens.map((t) => t.text).join(""),
      "Use voice_map_json and make_lite for real emphasis only",
    );
  });

  test("preserves balanced parentheses inside markdown links and autolinks", () => {
    const tokens = parseInlines(
      "See [Wiki](https://en.wikipedia.org/wiki/Foo_(bar)) and https://example.com/a_(b).",
    );
    assert.ok(
      tokens.some(
        (t) =>
          t.kind === "link" &&
          t.text === "Wiki" &&
          t.href === "https://en.wikipedia.org/wiki/Foo_(bar)",
      ),
    );
    assert.ok(tokens.some((t) => t.kind === "link" && t.href === "https://example.com/a_(b)"));
  });
});

describe("filterLessons & findActiveHeading", () => {
  const sampleFiles = [
    {
      path: "camera.md",
      text: "---\nwhen: camera\n---\n# Góc máy\n- Giữ đầu nhân vật không chạm mép trên\n",
    },
    {
      path: "sound/footsteps.md",
      text: "# Footsteps\n- Giảm âm lượng bước chân khi thoại đang chạy\n",
    },
  ];

  test("filterLessons matches path or body without Vietnamese diacritics and extracts matching line", () => {
    const empty = filterLessons(sampleFiles, "   ");
    assert.equal(empty.length, 2);
    assert.equal(empty[0].matchLine, null);

    const byBody = filterLessons(sampleFiles, "cham mep tren");
    assert.equal(byBody.length, 1);
    assert.equal(byBody[0].file.path, "camera.md");
    assert.equal(byBody[0].matchLine, 5);
    assert.match(byBody[0].snippet ?? "", /Giữ đầu nhân vật/);

    const byPath = filterLessons(sampleFiles, "footsteps");
    assert.equal(byPath.length, 1);
    assert.equal(byPath[0].file.path, "sound/footsteps.md");

    assert.deepEqual(filterLessons(sampleFiles, "khong ton tai"), []);
  });

  test("findActiveHeading returns active heading at or above current top line", () => {
    const heads = parseLessonHeadings("# Intro\n\n## Shot 1\n- a\n## Shot 2\n- b\n");
    assert.equal(findActiveHeading(heads, 1), 1);
    assert.equal(findActiveHeading(heads, 2), 1);
    assert.equal(findActiveHeading(heads, 3), 3);
    assert.equal(findActiveHeading(heads, 4), 3);
    assert.equal(findActiveHeading(heads, 5), 5);
    assert.equal(findActiveHeading([], 4), null);
  });
});

describe("LessonMarkdownView accessibility & heading nesting", () => {
  test("HeadingBlock flattens links inside its edit button and exposes an Edit aria-label", () => {
    const html = renderToStaticMarkup(
      createElement(LessonMarkdownView, {
        text: "# See [Guide](https://example.com) and `code`\n",
      }),
    );
    const buttonMatch = html.match(/<button[^>]*>[\s\S]*?<\/button>/);
    assert.ok(buttonMatch, "heading should render an edit button");
    assert.equal(/<a[\s>]/.test(buttonMatch[0]), false, "button must not nest interactive <a>");
    assert.match(buttonMatch[0], /aria-label="Edit .*line 1"/);
    assert.match(buttonMatch[0], /Guide/);
  });

  test("task list items announce completed vs incomplete state to screen readers", () => {
    const html = renderToStaticMarkup(
      createElement(LessonMarkdownView, {
        text: "- [x] Done task\n- [ ] Open task\n",
      }),
    );
    assert.match(html, /class="sr-only">Done: <\/span>/);
    assert.match(html, /class="sr-only">Todo: <\/span>/);
  });

  test("parseInlines avoids ReDoS backtracking on unclosed underscores and preserves inner emphasis", () => {
    const t0 = performance.now();
    const evil = `_${Array.from({ length: 24 }, () => "a_b").join(" ")} unclosed`;
    const tokens = parseInlines(evil);
    const ms = performance.now() - t0;
    assert.ok(ms < 50, `expected linear parse, took ${ms.toFixed(1)}ms`);
    assert.equal(tokens.map((t) => t.text).join(""), evil);

    assert.deepEqual(parseInlines("_a _b_"), [
      { kind: "text", text: "_a " },
      { kind: "em", text: "b" },
    ]);
  });

  test("LessonMarkdownView uses Inter md font and 42rem readable measure", () => {
    const html = renderToStaticMarkup(
      createElement(LessonMarkdownView, { text: "# Heading\n\nBody text with `inlineCode`.\n" }),
    );
    assert.match(html, /font-md/);
    assert.match(html, /max-w-\[42rem\]/);
    assert.match(html, /font-mono/);
  });
});
