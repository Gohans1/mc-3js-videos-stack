import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAuditionController } from "../app/sound/audition-controller.ts";
import { createSoundKitController } from "../app/sound/sound-kit-controller.ts";
import { openSoundKit } from "../src/sound-kit.mjs";

const makeBuffer = (samples, duration = 1) => ({
  duration,
  numberOfChannels: 1,
  getChannelData: () => Float32Array.from(samples),
});

const makeHarness = (overrides = {}) => {
  let lanes = {
    narration: "narr-voice",
    beds: [
      {
        name: "bgm-orig",
        from: 0,
        to: 15,
        gain: -20,
        duck: 12,
        start: 83.8,
        fadeIn: 0,
        fadeOut: 0,
        track: "bgm-1",
        beats: [1, 2],
        beatMode: "grid",
        bpm: 120,
        beatSource: "lib",
        try: ["alt-1"],
      },
    ],
    sfx: [
      {
        at: 2,
        name: "sfx-orig",
        gain: 0,
        start: 0.2,
        length: 0.16,
        dialogue: "hello",
        beats: [0.5],
        try: ["alt-2"],
      },
    ],
    tracks: [
      { id: "bgm-muted", mute: true },
      { id: "bgm-1" },
      { id: "sfx-locked", lock: true },
      { id: "sfx-1" },
    ],
  };

  let selectedClip = null;
  let playhead = 4;
  let playing = false;
  let listeningId = null;
  const says = [];
  const seeks = [];
  const adds = [];
  const restores = [];
  const createdNodes = [];
  let ensureLibraryCalls = 0;

  const libMap = new Map([
    ["bgm-orig", { name: "bgm-orig", kind: "bgm", seconds: 30 }],
    ["bgm-a", { name: "bgm-a", kind: "bgm", seconds: 25 }],
    ["bgm-b", { name: "bgm-b", kind: "bgm", seconds: 20 }],
    ["sfx-orig", { name: "sfx-orig", kind: "sfx", seconds: 1.0 }],
    ["sfx-a", { name: "sfx-a", kind: "sfx", seconds: 0.5 }],
    ["sfx-b", { name: "sfx-b", kind: "sfx", seconds: 0.6 }],
  ]);

  const buffers = new Map([
    ["bgm-a", makeBuffer([0.1, -0.1, 0.1, -0.1], 25)],
    ["bgm-b", makeBuffer([0.1, -0.1, 0.1, -0.1], 20)],
    ["sfx-a", makeBuffer([0.05, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], 0.5)],
    ["sfx-b", makeBuffer([0.1, -0.1], 0.6)],
  ]);

  const jsonResp = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

  const defaultFetch = async () =>
    jsonResp({ state: { version: 1, items: {}, abSlots: [], decisions: [] } });
  const defaultPostJson = async (_url, body) =>
    jsonResp({ version: 1, items: {}, abSlots: body?.slots ?? [], decisions: [] });

  const controller = createSoundKitController({
    fetch: overrides.fetch ?? defaultFetch,
    postJson: overrides.postJson ?? defaultPostJson,
    say: (msg) => says.push(msg),
    getLanes: () => lanes,
    getSelectedClip: () => selectedClip,
    getPlayhead: () => playhead,
    getPlaying: () => playing,
    getDuration: () => 20,
    stamp: (s) => `${s.toFixed(1)}s`,
    r3: (n) => Math.round(n * 1000) / 1000,
    isEditableSoundClip: (c) => Boolean(c),
    span: (c) => (c.list === "beds" ? [0, 15] : [2, 3]),
    itemOf: (name) => libMap.get(name),
    ensureLibrary:
      overrides.ensureLibrary ??
      (async () => {
        ensureLibraryCalls += 1;
        if (overrides.lazyItems) {
          for (const it of overrides.lazyItems) libMap.set(it.name, it);
        }
      }),
    kindOf: (it) => it.kind ?? "sfx",
    seconds: (name) => libMap.get(name)?.seconds ?? 1,
    snapshot: () => JSON.stringify(lanes),
    preview: (fn) => fn(lanes),
    restore: (snap) => {
      restores.push(snap);
      lanes = JSON.parse(snap);
    },
    edit: (fn) => fn(lanes),
    addClip: (name, at) => adds.push({ name, at }),
    decoded: overrides.decoded ?? (async (name) => buffers.get(name) ?? null),
    listen:
      overrides.listen ??
      ((name) => {
        listeningId = listeningId === name ? null : name;
      }),
    listening: overrides.listening ?? (() => listeningId),
    stopAudition:
      overrides.stopAudition ??
      (() => {
        listeningId = null;
      }),
    attachExternalAudition: overrides.attachExternalAudition,
    releaseExternalAudition: overrides.releaseExternalAudition,
    resumeAudio: () => {},
    getAudio: () => ({
      ctx: {
        currentTime: overrides.getCurrentTime ? overrides.getCurrentTime() : 0,
        createBufferSource: () => {
          const rec = {
            gain: 1,
            stopped: false,
            disconnected: false,
            startOffset: 0,
            triggerEnded: () => {},
          };
          createdNodes.push(rec);
          const node = {
            buffer: null,
            onended: null,
            connect: (dest) => {
              rec.gain = dest.gain.value;
              return dest;
            },
            disconnect: () => {
              rec.disconnected = true;
            },
            start: (_when = 0, offset = 0) => {
              rec.startOffset = offset;
            },
            stop: () => {
              rec.stopped = true;
            },
          };
          rec.triggerEnded = () => node.onended?.();
          return node;
        },
        createGain: () => ({
          gain: { value: 1 },
          connect: (d) => d,
          disconnect: () => {},
        }),
      },
      master: {},
    }),
    seek: (s) => seeks.push(s),
    setPlaying: (p) => {
      playing = p;
    },
  });

  return {
    controller,
    getLanes: () => lanes,
    setSelectedClip: (c) => {
      selectedClip = c;
    },
    setPlayhead: (t) => {
      playhead = t;
    },
    getPlaying: () => playing,
    getListening: () => listeningId,
    getEnsureLibraryCalls: () => ensureLibraryCalls,
    says,
    seeks,
    adds,
    restores,
    createdNodes,
  };
};

