import { describe, expect, it } from "bun:test";

import { captureNoteMedia } from "../app/lite/capture.ts";

class FakeVideo extends EventTarget {
  crossOrigin = "";
  muted = false;
  playsInline = false;
  preload = "metadata";
  readyState = 0;
  seeking = false;
  videoWidth = 1280;
  videoHeight = 720;
  duration = 10;
  private _currentTime = 0;
  private _src = "";

  get currentTime() {
    return this._currentTime;
  }

  set currentTime(val: number) {
    this._currentTime = val;
    this.seeking = true;
    queueMicrotask(() => {
      this.seeking = false;
      this.readyState = 4;
      this.dispatchEvent(new Event("seeked"));
    });
  }

  get src() {
    return this._src;
  }

  set src(val: string) {
    this._src = val;
  }

  removeAttribute(name: string) {
    if (name === "src") this._src = "";
  }

  pause() {}

  load() {
    if (!this._src) return;
    queueMicrotask(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event("loadedmetadata"));
      if (this.preload === "auto") {
        queueMicrotask(() => {
          this.readyState = 4;
          this.dispatchEvent(new Event("loadeddata"));
        });
      }
    });
  }
}

describe("captureNoteMedia offscreen t=0 capture", () => {
  it("decodes offscreen frame at t=0 without stalling when preload metadata would stay at readyState 1", async () => {
    const prevDoc = globalThis.document;
    const prevWin = globalThis.window;
    const createdVideos: FakeVideo[] = [];

    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage() {},
        beginPath() {},
        arc() {},
        stroke() {},
        fillRect() {},
        moveTo() {},
        lineTo() {},
        strokeRect() {},
      }),
      toDataURL: () => "data:image/jpeg;base64,/9j/captured",
    };

    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement(tag: string) {
          if (tag === "video") {
            const v = new FakeVideo();
            createdVideos.push(v);
            return v;
          }
          return { ...fakeCanvas };
        },
        documentElement: null,
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
      },
    });

    try {
      const liveVideo = {
        readyState: 4,
        videoWidth: 1280,
        videoHeight: 720,
        currentTime: 4,
      } as unknown as HTMLVideoElement;

      const t0 = performance.now();
      const media = await captureNoteMedia({
        video: liveVideo,
        videoSrc: "/api/compare-videos/file?path=renders/draft.mp4",
        startSec: 0,
        at: 0,
        pin: { x: 0.5, y: 0.5, what: "Render video" },
        marks: [],
      });
      const elapsed = performance.now() - t0;

      expect(createdVideos).toHaveLength(1);
      expect(createdVideos[0]!.preload).toBe("auto");
      expect(media.img).toBe("data:image/jpeg;base64,/9j/captured");
      expect(media.crop).toBe("data:image/jpeg;base64,/9j/captured");
      expect(elapsed).toBeLessThan(500);
    } finally {
      Object.defineProperty(globalThis, "document", { configurable: true, value: prevDoc });
      Object.defineProperty(globalThis, "window", { configurable: true, value: prevWin });
    }
  });

  it("waits for seeked before capturing when canplay fires ahead of seeked on a non-zero timestamp", async () => {
    const prevDoc = globalThis.document;
    const prevWin = globalThis.window;
    let drewBeforeSeeked = false;
    let seekedDispatched = false;

    class OutOfOrderSeekVideo extends FakeVideo {
      private t = 0;
      override set currentTime(val: number) {
        this.t = val;
        this.seeking = false;
        this.readyState = 4;
        queueMicrotask(() => {
          this.dispatchEvent(new Event("canplay"));
          queueMicrotask(() => {
            this.readyState = 1;
            this.dispatchEvent(new Event("seeked"));
            queueMicrotask(() => {
              this.readyState = 4;
              seekedDispatched = true;
              this.dispatchEvent(new Event("canplay"));
            });
          });
        });
      }
      override get currentTime() {
        return this.t;
      }
    }

    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage() {
          if (!seekedDispatched) drewBeforeSeeked = true;
        },
        beginPath() {},
        arc() {},
        stroke() {},
        fillRect() {},
        moveTo() {},
        lineTo() {},
        strokeRect() {},
      }),
      toDataURL: () => "data:image/jpeg;base64,/9j/seeked",
    };

    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement(tag: string) {
          if (tag === "video") return new OutOfOrderSeekVideo();
          return { ...fakeCanvas };
        },
        documentElement: null,
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
      },
    });

    try {
      const media = await captureNoteMedia({
        video: null,
        videoSrc: "/api/compare-videos/file?path=renders/draft.mp4",
        startSec: 0,
        at: 3.5,
        pin: null,
        marks: [],
      });

      expect(media.img).toBe("data:image/jpeg;base64,/9j/seeked");
      expect(drewBeforeSeeked).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "document", { configurable: true, value: prevDoc });
      Object.defineProperty(globalThis, "window", { configurable: true, value: prevWin });
    }
  });
});
