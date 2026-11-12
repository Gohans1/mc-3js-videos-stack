// The libraries' search (app/core/search.ts): each word typed begins a word of the item
import assert from "node:assert/strict";
import { test } from "node:test";

import { matcher } from "../app/core/search.ts";

test("a word matches the start of a word, not the middle of one", () => {
  const hum = matcher("hum");
  assert.ok(hum("room_hum Bedroom Room Tone"));
  assert.ok(hum("Low Frequency Humming Noise"));
  assert.ok(!hum("slam thump_thud_slam_fist_heavy.wav"));
});

test("every word typed must match, in any order, across _ . - and camelCase", () => {
  assert.ok(matcher("slide paper")("paper_lay PaperSlide.wav"));
  assert.ok(matcher("drawer_y")("drawer_yank Metal drawer"));
  assert.ok(!matcher("paper drum")("paper_lay PaperSlide.wav"));
});

test("case and accents don't count, and nothing typed matches everything", () => {
  assert.ok(matcher("CAFE")("café door"));
  assert.ok(matcher("dap ban phim")("tức giận đập bàn phím"));
  assert.ok(matcher("Đập")("đập bàn"));
  assert.ok(matcher("  ")("anything"));
});