describe("createSoundKitController live video preview and restore safety", () => {
  test("clip preview clears target.try/start, records originalClipName, ignores non-sound doc mutations, and restores cleanly on stop", async () => {
    const h = makeHarness();
    const ok = await h.controller.previewSoundInVideo("bgm-a", { list: "beds", i: 0 });
    expect(ok).toBe(true);
    expect(h.getLanes().beds[0].name).toBe("bgm-a");
    expect(h.getLanes().beds[0].try).toBeUndefined();
    expect(h.controller.getSnapshot().videoPreview.active).toBe(true);
    expect(h.controller.getSnapshot().videoPreview.originalClipName).toBe("bgm-orig");
    expect(h.controller.getSnapshot().videoPreviewPendingId).toBeNull();
    expect(h.getPlaying()).toBe(true);

    h.controller.handleDocMutated("notes");
    h.controller.handleDocMutated("cam");
    expect(h.controller.getSnapshot().videoPreview.active).toBe(true);
    expect(h.restores.length).toBe(0);

    h.controller.stopVideoPreview(true);
    expect(h.restores.length).toBe(1);
    expect(h.getLanes().beds[0].name).toBe("bgm-orig");
    expect(h.getLanes().beds[0].try).toEqual(["alt-1"]);
    expect(h.getPlaying()).toBe(false);
    expect(h.controller.getSnapshot().videoPreview.active).toBe(false);
  });

  test("sound doc mutation clears preview state without double-restoring", async () => {
    const h = makeHarness();
    await h.controller.previewSoundInVideo("bgm-a", { list: "beds", i: 0 });
    h.controller.handleDocMutated("sound");
    expect(h.controller.getSnapshot().videoPreview.active).toBe(false);
    expect(h.restores.length).toBe(0);
  });

  test("failed first decode clears snapshot so later clip preview captures fresh target", async () => {
    const h = makeHarness();
    const bad = await h.controller.previewSoundInVideo("missing-audio", { list: "beds", i: 0 });
    expect(bad).toBe(false);
    expect(h.controller.getSnapshot().videoPreview.active).toBe(false);

    const ok = await h.controller.previewSoundInVideo("sfx-a", { list: "sfx", i: 0 });
    expect(ok).toBe(true);
    expect(h.getLanes().beds[0].name).toBe("bgm-orig");
    expect(h.getLanes().sfx[0].name).toBe("sfx-a");
    expect(h.getLanes().sfx[0].start).toBeUndefined();
    expect(h.getLanes().sfx[0].length).toBeUndefined();
  });

  test("retargeting to a second clip restores the first clip first, and stopVideoPreviewIfTarget scopes to matching clip", async () => {
    const h = makeHarness();
    await h.controller.previewSoundInVideo("bgm-a", { list: "beds", i: 0 });
    expect(h.getLanes().beds[0].name).toBe("bgm-a");

    await h.controller.previewSoundInVideo("sfx-a", { list: "sfx", i: 0 });
    expect(h.getLanes().beds[0].name).toBe("bgm-orig");
    expect(h.getLanes().sfx[0].name).toBe("sfx-a");

    h.controller.stopVideoPreviewIfTarget({ list: "beds", i: 0 });
    expect(h.controller.getSnapshot().videoPreview.active).toBe(true);

    h.controller.stopVideoPreviewIfTarget({ list: "sfx", i: 0 });
    expect(h.controller.getSnapshot().videoPreview.active).toBe(false);
    expect(h.getLanes().sfx[0].name).toBe("sfx-orig");
  });

  test("retargeting to a second clip whose decode fails resets videoPreview.active to false after restoring first clip", async () => {
    const h = makeHarness();
    await h.controller.previewSoundInVideo("bgm-a", { list: "beds", i: 0 });
    expect(h.controller.getSnapshot().videoPreview.active).toBe(true);

    const ok = await h.controller.previewSoundInVideo("missing-audio", { list: "sfx", i: 0 });
    expect(ok).toBe(false);
    expect(h.getLanes().beds[0].name).toBe("bgm-orig");
    expect(h.controller.getSnapshot().videoPreview.active).toBe(false);
    expect(h.controller.getSnapshot().videoPreview.originalClipName).toBeNull();
    expect(h.controller.getSnapshot().videoPreviewPendingId).toBeNull();
  });

  test("acquireWorkbenchMount preserves active preview across Dock/Expand handoff and stops when last workbench unmounts", async () => {
    const h = makeHarness();
    const releaseDialog = h.controller.acquireWorkbenchMount();
    await h.controller.previewSoundInVideo("bgm-a", { list: "beds", i: 0 });
    expect(h.controller.getSnapshot().videoPreview.active).toBe(true);

    releaseDialog();
    const releaseDocked = h.controller.acquireWorkbenchMount();
    await Promise.resolve();
    expect(h.controller.getSnapshot().videoPreview.active).toBe(true);

    releaseDocked();
    await Promise.resolve();
    expect(h.controller.getSnapshot().videoPreview.active).toBe(false);
    expect(h.getLanes().beds[0].name).toBe("bgm-orig");
  });

  test("playhead preview suppresses overlapping beds, inherits bed gain/duck, and clamps end-of-film BGM and SFX spans", async () => {
    const h = makeHarness();
    h.setPlayhead(4);
    await h.controller.previewSoundInVideo("bgm-a");
    expect(h.getLanes().beds.length).toBe(1);
    expect(h.getLanes().beds[0].name).toBe("bgm-a");
    expect(h.getLanes().beds[0].gain).toBe(-20);
    expect(h.getLanes().beds[0].duck).toBe(12);
    expect(h.getLanes().beds[0].track).toBe("bgm-1");
    h.controller.stopVideoPreview(true);
    expect(h.getLanes().beds.length).toBe(1);
    expect(h.getLanes().beds[0].name).toBe("bgm-orig");

    h.setPlayhead(20);
    await h.controller.previewSoundInVideo("bgm-a");
    const added = h.getLanes().beds.find((b) => b.name === "bgm-a");
    expect(added?.track).toBe("bgm-1");
    expect(added?.gain).toBe(-12);
    expect(added.to > added.from).toBe(true);
    h.controller.stopVideoPreview(true);

    h.setPlayhead(19.98);
    await h.controller.previewSoundInVideo("sfx-a");
    const addedSfx = h.getLanes().sfx.find((s) => s.name === "sfx-a");
    expect(addedSfx?.track).toBe("sfx-1");
    expect(addedSfx.at).toBeLessThan(19.8);
  });

  test("applyKitSoundToFilm and saveAbSlotsAsClipTry lazy-load library and clear stale start, length, try, beats, and dialogue", async () => {
    const h = makeHarness({
      lazyItems: [{ name: "bgm-lazy", kind: "bgm", seconds: 40 }],
    });
    expect(await h.controller.applyKitSoundToFilm("not-in-library")).toBeNull();
    expect(h.getEnsureLibraryCalls()).toBe(1);

    const lazyMode = await h.controller.applyKitSoundToFilm("bgm-lazy", "bgm", [], {
      list: "beds",
      i: 0,
    });
    expect(lazyMode).toBe("swapped");
    expect(h.getLanes().beds[0].name).toBe("bgm-lazy");
    expect(h.getLanes().beds[0].start).toBeUndefined();
    expect(h.getLanes().beds[0].try).toBeUndefined();
    expect(h.getLanes().beds[0].beats).toBeUndefined();
    expect(h.getLanes().beds[0].bpm).toBeUndefined();

    await h.controller.previewSoundInVideo("bgm-a", { list: "beds", i: 0 });
    h.setSelectedClip({ list: "sfx", i: 0 });
    const mode = await h.controller.applyKitSoundToFilm("sfx-a", "whoosh");
    expect(mode).toBe("swapped");
    expect(h.getLanes().beds[0].name).toBe("bgm-lazy");
    expect(h.getLanes().sfx[0].name).toBe("sfx-a");
    expect(h.getLanes().sfx[0].start).toBeUndefined();
    expect(h.getLanes().sfx[0].length).toBeUndefined();
    expect(h.getLanes().sfx[0].try).toBeUndefined();
    expect(h.getLanes().sfx[0].dialogue).toBeUndefined();
    expect(h.getLanes().sfx[0].beats).toBeUndefined();

    h.getLanes().sfx[0].length = 0.25;
    h.getLanes().sfx[0].start = 0.1;
    const okTry = await h.controller.saveAbSlotsAsClipTry(["sfx-a", "sfx-b", "missing-id"], {
      list: "sfx",
      i: 0,
    });
    expect(okTry).toBe(true);
    expect(h.getLanes().sfx[0].name).toBe("sfx-a");
    expect(h.getLanes().sfx[0].try).toEqual(["sfx-b"]);
    expect(h.getLanes().sfx[0].length).toBeUndefined();
    expect(h.getLanes().sfx[0].start).toBeUndefined();

    h.setSelectedClip(null);
    h.setPlayhead(6.5);
    const addedMode = await h.controller.applyKitSoundToFilm("sfx-a", "whoosh");
    expect(addedMode).toBe("added");
    expect(h.adds).toEqual([{ name: "sfx-a", at: 6.5 }]);

    expect(await h.controller.saveAbSlotsAsClipTry(["sfx-a", "sfx-b"])).toBe(false);
    expect(await h.controller.saveAbSlotsAsClipTry(["sfx-a"], { list: "sfx", i: 0 })).toBe(false);

    await h.controller.previewSoundInVideo("bgm-a", { list: "beds", i: 0 });
    h.setSelectedClip(null);
    const activePreviewSwap = await h.controller.applyKitSoundToFilm("bgm-b", "bgm");
    expect(activePreviewSwap).toBe("swapped");
    expect(h.getLanes().beds[0].name).toBe("bgm-b");
  });

  test("playhead BGM preview never inherits a muted overlapping bed track", async () => {
    const h = makeHarness();
    h.getLanes().beds[0].track = "bgm-muted";
    h.setPlayhead(4);
    await h.controller.previewSoundInVideo("bgm-a");
    expect(h.getLanes().beds[0].track).toBe("bgm-1");
    h.controller.stopVideoPreview(true);
  });

  test("playhead preview routes canonical semantic tracks by role instead of stealing Voice track", async () => {
    const h = makeHarness();
    h.getLanes().tracks = [
      { id: "t1", name: "Voice", role: "voice" },
      { id: "t2", name: "BGM", role: "bgm" },
      { id: "t3", name: "Whoosh", role: "whoosh" },
    ];
    h.getLanes().beds = [];
    h.setPlayhead(10);
    await h.controller.previewSoundInVideo("bgm-a");
    expect(h.getLanes().beds.find((b) => b.name === "bgm-a")?.track).toBe("t2");
    h.controller.stopVideoPreview(true);

    await h.controller.previewSoundInVideo("sfx-a");
    expect(h.getLanes().sfx.find((s) => s.name === "sfx-a")?.track).toBe("t3");
    h.controller.stopVideoPreview(true);

    h.getLanes().tracks = [
      { id: "t1", name: "Voice" },
      { id: "t2", name: "Bed" },
      { id: "t3", name: "SFX" },
    ];
    await h.controller.previewSoundInVideo("bgm-a");
    expect(h.getLanes().beds.find((b) => b.name === "bgm-a")?.track).toBe("t2");
    h.controller.stopVideoPreview(true);

    await h.controller.previewSoundInVideo("sfx-a");
    expect(h.getLanes().sfx.find((s) => s.name === "sfx-a")?.track).toBe("t3");
    h.controller.stopVideoPreview(true);

    const hRoles = makeHarness({
      lazyItems: [
        {
          name: "boom-hit",
          title: "Sub Impact Hit",
          category: "impacts",
          kind: "sfx",
          seconds: 0.8,
        },
        { name: "pop-blip", title: "Bubble Pop", category: "clicks", kind: "sfx", seconds: 0.3 },
      ],
      decoded: async (name) =>
        name === "boom-hit" ? makeBuffer([0.1, -0.1], 0.8) : makeBuffer([0.1, -0.1], 0.3),
    });
    hRoles.getLanes().tracks = [
      { id: "t1", name: "Voice", role: "voice" },
      { id: "t2", name: "BGM", role: "bgm" },
      { id: "t3", name: "Whoosh", role: "whoosh" },
      { id: "t4", name: "Pop & UI", role: "pop-ui" },
      { id: "t5", name: "Impact", role: "impact" },
    ];
    hRoles.getLanes().beds = [];
    hRoles.setPlayhead(10);
    await hRoles.controller.applyKitSoundToFilm("nonexistent-just-load-lazy");
    await hRoles.controller.previewSoundInVideo("boom-hit");
    expect(hRoles.getLanes().sfx.find((s) => s.name === "boom-hit")?.track).toBe("t5");
    hRoles.controller.stopVideoPreview(true);

    await hRoles.controller.previewSoundInVideo("pop-blip");
    expect(hRoles.getLanes().sfx.find((s) => s.name === "pop-blip")?.track).toBe("t4");
    hRoles.controller.stopVideoPreview(true);
  });

  test("server error responses surface error message and return null without corrupting state", async () => {
    const h = makeHarness({
      fetch: async () => new Response(JSON.stringify({ error: "kit offline" }), { status: 503 }),
      postJson: async () =>
        new Response(JSON.stringify({ error: "write denied" }), { status: 500 }),
    });
    await h.controller.reloadSoundKit();
    expect(h.controller.getSnapshot().error).toBe("kit offline");
    expect(h.controller.getSnapshot().loading).toBe(false);
    expect(h.controller.getSnapshot().loaded).toBe(false);

    const saved = await h.controller.resolveKitAb({
      winner: "bgm-a",
      rejected: ["bgm-b"],
      category: "bgm",
    });
    expect(saved).toBeNull();
    expect(h.says.some((m) => m.includes("write denied"))).toBe(true);

    const removed = await h.controller.removeKitItem("bgm-a");
    expect(removed).toBeNull();
  });
});

