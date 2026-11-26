import assert from "node:assert/strict";
import { test } from "node:test";

const streams = [];
globalThis.EventSource = class extends EventTarget {
  static CLOSED = 2;
  readyState = 1;
  constructor(url) {
    super();
    this.url = url;
    streams.push(this);
  }
  say(event, data) {
    this.dispatchEvent(new MessageEvent(event, { data }));
  }
};
globalThis.document = { querySelector: () => ({ content: "build-1" }) };
const { onEvent, onHello } = await import("../app/core/events.ts");
const stream = () => streams.at(-1);

test("a part of the page that listens late still tells the stream's first hello from a reconnect", () => {
  stream().say("hello", "build-1");
  const heard = [];
  onHello((current, reconnect) => heard.push({ current, reconnect }));
  assert.deepEqual(heard, [{ current: true, reconnect: false }]);
  stream().say("hello", "build-1");
  stream().say("hello", "build-2");
  assert.deepEqual(heard.slice(1), [
    { current: true, reconnect: true },
    { current: false, reconnect: true },
  ]);
});

test("a stream the browser gave up on (a proxy's 502) is opened again, with its listeners", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const heard = [];
  onHello((current, reconnect) => heard.push(reconnect));
  heard.length = 0;
  const old = stream();
  old.readyState = EventSource.CLOSED;
  old.dispatchEvent(new Event("error"));
  t.mock.timers.tick(3000);
  assert.notEqual(stream(), old);
  stream().say("hello", "build-1");
  assert.deepEqual(heard, [true]);
});

test("a closed panel stops receiving events, including on a replacement stream", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const heard = [];
  const stop = onEvent("history", (revision) => heard.push(revision));
  const old = stream();
  old.say("history", "before close");
  stop();
  old.say("history", "while closed");
  old.readyState = EventSource.CLOSED;
  old.dispatchEvent(new Event("error"));
  t.mock.timers.tick(3000);
  stream().say("history", "after reconnect");
  assert.deepEqual(heard, ["before close"]);
});
