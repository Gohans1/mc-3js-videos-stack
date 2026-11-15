import { afterAll, beforeAll, describe, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

import { Alert, AlertDescription } from "../app/components/ui/alert.tsx";
import { Badge } from "../app/components/ui/badge.tsx";
import { Button } from "../app/components/ui/button.tsx";
import { Card, CardContent } from "../app/components/ui/card.tsx";
import { Checkbox } from "../app/components/ui/checkbox.tsx";
import { Empty, EmptyDescription } from "../app/components/ui/empty.tsx";
import { Input } from "../app/components/ui/input.tsx";
import { Table, TableBody, TableCell, TableRow } from "../app/components/ui/table.tsx";
import { Textarea } from "../app/components/ui/textarea.tsx";
import { ToggleGroup, ToggleGroupItem } from "../app/components/ui/toggle-group.tsx";
import { filmPlugin } from "../src/vite_film.mjs";

const STUDIO_DIR = resolve(import.meta.dir, "..");

const srgbToLinear = (c255) => {
  const s = c255 / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const linearToSrgb255 = (c) =>
  Math.round(
    Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)) * 255,
  );

const oklabToRgb = ([L, a, b]) => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    linearToSrgb255(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb255(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb255(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
};

const rgbToOklab = ([r, g, b]) => {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

const parseOklab = (color) => {
  const s = color.trim();
  const mix = s.match(/^color-mix\(\s*in\s+oklab\s*,\s*(.+?)\s*,\s*(.+)\s*\)$/s);
  if (mix) {
    const parsePart = (part) => {
      const pm = part.trim().match(/^(.+?)(?:\s+([\d.]+)%)?$/);
      return { lab: parseOklab(pm[1]), pct: pm[2] ? +pm[2] : null };
    };
    const p1 = parsePart(mix[1]);
    const p2 = parsePart(mix[2]);
    const w1 = p1.pct != null ? p1.pct / 100 : p2.pct != null ? 1 - p2.pct / 100 : 0.5;
    return p1.lab.map((v, i) => v * w1 + p2.lab[i] * (1 - w1));
  }
  if (s.startsWith("#")) {
    const n = Number.parseInt(s.slice(1), 16);
    return rgbToOklab([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
  }
  const m = s.match(/^oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  assert.ok(m, `Expected #hex, oklch(), or color-mix() color, got: ${color}`);
  const L = m[0].includes("%") ? +m[1] / 100 : +m[1];
  const [C, H] = [+m[2], (+m[3] * Math.PI) / 180];
  return [L, C * Math.cos(H), C * Math.sin(H)];
};

const parseColor = (color) => oklabToRgb(parseOklab(color));

// Blend translucent Tailwind utilities in OKLab to match CSS Color 4 compositing
const blendRgba = (fgColor, alpha, bgColor) => {
  const fg = Array.isArray(fgColor) ? rgbToOklab(fgColor) : parseOklab(fgColor);
  const bg = Array.isArray(bgColor) ? rgbToOklab(bgColor) : parseOklab(bgColor);
  return oklabToRgb(fg.map((c, i) => c * alpha + bg[i] * (1 - alpha)));
};

const readCssTokens = () => {
  const css = readFileSync(join(STUDIO_DIR, "app/index.css"), "utf8");
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const vars = new Map();
  for (const m of stripped.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gs)) {
    vars.set(m[1], m[2].trim());
  }
  const token = (name, seen = new Set()) => {
    assert.ok(!seen.has(name), `Cyclic CSS variable --${name}`);
    seen.add(name);
    const val = vars.get(name);
    assert.ok(val, `Expected CSS variable --${name} in app/index.css`);
    return val.replace(/var\(\s*--([a-z0-9-]+)\s*\)/g, (_, ref) => token(ref, new Set(seen)));
  };
  return { vars, token };
};

const relLuminance = ([r, g, b]) => {
  const ch = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};

const contrastRatio = (fg, bg) => {
  const l1 = relLuminance(fg);
  const l2 = relLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

describe("notes UI primitive tokens and variants", () => {
  test("Card, TableRow, EmptyDescription, and ToggleGroup preserve custom @theme typography with text colors", () => {
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(
          Card,
          { tone: "check", className: "text-tag text-foreground" },
          createElement(CardContent, null, "check card"),
        ),
        createElement(Card, { tone: "done" }, createElement(CardContent, null, "done card")),
        createElement(
          Table,
          null,
          createElement(
            TableBody,
            null,
            createElement(
              TableRow,
              { tone: "open", className: "text-ui text-label" },
              createElement(TableCell, null, "open row"),
            ),
          ),
        ),
        createElement(
          Alert,
          { variant: "open" },
          createElement(AlertDescription, { className: "text-ui text-foreground" }, "Needs work"),
          createElement(AlertDescription, { size: "ui" }, "Compact alert copy"),
          createElement(AlertDescription, { size: "prose" }, "Readable prose callout"),
        ),
        createElement(
          Empty,
          null,
          createElement(
            EmptyDescription,
            { className: "text-tag text-muted-foreground" },
            "No matches",
          ),
        ),
        createElement(
          ToggleGroup,
          { variant: "segment", size: "sm", value: ["a"] },
          createElement(ToggleGroupItem, { value: "a" }, "Alpha"),
        ),
        createElement(Button, { variant: "tab", size: "sm", "aria-pressed": true }, "More"),
        createElement(Button, { variant: "tab", size: "tab", "aria-pressed": false }, "Overflow"),
        createElement(Textarea, { variant: "note", placeholder: "Readable note" }),
        createElement(Badge, { variant: "done" }, "Done"),
        createElement(Badge, { variant: "ai" }, "Learned"),
      ),
    );

    assert.match(html, /data-tone="check"/);
    assert.match(html, /data-\[tone=check\]:hover:bg-warn-card-hover/);
    assert.match(html, /data-tone="done"/);
    assert.match(html, /data-tone="open"/);
    assert.match(html, /text-tag/);
    assert.match(html, /text-foreground/);
    assert.match(html, /text-muted-foreground/);
    assert.match(html, /text-ui/);
    assert.match(html, /text-ui\/relaxed/);
    assert.match(html, /text-sm\/relaxed/);
    assert.match(html, /font-md/);
    assert.match(html, /text-title\/\[1\.6\]/);
    assert.match(html, /text-label/);
    assert.match(html, /data-variant="segment"/);
    assert.match(html, /aria-pressed:bg-secondary/);
    assert.match(html, /aria-pressed:text-foreground/);
    assert.match(html, /aria-pressed:ring-hairline-strong/);
    assert.match(html, /text-ok-text/);
    assert.match(html, /text-ai-text/);

    const controlsHtml = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(Input, { placeholder: "Search" }),
        createElement(Textarea, { placeholder: "Note" }),
        createElement(Checkbox, { "aria-label": "Agree" }),
        createElement(Button, { variant: "outline" }, "Picture"),
        createElement(Button, { variant: "link" }, "Open"),
        createElement(Badge, { variant: "outline" }, "Draft"),
        createElement(Badge, { variant: "link" }, "Docs"),
      ),
    );
    assert.match(controlsHtml, /\bborder-input\b/);
    assert.match(controlsHtml, /\bbg-backdrop\b/);
    assert.doesNotMatch(controlsHtml, /\bbg-input\b/);
    assert.match(controlsHtml, /\btext-primary-text\b/);
    assert.doesNotMatch(controlsHtml, /\btext-primary(?![a-z-])\b/);
  });

  test("CSS design tokens satisfy WCAG AA (>= 4.5:1) and avoid variable collisions", () => {
    const { vars, token } = readCssTokens();

    const backdrop = token("backdrop");
    const card = token("card");
    const bg = token("background");
    const sidebar = token("sidebar");
    const track = token("track");
    const input = token("input");
    const accent = token("accent");
    const secondary = token("secondary");
    const secondaryFg = token("secondary-foreground");
    const secondaryHover = token("secondary-hover");
    const warnCard = token("warn-card");
    const warnCardHover = token("warn-card-hover");
    const raised2 = token("raised-2");
    const raised3 = token("raised-3");
    const raised4 = token("raised-4");
    const tint = token("tint");
    const foreground = token("foreground");
    const mutedFg = token("muted-foreground");
    const sliderThumb = token("slider-thumb");
    const primary = token("primary");
    const primaryFg = token("primary-foreground");
    const primaryText = token("primary-text");
    const destructive = token("destructive");
    const destructiveFg = token("destructive-foreground");
    const alarm = token("alarm");
    const ok = token("ok");
    const okText = token("ok-text");
    const ai = token("ai");
    const aiText = token("ai-text");
    const warn = token("warn");
    const warnFg = token("warn-foreground");
    const warnText = token("warn-text");
    const warnBg = token("warn-bg");
    const ink = token("ink");
    const inkText = token("ink-text");
    const inOut = token("in-out");
    const inOutText = token("in-out-text");
    const rulerText = token("ruler-text");
    const noteDone = token("note-done");
    const beatMove = token("beat-move");
    const beatSnap = token("beat-snap");
    const beatHold = token("beat-hold");
    const beatSound = token("beat-sound");

    const checkContrast = (fgColor, bgColor, minRatio, label) => {
      const fgRgb = Array.isArray(fgColor) ? fgColor : parseColor(fgColor);
      const bgRgb = Array.isArray(bgColor) ? bgColor : parseColor(bgColor);
      const ratio = contrastRatio(fgRgb, bgRgb);
      assert.ok(
        ratio >= minRatio,
        `${label} contrast ${ratio.toFixed(2)}:1 must be >= ${minRatio}:1`,
      );
    };

    checkContrast(primaryFg, primary, 4.5, "Primary foreground on primary");
    checkContrast(primary, card, 4.5, "Primary on card");
    checkContrast(primary, tint, 4.5, "Primary on active tint");
    checkContrast(primaryText, secondary, 4.5, "Primary text on secondary");
    checkContrast(primaryText, raised3, 4.5, "Primary text on raised-3");
    checkContrast(primaryText, raised4, 4.5, "Primary text on raised-4");
    checkContrast(primaryText, tint, 4.5, "Primary text on active tint");
    checkContrast(primaryText, card, 4.5, "Primary text on card");

    checkContrast(destructiveFg, destructive, 4.5, "Destructive foreground on destructive");
    checkContrast(destructive, card, 4.5, "Destructive text on card");
    checkContrast(destructive, raised3, 4.5, "Destructive text on raised-3");
    checkContrast(
      destructive,
      blendRgba(destructive, 0.2, card),
      4.5,
      "Destructive text on destructive/20 over card",
    );
    checkContrast(
      destructive,
      blendRgba(destructive, 0.2, bg),
      4.5,
      "Destructive text on destructive/20 over background",
    );

    checkContrast(warnFg, warn, 4.5, "Warn foreground on warn");
    checkContrast(warn, warnBg, 4.5, "Check warn text on warn-bg badge");
    checkContrast(warn, raised2, 4.5, "Warn text on raised-2");
    checkContrast(warn, raised3, 4.5, "Warn text on raised-3");
    checkContrast(
      warnText,
      blendRgba(warn, 0.16, card),
      4.5,
      "Check --warn-text on Approve warn/16 card button",
    );
    checkContrast(
      warnText,
      blendRgba(warn, 0.25, blendRgba(warn, 0.16, bg)),
      4.5,
      "Check --warn-text on stacked Review warn/25 over warn/16 badge",
    );
    checkContrast(okText, blendRgba(ok, 0.12, card), 4.5, "Done --ok-text on ok/12 card surface");
    checkContrast(
      okText,
      blendRgba(ok, 0.2, bg),
      4.5,
      "Diff --ok-text on ok/20 hovered background",
    );
    checkContrast(okText, raised3, 4.5, "Done --ok-text on raised-3");
    checkContrast(okText, bg, 4.5, "Done --ok-text on background");
    checkContrast(
      foreground,
      blendRgba(ok, 0.35, blendRgba(ok, 0.2, bg)),
      4.5,
      "Added diff mark foreground on ok/35 + ok/20 background",
    );
    checkContrast(
      foreground,
      blendRgba(alarm, 0.45, blendRgba(destructive, 0.2, bg)),
      4.5,
      "Removed diff mark foreground on alarm/45 + destructive/20 background",
    );
    checkContrast(aiText, blendRgba(ai, 0.14, card), 4.5, "AI --ai-text on ai/14 card surface");
    checkContrast(inkText, blendRgba(ink, 0.15, card), 4.5, "Ink --ink-text on ink/15 card badge");
    checkContrast(
      inOutText,
      blendRgba(inOut, 0.18, card),
      4.5,
      "In/Out text on in-out/18 card pill",
    );

    checkContrast(mutedFg, bg, 4.5, "Muted foreground on panel/calendar background");
    checkContrast(
      mutedFg,
      blendRgba(backdrop, 0.55, bg),
      4.5,
      "Calendar out-of-month --muted-foreground",
    );
    checkContrast(mutedFg, card, 4.5, "Muted foreground on card");
    checkContrast(mutedFg, secondary, 4.5, "Muted foreground on secondary");
    checkContrast(
      blendRgba(foreground, 0.65, card),
      card,
      4.5,
      "Inactive Side tabs text-foreground/65 on --card",
    );
    checkContrast(
      blendRgba(foreground, 0.8, raised4),
      raised4,
      4.5,
      "Subtle count foreground/80 on hovered raised-4",
    );
    checkContrast(foreground, backdrop, 4.5, "Switch unchecked thumb foreground on backdrop track");
    checkContrast(input, backdrop, 3.0, "Input border on backdrop surface (WCAG non-text UI)");
    checkContrast(input, bg, 3.0, "Input border on background surface (WCAG non-text UI)");
    checkContrast(input, card, 3.0, "Input border on card surface (WCAG non-text UI)");
    checkContrast(input, raised3, 3.0, "Input border on raised-3 surface (WCAG non-text UI)");
    checkContrast(sliderThumb, bg, 4.5, "Wheel arrow/slider thumb on background");
    checkContrast(rulerText, track, 4.5, "Ruler text on track");
    checkContrast(rulerText, bg, 4.5, "Timeline --ruler-text on background");
    checkContrast(noteDone, card, 3.0, "Done note marker on card");
    checkContrast(noteDone, sidebar, 3.0, "Done note marker on sidebar");
    checkContrast(noteDone, track, 3.0, "Done note marker on track (WCAG non-text UI)");
    checkContrast(foreground, beatMove, 4.5, "Foreground on beat-move strip");
    checkContrast(foreground, beatSnap, 4.5, "Foreground on beat-snap strip");
    checkContrast(foreground, beatHold, 4.5, "Foreground on beat-hold strip");
    checkContrast(foreground, beatSound, 4.5, "Foreground on beat-sound strip");
    checkContrast(foreground, secondary, 7.0, "Active segmented pill --foreground on --secondary");
    checkContrast(secondaryFg, secondaryHover, 4.5, "Secondary foreground on --secondary-hover");
    checkContrast(primaryText, accent, 4.5, "Primary text on --accent (hover-open submenu)");
    checkContrast(primaryText, raised4, 4.5, "Primary text on raised-4");
    checkContrast(foreground, warnCard, 4.5, "Foreground on --warn-card");
    checkContrast(foreground, warnCardHover, 4.5, "Foreground on --warn-card-hover");
    for (const tok of ["chart-3", "chart-4", "chart-5", "chart-6", "chart-7", "chart-8"]) {
      checkContrast(token(tok), card, 3.0, `Categorical --${tok} on --card`);
    }

    assert.ok(
      !vars.has("curve") && !vars.has("color-curve"),
      "--curve belongs only to ColorAdjust inline scope",
    );
    assert.equal(vars.get("color-curve-bg"), "var(--curve-bg)");

    const walkFiles = (dir) =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const p = join(dir, entry.name);
        return entry.isDirectory() ? walkFiles(p) : [p];
      });
    for (const file of walkFiles(join(STUDIO_DIR, "app"))) {
      if (!/\.(?:ts|tsx|css)$/.test(file)) continue;
      const src = readFileSync(file, "utf8");
      assert.doesNotMatch(
        src,
        /(?:^|[\s"'`])(?:bg|stroke|fill|text|border)-curve(?=$|[\s"'`])/,
        `${file} must not use colliding *-curve utility`,
      );
    }
    for (const file of walkFiles(join(STUDIO_DIR, "app/components/ui"))) {
      if (!file.endsWith(".tsx")) continue;
      const src = readFileSync(file, "utf8");
      assert.doesNotMatch(src, /\bdark:/, `${file} should use single-theme tokens without dark:`);
    }
  });
});

describe("notes views & ReviewRoom component rendering", { timeout: 30000 }, () => {
  let tempDir;
  let server;
  let storeMod;
  let buttonMod;
  let tooltipMod;
  let calloutMod;
  let inspectorMod;
  let aiPresenceMod;
  let composeMod;
  let noteListMod;
  let notePartsMod;
  let metaMod;
  let inkBarMod;
  let gridMod;
  let insightMod;
  let reviewMod;
  const savedGlobals = new Map();

  const installDomGlobals = () => {
    const keys = [
      "localStorage",
      "sessionStorage",
      "window",
      "document",
      "location",
      "matchMedia",
      "EventSource",
      "AudioContext",
      "AudioWorkletNode",
      "GainNode",
      "Audio",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ];
    for (const k of keys) savedGlobals.set(k, Object.getOwnPropertyDescriptor(globalThis, k));
    const memStorage = () => {
      const m = new Map();
      return {
        getItem: (k) => m.get(k) ?? null,
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
        clear: () => m.clear(),
      };
    };
    const mm = () => ({
      matches: false,
      media: "",
      addEventListener() {},
      removeEventListener() {},
    });
    class StubEventSource {
      static CLOSED = 2;
      readyState = 0;
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
    const stubNode = () => ({
      gain: { value: 1 },
      fftSize: 2048,
      connect() {
        return this;
      },
    });
    class StubAudioContext {
      currentTime = 0;
      destination = {};
      audioWorklet = { addModule: async () => {} };
      createGain = stubNode;
      createChannelSplitter = stubNode;
      createAnalyser = stubNode;
    }
    class StubGainNode {
      gain = { value: 1 };
      connect() {
        return this;
      }
    }
    class StubAudioWorkletNode {
      port = { postMessage() {}, onmessage: null };
      parameters = new Map();
      connect() {
        return this;
      }
    }
    class StubAudio {
      volume = 1;
      muted = false;
      playbackRate = 1;
      currentTime = 0;
      duration = 0;
      paused = true;
      src = "";
      addEventListener() {}
      removeEventListener() {}
      play() {
        return Promise.resolve();
      }
      pause() {}
    }
    const stubDoc = {
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({
        canPlayType: () => "",
        getContext: () => ({
          font: "",
          measureText: () => ({ width: 0 }),
          isPointInPath: () => false,
        }),
        style: {},
        setAttribute() {},
        addEventListener() {},
        removeEventListener() {},
      }),
      addEventListener() {},
      removeEventListener() {},
      documentElement: { style: { setProperty() {} } },
    };
    const loc = { search: "", pathname: "/", origin: "http://localhost" };
    Object.assign(globalThis, {
      localStorage: memStorage(),
      sessionStorage: memStorage(),
      location: loc,
      matchMedia: mm,
      EventSource: StubEventSource,
      AudioContext: StubAudioContext,
      AudioWorkletNode: StubAudioWorkletNode,
      GainNode: StubGainNode,
      Audio: StubAudio,
      document: stubDoc,
      requestAnimationFrame: () => 0,
      cancelAnimationFrame() {},
      window: Object.assign(globalThis, {
        location: loc,
        document: stubDoc,
        matchMedia: mm,
        addEventListener() {},
        removeEventListener() {},
      }),
    });
  };

  const restoreDomGlobals = () => {
    for (const [k, desc] of savedGlobals.entries()) {
      if (desc) Object.defineProperty(globalThis, k, desc);
      else delete globalThis[k];
    }
  };

  const sampleItems = () => {
    const openNote = {
      id: "n-open",
      at: "2026-11-10T08:00:00Z",
      t: 1,
      time: "00:01.000",
      frame: 30,
      shot: 0,
      shotName: "Intro",
      text: "Brighten rim light near left edge",
      done: false,
      state: "open",
      img: "data:image/jpeg;base64,AA==",
    };
    const checkNote = {
      id: "n-check",
      at: "2026-11-11T09:00:00Z",
      t: 4,
      time: "00:04.000",
      frame: 120,
      shot: 1,
      shotName: "Main",
      text: "Check torch flicker timing",
      done: false,
      state: "check",
      fixes: [{ what: "Smoothed torch curve", checkpoint: "v12", at: "2026-11-12T10:00:00Z" }],
    };
    const doneNote = {
      id: "n-done",
      at: "2026-11-09T07:00:00Z",
      t: 7,
      time: "00:07.000",
      frame: 210,
      shot: 1,
      shotName: "Main",
      text: "Camera pan settle looks crisp",
      done: true,
      state: "done",
      approved: "2026-11-13T11:30:00Z",
      fixes: [{ what: "Eased out pan end", at: "2026-11-12T16:00:00Z" }],
      learned: {
        what: "Keep ease-out on wide pan settle",
        scope: "film",
        at: "2026-11-13T12:00:00Z",
      },
    };
    return {
      notes: [openNote, checkNote, doneNote],
      placed: [
        { n: checkNote, t: 4, state: "check" },
        { n: openNote, t: 1, state: "open" },
        { n: doneNote, t: 7, state: "done" },
      ],
    };
  };

  beforeAll(async () => {
    installDomGlobals();
    tempDir = mkdtempSync(join(tmpdir(), "notes-ui-ssr-"));
    const src = join(tempDir, "src");
    mkdirSync(src, { recursive: true });
    writeFileSync(
      join(src, "scene.ts"),
      'export const SHOTS = [{ t: 0, name: "Intro" }, { t: 4, name: "Main" }], SHOTS_OUT = SHOTS, DURATION = 10; export const applyEdit = () => {}; export const buildScene = async () => Object.assign(() => ({}), { tools: {} });',
    );
    writeFileSync(
      join(src, "edit.ts"),
      "export const EDIT = {}; export const fromSource = (t) => t; export const toSource = (t) => t;",
    );
    const loudnessWorklet = {
      find: /^loudness-worklet\/worklet(?=\?|$)/,
      replacement: join(
        dirname(createRequire(join(STUDIO_DIR, "package.json")).resolve("loudness-worklet")),
        "loudness.worklet.js",
      ),
    };
    server = await createServer({
      configFile: false,
      logLevel: "silent",
      root: join(STUDIO_DIR, "app"),
      plugins: [react(), filmPlugin({ SRC: src, threeFrom: STUDIO_DIR })],
      resolve: {
        alias: [{ find: "@", replacement: join(STUDIO_DIR, "app") }, loudnessWorklet],
      },
      server: { middlewareMode: true, hmr: false },
    });
    storeMod = await server.ssrLoadModule("/core/store.ts");
    buttonMod = await server.ssrLoadModule("/components/ui/button.tsx");
    tooltipMod = await server.ssrLoadModule("/components/ui/tooltip.tsx");
    calloutMod = await server.ssrLoadModule("/components/ui/callout.tsx");
    inspectorMod = await server.ssrLoadModule("/components/inspector.tsx");
    aiPresenceMod = await server.ssrLoadModule("/activity/AiPresence.tsx");
    composeMod = await server.ssrLoadModule("/notes/Compose.tsx");
    noteListMod = await server.ssrLoadModule("/notes/NoteList.tsx");
    notePartsMod = await server.ssrLoadModule("/notes/note-parts.tsx");
    metaMod = await server.ssrLoadModule("/notes/note-card-meta.ts");
    inkBarMod = await server.ssrLoadModule("/notes/InkBar.tsx");
    gridMod = await server.ssrLoadModule("/notes/NoteGridViews.tsx");
    insightMod = await server.ssrLoadModule("/notes/NoteInsightViews.tsx");
    reviewMod = await server.ssrLoadModule("/notes/ReviewRoom.tsx");
  }, 30000);

  afterAll(async () => {
    await server?.close();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    restoreDomGlobals();
  }, 30000);

  const withTooltips = (node) => createElement(tooltipMod.TooltipProvider, { delay: 0 }, node);

  test("NoteStatusStrip, NoteViewBar, and NoteList render unified active state across All, To check (including 0 count), To fix, Done and active More tab", () => {
    const { notes } = sampleItems();
    const statuses = ["all", "check", "open", "done"];
    const noop = () => {};

    for (const activeStatus of statuses) {
      const counts =
        activeStatus === "check"
          ? { all: 53, check: 0, open: 3, done: 50 }
          : { all: 54, check: 1, open: 3, done: 50 };
      const stripHtml = renderToStaticMarkup(
        createElement(noteListMod.NoteStatusStrip, {
          status: activeStatus,
          counts,
          onChange: noop,
        }),
      );
      const activeBtn = stripHtml.match(
        new RegExp(`<button[^>]*data-status-filter="${activeStatus}"[^>]*>`),
      )?.[0];
      assert.ok(activeBtn, `Expected active button for status=${activeStatus}, got:\n${stripHtml}`);
      assert.match(activeBtn, /aria-pressed="true"/);
      if (activeStatus === "all") {
        assert.match(activeBtn, /ring-hairline-strong/);
        assert.match(activeBtn, /bg-secondary/);
      } else if (activeStatus === "check") {
        assert.match(activeBtn, /bg-warn\/\[0\.16\]/);
        assert.match(activeBtn, /text-warn-text/);
      } else if (activeStatus === "open") {
        assert.match(activeBtn, /bg-primary\/\[0\.16\]/);
        assert.match(activeBtn, /text-primary-text/);
      } else {
        assert.match(activeBtn, /bg-ok\/\[0\.16\]/);
        assert.match(activeBtn, /text-ok-text/);
      }
      assert.doesNotMatch(stripHtml, /bg-warn text-warn-foreground/);
      assert.doesNotMatch(stripHtml, /bg-tint text-primary/);
      assert.doesNotMatch(stripHtml, /bg-ok\/18 text-ok/);
      assert.match(stripHtml, /bg-warn/);
      assert.match(stripHtml, /bg-primary/);
      assert.match(stripHtml, /bg-ok/);
    }

    const cardsBarHtml = renderToStaticMarkup(
      withTooltips(createElement(noteListMod.NoteViewBar, { view: "cards", onChange: noop })),
    );
    assert.match(cardsBarHtml, /aria-label="More note views"[^>]*aria-pressed="false"/);
    assert.match(cardsBarHtml, />More</);

    const moreBarHtml = renderToStaticMarkup(
      withTooltips(createElement(noteListMod.NoteViewBar, { view: "timeline", onChange: noop })),
    );
    assert.match(moreBarHtml, /aria-label="Timeline — more note views"[^>]*aria-pressed="true"/);
    assert.match(moreBarHtml, /aria-pressed:bg-secondary/);
    assert.match(moreBarHtml, /aria-pressed:text-foreground/);
    assert.match(moreBarHtml, /text-primary-text[^>]*>.*<\/svg><span>Timeline<\/span>/);
    assert.match(moreBarHtml, />Timeline</);

    storeMod.set({ ready: true, notes, noteStatus: "all", noteView: "cards" });
    const noteListHtml = renderToStaticMarkup(withTooltips(createElement(noteListMod.NoteList)));
    assert.match(noteListHtml, /Check torch flicker timing/);
    assert.match(noteListHtml, /Brighten rim light near left edge/);
  });

  test("all 8 structured/insight views, NoteCardActions, and ReviewRoom render real items cleanly without double dates or Gallery duplicate buttons", () => {
    const { notes, placed } = sampleItems();
    storeMod.set({
      ready: true,
      notes,
      review: true,
      reviewTab: "check",
      reviewPick: notes[1].id,
      noteStatus: "all",
      noteSearch: "",
      noteView: "cards",
    });

    const noop = () => {};
    const actionsDoneHtml = renderToStaticMarkup(
      createElement(notePartsMod.NoteCardActions, {
        note: notes[2],
        t: 7,
        state: "done",
        replying: false,
        onToggleReply: noop,
        onDoneReply: noop,
        showApprovedDate: true,
      }),
    );
    assert.match(actionsDoneHtml, /Approved Nov 13/);
    assert.doesNotMatch(actionsDoneHtml, /Approved Approved/);

    const boardHtml = renderToStaticMarkup(
      withTooltips(createElement(gridMod.NoteBoardView, { items: placed })),
    );
    const listHtml = renderToStaticMarkup(
      withTooltips(createElement(gridMod.NoteListView, { items: placed })),
    );
    const galleryHtml = renderToStaticMarkup(
      withTooltips(createElement(gridMod.NoteGalleryView, { items: placed })),
    );
    const tableHtml = renderToStaticMarkup(
      withTooltips(createElement(gridMod.NoteTableView, { items: placed })),
    );
    const timelineHtml = renderToStaticMarkup(
      withTooltips(createElement(insightMod.NoteTimelineView, { items: placed })),
    );
    const calendarHtml = renderToStaticMarkup(
      withTooltips(createElement(insightMod.NoteCalendarView, { items: placed })),
    );
    const feedHtml = renderToStaticMarkup(
      withTooltips(createElement(insightMod.NoteFeedView, { items: placed })),
    );
    const chartHtml = renderToStaticMarkup(
      withTooltips(createElement(insightMod.NoteChartView, { items: placed })),
    );
    const donutChartHtml = renderToStaticMarkup(
      withTooltips(
        createElement(insightMod.NoteChartView, { items: placed, defaultChartType: "donut" }),
      ),
    );
    const reviewHtml = renderToStaticMarkup(withTooltips(createElement(reviewMod.ReviewRoom)));

    assert.match(boardHtml, /data-variant="segment"/);
    assert.match(boardHtml, /Brighten rim light near left edge/);
    assert.match(boardHtml, /Column 1 of /);
    assert.match(listHtml, /data-variant="segment"/);
    assert.match(listHtml, /Flat list/);
    assert.doesNotMatch(listHtml, /group-hover\/row:max-w-9/);
    assert.match(listHtml, /aria-label="Needs work at 00:04\.000"/);
    const askNote = {
      ...notes[1],
      id: "n-ask",
      fixes: [{ what: "Prefer soft or crisp shadow?", ask: true, at: "2026-11-12T10:00:00Z" }],
    };
    const askPlaced = [{ n: askNote, t: 4, state: "check" }];
    const askListHtml = renderToStaticMarkup(
      withTooltips(createElement(gridMod.NoteListView, { items: askPlaced })),
    );
    const askTableHtml = renderToStaticMarkup(
      withTooltips(createElement(gridMod.NoteTableView, { items: askPlaced })),
    );
    assert.match(askListHtml, /AI asks: Prefer soft or crisp shadow\?/);
    assert.match(askTableHtml, /AI asks: Prefer soft or crisp shadow\?/);
    const compactReplyHtml = renderToStaticMarkup(
      withTooltips(
        createElement(notePartsMod.NoteCardActions, {
          note: askNote,
          t: 4,
          state: "check",
          replying: true,
          onToggleReply: noop,
          onDoneReply: noop,
          compact: true,
        }),
      ),
    );
    assert.match(compactReplyHtml, /aria-label="Review note at 00:04\.000"/);
    assert.match(compactReplyHtml, /AI asks: <\/span>Prefer soft or crisp shadow\?/);
    assert.match(galleryHtml, /Jump to frame at 00:01\.000/);
    assert.match(galleryHtml, /Open note at 00:01\.000/);
    assert.doesNotMatch(galleryHtml, /Inspect note at 00:01\.000/);
    assert.match(galleryHtml, /Edit note at 00:04\.000/);
    assert.match(galleryHtml, /aria-label="Needs work at 00:04\.000"/);
    assert.match(galleryHtml, /focus-visible:ring-inset/);
    assert.match(galleryHtml, /role="region"[^>]*aria-label="Gallery notes grid"/);
    assert.match(galleryHtml, /lucide-undo-2/);
    assert.match(galleryHtml, /lucide-panel-right-open/);
    assert.match(tableHtml, /Check torch flicker timing/);
    assert.match(tableHtml, /Needs work at 00:04\.000/);
    assert.match(tableHtml, /whitespace-normal/);
    assert.doesNotMatch(tableHtml, /Approved Approved/);

    const multiAndSameDayPlaced = [
      {
        n: {
          ...notes[0],
          id: "n-multi",
          text: "First headline\nSecond detail\nThird detail",
          at: "2026-11-14T08:00:00Z",
          fixes: [{ what: "Tuned rim", at: "2026-11-14T16:30:00Z" }],
        },
        t: 2,
        state: "check",
      },
    ];
    const multiListHtml = renderToStaticMarkup(
      withTooltips(createElement(gridMod.NoteListView, { items: multiAndSameDayPlaced })),
    );
    const multiTableHtml = renderToStaticMarkup(
      withTooltips(createElement(gridMod.NoteTableView, { items: multiAndSameDayPlaced })),
    );
    const sameDayFeedHtml = renderToStaticMarkup(
      withTooltips(createElement(insightMod.NoteFeedView, { items: multiAndSameDayPlaced })),
    );
    assert.match(multiListHtml, /\+2 lines/);
    assert.match(multiTableHtml, /\+2 lines/);
    assert.match(sameDayFeedHtml, /\d{2}:\d{2}/);

    assert.match(timelineHtml, /Timeline zoom/);
    assert.match(timelineHtml, /<ul aria-label="Timeline shot lanes"/);
    assert.match(calendarHtml, /Previous month/);
    assert.match(calendarHtml, /text-ok-text/);
    assert.match(feedHtml, /Learned/);
    assert.match(feedHtml, /Approved Nov 13/);
    assert.match(feedHtml, /<ul aria-label="Activity feed"/);
    assert.match(chartHtml, /Approved/);
    assert.match(chartHtml, /33%/);
    assert.match(chartHtml, /Chart breakdown/);
    assert.match(chartHtml, /aria-pressed="true"[^>]*>Shot</);
    assert.match(chartHtml, /aria-pressed="(?:true|false)"[^>]*>.*To check/);
    assert.match(donutChartHtml, /stroke="var\(--chart-4\)"/);
    assert.match(donutChartHtml, /<svg[^>]*aria-hidden="true"/);
    assert.doesNotMatch(donutChartHtml, /<circle[^>]*role="button"/);
    assert.match(donutChartHtml, /<button[^>]*focus-visible:ring/);
    assert.doesNotMatch(donutChartHtml, /opacity-35/);
    assert.match(donutChartHtml, /· Main/);
    assert.match(chartHtml, /text-ok-text/);
    assert.match(listHtml, /min-h-6/);
    assert.match(tableHtml, /min-h-6/);
    assert.match(listHtml, /<h3 class="text-sm font-semibold text-primary-text">To fix<\/h3>/);
    assert.equal(notePartsMod.noteStatusLabel("open", false, true), "Needs work");
    assert.equal(notePartsMod.noteStatusTextClass("open", false, false), "text-primary-text");
    assert.match(reviewHtml, />AI asks</);
    assert.match(reviewHtml, />AI says fixed</);
    assert.doesNotMatch(reviewHtml, /role="alert"/);
    assert.match(reviewHtml, /Approve all|Check torch flicker timing/);
    assert.match(reviewHtml, /approve/);
    assert.match(reviewHtml, /text-label\/60/);
    assert.match(reviewHtml, /<kbd[^>]*>Esc<\/kbd> close/);

    const navHtml = renderToStaticMarkup(
      createElement(inspectorMod.NavItem, {
        title: "All Notes",
        count: 12,
        current: true,
        onClick: () => {},
      }),
    );
    assert.match(navHtml, /text-primary-text[^>]*>12</);
    assert.doesNotMatch(navHtml, /text-primary\/80/);

    const okCalloutHtml = renderToStaticMarkup(
      createElement(calloutMod.Callout, { variant: "ok" }, "Verified"),
    );
    assert.match(okCalloutHtml, /\[&amp;&gt;svg\]:text-ok-text|text-ok-text/);

    const aiPresenceHtml = renderToStaticMarkup(
      withTooltips(createElement(aiPresenceMod.AiPresence)),
    );
    assert.match(aiPresenceHtml, /aria-label="AI idle — What the AI is doing"/);

    const origGetInitialState = storeMod.studio.getInitialState;
    storeMod.studio.getInitialState = storeMod.get;
    try {
      storeMod.set({ reviewTab: "open", reviewPick: notes[0].id });
      const reviewOpenHtml = renderToStaticMarkup(
        withTooltips(createElement(reviewMod.ReviewRoom)),
      );
      assert.match(reviewOpenHtml, /data-review-row="n-open"/);
      assert.match(reviewOpenHtml, /text-primary-text font-semibold[^>]*>1<\/span>/);
      assert.doesNotMatch(reviewOpenHtml, />A<\/kbd> approve/);

      storeMod.set({ noteView: "chart", noteStatus: "all", noteSearch: "" });
      const chartNoteListHtml = renderToStaticMarkup(
        withTooltips(createElement(noteListMod.NoteList)),
      );
      assert.doesNotMatch(chartNoteListHtml, /aria-disabled="true"[^>]*aria-label="View order/);
      assert.match(chartNoteListHtml, /aria-label="Chart — more note views"/);
      assert.doesNotMatch(chartNoteListHtml, /role="listitem"/);

      storeMod.set({ compose: { id: null }, draft: "Rim light looks slightly flat" });
      const composeDockHtml = renderToStaticMarkup(
        withTooltips(createElement(composeMod.Compose, { dock: true })),
      );
      assert.match(composeDockHtml, /text-ok-text[^>]*>Draft saved</);
      assert.doesNotMatch(composeDockHtml, /text-ok-text\/80/);

      // Disabled default & subtle buttons recede cleanly without dropping text contrast below AA
      const disabledDefaultHtml = renderToStaticMarkup(
        createElement(buttonMod.Button, { disabled: true }, "Add"),
      );
      assert.match(disabledDefaultHtml, /disabled:bg-primary\/20/);
      assert.match(disabledDefaultHtml, /disabled:border-primary\/40/);
      assert.match(disabledDefaultHtml, /disabled:text-foreground\/75/);
      assert.match(disabledDefaultHtml, /disabled:opacity-100/);
      assert.doesNotMatch(disabledDefaultHtml, /disabled:bg-white\/\[0\.02\]/);

      const subtleHtml = renderToStaticMarkup(
        createElement(buttonMod.Button, { variant: "subtle" }, "Filter"),
      );
      assert.match(subtleHtml, /bg-hairline-subtle/);
      assert.match(subtleHtml, /border-hairline-strong/);
      assert.match(subtleHtml, /disabled:bg-transparent/);
      assert.match(subtleHtml, /aria-disabled:bg-transparent/);
      assert.match(subtleHtml, /disabled:border-dashed/);
      assert.match(subtleHtml, /aria-disabled:border-dashed/);
      assert.match(subtleHtml, /disabled:border-hairline(?![a-z-])/);
      assert.match(subtleHtml, /aria-disabled:border-hairline(?![a-z-])/);

      const refsHtml = renderToStaticMarkup(
        createElement(notePartsMod.RefsChip, {
          note: { ...notes[0], refs: ["/tmp/ref.png"] },
          count: 1,
        }),
      );
      assert.match(refsHtml, /min-h-6/);
      assert.match(refsHtml, /pointer-coarse:min-h-10/);

      // Table shows inline Needs work creator feedback summary on sent-back notes
      const sentBackItem = {
        n: {
          ...notes[0],
          fixes: [{ what: "Tuned rim exposure", at: "2026-11-11T08:00:00Z" }],
          asks: [{ text: "Still flickering at frame 120", at: "2026-11-12T08:00:00Z" }],
        },
        t: 1,
        state: "open",
      };
      const sentBackTableHtml = renderToStaticMarkup(
        withTooltips(createElement(gridMod.NoteTableView, { items: [sentBackItem] })),
      );
      assert.match(sentBackTableHtml, /Needs work: Still flickering at frame 120/);

      // Active facet filter propagates clearly into both NoteList (0/1 badge) and ReviewRoom (chip + reset)
      storeMod.set({
        noteView: "cards",
        noteStatus: "all",
        noteSearch: "",
        noteFacets: ["needsWork"],
        reviewTab: "check",
      });
      const filteredListHtml = renderToStaticMarkup(
        withTooltips(createElement(noteListMod.NoteList)),
      );
      assert.match(filteredListHtml, />0\/1</);
      assert.match(filteredListHtml, /Sent back \(Needs work\)/);

      const filteredReviewHtml = renderToStaticMarkup(
        withTooltips(createElement(reviewMod.ReviewRoom)),
      );
      assert.match(filteredReviewHtml, /Sent back \(Needs work\)/);
      assert.match(filteredReviewHtml, /No notes match your active filters\./);
      assert.match(filteredReviewHtml, />Reset filters</);
    } finally {
      storeMod.studio.getInitialState = origGetInitialState;
    }
  });

  test("R13 input border contrast, disjoint ref chips, RefSketch roving radiogroup, coarse targets, and reduced motion guards", async () => {
    const { token } = readCssTokens();
    const inputBorder = parseColor(token("input"));
    for (const surface of ["backdrop", "background", "card"]) {
      const cr = contrastRatio(inputBorder, parseColor(token(surface)));
      assert.ok(cr >= 3.0, `--input on --${surface} contrast ${cr.toFixed(2)} must be >= 3.0`);
    }
    const disabledBtnBg = blendRgba(token("primary"), 0.12, token("card"));
    const mutedFgCr = contrastRatio(parseColor(token("muted-foreground")), disabledBtnBg);
    assert.ok(
      mutedFgCr >= 4.5,
      `--muted-foreground on primary/12 over --card contrast ${mutedFgCr.toFixed(2)} must be >= 4.5`,
    );

    const refSketchMod = await server.ssrLoadModule("/notes/RefSketch.tsx");
    const motionMod = await server.ssrLoadModule("/components/Motion.tsx");
    const { notes, placed } = sampleItems();

    const origInit = storeMod.studio.getInitialState;
    try {
      const sampleRef = {
        id: "ref-1",
        src: "data:image/png;base64,iVBOR",
        url: "data:image/png;base64,iVBOR",
        strokes: [],
      };
      const composeSpec = {
        kind: "create",
        t: 4,
        shot: 0,
        shotName: "shot zero",
        pin: null,
        resume: false,
        wasPlaying: false,
      };
      storeMod.studio.getInitialState = () => ({
        ...origInit(),
        compose: composeSpec,
        draft: "Check rim highlight",
        refs: [sampleRef],
      });
      storeMod.set({
        ready: true,
        notes,
        compose: composeSpec,
        draft: "Check rim highlight",
        refs: [sampleRef],
      });
      const composeHtml = renderToStaticMarkup(withTooltips(createElement(composeMod.Compose)));
      assert.match(composeHtml, /overscroll-x-contain/);
      assert.match(composeHtml, /border-hairline rounded-none border-s/);
      assert.match(composeHtml, /pointer-coarse:w-10/);
      assert.doesNotMatch(composeHtml, /absolute top-0\.5 right-0\.5/);

      const refHtml = renderToStaticMarkup(
        withTooltips(
          createElement(refSketchMod.RefSketchBoard, {
            r: sampleRef,
            undoRef: { current: null },
          }),
        ),
      );
      assert.match(refHtml, /role="radiogroup" aria-label="Colour"/);
      assert.match(refHtml, /role="radiogroup" aria-label="Stroke size"/);
      assert.match(refHtml, /role="radio"[^>]*tabindex="0"/i);
      assert.match(refHtml, /role="radio"[^>]*tabindex="-1"/i);
    } finally {
      storeMod.studio.getInitialState = origInit;
      storeMod.set({ compose: null, draft: "", refs: [] });
    }

    const expandableHtml = renderToStaticMarkup(
      withTooltips(
        createElement(notePartsMod.ExpandableNoteText, {
          text: "First headline",
          onOpen: () => {},
          openLabel: "Open note at 00:01.000",
        }),
      ),
    );
    assert.match(expandableHtml, /\bmin-h-6\b/);
    assert.match(expandableHtml, /\bitems-center\b/);
    assert.match(expandableHtml, /\bmotion-reduce:transition-none\b/);
    assert.match(expandableHtml, /\bpointer-coarse:min-h-10\b/);

    const tableHtml = renderToStaticMarkup(
      withTooltips(createElement(gridMod.NoteTableView, { items: placed })),
    );
    const feedHtml = renderToStaticMarkup(
      withTooltips(createElement(insightMod.NoteFeedView, { items: placed })),
    );
    const chartHtml = renderToStaticMarkup(
      withTooltips(createElement(insightMod.NoteChartView, { items: placed })),
    );
    assert.match(tableHtml, /pointer-coarse:min-h-10/);
    assert.match(feedHtml, /pointer-coarse:min-h-10/);
    assert.match(chartHtml, /Bar width scales to top bucket/);

    const origMatchMedia = window.matchMedia;
    try {
      window.matchMedia = (q) => ({
        matches: q === "(prefers-reduced-motion: reduce)",
        media: q,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
      });
      assert.equal(motionMod.prefersReduced(), true);
    } finally {
      window.matchMedia = origMatchMedia;
    }
  });

  test("R14 Board filtered-empty reset, List/Table scent & edit parity, Gallery uniform rows, Chart ok consistency, decorative Donut SVG, and removeRef undo", async () => {
    const refsMod = await server.ssrLoadModule("/notes/refs.ts");
    const toastMod = await server.ssrLoadModule("/components/ui/toast.tsx");
    const badgeMod = await server.ssrLoadModule("/components/ui/badge.tsx");
    const textareaMod = await server.ssrLoadModule("/components/ui/textarea.tsx");
    const tableMod = await server.ssrLoadModule("/components/ui/table.tsx");
    const toggleGroupMod = await server.ssrLoadModule("/components/ui/toggle-group.tsx");

    const cueNotes = [
      {
        id: "r14-fix",
        at: "2026-11-12T10:00:00.000Z",
        shot: 1,
        shotName: "Intro",
        text: "Soften rim intensity",
        freeCam: true,
        pin: { what: "RimLight" },
        fixes: [{ what: "Lowered specular to 0.3", at: "2026-11-12T10:30:00.000Z" }],
      },
      {
        id: "r14-done",
        at: "2026-11-11T09:00:00.000Z",
        shot: 1,
        shotName: "Intro",
        text: "Trim silence tail",
        approved: "2026-11-11T10:00:00.000Z",
        learned: {
          what: "Always leave 4-frame tail fade",
          scope: "film",
          at: "2026-11-11T10:05:00.000Z",
        },
        pin: { what: "AudioOutro" },
      },
    ];
    const cuePlaced = [
      { n: cueNotes[0], t: 2, state: "check" },
      { n: cueNotes[1], t: 6, state: "done" },
    ];

    const origGetInitialState = storeMod.studio.getInitialState;
    storeMod.studio.getInitialState = storeMod.get;
    try {
      // 1. Board filtered-empty renders shared Reset filters instead of empty status column hints
      storeMod.set({
        ready: true,
        notes: cueNotes,
        noteView: "board",
        noteStatus: "all",
        noteSearch: "__nomatch_r14__",
        noteScope: "all",
        noteShot: null,
        noteFacets: [],
      });
      const boardEmptyHtml = renderToStaticMarkup(
        withTooltips(createElement(noteListMod.NoteList)),
      );
      assert.match(boardEmptyHtml, /No notes match “__nomatch_r14__”/);
      assert.match(boardEmptyHtml, />Reset filters</);
      assert.doesNotMatch(boardEmptyHtml, /AI fixes waiting review land here/);

      // 2. List and Table surface AI fixed / Learned cues, inline tags, and List exposes Edit note across check/done
      const listHtml = renderToStaticMarkup(
        withTooltips(createElement(gridMod.NoteListView, { items: cuePlaced })),
      );
      const tableHtml = renderToStaticMarkup(
        withTooltips(createElement(gridMod.NoteTableView, { items: cuePlaced })),
      );
      assert.match(listHtml, /AI says fixed: Lowered specular to 0\.3/);
      assert.match(listHtml, /Learned: Always leave 4-frame tail fade/);
      assert.match(listHtml, /RimLight/);
      assert.match(listHtml, /AudioOutro/);
      assert.match(listHtml, /Free cam/);
      assert.match(listHtml, /Edit note at 00:02\.000/);
      assert.match(listHtml, /Edit note at 00:06\.000/);
      assert.match(tableHtml, /Fixed: Lowered specular to 0\.3/);
      assert.match(tableHtml, /Learned: Always leave 4-frame tail fade/);
      assert.match(tableHtml, /@\[760px\]:hidden/);
      assert.match(tableHtml, /text-end/);
      assert.doesNotMatch(tableHtml, /text-right/);

      // 3. Gallery removes nested max-h-48 inner scroller and stretches uniform rows with mt-auto actions
      const galleryHtml = renderToStaticMarkup(
        withTooltips(createElement(gridMod.NoteGalleryView, { items: cuePlaced })),
      );
      assert.match(galleryHtml, /items-stretch/);
      assert.match(galleryHtml, /h-full flex-col/);
      assert.match(galleryHtml, /mt-auto pt-2/);
      assert.doesNotMatch(galleryHtml, /max-h-48/);

      // 4. Chart unifies Done green with bg-ok / var(--ok) and keeps Donut SVG strictly decorative
      const statusChartHtml = renderToStaticMarkup(
        withTooltips(
          createElement(insightMod.NoteChartView, { items: cuePlaced, defaultChartType: "bar" }),
        ),
      );
      const donutHtml = renderToStaticMarkup(
        withTooltips(
          createElement(insightMod.NoteChartView, { items: cuePlaced, defaultChartType: "donut" }),
        ),
      );
      assert.doesNotMatch(statusChartHtml, /class="bg-ok-text /);
      assert.match(statusChartHtml, /class="bg-ok /);
      assert.doesNotMatch(donutHtml, /stroke="var\(--ok-text\)"/);
      assert.doesNotMatch(donutHtml, /<circle[^>]*cursor-pointer/);
      assert.match(donutHtml, /<circle[^>]*pointer-events-none/);

      // 5. removeRef triggers non-destructive undo toast that restores removed RefPic + strokes at original index
      const origAdd = toastMod.toast.add;
      const calls = [];
      toastMod.toast.add = (opts) => {
        calls.push(opts);
        return `undo-${calls.length}`;
      };
      const picA = {
        id: "ref-a",
        src: "/a.jpg",
        w: 100,
        h: 80,
        strokes: [{ points: [[1, 1, 0.5]], color: "#ff3b30", size: 4 }],
      };
      const picB = { id: "ref-b", src: "/b.jpg", w: 100, h: 80, strokes: [] };
      const composeCtx = { id: null };
      try {
        storeMod.set({ compose: composeCtx, refs: [picA, picB] });
        refsMod.removeRef("ref-a");
        assert.deepEqual(
          storeMod.get().refs.map((x) => x.id),
          ["ref-b"],
        );
        assert.equal(calls.length, 1);
        assert.equal(calls[0].title, "Picture & drawing removed");
        assert.equal(calls[0].actionProps.children, "Undo");
        calls[0].actionProps.onClick();
        assert.deepEqual(storeMod.get().refs, [picA, picB]);

        // Stale undo after switching/closing compose must not resurrect old pics onto a different note
        refsMod.removeRef("ref-a");
        storeMod.set({ compose: { id: "other" }, refs: [] });
        calls[1].actionProps.onClick();
        assert.equal(storeMod.get().refs.length, 0);
      } finally {
        toastMod.toast.add = origAdd;
        storeMod.set({ compose: null, refs: [], noteSearch: "" });
      }
    } finally {
      storeMod.studio.getInitialState = origGetInitialState;
    }

    // 6. UI primitive reduced-motion, icon-only subtle disabled affordance, and CSS logical utilities
    const subtleBtnHtml = renderToStaticMarkup(
      createElement(buttonMod.Button, { variant: "subtle", disabled: true }, "Order"),
    );
    assert.match(subtleBtnHtml, /disabled:\[&amp;_svg\]:opacity-50|disabled:\[&_svg\]:opacity-50/);
    assert.match(
      subtleBtnHtml,
      /aria-disabled:\[&amp;_svg\]:opacity-50|aria-disabled:\[&_svg\]:opacity-50/,
    );

    const uiPrimitivesHtml = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(badgeMod.Badge, { variant: "default" }, "Tag"),
        createElement(textareaMod.Textarea, { "aria-label": "Notes box" }),
        createElement(
          tableMod.Table,
          null,
          createElement(
            tableMod.TableHeader,
            null,
            createElement(tableMod.TableRow, null, createElement(tableMod.TableHead, null, "Head")),
          ),
          createElement(
            tableMod.TableBody,
            null,
            createElement(tableMod.TableRow, null, createElement(tableMod.TableCell, null, "Cell")),
          ),
        ),
        createElement(
          toggleGroupMod.ToggleGroup,
          { value: ["a"] },
          createElement(toggleGroupMod.ToggleGroupItem, { value: "a" }, "A"),
        ),
      ),
    );
    assert.match(uiPrimitivesHtml, /motion-reduce:transition-none/);
    assert.match(uiPrimitivesHtml, /text-start/);
    assert.match(uiPrimitivesHtml, /rounded-s-md/);
    assert.doesNotMatch(uiPrimitivesHtml, /text-left|rounded-l-md|pr-0/);
  });

  test("R15/R16 rendered accessibility, edit parity, Board move affordances, Calendar dates, callout punctuation, and UI controls", async () => {
    const textareaMod = await server.ssrLoadModule("/components/ui/textarea.tsx");
    const kbdMod = await server.ssrLoadModule("/components/ui/kbd.tsx");
    const noteViewsMod = await server.ssrLoadModule("/notes/note-views-model.ts");
    const { notes } = sampleItems();

    // 1. Studio modal hook contract & KbdGroup element semantics (no nested <kbd>)
    assert.equal(typeof storeMod.useDialogModal, "function");
    const kbdGroupHtml = renderToStaticMarkup(
      createElement(
        kbdMod.KbdGroup,
        null,
        createElement(kbdMod.Kbd, null, "Ctrl"),
        createElement(kbdMod.Kbd, null, "Z"),
      ),
    );
    assert.match(kbdGroupHtml, /^<span[^>]*data-slot="kbd-group"/);

    // 2. Upmost View bar & Review badge calm neutral styling when 0 filtered checks match
    assert.equal(noteViewsMod.isOverflowNoteView("table", false), true);
    assert.equal(noteViewsMod.isOverflowNoteView("board", false), false);
    assert.equal(noteViewsMod.isOverflowNoteView("gallery", false), false);
    assert.equal(noteViewsMod.isOverflowNoteView("gallery", true), true);

    const origGetInitialState = storeMod.studio.getInitialState;
    const prevNotes = storeMod.get().notes;
    const prevReady = storeMod.get().ready;
    storeMod.studio.getInitialState = storeMod.get;
    try {
      storeMod.set({
        ready: true,
        notes,
        noteView: "cards",
        noteStatus: "all",
        noteSearch: "",
        noteFacets: ["needsWork"],
        reviewTab: "check",
      });
      const calmReviewHtml = renderToStaticMarkup(
        withTooltips(createElement(noteListMod.NoteList)),
      );
      assert.match(calmReviewHtml, />0\/1</);
      assert.doesNotMatch(calmReviewHtml, /ring-warn\/50[^>]*>0\/1</);
    } finally {
      storeMod.studio.getInitialState = origGetInitialState;
      storeMod.set({ ready: prevReady, notes: prevNotes, noteFacets: [] });
    }

    // 3. Disambiguated accessible action labels, Done/Check Edit parity, and callout middot separator
    const r15Items = [
      {
        n: {
          id: "r15-open",
          at: "2026-11-12T10:00:00.000Z",
          shot: 1,
          shotName: "Intro",
          text: "First line headline\nSecond line detail\nThird line detail",
          asks: [{ text: "Needs stronger contrast", at: "2026-11-12T10:15:00.000Z" }],
        },
        t: 1,
        state: "open",
      },
      {
        n: {
          id: "r15-ask",
          at: "2026-11-12T11:00:00.000Z",
          shot: 1,
          shotName: "Intro",
          text: "Check rim falloff",
          fixes: [{ what: "Stronger or softer?", ask: true, at: "2026-11-12T11:10:00.000Z" }],
        },
        t: 3,
        state: "check",
      },
      {
        n: {
          id: "r15-done",
          at: "2026-11-11T10:00:00.000Z",
          shot: 2,
          shotName: "Room",
          text: "Done item",
          approved: "2026-11-11T11:00:00.000Z",
          fixes: [{ what: "Tightened rim angle", at: "2026-11-11T10:30:00.000Z" }],
        },
        t: 5,
        state: "done",
      },
      {
        n: {
          id: "r15-check",
          at: "2026-11-12T12:00:00.000Z",
          shot: 1,
          shotName: "Intro",
          text: "Verify bounce fill",
          fixes: [{ what: "Raised bounce fill +0.15", at: "2026-11-12T12:15:00.000Z" }],
        },
        t: 4,
        state: "check",
      },
    ];

    const checkActionsHtml = renderToStaticMarkup(
      withTooltips(
        createElement(notePartsMod.NoteCardActions, {
          note: notes[1],
          t: 4,
          state: "check",
          replying: false,
          onToggleReply: () => {},
          onDoneReply: () => {},
          showEdit: true,
        }),
      ),
    );
    assert.match(checkActionsHtml, /aria-label="Approve note at 00:04\.000"/);
    assert.match(checkActionsHtml, /aria-label="Needs work at 00:04\.000"/);
    assert.match(checkActionsHtml, /aria-label="Review note at 00:04\.000"/);
    assert.match(checkActionsHtml, /aria-label="Edit note at 00:04\.000"/);

    const doneActionsHtml = renderToStaticMarkup(
      withTooltips(
        createElement(notePartsMod.NoteCardActions, {
          note: r15Items[2].n,
          t: 5,
          state: "done",
          replying: false,
          onToggleReply: () => {},
          onDoneReply: () => {},
          showEdit: true,
        }),
      ),
    );
    assert.match(doneActionsHtml, /aria-label="Edit note at 00:05\.000"/);
    assert.match(doneActionsHtml, /aria-label="Review note at 00:05\.000"/);
    assert.match(doneActionsHtml, /aria-label="Reopen note at 00:05\.000"/);

    const fixNoCpHtml = renderToStaticMarkup(
      createElement(notePartsMod.FixCallout, { fix: r15Items[2].n.fixes[0], state: "done" }),
    );
    assert.match(fixNoCpHtml, />Nov 11</);
    assert.doesNotMatch(fixNoCpHtml, /·\s*Nov 11/);
    const askHtml = renderToStaticMarkup(
      createElement(notePartsMod.AskCallout, { ask: r15Items[0].n.asks[0] }),
    );
    assert.match(askHtml, />Nov 12</);
    assert.doesNotMatch(askHtml, /·\s*Nov 12/);

    const listHtml = renderToStaticMarkup(
      withTooltips(createElement(gridMod.NoteListView, { items: r15Items })),
    );
    const tableHtml = renderToStaticMarkup(
      withTooltips(createElement(gridMod.NoteTableView, { items: r15Items })),
    );
    const boardHtml = renderToStaticMarkup(
      withTooltips(createElement(gridMod.NoteBoardView, { items: r15Items })),
    );
    const galleryHtml = renderToStaticMarkup(
      withTooltips(createElement(gridMod.NoteGalleryView, { items: r15Items })),
    );
    const timelineHtml = renderToStaticMarkup(
      withTooltips(createElement(insightMod.NoteTimelineView, { items: r15Items })),
    );
    const calendarHtml = renderToStaticMarkup(
      withTooltips(createElement(insightMod.NoteCalendarView, { items: r15Items })),
    );
    const feedHtml = renderToStaticMarkup(
      withTooltips(createElement(insightMod.NoteFeedView, { items: r15Items })),
    );

    for (const [name, html] of [
      ["List", listHtml],
      ["Table", tableHtml],
      ["Board", boardHtml],
      ["Gallery", galleryHtml],
      ["Timeline", timelineHtml],
      ["Calendar", calendarHtml],
      ["Feed", feedHtml],
    ]) {
      assert.match(html, /data-arrow-scroll/, `Expected data-arrow-scroll on ${name}`);
    }

    // 4. Board keyboard Move menu, Calendar readable dates, List parity, and Needs work dedup
    assert.match(boardHtml, /aria-label="Move note [^"]*to column"/);
    assert.match(calendarHtml, /aria-label="Nov 12, 2026:/);
    assert.doesNotMatch(calendarHtml, /aria-label="\d{4}-\d{2}-\d{2}:/);
    assert.match(listHtml, />First line headline<\/span><span[^>]*>\+2 lines<\/span>/);
    assert.match(tableHtml, />First line headline<\/span><span[^>]*>\+2 lines<\/span>/);
    assert.match(tableHtml, /aria-label="Answer AI question at 00:03\.000"/);
    assert.match(tableHtml, /aria-label="Approve note at 00:04\.000"/);
    assert.match(listHtml, /aria-label="Delete note at 00:01\.000"/);
    assert.match(listHtml, /aria-label="Answer AI question at 00:03\.000" aria-expanded="false"/);
    assert.match(listHtml, /Needs work: Needs stronger contrast/);
    assert.doesNotMatch(listHtml, /<span[^>]*>Needs work<\/span>/);
    const listAskPills = listHtml.match(/<span[^>]*>AI asks<\/span>/g) ?? [];
    assert.equal(listAskPills.length, 0, "By status grouped List must not repeat AI asks pill");
    assert.match(listHtml, /<h3[^>]*>AI asks<\/h3>/);

    // 5. Button disabled/aria-disabled attribute & Textarea element rendering
    const btnHtml = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(buttonMod.Button, { variant: "default", "aria-disabled": "true" }, "Default"),
        createElement(buttonMod.Button, { variant: "approve", disabled: true }, "Approve"),
        createElement(buttonMod.Button, { variant: "ai" }, "Ask"),
      ),
    );
    assert.match(btnHtml, /aria-disabled="true"[^>]*>Default<\/button>/);
    assert.match(btnHtml, /disabled=""[^>]*>Approve<\/button>/);
    const defaultTaHtml = renderToStaticMarkup(
      createElement(textareaMod.Textarea, { "aria-label": "Default textarea" }),
    );
    assert.match(defaultTaHtml, /<textarea[^>]*aria-label="Default textarea"/);
  });

  test("R17: #num action target helper, Feed sort normalization, neutral body hover, historical AI ask labels, Calendar undated count, and InkBar OS hint", () => {
    const { notes, placed } = sampleItems();
    assert.equal(metaMod.noteActionTarget(12, "00:04.000"), "#12 at 00:04.000");
    assert.equal(metaMod.noteActionTarget(null, "00:04.000"), "at 00:04.000");
    assert.equal(metaMod.modKeyLabel(), "Ctrl+");

    const origGetInitialState = storeMod.studio.getInitialState;
    storeMod.studio.getInitialState = storeMod.get;
    try {
      // Feed view omits redundant SortMenu, normalizes "newest" -> "Latest activity", and keeps body prose neutral
      storeMod.set({
        ready: true,
        notes,
        noteView: "feed",
        noteSort: "newest",
        noteStatus: "all",
        noteSearch: "",
        noteScope: "all",
        noteShot: null,
        noteFacets: [],
      });
      const feedShellHtml = renderToStaticMarkup(withTooltips(createElement(noteListMod.NoteList)));
      assert.doesNotMatch(feedShellHtml, /aria-label="Sort notes"/);
      assert.doesNotMatch(feedShellHtml, /Recent activity/);
      assert.match(feedShellHtml, /Latest activity/);
      assert.doesNotMatch(
        feedShellHtml,
        /<button[^>]*hover:text-primary[^>]*>[^<]*<span[^>]*>Brighten rim light/,
      );
      assert.match(feedShellHtml, /hover:bg-surface-subtle/);

      // ExpandableNoteText uses neutral hover treatment instead of accent link color
      const expHtml = renderToStaticMarkup(
        withTooltips(
          createElement(notePartsMod.ExpandableNoteText, {
            text: "Neutral body trigger",
            onOpen: () => {},
            openLabel: "Open note #9 at 00:02.000",
          }),
        ),
      );
      assert.doesNotMatch(expHtml, /hover:text-primary/);
      assert.match(expHtml, /hover:bg-surface-subtle/);
      assert.match(expHtml, /text-title\/\[1\.55\]/);
      assert.match(expHtml, /text-pretty/);

      // Compact ExpandableNoteText (Board/Gallery/Timeline) uses 14px/1.5 and NoteNumber stays copyable
      const compactExpHtml = renderToStaticMarkup(
        withTooltips(
          createElement(notePartsMod.ExpandableNoteText, {
            text: "Compact card text",
            compact: true,
          }),
        ),
      );
      assert.match(compactExpHtml, /text-sm\/\[1\.5\]/);
      assert.match(feedShellHtml, /\bfont-md\b/);
      assert.match(feedShellHtml, /<h2[^>]*\btext-title\b/);

      // Historical AI ask inside a resolved done note must NOT look like an active waiting "AI asks" card
      const resolvedAskNote = {
        ...notes[2],
        id: "n-old-ask",
        text: "Check older AI question styling",
        fixes: [
          { what: "Warm or cool key?", ask: true, at: "2026-11-11T10:00:00Z" },
          { what: "Adjusted key warmer per reply", at: "2026-11-11T12:00:00Z" },
        ],
        asks: [{ text: "Go warm", at: "2026-11-11T11:00:00Z" }],
      };
      storeMod.set({
        ready: true,
        notes: [resolvedAskNote],
        review: true,
        reviewTab: "done",
        reviewPick: resolvedAskNote.id,
      });
      const resolvedReviewHtml = renderToStaticMarkup(
        withTooltips(createElement(reviewMod.ReviewRoom)),
      );
      assert.match(resolvedReviewHtml, /\bfont-md\b/);
      assert.match(resolvedReviewHtml, /\bmax-w-\[65ch\]\b/);
      const threadHtml = resolvedReviewHtml.split("</header>").slice(1).join("</header>");
      assert.doesNotMatch(threadHtml, />AI asks</);
      assert.match(threadHtml, /Previous AI question|AI asked/);

      // Calendar counts undated notes without throwing and keeps exactly one roving tabIndex="0" cell
      const calUndatedHtml = renderToStaticMarkup(
        withTooltips(
          createElement(insightMod.NoteCalendarView, {
            items: [
              ...placed,
              { n: { ...notes[0], id: "n-undated", at: "" }, t: 8, state: "open" },
            ],
          }),
        ),
      );
      assert.match(calUndatedHtml, />1 undated</);
      const calDayButtons =
        calUndatedHtml.match(/<button[^>]*aria-pressed="(?:true|false)"[^>]*>/g) ?? [];
      assert.ok(calDayButtons.length >= 28);
      assert.equal(calDayButtons.filter((b) => /tabindex="0"/i.test(b)).length, 1);
      assert.equal(
        calDayButtons.filter((b) => /tabindex="-1"/i.test(b)).length,
        calDayButtons.length - 1,
      );

      // InkBar renders Draw toolbar when ink is active, plus @container responsive tool labels
      storeMod.set({ ink: "pen", inkSaid: "stroke" });
      const inkHtml = renderToStaticMarkup(withTooltips(createElement(inkBarMod.InkBar)));
      assert.match(inkHtml, /role="toolbar"[^>]*aria-label="Draw"/);
      assert.match(inkHtml, /@max-\[720px\]:sr-only/);
      assert.match(inkHtml, /aria-label="Undo last stroke"/);
      storeMod.set({ ink: null, inkSaid: null });
    } finally {
      storeMod.studio.getInitialState = origGetInitialState;
    }
  });
});
