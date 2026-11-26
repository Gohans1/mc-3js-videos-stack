import { afterEach, expect, mock, spyOn, test } from "bun:test";

import { clipNames, loadSource } from "../src/clips";

afterEach(() => mock.restore());

test("an unresponsive mocap download cannot hold scene rendering open", async () => {
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  spyOn(AbortSignal, "timeout").mockImplementation(() => realTimeout(30));
  spyOn(globalThis, "fetch").mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }),
  );
  const result = await Promise.race([
    loadSource("mixamo/deadline").catch((error) => error.name),
    Bun.sleep(300).then(() => "still waiting"),
  ]);
  expect(result).toBe("TimeoutError");
});

test("a failed Mixamo download can be retried and concurrent callers share the retry", async () => {
  const fbx = `; FBX 7.4.0 project file
FBXHeaderExtension:  {
\tFBXVersion: 7400
}
Objects:  {
\tAnimationCurve: 3, "AnimCurve::Empty", "" {
\t\tKeyTime: *1 {
\t\t\ta: 0
\t\t}
\t\tKeyValueFloat: *1 {
\t\t\ta: 0
\t\t}
\t}
\tAnimationLayer: 2, "AnimLayer::Base", "" {
\t}
\tAnimationStack: 1, "AnimStack::Idle", "" {
\t}
}
Connections:  {
\tC: "OO",2,1
}`;
  const fetch = spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response(fbx));

  await expect(loadSource("mixamo/retry-idle")).rejects.toThrow("503");
  const [a, b] = await Promise.all([
    loadSource("mixamo/retry-idle"),
    loadSource("mixamo/retry-idle"),
  ]);

  expect([a.clip.name, b.clip.name]).toEqual(["Idle", "Idle"]);
  expect(a.root).not.toBe(b.root);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("a failed GLTF library download can be retried and the successful library is reused", async () => {
  const fetch = spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ asset: { version: "2.0" }, scenes: [{}], scene: 0 }));

  await expect(clipNames("ual2")).rejects.toThrow("503");
  const found = await Promise.all([clipNames("ual2"), clipNames("ual2")]);

  expect(found).toEqual([[], []]);
  expect(await clipNames("ual2")).toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("a failed GLTF parse is retried once for concurrent callers using the downloaded bytes", async () => {
  const library = "motion/ual1/AnimationLibrary_Godot_Standard.gltf";
  const buffer = "AnimationLibrary_Godot_Standard.bin";
  const gltf = {
    asset: { version: "2.0" },
    scenes: [{ nodes: [0] }],
    scene: 0,
    nodes: [{ name: "Actor" }],
    buffers: [{ uri: buffer, byteLength: 16 }],
    bufferViews: [
      { buffer: 0, byteLength: 4 },
      { buffer: 0, byteOffset: 4, byteLength: 12 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 1, type: "SCALAR", min: [0], max: [0] },
      { bufferView: 1, componentType: 5126, count: 1, type: "VEC3" },
    ],
    animations: [
      {
        name: "Idle",
        samplers: [{ input: 0, output: 1 }],
        channels: [{ sampler: 0, target: { node: 0, path: "translation" } }],
      },
    ],
  };
  const readPaths: string[] = [];
  let parseReads = 0;
  spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (input instanceof Request && input.url.startsWith("blob:")) {
      parseReads++;
      if (parseReads === 1) return new Response(null, { status: 503 });
      return new Response(new Uint8Array(16));
    }
    readPaths.push(String(input));
    if (input === library) return Response.json(gltf);
    if (input === `motion/ual1/${buffer}`) return new Response(new Uint8Array(16));
    throw new Error(`unexpected request: ${input}`);
  });

  const hasProgressEvent = "ProgressEvent" in globalThis;
  if (!hasProgressEvent) Reflect.set(globalThis, "ProgressEvent", class extends Event {});
  try {
    await expect(clipNames("ual1")).rejects.toThrow(/Failed to load buffer/);
    const [names, source] = await Promise.all([clipNames("ual1"), loadSource("ual1/Idle")]);

    expect(names).toEqual(["Idle"]);
    expect(source.clip.name).toBe("Idle");
    expect(readPaths).toEqual([`motion/ual1/${buffer}`, library]);
    expect(parseReads).toBe(2);
  } finally {
    if (!hasProgressEvent) Reflect.deleteProperty(globalThis, "ProgressEvent");
  }
});