describe("createSoundKitController store sync, serialization, and playback", () => {
  test("in-flight reloadSoundKit never overwrites a newer saveKitItem response, and rapid toggleKitAbSlot calls serialize", async () => {
    let resolveReload;
    const reloadPromise = new Promise((res) => {
      resolveReload = res;
    });
    const postedSlots = [];
    const h = makeHarness({
      fetch: async () => reloadPromise,
      postJson: async (url, body) => {
        if (url === "/api/sound-kit/item") {
          return new Response(
            JSON.stringify({
              version: 1,
              items: { "sfx-a": { id: "sfx-a", category: "whoosh", status: "core" } },
              abSlots: [],
              decisions: [],
            }),
            { status: 200 },
          );
        }
        const slots = body.slots;
        postedSlots.push([...slots]);
        return new Response(
          JSON.stringify({ version: 1, items: {}, abSlots: slots, decisions: [] }),
          { status: 200 },
        );
      },
    });

    const pendingReload = h.controller.reloadSoundKit();
    expect(h.controller.getSnapshot().loading).toBe(true);
    await h.controller.saveKitItem({ id: "sfx-a", category: "whoosh", status: "core" });
    expect(h.controller.getSnapshot().loading).toBe(false);
    resolveReload(
      new Response(
        JSON.stringify({ state: { version: 1, items: {}, abSlots: [], decisions: [] } }),
        { status: 200 },
      ),
    );
    await pendingReload;
    expect(Object.keys(h.controller.getSnapshot().state.items)).toEqual(["sfx-a"]);
    expect(h.controller.getSnapshot().loading).toBe(false);

    const revBeforeEcho = h.controller.getSnapshot().stateRev;
    await h.controller.saveKitItem({ id: "sfx-a", category: "whoosh", status: "core" });
    expect(h.controller.getSnapshot().stateRev).toBe(revBeforeEcho);

    const p1 = h.controller.toggleKitAbSlot("sfx-a");
    const p2 = h.controller.toggleKitAbSlot("sfx-b");
    await Promise.all([p1, p2]);
    expect(postedSlots).toEqual([["sfx-a"], ["sfx-a", "sfx-b"]]);
    expect(h.controller.getSnapshot().state.abSlots).toEqual(["sfx-a", "sfx-b"]);
  });

  test("playKitSound pauses cleanly across listen() to decodedCache transition and caps RMS gain to avoid peak clipping", async () => {
    const h = makeHarness();
    h.controller.playKitSound("sfx-a", { forcePlay: false, loudnessMatch: true });
    expect(h.getListening()).toBe("sfx-a");
    await Promise.resolve();
    await Promise.resolve();

    h.controller.playKitSound("sfx-a", { forcePlay: false, loudnessMatch: true });
    expect(h.getListening()).toBeNull();
    expect(h.controller.getSnapshot().loudnessPlayingId).toBeNull();
    expect(h.createdNodes.length).toBe(0);

    h.controller.playKitSound("sfx-a", { forcePlay: true, loudnessMatch: true });
    expect(h.controller.getSnapshot().loudnessPlayingId).toBe("sfx-a");
    expect(h.createdNodes.length).toBe(1);
    expect(h.createdNodes[0].gain).toBeLessThanOrEqual(0.9501);

    h.controller.stopMiniStudioBuffer();
    expect(h.createdNodes[0].stopped).toBe(true);
    expect(h.createdNodes[0].disconnected).toBe(true);
  });

  test("clearAudioCache discards in-flight warmAbAudio decodes from prior cache epoch", async () => {
    let resolveDecode;
    const h = makeHarness({
      decoded: () =>
        new Promise((res) => {
          resolveDecode = res;
        }),
    });
    h.controller.warmAbAudio(["sfx-a"]);
    h.controller.clearAudioCache();
    resolveDecode(makeBuffer([0.1, -0.1], 0.5));
    await Promise.resolve();
    await Promise.resolve();

    h.controller.playKitSound("sfx-a", { forcePlay: true, loudnessMatch: true });
    expect(h.createdNodes.length).toBe(0);
    expect(h.getListening()).toBe("sfx-a");
  });

  test("undoKit and redoKit atomically preserve Elo, stats, abSlots, and decisions across save, A/B resolve, and remove", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sound-kit-undo-"));
    const kit = openSoundKit(join(dir, "core.json"));
    try {
      const h = makeHarness({
        fetch: async (url, init) => {
          if (init?.method === "DELETE" && url.startsWith("/api/sound-kit/item/")) {
            const id = decodeURIComponent(url.slice("/api/sound-kit/item/".length));
            return new Response(JSON.stringify(kit.removeItem(id)), { status: 200 });
          }
          return new Response(JSON.stringify({ state: kit.read() }), { status: 200 });
        },
        postJson: async (url, body) => {
          if (url === "/api/sound-kit/item") {
            return new Response(JSON.stringify(kit.setItem(body)), { status: 200 });
          }
          if (url === "/api/sound-kit/ab") {
            return new Response(JSON.stringify(kit.updateAb(body)), { status: 200 });
          }
          if (url === "/api/sound-kit/restore") {
            return new Response(JSON.stringify(kit.restoreSnapshot(body)), { status: 200 });
          }
          return new Response(JSON.stringify(kit.read()), { status: 200 });
        },
      });

      expect(h.controller.getSnapshot().canUndo).toBe(false);
      expect(h.controller.getSnapshot().canRedo).toBe(false);

      await h.controller.saveKitItem({ id: "sfx-a", category: "whoosh", status: "pass" });
      await h.controller.saveKitItem({ id: "sfx-b", category: "whoosh", status: "inbox" });
      await h.controller.saveKitAb(["sfx-a", "sfx-b"]);
      const resolved = await h.controller.resolveKitAb({
        winner: "sfx-a",
        rejected: ["sfx-b"],
        category: "whoosh",
        reason: "punchy",
      });
      const winElo = resolved.items["sfx-a"].elo;
      expect(winElo).toBeGreaterThan(1500);
      expect(resolved.items["sfx-a"].wins).toBe(1);
      expect(resolved.items["sfx-b"].losses).toBe(1);
      expect(resolved.decisions.length).toBe(1);

      await h.controller.removeKitItem("sfx-a");
      expect(h.controller.getSnapshot().state.items["sfx-a"]).toBeUndefined();

      await h.controller.undoKit();
      expect(h.controller.getSnapshot().state.items["sfx-a"]?.elo).toBe(winElo);
      expect(h.controller.getSnapshot().state.items["sfx-a"]?.wins).toBe(1);

      await h.controller.undoKit();
      expect(h.controller.getSnapshot().state.items["sfx-a"]?.elo).toBe(1500);
      expect(h.controller.getSnapshot().state.items["sfx-a"]?.wins).toBe(0);
      expect(h.controller.getSnapshot().state.items["sfx-a"]?.status).toBe("pass");
      expect(h.controller.getSnapshot().state.items["sfx-b"]?.losses).toBe(0);
      expect(h.controller.getSnapshot().state.decisions.length).toBe(0);

      await h.controller.redoKit();
      expect(h.controller.getSnapshot().state.items["sfx-a"]?.elo).toBe(winElo);
      expect(h.controller.getSnapshot().state.items["sfx-a"]?.wins).toBe(1);
      expect(h.controller.getSnapshot().state.decisions.length).toBe(1);

      await h.controller.saveKitItem({ id: "sfx-c", category: "whoosh", status: "ban" });
      expect(h.controller.getSnapshot().canRedo).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Match dB external AuditionDock handles A->B->A switching, cache-clear replay fallback without recursion, mid-play seek, and in-place pause", async () => {
    const listeners = new Map();
    const audio = {
      src: "",
      paused: true,
      duration: 2,
      currentTime: 0,
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      emit(type) {
        for (const fn of listeners.get(type) ?? []) fn();
      },
      play() {
        audio.paused = false;
        audio.emit("play");
        return Promise.resolve();
      },
      pause() {
        if (audio.paused) return;
        audio.paused = true;
        audio.emit("pause");
      },
    };
    const audition = createAuditionController({
      audio,
      setInterval: () => 1,
      clearInterval: () => {},
      onSoundBump: () => {},
      onPlayError: () => {},
    });
    let clock = 10;
    const h = makeHarness({
      listen: (name) => audition.listen(name),
      listening: () => audition.listening(),
      stopAudition: () => audition.stopAudition(),
      attachExternalAudition: (src) => audition.attachExternalAudition(src),
      releaseExternalAudition: (src, keep) => audition.releaseExternalAudition(src, keep),
      getCurrentTime: () => clock,
    });

    h.controller.warmAbAudio(["sfx-a", "sfx-b"]);
    await Promise.resolve();
    await Promise.resolve();

    h.controller.playKitSound("sfx-a", { forcePlay: true, loudnessMatch: true });
    expect(h.createdNodes.length).toBe(1);
    expect(h.controller.getSnapshot().loudnessPlayingId).toBe("sfx-a");
    expect(audition.listening()).toBe("sfx-a");
    expect(audition.auditionTarget()).toBe("sfx-a");

    h.controller.playKitSound("sfx-b", { forcePlay: true, loudnessMatch: true });
    expect(h.createdNodes.length).toBe(2);
    expect(h.createdNodes[0].stopped).toBe(true);
    expect(h.createdNodes[1].stopped).toBe(false);
    expect(h.createdNodes[1].disconnected).toBe(false);
    expect(h.controller.getSnapshot().loudnessPlayingId).toBe("sfx-b");
    expect(audition.listening()).toBe("sfx-b");
    expect(audition.auditionTarget()).toBe("sfx-b");

    h.controller.playKitSound("sfx-a", { forcePlay: true, loudnessMatch: true });
    expect(h.createdNodes.length).toBe(3);
    expect(h.createdNodes[1].stopped).toBe(true);
    expect(h.createdNodes[2].stopped).toBe(false);
    expect(h.controller.getSnapshot().loudnessPlayingId).toBe("sfx-a");
    expect(audition.listening()).toBe("sfx-a");

    clock = 10.25;
    h.controller.playKitSound("sfx-a", { forcePlay: false, loudnessMatch: true });
    expect(h.controller.getSnapshot().loudnessPlayingId).toBeNull();
    expect(audition.listening()).toBe("");
    expect(audition.auditionTarget()).toBe("sfx-a");

    h.controller.clearAudioCache();
    expect(() => audition.listen("sfx-a")).not.toThrow();
    expect(audition.listening()).toBe("sfx-a");
    expect(audition.auditionTarget()).toBe("sfx-a");

    h.controller.playKitSound("sfx-a", { forcePlay: false, loudnessMatch: false });
    expect(audition.listening()).toBe("");
    expect(audition.auditionTarget()).toBe("sfx-a");

    h.controller.warmAbAudio(["sfx-b"]);
    await Promise.resolve();
    await Promise.resolve();
    h.controller.playKitSound("sfx-b", { forcePlay: true, loudnessMatch: true });
    const liveIdx = h.createdNodes.length - 1;
    h.controller.clearAudioCache();
    audition.seekAudition("sfx-b", 0.4, 1);
    expect(h.createdNodes.length).toBe(liveIdx + 2);
    expect(h.createdNodes[liveIdx + 1].startOffset).toBeCloseTo(0.4, 2);
    expect(audition.listening()).toBe("sfx-b");

    h.createdNodes[liveIdx + 1].triggerEnded();
    expect(audition.listening()).toBe("");
    expect(audition.auditionTarget()).toBe("sfx-b");
    expect(() => audition.listen("sfx-b")).not.toThrow();
    expect(audition.listening()).toBe("sfx-b");
  });
});
