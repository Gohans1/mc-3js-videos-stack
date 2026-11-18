import { expect, test } from "bun:test";

import { checkOrder, orderTimes } from "../checks/order.mjs";

const image = (value) => ({
  width: 8,
  height: 8,
  data: new Uint8ClampedArray(8 * 8 * 4).fill(value),
});

test("order samples stay in the requested heard span, including both sides of cuts and subframes", () => {
  const times = orderTimes(10, [1, 4, 7], 3, 6);
  expect(times[0]).toBe(3);
  expect(times.every((t) => t >= 3 && t < 6)).toBe(true);
  expect(times).toContain(4);
  expect(times.some((t) => t < 4 && t > 3.9)).toBe(true);
  expect(times.some((t) => t > 4 && t < 4.1)).toBe(true);
  expect(times.some((t) => Math.abs(t * 30 - Math.round(t * 30)) > 0.01)).toBe(true);
  expect(
    orderTimes(
      1000,
      Array.from({ length: 900 }, (_, i) => i + 1),
    ).length,
  ).toBeLessThanOrEqual(48);
});

test("a picture determined by t survives both orders even when the capture buffer is reused", async () => {
  const frame = image(0);
  const result = await checkOrder(
    async (t) => {
      frame.data.fill(t * 30);
      return frame;
    },
    [0, 1, 2],
  );
  expect(result.failures).toEqual([]);
  expect(result.times).toEqual([0, 1, 2]);
});

test("accumulated state produces a failure with both pictures and the affected second", async () => {
  let value = 0;
  const result = await checkOrder(async () => image((value += 20)), [0, 1, 2]);
  expect(result.failures.length).toBeGreaterThan(0);
  expect(result.failures[0].difference).toBeGreaterThan(2);
  expect(result.evidence.before.data).not.toEqual(result.evidence.after.data);
  expect(result.times).toContain(result.evidence.at);
});

test("a small antialiasing difference is tolerated but a visible alpha change is reported", async () => {
  let count = 0;
  expect((await checkOrder(async () => image(count++ < 2 ? 100 : 101), [0, 1])).failures).toEqual(
    [],
  );
  count = 0;
  const result = await checkOrder(async () => {
    const frame = image(255);
    if (count++ >= 2) for (let i = 3; i < frame.data.length; i += 4) frame.data[i] = 0;
    return frame;
  }, [0, 1]);
  expect(result.failures).toHaveLength(2);
});

test("failed drawing names the time and preserves the cause", async () => {
  await expect(
    checkOrder(async () => {
      throw new Error("missing texture.png");
    }, [1, 2]),
  ).rejects.toThrow(/frame\(.*\).*missing texture.png/);
});

test("opposite pixel patterns do not cancel each other inside a block", async () => {
  let call = 0;
  const result = await checkOrder(async () => {
    const frame = image(255);
    const alternate = call++ >= 2;
    for (let i = 0; i < frame.data.length; i += 4) {
      const value = ((i / 4) % 2 === 0) !== alternate ? 255 : 0;
      frame.data[i] = frame.data[i + 1] = frame.data[i + 2] = value;
    }
    return frame;
  }, [0, 1]);
  expect(result.failures).toHaveLength(2);
});

test("empty or out-of-film sampling cannot produce a successful diagnostic", async () => {
  expect(() => orderTimes(1, [], 1.01, 1.04)).toThrow(/range/);
  expect(() => orderTimes(0)).toThrow(/duration/);
  await expect(checkOrder(async () => image(0), [])).rejects.toThrow(/at least one/);
});
